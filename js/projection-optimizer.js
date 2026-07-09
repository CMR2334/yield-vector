import { TODAY, addDays, daysBetween, expandEventInstances, isoDate, parseDate, startOfDay, uid } from './date-format-core.js';
import { ddRoundTrip, directDepositEffectiveDate } from './dd-core.js';
import { CONFIRMED_OFFER_STATUSES, HYPOTHETICAL_OFFER_STATUSES } from './runtime-status.js';
import { annualizedReturn, ddCapitalTime, isOfferComplete, lockStartDate, offerIsActiveForProjection, safeToCloseDate, withdrawalEligibleDate } from './offer-model.js';
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
     where A <= d < B. If a deposit lands March 1 and is withdrawal-eligible
     May 1, the funds are tied up March 1 through April 30 (61 days).

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
  for (const o of state.offers || []) {
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
    // STANDARD direct deposit: each DD ties up its own amount only for
    // its transfer round trip (initiation → return to origin). No shared
    // hold — money is out of the origin account exactly while in transit
    // + seasoning. DDs initiated before weekends/holidays tie up longer.
    if (o.offerType === 'direct-deposit' && Array.isArray(o.directDeposits) && o.directDeposits.length > 0) {
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
    // bonus hold (withdrawal-eligible) date:
    //   1. the held LUMP SUM (requiredFundingAmount) from the funding date, and
    //   2. each qualifying DD's amount from when it lands.
    // Previously only (2) was modeled, so the held funds never hit the chart.
    if (o.offerType === 'held-and-dd' && Array.isArray(o.directDeposits) && o.directDeposits.length > 0) {
      const we = parseDate(withdrawalEligibleDate(o, cfg));
      if (!we) continue;
      const fundStart = parseDate(lockStartDate(o));
      const fundAmt = Number(o.requiredFundingAmount) || 0;
      if (fundStart && fundAmt > 0 && fundStart < we) applyCommitment(fundAmt, fundStart, we, kind);
      for (const dd of o.directDeposits) {
        const eff = parseDate(directDepositEffectiveDate(dd));
        const amt = Number(dd.amount) || 0;
        if (!eff || amt <= 0 || eff >= we) continue;
        applyCommitment(amt, eff, we, kind);
      }
      continue;
    }
    // New funds held: single block over the lock window.
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
function optimizerHorizonForState(state, horizonStart) {
  const start = horizonStart || parseDate(state.settings.projectionStartDate) || TODAY;
  const base = effectiveHorizonDays(state);
  let latest = null;
  for (const o of state.offers || []) {
    const inPlay = offerIsActiveForProjection(o)
      || (HYPOTHETICAL_OFFER_STATUSES.has(o.status) && isOfferComplete(o));
    if (!inPlay) continue;
    const iso = safeToCloseDate(o) || withdrawalEligibleDate(o) || lockStartDate(o);
    const d = iso ? parseDate(iso) : null;
    if (d && (latest == null || d > latest)) latest = d;
  }
  const needed = latest ? daysBetween(start, addDays(latest, 30)) : 0;
  return Math.max(30, base, Math.min(OPTIMIZER_HORIZON_CEILING_DAYS, needed));
}

function runOptimizer(state) {
  const horizonStart = parseDate(state.settings.projectionStartDate) || TODAY;
  const optimizerHorizonDays = optimizerHorizonForState(state, horizonStart);
  const horizonEnd = addDays(horizonStart, optimizerHorizonDays);

  const candidates = state.offers.filter(o => {
    if (!HYPOTHETICAL_OFFER_STATUSES.has(o.status)) return false;
    if (!isOfferComplete(o)) return false;
    const start = parseDate(lockStartDate(o));
    const end = parseDate(withdrawalEligibleDate(o));
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
        const ar = annualizedReturn(o);
        if (ar != null) {
          // Weight by capital × duration (dollar-days) to get a blended
          // rate. DD offers use their actual round-trip dollar-days;
          // held offers use required funding × stated hold days.
          let weight;
          if (o.offerType === 'direct-deposit' || o.offerType === 'held-and-dd') {
            const ct = ddCapitalTime(o);
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
      horizonDays: optimizerHorizonDays
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
