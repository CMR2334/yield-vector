import { TODAY, addDays, daysBetween, expandEventInstances, isoDate, parseDate, startOfDay, uid } from './date-format-core.js';
import { ddRoundTrip, directDepositEffectiveDate, normalizeDdTransfer } from './dd-core.js';
import { CONFIRMED_OFFER_STATUSES, HYPOTHETICAL_OFFER_STATUSES } from './runtime-status.js';
import { allRequirementsDone, annualizedReturn, bonusWindowAnchor, ddCapitalTime, effectiveOfferForToday, isOfferComplete, lockStartDate, mapEffectiveOffers, offerIsActiveForProjection, pathState, safeToCloseDate, shouldSuggestWaiting, withdrawalEligibleDate, withdrawalInitiateDate } from './offer-model.js';
import { offerDisplayLabel, offerToTemplate, templateToOffer } from './requirements-templates.js';
/* ============================================================
   PROJECTION ENGINE
   ============================================================
   Generates a daily cash projection over the configured horizon.

   For each day in [projectionStartDate, projectionStartDate + horizonDays):
     availableCapital =
         currentLiquidCapital
       + cumulative net of all included Capital Events with date <= day
       - sum of confirmed commitments active on this day
       - sum of hypothetical commitments active on this day

   Interval convention:
     A commitment with startDate=A and endDate=B ties up funds on each day d
     where A <= d < B — so the funds are SPENDABLE ON day B. B is the
     CAPITAL-BACK (landing) date: the day the money is back in the hub account
     (withdrawalEligibleDate). For held offers that is the bank hold-release date
     PLUS the return-transfer lag (ddTransfer.backDays business days); for DDs it
     is the round-trip returnDate (backDays already baked in). This makes held
     and DD symmetric: capital an offer releases is not spendable the same day it
     becomes withdrawal-eligible, only the day it actually LANDS back (2026-07-13
     hold-release transfer-lag fix — no same-day optimistic netting).

   Sources of commitments:
     1. Manual/explicit Capital Commitments (with includeInProjection true).
     2. Bonus Offers that are considered active:
        - status in {applied, funded} → counted as confirmed
        - status in {prospect, selected} with includeInScenario → counted
          as hypothetical
        Suppressed if a non-cancelled commitment with sourceBonusOfferId
        already covers the offer.

   The optimizer can pass an `includedOfferIds` set to override which
   prospect/selected offers contribute (used to evaluate combinations).
   ============================================================ */
// Compute the effective projection horizon in days based on the user's
// chosen mode. 'auto' = 30 days past the latest active date in the system
// (commitment ends, withdrawal-eligible dates, included events), with a
// 30-day floor. Modes other than 'custom' are fixed-day shorthands.
function effectiveHorizonDays(state) {
  const settings = state.settings || {};
  const mode = settings.projectionHorizonMode || 'auto';
  const start = parseDate(settings.projectionStartDate) || TODAY;
  if (mode === '3months') return 90;
  if (mode === '6months') return 180;
  if (mode === '1year') return 365;
  if (mode === '2years') return 730;
  if (mode === 'custom') return Math.max(30, Math.min(1825, Number(settings.projectionHorizonDays) || 365));
  // 'auto' — exactly 30 days past the latest withdrawal-eligible date of
  // offers that are ACTIVE in the projection. Confirmed offers count
  // unconditionally; unconfirmed offers (prospect/selected) only count
  // if the user has checked includeInScenario. This matches what's
  // actually plotted on the chart, so the X-axis can't extend out to
  // some prospect offer the user hasn't opted in to.
  // Hard clamp: end = lastActionDate + 30 days. No baseline padding,
  // no extra fudge factor anywhere. If no active offer, 30-day floor.
  let lastAction = null;
  const debug = [];
  // Feature 2 (2026-07-13b): stale pre-account signups are horizon-scanned at
  // their EFFECTIVE (treated-as-today) dates so the auto horizon covers where a
  // stale prospect actually lands, matching generateProjection. No-op (same
  // array ref) for every non-stale offer set. See offer-model.effectiveOfferForToday.
  const effToday = settings.projectionStartDate || isoDate(TODAY);
  for (const o of mapEffectiveOffers(state.offers || [], effToday)) {
    if (!offerIsActiveForProjection(o)) continue;
    const we = withdrawalEligibleDate(o);
    const d = we ? parseDate(we) : null;
    if (d && (lastAction == null || d > lastAction)) lastAction = d;
    if (d) debug.push({ id: o.id, status: o.status, withdrawal: we });
  }
  // Expose for inspection from the console: App.state && window._horizonDebug
  if (typeof window !== 'undefined') window._horizonDebug = { lastAction, considered: debug };
  if (!lastAction) return 30;
  const days = daysBetween(start, addDays(lastAction, 30));
  return Math.max(30, Math.min(180, days));
}

function generateProjection(state, options = {}) {
  const settings = state.settings;
  // Feature 2 (2026-07-13b): model stale PRE-ACCOUNT (prospect/selected) signups
  // as if signed up TODAY (effective dates) so a slipped prospect stops distorting
  // the current-state curve. Keyed on the projection's own "now" —
  // projectionStartDate (auto-rolled to today live via rollProjectionStartIfStale;
  // set explicitly by pins) — so it is DETERMINISTIC and NEVER fires for a fixture
  // whose prospects sit on/after that date (every existing feasibility/optimizer
  // pin), keeping the whole battery byte-identical. mapEffectiveOffers returns the
  // SAME array ref when nothing shifts, so we only clone `state` when it matters.
  const effToday = (settings && settings.projectionStartDate) || isoDate(TODAY);
  const rawOffers = state.offers || [];
  const effOffers = mapEffectiveOffers(rawOffers, effToday);
  if (effOffers !== rawOffers) state = Object.assign({}, state, { offers: effOffers });
  // C3: the optimizer passes an explicit horizon that covers the evaluated
  // combo's full capital-lock life (see optimizerHorizonForState). EVERY other
  // caller omits options.horizonDays and gets the user's configured horizon
  // exactly as before — zero behavior change outside runOptimizer.
  const horizon = (Number.isFinite(options.horizonDays) && options.horizonDays > 0)
    ? Math.floor(options.horizonDays)
    : effectiveHorizonDays(state);
  const start = parseDate(settings.projectionStartDate) || TODAY;
  const buffer = Number(settings.minimumCashBuffer) || 0;
  const liquid = Number(settings.currentLiquidCapital) || 0;

  const includedOverride = options.includedOfferIds
    ? new Set(options.includedOfferIds)
    : null;
  const earlyExit = options.earlyExit || false;
  // C1/C4: the optimizer engine passes an explicit ddTransfer so DD round-trip
  // timing is evaluated faithfully against a variant config. EVERY other caller
  // omits it → cfg is undefined → ddRoundTrip/withdrawalEligibleDate fall back to
  // the live config exactly as before (zero behavior change outside the engine).
  const cfg = options.ddTransfer;

  // Pre-build day skeleton
  const days = new Array(horizon);
  const dayMs = 86400000;
  const startMs = start.getTime();
  for (let i = 0; i < horizon; i++) {
    days[i] = {
      date: new Date(startMs + i * dayMs),
      dateISO: '',
      dayIndex: i,
      startingLiquidCapital: liquid,
      confirmedTiedUp: 0,
      hypotheticalTiedUp: 0,
      totalTiedUp: 0,
      netEventsToDate: 0,
      availableCapital: liquid,
      belowBuffer: false,
      shortfall: false
    };
  }

  // Helper: find day index for a Date (clamped)
  function indexFor(date) {
    if (!date) return -1;
    const idx = Math.floor((startOfDay(date).getTime() - startMs) / dayMs);
    return idx;
  }

  // Helper: apply a commitment over its active range
  function applyCommitment(amount, startDate, endDate, kind) {
    const sIdx = indexFor(startDate);
    const eIdx = indexFor(endDate);
    if (eIdx < 0) return; // ends before horizon starts
    if (sIdx >= horizon) return; // starts after horizon ends
    // Active days: [max(sIdx,0), min(eIdx, horizon)) — endDate exclusive
    const from = Math.max(sIdx, 0);
    const to = Math.min(eIdx, horizon);
    for (let i = from; i < to; i++) {
      if (kind === 'confirmed') days[i].confirmedTiedUp += amount;
      else days[i].hypotheticalTiedUp += amount;
    }
  }

  // 1. Manual capital commitments
  const offerIdsWithCommitments = new Set();
  for (const c of state.commitments) {
    if (!c.includeInProjection) continue;
    if (c.status === 'cancelled') continue;
    const amount = Number(c.amount);
    if (!amount || amount <= 0) continue;
    const cs = parseDate(c.startDate);
    const ce = parseDate(c.endDate);
    if (!cs || !ce || cs >= ce) continue;
    if (c.sourceBonusOfferId) offerIdsWithCommitments.add(c.sourceBonusOfferId);
    const kind = (c.status === 'confirmed' || c.status === 'completed') ? 'confirmed' : 'hypothetical';
    if (c.status === 'completed') continue; // completed commitments no longer tie up funds
    applyCommitment(amount, cs, ce, kind);
  }

  // 2. Virtual commitments from bonus offers
  for (const o of state.offers) {
    if (!offerIsActiveForProjection(o, includedOverride)) continue;
    if (offerIdsWithCommitments.has(o.id)) continue; // suppressed by explicit commitment
    const kind = CONFIRMED_OFFER_STATUSES.has(o.status) ? 'confirmed' : 'hypothetical';
    // EITHER/OR: which requirement path this offer is being met by. For
    // logic='all' `ddActive` reduces to the DD-family test, so the capital model
    // is byte-identical to before. When the debit path is chosen, the DD legs
    // are not applied (card spend ties up no capital), and a pure direct-deposit
    // offer then contributes nothing (lockStart/withdrawalEligible return '').
    const ps = pathState(o);
    // STANDARD direct deposit: each DD ties up its own amount only for
    // its transfer round trip (initiation → return to origin). No shared
    // hold — money is out of the origin account exactly while in transit
    // + seasoning. DDs initiated before weekends/holidays tie up longer.
    if (o.offerType === 'direct-deposit' && ps.ddActive && Array.isArray(o.directDeposits) && o.directDeposits.length > 0) {
      for (const dd of o.directDeposits) {
        const rt = ddRoundTrip(dd, cfg);
        const amt = Number(dd.amount) || 0;
        if (!rt || amt <= 0) continue;
        if (rt.initiate >= rt.returnDate) continue;
        applyCommitment(amt, rt.initiate, rt.returnDate, kind);
      }
      continue;
    }
    // HELD + DD: two distinct capital commitments, both tied up through the
    // CAPITAL-BACK (landing) date `we` = withdrawalEligibleDate (the hold-release
    // date plus the return-transfer lag; see offer-model.js):
    //   1. the held LUMP SUM (requiredFundingAmount) from the funding date, and
    //   2. each qualifying DD's amount from when it lands.
    // Previously only (2) was modeled, so the held funds never hit the chart;
    // and `we` was the hold-release date, letting the lump be spent the day the
    // hold lifted rather than the day it landed back (fixed 2026-07-13).
    if (o.offerType === 'held-and-dd' && Array.isArray(o.directDeposits) && o.directDeposits.length > 0) {
      const we = parseDate(withdrawalEligibleDate(o, cfg));
      if (!we) continue;
      const fundStart = parseDate(lockStartDate(o));
      const fundAmt = Number(o.requiredFundingAmount) || 0;
      if (fundStart && fundAmt > 0 && fundStart < we) applyCommitment(fundAmt, fundStart, we, kind);
      // The held lump above always applies; the per-DD legs only when the DD
      // path is active (a held-and-dd on the debit path keeps only its lump).
      if (ps.ddActive) for (const dd of o.directDeposits) {
        const eff = parseDate(directDepositEffectiveDate(dd));
        const amt = Number(dd.amount) || 0;
        if (!eff || amt <= 0 || eff >= we) continue;
        applyCommitment(amt, eff, we, kind);
      }
      continue;
    }
    // New funds held: single block from the funding date to the CAPITAL-BACK
    // (landing) date — the hold-release date plus the return-transfer lag, so the
    // lump is spendable the day it lands back, not the day the hold lifts.
    // QUALIFICATION PATHS: only when the hold path is active. For logic='all'
    // holdActive reduces to the held-lump offerType test, so new-funds-held/other
    // are unchanged; a debit-path new-funds-held (Brex, card spend chosen) ties up
    // NO capital (lockStart/withdrawalEligible already return '' → start/end null,
    // but gate explicitly for clarity + safety).
    if (!ps.holdActive) continue;
    const start = parseDate(lockStartDate(o));
    const end = parseDate(withdrawalEligibleDate(o, cfg));
    if (!start || !end || start >= end) continue;
    applyCommitment(Number(o.requiredFundingAmount), start, end, kind);
  }

  // 3. Capital events — accumulate net through each day. Recurring
  // events expand into one instance per occurrence in the horizon
  // window; one-time events produce a single instance. The downstream
  // running-sum loop doesn't know or care which is which.
  const horizonEndDate = new Date(startMs + (horizon - 1) * dayMs);
  const validEvents = [];
  for (const e of state.events) {
    if (!e.includeInProjection) continue;
    const instances = expandEventInstances(e, start, horizonEndDate);
    for (const inst of instances) {
      const idx = indexFor(inst.date);
      if (idx >= 0 && idx < horizon) validEvents.push({ idx, amount: inst.amount });
    }
  }
  validEvents.sort((a, b) => a.idx - b.idx);

  let cumul = 0;
  let evIdx = 0;
  for (let i = 0; i < horizon; i++) {
    while (evIdx < validEvents.length && validEvents[evIdx].idx <= i) {
      cumul += validEvents[evIdx].amount;
      evIdx++;
    }
    const d = days[i];
    d.netEventsToDate = cumul;
    d.totalTiedUp = d.confirmedTiedUp + d.hypotheticalTiedUp;
    d.availableCapital = d.startingLiquidCapital + cumul - d.totalTiedUp;
    d.belowBuffer = d.availableCapital < buffer;
    d.shortfall = d.availableCapital < 0;
    d.dateISO = isoDate(d.date);
    if (earlyExit && d.shortfall) {
      // Optimizer hint: still finish for stats, but mark early-exit info
    }
  }

  return days;
}

/* ============================================================
   PROJECTION SUMMARY (for the Overview view)
   ============================================================ */
function summarizeProjection(projection, settings) {
  if (!projection.length) return {};
  let lowest = projection[0];
  let lowestIdx = 0;
  let shortfallDays = 0;
  let belowBufferDays = 0;
  for (let i = 0; i < projection.length; i++) {
    const d = projection[i];
    if (d.availableCapital < lowest.availableCapital) { lowest = d; lowestIdx = i; }
    if (d.shortfall) shortfallDays++;
    if (d.belowBuffer) belowBufferDays++;
  }
  return {
    today: projection[0],
    lowest,
    lowestIdx,
    shortfallDays,
    belowBufferDays,
    feasible: shortfallDays === 0,
    horizonDays: projection.length
  };
}

/* ============================================================
   OFFER → COMMITMENT CONVERSION
   ============================================================ */
function convertOfferToCommitment(offer) {
  const start = lockStartDate(offer);
  const end = withdrawalEligibleDate(offer);
  if (!start || !end) return null;
  return {
    id: uid('cmt'),
    commitmentName: offerDisplayLabel(offer),
    sourceBonusOfferId: offer.id,
    amount: Number(offer.requiredFundingAmount),
    startDate: start,
    endDate: end,
    type: 'minimum balance',
    status: CONFIRMED_OFFER_STATUSES.has(offer.status) ? 'confirmed' : 'hypothetical',
    includeInProjection: true,
    expectedBonus: Number(offer.signupBonusAmount) || 0,
    notes: ''
  };
}

/* ============================================================
   OPTIMIZER
   ============================================================
   Brute-force search over candidate offers (status in
   {prospect, selected}, complete, dates within projection horizon).

   For up to maxOptimizerCandidates offers, evaluate every 2^n subset.
   For each subset:
     - Generate the daily projection with that subset selected.
     - A combination is feasible if availableCapital >= 0 every day.
     - Track total bonus, lowest available capital, days below buffer,
       and any breach dates.

   Ranking (feasible only):
     1. Highest total expected bonus.
     2. Highest blended annualized return.
     3. Highest lowest-available-capital (largest safety margin).

   Note: For n=15 this is 32,768 evaluations × 365 days ≈ 12M ops,
   which is fast in modern JS. We always run synchronously and then
   render. If candidates exceed the configured limit, we ask the user
   to deselect some via the planner cards.
   ============================================================ */
// C3 ceiling for the optimizer's per-run evaluation horizon. Bank-bonus holds
// run at most a few months; 730d (matching the '2years' preset) is a generous
// cap that keeps the 2^n × horizon evaluation bounded while covering every
// realistic offer. An offer whose relevant dates fall beyond this is not fully
// modeled by the optimizer — a documented tradeoff of this pre-engine hotfix.
const OPTIMIZER_HORIZON_CEILING_DAYS = 730;

// C3: the horizon the optimizer evaluates each combo over. It must reach the
// LATEST relevant date (safeToCloseDate = max of withdrawal-eligible /
// expected-bonus-window-end / ETF window / requirement deadlines) across every
// offer that can appear in a combo — the currently-active base set PLUS every
// complete hypothetical candidate (the mask, not includeInScenario, decides a
// candidate's inclusion) — then a 30-day margin, capped at the ceiling. It is
// NEVER shorter than the user's display horizon (effectiveHorizonDays), so no
// mode regresses; it only ever EXTENDS past the auto-mode 180d clamp so a late
// shortfall can't hide beyond the end of the projection.
function optimizerHorizonForState(state, horizonStart, cfg) {
  const start = horizonStart || parseDate(state.settings.projectionStartDate) || TODAY;
  const base = effectiveHorizonDays(state);
  let latest = null;
  for (const o of state.offers || []) {
    const inPlay = offerIsActiveForProjection(o)
      || (HYPOTHETICAL_OFFER_STATUSES.has(o.status) && isOfferComplete(o));
    if (!inPlay) continue;
    // cfg threads the state's ddTransfer so the horizon covers the landing
    // (capital-back) date, not the earlier hold-release date (2026-07-13).
    const iso = safeToCloseDate(o, cfg) || withdrawalEligibleDate(o, cfg) || lockStartDate(o);
    const d = iso ? parseDate(iso) : null;
    if (d && (latest == null || d > latest)) latest = d;
  }
  const needed = latest ? daysBetween(start, addDays(latest, 30)) : 0;
  return Math.max(30, base, Math.min(OPTIMIZER_HORIZON_CEILING_DAYS, needed));
}

// ⚠️ CASH-FEASIBILITY ONLY — NOT a qualification engine. ⚠️
// runOptimizer scores brute-force offer combinations purely on cash feasibility
// (shortfallDays / belowBufferDays over the capital curve). It has NO
// qualification layer: it does NOT validate deposit deadlines, DD posting dates
// (ACH transit), user-requirement/expiry cutoffs, DD cadence, or horizon
// overrun. A combination it marks `feasible: true` may still MISS a deadline and
// fail to qualify in reality. It is unused by the UI (the live Optimize panel
// runs the qualification-aware `optimizePlanner` in optimizer-engine.js) and is
// kept ONLY for the C2/C3 combo-feasibility pins (testFeasibilityPins). DO NOT
// wire this to any UI surface as a plan validator — use optimizePlanner, which
// runs validateOfferQualification, instead.
function runOptimizer(state) {
  // Thread the state's ddTransfer through EVERY landing-based computation so this
  // exported feasibility path honors the configured transfer lag exactly like the
  // live optimizePlanner (2026-07-13 review fold). Normalized once; a state with
  // no ddTransfer degenerates to 1/1/1, unchanged from before.
  const cfg = normalizeDdTransfer(state.settings.ddTransfer);
  const horizonStart = parseDate(state.settings.projectionStartDate) || TODAY;
  const optimizerHorizonDays = optimizerHorizonForState(state, horizonStart, cfg);
  const horizonEnd = addDays(horizonStart, optimizerHorizonDays);

  const candidates = state.offers.filter(o => {
    if (!HYPOTHETICAL_OFFER_STATUSES.has(o.status)) return false;
    if (!isOfferComplete(o)) return false;
    const start = parseDate(lockStartDate(o));
    const end = parseDate(withdrawalEligibleDate(o, cfg));
    if (!start || !end) return false;
    if (end <= horizonStart || start >= horizonEnd) return false;
    return true;
  });

  const max = state.settings.maxOptimizerCandidates || 15;

  if (candidates.length > max) {
    return {
      tooMany: true,
      candidateCount: candidates.length,
      max,
      candidates,
      results: [],
      evaluated: 0,
      infeasibleCount: 0
    };
  }

  const buffer = Number(state.settings.minimumCashBuffer) || 0;
  const total = 1 << candidates.length;
  const results = [];
  let infeasibleCount = 0;

  // C2: while a combo is under test, the owner's currently-active NON-candidate
  // offers (confirmed/open commitments and opted-in scenarios) must REMAIN in
  // the projection — otherwise their committed capital vanishes and a candidate
  // that is actually infeasible gets reported feasible. The override handed to
  // generateProjection is therefore the active non-candidate set UNION the
  // candidate subset under test, computed once here and unioned per mask below.
  // `includedIds` (the reported combo) stays the SUBSET only — the base offers
  // are already committed, not a user choice, so the reported selection is the
  // candidate subset under test, re-derivable from the mask, not this list.
  const candidateIds = new Set(candidates.map(o => o.id));
  const baseActiveIds = state.offers
    .filter(o => !candidateIds.has(o.id) && offerIsActiveForProjection(o))
    .map(o => o.id);

  for (let mask = 0; mask < total; mask++) {
    const includedIds = [];
    let totalBonus = 0;
    let totalRequired = 0;
    let weightedAnnReturnNum = 0;
    let weightedAnnReturnDen = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (mask & (1 << i)) {
        const o = candidates[i];
        includedIds.push(o.id);
        totalBonus += Number(o.signupBonusAmount) || 0;
        totalRequired += Number(o.requiredFundingAmount) || 0;
        const ar = annualizedReturn(o, cfg);
        if (ar != null) {
          // Weight by capital × duration (dollar-days) to get a blended
          // rate. DD offers use their actual round-trip dollar-days;
          // held offers use required funding × stated hold days.
          let weight;
          if (o.offerType === 'direct-deposit' || o.offerType === 'held-and-dd') {
            const ct = ddCapitalTime(o, cfg);
            weight = ct ? ct.dollarDays : 0;
          } else {
            weight = Number(o.requiredFundingAmount) * Number(o.daysFundsMustRemain || 0);
          }
          if (weight > 0) {
            weightedAnnReturnNum += ar * weight;
            weightedAnnReturnDen += weight;
          }
        }
      }
    }

    const proj = generateProjection(state, {
      includedOfferIds: baseActiveIds.concat(includedIds),
      horizonDays: optimizerHorizonDays,
      ddTransfer: cfg
    });
    let lowest = Infinity;
    let belowBufferDays = 0;
    let shortfallDays = 0;
    const breachDates = [];
    for (const d of proj) {
      if (d.availableCapital < lowest) lowest = d.availableCapital;
      if (d.shortfall) { shortfallDays++; breachDates.push(d.dateISO); }
      else if (d.belowBuffer) belowBufferDays++;
    }
    const feasible = shortfallDays === 0 && belowBufferDays === 0;
    if (!feasible) infeasibleCount++;
    results.push({
      mask,
      includedIds,
      offerCount: includedIds.length,
      totalBonus,
      totalRequired,
      lowestAvailable: lowest,
      belowBufferDays,
      shortfallDays,
      feasible,
      blendedAnnReturn: weightedAnnReturnDen > 0 ? weightedAnnReturnNum / weightedAnnReturnDen : null,
      breachDates: breachDates.slice(0, 5)
    });
  }

  // Rank feasible: bonus desc → annReturn desc → lowestAvailable desc
  const feasibleResults = results
    .filter(r => r.feasible && r.offerCount > 0)
    .sort((a, b) => {
      if (b.totalBonus !== a.totalBonus) return b.totalBonus - a.totalBonus;
      const ar = (a.blendedAnnReturn ?? 0), br = (b.blendedAnnReturn ?? 0);
      if (br !== ar) return br - ar;
      return b.lowestAvailable - a.lowestAvailable;
    });

  return {
    tooMany: false,
    candidates,
    results: feasibleResults.slice(0, 10),
    allResults: results,
    evaluated: total,
    infeasibleCount,
    candidateCount: candidates.length
  };
}

/* ============================================================
   FEASIBILITY REGRESSION PINS (C2 / C3 / C-template)
   ============================================================
   Permanent guards for the combo-feasibility hotfix (run
   2026-07-08-planner-optimizer). Mirrors the testDocParserRegressions()
   in-app + harness pattern: call testFeasibilityPins() from the DevTools
   console (window.testFeasibilityPins) or from Node against the real
   module. Returns { pass, fail, results }.

   C2   — a combo's projection must KEEP the owner's currently-active
          non-candidate offers (confirmed/open commitments); their tied-up
          capital can make a candidate infeasible. Dropping them over-reports
          feasibility.
   C3   — the evaluated horizon must cover a combo's full capital-lock life,
          not the auto-mode 180-day DISPLAY clamp; a shortfall that lands past
          the clamp must not be truncated away. Includes a long-dated POSITIVE
          control that must stay feasible (the extension must not invent
          shortfalls).
   Ctpl — an 'open date' hold anchor must survive the offer→template→offer
          round-trip; a legacy template object without the key still yields the
          historical 'funded date' default.
   ============================================================ */
function _fpIso(start, offsetDays) { return isoDate(addDays(start, offsetDays)); }

// A complete new-funds-held offer (no directDeposits required by isOfferComplete).
function _fpOffer(over) {
  return Object.assign({
    id: uid('off'), bankName: 'Pin Bank', offerType: 'new-funds-held',
    requiredFundingAmount: 10000, signupBonusAmount: 300,
    daysFundsMustRemain: 60, lockStartsFrom: 'funded date',
    plannedSignupDate: '', optionalPlannedFundingDate: '',
    status: 'prospect', accountStatus: 'closed', subStatus: 'prospect',
    includeInScenario: false, directDeposits: [], requirements: []
  }, over || {});
}

function _fpState(over) {
  return Object.assign({
    settings: {
      projectionStartDate: '2026-07-01', projectionHorizonMode: 'auto',
      minimumCashBuffer: 0, currentLiquidCapital: 50000, maxOptimizerCandidates: 15
    },
    offers: [], commitments: [], events: []
  }, over || {});
}

function testFeasibilityPins() {
  const results = [];
  const check = (name, expected, actual, extra) => {
    results.push({ name, expected, actual, ok: expected === actual, extra: extra || '' });
  };
  const start = parseDate('2026-07-01');
  // With one candidate, the only non-empty subset is the offerCount===1 result.
  const candOnly = (r) => (r.allResults || []).find(x => x.offerCount === 1) || null;

  // ---- C2: a confirmed offer's committed capital must sink an over-committed
  // candidate. Liquid 50k; confirmed ties 40k [~d10,~d70]; candidate ties 30k
  // [~d20,~d80]; overlap needs 70k > 50k → the candidate-only combo is INFEASIBLE.
  {
    const confirmed = _fpOffer({
      id: 'off_confirmed', bankName: 'Confirmed', status: 'funded',
      accountStatus: 'open', subStatus: 'on-track', includeInScenario: true,
      requiredFundingAmount: 40000, daysFundsMustRemain: 60,
      plannedSignupDate: _fpIso(start, 10), optionalPlannedFundingDate: _fpIso(start, 10)
    });
    const candidate = _fpOffer({
      id: 'off_candidate', bankName: 'Candidate', status: 'prospect',
      requiredFundingAmount: 30000, daysFundsMustRemain: 60,
      plannedSignupDate: _fpIso(start, 20), optionalPlannedFundingDate: _fpIso(start, 20)
    });
    const cand = candOnly(runOptimizer(_fpState({ offers: [confirmed, candidate] })));
    check('C2 confirmed capital kept in combo (candidate infeasible)',
      false, cand ? cand.feasible : null, cand ? `lowest=${cand.lowestAvailable}` : 'no result');
  }

  // ---- C3-neg: a late shortfall past the 180-day auto clamp must be caught.
  // Candidate ties 30k [~d100,~d240]; a -35k expense on d200 drives -15k over
  // d200..d240 — entirely beyond the clamp. Must be INFEASIBLE post-fix.
  {
    const candidate = _fpOffer({
      id: 'off_c3neg', bankName: 'LateHold', status: 'prospect', includeInScenario: true,
      requiredFundingAmount: 30000, daysFundsMustRemain: 140,
      plannedSignupDate: _fpIso(start, 100), optionalPlannedFundingDate: _fpIso(start, 100)
    });
    const cand = candOnly(runOptimizer(_fpState({
      offers: [candidate],
      events: [{ id: 'ev_c3neg', includeInProjection: true, amount: -35000, date: _fpIso(start, 200) }]
    })));
    check('C3 late shortfall past 180d clamp caught (infeasible)',
      false, cand ? cand.feasible : null, cand ? `lowest=${cand.lowestAvailable}` : 'no result');
  }

  // ---- C3-pos: a genuinely-feasible long-dated combo must STAY feasible under
  // the extended horizon. Same shape, but only a -10k expense → +10k floor.
  {
    const candidate = _fpOffer({
      id: 'off_c3pos', bankName: 'LateHoldOK', status: 'prospect', includeInScenario: true,
      requiredFundingAmount: 30000, daysFundsMustRemain: 140,
      plannedSignupDate: _fpIso(start, 100), optionalPlannedFundingDate: _fpIso(start, 100)
    });
    const cand = candOnly(runOptimizer(_fpState({
      offers: [candidate],
      events: [{ id: 'ev_c3pos', includeInProjection: true, amount: -10000, date: _fpIso(start, 200) }]
    })));
    check('C3 long-dated positive control stays feasible',
      true, cand ? cand.feasible : null, cand ? `lowest=${cand.lowestAvailable}` : 'no result');
  }

  // ---- Ctpl: 'open date' hold anchor must survive the template round-trip;
  // a legacy template (no key) still defaults to 'funded date'.
  {
    const rt = templateToOffer(offerToTemplate(_fpOffer({ lockStartsFrom: 'open date', daysFundsMustRemain: 90 })));
    check('Ctpl open-date anchor preserved through round-trip', 'open date', rt.lockStartsFrom);
    const legacy = templateToOffer({ bankName: 'Legacy', offerType: 'new-funds-held', daysFundsMustRemain: 90 });
    check('Ctpl legacy template (no key) still defaults funded date', 'funded date', legacy.lockStartsFrom);
    // EITHER/OR: requirementLogic (a TERM) survives the template round-trip;
    // plannedPath (PERSONAL) resets to null so a churn re-run re-prompts; a legacy
    // template with no key defaults to 'all' (backward-compatible).
    const eoTpl = offerToTemplate(_fpOffer({ requirementLogic: 'any', plannedPath: 'debit',
      debitRequirement: { required: true, count: 5, withinDays: 30, byDate: '', byDateLegacy: '' } }));
    const eoRt = templateToOffer(eoTpl);
    check('Ctpl either/or requirementLogic + plannedPath round-trip', true,
      eoTpl.requirementLogic === 'any' && eoTpl.plannedPath === undefined
      && eoRt.requirementLogic === 'any' && eoRt.plannedPath === null
      && templateToOffer({ bankName: 'L', offerType: 'new-funds-held' }).requirementLogic === 'all');
  }

  // ---- Ceo: EITHER/OR — the projection follows the CHOSEN path. The same
  // requirementLogic:'any' offer ties up its 40k DD on the 'dd' path but ZERO
  // capital on the 'debit' path (card spend ties up nothing). Both feasible;
  // only the dd path dips the curve below full liquid capital (2026-07-11).
  {
    const eo = (path) => _fpOffer({
      id: 'off_eo_feas', offerType: 'direct-deposit', includeInScenario: true,
      requiredFundingAmount: 40000, daysFundsMustRemain: null,
      ddRequirement: { mode: 'count', count: 1 },
      directDeposits: [{ id: 'dd1', plannedDate: _fpIso(start, 20), amount: 40000 }],
      debitRequirement: { required: true, count: 3, withinDays: 30, byDate: '', byDateLegacy: '' },
      requirementLogic: 'any', plannedPath: path,
      plannedSignupDate: _fpIso(start, 10)
    });
    const low = (path) => {
      const o = eo(path);
      const st = _fpState({ offers: [o] });
      const proj = generateProjection(st, { includedOfferIds: [o.id], horizonDays: 120 });
      const s = summarizeProjection(proj, st.settings);
      return s.lowest ? s.lowest.availableCapital : null;
    };
    const ddLow = low('dd');
    const debitLow = low('debit');
    check('Ceo either/or debit path ties up no capital; dd path ties up its DD',
      true, debitLow === 50000 && ddLow != null && ddLow < 50000, `dd=${ddLow} debit=${debitLow}`);
  }

  // ---- Ceo2: BREX — a NEW-FUNDS-HELD hold-OR-card-spend either/or. The same
  // requirementLogic:'any' offer ties up its 30k HELD LUMP on the 'hold' path but
  // ZERO capital on the 'debit' (card-spend) path (2026-07-13 requirements-driven
  // qualification paths). Both feasible; only the hold path dips the curve. This
  // is the owner's exact Brex case: hold funds OR spend on the card, do one.
  {
    const brex = (path) => _fpOffer({
      id: 'off_brex_feas', offerType: 'new-funds-held', includeInScenario: true,
      requiredFundingAmount: 30000, daysFundsMustRemain: 60,
      debitRequirement: { required: true, count: 5, withinDays: 30, byDate: '', byDateLegacy: '' },
      requirementLogic: 'any', plannedPath: path,
      plannedSignupDate: _fpIso(start, 10), optionalPlannedFundingDate: _fpIso(start, 10)
    });
    const low = (path) => {
      const o = brex(path);
      const st = _fpState({ offers: [o] });
      const proj = generateProjection(st, { includedOfferIds: [o.id], horizonDays: 120 });
      const s = summarizeProjection(proj, st.settings);
      return s.lowest ? s.lowest.availableCapital : null;
    };
    const holdLow = low('hold');
    const debitLow = low('debit');
    check('Ceo2 Brex hold-or-spend: hold path ties up the 30k lump, card-spend path ties up ZERO',
      true, debitLow === 50000 && holdLow != null && holdLow <= 20000, `hold=${holdLow} debit=${debitLow}`);
  }

  // ---- HOLD-RELEASE TRANSFER LAG (2026-07-13). The day model must treat held
  // capital as spendable only when it LANDS back in the hub (withdrawal-
  // eligibility + ddTransfer.backDays business days), NOT the day the hold
  // releases. Owner-confirmed intent: a plan whose held releases overlap same-day
  // funding below the buffer is infeasible, not optimal. All dates are DERIVED
  // from the model functions (no hardcoded calendar) so the pins stay robust.
  {
    const dayByISO = (proj, iso) => proj.find(d => d.dateISO === iso) || null;
    const cfg = (b) => ({ inDays: 1, seasonDays: 1, backDays: b });

    // (Clag-A) LANDING-DAY BOUNDARY: a 30k held lump (liquid 50k) is still tied
    // up ON the hold-release/withdrawal-eligibility day and freed ON the landing
    // day (release + backDays). Under the pre-fix same-day model the release day
    // itself would already read full liquid — this pin encodes the fix.
    {
      const held = _fpOffer({ id: 'off_land', requiredFundingAmount: 30000, daysFundsMustRemain: 10,
        plannedSignupDate: '2026-07-06', optionalPlannedFundingDate: '2026-07-06', includeInScenario: true });
      const st = _fpState({ settings: { projectionStartDate: '2026-07-06', minimumCashBuffer: 0, currentLiquidCapital: 50000 }, offers: [held] });
      const proj = generateProjection(st, { includedOfferIds: ['off_land'], horizonDays: 40, ddTransfer: cfg(1) });
      const relISO = withdrawalInitiateDate(held);        // hold-release (backDays-independent)
      const landISO = withdrawalEligibleDate(held, cfg(1)); // capital-back = release + 1 biz day
      const relDay = dayByISO(proj, relISO);
      const landDay = dayByISO(proj, landISO);
      check('Clag-A landing boundary: tied up ON release day, freed ON landing day (release+backDays)',
        true, !!(landISO > relISO && relDay && landDay && relDay.availableCapital === 20000 && landDay.availableCapital === 50000),
        relDay && landDay ? `rel(${relISO})=${relDay.availableCapital} land(${landISO})=${landDay.availableCapital}` : 'missing day');
    }

    // (Clag-B) backDays VARIANTS 0/1/3 end-to-end: the projection's capital-back
    // recovery date equals withdrawalEligibleDate for each backDays, 0 degenerates
    // to the release day (pre-fix behavior), and the recovery shifts strictly
    // later 0 < 1 < 3.
    {
      const held = _fpOffer({ id: 'off_var', requiredFundingAmount: 30000, daysFundsMustRemain: 10,
        plannedSignupDate: '2026-07-06', optionalPlannedFundingDate: '2026-07-06', includeInScenario: true });
      const recovery = (b) => {
        const st = _fpState({ settings: { projectionStartDate: '2026-07-06', minimumCashBuffer: 0, currentLiquidCapital: 50000 }, offers: [held] });
        const proj = generateProjection(st, { includedOfferIds: ['off_var'], horizonDays: 40, ddTransfer: cfg(b) });
        const d = proj.find(x => x.availableCapital === 50000);
        return d ? d.dateISO : null;
      };
      const relISO = withdrawalInitiateDate(held);
      const r0 = recovery(0), r1 = recovery(1), r3 = recovery(3);
      const m0 = withdrawalEligibleDate(held, cfg(0)), m1 = withdrawalEligibleDate(held, cfg(1)), m3 = withdrawalEligibleDate(held, cfg(3));
      check('Clag-B backDays 0/1/3: projection recovery == withdrawalEligibleDate, 0 degenerates to release, 0<1<3',
        true, r0 === m0 && r1 === m1 && r3 === m3 && r0 === relISO && r0 < r1 && r1 < r3,
        `b0=${r0} b1=${r1} b3=${r3} rel=${relISO}`);
    }

    // (Clag-C) OWNER Jul-17 AUDIT REPRODUCTION. Liquid 84,500; Brex 50k held
    // releasing on its withdrawal-eligibility day, BofA 15k + BMO 25k + Old
    // National 20k held past it. On Brex's release day: backDays=0 (optimistic
    // netting) frees Brex same day → +24,500 (the audit's feasible figure);
    // backDays=1 keeps Brex in transit → −25,500 (real shortfall). The 50k swing
    // is exactly Brex's lump, proving same-day netting was the bug.
    {
      const brex = _fpOffer({ id: 'off_brex', requiredFundingAmount: 50000, daysFundsMustRemain: 3,
        plannedSignupDate: '2026-07-14', optionalPlannedFundingDate: '2026-07-14', includeInScenario: true });
      const bofa = _fpOffer({ id: 'off_bofa', requiredFundingAmount: 15000, daysFundsMustRemain: 40,
        plannedSignupDate: '2026-07-15', optionalPlannedFundingDate: '2026-07-15', includeInScenario: true });
      const bmo = _fpOffer({ id: 'off_bmo', requiredFundingAmount: 25000, daysFundsMustRemain: 40,
        plannedSignupDate: '2026-07-17', optionalPlannedFundingDate: '2026-07-17', includeInScenario: true });
      const onb = _fpOffer({ id: 'off_onb', requiredFundingAmount: 20000, daysFundsMustRemain: 40,
        plannedSignupDate: '2026-07-17', optionalPlannedFundingDate: '2026-07-17', includeInScenario: true });
      const ids = ['off_brex', 'off_bofa', 'off_bmo', 'off_onb'];
      const proj = (b) => generateProjection(
        _fpState({ settings: { projectionStartDate: '2026-07-13', minimumCashBuffer: 0, currentLiquidCapital: 84500 }, offers: [brex, bofa, bmo, onb] }),
        { includedOfferIds: ids, horizonDays: 60, ddTransfer: cfg(b) });
      const brexRelease = withdrawalInitiateDate(brex); // Brex's withdrawal-eligibility day (the audit's Jul 17)
      const d0 = dayByISO(proj(0), brexRelease);
      const d1 = dayByISO(proj(1), brexRelease);
      check('Clag-C audit Jul-17: backDays=0 optimistic netting leaves +24,500 on Brex release day',
        24500, d0 ? d0.availableCapital : null, `date=${brexRelease}`);
      check('Clag-C audit Jul-17: backDays=1 transfer lag exposes −25,500 same-day overlap (Brex still in transit)',
        -25500, d1 ? d1.availableCapital : null, `swing=${d0 && d1 ? d0.availableCapital - d1.availableCapital : '?'}`);
    }

    // (Clag-E) The EXPORTED runOptimizer feasibility path must honor the state's
    // ddTransfer.backDays (2026-07-13 Codex review fold). A 30k held candidate
    // (liquid 30k) with a −5k outflow the day after its hold releases is feasible
    // at backDays=0 (capital already landed → freed) but INFEASIBLE at backDays=3
    // (still in transit → the outflow drives −5k). If runOptimizer ignored the
    // config (used the 1/1/1 default) both verdicts would agree — this pin fails.
    {
      const lagCand = _fpOffer({ id: 'off_lagfeas', requiredFundingAmount: 30000, daysFundsMustRemain: 10,
        plannedSignupDate: '2026-07-06', optionalPlannedFundingDate: '2026-07-06' });
      const runFeas = (b) => {
        const r = runOptimizer(_fpState({
          settings: { projectionStartDate: '2026-07-06', projectionHorizonMode: 'auto', minimumCashBuffer: 0, currentLiquidCapital: 30000, maxOptimizerCandidates: 15, ddTransfer: cfg(b) },
          offers: [lagCand],
          events: [{ id: 'ev_lagfeas', includeInProjection: true, amount: -5000, date: '2026-07-17' }]
        }));
        const c = (r.allResults || []).find(x => x.offerCount === 1);
        return c ? c.feasible : null;
      };
      const f0 = runFeas(0), f3 = runFeas(3);
      check('Clag-E runOptimizer honors state ddTransfer.backDays (0 feasible, 3 infeasible)',
        true, f0 === true && f3 === false, `b0=${f0} b3=${f3}`);
    }
  }

  // ---- STALE PRE-ACCOUNT SIGNUP → EFFECTIVE "TODAY" (2026-07-13b, Feature 2).
  // A never-run prospect/selected offer whose plannedSignupDate slipped into the
  // past is modeled as if signed up TODAY (whole date group shifted by one
  // calendar delta), so it stops distorting the current-state curve. Confirmed/
  // open offers are never shifted; an expiry collision flips to needs-attention.
  {
    const T = '2026-07-13';   // the projection's "now" (projectionStartDate)

    // (Cstale-A) EFFECTIVE-TODAY PROJECTION: a stale prospect held lump no longer
    // reads as free capital. Signup/funding 42 days back would tie up entirely in
    // the past (nothing in the [today, …) window) — the pre-feature distortion.
    // Shifted to today it ties up its 30k from today through the hold+lag, so the
    // current-state curve DIPS to 20k (liquid 50k) INSIDE the window.
    {
      const stale = _fpOffer({ id: 'off_stale', requiredFundingAmount: 30000, daysFundsMustRemain: 10,
        plannedSignupDate: '2026-06-01', optionalPlannedFundingDate: '2026-06-01',
        status: 'prospect', includeInScenario: true });
      const st = _fpState({ settings: { projectionStartDate: T, minimumCashBuffer: 0, currentLiquidCapital: 50000 }, offers: [stale] });
      const proj = generateProjection(st, { horizonDays: 40 });
      const s = summarizeProjection(proj, st.settings);
      // Day 0 (today) is inside the tied-up interval → 20k; lowest across the
      // window is 20k (never the free-capital 50k the stale raw dates implied).
      check('Cstale-A effective-today: stale prospect ties up from today (curve dips, not free capital)',
        true, proj[0].availableCapital === 20000 && s.lowest.availableCapital === 20000,
        `day0=${proj[0].availableCapital} lowest=${s.lowest.availableCapital}`);
    }

    // (Cstale-B) GROUP-SHIFT COHERENCE: signup lands on today and EVERY internal
    // offset (funding, each DD) is preserved by the single calendar delta; DD ids
    // survive (consumers key on them). Uses the pure helper directly.
    {
      const src = _fpOffer({ id: 'off_grp', offerType: 'held-and-dd', requiredFundingAmount: 40000,
        daysFundsMustRemain: 20, status: 'prospect', includeInScenario: true,
        plannedSignupDate: '2026-06-01', optionalPlannedFundingDate: '2026-06-03',
        directDeposits: [{ id: 'dA', amount: 20000, plannedDate: '2026-06-05' },
                         { id: 'dB', amount: 20000, plannedDate: '2026-06-12' }] });
      const r = effectiveOfferForToday(src, T);
      const e = r.offer;
      const off = (a, b) => daysBetween(parseDate(a), parseDate(b));
      const okSignup = e.plannedSignupDate === T && r.deltaDays === off('2026-06-01', T);
      const okFund = off(e.plannedSignupDate, e.optionalPlannedFundingDate) === off('2026-06-01', '2026-06-03');
      const okDd0 = e.directDeposits[0].id === 'dA' && off(e.plannedSignupDate, e.directDeposits[0].plannedDate) === off('2026-06-01', '2026-06-05');
      const okDd1 = e.directDeposits[1].id === 'dB' && off(e.plannedSignupDate, e.directDeposits[1].plannedDate) === off('2026-06-01', '2026-06-12');
      check('Cstale-B group-shift coherence: signup→today, funding+DD offsets preserved, DD ids kept',
        true, r.shifted && okSignup && okFund && okDd0 && okDd1,
        `signup=${e.plannedSignupDate} fund=${e.optionalPlannedFundingDate} dd=${e.directDeposits.map(d=>d.id+':'+d.plannedDate).join(',')}`);
    }

    // (Cstale-C) EXPIRY COLLISION → needs-attention: today strictly past the
    // expiration → NOT advanced (windowPassed, unchanged offer). A future
    // expiration shifts normally; an expiration EXACTLY today still permits
    // signing up today (strict >).
    {
      const mk = (exp) => _fpOffer({ id: 'off_exp', status: 'prospect', plannedSignupDate: '2026-06-01', offerExpirationDate: exp });
      const passed = effectiveOfferForToday(mk('2026-06-20'), T);
      const future = effectiveOfferForToday(mk('2026-12-31'), T);
      const edge = effectiveOfferForToday(mk(T), T);
      check('Cstale-C expiry collision: past-expiry NOT advanced (needs-attention); future/edge shift',
        true,
        passed.windowPassed && !passed.shifted && passed.offer.plannedSignupDate === '2026-06-01'
        && future.shifted && !future.windowPassed && future.offer.plannedSignupDate === T
        && edge.shifted && !edge.windowPassed,
        `passed=${passed.windowPassed} future=${future.shifted} edge=${edge.shifted}`);
    }

    // (Cstale-D) CONFIRMED/OPEN NEVER SHIFTED; both hypothetical kinds (prospect
    // AND selected) do shift. A funded offer with the same stale signup is left
    // exactly as entered.
    {
      const funded = effectiveOfferForToday(_fpOffer({ id: 'off_conf', status: 'funded', plannedSignupDate: '2026-06-01' }), T);
      const selected = effectiveOfferForToday(_fpOffer({ id: 'off_sel', status: 'selected', plannedSignupDate: '2026-06-01' }), T);
      const prospect = effectiveOfferForToday(_fpOffer({ id: 'off_pro', status: 'prospect', plannedSignupDate: '2026-06-01' }), T);
      check('Cstale-D confirmed/open never shifted; prospect & selected both shift',
        true,
        !funded.shifted && funded.offer.plannedSignupDate === '2026-06-01'
        && selected.shifted && selected.offer.plannedSignupDate === T
        && prospect.shifted && prospect.offer.plannedSignupDate === T,
        `funded=${funded.shifted} selected=${selected.shifted} prospect=${prospect.shifted}`);
    }

    // (Cstale-E) DETERMINISM + IDEMPOTENCE: identical input → identical shift; and
    // mapping the already-effective array again is a no-op (signup==today, not <),
    // so re-projection can't drift.
    {
      const src = _fpOffer({ id: 'off_det', status: 'prospect', plannedSignupDate: '2026-06-01',
        optionalPlannedFundingDate: '2026-06-04', directDeposits: [{ id: 'd1', amount: 5000, plannedDate: '2026-06-06' }] });
      const a = effectiveOfferForToday(src, T).offer;
      const b = effectiveOfferForToday(src, T).offer;
      const once = mapEffectiveOffers([src], T);
      const twice = mapEffectiveOffers(once, T);
      const sameDates = a.plannedSignupDate === b.plannedSignupDate
        && a.optionalPlannedFundingDate === b.optionalPlannedFundingDate
        && a.directDeposits[0].plannedDate === b.directDeposits[0].plannedDate;
      check('Cstale-E determinism + idempotence: repeat shift identical, re-map is a no-op',
        true, sameDates && twice[0].plannedSignupDate === once[0].plannedSignupDate && twice[0].plannedSignupDate === T,
        `once=${once[0].plannedSignupDate} twice=${twice[0].plannedSignupDate}`);
    }
  }

  // ---- H1 (2026-07-14 fix-up): a MISSING/unknown offerType keeps its pre-87ff38c
  // HELD-LUMP modeling. Every held consumer gated on the literal predicate
  // `offerType !== 'direct-deposit'`, so a legacy/seed offer with an ABSENT
  // offerType took the held branch (holdActive, tied-up capital). The 87ff38c
  // allow-list regressed it to holdActive:false; this pins the restoration — its
  // capital dates + projection block are UNCHANGED from the held modeling.
  {
    const noType = _fpOffer({
      id: 'off_h1_notype', offerType: undefined, includeInScenario: true,
      requiredFundingAmount: 30000, daysFundsMustRemain: 60,
      plannedSignupDate: _fpIso(start, 10), optionalPlannedFundingDate: _fpIso(start, 10)
    });
    const st = _fpState({ offers: [noType] });
    const proj = generateProjection(st, { includedOfferIds: [noType.id], horizonDays: 120 });
    const s = summarizeProjection(proj, st.settings);
    const low = s.lowest ? s.lowest.availableCapital : null;
    const we = withdrawalEligibleDate(noType);
    check('H1 undefined offerType keeps held-lump modeling (holdActive + capital tied up)',
      true,
      pathState(noType).holdActive === true
      && lockStartDate(noType) !== '' && !!we
      && low != null && low <= 20000,
      `holdActive=${pathState(noType).holdActive} lockStart=${lockStartDate(noType)} we=${we} low=${low}`);
  }

  // ---- M1 (2026-07-14 fix-up): bonusWindowAnchor ignores DORMANT-path done_dates.
  // An 'any' offer with a CHOSEN (hold) path row done EARLIER and a non-chosen
  // (card-spend) path row done LATER must anchor the expected-bonus window on the
  // CHOSEN path's latest done_date — a completed row you're NOT using can't push
  // the window (and safe-to-close) months out. Neutral rows still count (dec. 8).
  {
    const m1 = _fpOffer({
      id: 'off_m1', offerType: 'new-funds-held', requirementLogic: 'any', plannedPath: 'hold',
      requiredFundingAmount: 30000, daysFundsMustRemain: 60,
      requirements: [
        { id: 'r_hold', type: 'deposit', done: true, done_date: _fpIso(start, 30), source: 'derived' },
        { id: 'r_debit', type: 'spend', done: true, done_date: _fpIso(start, 60), source: 'derived' }
      ]
    });
    const anchor = bonusWindowAnchor(m1, start);
    check('M1 bonusWindowAnchor uses chosen-path done_date, not the later dormant row',
      true, !!anchor && anchor.iso === _fpIso(start, 30) && anchor.estimated === false,
      `iso=${anchor && anchor.iso} estimated=${anchor && anchor.estimated}`);
  }

  // ---- M2 (2026-07-14 fix-up): an 'any' offer with NO path chosen (needsPath) must
  // not read as "all requirements met" just because its NEUTRAL rows are done — the
  // owner hasn't committed to a qualifying path yet. allRequirementsDone (and
  // shouldSuggestWaiting) must be false while needsPath, so lifecycle can't advance
  // to met-waiting despite an unmade choice.
  {
    const m2 = _fpOffer({
      id: 'off_m2', offerType: 'new-funds-held', requirementLogic: 'any', plannedPath: null,
      status: 'funded', accountStatus: 'open', subStatus: 'on-track',
      requiredFundingAmount: 30000, daysFundsMustRemain: 60,
      plannedSignupDate: _fpIso(start, 10), optionalPlannedFundingDate: _fpIso(start, 10),
      requirements: [
        { id: 'r_hold', type: 'deposit', done: false, done_date: '', source: 'derived' },
        { id: 'r_debit', type: 'spend', done: false, done_date: '', source: 'derived' },
        { id: 'r_neutral', type: 'estatements', done: true, done_date: _fpIso(start, 20), source: 'derived' }
      ]
    });
    check('M2 allRequirementsDone/shouldSuggestWaiting false while needsPath (only neutral rows done)',
      true,
      pathState(m2).needsPath === true
      && allRequirementsDone(m2) === false
      && shouldSuggestWaiting(m2) === false,
      `needsPath=${pathState(m2).needsPath} allDone=${allRequirementsDone(m2)} suggest=${shouldSuggestWaiting(m2)}`);
  }

  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  if (typeof console !== 'undefined') {
    console.log(`testFeasibilityPins: PASS ${pass}  FAIL ${fail}`);
    for (const r of results) {
      console.log(`  ${r.ok ? 'ok ' : 'X  '}${r.name} -> got ${JSON.stringify(r.actual)} want ${JSON.stringify(r.expected)}${r.extra ? '  [' + r.extra + ']' : ''}`);
    }
  }
  return { pass, fail, results };
}

export { effectiveHorizonDays, generateProjection, summarizeProjection, convertOfferToCommitment, runOptimizer, testFeasibilityPins };
