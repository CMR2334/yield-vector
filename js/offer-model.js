import { TODAY, addDays, addMonthsClamped, daysBetween, formatDateDisplay, isoDate, nextBusinessDay, parseDate } from './date-format-core.js';
import { ddRoundTrip, directDepositEffectiveDate } from './dd-core.js';
import { requirementDeadlineISO } from './requirements-templates.js';
import { CONFIRMED_OFFER_STATUSES, PRE_ACCOUNT_SUB_STATUSES } from './runtime-status.js';
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

function withdrawalEligibleDate(offer, cfg) {
  // STANDARD direct deposit: no bank-imposed hold. Each DD just needs to
  // hit the account; the money is "tied up" only for its transfer round
  // trip. The overall "funds are fully back" date = the LATEST round-trip
  // return across all DDs. `cfg` is the ddTransfer model (optional — omitted
  // → live config via ddRoundTrip's default; the engine passes it explicitly).
  if (offer.offerType === 'direct-deposit') {
    const rets = (offer.directDeposits || [])
      .map(dd => ddRoundTrip(dd, cfg))
      .filter(Boolean)
      .map(rt => rt.returnDate.getTime());
    if (rets.length === 0) return '';
    return isoDate(new Date(Math.max(...rets)));
  }
  // HELD + DD and NEW FUNDS HELD share the same hold model: a held lump sum
  // (requiredFundingAmount) governed by daysFundsMustRemain from the chosen
  // anchor. The qualifying DDs are modeled separately (see generateProjection);
  // they do NOT drive the hold window. Anchor:
  //   'open date'   → bank counts from the account open date (US Bank
  //                   style). Open date itself stays as user-entered.
  //   'funded date' → bank counts from when funds actually posted.
  const anchorRaw = offer.lockStartsFrom === 'open date'
    ? offer.plannedSignupDate
    : bizDayISO(effectiveFundingDate(offer));
  if (!anchorRaw || offer.daysFundsMustRemain == null) return null;
  const calc = addDays(parseDate(anchorRaw), Number(offer.daysFundsMustRemain));
  return bizDayISO(calc);
}

function lockStartDate(offer) {
  // STANDARD direct deposit: money first leaves the origin account at the
  // EARLIEST DD initiation. Each DD ties up its own amount over its own
  // round trip (modeled in generateProjection); this is just the start
  // of the overall tied-up window for display (card "Fund date",
  // timeline bar start).
  if (offer.offerType === 'direct-deposit') {
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
  // separately and don't move this date.
  return bizDayISO(effectiveFundingDate(offer));
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
  if (reqs.length === 0) return false;
  return reqs.every(r => r && r.done);
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
  const dds = (offer.directDeposits || []).filter(dd => dd && dd.plannedDate && Number(dd.amount) > 0);
  if (dds.length === 0) return null;
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
    offer.requiredFundingAmount > 0 &&
    offer.signupBonusAmount >= 0 &&
    signupDateOk &&
    (isStandardDD || (offer.daysFundsMustRemain != null && offer.daysFundsMustRemain >= 0))
  );
  if (!baseOk) return false;
  if (offer.offerType === 'direct-deposit' || offer.offerType === 'held-and-dd') {
    const ddsOk = Array.isArray(offer.directDeposits)
      && offer.directDeposits.length > 0
      && offer.directDeposits.every(dd =>
        dd && dd.plannedDate && parseDate(dd.plannedDate) && Number(dd.amount) > 0);
    if (!ddsOk) return false;
    // Held + DD: the held lump sum needs a funding date (it drives the
    // chart + hold window). Standard direct-deposit has no held lump sum.
    if (offer.offerType === 'held-and-dd'
      && !(offer.optionalPlannedFundingDate && parseDate(offer.optionalPlannedFundingDate))) return false;
    return true;
  }
  return true;
}

function offerIssues(offer) {
  const issues = [];
  const isStandardDD = offer.offerType === 'direct-deposit';
  if (!offer.bankName) issues.push('Bank name is required');
  if (!offer.requiredFundingAmount || offer.requiredFundingAmount <= 0) issues.push('Required funding amount must be > 0');
  if (offer.signupBonusAmount == null || offer.signupBonusAmount < 0) issues.push('Bonus amount required');
  // Sign up date only required when the account is open (committed offers
  // must be dated); prospects/applied may be full offers without a date.
  if (offer.accountStatus === 'open' && (!offer.plannedSignupDate || !parseDate(offer.plannedSignupDate))) issues.push('Sign up date required');
  if (!isStandardDD && (offer.daysFundsMustRemain == null || offer.daysFundsMustRemain < 0)) issues.push('Hold-through day is required');
  if (offer.offerType === 'direct-deposit' || offer.offerType === 'held-and-dd') {
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

export { effectiveFundingDate, bizDayISO, depositDeadline, debitDeadlineISO, withdrawalEligibleDate, lockStartDate, DEFAULT_BONUS_POST_MIN_DAYS, DEFAULT_BONUS_POST_MAX_DAYS, LIFECYCLE_STAGES, LIFECYCLE_STAGE_LABELS, lifecycleStage, lifecycleCaption, reconcileClosedDate, allRequirementsDone, shouldSuggestWaiting, bonusWindowAnchor, expectedBonusWindow, safeToCloseDate, CHURN_HORIZON_DAYS, CHURN_FEED_LOOKAHEAD_DAYS, CHURN_FEED_PAST_GRACE_DAYS, CHURN_ANCHOR_LABELS, churnAnchorDate, churnEligibleDate, churnSnoozeActive, simpleReturn, ddCapitalTime, annualizedReturn, isOfferComplete, offerIssues, offerIsActiveForProjection };
