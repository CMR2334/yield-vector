import { TODAY, addBusinessDays, addDays, addMonthsClamped, daysBetween, formatDateDisplay, isoDate, nextBusinessDay, parseDate } from './date-format-core.js';
import { ddRoundTrip, ddTransferConfig, directDepositEffectiveDate, normalizeDdTransfer } from './dd-core.js';
import { requirementDeadlineISO, requirementPathFamily } from './requirements-templates.js';
import { CONFIRMED_OFFER_STATUSES, HYPOTHETICAL_OFFER_STATUSES, PRE_ACCOUNT_SUB_STATUSES } from './runtime-status.js';
/* ============================================================
   OFFER DERIVED FIELDS
   ============================================================ */
function effectiveFundingDate(offer) {
  // User-entered date as-is (Saturday stays Saturday). This is what the
  // form remembers; callers that need the actual bank-processing day go
  // through bizDayISO() below.
  return offer.optionalPlannedFundingDate || offer.plannedSignupDate;
}

// Shift a YYYY-MM-DD to the next business day if it falls on a weekend
// or US federal bank holiday. Used to model "bank doesn't process money
// movement on weekends" for derived action dates (fund posts, withdrawal
// eligible). Anchor dates the user entered (open date, signup date)
// stay as-is — only dates DERIVED from them shift.
function bizDayISO(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : parseDate(d);
  if (!dt) return '';
  return isoDate(nextBusinessDay(dt));
}

function depositDeadline(offer) {
  // Bank's stated deadline — literal calendar date. If it falls on
  // a weekend, the user needs to deposit BEFORE it (no shift here).
  if (!offer.plannedSignupDate || offer.daysAfterSignupAllowedBeforeDeposit == null) return null;
  return isoDate(addDays(parseDate(offer.plannedSignupDate), Number(offer.daysAfterSignupAllowedBeforeDeposit)));
}

// Derived debit-completion deadline (literal calendar date, same no-shift
// convention as depositDeadline): the qualifying debit purchases must be
// done within `debitRequirement.withinDays` of the planned sign-up date.
// Returns an ISO string, or '' when it can't be derived (no requirement,
// no day-count, or no sign-up date yet — an undated offer emits nothing).
function debitDeadlineISO(offer) {
  const dr = offer && offer.debitRequirement;
  if (!dr || !dr.required) return '';
  const days = Number(dr.withinDays);
  if (!Number.isFinite(days) || days <= 0) return '';
  const signup = parseDate(offer.plannedSignupDate);
  if (!signup) return '';
  return isoDate(addDays(signup, days));
}

// Offer types that seed the HELD LUMP family in pathFamilyFlags (the family map's
// legacy-field fallback: an enumerated held type + requiredFundingAmount>0 → hold
// family present). 'other' is a legacy catch-all normalized to 'new-funds-held'
// at every write path (and unavailable in the offer-type radio); it is kept here
// so a raw stored 'other' offer still registers the hold family.
// NOTE: this allow-list is NO LONGER used to derive pathState().holdActive — that
// is the literal predicate `offerType !== 'direct-deposit'` (see pathState), so a
// MISSING/unknown offerType keeps its pre-87ff38c held-lump modeling. This set is
// only the FAMILY-DETECTION allow-list (which enumerated types can seed 'hold').
const HELD_LUMP_TYPES = new Set(['new-funds-held', 'held-and-dd', 'other']);

// Which qualification-path families (dd | debit | hold) are present on an offer,
// as three booleans — the raw "what could this bonus be met by" signal, from the
// family map over its requirement ROWS PLUS legacy-field fallbacks (so detection
// is robust even before syncRequirementsWithLegacy has materialized the derived
// rows — raw import / pin / pre-sync offers). The derived rows mirror exactly
// these legacy obligations, so the fallback can only AGREE with a synced offer's
// rows, never contradict them. Returns flat booleans (no Set/array allocation)
// because pathState is a beam-search hot path. PURE.
function pathFamilyFlags(offer) {
  const o = offer || {};
  let dd = false, debit = false, hold = false;
  const reqs = Array.isArray(o.requirements) ? o.requirements : [];
  for (let i = 0; i < reqs.length; i++) {
    const fam = reqs[i] && requirementPathFamily(reqs[i].type);
    if (fam === 'dd') dd = true;
    else if (fam === 'debit') debit = true;
    else if (fam === 'hold') hold = true;
  }
  const isDdType = o.offerType === 'direct-deposit' || o.offerType === 'held-and-dd';
  const hasDdObligation = (Array.isArray(o.directDeposits) && o.directDeposits.length > 0)
    || (o.ddRequirement && (o.ddRequirement.mode === 'frequency' || Number(o.ddRequirement.count) > 0));
  if (isDdType && hasDdObligation) dd = true;
  if (o.debitRequirement && o.debitRequirement.required) debit = true;
  if (HELD_LUMP_TYPES.has(o.offerType) && Number(o.requiredFundingAmount) > 0) hold = true;
  return { dd, debit, hold };
}

// The present path families as a Set (external convenience wrapper over
// pathFamilyFlags). Cold callers only.
function offerPathFamilies(offer) {
  const f = pathFamilyFlags(offer);
  const set = new Set();
  if (f.dd) set.add('dd');
  if (f.debit) set.add('debit');
  if (f.hold) set.add('hold');
  return set;
}

// The path families the owner can CHOOSE between for an either/or offer, in
// canonical order (dd, debit, hold). A family is choosable when a row of that
// family is present AND the offerType permits it as a choice:
//   • dd    → present + DD-family offerType
//   • debit → present (a debit-family row; ties up no capital either way)
//   • hold  → present + offerType === 'new-funds-held' (ONLY new-funds-held can
//             put hold in the either/or; held-and-dd's hold is unconditional and
//             therefore never a choice — decision 7).
// Shared by pathState and the modal "How is this bonus met?" chooser so the two
// can never disagree. PURE. Design: 2026-07-13-requirements-driven-paths.md.
function choosablePaths(offer) {
  const o = offer || {};
  const fams = pathFamilyFlags(o);
  const hasDdType = o.offerType === 'direct-deposit' || o.offerType === 'held-and-dd';
  const out = [];
  if (fams.dd && hasDdType) out.push('dd');
  if (fams.debit) out.push('debit');
  if (fams.hold && o.offerType === 'new-funds-held') out.push('hold');
  return out;
}

// QUALIFICATION PATHS (2026-07-13, generalizing the 2026-07-11 either/or). THE
// single source of truth for "which requirement path(s) are active on this
// offer". Every capital / qualification / reminder consumer routes through this
// so the backward-compat rail is structural, not scattered. PURE; absent-safe.
// Availability derives from the offer's requirement ROWS via the family map
// (choosablePaths); plannedPath picks which choosable path is modeled.
//   requirementLogic 'all' (default/absent) → today's conjunctive semantics:
//     ddActive = DD-family offerType, debitActive = debitRequirement.required,
//     holdActive = (offerType !== 'direct-deposit') — the literal predicate every
//     held-lump consumer used pre-87ff38c (so a MISSING/unknown offerType still
//     takes the held branch). This reduces EXACTLY to the raw tests every existing
//     site used, so 'all' offers behave BYTE-IDENTICALLY.
//   requirementLogic 'any' → the bonus is met by ANY ONE choosable path:
//     with <2 choosable paths it degenerates to 'all' (never drops capital);
//     with ≥2, the chosen path activates only itself. held-and-dd's hold is
//     ALWAYS active (footprint, not a choice); only new-funds-held can activate
//     'hold' via the choice. plannedPath null (with ≥2 paths) → needsPath.
// Returns { logic, path, ddActive, debitActive, holdActive, needsPath, families }
// (families = present path families as a canonical-order array).
// Design: docs/assessments/2026-07-13-requirements-driven-paths.md.
function pathState(offer) {
  const o = offer || {};
  const hasDdType = o.offerType === 'direct-deposit' || o.offerType === 'held-and-dd';
  const hasDebitReq = !!(o.debitRequirement && o.debitRequirement.required);
  // Under logic 'all' every consumer that gated a held lump used the literal
  // predicate `offerType !== 'direct-deposit'` (withdrawal/hold dates, projection
  // lump block, reminders' fundsLump reminders.js:91-95, safe-to-close). That
  // predicate — NOT the HELD_LUMP_TYPES allow-list — is the byte-identity anchor:
  // a MISSING/unknown offerType (the legacy/seed case) took the held branch
  // pre-87ff38c, but the allow-list would drop it to holdActive:false. So compute
  // holdActive directly from the predicate. HELD_LUMP_TYPES stays the family-
  // detection allow-list (pathFamilyFlags) — only the enumerated types can seed
  // the hold family — but is deliberately NOT used to derive holdActive here.
  const hasHeldLump = o.offerType !== 'direct-deposit';
  const logic = o.requirementLogic === 'any' ? 'any' : 'all';
  // 'all' fast path (the overwhelming majority, and the entire beam-search hot
  // path): the active flags come straight from offerType/debitRequirement, so no
  // requirement-row scan is needed. `families` is only meaningful for the path
  // CHOOSER, which never renders for an 'all' offer — cold callers that want the
  // present set on an 'all' offer use offerPathFamilies() directly — so it is
  // intentionally left empty here to keep this path allocation-free.
  if (logic === 'all') {
    return {
      logic, path: null,
      ddActive: hasDdType, debitActive: hasDebitReq, holdActive: hasHeldLump,
      needsPath: false, families: []
    };
  }
  const fams = pathFamilyFlags(o);
  const familyArr = [];
  if (fams.dd) familyArr.push('dd');
  if (fams.debit) familyArr.push('debit');
  if (fams.hold) familyArr.push('hold');
  const choosable = choosablePaths(o);
  // Degenerate 'any' (fewer than two real choices) → fall back to 'all' semantics
  // so a mis-set flag can never spuriously strip a hold/DD from the capital model.
  if (choosable.length < 2) {
    return {
      logic, path: null,
      ddActive: hasDdType, debitActive: hasDebitReq, holdActive: hasHeldLump,
      needsPath: false, families: familyArr
    };
  }
  const path = choosable.includes(o.plannedPath) ? o.plannedPath : null;
  const holdUnconditional = o.offerType === 'held-and-dd' || o.offerType === 'other';
  return {
    logic, path,
    ddActive: path === 'dd',
    debitActive: path === 'debit',
    holdActive: holdUnconditional || (o.offerType === 'new-funds-held' && path === 'hold'),
    needsPath: path === null,
    families: familyArr
  };
}

// Is this requirement ROW active for the offer's chosen qualification path?
// Neutral rows (no family) and every row under logic 'all' are ALWAYS active.
// Under logic 'any', a dd/debit/hold row is active iff the matching path flag is.
// Drives the path-aware lifecycle filtering (checklist counts, requirement
// deadlines, reminders, allRequirementsDone). Byte-identical for 'all'. PURE.
function requirementActive(offer, row) {
  if (!row) return false;
  const fam = requirementPathFamily(row.type);
  if (!fam) return true;                       // neutral → always counts
  const ps = pathState(offer);
  if (ps.logic === 'all') return true;
  if (fam === 'dd') return ps.ddActive;
  if (fam === 'debit') return ps.debitActive;
  if (fam === 'hold') return ps.holdActive;
  return true;
}

// The bank WITHDRAWAL-ELIGIBILITY / hold-release date — the day the account
// first permits withdrawal (held types) or the qualifying DD round-trip
// completes (direct-deposit). For held types this is when the owner INITIATES
// the return ACH back to the hub; the money then LANDS `ddTransfer.backDays`
// business days later (see withdrawalEligibleDate below for the landing date).
// This IS the pre-2026-07-13 withdrawalEligibleDate body, extracted verbatim so
// the withdraw REMINDER — an action prompt ("go withdraw now") that must fire on
// the release date, NOT after the money has already landed — keeps its exact due
// date. Returns '' (DD debit-path / no DDs) or null (held with no anchor).
// The held/other bank hold-release DATE (or null) — the business-day-normalized
// day the hold lifts. Shared core so withdrawalInitiateDate and
// withdrawalEligibleDate avoid a string→Date round-trip on the beam-search hot
// path. HELD + DD and NEW FUNDS HELD share this hold model: a held lump sum
// (requiredFundingAmount) governed by daysFundsMustRemain from the chosen anchor;
// the qualifying DDs are modeled separately (see generateProjection) and do NOT
// drive the hold window. Anchor:
//   'open date'   → bank counts from the account open date (US Bank style). Open
//                   date itself stays as user-entered.
//   'funded date' → bank counts from when funds actually posted.
function _heldReleaseDate(offer) {
  const anchorRaw = offer.lockStartsFrom === 'open date'
    ? offer.plannedSignupDate
    : bizDayISO(effectiveFundingDate(offer));
  if (!anchorRaw || offer.daysFundsMustRemain == null) return null;
  return nextBusinessDay(addDays(parseDate(anchorRaw), Number(offer.daysFundsMustRemain)));
}

function withdrawalInitiateDate(offer, cfg) {
  // STANDARD direct deposit: no bank-imposed hold. Each DD just needs to
  // hit the account; the money is "tied up" only for its transfer round
  // trip. The overall "funds are fully back" date = the LATEST round-trip
  // return across all DDs. `cfg` is the ddTransfer model (optional — omitted
  // → live config via ddRoundTrip's default; the engine passes it explicitly).
  if (offer.offerType === 'direct-deposit') {
    // EITHER/OR: if the debit path is chosen, the DDs are not the way this bonus
    // is being met, so they tie up no capital → no hold (capital-back immediate).
    if (!pathState(offer).ddActive) return '';
    const rets = (offer.directDeposits || [])
      .map(dd => ddRoundTrip(dd, cfg))
      .filter(Boolean)
      .map(rt => rt.returnDate.getTime());
    if (rets.length === 0) return '';
    return isoDate(new Date(Math.max(...rets)));
  }
  // QUALIFICATION PATHS: the held lump models capital only when the hold path is
  // active. For logic='all' holdActive reduces to the held-lump offerType test,
  // so held/held-and-dd/other are unchanged; a debit-path new-funds-held (Brex
  // "hold OR card spend", card spend chosen) has holdActive=false → no hold, no
  // tied-up capital.
  if (!pathState(offer).holdActive) return '';
  const rel = _heldReleaseDate(offer);
  return rel ? isoDate(rel) : null;
}

// The CAPITAL-BACK (landing) date — the day the money is fully back in the hub
// account and SPENDABLE again. THE single source of truth every "capital back"
// surface and the day model's tied-up-interval END read (2026-07-13 hold-release
// transfer-lag fix; owner-confirmed intent: capital dispensed on ACTUAL deposit
// dates, so a plan whose held releases overlap same-day funding below the buffer
// is infeasible, not optimal).
//   • direct-deposit: the round-trip already returns funds to origin at
//     ddRoundTrip().returnDate (which bakes in backDays), so capital-back ==
//     withdrawalInitiateDate — NO double lag.
//   • held / held-and-dd / new-funds-held / other: the bank hold releases on the
//     withdrawal-ELIGIBILITY date (withdrawalInitiateDate); the owner then
//     initiates the return ACH and it LANDS `ddTransfer.backDays` BUSINESS days
//     later. Reuses the existing DD transfer-back leg — no new setting.
//     backDays=0 degenerates to the release date (pre-fix behavior).
// This makes held offers SYMMETRIC with DD: both return the landing date, and
// both are spendable ON that day in generateProjection's [start, landing)
// interval. The eligibility-vs-landing distinction is documented in
// projection-optimizer.js and docs/assessments/2026-07-13-hold-release-transfer-
// lag.md. `cfg` is the ddTransfer model (engine passes it explicitly; omitted →
// the live config via ddTransferConfig(), exactly like ddRoundTrip's default).
function withdrawalEligibleDate(offer, cfg) {
  // DD family: the round-trip already lands funds at returnDate (backDays baked
  // in), so capital-back == withdrawalInitiateDate — no double lag. Returns ''
  // for a debit-path / no-DD offer.
  if (offer.offerType === 'direct-deposit') return withdrawalInitiateDate(offer, cfg);
  // QUALIFICATION PATHS: no held lump when the hold path isn't active (debit-path
  // new-funds-held ties up no capital). Byte-identical for logic='all'.
  if (!pathState(offer).holdActive) return '';
  // Held/other: bank hold-release Date PLUS the return-transfer lag (backDays
  // business days). Compute the release as a Date directly (no string round-trip
  // — this is a beam-search hot path) and add the lag. Read cfg.backDays directly
  // when it's already a normalized engine object; else resolve via the live
  // config (undefined) or normalizeDdTransfer (partial) exactly like ddRoundTrip.
  const rel = _heldReleaseDate(offer);
  if (!rel) return null;
  const back = (cfg && Number.isFinite(cfg.backDays))
    ? cfg.backDays
    : normalizeDdTransfer(cfg == null ? ddTransferConfig() : cfg).backDays;
  return isoDate(back > 0 ? addBusinessDays(rel, back) : rel); // backDays=0 → landing == release
}

function lockStartDate(offer) {
  // STANDARD direct deposit: money first leaves the origin account at the
  // EARLIEST DD initiation. Each DD ties up its own amount over its own
  // round trip (modeled in generateProjection); this is just the start
  // of the overall tied-up window for display (card "Fund date",
  // timeline bar start).
  if (offer.offerType === 'direct-deposit') {
    // EITHER/OR: debit path chosen → DDs don't tie up capital, no start date.
    if (!pathState(offer).ddActive) return '';
    const starts = (offer.directDeposits || [])
      .map(dd => parseDate(dd.plannedDate))
      .filter(Boolean)
      .map(d => d.getTime());
    if (starts.length === 0) return '';
    return isoDate(new Date(Math.min(...starts)));
  }
  // HELD + DD and NEW FUNDS HELD: the held lump sum is unavailable from when
  // the bank PROCESSES the deposit (the planned funding date; Saturday-planned
  // funding won't post until Monday). The qualifying DDs are tracked
  // separately and don't move this date. QUALIFICATION PATHS: no lump start when
  // the hold path isn't active (debit-path new-funds-held); '' so the projection
  // lump block gets start=null and skips. Byte-identical for logic='all'.
  if (!pathState(offer).holdActive) return '';
  return bizDayISO(effectiveFundingDate(offer));
}

/* ============================================================
   STALE PRE-ACCOUNT SIGNUP → EFFECTIVE "TODAY" DATES (2026-07-13b)
   ============================================================
   Owner-directed: a PRE-ACCOUNT (prospect/selected — never-run) offer whose
   plannedSignupDate has slipped into the PAST should be modeled as if it were
   signed up TODAY, not left to drift historical/impossible. The whole date
   GROUP (signup + optionalPlannedFundingDate + directDeposits[].plannedDate)
   shifts forward by ONE calendar delta so signup lands on `todayISO`, preserving
   every internal offset — the exact P1-3 group-shift semantics the engine's
   materializeDirectDeposits uses (uniform addDays(delta); the model functions
   apply their own business-day normalization downstream). backDays / effective
   / hold math are untouched — they recompute from the shifted raw dates.

   NEVER shifts confirmed/open/historical offers — the eligible set is exactly
   HYPOTHETICAL_OFFER_STATUSES (status prospect/selected), the same partition the
   projection already uses for "hypothetical". EXPIRY COLLISION: if `todayISO` is
   strictly past offerExpirationDate the sign-up window has already passed — the
   offer is NOT advanced (windowPassed=true, surfaced as needs-attention on the
   card + the optimizer's no-valid-date-window review row), because signing up
   today would be impossible.

   THE single pure helper so projection / timeline / optimizer-input cannot
   disagree: every consumer maps its offers through effectiveOfferForToday (or the
   mapEffectiveOffers convenience) with the SAME todayISO reference. `offer` is the
   SAME reference when nothing changes — a cheap no-op for the overwhelming common
   case AND byte-identical projection behavior for every non-stale fixture (this is
   why the whole existing pin battery stays green untouched: their prospects sit
   on/after projectionStartDate, so the guard never fires).

   Returns { offer, shifted, windowPassed, deltaDays, originalSignupISO,
             targetSignupISO }.
   ============================================================ */
function isPreAccountOffer(offer) {
  // Hypothetical / never-run (prospect or selected). This is the SAME partition
  // generateProjection uses to bucket an offer as "hypothetical", so the shift
  // set and the projection's confirmed/hypothetical split never diverge.
  return !!(offer && HYPOTHETICAL_OFFER_STATUSES.has(offer.status));
}

function effectiveOfferForToday(offer, todayISO) {
  const sig = (offer && offer.plannedSignupDate) || '';
  const noShift = {
    offer, shifted: false, windowPassed: false, deltaDays: 0,
    originalSignupISO: sig, targetSignupISO: sig
  };
  if (!offer || !todayISO) return noShift;
  if (!isPreAccountOffer(offer)) return noShift;      // confirmed/open/historical → never
  const signup = parseDate(offer.plannedSignupDate);
  const today = parseDate(todayISO);
  if (!signup || !today) return noShift;
  if (signup >= today) return noShift;                // not stale (future or already today)
  // EXPIRY COLLISION: today is strictly past the expiration → do NOT advance
  // (an expiration exactly == today still permits signing up today).
  const exp = parseDate(offer.offerExpirationDate);
  if (exp && today > exp) {
    return { offer, shifted: false, windowPassed: true, deltaDays: 0,
             originalSignupISO: sig, targetSignupISO: sig };
  }
  const deltaDays = daysBetween(signup, today);       // positive calendar delta
  if (deltaDays <= 0) return noShift;
  const shiftISO = (iso) => { const d = parseDate(iso); return d ? isoDate(addDays(d, deltaDays)) : iso; };
  const eff = Object.assign({}, offer);
  eff.plannedSignupDate = shiftISO(offer.plannedSignupDate);   // == todayISO by construction
  if (offer.optionalPlannedFundingDate) eff.optionalPlannedFundingDate = shiftISO(offer.optionalPlannedFundingDate);
  if (Array.isArray(offer.directDeposits) && offer.directDeposits.length) {
    // Clone each DD preserving its id (feeds/consumers key on id) — only the
    // plannedDate moves. DDs without a planned date pass through untouched.
    eff.directDeposits = offer.directDeposits.map(dd => (dd && dd.plannedDate)
      ? Object.assign({}, dd, { plannedDate: shiftISO(dd.plannedDate) })
      : dd);
  }
  return { offer: eff, shifted: true, windowPassed: false, deltaDays,
           originalSignupISO: offer.plannedSignupDate, targetSignupISO: eff.plannedSignupDate };
}

// Convenience: map an offers array to its effective forms, returning the SAME
// array reference when nothing shifts (so a projection over a non-stale fixture
// allocates nothing and behaves byte-identically to the pre-feature code). The
// output array is materialized lazily on the FIRST shift, so the common no-shift
// case does zero allocation.
function mapEffectiveOffers(offers, todayISO) {
  if (!Array.isArray(offers) || !offers.length || !todayISO) return offers;
  let out = null;
  for (let i = 0; i < offers.length; i++) {
    const r = effectiveOfferForToday(offers[i], todayISO);
    if (r.offer !== offers[i]) {
      if (!out) out = offers.slice();   // lazy copy — only when something actually shifts
      out[i] = r.offer;
    }
  }
  return out || offers;
}

/* ============================================================
   ACCOUNT LIFECYCLE (F3) — a DERIVED VIEW over the existing status
   model (accountStatus/subStatus). Nothing here forks or stores new
   lifecycle state; every function reads the same fields the chips,
   selects, and projection already use. The 4-stage pipeline, the
   expected-bonus window, and safeToCloseDate are all pure projections.
   ============================================================ */

// When an offer has no bonus_post_min/max_days, the expected-bonus window
// falls back to this "typical" span (labeled as such in the UI so the user
// knows it's a heuristic, not a bank-stated figure). ~3–3.5 months is the
// common posting lag DoC reports for checking bonuses.
const DEFAULT_BONUS_POST_MIN_DAYS = 90;
const DEFAULT_BONUS_POST_MAX_DAYS = 105;

// The four pipeline stages, in order. 'inactive' is a fifth pseudo-stage for
// offers whose subStatus isn't on the earn path (prospect/applied/denied/
// didnt-track/archived) — the strip renders neutral and the chip carries the
// specifics. Closed always wins (a closed account is terminal regardless of sub).
const LIFECYCLE_STAGES = ['meeting', 'waiting', 'earned', 'closed'];
const LIFECYCLE_STAGE_LABELS = {
  meeting: 'Meeting Requirements',
  waiting: 'Waiting for Bonus',
  earned: 'Bonus Earned',
  closed: 'Closed'
};

// Map the (accountStatus, subStatus) pair onto a pipeline stage. DERIVED — never
// stored. Closed account → 'closed' (terminal). Otherwise by subStatus:
//   approved/on-track → meeting; met-waiting → waiting; earned → earned.
// Everything else (prospect/applied/denied/didnt-track/archived on an open or
// closed-pre-account state) → 'inactive' (neutral strip + chip carries detail).
function lifecycleStage(offer) {
  if (!offer) return 'inactive';
  if (offer.accountStatus === 'closed' && !PRE_ACCOUNT_SUB_STATUSES.has(offer.subStatus)) return 'closed';
  switch (offer.subStatus) {
    case 'approved':
    case 'on-track': return 'meeting';
    case 'met-waiting': return 'waiting';
    case 'earned': return 'earned';
    default: return 'inactive';
  }
}

// Human caption mirroring the current lifecycle context, shown under the strip.
// Returns '' for inactive so no nonsense caption appears for prospect/denied/etc.
function lifecycleCaption(offer) {
  const stage = lifecycleStage(offer);
  switch (stage) {
    case 'meeting': return 'Working toward the bonus — completing requirements.';
    case 'waiting': return 'Requirements met — waiting for the bonus to post.';
    case 'earned':
      return offer.bonus_received_date
        ? `Bonus received ${formatDateDisplay(offer.bonus_received_date)}.`
        : 'Bonus earned — safe to close once funds release.';
    case 'closed':
      return offer.closed_date
        ? `Account closed ${formatDateDisplay(offer.closed_date)}.`
        : 'Account closed.';
    default: return '';
  }
}

// Lifecycle (F3): keep offer.closed_date consistent with an account-status
// transition. SHARED by both status-change paths — the modal save
// (saveOfferFromForm/readOfferForm) and the inline offer-card "Offer status"
// dropdown (onChange 'change-status') — so the two can never drift.
//   • Reopen (prior closed → now open): the closure is void, so CLEAR any stale
//     closed_date. The churn step anchors on closed_date and must not read a
//     date from a closure that was undone.
//   • Close (now closed, non-pre-account): stamp closed_date if empty. Never
//     overwrites an existing date (a re-save of an already-closed offer keeps
//     the original close date).
// Mutates offer in place; no-op for a transition that isn't a close or reopen.
// `priorAccountStatus` is the offer's accountStatus BEFORE this change.
function reconcileClosedDate(offer, priorAccountStatus) {
  if (!offer) return;
  if (priorAccountStatus === 'closed' && offer.accountStatus === 'open') {
    offer.closed_date = null;
  } else if (offer.accountStatus === 'closed' && !PRE_ACCOUNT_SUB_STATUSES.has(offer.subStatus) && !offer.closed_date) {
    offer.closed_date = isoDate(TODAY);
  }
}

// True when EVERY requirement row (derived + user) on the offer is done. Drives
// the auto-suggest ("all requirements met — mark as Waiting?"). An offer with no
// requirement rows returns false — there's nothing to have completed, so we
// never nudge an offer that has no tracked obligations.
function allRequirementsDone(offer) {
  const reqs = Array.isArray(offer && offer.requirements) ? offer.requirements : [];
  // QUALIFICATION PATHS: an 'any' offer with NO path chosen (needsPath) has not
  // committed to how it's being met — only neutral rows are active, so completing
  // just those must NOT read as "all requirements met" and advance to met-waiting.
  // The owner must pick a path first. Byte-identical for 'all' (needsPath false).
  if (pathState(offer).needsPath) return false;
  // Under logic 'any' only the CHOSEN path's rows (plus neutral rows) count — a
  // non-chosen-family obligation you never intend to do must not block "all
  // requirements met". Byte-identical for 'all' (all active).
  const active = reqs.filter(r => requirementActive(offer, r));
  if (active.length === 0) return false;
  return active.every(r => r && r.done);
}

// Should the "mark as Waiting for Bonus?" suggestion show for this offer?
// Gate: the account is OPEN (a closed offer can't advance to met-waiting — the
// one-tap would land on stage 'closed', not 'waiting'), subStatus is still
// approved/on-track, ALL requirements are done, and the user hasn't dismissed it
// for this offer. No automatic status change — the tap does that. Kept as its
// own predicate so the card and modal agree.
function shouldSuggestWaiting(offer) {
  if (!offer) return false;
  if (offer.lifecycle_suggest_dismissed) return false;
  if (offer.accountStatus !== 'open') return false;
  if (offer.subStatus !== 'approved' && offer.subStatus !== 'on-track') return false;
  return allRequirementsDone(offer);
}

// The anchor date the expected-bonus window counts from: the LATEST done_date
// across requirement rows (the last obligation you completed is when the clock
// really starts). Returns { iso, estimated }:
//   • estimated:false when at least one row has a real done_date.
//   • estimated:true  when no row carries a done_date — we fall back to today so
//     a window still shows, flagged "estimated" in the UI.
// Returns null only when there are no requirement rows at all.
function bonusWindowAnchor(offer, today = TODAY) {
  const reqs = Array.isArray(offer && offer.requirements) ? offer.requirements : [];
  if (reqs.length === 0) return { iso: isoDate(today), estimated: true };
  let latest = null;
  for (const r of reqs) {
    // QUALIFICATION PATHS: a completed row on a NON-chosen ('any') path must not
    // anchor the expected-bonus window — its done_date is irrelevant to the path
    // actually being met, and a later dormant done_date would push the window /
    // safe-to-close months out. Only requirementActive rows anchor (neutral rows
    // stay active per decision 8). Byte-identical for 'all' (every row active).
    if (!requirementActive(offer, r)) continue;
    const d = r && r.done_date ? parseDate(r.done_date) : null;
    if (d && (!latest || d.getTime() > latest.getTime())) latest = d;
  }
  if (latest) return { iso: isoDate(latest), estimated: false };
  return { iso: isoDate(today), estimated: true };
}

// Expected-bonus posting window for an offer that has met its requirements.
// Returns { startISO, endISO, estimated, typical } or null when it doesn't
// apply (subStatus not met-waiting/earned) or can't be computed. `typical` flags
// the default-days fallback; `estimated` flags the today-anchor fallback.
//   window = [anchor + min, anchor + max], where anchor = latest done_date
//   (fallback today), min/max = bonus_post_min/max_days (fallback DEFAULT_*).
function expectedBonusWindow(offer, today = TODAY) {
  if (!offer) return null;
  const stage = lifecycleStage(offer);
  if (stage !== 'waiting' && stage !== 'earned') return null;
  const anchor = bonusWindowAnchor(offer, today);
  if (!anchor) return null;
  const anchorDate = parseDate(anchor.iso);
  if (!anchorDate) return null;
  const hasMin = offer.bonus_post_min_days != null && offer.bonus_post_min_days !== '';
  const hasMax = offer.bonus_post_max_days != null && offer.bonus_post_max_days !== '';
  const typical = !hasMin && !hasMax;
  let min = hasMin ? Number(offer.bonus_post_min_days) : DEFAULT_BONUS_POST_MIN_DAYS;
  let max = hasMax ? Number(offer.bonus_post_max_days) : DEFAULT_BONUS_POST_MAX_DAYS;
  if (!Number.isFinite(min)) min = DEFAULT_BONUS_POST_MIN_DAYS;
  if (!Number.isFinite(max)) max = DEFAULT_BONUS_POST_MAX_DAYS;
  if (max < min) { const t = min; min = max; max = t; } // tolerate reversed input
  return {
    startISO: isoDate(addDays(anchorDate, min)),
    endISO: isoDate(addDays(anchorDate, max)),
    estimated: anchor.estimated,
    typical
  };
}

// Latest of all applicable "you can safely close the account" constraints, as an
// ISO date, or null when insufficient data. Each term is null-safe; the result
// is the MAX (close only when EVERY constraint has passed). Terms:
//   (a) withdrawal-eligible date — funds are physically released (the legacy
//       `we` the stub already computed; models the hold/round-trip).
//   (b) bonus timing — if the bonus is already received (bonus_received_date),
//       that date; otherwise the expected-bonus window END (don't close before
//       the bonus is expected to post, or a late-posting bonus can be clawed).
//   (c) open-anchor + etf_window_days — an early-termination-fee avoidance
//       window measured from the account open date (plannedSignupDate).
//   (d) every UNMET requirement row's resolved deadline — don't call it safe
//       before an outstanding obligation's own deadline has passed. DONE rows are
//       excluded: a completed obligation's deadline is irrelevant to close-safety
//       (its date has served its purpose), and counting it would push safe-to-
//       close months past a real bonus_received_date for a long-deadline row.
// Returns ISO or null (never throws). Feed + card read this.
function safeToCloseDate(offer, cfg, today = TODAY) {
  if (!offer) return null;
  const candidates = [];

  // (a) withdrawal-eligible (funds released). cfg/today thread through so the
  // engine's horizon math is config- and clock-independent (defaults keep every
  // existing caller byte-stable).
  const we = withdrawalEligibleDate(offer, cfg);
  if (we) candidates.push(we);

  // (b) bonus timing.
  if (offer.bonus_received_date) {
    candidates.push(offer.bonus_received_date);
  } else {
    const win = expectedBonusWindow(offer, today);
    if (win && win.endISO) candidates.push(win.endISO);
  }

  // (c) ETF-avoidance window from the account open date.
  if (offer.etf_window_days != null && offer.etf_window_days !== '') {
    const days = Number(offer.etf_window_days);
    const open = parseDate(offer.plannedSignupDate);
    if (Number.isFinite(days) && open) candidates.push(isoDate(addDays(open, days)));
  }

  // (d) every UNMET requirement deadline (done rows don't constrain close-safety).
  const reqs = Array.isArray(offer.requirements) ? offer.requirements : [];
  for (const r of reqs) {
    if (!r || r.done) continue;
    // QUALIFICATION PATHS: a non-chosen-path obligation's deadline doesn't
    // constrain close-safety (you're not doing it). Byte-identical for 'all'.
    if (!requirementActive(offer, r)) continue;
    const dlISO = requirementDeadlineISO(offer, r);
    if (dlISO) candidates.push(dlISO);
  }

  if (candidates.length === 0) return null;
  // MAX by ISO date (YYYY-MM-DD sorts lexicographically == chronologically).
  let maxISO = candidates[0];
  for (const c of candidates) { if (c > maxISO) maxISO = c; }
  return maxISO;
}

/* ============================================================
   CHURNABILITY (F6)
   ============================================================
   An offer marked churnable can be re-run after a cooling-off period.
   churnEligibleDate() resolves the anchor date per churn_anchor, adds
   churn_wait_months (calendar-month-safe, clamped), and returns the ISO
   date the account can be opened again. The card, the Overview "Upcoming
   churn dates" section, and the `churn-eligible` feed kind all read this. */
// How far ahead the Overview churn section looks for "Upcoming" eligibility.
const CHURN_HORIZON_DAYS = 60;
// Feed emit window: emit `churn-eligible` when the eligible date is at most this
// many days AHEAD (upcoming) ...
const CHURN_FEED_LOOKAHEAD_DAYS = 60;
// ... OR already past but within this many days behind (still actionable — you
// can churn now — without resurrecting ancient history).
const CHURN_FEED_PAST_GRACE_DAYS = 180;

// Human label for each anchor, reused by the modal, card, overview, and feed.
const CHURN_ANCHOR_LABELS = {
  bonus_received: 'bonus received',
  account_closed: 'account closed',
  account_opened: 'account opened'
};

// The ISO anchor date churn eligibility counts from, per churn_anchor:
//   • bonus_received → bonus_received_date
//   • account_closed → closed_date
//   • account_opened → plannedSignupDate (the SAME open-date source the
//     lifecycle/deadline math uses — no separate "opened" field exists)
// Returns an ISO string or '' when the relevant date isn't set. Defaults to the
// bonus_received anchor for an unknown/missing churn_anchor.
function churnAnchorDate(offer) {
  if (!offer) return '';
  switch (offer.churn_anchor) {
    case 'account_closed': return offer.closed_date || '';
    case 'account_opened': return offer.plannedSignupDate || '';
    case 'bonus_received':
    default: return offer.bonus_received_date || '';
  }
}

// The ISO date an offer becomes churn-eligible again, or null. Returns null when
// the offer isn't churnable (churnable !== true), the wait-months is missing/
// non-positive, or the anchor date for its churn_anchor isn't set yet. Pure;
// never throws (all date access is guarded, month-add is clamp-safe).
function churnEligibleDate(offer) {
  if (!offer || offer.churnable !== true) return null;
  const months = Number(offer.churn_wait_months);
  if (!Number.isFinite(months) || months <= 0) return null;
  const anchorISO = churnAnchorDate(offer);
  const anchor = parseDate(anchorISO);
  if (!anchor) return null;
  const eligible = addMonthsClamped(anchor, months);
  if (!eligible) return null;
  return isoDate(eligible);
}

// Does this offer represent a GENUINELY COMPLETED (or in-progress) prior run —
// an account that was actually opened? Churn is a RE-run: it presupposes a real
// prior account. A pre-account prospect/applied has never been opened (its
// accountStatus is auto-set to 'closed' meaning "not opened yet", NOT a real
// post-open closure), and a denied application never opened either — so NEITHER
// is a churn re-run source; each is an ordinary new-account candidate. Used by
// the optimizer's churn synthesis, the Offers "needs info" chip, and the
// lifecycle churn row so all three agree on when a churn anchor date is genuinely
// owed (owner-directed 2026-07-10). Pure; tolerant of legacy single-field offers.
function hasGenuinePriorRun(offer) {
  if (!offer) return false;
  if (offer.accountStatus === 'open') return true;                       // holds the account now → opened
  if (offer.subStatus) return !PRE_ACCOUNT_SUB_STATUSES.has(offer.subStatus) && offer.subStatus !== 'denied';
  return offer.status === 'funded' || offer.status === 'completed';      // legacy single-field fallback
}

// The ISO date a churnable offer would become churn-eligible AGAIN after THIS
// plan schedules it — the throughput signal for the plan-ordering tie-breaker
// (how soon the offer can be cycled again). HONORS the offer's churn_anchor: an
// `account_opened` offer measures the wait from its (plan-scheduled) sign-up
// date, so `churnEligibleDate` already returns the correct next-cycle date once
// the plan sets plannedSignupDate — reuse it verbatim rather than assuming the
// capital-free date. Only when the configured anchor date isn't derivable from
// the plan-scheduled offer (a fresh prospect has no bonus_received / closed date
// yet, so a `bonus_received` / `account_closed` anchor yields null) do we fall
// back to the withdrawal-eligible (capital-free) date + churn_wait_months as the
// stable, deterministic proxy for when this cycle wraps up. Returns null for a
// non-churnable offer, a missing/non-positive wait, or an undatable completion,
// so a plan with no churnables contributes an empty vector and is never
// penalized. Pure; reuses the same clamp-safe month add as churnEligibleDate.
function churnNextEligibleAfterPlan(offer, cfg) {
  if (!offer || offer.churnable !== true) return null;
  const months = Number(offer.churn_wait_months);
  if (!Number.isFinite(months) || months <= 0) return null;
  const anchored = churnEligibleDate(offer);
  if (anchored) return anchored;
  const complete = parseDate(withdrawalEligibleDate(offer, cfg));
  if (!complete) return null;
  const next = addMonthsClamped(complete, months);
  return next ? isoDate(next) : null;
}

// Whether an offer's churn is currently snoozed. True when churn_snoozed_until
// is the sentinel 'forever' OR an ISO date strictly after today. A TIMED snooze
// whose date is today-or-earlier has lapsed and reads as NOT snoozed — the
// comparison alone handles expiry, so no cleanup migration is ever needed.
// Pure; tolerant of a missing/garbage value (returns false). The Overview
// section, the card churn line, and the `churn-eligible` feed kind all read
// this so snooze state can never diverge between surfaces.
function churnSnoozeActive(offer, today = TODAY) {
  if (!offer) return false;
  const s = offer.churn_snoozed_until;
  if (s === 'forever') return true;
  if (typeof s !== 'string' || !s) return false;
  const d = parseDate(s);
  if (!d) return false;
  return d.getTime() > today.getTime();
}

function simpleReturn(offer) {
  if (!offer.requiredFundingAmount || !offer.signupBonusAmount) return null;
  return offer.signupBonusAmount / offer.requiredFundingAmount;
}

// Total capital-time (dollar-days) a DD offer ties up: Σ(amount_i × heldDays_i).
// STANDARD DD: heldDays_i = the transfer round-trip for that DD (which is
// longer when initiated before a weekend/holiday). HELD+DD: each DD's
// amount is held from when it lands until the shared withdrawal-eligible
// date. Returns { dollarDays, weightedDays, totalAmount } or null.
function ddCapitalTime(offer, cfg) {
  // EITHER/OR: when the DD path isn't the active one, its deposits tie up no
  // capital-time. For logic='all' `ddActive` reduces to the DD-family test, so
  // `dds` is byte-identical to the old filter and behavior is unchanged.
  const ddActive = pathState(offer).ddActive;
  const dds = ddActive
    ? (offer.directDeposits || []).filter(dd => dd && dd.plannedDate && Number(dd.amount) > 0)
    : [];
  if (dds.length === 0) {
    // With no active DDs, only a held-and-dd's held lump can still tie up capital.
    if (!(offer.offerType === 'held-and-dd' && Number(offer.requiredFundingAmount) > 0)) return null;
  }
  let dollarDays = 0, totalAmount = 0;
  if (offer.offerType === 'direct-deposit') {
    for (const dd of dds) {
      const rt = ddRoundTrip(dd, cfg);
      if (!rt || rt.heldDays <= 0) continue;
      const amt = Number(dd.amount);
      dollarDays += amt * rt.heldDays;
      totalAmount += amt;
    }
  } else { // held-and-dd
    const we = parseDate(withdrawalEligibleDate(offer, cfg));
    if (!we) return null;
    // Held lump sum: requiredFundingAmount from the funding date → withdrawal.
    const fundStart = parseDate(lockStartDate(offer));
    const fundAmt = Number(offer.requiredFundingAmount) || 0;
    if (fundStart && fundAmt > 0) {
      const heldDays = daysBetween(fundStart, we);
      if (heldDays > 0) { dollarDays += fundAmt * heldDays; totalAmount += fundAmt; }
    }
    // Each qualifying DD from when it lands → withdrawal.
    for (const dd of dds) {
      const eff = parseDate(directDepositEffectiveDate(dd));
      if (!eff) continue;
      const held = daysBetween(eff, we);
      if (held <= 0) continue;
      const amt = Number(dd.amount);
      dollarDays += amt * held;
      totalAmount += amt;
    }
  }
  if (dollarDays <= 0 || totalAmount <= 0) return null;
  return { dollarDays, totalAmount, weightedDays: dollarDays / totalAmount };
}

function annualizedReturn(offer, cfg) {
  const bonus = Number(offer.signupBonusAmount);
  if (!bonus || bonus < 0) {
    // Allow $0 bonus to yield 0% rather than null below; but a missing
    // bonus is a null.
    if (offer.signupBonusAmount == null) return null;
  }
  // DIRECT-DEPOSIT family: weight each DD's ROI by dollar-days (amount ×
  // days held) so a DD dragged longer by a weekend/holiday, or a bigger
  // DD, pulls the blended rate appropriately. The single closed form
  //   bonus × 365 / Σ(amount_i × heldDays_i)
  // is exactly the amount-and-time-weighted average of the per-DD
  // annualized ROIs, and reduces to the standard formula for one DD.
  if (offer.offerType === 'direct-deposit' || offer.offerType === 'held-and-dd') {
    const ct = ddCapitalTime(offer, cfg);
    if (!ct || !offer.signupBonusAmount) return null;
    return Number(offer.signupBonusAmount) * 365 / ct.dollarDays;
  }
  // NEW FUNDS HELD: annualize on actual days unavailable (business-day
  // aware lockStart → withdrawalEligible), matching the "Days tied up"
  // card stat. Fall back to the stated hold count when dates are absent.
  // QUALIFICATION PATHS: a debit-path new-funds-held ties up no held capital, so
  // an annualized-on-hold figure is meaningless → null. Byte-identical for 'all'.
  if (!pathState(offer).holdActive) return null;
  const r = simpleReturn(offer);
  if (r == null) return null;
  let days = null;
  const ls = parseDate(lockStartDate(offer));
  const we = parseDate(withdrawalEligibleDate(offer, cfg));
  if (ls && we) days = daysBetween(ls, we);
  if (!days || days <= 0) days = Number(offer.daysFundsMustRemain) || 0;
  if (!days || days <= 0) return null;
  return r * 365 / days;
}

function isOfferComplete(offer) {
  // Standard direct deposit has NO bank-imposed hold, so it does not
  // require daysFundsMustRemain. Every other type does.
  const isStandardDD = offer.offerType === 'direct-deposit';
  const ps = pathState(offer);
  // EITHER/OR: a held lump (requiredFundingAmount) is only required when the DD
  // path is active or the type has an inherent held lump. A pure debit-path DD
  // offer (Brex "spend OR direct-deposit", debit chosen) has no held lump, so
  // requiredFundingAmount need not be > 0. For logic='all' `ddActive` reduces to
  // the DD-family test, so DD/held offers still require funding exactly as before.
  const needsFunding = ps.ddActive
    || offer.offerType === 'new-funds-held' || offer.offerType === 'held-and-dd';
  // Planned sign-up date is REQUIRED only once the account is OPEN (a
  // committed offer must be dated). A prospect/applied offer (account
  // closed) is a full non-draft offer WITHOUT a sign-up date — it simply
  // emits no dated work items and ties up no projected capital until a
  // date is added. The sign-up date alone therefore no longer forces
  // draft status; other missing required fields still draft the offer.
  const signupDateOk = offer.accountStatus !== 'open'
    || Boolean(offer.plannedSignupDate && parseDate(offer.plannedSignupDate));
  const baseOk = Boolean(
    offer.bankName &&
    (!needsFunding || offer.requiredFundingAmount > 0) &&
    offer.signupBonusAmount >= 0 &&
    signupDateOk &&
    (isStandardDD || (offer.daysFundsMustRemain != null && offer.daysFundsMustRemain >= 0))
  );
  if (!baseOk) return false;
  // EITHER/OR: require the scheduled DDs only when the DD path is active (a
  // debit-path offer keeps its DD rows for reference but need not have any).
  if (ps.ddActive) {
    const ddsOk = Array.isArray(offer.directDeposits)
      && offer.directDeposits.length > 0
      && offer.directDeposits.every(dd =>
        dd && dd.plannedDate && parseDate(dd.plannedDate) && Number(dd.amount) > 0);
    if (!ddsOk) return false;
  }
  // Held + DD: the held lump sum needs a funding date (it drives the chart +
  // hold window) regardless of the chosen path. Standard DD has no held lump.
  if (offer.offerType === 'held-and-dd'
    && !(offer.optionalPlannedFundingDate && parseDate(offer.optionalPlannedFundingDate))) return false;
  return true;
}

function offerIssues(offer) {
  const issues = [];
  const isStandardDD = offer.offerType === 'direct-deposit';
  const ps = pathState(offer);
  const needsFunding = ps.ddActive
    || offer.offerType === 'new-funds-held' || offer.offerType === 'held-and-dd';
  if (!offer.bankName) issues.push('Bank name is required');
  if (needsFunding && (!offer.requiredFundingAmount || offer.requiredFundingAmount <= 0)) issues.push('Required funding amount must be > 0');
  if (offer.signupBonusAmount == null || offer.signupBonusAmount < 0) issues.push('Bonus amount required');
  // Sign up date only required when the account is open (committed offers
  // must be dated); prospects/applied may be full offers without a date.
  if (offer.accountStatus === 'open' && (!offer.plannedSignupDate || !parseDate(offer.plannedSignupDate))) issues.push('Sign up date required');
  if (!isStandardDD && (offer.daysFundsMustRemain == null || offer.daysFundsMustRemain < 0)) issues.push('Hold-through day is required');
  if (ps.ddActive) {
    if (!Array.isArray(offer.directDeposits) || offer.directDeposits.length === 0) {
      issues.push('At least one direct deposit is required');
    } else if (!offer.directDeposits.every(dd => dd && dd.plannedDate && parseDate(dd.plannedDate) && Number(dd.amount) > 0)) {
      issues.push('Each direct deposit needs a date and amount > 0');
    }
  }
  if (offer.offerType === 'held-and-dd'
    && !(offer.optionalPlannedFundingDate && parseDate(offer.optionalPlannedFundingDate))) {
    issues.push('Planned funding date is required for Held + DD');
  }
  return issues;
}

function offerIsActiveForProjection(offer, includedOverride = null) {
  // Returns whether this offer should affect the projection.
  if (!isOfferComplete(offer)) return false;
  if (offer.status === 'completed' || offer.status === 'skipped') return false;
  if (includedOverride !== null) return includedOverride.has(offer.id);
  if (CONFIRMED_OFFER_STATUSES.has(offer.status)) return true;
  return Boolean(offer.includeInScenario);
}

export { effectiveFundingDate, bizDayISO, depositDeadline, debitDeadlineISO, pathState, choosablePaths, offerPathFamilies, requirementActive, withdrawalEligibleDate, withdrawalInitiateDate, lockStartDate, isPreAccountOffer, effectiveOfferForToday, mapEffectiveOffers, DEFAULT_BONUS_POST_MIN_DAYS, DEFAULT_BONUS_POST_MAX_DAYS, LIFECYCLE_STAGES, LIFECYCLE_STAGE_LABELS, lifecycleStage, lifecycleCaption, reconcileClosedDate, allRequirementsDone, shouldSuggestWaiting, bonusWindowAnchor, expectedBonusWindow, safeToCloseDate, CHURN_HORIZON_DAYS, CHURN_FEED_LOOKAHEAD_DAYS, CHURN_FEED_PAST_GRACE_DAYS, CHURN_ANCHOR_LABELS, churnAnchorDate, churnEligibleDate, hasGenuinePriorRun, churnNextEligibleAfterPlan, churnSnoozeActive, simpleReturn, ddCapitalTime, annualizedReturn, isOfferComplete, offerIssues, offerIsActiveForProjection };
