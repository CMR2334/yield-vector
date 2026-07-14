import { addBusinessDays, addDays, addMonthsClamped, daysBetween, formatDateDisplay, isoDate, parseDate, previousBusinessDay } from './date-format-core.js';
import { ddRoundTrip, ddWindowEndDate, directDepositEffectiveDate, normalizeDdTransfer } from './dd-core.js';
import { generateProjection, summarizeProjection } from './projection-optimizer.js';
import { annualizedReturn, bizDayISO, debitDeadlineISO, depositDeadline, ddCapitalTime, expectedBonusWindow, isOfferComplete, lockStartDate, offerIsActiveForProjection, pathState, requirementActive, withdrawalEligibleDate, withdrawalInitiateDate, churnEligibleDate, hasGenuinePriorRun, churnNextEligibleAfterPlan, churnSnoozeActive } from './offer-model.js';
import { HYPOTHETICAL_OFFER_STATUSES, PRE_ACCOUNT_SUB_STATUSES } from './runtime-status.js';

/* ============================================================
   PURE PLANNER OPTIMIZER ENGINE
   ============================================================
   State snapshot in -> transient plan out. No DOM, App, Sync, render, localStorage,
   reminders, dd-widgets, or modal imports. All date, horizon, and ddTransfer
   inputs are explicit so repeated calls with identical inputs return identical
   plans.
   ============================================================ */

const EVAL_CAP = 50000;
const BEAM_WIDTH = 64;
const MAX_GRID_PER_OFFER = 12;
const MAX_OPTIMIZER_CANDIDATES = 20;
const HORIZON_MARGIN_DAYS = 30;
const HORIZON_CEILING_DAYS = 730;
const DEFAULT_WINDOW_DAYS = 180;
const ANN_EPSILON = 1e-9;

// Alternatives de-duplication thresholds. Two alternative plans are treated as
// the SAME scenario (one is folded into the earlier / better-ranked one) only
// when they share an offer set AND differ immaterially: low cash within this
// dollar noise band, completion within this many calendar days, and every
// per-offer date within this many business days. See rankAlternatives.
const ALT_LOW_CASH_NOISE = 500;
const ALT_COMPLETION_NOISE_DAYS = 5;
const ALT_NEAR_BIZ_DAYS = 3;

const TEMPLATE_TERMS_KEYS = [
  'bankName', 'offerName', 'offerType',
  'signupBonusAmount', 'offerExpirationDate',
  'requiredFundingAmount', 'daysAfterSignupAllowedBeforeDeposit', 'daysFundsMustRemain',
  'lockStartsFrom',
  'monthly_fee', 'fee_waiver_condition', 'promo_code',
  'early_termination_fee', 'etf_window_days',
  'bonus_post_min_days', 'bonus_post_max_days',
  'churnable', 'churn_wait_months', 'churn_anchor',
  'requirementLogic',
  'color', 'docUrl'
];

const OPTIMIZER_DEFAULTS = Object.freeze({
  maxDateGridPerOffer: MAX_GRID_PER_OFFER,
  beamWidth: BEAM_WIDTH,
  evalCap: EVAL_CAP,
  horizonMargin: HORIZON_MARGIN_DAYS,
  horizonCeiling: HORIZON_CEILING_DAYS,
  maxOptimizerCandidates: MAX_OPTIMIZER_CANDIDATES,
  defaultWindowDays: DEFAULT_WINDOW_DAYS,
  includeChurn: true,
  alternativeLimit: 8,
  allowEmptyPlan: true
});

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function byteCompare(a, b) {
  return String(a || '') < String(b || '') ? -1 : (String(a || '') > String(b || '') ? 1 : 0);
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort(byteCompare);
}

function maxISO(values) {
  const v = uniqueSorted(values);
  return v.length ? v[v.length - 1] : '';
}

function minISO(values) {
  const v = uniqueSorted(values);
  return v.length ? v[0] : '';
}

function addBusinessOffset(d, n) {
  if (n === 0) return d ? new Date(d) : null;
  if (!d) return null;
  let cur = new Date(d);
  if (n > 0) {
    for (let i = 0; i < n; i++) cur = addBusinessDays(cur, 1);
    return cur;
  }
  for (let i = 0; i < Math.abs(n); i++) cur = previousBusinessDay(addDays(cur, -1));
  return cur;
}

function addPeriod(d, every, count) {
  if (!d) return null;
  if (every === 'week') return addDays(d, 7 * count);
  if (every === '2weeks') return addDays(d, 14 * count);
  if (every === 'day') return addDays(d, count);
  return addMonthsClamped(d, count);
}

function localRequirementDeadlineISO(offer, row) {
  if (!offer || !row || row.done || row.deadline_days == null || row.deadline_days === '') return '';
  const signup = parseDate(offer.plannedSignupDate);
  const days = Number(row.deadline_days);
  if (!signup || !Number.isFinite(days)) return '';
  return isoDate(addDays(signup, days));
}

function nonCancelledCommitmentSourceIds(commitments) {
  const ids = new Set();
  for (const c of commitments || []) {
    if (!c || !c.sourceBonusOfferId || c.status === 'cancelled') continue;
    ids.add(c.sourceBonusOfferId);
  }
  return ids;
}

function dateValueSource(offer) {
  if (offer && offer.last_edited) {
    return {
      source: 'last_edited',
      dateISO: String(offer.last_edited).slice(0, 10),
      copy: `stored value from ${formatDateDisplay(String(offer.last_edited).slice(0, 10))} - unverified`
    };
  }
  if (offer && offer.templateSavedAt) {
    return {
      source: 'template',
      dateISO: String(offer.templateSavedAt).slice(0, 10),
      copy: `from saved template ${formatDateDisplay(String(offer.templateSavedAt).slice(0, 10))} - unverified`
    };
  }
  return {
    source: 'unknown',
    dateISO: '',
    copy: 'stored value - date unknown, unverified'
  };
}

function synthesizeChurnCandidate(source) {
  const id = `churn_${source.id}`;
  const offer = {
    id,
    bankName: '',
    offerName: '',
    offerType: 'new-funds-held',
    signupBonusAmount: null,
    offerExpirationDate: '',
    requiredFundingAmount: null,
    daysAfterSignupAllowedBeforeDeposit: 30,
    daysFundsMustRemain: null,
    ddRequirement: null,
    debitRequirement: { required: false, count: null, withinDays: null, byDate: '', byDateLegacy: '' },
    monthly_fee: null,
    fee_waiver_condition: '',
    promo_code: '',
    early_termination_fee: null,
    etf_window_days: null,
    bonus_post_min_days: null,
    bonus_post_max_days: null,
    churnable: source.churnable === true ? true : (source.churnable === false ? false : null),
    churn_wait_months: source.churn_wait_months == null ? null : source.churn_wait_months,
    churn_anchor: source.churn_anchor || 'bonus_received',
    churn_notes: '',
    // EITHER/OR: requirementLogic (a TERM) is copied from source by the
    // TEMPLATE_TERMS_KEYS loop below; plannedPath (personal) is deliberately
    // reset so a churn re-run of an either/or offer re-prompts for the path.
    requirementLogic: 'all',
    plannedPath: null,
    color: source.color || '',
    docUrl: source.docUrl || '',
    plannedSignupDate: '',
    optionalPlannedFundingDate: '',
    bonus_received_date: null,
    closed_date: null,
    lockStartsFrom: source.lockStartsFrom === 'open date' ? 'open date' : 'funded date',
    status: 'prospect',
    accountStatus: 'closed',
    subStatus: 'prospect',
    includeInScenario: true,
    confidence: 'likely',
    notes: source.bankName ? `Re-run of ${source.bankName}${source.offerName ? ' ' + source.offerName : ''}` : 'Re-run',
    entityUsed: '',
    emailUsed: '',
    directDeposits: [],
    last_edited: null
  };
  for (const k of TEMPLATE_TERMS_KEYS) {
    if (k in source) offer[k] = source[k];
  }
  offer.offerType = (offer.offerType && offer.offerType !== 'other') ? offer.offerType : 'new-funds-held';
  offer.ddRequirement = source.ddRequirement ? {
    mode: source.ddRequirement.mode === 'frequency' ? 'frequency' : 'count',
    count: source.ddRequirement.count == null ? null : Number(source.ddRequirement.count),
    freqEvery: source.ddRequirement.freqEvery || 'month',
    freqPeriods: source.ddRequirement.freqPeriods == null ? null : Number(source.ddRequirement.freqPeriods)
  } : null;
  offer.debitRequirement = source.debitRequirement ? {
    required: !!source.debitRequirement.required,
    count: source.debitRequirement.count == null ? null : Number(source.debitRequirement.count),
    withinDays: source.debitRequirement.withinDays == null ? null : Number(source.debitRequirement.withinDays),
    byDate: '',
    byDateLegacy: ''
  } : { required: false, count: null, withinDays: null, byDate: '', byDateLegacy: '' };
  const reqs = Array.isArray(source.requirements) ? source.requirements : [];
  offer.requirements = reqs
    .filter(r => r && r.source === 'user')
    .map((r, i) => ({
      id: `${id}_req_${i + 1}`,
      type: r.type || 'custom',
      label: r.label || '',
      amount: r.amount === undefined ? null : r.amount,
      count: r.count === undefined ? null : r.count,
      deadline_days: r.deadline_days === undefined ? null : r.deadline_days,
      frequency: r.frequency || 'total',
      hold_days: r.hold_days === undefined ? null : r.hold_days,
      source: 'user',
      done: false,
      done_date: null,
      notes: ''
    }));
  return offer;
}

function normalizeOptimizerInput(input = {}) {
  const settings = Object.assign({
    minimumCashBuffer: 0,
    currentLiquidCapital: 0,
    projectionStartDate: input.today || '1970-01-01',
    ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 }
  }, clone(input.settings || {}));
  const todayISO = isoDate(parseDate(input.today) || parseDate(settings.projectionStartDate) || parseDate('1970-01-01'));
  const todayDate = parseDate(todayISO);
  settings.projectionStartDate = settings.projectionStartDate || todayISO;
  settings.ddTransfer = normalizeDdTransfer(settings.ddTransfer);
  const options = Object.assign({}, OPTIMIZER_DEFAULTS, clone(input.options || {}));
  options.maxDateGridPerOffer = Math.max(1, Math.min(24, Number(options.maxDateGridPerOffer) || MAX_GRID_PER_OFFER));
  options.beamWidth = Math.max(1, Math.min(256, Number(options.beamWidth) || BEAM_WIDTH));
  options.evalCap = Math.max(1, Number(options.evalCap) || EVAL_CAP);
  options.horizonMargin = Math.max(0, Number(options.horizonMargin) || HORIZON_MARGIN_DAYS);
  options.horizonCeiling = Math.max(30, Number(options.horizonCeiling) || HORIZON_CEILING_DAYS);
  options.maxOptimizerCandidates = Math.max(1, Number(options.maxOptimizerCandidates) || MAX_OPTIMIZER_CANDIDATES);
  options.defaultWindowDays = Math.max(1, Number(options.defaultWindowDays) || DEFAULT_WINDOW_DAYS);
  const rawIds = input.candidateIds instanceof Set
    ? Array.from(input.candidateIds)
    : (Array.isArray(input.candidateIds) ? input.candidateIds : []);
  return {
    todayISO,
    todayDate,
    settings,
    ddTransfer: normalizeDdTransfer(settings.ddTransfer),
    offers: clone(input.offers || []),
    commitments: clone(input.commitments || []),
    events: clone(input.events || []),
    candidateIds: new Set(rawIds.map(String)),
    options
  };
}

function materializeDirectDeposits(offer, signupISO) {
  if (offer.offerType !== 'direct-deposit' && offer.offerType !== 'held-and-dd') return [];
  const existing = Array.isArray(offer.directDeposits) ? offer.directDeposits.filter(Boolean) : [];
  const signup = parseDate(signupISO);
  if (!signup) return existing.map(dd => clone(dd));
  const originalSignup = parseDate(offer.plannedSignupDate);
  if (existing.length && originalSignup) {
    const delta = daysBetween(originalSignup, signup);
    return existing.map((dd, i) => {
      const planned = parseDate(dd.plannedDate);
      return {
        id: dd.id || `${offer.id}_dd_${i + 1}`,
        amount: Number(dd.amount) || 0,
        plannedDate: planned ? isoDate(addDays(planned, delta)) : isoDate(addBusinessDays(signup, 1))
      };
    });
  }

  const req = offer.ddRequirement || {};
  const count = Math.max(1, Number(req.mode === 'frequency' ? req.freqPeriods : req.count) || existing.length || 1);
  const defaultAmount = count > 0 ? Math.round((Number(offer.requiredFundingAmount) || 0) / count) : 0;
  const dds = [];
  let cur = addBusinessDays(signup, 1);
  for (let i = 0; i < count; i++) {
    const ex = existing[i] || {};
    dds.push({
      id: ex.id || `${offer.id}_dd_${i + 1}`,
      amount: Number(ex.amount) || defaultAmount,
      plannedDate: ex.plannedDate && !originalSignup ? ex.plannedDate : isoDate(cur)
    });
    if (req.mode === 'frequency') cur = addPeriod(cur, req.freqEvery || 'month', 1);
    else cur = addBusinessDays(cur, 3);
  }
  return dds;
}

function applyDateGroup(record, signupISO) {
  const original = record.offer;
  const offer = clone(original);
  const signup = parseDate(signupISO);
  const originalSignup = parseDate(original.plannedSignupDate);
  offer.plannedSignupDate = signupISO;
  offer.includeInScenario = true;
  if (record.op === 'create') offer.status = 'prospect';

  if (offer.offerType === 'held-and-dd') {
    const oldFunding = parseDate(original.optionalPlannedFundingDate);
    let funding = signup;
    if (oldFunding && originalSignup) funding = addDays(oldFunding, daysBetween(originalSignup, signup));
    if (!funding || funding < signup) funding = signup;
    offer.optionalPlannedFundingDate = isoDate(funding);
  } else if (offer.offerType === 'new-funds-held' || !offer.offerType) {
    const oldFunding = parseDate(original.optionalPlannedFundingDate);
    if (oldFunding && originalSignup) {
      let funding = addDays(oldFunding, daysBetween(originalSignup, signup));
      if (funding < signup) funding = signup;
      offer.optionalPlannedFundingDate = isoDate(funding);
    } else {
      offer.optionalPlannedFundingDate = original.optionalPlannedFundingDate ? signupISO : '';
    }
  }

  offer.directDeposits = materializeDirectDeposits(offer, signupISO);
  return offer;
}

function candidateWindow(record, ctx) {
  const startCandidates = [ctx.todayISO, record.earliestISO].filter(Boolean);
  const start = maxISO(startCandidates);
  const expiry = record.offer.offerExpirationDate && parseDate(record.offer.offerExpirationDate)
    ? record.offer.offerExpirationDate
    : '';
  const end = expiry || isoDate(addDays(parseDate(start), ctx.options.defaultWindowDays));
  return { start, end };
}

function putAnchor(map, iso, priority) {
  if (!iso || !parseDate(iso)) return;
  const prev = map.get(iso);
  if (prev == null || priority < prev) map.set(iso, priority);
}

function addNeighborhood(map, iso, priority, startISO, endISO) {
  const d = parseDate(iso);
  if (!d) return;
  for (let off = -3; off <= 3; off++) {
    const nd = addBusinessOffset(d, off);
    const nISO = isoDate(nd);
    if (nISO && nISO >= startISO && nISO <= endISO) putAnchor(map, nISO, priority + Math.abs(off) * 0.01);
  }
}

function buildDateGrid(record, ctx) {
  const { start, end } = candidateWindow(record, ctx);
  if (!parseDate(start) || !parseDate(end) || end < start) return [];
  const anchors = new Map();
  putAnchor(anchors, start, 0);
  putAnchor(anchors, end, 0.2);
  putAnchor(anchors, record.offer.plannedSignupDate, 0.5);

  const oldDeposit = depositDeadline(Object.assign({}, record.offer, { plannedSignupDate: record.offer.plannedSignupDate || start }));
  putAnchor(anchors, oldDeposit, 1);
  for (const e of ctx.events || []) {
    if (e && e.includeInProjection !== false) putAnchor(anchors, e.date, 1.2);
  }
  for (const o of ctx.offers || []) {
    if (!o || o.id === record.sourceOfferId || o.id === record.offer.id) continue;
    const we = withdrawalEligibleDate(o, ctx.ddTransfer);
    if (we) putAnchor(anchors, we, 1.3);
  }

  const startDate = parseDate(start);
  let monday = new Date(startDate);
  for (let guard = 0; guard < 14 && monday.getDay() !== 1; guard++) monday = addDays(monday, 1);
  for (let n = 0; n < 6; n++) {
    const mISO = isoDate(addDays(monday, n * 7));
    if (mISO >= start && mISO <= end) putAnchor(anchors, mISO, 1.4);
  }

  const neighborhood = new Map();
  for (const [iso, priority] of anchors.entries()) addNeighborhood(neighborhood, iso, priority, start, end);
  for (let cur = parseDate(start), i = 0; cur && isoDate(cur) <= end && i < 120; cur = addDays(cur, 7), i++) {
    putAnchor(neighborhood, isoDate(cur), 3);
  }

  const prioritized = Array.from(neighborhood.entries())
    .filter(([iso]) => iso >= start && iso <= end && iso >= ctx.todayISO)
    .sort((a, b) => (a[1] - b[1]) || byteCompare(a[0], b[0]))
    .slice(0, ctx.options.maxDateGridPerOffer)
    .map(([iso]) => iso);
  return uniqueSorted(prioritized);
}

function buildCoarseGrid(record, ctx) {
  const { start, end } = candidateWindow(record, ctx);
  if (!parseDate(start) || !parseDate(end) || end < start) return [];
  const out = [start, end];
  const span = Math.max(1, daysBetween(parseDate(start), parseDate(end)));
  const slots = Math.min(4, Math.max(1, Math.floor(span / 14)));
  for (let i = 1; i <= slots; i++) out.push(isoDate(addDays(parseDate(start), Math.round(span * i / (slots + 1)))));
  return uniqueSorted(out).filter(iso => iso >= ctx.todayISO).slice(0, 6);
}

function buildCandidateRecords(ctx) {
  const commitmentLinked = nonCancelledCommitmentSourceIds(ctx.commitments);
  const records = [];
  const review = [];
  const explicit = ctx.candidateIds.size > 0;
  for (const offer of ctx.offers || []) {
    if (!offer || !offer.id) continue;
    const requested = explicit ? ctx.candidateIds.has(offer.id) : HYPOTHETICAL_OFFER_STATUSES.has(offer.status);
    if (!requested) continue;
    if (commitmentLinked.has(offer.id)) {
      review.push({ offerId: offer.id, status: 'excluded', reason: 'commitment-linked' });
      continue;
    }
    const record = {
      id: offer.id,
      op: 'update',
      offer: clone(offer),
      originalOfferId: offer.id,
      sourceOfferId: offer.id,
      earliestISO: ctx.todayISO,
      badges: []
    };
    if (Array.isArray(offer.tiers) && offer.tiers.length > 0) {
      record.badges.push({ kind: 'tiered-unselected', copy: 'tier ladder present - stored bonus used' });
    }
    records.push(record);
  }

  if (ctx.options.includeChurn !== false) {
    for (const source of ctx.offers || []) {
      if (!source || !source.id || source.churnable !== true) continue;
      // ISSUE 2(a) (owner-directed 2026-07-10): a churn re-run source must have a
      // GENUINELY COMPLETED prior run. A pre-account prospect/applied (never
      // opened — its accountStatus is auto-set to 'closed', which is NOT a real
      // closure) is NOT a churn source and must not be made to demand a
      // closed_date; it is already handled as a normal candidate above. Skip it
      // SILENTLY (no review row) so its real needs surface through normal
      // candidacy, not an aimless "needs a date to re-run".
      if (!hasGenuinePriorRun(source)) continue;
      if (churnSnoozeActive(source, ctx.todayDate)) {
        review.push({ offerId: source.id, status: 'excluded', reason: 'churn-snoozed' });
        continue;
      }
      const eligible = churnEligibleDate(source);
      if (!eligible) {
        // A genuine prior run whose churn-anchor date isn't recorded yet: name the
        // EXACT date owed (ISSUE 2(b)) via the source's churn_anchor.
        review.push({ offerId: source.id, status: 'needs-date', reason: 'missing-churn-anchor', anchor: source.churn_anchor || 'bonus_received' });
        continue;
      }
      if (commitmentLinked.has(source.id)) {
        review.push({ offerId: source.id, status: 'excluded', reason: 'commitment-linked' });
        continue;
      }
      const offer = synthesizeChurnCandidate(source);
      const badge = dateValueSource(source);
      const record = {
        id: offer.id,
        op: 'create',
        offer,
        originalOfferId: offer.id,
        sourceOfferId: source.id,
        earliestISO: maxISO([ctx.todayISO, eligible]),
        badges: [{ kind: 'unverified-churn-value', source: badge.source, dateISO: badge.dateISO, copy: badge.copy }]
      };
      if (Array.isArray(source.tiers) && source.tiers.length > 0) {
        record.badges.push({ kind: 'tiered-unselected', copy: 'tier ladder present - stored bonus used' });
      }
      records.push(record);
    }
  }

  records.sort((a, b) => byteCompare(a.id, b.id));
  for (const r of records) {
    r.grid = buildDateGrid(r, ctx);
    r.coarseGrid = buildCoarseGrid(r, ctx);
    if (!r.grid.length) review.push({ offerId: r.id, status: 'excluded', reason: 'no-valid-date-window' });
  }
  return { records: records.filter(r => r.grid.length), review };
}

function validateDdCadence(offer, constraints, ctx) {
  // EITHER/OR: only validate DD cadence when the DD path is active. For
  // logic='all' `ddActive` reduces to the DD-family test, so behavior is
  // unchanged; when the debit path is chosen, DD cadence is not a constraint.
  if (!pathState(offer).ddActive) return;
  const req = offer.ddRequirement || {};
  const dds = (offer.directDeposits || []).filter(dd => dd && dd.plannedDate);
  const signup = parseDate(offer.plannedSignupDate);
  if (!signup) {
    constraints.push({ offerId: offer.id, kind: 'dd-window', dateISO: '' });
    return;
  }
  if (!dds.length) {
    constraints.push({ offerId: offer.id, kind: 'dd-window', dateISO: offer.plannedSignupDate });
    return;
  }
  // Qualification compares the ACH POST date (initiate + inDays business days —
  // the day the DD actually lands and counts at the bank), NOT the weekend/
  // holiday-only effective date. A late initiation whose money posts past a
  // cutoff/window is therefore correctly rejected (deadline-direction fix,
  // 2026-07-09). cfg is the SAME explicit ddTransfer the engine threads
  // everywhere — never the live provider. Read ctx.ddTransfer DIRECTLY (ctx is
  // always the normalized engine context on this path, so ddTransfer is always
  // present): a missing cfg must fail LOUD rather than let ddRoundTrip silently
  // fall back to the live provider / 1-1-1 default and defeat the fix (C1/C4).
  const cfg = ctx.ddTransfer;
  const postISO = dd => { const rt = ddRoundTrip(dd, cfg); return rt ? isoDate(rt.post) : ''; };
  const cutoffCandidates = [];
  if (offer.offerExpirationDate) cutoffCandidates.push(offer.offerExpirationDate);
  // QUALIFICATION PATHS: a non-chosen-path requirement doesn't cut off DDs. The
  // `logic==='all'` short-circuit keeps this loop allocation-free on the beam hot
  // path (every row active — byte-identical to before).
  const eoAny = pathState(offer).logic === 'any';
  for (const row of offer.requirements || []) {
    if (eoAny && !requirementActive(offer, row)) continue;
    const dl = localRequirementDeadlineISO(offer, row);
    if (dl) cutoffCandidates.push(dl);
  }
  const cutoff = minISO(cutoffCandidates);

  if (req.mode === 'frequency') {
    const periods = Math.max(1, Number(req.freqPeriods) || 1);
    if (dds.length < periods) constraints.push({ offerId: offer.id, kind: 'dd-window', dateISO: ddWindowEndDate(offer, cfg) });
    const end = ddWindowEndDate(offer, cfg); // literal frequency window end (formula unchanged)
    const posts = dds.map(postISO).filter(Boolean).sort(byteCompare);
    for (const post of posts) {
      if (post < offer.plannedSignupDate || (end && post > end)) constraints.push({ offerId: offer.id, kind: 'dd-window', dateISO: post });
    }
    for (let i = 0; i < periods; i++) {
      const pStart = isoDate(addPeriod(signup, req.freqEvery || 'month', i));
      const pEnd = i === periods - 1 ? end : isoDate(addPeriod(signup, req.freqEvery || 'month', i + 1));
      const has = posts.some(post => post >= pStart && (!pEnd || (i === periods - 1 ? post <= pEnd : post < pEnd)));
      if (!has) constraints.push({ offerId: offer.id, kind: 'dd-window', dateISO: pStart });
    }
    // Apply the user/expiry cutoffs in frequency mode too (previously built into
    // cutoffCandidates but NEVER enforced here) — a DD posting past a user-
    // requirement or offer-expiry deadline disqualifies exactly as in count mode.
    if (cutoff) for (const post of posts) {
      if (post > cutoff) constraints.push({ offerId: offer.id, kind: 'dd-post-late', dateISO: post });
    }
    return;
  }

  const needed = Math.max(1, Number(req.count) || 1);
  if (dds.length < needed) constraints.push({ offerId: offer.id, kind: 'dd-window', dateISO: cutoff || offer.offerExpirationDate || '' });
  for (const dd of dds) {
    const post = postISO(dd);
    if (!post) constraints.push({ offerId: offer.id, kind: 'dd-window', dateISO: '' });
    if (post && cutoff && post > cutoff) constraints.push({ offerId: offer.id, kind: 'dd-post-late', dateISO: post });
  }
}

function validateOfferQualification(offer, ctx) {
  const constraints = [];
  const ps = pathState(offer);
  // EITHER/OR: an offer that can be met either way but has no chosen path is
  // NOT silently modeled — it always binds with a 'needs-path' constraint (never
  // valid) and surfaces a specific review row (P2-3: the optimizer never picks
  // the path). No-op for logic='all' (needsPath is false).
  if (ps.needsPath) {
    constraints.push({ offerId: offer.id, kind: 'needs-path', dateISO: '' });
  }
  if (!offer.plannedSignupDate || offer.plannedSignupDate < ctx.todayISO) {
    constraints.push({ offerId: offer.id, kind: 'schedule-before-today', dateISO: offer.plannedSignupDate || '' });
  }
  if (offer.offerExpirationDate && offer.plannedSignupDate && offer.plannedSignupDate > offer.offerExpirationDate) {
    constraints.push({ offerId: offer.id, kind: 'expiry', dateISO: offer.offerExpirationDate });
  }
  if (offer.offerType !== 'direct-deposit' && offer.daysAfterSignupAllowedBeforeDeposit != null) {
    const deadline = depositDeadline(offer);
    const funding = bizDayISO(offer.optionalPlannedFundingDate || offer.plannedSignupDate);
    if (deadline && funding && funding > deadline) constraints.push({ offerId: offer.id, kind: 'deposit-deadline', dateISO: deadline });
  }
  // EITHER/OR: the debit deadline binds only when the debit path is active
  // (logic='all' → debitActive === debitRequirement.required, unchanged).
  if (ps.debitActive) {
    const dd = debitDeadlineISO(offer);
    if (!dd || dd < ctx.todayISO) constraints.push({ offerId: offer.id, kind: 'debit-deadline', dateISO: dd || '' });
  }
  const eoAny = ps.logic === 'any';
  for (const row of offer.requirements || []) {
    if (!row || row.done || row.source !== 'user') continue;
    // QUALIFICATION PATHS: skip non-chosen-path rows (byte-identical for 'all',
    // short-circuited so the hot path never calls requirementActive there).
    if (eoAny && !requirementActive(offer, row)) continue;
    const dl = localRequirementDeadlineISO(offer, row);
    if (dl && dl < ctx.todayISO) constraints.push({ offerId: offer.id, kind: 'requirement-deadline', dateISO: dl });
  }
  validateDdCadence(offer, constraints, ctx);
  if (!isOfferComplete(offer)) constraints.push({ offerId: offer.id, kind: 'completeness', dateISO: offer.plannedSignupDate || '' });
  return constraints;
}

// Qualification-timing reasons worth a dedicated "Not in this plan" review row
// (item 2, R83 gap). A candidate that clears build (has a date grid) but is
// dropped by the VALIDATOR at EVERY schedulable date — while a valid alternative
// outranks it — otherwise vanishes silently. `completeness` / `schedule-before-
// today` are intentionally excluded: a draft/incomplete offer is surfaced by the
// Offers "needs info" chip + draft banner, not this timing review.
const VALIDATOR_REVIEW_KINDS = new Set([
  'dd-post-late', 'dd-window', 'deposit-deadline', 'debit-deadline', 'requirement-deadline', 'expiry',
  'needs-path'
]);

// PURE. For each candidate record NOT in the FINAL plan, decide whether it is
// absent because the qualification validator rejects it at EVERY schedulable
// date (a hard timing failure, independent of cash/other offers) and, if so,
// emit a review row carrying the specific reason. TRUTHFUL by construction:
//   • an offer IN the final plan is skipped (obviously not excluded);
//   • an offer that qualifies at ANY grid date is skipped — it is absent only
//     because a rejected candidate schedule lost on cash/ranking, NOT the
//     validator (the reason it is absent from the FINAL plan is not a hard
//     timing gap, so surfacing one would misrepresent it).
// The surfaced reason is drawn from the date CLOSEST to qualifying (fewest
// constraints), preferring a timing kind — the most actionable nudge. Rows are
// build-order deterministic (records are id-sorted; grid dates are sorted).
function captureValidatorExclusions(ctx, records, plan) {
  const included = new Set((plan && plan.includedIds) || []);
  const rows = [];
  for (const r of records || []) {
    if (included.has(r.id)) continue;
    let qualifies = false;
    let reason = null;
    let reasonScore = Infinity;
    for (const iso of r.grid || []) {
      const cons = validateOfferQualification(applyDateGroup(r, iso), ctx);
      if (!cons.length) { qualifies = true; break; }
      if (cons.length < reasonScore) {
        const hit = cons.find(c => VALIDATOR_REVIEW_KINDS.has(c.kind));
        if (hit) { reason = hit; reasonScore = cons.length; }
      }
    }
    if (qualifies || !reason) continue;
    rows.push({ offerId: r.id, status: 'excluded', reason: reason.kind, dateISO: reason.dateISO || '' });
  }
  return rows;
}

function horizonDatesForOffer(offer, ctx) {
  const dates = [];
  const push = iso => { if (iso && parseDate(iso)) dates.push(iso); };
  // EITHER/OR: only the active path's dates extend the horizon (else a debit-path
  // candidate is horizon-extended/exceeded on inactive DDs — Codex P1). For
  // logic='all' `ddActive`/`debitActive` reduce to today's tests, so unchanged.
  const ps = pathState(offer);
  push(lockStartDate(offer));                          // already '' for a debit-path DD offer
  push(withdrawalEligibleDate(offer, ctx.ddTransfer)); // idem
  push(depositDeadline(offer));
  if (ps.debitActive) push(debitDeadlineISO(offer));
  if (ps.ddActive) push(ddWindowEndDate(offer, ctx.ddTransfer));
  const win = expectedBonusWindow(offer, ctx.todayDate);
  if (win) push(win.endISO);
  // QUALIFICATION PATHS: only active-path requirement deadlines extend the
  // horizon (byte-identical for 'all' — every row active; short-circuited so the
  // hot path skips requirementActive under 'all').
  const eoAny = ps.logic === 'any';
  for (const row of offer.requirements || []) if (!eoAny || requirementActive(offer, row)) push(localRequirementDeadlineISO(offer, row));
  if (ps.ddActive) for (const dd of offer.directDeposits || []) {
    const rt = ddRoundTrip(dd, ctx.ddTransfer);
    if (rt) push(isoDate(rt.returnDate));
    push(directDepositEffectiveDate(dd));
  }
  return dates;
}

function computePlanHorizon(ctx, evaluatedOffers) {
  const projectionStart = parseDate(ctx.settings.projectionStartDate) || ctx.todayDate;
  let latest = projectionStart;
  let offender = null;
  for (const offer of evaluatedOffers || []) {
    for (const iso of horizonDatesForOffer(offer, ctx)) {
      const d = parseDate(iso);
      if (d && d > latest) {
        latest = d;
        offender = { offerId: offer.id, dateISO: iso };
      }
    }
  }
  const withMargin = addDays(latest, ctx.options.horizonMargin);
  const rawDays = Math.max(30, daysBetween(projectionStart, withMargin));
  if (rawDays > ctx.options.horizonCeiling) {
    return {
      ok: false,
      horizonDays: ctx.options.horizonCeiling,
      reason: 'horizon-exceeded',
      offender
    };
  }
  return { ok: true, horizonDays: rawDays, reason: '', offender: null };
}

function scheduleForOffer(offer, op, cfg) {
  return {
    op,
    plannedSignupDate: offer.plannedSignupDate || '',
    optionalPlannedFundingDate: offer.optionalPlannedFundingDate || '',
    // Per-offer sign-up bonus the optimizer actually scored for this offer (the
    // materialized candidate's value — for a churn re-run this is the synthesized
    // offer, not the stored source). Rendered on the sequence card (lower-right).
    bonus: Math.round(Number(offer.signupBonusAmount) || 0),
    // EITHER/OR: a debit-path offer schedules no DDs (its stored rows are kept
    // for reference but are not part of the plan identity — canonical vector).
    directDeposits: (pathState(offer).ddActive ? (offer.directDeposits || []) : [])
      .map(dd => ({ id: dd.id || '', plannedDate: dd.plannedDate || '' }))
      .sort((a, b) => byteCompare(a.id, b.id)),
    derived: {
      lockStart: lockStartDate(offer) || '',
      withdrawalEligible: withdrawalEligibleDate(offer, cfg) || '',
      depositDeadline: depositDeadline(offer) || ''
    }
  };
}

// Per-offer capital-release contributions for the owner Clause-B tail test:
// [{ releaseISO, dollarDays }] — the dollar-days (money × time held) each tranche
// ties up, attributed to the date that tranche's capital RETURNS. Mirrors
// ddCapitalTime's math but SPLIT by release date so the tail reflects only the
// capital still held until the plan's final date (Codex 2026-07-13 P2): a standard
// multi-DD offer's earlier DDs round-trip back earlier, so only the LAST DD's leg
// lands on the offer's withdrawal-eligible (final) date — the aggregate must NOT
// all be attributed to it. held-and-dd + held/other release ALL their capital at
// the single withdrawal-eligible date (their capital stays put until then), so a
// single contribution is correct. Path-aware exactly like ddCapitalTime (a
// debit-path offer's DDs tie up no capital-time).
function offerReleaseWeights(offer, cfg) {
  const out = [];
  const ddActive = pathState(offer).ddActive;
  if (offer.offerType === 'direct-deposit') {
    if (!ddActive) return out;
    for (const dd of (offer.directDeposits || [])) {
      if (!dd || !dd.plannedDate || !(Number(dd.amount) > 0)) continue;
      const rt = ddRoundTrip(dd, cfg);
      if (!rt || rt.heldDays <= 0) continue;
      out.push({ releaseISO: isoDate(rt.returnDate), dollarDays: Number(dd.amount) * rt.heldDays });
    }
    return out;
  }
  const weISO = withdrawalEligibleDate(offer, cfg);
  const we = parseDate(weISO);
  if (!we) return out;
  if (offer.offerType === 'held-and-dd') {
    const fundStart = parseDate(lockStartDate(offer));
    const fundAmt = Number(offer.requiredFundingAmount) || 0;
    if (fundStart && fundAmt > 0) {
      const heldDays = daysBetween(fundStart, we);
      if (heldDays > 0) out.push({ releaseISO: weISO, dollarDays: fundAmt * heldDays });
    }
    if (ddActive) for (const dd of (offer.directDeposits || [])) {
      if (!dd || !dd.plannedDate || !(Number(dd.amount) > 0)) continue;
      const eff = parseDate(directDepositEffectiveDate(dd));
      if (!eff) continue;
      const held = daysBetween(eff, we);
      if (held > 0) out.push({ releaseISO: weISO, dollarDays: Number(dd.amount) * held });
    }
    return out;
  }
  // new-funds-held / other: single held lump released at the withdrawal date.
  const ls = parseDate(lockStartDate(offer));
  const days = ls ? Math.max(0, daysBetween(ls, we)) : Number(offer.daysFundsMustRemain || 0);
  const amt = Number(offer.requiredFundingAmount || 0);
  if (amt > 0 && days > 0) out.push({ releaseISO: weISO, dollarDays: amt * days });
  return out;
}

function objectiveForOffers(offers, cfg) {
  let grossBonus = 0;
  let annNum = 0;
  let annDen = 0;
  let latestCompletionISO = '';
  const churnNextEligible = [];
  // Per-tranche (release date, dollar-day) contributions — the raw material for
  // the owner Clause-B "late materially-weighted tail" test (split by release
  // date via offerReleaseWeights, NOT the offer-level aggregate).
  const releaseWeights = [];
  for (const offer of offers || []) {
    grossBonus += Number(offer.signupBonusAmount) || 0;
    const nextChurn = churnNextEligibleAfterPlan(offer, cfg);
    if (nextChurn) churnNextEligible.push(nextChurn);
    const ar = annualizedReturn(offer, cfg);
    let weight = 0;
    if (offer.offerType === 'direct-deposit' || offer.offerType === 'held-and-dd') {
      const ct = ddCapitalTime(offer, cfg);
      weight = ct ? ct.dollarDays : 0;
    } else {
      // QUALIFICATION PATHS: a debit-path new-funds-held ties up no held capital,
      // so it carries zero objective weight. The daysFundsMustRemain fallback
      // below would otherwise weight it off a hold it isn't doing; gate on
      // holdActive (byte-identical for logic='all' — held types stay weighted).
      if (pathState(offer).holdActive) {
        const ls = parseDate(lockStartDate(offer));
        const we = parseDate(withdrawalEligibleDate(offer, cfg));
        const days = ls && we ? Math.max(0, daysBetween(ls, we)) : Number(offer.daysFundsMustRemain || 0);
        weight = Number(offer.requiredFundingAmount || 0) * days;
      }
    }
    if (ar != null && weight > 0) {
      annNum += ar * weight;
      annDen += weight;
    }
    for (const c of offerReleaseWeights(offer, cfg)) releaseWeights.push(c);
    const we = withdrawalEligibleDate(offer, cfg);
    if (we && (!latestCompletionISO || we > latestCompletionISO)) latestCompletionISO = we;
  }
  // Dollar-day share of the plan's capital that releases ON the final
  // (capital-back) date. totalWeight over ALL tranches' dollar-days; tailWeight
  // over the tranche(s) whose release date equals latestCompletionISO.
  let totalWeight = 0;
  let tailWeight = 0;
  for (const rw of releaseWeights) {
    totalWeight += rw.dollarDays;
    if (rw.releaseISO && rw.releaseISO === latestCompletionISO) tailWeight += rw.dollarDays;
  }
  return {
    grossBonus: Math.round(grossBonus),
    blendedAnnReturn: annDen > 0 ? annNum / annDen : null,
    latestCompletionISO,
    // Owner Clause-B input (2026-07-13): fraction of plan dollar-days released on
    // the final capital-back date. 0 when the plan holds no dollar-day weight.
    tailWeightFraction: totalWeight > 0 ? tailWeight / totalWeight : 0,
    // Sorted vector of next churn-eligibility dates for the churn-flagged
    // included offers — the deterministic key the throughput tie-breaker reads
    // (comparePlans). Empty when no included offer is churnable (neutral).
    churnNextEligible: churnNextEligible.sort(byteCompare)
  };
}

function canonicalPlanVector(schedule) {
  const ids = Object.keys(schedule || {}).sort(byteCompare);
  const parts = [ids.join(',')];
  for (const id of ids) {
    const s = schedule[id] || {};
    parts.push(id, s.plannedSignupDate || '', s.optionalPlannedFundingDate || '');
    const dds = Array.isArray(s.directDeposits) ? s.directDeposits.slice().sort((a, b) => byteCompare(a.id, b.id)) : [];
    for (const dd of dds) parts.push(dd.id || '', dd.plannedDate || '');
  }
  return JSON.stringify(parts);
}

function invalidPlan(ctx, reason, bindingConstraints = [], extra = {}) {
  const schedule = {};
  return Object.assign({
    valid: false,
    reasons: [reason],
    includeSet: new Set(),
    includedIds: [],
    schedule,
    createdOfferIds: [],
    capitalCurveSummary: {
      lowestAvailable: Number(ctx.settings.currentLiquidCapital) || 0,
      lowestDateISO: ctx.settings.projectionStartDate || ctx.todayISO,
      belowBufferDays: 0,
      shortfallDays: 0,
      horizonDays: 0
    },
    bindingConstraints,
    objective: { grossBonus: 0, blendedAnnReturn: null, latestCompletionISO: '', tailWeightFraction: 0 },
    badges: {},
    alternatives: [],
    champions: [],
    evaluated: 0,
    strategy: 'none',
    earlyOut: false,
    canonicalVector: canonicalPlanVector(schedule)
  }, extra);
}

function evaluateAssignment(ctx, records, assignment) {
  const selected = [];
  const selectedOffers = [];
  const schedule = {};
  const badges = {};
  const createdOfferIds = [];
  const includedIds = [];
  const candidateOriginalIds = new Set(records.map(r => r.originalOfferId));

  for (const record of records) {
    const signupISO = assignment[record.id];
    if (!signupISO) continue;
    const offer = applyDateGroup(record, signupISO);
    selected.push(record);
    selectedOffers.push(offer);
    schedule[offer.id] = scheduleForOffer(offer, record.op, ctx.ddTransfer);
    badges[offer.id] = record.badges || [];
    includedIds.push(offer.id);
    if (record.op === 'create') createdOfferIds.push(offer.id);
  }

  const baseline = (ctx.offers || [])
    .filter(o => o && !candidateOriginalIds.has(o.id) && offerIsActiveForProjection(o))
    .map(o => clone(o));
  const evaluatedOffers = baseline.concat(selectedOffers);
  const includedOfferIds = baseline.map(o => o.id).concat(selectedOffers.map(o => o.id));

  const bindingConstraints = [];
  for (const offer of selectedOffers) {
    bindingConstraints.push(...validateOfferQualification(offer, ctx));
  }

  const horizon = computePlanHorizon(ctx, evaluatedOffers);
  if (!horizon.ok) {
    const bc = {
      offerId: horizon.offender ? horizon.offender.offerId : '',
      kind: 'horizon-exceeded',
      dateISO: horizon.offender ? horizon.offender.dateISO : ''
    };
    const objective = objectiveForOffers(selectedOffers, ctx.ddTransfer);
    return invalidPlan(ctx, 'horizon-exceeded', bindingConstraints.concat([bc]), {
      includeSet: new Set(includedIds),
      includedIds: includedIds.sort(byteCompare),
      schedule,
      createdOfferIds,
      objective,
      badges,
      canonicalVector: canonicalPlanVector(schedule)
    });
  }

  const projectionState = {
    settings: Object.assign({}, ctx.settings),
    offers: evaluatedOffers,
    commitments: ctx.commitments,
    events: ctx.events
  };
  const projection = generateProjection(projectionState, {
    includedOfferIds,
    horizonDays: horizon.horizonDays,
    ddTransfer: ctx.ddTransfer
  });
  const summary = summarizeProjection(projection, projectionState.settings);
  const lowest = summary.lowest || {};
  if (summary.shortfallDays > 0) {
    bindingConstraints.push({ offerId: '', kind: 'buffer-floor', dateISO: lowest.dateISO || '' });
  } else if (summary.belowBufferDays > 0) {
    bindingConstraints.push({ offerId: '', kind: 'buffer-floor', dateISO: lowest.dateISO || '' });
  }

  const qualified = bindingConstraints.length === 0;
  const cashFeasible = summary.shortfallDays === 0 && summary.belowBufferDays === 0;
  const reasons = [];
  if (!cashFeasible) reasons.push('cash-infeasible');
  if (!qualified) reasons.push('qualification-failed');
  const objective = objectiveForOffers(selectedOffers, ctx.ddTransfer);
  const capitalCurveSummary = {
    lowestAvailable: lowest.availableCapital == null ? Number(ctx.settings.currentLiquidCapital) || 0 : lowest.availableCapital,
    lowestDateISO: lowest.dateISO || ctx.settings.projectionStartDate || ctx.todayISO,
    belowBufferDays: summary.belowBufferDays || 0,
    shortfallDays: summary.shortfallDays || 0,
    horizonDays: horizon.horizonDays
  };

  return {
    valid: cashFeasible && qualified,
    reasons,
    includeSet: new Set(includedIds),
    includedIds: includedIds.sort(byteCompare),
    schedule,
    createdOfferIds,
    capitalCurveSummary,
    bindingConstraints,
    objective,
    badges,
    alternatives: [],
    evaluated: 1,
    strategy: 'single',
    earlyOut: false,
    canonicalVector: canonicalPlanVector(schedule)
  };
}

// Per-plan throughput key. A plan WITH churnable included offers keys on its
// sorted next-churn-eligibility vector; a plan WITHOUT churnables keys on a
// single-element [cash-release] proxy (the date its capital frees). Every plan
// therefore gets a REAL, comparable key — a bare "empty vector ⇒ neutral 0"
// short-circuit is non-transitive once the cash-release fallback runs (a
// churnless plan could sit between two churnable plans that the vector orders the
// other way, cycling the sort). Because a churnable offer's next-eligibility is
// always its own cash-release + churn_wait (strictly later), a churnless plan's
// cash-release proxy never demotes it below a churnable plan that frees capital
// later — so a plan is never penalized for having no/fewer churnables.
function planThroughputKey(plan) {
  const v = (plan.objective && plan.objective.churnNextEligible) || [];
  if (v.length) return v;
  return [(plan.objective && plan.objective.latestCompletionISO) || '9999-12-31'];
}

// Lexicographic compare of two plans' throughput keys — earlier next-eligibility
// (or capital-back, for a churnless plan) ranks first. TOTAL order + deterministic
// (byteCompare on ISO strings): on a shared prefix the shorter key (fewer
// churnables) sorts first, so it is never penalized. The caller only reaches here
// on a gross+APY tie.
function compareChurnThroughput(a, b) {
  const va = planThroughputKey(a);
  const vb = planThroughputKey(b);
  const n = Math.min(va.length, vb.length);
  for (let i = 0; i < n; i++) {
    if (va[i] !== vb[i]) return byteCompare(va[i], vb[i]);
  }
  return va.length - vb.length;
}

function comparePlans(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  if (a.valid !== b.valid) return a.valid ? -1 : 1;
  const ag = Math.round(a.objective.grossBonus || 0);
  const bg = Math.round(b.objective.grossBonus || 0);
  if (ag !== bg) return bg - ag;
  const aa = Math.round(((a.objective.blendedAnnReturn == null ? -Infinity : a.objective.blendedAnnReturn) / ANN_EPSILON)) * ANN_EPSILON;
  const ba = Math.round(((b.objective.blendedAnnReturn == null ? -Infinity : b.objective.blendedAnnReturn) / ANN_EPSILON)) * ANN_EPSILON;
  if (aa !== ba) return ba > aa ? 1 : -1;
  // Churn-throughput tie-breaker: among plans tied on gross bonus AND blended
  // return, prefer the one whose churnable included offers reach their next
  // churn-eligibility sooner (higher throughput — cycle them again faster). A
  // churnless plan keys on its cash-release date, so it is never penalized and
  // the comparator stays a total, transitive order. Deterministic.
  const ct = compareChurnThroughput(a, b);
  if (ct !== 0) return ct;
  const ac = a.objective.latestCompletionISO || '9999-12-31';
  const bc = b.objective.latestCompletionISO || '9999-12-31';
  if (ac !== bc) return byteCompare(ac, bc);
  return byteCompare(a.canonicalVector, b.canonicalVector);
}

// ── Named champion plans (CONSTRAINED redesign, owner-directed 2026-07-09) ────
// Drawn from the SAME evaluated feasible pool (no new search). The headline
// "Best total return" plan is always the default/selected plan and always the
// first champion (when any ≥1-offer feasible plan exists). A SECONDARY champion
// (rate / fastest) is offered ONLY when it competes NEAR THE TOP of total return
// AND beats the headline plan on its own axis by a MATERIAL margin — otherwise
// the axis degenerates to a trivial single-offer answer, the owner's exact
// objection to the unconstrained 09k design ("return a single offer I entered
// myself"). Gates on every secondary (documented named constants below; NOT a
// user setting):
//   (a) ≥ 1 offer          — the 0-offer "do nothing" plan is NEVER a champion
//                            (also the headline; fixes the 09l reviewer NIT that
//                            a lone empty plan could surface as a champion card).
//   (b) gross ≥ THRESHOLD×best — must earn near the top of total return.
//   (c) genuinely distinct — post-09i dedup (alternativeCollapses) vs the
//                            headline, and never the same canonicalVector.
//   (d) material axis margin — rate: blended APY better by ≥ RATE_MATERIAL_PP
//                            percentage points; fastest: final capital-release
//                            ≥ FASTEST_MATERIAL_DAYS days earlier.
// Each secondary champion carries a PURE `trade` = { grossDelta, apyDeltaPp,
// daysSooner } (arithmetic vs the headline plan) that the card renders as an
// explicit trade line ("+9.2% APY · -$450 vs best"). Two secondaries that
// resolve to the SAME plan merge into ONE entry carrying both labels (the rare
// case a single qualifying plan wins both secondary axes). Pure + deterministic
// (each axis breaks ties through comparePlans, a total order), so pin-testable.
const CHAMPION_GROSS_THRESHOLD = 0.85;      // (b) secondary must reach ≥85% of best gross
const CHAMPION_RATE_MATERIAL_PP = 0.02;     // (d) blended APY better by ≥2 percentage points
const CHAMPION_FASTEST_MATERIAL_DAYS = 7;   // (d) final capital-release ≥7 days earlier

function championRate(p) {
  const r = p && p.objective ? p.objective.blendedAnnReturn : null;
  return r == null ? -Infinity : r;
}

// Best RATE: highest blended annualized return first; ties fall through the full
// comparePlans chain so the pick is deterministic.
function compareByRate(a, b) {
  const ra = championRate(a);
  const rb = championRate(b);
  if (ra !== rb) return rb > ra ? 1 : -1;
  return comparePlans(a, b);
}

// FASTEST capital back: earliest final capital-release date first; ties fall
// through comparePlans (gross, then the standard chain) per the owner spec.
function compareByFastest(a, b) {
  const ca = (a && a.objective && a.objective.latestCompletionISO) || '9999-12-31';
  const cb = (b && b.objective && b.objective.latestCompletionISO) || '9999-12-31';
  if (ca !== cb) return byteCompare(ca, cb);
  return comparePlans(a, b);
}

// Secondary axes only — the headline "total" plan is added first, unconditionally
// (when a ≥1-offer feasible plan exists). Ordered rate → fastest.
const CHAMPION_SECONDARY_AXES = [
  { key: 'rate', label: 'Best rate of return', pick: plans => plans.slice().sort(compareByRate)[0] },
  { key: 'fastest', label: 'Fastest capital back', pick: plans => plans.slice().sort(compareByFastest)[0] }
];

// PURE trade arithmetic for a secondary champion `pick` vs the headline `best`.
// All three deltas are always computed (a merged rate+fastest card reads both);
// the material-margin gate reads the axis-relevant one. grossDelta<0 means the
// secondary earns less than the headline (the trade the owner is being shown).
// daysSooner>0 means the secondary frees capital earlier.
function championTrade(pick, best) {
  const po = pick.objective || {};
  const bo = best.objective || {};
  const grossDelta = Math.round(po.grossBonus || 0) - Math.round(bo.grossBonus || 0);
  const pa = po.blendedAnnReturn;
  const ba = bo.blendedAnnReturn;
  const apyDeltaPp = (pa != null && ba != null) ? (pa - ba) : null;
  let daysSooner = null;
  const pc = parseDate(po.latestCompletionISO);
  const bc = parseDate(bo.latestCompletionISO);
  if (pc && bc) daysSooner = daysBetween(pc, bc); // >0 ⇒ pick frees capital earlier
  return { grossDelta, apyDeltaPp, daysSooner };
}

// (b) Near-top-of-total gate: the secondary's gross must reach ≥ THRESHOLD × the
// headline plan's gross. Rounded (matches comparePlans / the card display).
function championGrossQualifies(pick, best) {
  const bg = Math.round((best.objective || {}).grossBonus || 0);
  const pg = Math.round((pick.objective || {}).grossBonus || 0);
  return pg >= CHAMPION_GROSS_THRESHOLD * bg;
}

// Select the CONSTRAINED champion set from an evaluated plan pool. The headline
// (max total return among ≥1-offer feasible plans) is always the first entry;
// rate/fastest secondaries are appended ONLY when they clear gates (b)–(d).
// Empty when no ≥1-offer feasible plan exists (gate a). Two secondaries that
// resolve to the same plan merge into one entry (both labels, one trade).
function selectChampions(plans) {
  const feasible = (plans || []).filter(p => p && p.valid && (p.includedIds || []).length > 0);
  if (!feasible.length) return [];
  const best = feasible.slice().sort(comparePlans)[0];
  const out = [];
  const byVector = new Map();
  const add = (plan, key, label, trade) => {
    let entry = byVector.get(plan.canonicalVector);
    if (!entry) {
      entry = { plan, axes: [], labels: [], trade: null };
      byVector.set(plan.canonicalVector, entry);
      out.push(entry);
    }
    entry.axes.push(key);
    entry.labels.push(label);
    if (trade && !entry.trade) entry.trade = trade;
    return entry;
  };
  add(best, 'total', 'Best total return', null);
  for (const axis of CHAMPION_SECONDARY_AXES) {
    const pick = axis.pick(feasible);
    if (!pick || pick.canonicalVector === best.canonicalVector) continue;   // same as headline
    if (alternativeCollapses(best, pick)) continue;                          // (c) not genuinely distinct
    if (!championGrossQualifies(pick, best)) continue;                       // (b) near-top-of-total
    const trade = championTrade(pick, best);
    const material = axis.key === 'rate'
      // -1e-9 tolerance so a delta that lands exactly on the 2pp boundary isn't
      // lost to IEEE-754 subtraction noise (0.06 - 0.04 = 0.019999…).
      ? (trade.apyDeltaPp != null && trade.apyDeltaPp >= CHAMPION_RATE_MATERIAL_PP - 1e-9)
      : (trade.daysSooner != null && trade.daysSooner >= CHAMPION_FASTEST_MATERIAL_DAYS);
    if (!material) continue;                                                  // (d) material axis margin
    add(pick, axis.key, axis.label, trade);
  }
  return out;
}

function assignmentKey(assignment) {
  return JSON.stringify(Object.keys(assignment).sort(byteCompare).map(id => [id, assignment[id]]));
}

// Are two ISO dates within n business days of each other? Blank matches blank; a
// blank-vs-dated pair is a material difference (one plan schedules a date the
// other omits). Drives the "immaterial schedule difference" test below.
function withinBizDays(isoA, isoB, n) {
  const a = isoA || '';
  const b = isoB || '';
  if (a === b) return true;
  if (!a || !b) return false;
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return false;
  const lo = da <= db ? da : db;
  const hi = da <= db ? db : da;
  const bound = addBusinessDays(lo, n);
  return bound ? bound.getTime() >= hi.getTime() : false;
}

// Every per-offer signup / funding / DD date across two schedules within n
// business days. Called only when the two plans already share an offer set, so
// the id keys match; a missing counterpart schedule is a material difference.
function schedulesNearIdentical(schedA, schedB, n) {
  const a = schedA || {};
  const b = schedB || {};
  for (const id of Object.keys(a)) {
    const sa = a[id] || {};
    const sb = b[id];
    if (!sb) return false;
    if (!withinBizDays(sa.plannedSignupDate, sb.plannedSignupDate, n)) return false;
    if (!withinBizDays(sa.optionalPlannedFundingDate, sb.optionalPlannedFundingDate, n)) return false;
    const bDd = {};
    for (const dd of (sb.directDeposits || [])) bDd[dd.id || ''] = dd.plannedDate || '';
    for (const dd of (sa.directDeposits || [])) {
      if (!withinBizDays(dd.plannedDate, bDd[dd.id || ''], n)) return false;
    }
  }
  return true;
}

// Does plan `b` collapse into the already-kept representative `a`? True only for
// an exact vector match OR the SAME offer set with materially identical outcomes
// (same gross, low cash within noise, completion within a few days, same
// feasibility) AND per-offer schedules within a few business days. Because the
// caller only ever passes an `a` that is better-ranked than `b` (comparePlans
// order, which tie-breaks on earlier cash release), the surviving representative
// is always the earliest one — matching the owner's "return it sooner" reasoning.
function alternativeCollapses(a, b) {
  if (!a || !b || a === b) return false;
  if (a.canonicalVector === b.canonicalVector) return true;
  if (!!a.valid !== !!b.valid) return false;
  if ((a.includedIds || []).join(',') !== (b.includedIds || []).join(',')) return false;
  const ao = a.objective || {};
  const bo = b.objective || {};
  if (Math.round(ao.grossBonus || 0) !== Math.round(bo.grossBonus || 0)) return false;
  const ac = a.capitalCurveSummary || {};
  const bc = b.capitalCurveSummary || {};
  if (Math.abs((ac.lowestAvailable || 0) - (bc.lowestAvailable || 0)) > ALT_LOW_CASH_NOISE) return false;
  const acomp = ao.latestCompletionISO || '';
  const bcomp = bo.latestCompletionISO || '';
  if (!!acomp !== !!bcomp) return false;
  if (acomp && bcomp) {
    const da = parseDate(acomp);
    const db = parseDate(bcomp);
    if (da && db && Math.abs(daysBetween(da, db)) > ALT_COMPLETION_NOISE_DAYS) return false;
  }
  return schedulesNearIdentical(a.schedule, b.schedule, ALT_NEAR_BIZ_DAYS);
}

// Build the proposal's alternatives list: only GENUINELY DISTINCT scenarios, no
// filler echoes of the winner. Three stages, all deterministic:
//   1. Sort best-first (comparePlans is a total order that already prefers the
//      earlier cash-release plan on a tie), so the first plan of any near-tie
//      group is the earliest representative.
//   2. Collapse exact duplicates AND same-set immaterial-schedule near-ties into
//      that representative (alternativeCollapses).
//   3. Re-rank the survivors to prefer a DIFFERENT offer composition first, then
//      materially different schedules of an already-shown set. The winner stays
//      at index 0.
// `capOutput=false` returns the FULL diversity-ranked survivor pool (still bounded
// by totalCap) instead of the first `limit` — so the dominance + owner-display-rule
// filters downstream run on the whole ranked pool and the final `limit` is applied
// only AFTER pruning. Without this, owner-omitted plans in the top `limit` would
// consume display slots and hide valid lower-ranked trade-offs (Codex 2026-07-13 P2).
// `keepFn(plan, headline)` (optional) is the owner-display-rule predicate: an
// omitted plan is SKIPPED during survivor collection so it never consumes a survivor
// slot (which the totalCap bounds) and starve valid lower-ranked trade-offs — the
// scan continues past it (Codex 2026-07-13 P2 follow-up: the cap runs during
// collection, so the prune must run inside it). The headline (sorted[0]) is always
// kept (keepFn is headline-exempt by construction).
function rankAlternatives(plans, limit, capOutput = true, keepFn = null) {
  const sorted = plans.slice().sort(comparePlans);
  const headline = sorted[0];
  const keep = typeof keepFn === 'function' ? keepFn : null;
  // Collect distinct survivors, bounded so the beam's dense pool (n×W×G_eff plans)
  // never turns the O(survivors) collapse scan quadratic: cap total survivors and
  // cap variants kept per offer-composition. A composition that has already hit
  // its cap short-circuits before the expensive schedule comparison, so the
  // dominant winner-composition's thousands of near-schedules cost O(1) each while
  // genuinely different compositions keep getting collected.
  const perSetCap = Math.max(limit, 4);
  const totalCap = Math.max(limit * 8, 48);
  const survivors = [];
  const perSet = new Map();
  for (const p of sorted) {
    if (survivors.length >= totalCap) break;
    // Owner-rule-omitted plans never occupy a survivor slot (they aren't displayed),
    // so the totalCap counts only displayable trade-offs and the scan continues to
    // lower-ranked valid plans instead of stopping on omitted ones.
    if (keep && p !== headline && !keep(p, headline)) continue;
    const key = (p.includedIds || []).join(',');
    const kept = perSet.get(key) || 0;
    if (kept >= perSetCap) continue;
    if (survivors.some(s => alternativeCollapses(s, p))) continue;
    survivors.push(p);
    perSet.set(key, kept + 1);
  }
  const out = [];
  const usedSets = new Set();
  for (const p of survivors) {
    const key = (p.includedIds || []).join(',');
    if (usedSets.has(key)) continue;
    usedSets.add(key);
    out.push(p);
    if (capOutput && out.length >= limit) return out;
  }
  for (const p of survivors) {
    if (out.indexOf(p) !== -1) continue;
    out.push(p);
    if (capOutput && out.length >= limit) break;
  }
  return out;
}

// ── Pareto-dominance filter for the "Other feasible plans" list (owner-directed
// 2026-07-10) ────────────────────────────────────────────────────────────────
// After champion extraction + the 09i same-set dedup, the alternatives list can
// still carry STRICTLY DOMINATED plans: a plan that some other DISPLAYED plan
// beats-or-ties on ALL of (gross bonus, low cash, blended APY) with a same-or-
// EARLIER capital-back date, and strictly beats on at least one axis. These are
// pure clutter — no genuine trade-off for the owner to weigh — so they are
// hidden. A genuine trade-off (higher gross but thinner cushion, higher APY but
// later capital back, …) wins on at least one axis and SURVIVES. Champions and
// the headline are EXEMPT from removal (their own gates govern them) but still
// serve as dominators, since they are displayed. Deterministic: a plan is hidden
// iff a strict dominator exists in the displayed pool, OR it ties an already-kept
// plan on all four metrics (a cross-set duplicate) — in which case the earlier
// list representative is kept.
const ALT_DOMINANCE_APY_EPSILON = 1e-9;   // FP tolerance on the APY axis

// Axis accessors — higher gross/low-cash/APY is better; an EARLIER capital-back
// ISO is better. Missing APY sorts worst (−∞, matching championRate); missing
// completion sorts latest ('9999-12-31', matching compareByFastest). Gross and
// low cash round to whole dollars (matches comparePlans / the card display).
function altMetricGross(p) { return Math.round(((p && p.objective) || {}).grossBonus || 0); }
function altMetricLowCash(p) { return Math.round(((p && p.capitalCurveSummary) || {}).lowestAvailable || 0); }
function altMetricApy(p) {
  const r = ((p && p.objective) || {}).blendedAnnReturn;
  return (r == null) ? -Infinity : r;
}
function altMetricBack(p) { return ((p && p.objective) || {}).latestCompletionISO || '9999-12-31'; }
// Offer count of a plan (the "offers in its plan" the owner's rule counts). The
// canonical set is `includedIds` (same key the display/Apply index on).
function altOfferCount(p) { return (((p && p.includedIds) || []).length); }

// Does A beat-or-tie B on EVERY axis? APY carries an FP epsilon so a floating tie
// isn't misread as a loss; capital-back compares ISO lexically (earlier = better).
function altWeaklyDominates(A, B) {
  return altMetricGross(A) >= altMetricGross(B)
    && altMetricLowCash(A) >= altMetricLowCash(B)
    && altMetricApy(A) >= altMetricApy(B) - ALT_DOMINANCE_APY_EPSILON
    && byteCompare(altMetricBack(A), altMetricBack(B)) <= 0;
}

// PURE edge annotation (ISSUE 4, owner-directed 2026-07-11): by how much does a
// surviving alternative B beat the HEADLINE (alternatives[0]) on each axis?
// Derived from the SAME altMetric* comparison + APY epsilon the dominance filter
// uses, so the rendered "why this survived" can never disagree with the math that
// kept it. Positive = B beats the headline on that axis; a sub-epsilon APY gain
// or a non-winning axis is 0 (renderer omits it). `daysSooner` counts only when
// BOTH plans carry a real capital-back date (never the 9999 sentinel). The
// renderer (formatAltEdge) turns this into the one-line label. Deterministic:
// integer/ISO metric differences only.
function altEdgeVsHeadline(headline, B) {
  if (!headline || !B || headline === B) return null;
  const grossDelta = altMetricGross(B) - altMetricGross(headline);
  const lowCashDelta = altMetricLowCash(B) - altMetricLowCash(headline);
  const apyRaw = altMetricApy(B) - altMetricApy(headline);
  const apyDelta = (Number.isFinite(apyRaw) && apyRaw > ALT_DOMINANCE_APY_EPSILON) ? apyRaw : 0;
  const hBack = altMetricBack(headline), bBack = altMetricBack(B);
  let daysSooner = 0;
  if (bBack !== '9999-12-31' && hBack !== '9999-12-31' && byteCompare(bBack, hBack) < 0) {
    const bd = parseDate(bBack), hd = parseDate(hBack);
    daysSooner = (bd && hd) ? Math.max(0, daysBetween(bd, hd)) : 0;
  }
  return { grossDelta, lowCashDelta, apyDelta, daysSooner };
}

// A is strictly better than B on at least one axis (the "strictly worse on at
// least one", read from the dominator's side).
function altStrictlyBetterSomewhere(A, B) {
  return altMetricGross(A) > altMetricGross(B)
    || altMetricLowCash(A) > altMetricLowCash(B)
    || altMetricApy(A) > altMetricApy(B) + ALT_DOMINANCE_APY_EPSILON
    || byteCompare(altMetricBack(A), altMetricBack(B)) < 0;
}

// Drop strictly-dominated + cross-set-duplicate plans from the alternatives list.
// `alternatives[0]` (the headline) and every plan behind a champion card are
// exempt from removal but participate as dominators. Because strict Pareto
// dominance is transitive, testing each plan against the FULL displayed pool is
// order-independent and yields the Pareto frontier; the exact-tie (duplicate)
// pass then keeps only the earliest representative, so the result is stable.
// Only a DISPLAYED plan may dominate/dedup another: a valid plan with ≥1 offer.
// The renderer hides invalid / 0-offer alternatives (optimizerProposalModel's
// `remainder.filter(p => p.valid && includedIds.length)`), so an infeasible plan
// must NEVER remove a displayed feasible trade-off (Codex P2, 2026-07-10).
function altIsDisplayable(p) {
  return !!p && !!p.valid && ((p.includedIds || []).length > 0);
}

// ── Owner display rule for non-headline plans (owner-directed 2026-07-13) ──────
// Two omission clauses the owner added on top of the 10a Pareto filter. A
// displayed NON-HEADLINE plan (secondary champion OR "Other feasible plans"
// card) must clear BOTH; the headline (Best total return = alternatives[0]) is
// always exempt. Pure + deterministic (integer offer counts, ISO date compares,
// a stored dollar-day tail fraction).
//
// CLAUSE A — same-date offer-count parity. Owner (verbatim): "in order to display
// a card that has a lower gross because of having better low cash and/or blended
// APY, if it's the same date for capital back as the best total return, it can be
// no more than 1 less offer in its plan otherwise it's omitted." → a plan whose
// capital-back date EQUALS the headline's must satisfy
//   offerCount >= headlineOfferCount - 1, else omit.
// (Planner-confirmed against the owner's screenshot — headline $2,650 / 4 offers /
// Oct 13; alternates $2,150/3, $1,900/3, $1,850/3, $1,400/2, $1,350/2, all Oct 13
// → the two 2-offer cards omitted, the three 3-offer cards kept.)
//
// CLAUSE B — late materially-weighted tail. Owner (verbatim): "if capital back
// date (with that date representing at least 33% of the weighted money held in
// that plan span) is later than the best total return then it also omits." →
// omit a plan whose capital-back date is LATER than the headline's WHEN the
// final-date tranche carries >= LATE_TAIL_OMIT_FRACTION of the plan's dollar-days
// (money × time held). A later capital-back whose tail is a sliver (< 33%)
// survives this clause (still subject to Clause A / dominance). "Weighted money
// held in that plan span" is read as DOLLAR-DAYS (money × time), NOT
// share-of-dollars-at-the-final-date — see report note.
//
// An EARLIER capital-back date is exempt from both clauses (a genuine timing
// trade-off). Applied UNIFORMLY to secondary champions (filterChampionsByDisplayRule)
// AND "Other feasible plans" (filterDominatedAlternatives) so the mental model
// stays single.
const LATE_TAIL_OMIT_FRACTION = 0.33;   // owner 2026-07-13: dollar-day tail share

// Dollar-day share of a plan's capital that releases ON its final (capital-back)
// date, as computed by objectiveForOffers. Absent/non-finite → 0 (no material
// tail known → survives Clause B).
function altTailFraction(p) {
  const f = ((p && p.objective) || {}).tailWeightFraction;
  return (typeof f === 'number' && isFinite(f)) ? f : 0;
}

function ownerDisplayRuleKeeps(plan, headline) {
  if (!plan || !headline) return true;
  if (plan === headline || plan.canonicalVector === headline.canonicalVector) return true; // headline itself
  const headBack = altMetricBack(headline);
  if (headBack === '9999-12-31') return true;              // no real headline date → rules dormant
  const planBack = altMetricBack(plan);
  if (planBack === headBack) {
    // Clause A: same capital-back date → within one offer of the headline.
    return altOfferCount(plan) >= altOfferCount(headline) - 1;
  }
  if (byteCompare(planBack, headBack) > 0 && planBack !== '9999-12-31') {
    // Clause B: LATER capital-back with a materially-weighted final tranche → omit.
    return altTailFraction(plan) < LATE_TAIL_OMIT_FRACTION;
  }
  // Earlier capital-back (or a later one with a sliver tail) → genuine trade-off.
  return true;
}

// Prune SECONDARY champions (index >= 1) that fail the owner display rule vs the
// headline champion (champions[0].plan, always kept). "No filler" — a removed
// secondary is NOT replaced. `headline` is alternatives[0] (== champions[0].plan
// by canonicalVector); passed explicitly so the champion and alternatives lists
// judge against the same reference.
function filterChampionsByDisplayRule(champions, headline) {
  const list = Array.isArray(champions) ? champions : [];
  if (list.length <= 1) return list;
  return list.filter((c, idx) => idx === 0 || ownerDisplayRuleKeeps(c && c.plan, headline));
}

function filterDominatedAlternatives(alternatives, champions) {
  const alts = (alternatives || []).slice();
  if (alts.length <= 1) return alts;
  const championVectors = new Set(
    (champions || []).map(c => c && c.plan && c.plan.canonicalVector).filter(Boolean)
  );
  const headline = alts[0];
  const headlineVector = headline && headline.canonicalVector;
  const isExempt = p => !!p && (p.canonicalVector === headlineVector || championVectors.has(p.canonicalVector));
  // A plan is SHOWN — and thus may dominate / dedup others — only if it is
  // displayable AND passes the owner display rule. A plan the owner rule omits is
  // never displayed, so (like an infeasible plan — R85 Codex P2) it must NOT hide
  // a shown trade-off (Codex 2026-07-13 P2: a same-date parity-omitted plan could
  // otherwise weakly-dominate a valid N−1-offer plan before being removed itself).
  // Exempt plans (headline + champions) are always shown.
  const isShown = p => !!p && (isExempt(p) || (altIsDisplayable(p) && ownerDisplayRuleKeeps(p, headline)));
  const dominators = (champions || []).map(c => c && c.plan).filter(Boolean)
    .concat(alts.filter(isShown));
  const kept = [];
  const out = [];
  for (const B of alts) {
    if (isExempt(B)) { out.push(B); kept.push(B); continue; }
    // An invalid / 0-offer alternative isn't displayed anyway — pass it through
    // untouched (the renderer drops it) and never let it dominate or dedup.
    if (!altIsDisplayable(B)) { out.push(B); continue; }
    // Owner display rule (Clause A same-date parity + Clause B late tail): omit
    // BEFORE dominance so an omitted plan is neither shown nor a dominator.
    if (!ownerDisplayRuleKeeps(B, headline)) continue;
    let hidden = dominators.some(A => A
      && A.canonicalVector !== B.canonicalVector
      && altWeaklyDominates(A, B) && altStrictlyBetterSomewhere(A, B));
    if (!hidden) {
      // Cross-set duplicate: ties an already-kept DISPLAYED plan on all four
      // metrics → hide the later one (the earlier representative is already kept).
      hidden = kept.some(A => altIsDisplayable(A) && A.canonicalVector !== B.canonicalVector
        && altWeaklyDominates(A, B) && altWeaklyDominates(B, A));
    }
    if (hidden) continue;
    out.push(B);
    kept.push(B);
  }
  // ISSUE 4: annotate every surviving non-headline plan with the axes/deltas on
  // which it beats the headline (alts[0]) — the renderer shows this on the
  // unlabeled "Other feasible plans" cards. Computed on the FINAL survivor set
  // (post dominance + post owner-rule) so a card's "why it survived" never
  // references a plan the rule removed.
  for (const p of out) {
    if (p && p !== headline) p.edgeVsHeadline = altEdgeVsHeadline(headline, p);
  }
  return out;
}

function exactSearch(ctx, records, grids) {
  const plans = [];
  let evaluated = 0;
  let best = null;
  const assignment = {};
  function visit(i) {
    if (evaluated >= ctx.options.evalCap) return;
    if (i >= records.length) {
      if (!ctx.options.allowEmptyPlan && Object.keys(assignment).length === 0) return;
      const p = evaluateAssignment(ctx, records, assignment);
      evaluated++;
      p.evaluated = evaluated;
      p.strategy = 'exact';
      plans.push(p);
      if (comparePlans(p, best) < 0) best = p;
      return;
    }
    const r = records[i];
    delete assignment[r.id];
    visit(i + 1);
    for (const iso of grids.get(r.id) || []) {
      assignment[r.id] = iso;
      visit(i + 1);
      if (evaluated >= ctx.options.evalCap) break;
    }
    delete assignment[r.id];
  }
  visit(0);
  best = best || invalidPlan(ctx, 'no-evaluations');
  // Return the full ranked-diverse pool (uncapped) so the dominance + owner-rule
  // filters run on the whole pool; optimizePlanner caps to alternativeLimit AFTER
  // pruning (Codex 2026-07-13 P2). Owner-omitted plans are skipped during survivor
  // collection so they never starve valid lower-ranked trade-offs.
  best.alternatives = rankAlternatives(plans, ctx.options.alternativeLimit, false, ownerDisplayRuleKeeps);
  best.champions = selectChampions(plans);
  best.evaluated = evaluated;
  best.earlyOut = evaluated >= ctx.options.evalCap;
  return best;
}

function beamSearch(ctx, records, grids, strategy) {
  let evaluated = 0;
  let beam = [{ assignment: {}, plan: evaluateAssignment(ctx, records, {}) }];
  beam[0].plan.strategy = strategy;
  const allPlans = [beam[0].plan];
  evaluated++;
  for (const record of records) {
    const expanded = [];
    for (const node of beam) {
      const choices = [null].concat(grids.get(record.id) || []);
      for (const choice of choices) {
        if (evaluated >= ctx.options.evalCap) break;
        const assignment = Object.assign({}, node.assignment);
        if (choice) assignment[record.id] = choice;
        else delete assignment[record.id];
        const key = assignmentKey(assignment);
        const plan = evaluateAssignment(ctx, records, assignment);
        evaluated++;
        plan.strategy = strategy;
        expanded.push({ assignment, plan, key });
        allPlans.push(plan);
      }
      if (evaluated >= ctx.options.evalCap) break;
    }
    const seen = new Set();
    beam = expanded
      .sort((a, b) => comparePlans(a.plan, b.plan) || byteCompare(a.key, b.key))
      .filter(n => { if (seen.has(n.key)) return false; seen.add(n.key); return true; })
      .slice(0, ctx.options.beamWidth);
    if (!beam.length || evaluated >= ctx.options.evalCap) break;
  }
  let bestNode = beam.slice().sort((a, b) => comparePlans(a.plan, b.plan) || byteCompare(a.key, b.key))[0] || { assignment: {}, plan: allPlans[0] };
  const repaired = localRepair(ctx, records, bestNode.assignment, allPlans, evaluated);
  const best = repaired.best || bestNode.plan;
  best.strategy = strategy;
  const beamPool = allPlans.concat(repaired.plans);
  // Uncapped ranked-diverse pool — capped after pruning in optimizePlanner (Codex P2).
  // Owner-omitted plans skipped during collection so they never starve valid trade-offs.
  best.alternatives = rankAlternatives(beamPool, ctx.options.alternativeLimit, false, ownerDisplayRuleKeeps);
  best.champions = selectChampions(beamPool);
  best.evaluated = repaired.evaluated;
  best.earlyOut = repaired.evaluated >= ctx.options.evalCap;
  return best;
}

function localChoices(record) {
  return [null].concat(record.grid || []);
}

function localRepair(ctx, records, startAssignment, existingPlans, initialEvaluated) {
  let evaluated = initialEvaluated;
  let bestAssignment = Object.assign({}, startAssignment);
  let best = evaluateAssignment(ctx, records, bestAssignment);
  evaluated++;
  const plans = [best];
  let improved = true;
  for (let pass = 0; pass < 2 && improved && evaluated < ctx.options.evalCap; pass++) {
    improved = false;
    for (const record of records) {
      for (const choice of localChoices(record)) {
        if (evaluated >= ctx.options.evalCap) break;
        const a = Object.assign({}, bestAssignment);
        if (choice) a[record.id] = choice;
        else delete a[record.id];
        const p = evaluateAssignment(ctx, records, a);
        evaluated++;
        plans.push(p);
        if (comparePlans(p, best) < 0) {
          best = p;
          bestAssignment = a;
          improved = true;
        }
      }
    }
  }

  for (let i = 0; i < records.length && evaluated < ctx.options.evalCap; i++) {
    for (let j = i + 1; j < records.length && evaluated < ctx.options.evalCap; j++) {
      const aChoices = localChoices(records[i]).slice(0, 4);
      const bChoices = localChoices(records[j]).slice(0, 4);
      for (const ai of aChoices) {
        for (const bj of bChoices) {
          if (evaluated >= ctx.options.evalCap) break;
          const a = Object.assign({}, bestAssignment);
          if (ai) a[records[i].id] = ai; else delete a[records[i].id];
          if (bj) a[records[j].id] = bj; else delete a[records[j].id];
          const p = evaluateAssignment(ctx, records, a);
          evaluated++;
          plans.push(p);
          if (comparePlans(p, best) < 0) {
            best = p;
            bestAssignment = a;
          }
        }
      }
    }
  }
  return { best, plans: (existingPlans || []).concat(plans), evaluated };
}

function combinationCount(records, grids, cap) {
  let total = 1;
  for (const r of records) {
    total *= 1 + ((grids.get(r.id) || []).length);
    if (total > cap) return total;
  }
  return total;
}

function optimizePlanner(input = {}) {
  const ctx = normalizeOptimizerInput(input);
  const built = buildCandidateRecords(ctx);
  const records = built.records;
  if (records.length > ctx.options.maxOptimizerCandidates) {
    return invalidPlan(ctx, 'too-many-candidates', [], {
      tooMany: true,
      candidateCount: records.length,
      max: ctx.options.maxOptimizerCandidates,
      candidateReview: built.review,
      evaluated: 0
    });
  }
  if (records.length === 0) {
    const p = evaluateAssignment(ctx, records, {});
    p.candidateCount = 0;
    p.candidateReview = built.review;
    p.strategy = 'empty';
    p.evaluated = 1;
    return p;
  }

  const fullGrids = new Map(records.map(r => [r.id, r.grid]));
  const exactCount = combinationCount(records, fullGrids, ctx.options.evalCap);
  let plan;
  if (exactCount <= ctx.options.evalCap) {
    plan = exactSearch(ctx, records, fullGrids);
  } else {
    const beamCost = records.length * ctx.options.beamWidth * (1 + ctx.options.maxDateGridPerOffer) + records.length * records.length;
    const grids = beamCost <= ctx.options.evalCap
      ? fullGrids
      : new Map(records.map(r => [r.id, r.coarseGrid && r.coarseGrid.length ? r.coarseGrid : r.grid.slice(0, 6)]));
    plan = beamSearch(ctx, records, grids, beamCost <= ctx.options.evalCap ? 'beam' : 'coarse-beam');
  }
  plan.candidateCount = records.length;
  // ISSUE 1 (owner-directed 2026-07-10): hide strictly-dominated plans from the
  // "Other feasible plans" list. Runs AFTER champion extraction + the 09i same-set
  // dedup (both done inside the search); champions + the headline stay (exempt)
  // but still dominate. Genuine trade-offs survive.
  //
  // RULE (owner-directed 2026-07-13, planner-confirmed) — capital-back /
  // offer-count parity. A displayed NON-HEADLINE plan whose capital-back date
  // EQUALS the headline's (Best total return) must carry >= headlineOfferCount − 1
  // offers, else it is omitted; a DIFFERENT capital-back date is exempt (genuine
  // timing trade-off). Applied UNIFORMLY to secondary champions AND "Other
  // feasible plans." Champions are pruned FIRST so an omitted secondary champion
  // no longer serves as a dominator of the alternatives pool (only DISPLAYED
  // plans may dominate — R85 Codex P2). The alternatives-side parity + the edge
  // annotations both run inside filterDominatedAlternatives (edges on the
  // post-rule survivor set). Headline = alternatives[0] == champions[0].plan.
  // The search returns the FULL ranked-diverse alternatives pool (uncapped). Prune
  // champions + dominated + owner-rule-omitted plans, THEN cap to alternativeLimit,
  // so omitted plans never consume a display slot a valid lower-ranked trade-off
  // would fill (Codex 2026-07-13 P2). The headline stays at index 0 through the
  // slice.
  const parityHeadline = (plan.alternatives || [])[0] || null;
  plan.champions = filterChampionsByDisplayRule(plan.champions, parityHeadline);
  plan.alternatives = filterDominatedAlternatives(plan.alternatives, plan.champions)
    .slice(0, ctx.options.alternativeLimit);
  // Build-time exclusions (commitment-linked / churn-snoozed / needs-date /
  // no-window) PLUS validator-time exclusions (item 2): candidates that cleared
  // build but the qualifier rejects at every schedulable date, dropped from the
  // final plan without a review row otherwise.
  plan.candidateReview = built.review.concat(captureValidatorExclusions(ctx, records, plan));
  plan.candidates = records.map(r => ({
    id: r.id,
    op: r.op,
    sourceOfferId: r.sourceOfferId,
    originalOfferId: r.originalOfferId,
    lockStartsFrom: r.offer.lockStartsFrom || '',
    grid: r.grid.slice(),
    badges: r.badges || []
  }));
  return plan;
}

function evaluateOptimizerPlan(input = {}, assignment = {}) {
  const ctx = normalizeOptimizerInput(input);
  const built = buildCandidateRecords(ctx);
  const plan = evaluateAssignment(ctx, built.records, assignment);
  plan.candidateCount = built.records.length;
  plan.candidateReview = built.review;
  return plan;
}

const runPlannerOptimizer = optimizePlanner;

function _pinOffer(over = {}) {
  return Object.assign({
    id: 'off_pin',
    bankName: 'Pin Bank',
    offerName: '',
    offerType: 'new-funds-held',
    signupBonusAmount: 300,
    requiredFundingAmount: 10000,
    daysAfterSignupAllowedBeforeDeposit: 30,
    daysFundsMustRemain: 30,
    lockStartsFrom: 'funded date',
    plannedSignupDate: '',
    optionalPlannedFundingDate: '',
    offerExpirationDate: '2026-12-31',
    status: 'prospect',
    accountStatus: 'closed',
    subStatus: 'prospect',
    includeInScenario: false,
    directDeposits: [],
    requirements: [],
    debitRequirement: { required: false, count: null, withinDays: null, byDate: '', byDateLegacy: '' }
  }, over);
}

function _pinState(over = {}) {
  return Object.assign({
    today: '2026-07-09',
    settings: {
      projectionStartDate: '2026-07-09',
      minimumCashBuffer: 0,
      currentLiquidCapital: 50000,
      ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 }
    },
    offers: [],
    commitments: [],
    events: [],
    candidateIds: [],
    options: { includeChurn: false, defaultWindowDays: 120 }
  }, over);
}

function testOptimizerPins() {
  const t0 = Date.now();
  const results = [];
  const check = (name, ok, extra = '') => {
    results.push({ name, ok: !!ok, extra });
  };

  {
    const a = _pinOffer({ id: 'off_a', signupBonusAmount: 500, requiredFundingAmount: 10000 });
    const plan = optimizePlanner(_pinState({ offers: [a], candidateIds: ['off_a'] }));
    check('single held offer selected when within buffer', plan.valid && plan.includedIds.includes('off_a'));
  }
  {
    const a = _pinOffer({ id: 'off_a', signupBonusAmount: 100, requiredFundingAmount: 10000, offerExpirationDate: '2026-07-09' });
    const b = _pinOffer({ id: 'off_b', signupBonusAmount: 250, requiredFundingAmount: 10000, offerExpirationDate: '2026-07-09' });
    const plan = optimizePlanner(_pinState({
      settings: { projectionStartDate: '2026-07-09', minimumCashBuffer: 0, currentLiquidCapital: 15000, ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 } },
      offers: [a, b],
      candidateIds: ['off_a', 'off_b']
    }));
    check('two overlapping offers picks only highest fitting subset', plan.valid && plan.includedIds.length === 1 && plan.includedIds[0] === 'off_b');
  }
  {
    const a = _pinOffer({ id: 'off_slide', signupBonusAmount: 400, requiredFundingAmount: 15000, daysFundsMustRemain: 10, offerExpirationDate: '2026-08-31' });
    const plan = optimizePlanner(_pinState({
      settings: { projectionStartDate: '2026-07-09', minimumCashBuffer: 0, currentLiquidCapital: 20000, ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 } },
      offers: [a],
      events: [
        { id: 'ev_out', includeInProjection: true, amount: -10000, date: '2026-07-18' },
        { id: 'ev_in', includeInProjection: true, amount: 10000, date: '2026-07-29' }
      ],
      candidateIds: ['off_slide']
    }));
    check('date slide waits for capital recovery', plan.valid && plan.schedule.off_slide.plannedSignupDate >= '2026-07-29', plan.schedule.off_slide && plan.schedule.off_slide.plannedSignupDate);
    check('valid plan never violates buffer floor', plan.capitalCurveSummary.shortfallDays === 0 && plan.capitalCurveSummary.belowBufferDays === 0);
  }
  {
    const a = _pinOffer({ id: 'off_det', signupBonusAmount: 350 });
    const input = _pinState({ offers: [a], candidateIds: ['off_det'] });
    const p1 = optimizePlanner(input);
    const p2 = optimizePlanner(input);
    check('deterministic exact search vector', p1.canonicalVector === p2.canonicalVector && JSON.stringify(p1.schedule) === JSON.stringify(p2.schedule));
  }
  {
    const a = _pinOffer({ id: 'off_window', offerExpirationDate: '2026-07-15' });
    const plan = optimizePlanner(_pinState({ offers: [a], candidateIds: ['off_window'] }));
    const d = plan.schedule.off_window && plan.schedule.off_window.plannedSignupDate;
    check('scheduled date never before today', d >= '2026-07-09');
    check('scheduled date respects expiry window', d <= '2026-07-15');
  }
  {
    const a = _pinOffer({ id: 'off_long', daysFundsMustRemain: 220, offerExpirationDate: '2026-07-20' });
    const plan = optimizePlanner(_pinState({ offers: [a], candidateIds: ['off_long'] }));
    check('horizon extends beyond old 180 day clamp', plan.valid && plan.capitalCurveSummary.horizonDays > 180, String(plan.capitalCurveSummary.horizonDays));
  }
  {
    const a = _pinOffer({ id: 'off_too_long', daysFundsMustRemain: 760, offerExpirationDate: '2026-07-20' });
    const plan = evaluateOptimizerPlan(_pinState({ offers: [a], candidateIds: ['off_too_long'] }), { off_too_long: '2026-07-09' });
    check('horizon overrun hard-fails forced plan', !plan.valid && plan.reasons.includes('horizon-exceeded'));
  }
  {
    const dd = _pinOffer({
      id: 'off_dd',
      offerType: 'direct-deposit',
      signupBonusAmount: 300,
      requiredFundingAmount: 12000,
      daysFundsMustRemain: null,
      ddRequirement: { mode: 'count', count: 1 },
      directDeposits: [{ id: 'dd1', plannedDate: '2026-07-10', amount: 12000 }]
    });
    const base = _pinState({ offers: [dd], candidateIds: ['off_dd'] });
    const p111 = evaluateOptimizerPlan(base, { off_dd: '2026-07-09' });
    const p212 = evaluateOptimizerPlan(Object.assign({}, base, {
      settings: Object.assign({}, base.settings, { ddTransfer: { inDays: 2, seasonDays: 1, backDays: 2 } })
    }), { off_dd: '2026-07-09' });
    check('ddTransfer variants change DD release date', p111.schedule.off_dd.derived.withdrawalEligible !== p212.schedule.off_dd.derived.withdrawalEligible,
      `${p111.schedule.off_dd.derived.withdrawalEligible}/${p212.schedule.off_dd.derived.withdrawalEligible}`);
  }
  {
    const confirmed = _pinOffer({
      id: 'off_confirmed',
      status: 'funded',
      accountStatus: 'open',
      subStatus: 'on-track',
      includeInScenario: true,
      requiredFundingAmount: 40000,
      plannedSignupDate: '2026-07-10',
      optionalPlannedFundingDate: '2026-07-10',
      offerExpirationDate: '2026-12-31'
    });
    const candidate = _pinOffer({ id: 'off_candidate', requiredFundingAmount: 30000, offerExpirationDate: '2026-12-31' });
    const forced = evaluateOptimizerPlan(_pinState({
      settings: { projectionStartDate: '2026-07-09', minimumCashBuffer: 0, currentLiquidCapital: 50000, ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 } },
      offers: [confirmed, candidate],
      candidateIds: ['off_candidate']
    }), { off_candidate: '2026-07-20' });
    check('confirmed base offer remains in evaluated set', !forced.valid && forced.capitalCurveSummary.lowestAvailable < 0, String(forced.capitalCurveSummary.lowestAvailable));
  }
  {
    // Clag-D (2026-07-13 hold-release transfer lag): the engine must re-sequence a
    // candidate PAST the base offer's capital-back LANDING date, not merely its
    // withdrawal-eligibility/release date. A confirmed 50k held base (funded
    // 2026-07-14, 3-day hold → releases 2026-07-17, LANDS 2026-07-20 at
    // backDays=1) leaves only 10k free of 60k liquid until it lands; a 25k
    // candidate cannot fund on the release day (same-day netting was the bug) and
    // must wait for the landing. Proves the owner-confirmed intent end-to-end: a
    // below-buffer same-day overlap "can't be an option."
    const cfg1 = { inDays: 1, seasonDays: 1, backDays: 1 };
    const hold = _pinOffer({
      id: 'off_hold', status: 'funded', accountStatus: 'open', subStatus: 'on-track',
      includeInScenario: true, requiredFundingAmount: 50000, daysFundsMustRemain: 3,
      plannedSignupDate: '2026-07-14', optionalPlannedFundingDate: '2026-07-14', offerExpirationDate: '2026-12-31'
    });
    const next = _pinOffer({ id: 'off_next', signupBonusAmount: 400, requiredFundingAmount: 25000, daysFundsMustRemain: 30, offerExpirationDate: '2026-12-31' });
    const plan = optimizePlanner(_pinState({
      settings: { projectionStartDate: '2026-07-13', minimumCashBuffer: 0, currentLiquidCapital: 60000, ddTransfer: cfg1 },
      offers: [hold, next], candidateIds: ['off_next']
    }));
    const relISO = withdrawalInitiateDate(hold);          // 2026-07-17 (release)
    const landISO = withdrawalEligibleDate(hold, cfg1);    // 2026-07-20 (landing = release + 1 biz)
    const sched = plan.schedule && plan.schedule.off_next;
    check('Clag-D engine re-sequences candidate past the LANDING date (not the release day) + buffer-safe',
      plan.valid && plan.capitalCurveSummary.shortfallDays === 0 && plan.capitalCurveSummary.belowBufferDays === 0
      && plan.includedIds.includes('off_next') && landISO > relISO && sched && sched.derived.lockStart >= landISO,
      sched ? `lockStart=${sched.derived.lockStart} release=${relISO} landing=${landISO}` : 'no schedule');
  }
  {
    const activeCandidate = _pinOffer({
      id: 'off_active_candidate',
      includeInScenario: true,
      requiredFundingAmount: 60000,
      signupBonusAmount: 900,
      plannedSignupDate: '2026-07-09',
      optionalPlannedFundingDate: '2026-07-09'
    });
    const plan = optimizePlanner(_pinState({
      settings: { projectionStartDate: '2026-07-09', minimumCashBuffer: 0, currentLiquidCapital: 50000, ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 } },
      offers: [activeCandidate],
      candidateIds: ['off_active_candidate']
    }));
    check('currently included candidate can be excluded from baseline', plan.valid && !plan.includedIds.includes('off_active_candidate'));
  }
  {
    const candidate = _pinOffer({ id: 'off_linked' });
    const plan = optimizePlanner(_pinState({
      offers: [candidate],
      commitments: [{ id: 'c1', sourceBonusOfferId: 'off_linked', status: 'confirmed', includeInProjection: true, amount: 10000, startDate: '2026-07-09', endDate: '2026-08-09' }],
      candidateIds: ['off_linked']
    }));
    check('commitment-linked offer excluded from candidates', plan.candidateCount === 0 && plan.candidateReview.some(r => r.reason === 'commitment-linked'));
  }
  {
    const source = _pinOffer({
      id: 'off_churn_source',
      status: 'completed',
      accountStatus: 'closed',
      subStatus: 'earned',
      plannedSignupDate: '2025-01-01',
      bonus_received_date: '2026-01-01',
      churnable: true,
      churn_wait_months: 6,
      churn_anchor: 'bonus_received',
      lockStartsFrom: 'open date',
      daysFundsMustRemain: 45,
      last_edited: '2026-06-15T12:00:00.000Z'
    });
    const plan = optimizePlanner(_pinState({ offers: [source], options: { includeChurn: true, defaultWindowDays: 60 } }));
    const sched = plan.schedule.churn_off_churn_source;
    check('churn synthesis creates candidate from eligible source', plan.valid && !!sched);
    check('open-date churn carry preserves hold-anchor metadata', plan.candidates.some(c => c.id === 'churn_off_churn_source' && c.lockStartsFrom === 'open date'));
    check('unverified churn badge carries value date', plan.badges.churn_off_churn_source && plan.badges.churn_off_churn_source.some(b => b.kind === 'unverified-churn-value' && b.dateISO === '2026-06-15'));
  }
  {
    // ── Churn candidacy: never-run prospect is NOT a churn source (ISSUE 2a,
    // owner-directed 2026-07-10) ────────────────────────────────────────────
    // The BofA repro: a churnable offer at a PRE-ACCOUNT status (subStatus
    // 'prospect', accountStatus auto-set to 'closed', churn_anchor 'account_closed'
    // with no closed_date) must NOT enter the churn path and demand a closed_date.
    // It is already a NORMAL candidate — so it gets NO churn review row at all,
    // and (given a valid window) is schedulable as a normal offer.
    const bofa = _pinOffer({
      id: 'off_bofa', bankName: 'Bank of America', offerName: 'Business Advantage Banking',
      status: 'prospect', accountStatus: 'closed', subStatus: 'prospect',
      signupBonusAmount: 300, requiredFundingAmount: 5000, daysFundsMustRemain: 60,
      churnable: true, churn_wait_months: 12, churn_anchor: 'account_closed', closed_date: null,
      offerExpirationDate: '2026-12-31'
    });
    const bofaPlan = optimizePlanner(_pinState({ offers: [bofa], candidateIds: ['off_bofa'], options: { includeChurn: true, defaultWindowDays: 120 } }));
    const bofaRows = (bofaPlan.candidateReview || []).filter(r => r.offerId === 'off_bofa');
    check('churn candidacy: never-run prospect gets NO churn needs-date row',
      !bofaRows.some(r => r.reason === 'missing-churn-anchor')
      && !bofaPlan.candidates.some(c => c.id === 'churn_off_bofa'),
      `${bofaRows.length} rows`);
    check('churn candidacy: the never-run prospect is scheduled as a normal candidate',
      bofaPlan.valid && bofaPlan.includedIds.includes('off_bofa'), JSON.stringify(bofaPlan.includedIds));
    // A GENUINE prior run (closed + earned) whose account_closed anchor date is
    // NOT recorded still owes it — surfaces a needs-date row carrying the anchor
    // so the copy layer can name the exact field (ISSUE 2b).
    const genuine = _pinOffer({
      id: 'off_genuine', status: 'completed', accountStatus: 'closed', subStatus: 'earned',
      plannedSignupDate: '2025-01-01', churnable: true, churn_wait_months: 12,
      churn_anchor: 'account_closed', closed_date: null
    });
    const genPlan = optimizePlanner(_pinState({ offers: [genuine], candidateIds: ['off_genuine'], options: { includeChurn: true, defaultWindowDays: 120 } }));
    const genRow = (genPlan.candidateReview || []).find(r => r.offerId === 'off_genuine' && r.reason === 'missing-churn-anchor');
    check('churn candidacy: genuine completed run still needs its anchor, tagged with the anchor kind',
      !!genRow && genRow.status === 'needs-date' && genRow.anchor === 'account_closed',
      genRow ? genRow.anchor : 'no row');
  }
  {
    const dd = _pinOffer({
      id: 'off_dd_bad',
      offerType: 'direct-deposit',
      daysFundsMustRemain: null,
      ddRequirement: { mode: 'count', count: 2 },
      directDeposits: [{ id: 'dd1', plannedDate: '2026-07-10', amount: 5000 }]
    });
    const plan = evaluateOptimizerPlan(_pinState({ offers: [dd], candidateIds: ['off_dd_bad'] }), { off_dd_bad: '2026-07-09' });
    check('DD count qualification rejects too few DDs', !plan.valid && plan.bindingConstraints.some(c => c.kind === 'dd-window'));
  }
  {
    const dd = _pinOffer({
      id: 'off_dd_freq_bad',
      offerType: 'direct-deposit',
      daysFundsMustRemain: null,
      ddRequirement: { mode: 'frequency', freqPeriods: 2, freqEvery: 'week' },
      directDeposits: [
        { id: 'dd1', plannedDate: '2026-07-10', amount: 5000 },
        { id: 'dd2', plannedDate: '2026-07-11', amount: 5000 }
      ]
    });
    const plan = evaluateOptimizerPlan(_pinState({ offers: [dd], candidateIds: ['off_dd_freq_bad'] }), { off_dd_freq_bad: '2026-07-09' });
    check('DD frequency qualification rejects mis-cadenced DDs', !plan.valid && plan.bindingConstraints.some(c => c.kind === 'dd-window'));
  }
  {
    // ── DD posting-date qualification (deadline-direction fix, 2026-07-09) ────
    // The live MLK repro: a DD initiated Fri 2026-01-16 POSTS Tue 2026-01-20
    // (Mon 01-19 is the MLK holiday, inDays=1). Against a user-requirement cutoff
    // of 2026-01-19 (signup 2026-01-05 + deadline_days 14) the plan MUST be
    // rejected with a 'dd-post-late' note — even though the DD's weekend/holiday-
    // only effective date (01-16) is before the cutoff. Before the fix the
    // validator compared the weak effective date and returned valid:true.
    const janState = ddDate => _pinState({
      today: '2026-01-05',
      settings: { projectionStartDate: '2026-01-05', minimumCashBuffer: 0, currentLiquidCapital: 100000, ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 } },
      offers: [_pinOffer({
        id: 'off_mlk', offerType: 'direct-deposit', signupBonusAmount: 400, requiredFundingAmount: 5000,
        daysFundsMustRemain: null, plannedSignupDate: '2026-01-05', offerExpirationDate: '2026-12-31',
        ddRequirement: { mode: 'count', count: 1 },
        directDeposits: [{ id: 'dd1', plannedDate: ddDate, amount: 5000 }],
        requirements: [{ source: 'user', done: false, deadline_days: 14, label: 'user deadline' }]
      })],
      candidateIds: ['off_mlk']
    });
    const reject = evaluateOptimizerPlan(janState('2026-01-16'), { off_mlk: '2026-01-05' });
    check('DD count qualification rejects post-after-cutoff (MLK repro)',
      !reject.valid && reject.bindingConstraints.some(c => c.kind === 'dd-post-late'),
      (reject.bindingConstraints.find(c => c.kind === 'dd-post-late') || {}).dateISO || '—');
    // Control: initiate two days earlier (Wed 2026-01-14 → posts Thu 01-15 ≤
    // cutoff) and the same offer qualifies — the fix isn't blanket-rejecting DDs.
    const accept = evaluateOptimizerPlan(janState('2026-01-14'), { off_mlk: '2026-01-05' });
    check('DD count qualification accepts when post lands on/before cutoff',
      accept.valid && !accept.bindingConstraints.some(c => c.kind === 'dd-post-late'));
  }
  {
    // Frequency mode must APPLY the user/expiry cutoffs (built into
    // cutoffCandidates but never enforced before the fix): 3 monthly DDs whose
    // 3rd posts 2026-03-09 — past a user deadline of 2026-02-15 (signup
    // 2026-01-05 + deadline_days 41) → rejected via 'dd-post-late'.
    const freq = _pinOffer({
      id: 'off_freq_cut', offerType: 'direct-deposit', signupBonusAmount: 400, requiredFundingAmount: 6000,
      daysFundsMustRemain: null, plannedSignupDate: '2026-01-05', offerExpirationDate: '2026-12-31',
      ddRequirement: { mode: 'frequency', freqPeriods: 3, freqEvery: 'month' },
      directDeposits: [
        { id: 'd1', plannedDate: '2026-01-06', amount: 2000 },
        { id: 'd2', plannedDate: '2026-02-06', amount: 2000 },
        { id: 'd3', plannedDate: '2026-03-06', amount: 2000 }
      ],
      requirements: [{ source: 'user', done: false, deadline_days: 41, label: 'user deadline' }]
    });
    const plan = evaluateOptimizerPlan(_pinState({
      today: '2026-01-05',
      settings: { projectionStartDate: '2026-01-05', minimumCashBuffer: 0, currentLiquidCapital: 100000, ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 } },
      offers: [freq], candidateIds: ['off_freq_cut']
    }), { off_freq_cut: '2026-01-05' });
    check('DD frequency mode enforces the user cutoff on the post date',
      !plan.valid && plan.bindingConstraints.some(c => c.kind === 'dd-post-late'));
  }
  {
    // Post-date window: a weekly DD whose EFFECTIVE date sits on the literal
    // window end (2026-02-09) but whose POST date (2026-02-10) spills one
    // business day past it is rejected ('dd-window'). Under the old effective-
    // date semantics (effective 02-09 ≤ window-end 02-09) it would have qualified.
    const win = _pinOffer({
      id: 'off_post_win', offerType: 'direct-deposit', signupBonusAmount: 400, requiredFundingAmount: 5000,
      daysFundsMustRemain: null, plannedSignupDate: '2026-02-02', offerExpirationDate: '2026-12-31',
      ddRequirement: { mode: 'frequency', freqPeriods: 1, freqEvery: 'week' },
      directDeposits: [{ id: 'd1', plannedDate: '2026-02-09', amount: 5000 }],
      requirements: []
    });
    const plan = evaluateOptimizerPlan(_pinState({
      today: '2026-01-05',
      settings: { projectionStartDate: '2026-01-05', minimumCashBuffer: 0, currentLiquidCapital: 100000, ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 } },
      offers: [win], candidateIds: ['off_post_win']
    }), { off_post_win: '2026-02-02' });
    check('DD frequency window rejects a DD whose post spills past the window end',
      !plan.valid && plan.bindingConstraints.some(c => c.kind === 'dd-window'));
  }
  {
    const tiered = _pinOffer({ id: 'off_tiered', tiers: [{ bonus: 100 }, { bonus: 200 }] });
    const plan = optimizePlanner(_pinState({ offers: [tiered], candidateIds: ['off_tiered'] }));
    check('tiered offer is badged, not auto-picked', plan.badges.off_tiered && plan.badges.off_tiered.some(b => b.kind === 'tiered-unselected'));
  }
  {
    const offers = [];
    for (let i = 0; i < 14; i++) {
      offers.push(_pinOffer({
        id: `off_perf_${String(i).padStart(2, '0')}`,
        signupBonusAmount: 50 + i,
        requiredFundingAmount: 1000,
        daysFundsMustRemain: 10,
        offerExpirationDate: '2026-07-31'
      }));
    }
    const start = Date.now();
    const plan = optimizePlanner(_pinState({
      settings: { projectionStartDate: '2026-07-09', minimumCashBuffer: 0, currentLiquidCapital: 50000, ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 } },
      offers,
      candidateIds: offers.map(o => o.id),
      options: { includeChurn: false, defaultWindowDays: 90 }
    }));
    const elapsed = Date.now() - start;
    check('beam perf stays under eval cap', plan.evaluated <= EVAL_CAP, String(plan.evaluated));
    // Wall-clock smoke ceiling for the 14-held-offer / ~11.8k-eval beam. Raised
    // 2000→2200ms (2026-07-13): modeling the hold-release transfer lag adds a
    // bounded business-day computation (addBusinessDays) per held offer per
    // eval — ~5% here (~1.9s→~2.0s on the dev box). The structural blow-up guard
    // is the separate `evaluated <= EVAL_CAP` check above; this only catches a
    // gross regression, so the small feature cost gets honest headroom.
    check('beam perf stays under wall-clock budget', elapsed < 2200, `${elapsed}ms`);
    const again = optimizePlanner(_pinState({
      settings: { projectionStartDate: '2026-07-09', minimumCashBuffer: 0, currentLiquidCapital: 50000, ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 } },
      offers,
      candidateIds: offers.map(o => o.id),
      options: { includeChurn: false, defaultWindowDays: 90 }
    }));
    check('beam path deterministic', plan.canonicalVector === again.canonicalVector);
  }
  {
    // Alternatives diversity: a single held offer with plenty of liquid and a
    // wide expiry window produces a dense cluster of near-identical schedules
    // (same set, same gross/low-cash, sign-up dates a business day or two apart).
    // These must collapse to ONE representative rather than filling the list
    // with echoes, and the surviving list must be deterministic + earliest-first.
    const a = _pinOffer({
      id: 'off_near', signupBonusAmount: 500, requiredFundingAmount: 10000,
      daysFundsMustRemain: 30, offerExpirationDate: '2026-09-30'
    });
    const near = _pinState({
      settings: { projectionStartDate: '2026-07-09', minimumCashBuffer: 0, currentLiquidCapital: 100000, ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 } },
      offers: [a], candidateIds: ['off_near']
    });
    const pA = optimizePlanner(near);
    const pB = optimizePlanner(near);
    const alts = pA.alternatives || [];
    let anyNearDup = false;
    for (let i = 0; i < alts.length; i++) {
      for (let j = i + 1; j < alts.length; j++) {
        if (alternativeCollapses(alts[i], alts[j]) || alternativeCollapses(alts[j], alts[i])) anyNearDup = true;
      }
    }
    check('same-set near-date variants collapse to one representative', alts.length >= 1 && !anyNearDup, `${alts.length} alts`);
    const vA = alts.map(x => x.canonicalVector).join('|');
    const vB = (pB.alternatives || []).map(x => x.canonicalVector).join('|');
    check('alternatives list is deterministic', vA === vB);
    const top = alts[0] || {};
    const topSet = ((top.includedIds) || []).join(',');
    const earliest = alts
      .filter(x => ((x.includedIds) || []).join(',') === topSet)
      .every(x => ((top.objective || {}).latestCompletionISO || '') <= ((x.objective || {}).latestCompletionISO || '9999-12-31'));
    check('collapsed representative is the earliest cash-release variant', earliest);
  }
  {
    // Churn-throughput tie-breaker (inserted after gross + APY, before earliest
    // cash release). Two plans that tie on gross bonus AND blended APY but hold
    // churnable offers with different next-eligibility must order by the earlier
    // eligibility; plans without churnables must be unaffected (neutral key).
    const churnOffer = (id, wait) => _pinOffer({
      id, signupBonusAmount: 500, requiredFundingAmount: 10000, daysFundsMustRemain: 30,
      lockStartsFrom: 'funded date', offerExpirationDate: '2026-12-31',
      churnable: true, churn_wait_months: wait, churn_anchor: 'bonus_received'
    });
    const planSoon = evaluateOptimizerPlan(_pinState({ offers: [churnOffer('off_churn_soon', 6)], candidateIds: ['off_churn_soon'] }), { off_churn_soon: '2026-07-20' });
    const planLate = evaluateOptimizerPlan(_pinState({ offers: [churnOffer('off_churn_late', 12)], candidateIds: ['off_churn_late'] }), { off_churn_late: '2026-07-20' });
    // Identical capital params → equal gross and equal APY; only churn_wait differs.
    const equalValueApy = planSoon.objective.grossBonus === planLate.objective.grossBonus
      && Math.abs((planSoon.objective.blendedAnnReturn || 0) - (planLate.objective.blendedAnnReturn || 0)) < 1e-9;
    const vecSoon = planSoon.objective.churnNextEligible || [];
    const vecLate = planLate.objective.churnNextEligible || [];
    check('churn tie-break: equal value/APY plans order by earlier next-eligibility',
      equalValueApy && vecSoon.length === 1 && vecLate.length === 1 && vecSoon[0] < vecLate[0]
      && comparePlans(planSoon, planLate) < 0 && comparePlans(planLate, planSoon) > 0,
      `${vecSoon[0] || '—'} vs ${vecLate[0] || '—'}`);
    // Anchor-honoring (Codex P2 #2): an account_opened churnable offer measures
    // next-eligibility from its plan SIGN-UP date, not the capital-free date —
    // signup 2026-07-20 + 12mo = 2027-07-20 (NOT withdrawal 2027-01-16 + 12mo).
    const openAnchor = _pinOffer({
      id: 'off_churn_open', signupBonusAmount: 500, requiredFundingAmount: 10000, daysFundsMustRemain: 180,
      lockStartsFrom: 'open date', offerExpirationDate: '2027-12-31',
      churnable: true, churn_wait_months: 12, churn_anchor: 'account_opened'
    });
    const openPlan = evaluateOptimizerPlan(_pinState({ offers: [openAnchor], candidateIds: ['off_churn_open'] }), { off_churn_open: '2026-07-20' });
    const openVec = openPlan.objective.churnNextEligible || [];
    check('churn tie-break: account_opened anchor measures next-eligibility from sign-up',
      openVec.length === 1 && openVec[0] === '2027-07-20', openVec[0] || '—');
    // A plan whose included offers are NOT churnable contributes an empty vector.
    const plain = evaluateOptimizerPlan(_pinState({ offers: [_pinOffer({ id: 'off_plain', signupBonusAmount: 500, requiredFundingAmount: 10000, daysFundsMustRemain: 30, offerExpirationDate: '2026-12-31' })], candidateIds: ['off_plain'] }), { off_plain: '2026-07-20' });
    check('churn tie-break: non-churnable plan contributes an empty eligibility vector',
      Array.isArray(plain.objective.churnNextEligible) && plain.objective.churnNextEligible.length === 0);
    // Neutrality: two churnless plans still order purely by cash release (their
    // throughput key IS cash release), and a churnless plan with earlier cash
    // release is never out-ranked by a churnable plan whose eligibility is later
    // (never penalized).
    const mkPlan = (churnVec, cashISO, cv) => ({ valid: true, canonicalVector: cv, objective: { grossBonus: 500, blendedAnnReturn: 0.05, latestCompletionISO: cashISO, churnNextEligible: churnVec } });
    check('churn tie-break: churnless plans unaffected — ordered by cash release',
      comparePlans(mkPlan([], '2026-08-01', 'a'), mkPlan([], '2026-09-01', 'b')) < 0
      && comparePlans(mkPlan([], '2026-08-01', 'a'), mkPlan(['2026-10-01'], '2026-09-01', 'c')) < 0);
    // Transitivity guard (Codex P2): mixed churnable/churnless plans tied on
    // gross+APY must stay a TOTAL order — no A<B<C<A cycle (a bare empty-vector
    // "neutral 0" broke this once the cash-release fallback ran).
    const A = mkPlan(['2027-02-01'], '2026-08-01', 'A'); // churnable · late elig · early cash
    const B = mkPlan([],             '2026-09-01', 'B'); // churnless  · mid cash
    const C = mkPlan(['2026-11-01'], '2026-10-01', 'C'); // churnable · early elig · late cash
    const trio = [A, B, C];
    let totalOrder = true;
    for (const x of trio) for (const y of trio) {
      if (x !== y && !((comparePlans(x, y) < 0) !== (comparePlans(y, x) < 0))) totalOrder = false; // antisymmetry
      for (const z of trio) {
        if (comparePlans(x, y) < 0 && comparePlans(y, z) < 0 && !(comparePlans(x, z) < 0)) totalOrder = false; // transitivity
      }
    }
    check('churn tie-break: comparator stays a transitive total order (no cycle)', totalOrder);
  }
  {
    // ── CONSTRAINED champion scenario cards (owner redesign 2026-07-09) ──────
    // The headline "Best total return" plan is always the first champion. A
    // rate/fastest SECONDARY appears ONLY when it (a) has ≥1 offer, (b) earns
    // ≥85% of the headline's gross, (c) is genuinely distinct, and (d) beats the
    // headline on its axis by a material margin (APY ≥ +2pp / capital back ≥ 7d
    // sooner). Each secondary carries a pure trade delta. All fixtures below are
    // 1-offer plans (includedIds:[cv]) so gate (a) passes; distinct cv + distinct
    // includedIds so alternativeCollapses never fires (gate c).
    const champPlan = (cv, gross, apy, cashISO) => ({
      valid: true, canonicalVector: cv, includedIds: [cv],
      capitalCurveSummary: { lowestAvailable: 0 },
      objective: { grossBonus: gross, blendedAnnReturn: apy, latestCompletionISO: cashISO, churnNextEligible: [] }
    });
    // [UPDATED from 09k] Distinct winners: a headline, a materially-higher-rate
    // plan, and a materially-earlier plan that ALL clear the gross gate → 3
    // cards (total, rate, fastest). The 09k version used tiny-gross secondaries
    // ($300 / $500 vs $1000) — exactly the degenerate case the redesign now
    // rejects — so the fixtures were lifted above the 85% gross floor.
    const pTotal = champPlan('v_total', 1000, 0.04, '2026-12-01');
    const pRate = champPlan('v_rate', 900, 0.10, '2026-11-01');   // gross 900≥850, +6pp APY
    const pFast = champPlan('v_fast', 880, 0.03, '2026-08-01');   // gross 880≥850, ~122d sooner
    const champs = selectChampions([pRate, pFast, pTotal]);
    const axisOf = k => champs.find(c => c.axes.length === 1 && c.axes[0] === k);
    check('champions: distinct constrained axis winners identified',
      champs.length === 3
      && champs[0].plan === pTotal && champs[0].axes[0] === 'total'
      && champs[0].labels[0] === 'Best total return' && champs[0].trade === null
      && !!axisOf('rate') && axisOf('rate').plan === pRate && !!axisOf('rate').trade
      && !!axisOf('fastest') && axisOf('fastest').plan === pFast && !!axisOf('fastest').trade,
      `${champs.length} champions`);
    // [UPDATED from 09k] Merged now applies to the SECONDARY axes only (total is
    // always its own card). A single qualifying plan that wins BOTH rate and
    // fastest → ONE card, two secondary labels, one shared trade.
    const pTop = champPlan('v_top', 1200, 0.03, '2026-12-01');
    const pBoth = champPlan('v_both', 1100, 0.09, '2026-08-01'); // gross 1100≥1020, +6pp, ~122d sooner
    const merged = selectChampions([pTop, pBoth]);
    check('champions: one secondary plan winning two axes collapses to a single merged card',
      merged.length === 2
      && merged[0].plan === pTop && merged[0].axes.join(',') === 'total'
      && merged[1].plan === pBoth && merged[1].axes.length === 2
      && merged[1].labels.join(' · ') === 'Best rate of return · Fastest capital back'
      && merged[1].trade && merged[1].trade.apyDeltaPp != null && merged[1].trade.daysSooner != null,
      `${merged.length} cards`);
    // [KEPT + EXTENDED] No feasible plan → no champions; the 0-offer "do nothing"
    // plan is never a champion (gate a — the 09l NIT), even alongside real plans
    // (where it is never the headline).
    const emptyPlan = { valid: true, canonicalVector: 'empty', includedIds: [], capitalCurveSummary: { lowestAvailable: 0 }, objective: { grossBonus: 0, blendedAnnReturn: null, latestCompletionISO: '', churnNextEligible: [] } };
    check('champions: no feasible plan yields no champions',
      selectChampions([{ valid: false, canonicalVector: 'x', objective: {} }]).length === 0);
    check('champions: lone 0-offer feasible plan is never a champion',
      selectChampions([emptyPlan]).length === 0);
    const withEmpty = selectChampions([emptyPlan, champPlan('v_real', 500, 0.05, '2026-09-01')]);
    check('champions: 0-offer plan excluded when a real plan exists (headline is the real plan)',
      withEmpty.length === 1 && withEmpty[0].axes[0] === 'total' && withEmpty[0].plan.canonicalVector === 'v_real');
    // [NEW] Gross-threshold boundary: a rate secondary at EXACTLY 85% of best
    // gross qualifies; one dollar of gross below it does not. (Equal cash so the
    // fastest picker resolves to the headline and never confounds the rate test.)
    const bTot = champPlan('v_bt', 1000, 0.04, '2026-12-01');
    const rAbove = selectChampions([bTot, champPlan('v_ra', 850, 0.10, '2026-12-01')]);
    const rBelow = selectChampions([bTot, champPlan('v_rb', 849, 0.10, '2026-12-01')]);
    check('champions: gross-threshold boundary (≥85% qualifies, below excludes)',
      rAbove.some(c => c.axes.includes('rate')) && !rBelow.some(c => c.axes.includes('rate')),
      `above=${rAbove.length} below=${rBelow.length}`);
    // [NEW] Rate material-margin boundary: +2pp APY qualifies, +1.5pp does not.
    const mrAbove = selectChampions([champPlan('v_mt', 1000, 0.04, '2026-12-01'), champPlan('v_mr', 900, 0.06, '2026-12-01')]);
    const mrBelow = selectChampions([champPlan('v_mt2', 1000, 0.04, '2026-12-01'), champPlan('v_mr2', 900, 0.055, '2026-12-01')]);
    check('champions: rate material-margin boundary (+2pp qualifies, +1.5pp excludes)',
      mrAbove.some(c => c.axes.includes('rate')) && !mrBelow.some(c => c.axes.includes('rate')),
      `above=${mrAbove.length} below=${mrBelow.length}`);
    // [NEW] Fastest material-margin boundary: 7 days sooner qualifies, 6 does not.
    // (Headline holds the highest APY so the rate picker never confounds this.)
    const mfAbove = selectChampions([champPlan('v_ft', 1000, 0.10, '2026-12-08'), champPlan('v_ff', 900, 0.03, '2026-12-01')]);
    const mfBelow = selectChampions([champPlan('v_ft2', 1000, 0.10, '2026-12-08'), champPlan('v_ff2', 900, 0.03, '2026-12-02')]);
    check('champions: fastest material-margin boundary (7d sooner qualifies, 6d excludes)',
      mfAbove.some(c => c.axes.includes('fastest')) && !mfBelow.some(c => c.axes.includes('fastest')),
      `above=${mfAbove.length} below=${mfBelow.length}`);
    // [NEW] Trade-delta arithmetic: grossDelta = pick − best; apyDeltaPp = pick −
    // best APY; daysSooner = business/calendar days the pick frees capital earlier.
    const dTot = champPlan('v_dt', 1000, 0.04, '2026-12-01');
    const dSec = champPlan('v_ds', 900, 0.13, '2026-10-01');
    const dChamps = selectChampions([dTot, dSec]);
    const dEntry = dChamps.find(c => c.plan.canonicalVector === 'v_ds');
    check('champions: trade-delta arithmetic (gross/apy/days) vs headline',
      !!dEntry && dEntry.trade.grossDelta === -100
      && Math.abs(dEntry.trade.apyDeltaPp - 0.09) < 1e-9
      && dEntry.trade.daysSooner === 61,
      dEntry ? `Δ$${dEntry.trade.grossDelta} · Δ${dEntry.trade.apyDeltaPp.toFixed(2)}pp · ${dEntry.trade.daysSooner}d` : 'no entry');
    // [NEW] No-filler: a tiny-gross, high-APY, early-cash plan (the owner's
    // degenerate "single offer I entered myself" case) clears NO gate → only the
    // headline card renders. This is the redesign's whole point.
    const nfChamps = selectChampions([champPlan('v_nt', 1000, 0.05, '2026-12-01'), champPlan('v_ns', 100, 0.90, '2026-07-01')]);
    check('champions: no-filler — degenerate tiny-gross plan yields only the headline card',
      nfChamps.length === 1 && nfChamps[0].axes[0] === 'total', `${nfChamps.length} champions`);
    // [KEPT] Engine wiring: a real optimize run exposes plan.champions with the
    // overall winner as the total champion (plan[0]), all champion plans valid,
    // no vector duplicated. A single-offer run yields exactly the headline card
    // (rate/fastest resolve to the headline → skipped, no label absorption).
    const wa = _pinOffer({ id: 'off_champ', signupBonusAmount: 500, requiredFundingAmount: 10000, daysFundsMustRemain: 30, offerExpirationDate: '2026-12-31' });
    const wInput = _pinState({ offers: [wa], candidateIds: ['off_champ'] });
    const wp1 = optimizePlanner(wInput);
    const wp2 = optimizePlanner(wInput);
    const c1 = wp1.champions || [];
    const vectors = c1.map(c => c.plan.canonicalVector);
    const vecKey = cs => cs.map(c => c.plan.canonicalVector + ':' + c.axes.join(',')).join('|');
    check('champions: engine wires a feasible champion set with the winner as total',
      c1.length >= 1
      && c1[0].axes[0] === 'total'
      && c1[0].plan.canonicalVector === wp1.canonicalVector
      && c1.every(c => c.plan.valid && (c.plan.includedIds || []).length > 0)
      && new Set(vectors).size === vectors.length,
      `${c1.length} champions`);
    // [KEPT] Determinism across real runs AND across a shuffled synthetic pool
    // (constrained selection is order-independent — each axis is a total order).
    check('champions: deterministic across runs', vecKey(c1) === vecKey(wp2.champions || []));
    check('champions: constrained selection is shuffle-invariant',
      vecKey(selectChampions([pRate, pFast, pTotal])) === vecKey(selectChampions([pTotal, pFast, pRate])));
  }
  {
    // ── Validator-time exclusion review rows (item 2, R83 gap) ──────────────
    // A candidate that clears BUILD (has a date grid) but the qualifier rejects
    // at EVERY schedulable date — while a valid alternative outranks it — now
    // surfaces a tappable "Not in this plan" review row with the specific reason.
    // Repro: a DD offer needing 2 DDs with only 1 provided fails dd-window at
    // every date (count is signup-invariant); a clean held offer outranks it.
    const ddShort = _pinOffer({
      id: 'off_dd_short', offerType: 'direct-deposit', signupBonusAmount: 400,
      daysFundsMustRemain: null, ddRequirement: { mode: 'count', count: 2 },
      directDeposits: [{ id: 'dd1', plannedDate: '2026-07-13', amount: 5000 }]
    });
    const clean = _pinOffer({ id: 'off_clean', signupBonusAmount: 500, requiredFundingAmount: 10000, daysFundsMustRemain: 30 });
    const vplan = optimizePlanner(_pinState({ offers: [ddShort, clean], candidateIds: ['off_dd_short', 'off_clean'] }));
    const vrow = (vplan.candidateReview || []).find(r => r.offerId === 'off_dd_short');
    check('review: validator-excluded candidate surfaces a row with its specific reason',
      vplan.valid && vplan.includedIds.includes('off_clean') && !vplan.includedIds.includes('off_dd_short')
      && !!vrow && vrow.status === 'excluded' && vrow.reason === 'dd-window',
      vrow ? vrow.reason : 'no row');
    // TRUTHFUL: the offer that IS in the final plan never gets a row.
    check('review: an offer in the final plan gets no validator row',
      !(vplan.candidateReview || []).some(r => r.offerId === 'off_clean'));
    // TRUTHFUL: an offer that QUALIFIES (no timing gap) but is dropped for CASH
    // gets no validator row — it is absent for cash/ranking, not the validator.
    const big1 = _pinOffer({ id: 'off_big1', signupBonusAmount: 700, requiredFundingAmount: 60000, daysFundsMustRemain: 400, offerExpirationDate: '2026-10-31' });
    const big2 = _pinOffer({ id: 'off_big2', signupBonusAmount: 400, requiredFundingAmount: 60000, daysFundsMustRemain: 400, offerExpirationDate: '2026-10-31' });
    const cplan = optimizePlanner(_pinState({
      offers: [big1, big2], candidateIds: ['off_big1', 'off_big2'],
      settings: { projectionStartDate: '2026-07-09', minimumCashBuffer: 0, currentLiquidCapital: 100000, ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 } }
    }));
    check('review: a cash-dropped but qualifying offer gets no validator row',
      cplan.valid && cplan.includedIds.includes('off_big1') && !cplan.includedIds.includes('off_big2')
      && !(cplan.candidateReview || []).some(r => r.offerId === 'off_big2'),
      JSON.stringify(cplan.includedIds));
  }
  {
    // ── EITHER/OR qualification paths (2026-07-11, owner-directed) ─────────────
    // An offer met by EITHER a direct-deposit OR a card-spend (debit) path, via
    // requirementLogic:'any' + plannedPath. The capital model + qualification
    // follow ONLY the chosen path; an UNCHOSEN path is a needs-path review row,
    // never a silent model (P2-3: the optimizer never picks the path).
    const eoBase = {
      id: 'off_eo', offerType: 'direct-deposit', signupBonusAmount: 600,
      requiredFundingAmount: 5000, daysFundsMustRemain: null,
      ddRequirement: { mode: 'count', count: 1 },
      directDeposits: [{ id: 'dd1', plannedDate: '2026-07-20', amount: 5000 }],
      debitRequirement: { required: true, count: 3, withinDays: 30, byDate: '', byDateLegacy: '' },
      requirementLogic: 'any', offerExpirationDate: '2026-12-31'
    };
    // (1) DD path chosen → the DDs are modeled + validated and the offer is
    // included in a feasible plan (schedule carries its DD leg).
    const ddPlan = optimizePlanner(_pinState({
      offers: [_pinOffer(Object.assign({}, eoBase, { plannedPath: 'dd' }))],
      candidateIds: ['off_eo']
    }));
    check('either/or: dd path modeled + validated (DDs scheduled, offer included)',
      ddPlan.valid && ddPlan.includedIds.includes('off_eo')
      && ddPlan.schedule && ddPlan.schedule['off_eo']
      && ddPlan.schedule['off_eo'].directDeposits.length === 1,
      JSON.stringify(ddPlan.includedIds));
    // (2) Debit path chosen → NO DD capital events: the schedule carries no DD
    // legs and the curve never dips below full liquid capital; still valid.
    const debitPlan = optimizePlanner(_pinState({
      offers: [_pinOffer(Object.assign({}, eoBase, { plannedPath: 'debit' }))],
      candidateIds: ['off_eo']
    }));
    check('either/or: debit path ties up no DD capital (no DD legs, full liquid capital)',
      debitPlan.valid && debitPlan.includedIds.includes('off_eo')
      && debitPlan.schedule['off_eo'].directDeposits.length === 0
      && debitPlan.capitalCurveSummary.lowestAvailable === 50000,
      `low=${debitPlan.capitalCurveSummary && debitPlan.capitalCurveSummary.lowestAvailable}`);
    // (3) No path chosen (plannedPath:null) → EXCLUDED with a needs-path review
    // row; a clean alternative wins (the optimizer never auto-picks the path).
    const eoClean = _pinOffer({ id: 'off_ok', signupBonusAmount: 500, requiredFundingAmount: 10000, daysFundsMustRemain: 30 });
    const nullPlan = optimizePlanner(_pinState({
      offers: [_pinOffer(Object.assign({}, eoBase, { plannedPath: null })), eoClean],
      candidateIds: ['off_eo', 'off_ok']
    }));
    const eoRow = (nullPlan.candidateReview || []).find(r => r.offerId === 'off_eo');
    check('either/or: unchosen path excluded with a needs-path review row (never auto-picked)',
      nullPlan.valid && !nullPlan.includedIds.includes('off_eo')
      && !!eoRow && eoRow.reason === 'needs-path',
      eoRow ? eoRow.reason : 'no row');
    // (4) Determinism: identical inputs → byte-identical either/or plan.
    const runEo = () => optimizePlanner(_pinState({
      offers: [_pinOffer(Object.assign({}, eoBase, { plannedPath: 'dd' }))],
      candidateIds: ['off_eo']
    }));
    check('either/or: plan is deterministic across runs',
      JSON.stringify(runEo().schedule) === JSON.stringify(runEo().schedule));
  }
  {
    // ── Pareto-dominance filter for "Other feasible plans" (ISSUE 1, owner-
    // directed 2026-07-10) ─────────────────────────────────────────────────────
    // Modeled on the owner's real screenshot: seven plans, all with the SAME
    // capital-back date (2026-10-08). The $1,800 / $1,750 / $1,400 / $1,350 cards
    // are strictly dominated (the $1,950 or $1,550 plan beats-or-ties them on
    // gross, low cash, AND blended APY at the same capital-back), so they must be
    // hidden. The three genuine trade-offs ($2,150 = best gross / thin cushion;
    // $1,950 = high APY + mid cushion; $1,550 = fattest cushion) each win an axis
    // and SURVIVE.
    const domPlan = (cv, gross, low, apy, backISO) => ({
      valid: true, canonicalVector: cv, includedIds: [cv],
      capitalCurveSummary: { lowestAvailable: low },
      objective: { grossBonus: gross, blendedAnnReturn: apy, latestCompletionISO: backISO }
    });
    const BACK = '2026-10-08';
    const pA = domPlan('v_2150', 2150, 11945, 0.145, BACK);   // best gross (headline)
    const pB = domPlan('v_1950', 1950, 32945, 0.203, BACK);   // best APY + mid cushion
    const pC = domPlan('v_1800', 1800, 22945, 0.149, BACK);   // dominated by B
    const pD = domPlan('v_1750', 1750, 27945, 0.161, BACK);   // dominated by B
    const pE = domPlan('v_1550', 1550, 36945, 0.180, BACK);   // fattest cushion
    const pF = domPlan('v_1400', 1400, 26945, 0.126, BACK);   // dominated by B and E
    const pG = domPlan('v_1350', 1350, 31945, 0.137, BACK);   // dominated by B and E
    const ownerAlts = [pA, pB, pC, pD, pE, pF, pG];
    const kept = filterDominatedAlternatives(ownerAlts, [{ plan: pA }]);
    const keptVecs = kept.map(p => p.canonicalVector).join(',');
    check('dominance: four strictly-dominated owner plans hidden, three trade-offs survive',
      keptVecs === 'v_2150,v_1950,v_1550', keptVecs || '(empty)');
    // Boundary: two plans equal on ALL four metrics (a cross-set duplicate) → the
    // later representative is hidden; the earlier one (and the headline) survive.
    // headline is a genuine trade-off vs the dups (best gross, thinnest cushion),
    // so it does NOT itself dominate them — isolating the duplicate rule.
    const hL = domPlan('v_head', 3000, 2000, 0.10, BACK);      // headline (exempt)
    const dupP = domPlan('v_dup_p', 1000, 5000, 0.10, BACK);
    const dupQ = domPlan('v_dup_q', 1000, 5000, 0.10, BACK);   // byte-identical metrics
    const dedup = filterDominatedAlternatives([hL, dupP, dupQ], [{ plan: hL }]);
    check('dominance: exact-tie duplicate (equal on all four) is hidden as a duplicate',
      dedup.map(p => p.canonicalVector).join(',') === 'v_head,v_dup_p',
      dedup.map(p => p.canonicalVector).join(','));
    // The headline (alts[0]) and champion plans are NEVER hidden even when strictly
    // dominated: pWeak is worse on every axis than pStrong yet survives as headline.
    const pStrong = domPlan('v_strong', 2000, 40000, 0.25, '2026-09-01');
    const pWeak = domPlan('v_weak', 500, 1000, 0.02, '2026-12-01'); // dominated by pStrong
    const exempt = filterDominatedAlternatives([pWeak, pStrong], [{ plan: pWeak }]);
    check('dominance: the headline is exempt even when strictly dominated',
      exempt.some(p => p.canonicalVector === 'v_weak') && exempt.some(p => p.canonicalVector === 'v_strong'));
    // Determinism: identical input yields identical output ordering across runs.
    const run1 = filterDominatedAlternatives(ownerAlts, [{ plan: pA }]).map(p => p.canonicalVector).join(',');
    const run2 = filterDominatedAlternatives(ownerAlts, [{ plan: pA }]).map(p => p.canonicalVector).join(',');
    check('dominance: filter is deterministic across runs', run1 === run2, run1);
    // [Codex P2] An INVALID (infeasible) plan with superior metrics must NOT hide
    // a valid, displayed trade-off — the renderer never shows the invalid plan, so
    // it cannot dominate. Here vInvalid beats vValid on every axis but is invalid;
    // vValid must survive (only the headline + vValid remain).
    const invHead = domPlan('v_ih', 2000, 5000, 0.15, BACK);       // headline: best gross, thin cushion
    const vInvalid = Object.assign(domPlan('v_inv', 1900, 45000, 0.25, '2026-09-01'), { valid: false });
    const vValid = domPlan('v_val', 900, 42000, 0.05, '2026-12-01'); // high-cushion trade-off; beaten ONLY by the invalid plan
    const survivors = filterDominatedAlternatives([invHead, vInvalid, vValid], [{ plan: invHead }]).map(p => p.canonicalVector);
    check('dominance: an infeasible plan never hides a displayed feasible trade-off',
      survivors.includes('v_val'), survivors.join(','));

    // ── Edge annotation for surviving alternatives (ISSUE 4, owner-directed
    // 2026-07-11) ───────────────────────────────────────────────────────────────
    // Every surviving non-headline plan must carry an edgeVsHeadline whose
    // POSITIVE axes are EXACTLY the axes on which it strictly beats the headline
    // (same altMetric* comparison the filter uses), and it must be non-empty
    // (survival guarantees ≥1 edge). Reuse the owner-numbers survivors: headline
    // pA=v_2150 (gross 2150, low 11945, apy 0.145), survivors v_1950 / v_1550.
    const edgeAxes = (p) => {
      const e = (p && p.edgeVsHeadline) || {};
      const s = [];
      if (e.apyDelta > 0) s.push('apy');
      if (e.lowCashDelta > 0) s.push('lowCash');
      if (e.grossDelta > 0) s.push('gross');
      if (e.daysSooner > 0) s.push('sooner');
      return s.sort();
    };
    const strictAxes = (p) => {
      const s = [];
      if (altMetricApy(p) > altMetricApy(pA) + ALT_DOMINANCE_APY_EPSILON) s.push('apy');
      if (altMetricLowCash(p) > altMetricLowCash(pA)) s.push('lowCash');
      if (altMetricGross(p) > altMetricGross(pA)) s.push('gross');
      if (altMetricBack(p) !== '9999-12-31' && altMetricBack(pA) !== '9999-12-31'
        && byteCompare(altMetricBack(p), altMetricBack(pA)) < 0) s.push('sooner');
      return s.sort();
    };
    const nonHead = kept.filter(p => p.canonicalVector !== 'v_2150');
    check('edge: every survivor edge matches its strict-beat axes vs headline (never empty)',
      nonHead.every(p => {
        const a = edgeAxes(p).join(','), b = strictAxes(p).join(',');
        return a === b && a.length > 0;
      }),
      nonHead.map(p => p.canonicalVector + '=' + edgeAxes(p).join('+')).join(' | '));
    // Deltas are the exact metric differences (low-cash cushion vs the headline).
    check('edge: survivor deltas equal the exact metric differences',
      pB.edgeVsHeadline.lowCashDelta === (32945 - 11945)
      && pE.edgeVsHeadline.lowCashDelta === (36945 - 11945)
      && pB.edgeVsHeadline.grossDelta === (1950 - 2150),
      `${pB.edgeVsHeadline.lowCashDelta}/${pE.edgeVsHeadline.lowCashDelta}/${pB.edgeVsHeadline.grossDelta}`);
    // Determinism: the annotation is byte-stable across repeated runs.
    const edgeSig = (alts) => filterDominatedAlternatives(alts, [{ plan: pA }])
      .map(p => p.canonicalVector + ':' + edgeAxes(p).join('+')).join(',');
    check('edge: annotation is deterministic across runs', edgeSig(ownerAlts) === edgeSig(ownerAlts), edgeSig(ownerAlts));
  }
  {
    // ── Capital-back / offer-count parity rule (owner-directed 2026-07-13) ──────
    // Owner: a lower-gross card that TIES the headline's capital-back date may be
    // "no more than 1 less offer in its plan otherwise it's omitted." A different
    // capital-back date is EXEMPT (genuine timing trade-off). Applied to BOTH the
    // "Other feasible plans" list AND secondary champions.
    // Each fixture plan carries an explicit offer count (includedIds length) plus a
    // mutually NON-DOMINATING metric profile (gross ↓ ⇒ low-cash ↑ ⇒ APY ↑), so the
    // ISSUE-1 dominance filter keeps every plan and ONLY the parity rule prunes —
    // isolating this rule.
    const parIds = n => Array.from({ length: n }, (_, i) => 'o' + i);
    const parPlan = (cv, gross, low, apy, backISO, offers, tailFrac) => ({
      valid: true, canonicalVector: cv, includedIds: parIds(offers),
      capitalCurveSummary: { lowestAvailable: low },
      objective: { grossBonus: gross, blendedAnnReturn: apy, latestCompletionISO: backISO,
        tailWeightFraction: (typeof tailFrac === 'number' ? tailFrac : 0) }
    });
    const OCT13 = '2026-10-13';
    // Owner's screenshot mirror: headline 4 offers / $2,650 / Oct 13; three 3-offer
    // trade-offs (kept) + two 2-offer trade-offs (omitted), all the same date.
    const hH = parPlan('v_h', 2650, 10000, 0.10, OCT13, 4);   // headline
    const h3a = parPlan('v_3a', 2150, 20000, 0.12, OCT13, 3);
    const h3b = parPlan('v_3b', 1900, 30000, 0.14, OCT13, 3);
    const h3c = parPlan('v_3c', 1850, 35000, 0.15, OCT13, 3);
    const h2a = parPlan('v_2a', 1400, 40000, 0.18, OCT13, 2); // two fewer, same date → omit
    const h2b = parPlan('v_2b', 1350, 45000, 0.20, OCT13, 2); // two fewer, same date → omit
    const ownerNums = [hH, h3a, h3b, h3c, h2a, h2b];
    const keptP = filterDominatedAlternatives(ownerNums, [{ plan: hH }]).map(p => p.canonicalVector).join(',');
    check('parity: two same-date 2-offer plans omitted, three 3-offer plans kept (owner screenshot)',
      keptP === 'v_h,v_3a,v_3b,v_3c', keptP || '(empty)');
    // Boundary: exactly one fewer offer at the SAME date is KEPT; two fewer at the
    // same date is OMITTED (4 → 3 keep, 4 → 2 omit).
    const bK = parPlan('v_bk', 2000, 25000, 0.13, OCT13, 3); // 3 = 4−1 → keep
    const bO = parPlan('v_bo', 1500, 42000, 0.19, OCT13, 2); // 2 = 4−2 → omit
    const bnd = filterDominatedAlternatives([hH, bK, bO], [{ plan: hH }]).map(p => p.canonicalVector);
    check('parity: same-date N−1 offers kept, N−2 offers omitted (boundary)',
      bnd.includes('v_bk') && !bnd.includes('v_bo'), bnd.join(','));
    // Exemption: two fewer offers but an EARLIER capital-back date → KEPT (a real
    // timing trade-off, not a same-timing weaker echo).
    const earlier = parPlan('v_early', 1500, 42000, 0.19, '2026-10-06', 2);
    const exm = filterDominatedAlternatives([hH, earlier], [{ plan: hH }]).map(p => p.canonicalVector);
    check('parity: two-fewer offers with an EARLIER capital-back date is exempt (kept)',
      exm.includes('v_early'), exm.join(','));
    // Champions: a same-date secondary champion two offers short is OMITTED and NOT
    // replaced (no filler); the headline champion (index 0) always survives.
    const champOut = filterChampionsByDisplayRule([{ plan: hH }, { plan: h2a }], hH);
    check('parity: same-date secondary champion two offers short is omitted, no filler',
      champOut.length === 1 && champOut[0].plan === hH, `${champOut.length} champions`);
    // Champions honour the rule uniformly: a same-date N−1 secondary and an
    // earlier-date secondary are both KEPT.
    const champKeep = filterChampionsByDisplayRule([{ plan: hH }, { plan: h3a }, { plan: earlier }], hH)
      .map(c => c.plan.canonicalVector).join(',');
    check('parity: champions — same-date N−1 and earlier-date secondaries are kept',
      champKeep === 'v_h,v_3a,v_early', champKeep);
    // Determinism: identical input → identical survivor ordering across runs.
    const pr1 = filterDominatedAlternatives(ownerNums, [{ plan: hH }]).map(p => p.canonicalVector).join(',');
    const pr2 = filterDominatedAlternatives(ownerNums, [{ plan: hH }]).map(p => p.canonicalVector).join(',');
    check('parity: filter is deterministic across runs', pr1 === pr2, pr1);

    // Codex 2026-07-13 P2: a plan the owner rule OMITS must not act as a dominator.
    // p2dom is a same-date 2-offer plan (parity-omitted: 2 < 4−1) that weakly
    // dominates the valid same-date 3-offer p3ok (higher gross/low-cash/APY). The
    // headline hH does NOT dominate p3ok (its low-cash is lower). Before the fix,
    // p2dom hid p3ok before being removed itself; now p3ok survives.
    const pDomHead = parPlan('v_ph', 3000, 2000, 0.04, OCT13, 4);
    const p3ok = parPlan('v_p3ok', 1000, 5000, 0.05, OCT13, 3);
    const p2dom = parPlan('v_p2dom', 1500, 8000, 0.08, OCT13, 2);
    const domFix = filterDominatedAlternatives([pDomHead, p3ok, p2dom], [{ plan: pDomHead }]).map(p => p.canonicalVector);
    check('parity: an owner-rule-omitted plan never dominates a valid trade-off (Codex P2)',
      domFix.includes('v_p3ok') && !domFix.includes('v_p2dom'), domFix.join(','));

    // Codex 2026-07-13 P2 (#3): owner-omitted plans ranked BEFORE valid ones must
    // not consume their slots. The engine now returns the uncapped ranked pool,
    // filters, THEN caps to alternativeLimit — so the two same-date 2-offer plans
    // sitting ahead of the three 3-offer plans do not hide them. (Same survivors
    // regardless of input order, proving position-independence.)
    const reordered = filterDominatedAlternatives([hH, h2a, h2b, h3a, h3b, h3c], [{ plan: hH }])
      .map(p => p.canonicalVector).sort().join(',');
    check('parity: valid trade-offs survive even when omitted plans are ranked ahead (Codex P2 #3)',
      reordered === 'v_3a,v_3b,v_3c,v_h', reordered);
  }
  {
    // ── Clause B: late materially-weighted tail (owner-directed 2026-07-13) ─────
    // Owner: "if capital back date (with that date representing at least 33% of the
    // weighted money held in that plan span) is later than the best total return
    // then it also omits." → a LATER-capital-back plan is omitted iff its final-date
    // dollar-day tail fraction ≥ LATE_TAIL_OMIT_FRACTION (0.33); a sliver tail
    // survives. Fixtures use a mutually non-dominating profile so ONLY Clause B
    // prunes. tailFrac is the 7th parPlan arg (objective.tailWeightFraction).
    const parIds = n => Array.from({ length: n }, (_, i) => 'o' + i);
    const parPlan = (cv, gross, low, apy, backISO, offers, tailFrac) => ({
      valid: true, canonicalVector: cv, includedIds: parIds(offers),
      capitalCurveSummary: { lowestAvailable: low },
      objective: { grossBonus: gross, blendedAnnReturn: apy, latestCompletionISO: backISO,
        tailWeightFraction: (typeof tailFrac === 'number' ? tailFrac : 0) }
    });
    const HEAD = parPlan('v_bh', 2650, 10000, 0.10, '2026-10-13', 4, 1.0); // headline
    const LATE_HEAVY = parPlan('v_lh', 2000, 30000, 0.14, '2026-11-13', 3, 0.50); // later, heavy tail → omit
    const LATE_SLIVER = parPlan('v_ls', 2000, 30000, 0.14, '2026-11-13', 3, 0.20); // later, sliver → keep
    const heavy = filterDominatedAlternatives([HEAD, LATE_HEAVY], [{ plan: HEAD }]).map(p => p.canonicalVector);
    check('clauseB: later capital-back with ≥33% dollar-day tail is omitted',
      !heavy.includes('v_lh') && heavy.includes('v_bh'), heavy.join(','));
    const sliver = filterDominatedAlternatives([HEAD, LATE_SLIVER], [{ plan: HEAD }]).map(p => p.canonicalVector);
    check('clauseB: later capital-back with a <33% tail survives',
      sliver.includes('v_ls'), sliver.join(','));
    // Boundary: exactly 0.33 is omitted (>=), 0.32 is kept.
    const onEdge = parPlan('v_edge', 2000, 30000, 0.14, '2026-11-13', 3, 0.33);
    const underEdge = parPlan('v_under', 2000, 30000, 0.14, '2026-11-13', 3, 0.32);
    const bnd = filterDominatedAlternatives([HEAD, onEdge, underEdge], [{ plan: HEAD }]).map(p => p.canonicalVector);
    check('clauseB: the 33% boundary — 0.33 omitted, 0.32 kept',
      !bnd.includes('v_edge') && bnd.includes('v_under'), bnd.join(','));
    // Champions honour Clause B too: a later-date heavy-tail secondary is omitted.
    const champB = filterChampionsByDisplayRule([{ plan: HEAD }, { plan: LATE_HEAVY }], HEAD)
      .map(c => c.plan.canonicalVector).join(',');
    check('clauseB: later-date heavy-tail secondary champion is omitted (no filler)',
      champB === 'v_bh', champB);
    // Determinism.
    const c1 = filterDominatedAlternatives([HEAD, LATE_HEAVY, LATE_SLIVER], [{ plan: HEAD }]).map(p => p.canonicalVector).join(',');
    const c2 = filterDominatedAlternatives([HEAD, LATE_HEAVY, LATE_SLIVER], [{ plan: HEAD }]).map(p => p.canonicalVector).join(',');
    check('clauseB: filter is deterministic across runs', c1 === c2, c1);
    // Real pipeline: objective.tailWeightFraction is populated. A single held
    // offer releases entirely on the final date → tail fraction 1. Two held offers
    // with different hold lengths (different release dates) → 0 < tail < 1.
    const one = evaluateOptimizerPlan(_pinState({
      offers: [_pinOffer({ id: 'off_tw1', signupBonusAmount: 500, requiredFundingAmount: 10000, daysFundsMustRemain: 30, offerExpirationDate: '2026-12-31' })],
      candidateIds: ['off_tw1']
    }), { off_tw1: '2026-07-20' });
    const two = evaluateOptimizerPlan(_pinState({
      offers: [
        _pinOffer({ id: 'off_twA', signupBonusAmount: 500, requiredFundingAmount: 10000, daysFundsMustRemain: 30, offerExpirationDate: '2026-12-31' }),
        _pinOffer({ id: 'off_twB', signupBonusAmount: 500, requiredFundingAmount: 10000, daysFundsMustRemain: 120, offerExpirationDate: '2026-12-31' })
      ],
      candidateIds: ['off_twA', 'off_twB']
    }), { off_twA: '2026-07-20', off_twB: '2026-07-20' });
    check('clauseB: real objective.tailWeightFraction — single offer = 1, split plan strictly between 0 and 1',
      Math.abs(one.objective.tailWeightFraction - 1) < 1e-9
      && two.objective.tailWeightFraction > 0 && two.objective.tailWeightFraction < 1,
      `one=${one.objective.tailWeightFraction} two=${two.objective.tailWeightFraction}`);
    // Codex 2026-07-13 P2: a standard multi-DD offer whose FINAL DD is a tiny leg
    // must NOT attribute the whole aggregate dollar-days to the final date. A big
    // early DD ($50k) + a tiny late DD ($500) → tail fraction ≈ 0.01 (was 1.0 under
    // the offer-level aggregate), so Clause B does not wrongly omit its plan.
    const multiDd = evaluateOptimizerPlan(_pinState({
      settings: { projectionStartDate: '2026-07-09', minimumCashBuffer: 0, currentLiquidCapital: 200000, ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 } },
      offers: [_pinOffer({
        id: 'off_ddtail', offerType: 'direct-deposit', signupBonusAmount: 600, requiredFundingAmount: 0,
        daysAfterSignupAllowedBeforeDeposit: 120, daysFundsMustRemain: 0, lockStartsFrom: 'funded date',
        offerExpirationDate: '2027-06-30',
        directDeposits: [{ id: 'd1', plannedDate: '2026-07-20', amount: 50000 }, { id: 'd2', plannedDate: '2026-10-20', amount: 500 }]
      })],
      candidateIds: ['off_ddtail'], options: { includeChurn: false, defaultWindowDays: 365 }
    }), { off_ddtail: '2026-07-15' });
    check('clauseB: multi-DD tail fraction is split per return date, not the offer aggregate (Codex P2)',
      multiDd.objective.tailWeightFraction < LATE_TAIL_OMIT_FRACTION && multiDd.objective.tailWeightFraction > 0,
      `tailFrac=${multiDd.objective.tailWeightFraction}`);
  }
  {
    // ── Survivor-cap starvation (owner display rule, Codex 2026-07-13 P2 follow-up)
    // rankAlternatives collects survivors up to totalCap (=max(limit*8,48)=64 here)
    // DURING the scan. If the top-ranked plans are all owner-omitted, they must NOT
    // consume the 64 survivor slots and starve valid lower-ranked trade-offs — so
    // omitted plans are skipped during collection (keepFn=ownerDisplayRuleKeeps).
    // Pool: headline (4 offers) + 70 higher-gross same-date 2-offer plans (Clause A
    // omits: 2 < 4−1) ranked ABOVE 5 valid same-date 3-offer plans. comparePlans
    // ranks by gross desc, so the 5 valid plans sit at rank ~72 (beyond totalCap).
    const SD = '2026-10-13';
    const mk = (cv, gross, ids, off) => ({
      valid: true, canonicalVector: cv, includedIds: ids,
      capitalCurveSummary: { lowestAvailable: 1000 + gross },
      objective: { grossBonus: gross, blendedAnnReturn: 0.05, latestCompletionISO: SD, tailWeightFraction: 1.0, churnNextEligible: [] },
      schedule: {}
    });
    const head = mk('v_head4', 5000, ['h0', 'h1', 'h2', 'h3'], 4);
    const omitted = [];
    for (let i = 0; i < 70; i++) omitted.push(mk('v_om' + i, 2000 + i, ['x' + (2 * i), 'x' + (2 * i + 1)], 2)); // 2 offers, high gross
    const valid = [];
    for (let i = 0; i < 5; i++) valid.push(mk('v_val' + i, 1000 + i, ['y' + (3 * i), 'y' + (3 * i + 1), 'y' + (3 * i + 2)], 3)); // 3 offers, low gross
    const pool = [head].concat(omitted).concat(valid);
    const withSkip = rankAlternatives(pool, 8, false, ownerDisplayRuleKeeps).map(p => p.canonicalVector);
    const validReached = valid.every(v => withSkip.includes(v.canonicalVector));
    check('parity: owner-omitted plans do not starve valid trade-offs past the survivor cap (Codex P2)',
      validReached, `valid reached=${valid.filter(v => withSkip.includes(v.canonicalVector)).length}/5`);
    // Control: WITHOUT the skip, the 64-survivor cap fills with omitted plans and
    // the valid trade-offs never enter the pool — proving the skip is load-bearing.
    const noSkip = rankAlternatives(pool, 8, false, null).map(p => p.canonicalVector);
    check('parity: control — without the skip the valid trade-offs are starved (regression guard)',
      valid.every(v => !noSkip.includes(v.canonicalVector)), `starved=${valid.filter(v => !noSkip.includes(v.canonicalVector)).length}/5`);
  }

  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  const perfMs = Date.now() - t0;
  if (typeof console !== 'undefined') {
    console.log(`testOptimizerPins: PASS ${pass}  FAIL ${fail}  PERF ${perfMs}ms`);
    for (const r of results) console.log(`  ${r.ok ? 'ok ' : 'X  '}${r.name}${r.extra ? '  [' + r.extra + ']' : ''}`);
  }
  return { pass, fail, results, perfMs };
}

export {
  OPTIMIZER_DEFAULTS,
  optimizePlanner,
  runPlannerOptimizer,
  evaluateOptimizerPlan,
  filterDominatedAlternatives,
  filterChampionsByDisplayRule,
  rankAlternatives,
  testOptimizerPins
};
