import { addBusinessDays, addDays, addMonthsClamped, daysBetween, formatDateDisplay, isoDate, parseDate, previousBusinessDay } from './date-format-core.js';
import { ddRoundTrip, ddWindowEndDate, directDepositEffectiveDate, normalizeDdTransfer } from './dd-core.js';
import { generateProjection, summarizeProjection } from './projection-optimizer.js';
import { annualizedReturn, bizDayISO, debitDeadlineISO, depositDeadline, ddCapitalTime, expectedBonusWindow, isOfferComplete, lockStartDate, offerIsActiveForProjection, withdrawalEligibleDate, churnEligibleDate, churnNextEligibleAfterPlan, churnSnoozeActive } from './offer-model.js';
import { HYPOTHETICAL_OFFER_STATUSES } from './runtime-status.js';

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
      if (churnSnoozeActive(source, ctx.todayDate)) {
        review.push({ offerId: source.id, status: 'excluded', reason: 'churn-snoozed' });
        continue;
      }
      const eligible = churnEligibleDate(source);
      if (!eligible) {
        review.push({ offerId: source.id, status: 'needs-date', reason: 'missing-churn-anchor' });
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
  if (offer.offerType !== 'direct-deposit' && offer.offerType !== 'held-and-dd') return;
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
  // everywhere — never the live provider.
  const cfg = ctx && ctx.ddTransfer;
  const postISO = dd => { const rt = ddRoundTrip(dd, cfg); return rt ? isoDate(rt.post) : ''; };
  const cutoffCandidates = [];
  if (offer.offerExpirationDate) cutoffCandidates.push(offer.offerExpirationDate);
  for (const row of offer.requirements || []) {
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
  if (offer.debitRequirement && offer.debitRequirement.required) {
    const dd = debitDeadlineISO(offer);
    if (!dd || dd < ctx.todayISO) constraints.push({ offerId: offer.id, kind: 'debit-deadline', dateISO: dd || '' });
  }
  for (const row of offer.requirements || []) {
    if (!row || row.done || row.source !== 'user') continue;
    const dl = localRequirementDeadlineISO(offer, row);
    if (dl && dl < ctx.todayISO) constraints.push({ offerId: offer.id, kind: 'requirement-deadline', dateISO: dl });
  }
  validateDdCadence(offer, constraints, ctx);
  if (!isOfferComplete(offer)) constraints.push({ offerId: offer.id, kind: 'completeness', dateISO: offer.plannedSignupDate || '' });
  return constraints;
}

function horizonDatesForOffer(offer, ctx) {
  const dates = [];
  const push = iso => { if (iso && parseDate(iso)) dates.push(iso); };
  push(lockStartDate(offer));
  push(withdrawalEligibleDate(offer, ctx.ddTransfer));
  push(depositDeadline(offer));
  push(debitDeadlineISO(offer));
  push(ddWindowEndDate(offer, ctx.ddTransfer));
  const win = expectedBonusWindow(offer, ctx.todayDate);
  if (win) push(win.endISO);
  for (const row of offer.requirements || []) push(localRequirementDeadlineISO(offer, row));
  for (const dd of offer.directDeposits || []) {
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
    directDeposits: (offer.directDeposits || []).map(dd => ({ id: dd.id || '', plannedDate: dd.plannedDate || '' }))
      .sort((a, b) => byteCompare(a.id, b.id)),
    derived: {
      lockStart: lockStartDate(offer) || '',
      withdrawalEligible: withdrawalEligibleDate(offer, cfg) || '',
      depositDeadline: depositDeadline(offer) || ''
    }
  };
}

function objectiveForOffers(offers, cfg) {
  let grossBonus = 0;
  let annNum = 0;
  let annDen = 0;
  let latestCompletionISO = '';
  const churnNextEligible = [];
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
      const ls = parseDate(lockStartDate(offer));
      const we = parseDate(withdrawalEligibleDate(offer, cfg));
      const days = ls && we ? Math.max(0, daysBetween(ls, we)) : Number(offer.daysFundsMustRemain || 0);
      weight = Number(offer.requiredFundingAmount || 0) * days;
    }
    if (ar != null && weight > 0) {
      annNum += ar * weight;
      annDen += weight;
    }
    const we = withdrawalEligibleDate(offer, cfg);
    if (we && (!latestCompletionISO || we > latestCompletionISO)) latestCompletionISO = we;
  }
  return {
    grossBonus: Math.round(grossBonus),
    blendedAnnReturn: annDen > 0 ? annNum / annDen : null,
    latestCompletionISO,
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
    objective: { grossBonus: 0, blendedAnnReturn: null, latestCompletionISO: '' },
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

// ── Named champion plans ────────────────────────────────────────────────────
// One card per objective axis, chosen from the SAME evaluated feasible pool (no
// new search) so a single card can speak to what each axis rewards:
//   total   — the overall winner (max gross via the full comparePlans chain);
//             stays the default/selected plan (it is always plan[0]).
//   rate    — highest blended annualized return on locked capital (may be a
//             small single-offer plan at far lower gross — that IS the message).
//   fastest — earliest final capital-release date (tie-break by gross, then the
//             standard chain).
// Ordered total → rate → fastest; when one plan wins multiple axes it collapses
// to ONE entry with merged labels (never a duplicate card). Pure + deterministic
// (each axis breaks ties through comparePlans, a total order), so it is
// pin-testable and render just consumes plan.champions.
const CHAMPION_AXES = [
  { key: 'total', label: 'Best total return' },
  { key: 'rate', label: 'Best rate of return' },
  { key: 'fastest', label: 'Fastest capital back' }
];

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

const CHAMPION_AXIS_PICKERS = {
  total: plans => plans.slice().sort(comparePlans)[0],
  rate: plans => plans.slice().sort(compareByRate)[0],
  fastest: plans => plans.slice().sort(compareByFastest)[0]
};

// Select the champion set from an evaluated plan pool. Champions are drawn from
// the FEASIBLE plans only; when none are feasible the set is empty. Merging is
// keyed on canonicalVector so two axis picks that resolve to the same schedule
// (whether the same object or an equal one) collapse into a single entry whose
// labels list both axes, preserving first-seen order.
function selectChampions(plans) {
  const feasible = (plans || []).filter(p => p && p.valid);
  if (!feasible.length) return [];
  const out = [];
  const byVector = new Map();
  for (const axis of CHAMPION_AXES) {
    const pick = CHAMPION_AXIS_PICKERS[axis.key](feasible);
    if (!pick) continue;
    const key = pick.canonicalVector;
    let entry = byVector.get(key);
    if (!entry) {
      entry = { plan: pick, axes: [], labels: [] };
      byVector.set(key, entry);
      out.push(entry);
    }
    entry.axes.push(axis.key);
    entry.labels.push(axis.label);
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
function rankAlternatives(plans, limit) {
  const sorted = plans.slice().sort(comparePlans);
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
    if (out.length >= limit) return out;
  }
  for (const p of survivors) {
    if (out.indexOf(p) !== -1) continue;
    out.push(p);
    if (out.length >= limit) break;
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
  best.alternatives = rankAlternatives(plans, ctx.options.alternativeLimit);
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
  best.alternatives = rankAlternatives(beamPool, ctx.options.alternativeLimit);
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
  plan.candidateReview = built.review;
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
    check('beam perf stays under wall-clock budget', elapsed < 2000, `${elapsed}ms`);
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
    // ── Named champion scenario cards ───────────────────────────────────────
    // selectChampions picks one plan per objective axis from the feasible pool,
    // ordered total → rate → fastest, merging axes any single plan wins.
    const champPlan = (cv, gross, apy, cashISO) => ({
      valid: true, canonicalVector: cv, includedIds: [cv],
      capitalCurveSummary: { lowestAvailable: 0 },
      objective: { grossBonus: gross, blendedAnnReturn: apy, latestCompletionISO: cashISO, churnNextEligible: [] }
    });
    // Distinct winners: biggest gross, highest APY, and earliest cash are 3
    // separate plans → 3 single-axis champion cards (input order shuffled).
    const pTotal = champPlan('v_total', 1000, 0.04, '2026-12-01');
    const pRate = champPlan('v_rate', 300, 0.10, '2026-10-01');
    const pFast = champPlan('v_fast', 500, 0.02, '2026-08-01');
    const champs = selectChampions([pRate, pFast, pTotal]);
    const axisOf = k => champs.find(c => c.axes.length === 1 && c.axes[0] === k);
    check('champions: distinct axis winners identified',
      champs.length === 3
      && champs[0].plan === pTotal && champs[0].axes[0] === 'total' && champs[0].labels[0] === 'Best total return'
      && !!axisOf('rate') && axisOf('rate').plan === pRate
      && !!axisOf('fastest') && axisOf('fastest').plan === pFast,
      `${champs.length} champions`);
    // Merged: one plan wins BOTH total and rate → ONE card, two labels.
    const pBig = champPlan('v_big', 1000, 0.10, '2026-12-01');
    const pEarly = champPlan('v_early', 400, 0.03, '2026-08-01');
    const merged = selectChampions([pBig, pEarly]);
    check('champions: one plan winning two axes collapses to a single merged card',
      merged.length === 2
      && merged[0].plan === pBig && merged[0].axes.length === 2
      && merged[0].labels.join(' · ') === 'Best total return · Best rate of return'
      && merged[1].plan === pEarly && merged[1].axes.length === 1 && merged[1].axes[0] === 'fastest',
      `${merged.length} cards`);
    check('champions: no feasible plan yields no champions',
      selectChampions([{ valid: false, canonicalVector: 'x', objective: {} }]).length === 0);
    // Engine wiring + determinism: a real optimize run exposes plan.champions
    // with the overall winner as the total champion (plan[0]), all champion
    // plans valid, no vector duplicated, identical across runs.
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
      && c1.every(c => c.plan.valid)
      && new Set(vectors).size === vectors.length,
      `${c1.length} champions`);
    check('champions: deterministic across runs', vecKey(c1) === vecKey(wp2.champions || []));
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
  testOptimizerPins
};
