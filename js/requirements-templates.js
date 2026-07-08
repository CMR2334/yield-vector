import { addDays, daysBetween, formatCurrency, isoDate, parseDate, uid } from './date-format-core.js';
/* ============================================================
   SCHEMA V2 — requirements[] layer over legacy offer fields.
   ============================================================
   The legacy fields (ddRequirement, debitRequirement, directDeposits,
   requiredFundingAmount, funding-window/hold day-counts) stay CANONICAL
   for every existing consumer — renders, feed, projection, ROI, lock
   math. The v2 `requirements[]` rows are an additive richer layer:
     • source:'derived' rows are a read-only projection of legacy fields,
       refreshed from legacy on every load + save (see syncRequirementsWith-
       Legacy). Their id is tied to the legacy source (never an array index)
       so refresh is a keyed upsert and later-step feed items bind to
       requirement identity, exactly like the per-DD feed keys do today.
     • source:'user' rows are NEW requirement types with no legacy equivalent
       (e-statements, maintain balance, promo code, …). Authoritative in
       their own right; the derivation layer never touches them.
   Design: docs/assessments/2026-07-07-schema-v2-design.md. */

// The v2 requirement row types. `derived` rows use a subset; `user` rows
// (added by later form-UI steps) can use any. Kept as a doc-only reference
// list — no runtime enum enforcement (matches the loose offerType handling).
const REQUIREMENT_TYPES = [
  'spend', 'deposit', 'direct_deposit_amt', 'direct_deposit_count',
  'transactions', 'debit_txns', 'activate_debit', 'estatements',
  'online_banking', 'maintain_balance', 'promo_code', 'custom'
];

// Per-type UI metadata for the Requirements section (step 3). `label` is the
// human dropdown/display name; `money`/`count` flag which numeric inputs the
// type exposes (a `$` amount, an integer count, or neither). This is the single
// source both the add-row dropdown and per-row field rendering read, so the two
// can't drift.
const REQUIREMENT_TYPE_META = {
  spend:                { label: 'Spend ($)',            money: true,  count: false },
  deposit:              { label: 'Deposit ($)',          money: true,  count: false },
  direct_deposit_amt:   { label: 'Direct Deposit ($)',   money: true,  count: false },
  direct_deposit_count: { label: 'Direct Deposits (#)',  money: false, count: true  },
  transactions:         { label: 'Transactions (#)',     money: false, count: true  },
  debit_txns:           { label: 'Debit Transactions (#)', money: false, count: true },
  activate_debit:       { label: 'Activate Debit Card',  money: false, count: false },
  estatements:          { label: 'Enroll e-Statements',  money: false, count: false },
  online_banking:       { label: 'Enroll Online Banking', money: false, count: false },
  maintain_balance:     { label: 'Maintain Balance ($)', money: true,  count: false },
  promo_code:           { label: 'Enter Promo Code',     money: false, count: false },
  custom:               { label: 'Custom',               money: true,  count: true  }
};
const REQUIREMENT_FREQUENCIES = ['total', 'monthly', 'per_statement'];
const REQUIREMENT_FREQ_LABELS = { total: 'Total', monthly: 'Monthly', per_statement: 'Per statement' };

// Display title for a requirement row: an explicit label wins (custom rows,
// derived rows already carry a computed label); otherwise fall back to the
// type's human name. Keeps the card checklist / feed titles readable.
function requirementDisplayLabel(row) {
  if (!row) return '';
  if (row.label && String(row.label).trim()) return String(row.label).trim();
  const meta = REQUIREMENT_TYPE_META[row.type];
  return meta ? meta.label : (row.type || 'Requirement');
}

// DISPLAY-ONLY (Item 5a): strip a trailing bonus amount from an offer's shown
// name (owner: "BMO — Premier Checking $600" → the $600 is redundant, the bonus
// renders separately). Removes only a trailing "$N" token (optionally preceded
// by a dash). The STORED offerName is never touched, and feed titles keep the
// raw name. Used by the card subtitle, offers table, and combo picker rows.
function displayOfferName(name) {
  return String(name == null ? '' : name).replace(/\s*[-–—]?\s*\$[\d,]+(?:\.\d+)?$/, '').trim();
}

// Compose an offer/template's DISPLAY label: bank name, plus the display offer
// name (trailing "$N" stripped by displayOfferName) joined by `separator` when
// present, else the bank name alone. `separator` defaults to an em dash; the
// planner combo card passes ' · '. PURE and format-only — callers wrap it for
// their own needs: escaped (escapeHtml(offerDisplayLabel(o,{separator:' · '}))),
// prefixed (`Re-run of ${offerDisplayLabel(o)}`), or with an empty-name fallback
// (offerDisplayLabel(tpl) || 'Untitled offer'). The chart marker shows bank-only
// unless the bank is ambiguous (ambiguous ? offerDisplayLabel(o) : o.bankName).
// The reminder FEED deliberately uses raw names and does NOT route through here.
function offerDisplayLabel(o, { separator = ' — ' } = {}) {
  const dn = displayOfferName(o.offerName);
  return dn ? o.bankName + separator + dn : o.bankName;
}

// The absolute calendar deadline for a requirement row, as an ISO string, or
// '' when it can't be computed. Anchored on the SAME sign-up date the existing
// deposit/debit deadline math uses (offer.plannedSignupDate): deadline_days is
// stored relative to it (deriveRequirementsFromLegacy computes derived rows'
// day-counts the same way), so a sign-up-date edit re-dates every row with no
// stored absolute date to drift. A signupOverride (ISO) lets the modal compute
// live against the currently-typed sign-up field before save.
function requirementDeadlineISO(offer, row, signupOverride) {
  if (!row || row.deadline_days == null || row.deadline_days === '') return '';
  const days = Number(row.deadline_days);
  if (!Number.isFinite(days)) return '';
  const anchor = parseDate(signupOverride != null ? signupOverride : (offer && offer.plannedSignupDate));
  if (!anchor) return '';
  return isoDate(addDays(anchor, days));
}

// A short "$amount · frequency" style summary for a requirement row, used as
// the feed item notes and the card checklist sub-line. Empty parts are omitted.
function requirementSummary(row) {
  if (!row) return '';
  const parts = [];
  if (row.amount != null && row.amount !== '') parts.push(formatCurrency(Number(row.amount)));
  if (row.count != null && row.count !== '') parts.push(`${Number(row.count)}×`);
  if (row.frequency && row.frequency !== 'total') parts.push(REQUIREMENT_FREQ_LABELS[row.frequency] || row.frequency);
  return parts.join(' · ');
}

// Build a fresh requirement row with all fields defaulted. `over` supplies
// the derived/known fields; done/done_date/notes default empty so a new
// derived row starts un-done (syncRequirementsWithLegacy preserves those
// across refreshes for rows that already exist).
function makeRequirementRow(over) {
  return Object.assign({
    id: '', type: 'custom', label: '', amount: null, count: null,
    deadline_days: null, frequency: 'total', hold_days: null,
    done: false, done_date: null, source: 'user', notes: ''
  }, over || {});
}

// PURE: compute the set of derived requirement rows from an offer's current
// legacy fields. Allocates new rows (source:'derived') with STABLE ids tied
// to each legacy source — never merges or reads existing requirements. Every
// legacy access is guarded so offers missing a sub-object (e.g. seed offers
// with no ddRequirement/debitRequirement/directDeposits) simply yield fewer
// rows rather than throwing. Deterministic order: funding, ddreq, per-DD (in
// array order), debit — so a re-run with unchanged legacy is byte-identical.
function deriveRequirementsFromLegacy(offer) {
  const rows = [];
  if (!offer) return rows;

  // requiredFundingAmount → a single `deposit` obligation. deadline_days is
  // the funding window (daysAfterSignupAllowedBeforeDeposit); hold_days is the
  // post-funding lock (daysFundsMustRemain). Both may be null.
  const funding = (offer.requiredFundingAmount != null && offer.requiredFundingAmount !== '')
    ? Number(offer.requiredFundingAmount) : null;
  if (funding != null && funding > 0) {
    rows.push(makeRequirementRow({
      id: 'req-funding', type: 'deposit', source: 'derived',
      label: 'Fund account',
      amount: funding,
      deadline_days: (offer.daysAfterSignupAllowedBeforeDeposit != null && offer.daysAfterSignupAllowedBeforeDeposit !== '')
        ? Number(offer.daysAfterSignupAllowedBeforeDeposit) : null,
      hold_days: (offer.daysFundsMustRemain != null && offer.daysFundsMustRemain !== '')
        ? Number(offer.daysFundsMustRemain) : null
    }));
  }

  // ddRequirement count/frequency spec → a `direct_deposit_count` obligation
  // (the COUNT/frequency requirement, distinct from the individual scheduled
  // DD rows below). frequency maps count-mode → 'total', frequency-mode → the
  // period cadence. Only emitted when a positive count is specified.
  // MATERIALIZATION GATE (step-3 fix #2): the offer form writes a DEFAULT
  // ddRequirement ({mode:'count',count:1,…}) for EVERY offer regardless of type,
  // so gating only on "count > 0" would grow a phantom req-ddreq row on every
  // saved new-funds-held offer that never had a DD requirement. A ddRequirement
  // is only a real obligation for the DD-family types, so require the offerType
  // to be one of them before deriving the row. (Per-DD rows below are naturally
  // gated — a non-DD offer has no directDeposits[] entries.)
  const isDdFamily = offer.offerType === 'direct-deposit' || offer.offerType === 'held-and-dd';
  const ddReq = isDdFamily ? offer.ddRequirement : null;
  if (ddReq) {
    if (ddReq.mode === 'frequency') {
      const periods = Number(ddReq.freqPeriods) || null;
      if (periods && periods > 0) {
        rows.push(makeRequirementRow({
          id: 'req-ddreq', type: 'direct_deposit_count', source: 'derived',
          label: `Direct deposits (${periods}× per ${ddReq.freqEvery || 'month'})`,
          count: periods,
          frequency: (ddReq.freqEvery === 'week' || ddReq.freqEvery === '2weeks') ? 'monthly' : 'monthly'
        }));
      }
    } else {
      const cnt = Number(ddReq.count) || null;
      if (cnt && cnt > 0) {
        rows.push(makeRequirementRow({
          id: 'req-ddreq', type: 'direct_deposit_count', source: 'derived',
          label: `Direct deposits (${cnt} total)`,
          count: cnt, frequency: 'total'
        }));
      }
    }
  }

  // Each scheduled directDeposits[] row → a per-DD `direct_deposit_amt` row,
  // id reusing the DD's own persisted id (minted by migrateDdIds) so it stays
  // stable across reorders. deadline_days derived from the DD's plannedDate vs
  // the sign-up date when both exist.
  if (Array.isArray(offer.directDeposits)) {
    const signup = parseDate(offer.plannedSignupDate);
    for (const dd of offer.directDeposits) {
      if (!dd || !dd.id) continue; // ids are guaranteed by migrateDdIds on load
      const amt = (dd.amount != null && dd.amount !== '') ? Number(dd.amount) : null;
      const planned = parseDate(dd.plannedDate);
      const deadline = (signup && planned) ? Math.round(daysBetween(signup, planned)) : null;
      rows.push(makeRequirementRow({
        id: `req-dd-${dd.id}`, type: 'direct_deposit_amt', source: 'derived',
        label: 'Direct deposit',
        amount: amt,
        deadline_days: (deadline != null && deadline >= 0) ? deadline : null
      }));
    }
  }

  // debitRequirement (when required) → a `debit_txns` obligation. deadline_days
  // is the relative withinDays (migrateDebitRequirement already converted any
  // legacy absolute byDate to withinDays).
  const dr = offer.debitRequirement;
  if (dr && dr.required) {
    rows.push(makeRequirementRow({
      id: 'req-debit', type: 'debit_txns', source: 'derived',
      label: 'Debit transactions',
      count: (dr.count != null && dr.count !== '') ? Number(dr.count) : null,
      deadline_days: (dr.withinDays != null && dr.withinDays !== '') ? Number(dr.withinDays) : null
    }));
  }

  return rows;
}

// Refresh an offer's source:'derived' requirement rows IN PLACE from its
// current legacy fields — called on load (migration) and on every form save.
//   • Existing derived row (matched by id) → its derived fields are refreshed
//     but done/done_date/notes are PRESERVED (a user's "I did this deposit"
//     survives editing the deposit amount).
//   • New derived source → row appended.
//   • Derived row whose legacy source is gone (DD deleted, debit unset, funding
//     cleared) → removed.
//   • source:'user' rows are never inspected or modified.
// Idempotent: unchanged legacy → identical requirements (same ids, same order).
function syncRequirementsWithLegacy(offer) {
  if (!offer) return offer;
  if (!Array.isArray(offer.requirements)) offer.requirements = [];

  const desired = deriveRequirementsFromLegacy(offer);
  const desiredById = new Map(desired.map(r => [r.id, r]));
  const desiredIds = new Set(desiredById.keys());

  // Index the offer's EXISTING derived rows by id (to preserve their progress).
  const existingDerived = new Map();
  for (const row of offer.requirements) {
    if (row && row.source === 'derived' && row.id) existingDerived.set(row.id, row);
  }

  // Rebuild the array: keep user rows untouched (in place), drop derived rows
  // whose source vanished, refresh-in-place survivors, append new derived rows.
  const next = [];
  // 1) user rows first stay wherever they were relative to each other; we keep
  //    them in their original positions by walking the original array and
  //    emitting user rows + surviving derived rows in order, then appending any
  //    brand-new derived rows at the end (deterministic: derive() order).
  const emittedDerived = new Set();
  for (const row of offer.requirements) {
    if (!row) continue;
    if (row.source === 'user') { next.push(row); continue; }
    if (row.source === 'derived') {
      if (!row.id || !desiredIds.has(row.id)) continue; // source gone → drop
      // Refresh derived fields in place; preserve progress + notes.
      const d = desiredById.get(row.id);
      row.type = d.type; row.label = d.label; row.amount = d.amount;
      row.count = d.count; row.deadline_days = d.deadline_days;
      row.frequency = d.frequency; row.hold_days = d.hold_days;
      next.push(row);
      emittedDerived.add(row.id);
      continue;
    }
    // Unknown source (defensive) — keep as-is so nothing is silently lost.
    next.push(row);
  }
  // 2) Append derived rows that didn't already exist, in derive() order.
  for (const d of desired) {
    if (!emittedDerived.has(d.id)) next.push(d);
  }

  offer.requirements = next;
  return offer;
}

// V2 scalar-field defaults (churnability, promoted fees/promo, bonus-post
// window). Applied once per offer in migrateOffersToSchemaV2 and used as the
// literal defaults spread into a new offer on save. Kept as a factory so the
// migration and readOfferForm can't drift.
function schemaV2Defaults() {
  return {
    churnable: null,               // true | false | null (unknown)
    churn_wait_months: null,       // Number | null
    churn_anchor: 'bonus_received',// 'bonus_received' | 'account_closed' | 'account_opened'
    churn_notes: '',
    churn_snoozed_until: null,     // ISO | 'forever' | null — snooze the churn
                                   // section/feed for this offer. Personal state;
                                   // deliberately NOT in TEMPLATE_TERMS_KEYS.

    bonus_received_date: null,     // ISO | null (anchor date; new — no legacy equiv)
    closed_date: null,             // ISO | null (anchor date; new — no legacy equiv)
    monthly_fee: null,             // Number | null
    fee_waiver_condition: '',
    promo_code: '',
    early_termination_fee: null,   // Number | null
    etf_window_days: null,         // Number | null
    bonus_post_min_days: null,     // Number | null
    bonus_post_max_days: null      // Number | null
  };
}

/* ============================================================
   OFFER TEMPLATES (F5) — the personal "mini Deal Radar"
   ------------------------------------------------------------
   A template is an offer's TERMS with every scrap of personal data stripped:
   no planned dates, no entity/email, no notes, no status, no per-DD instances,
   no requirement done-state. It rides state.templates[] at the state root, so
   the existing localStorage + Gist sync carry it for free; it is NEVER read by
   buildReminderItems (that loop is state.offers only) so a template can never
   emit a feed item. The two functions below are PURE (no App/DOM/Date-of-save
   coupling except the fresh id + savedAt stamp) and are exported to a Node test
   harness that asserts the strip is total. */

// Whitelist of the OFFER keys a template preserves — offer TERMS only. Anything
// not on this list (plannedSignupDate, optionalPlannedFundingDate,
// bonus_received_date, closed_date, last_edited, entityUsed, emailUsed, notes,
// churn_notes, churn_snoozed_until, lifecycle_suggest_dismissed, accountStatus/subStatus/status,
// confidence, includeInScenario, directDeposits) is dropped by construction —
// a whitelist (not a blacklist) means a NEW personal field added to offers
// later can never silently leak into a template. color + docUrl are cosmetic /
// provenance and intentionally travel; offerExpirationDate stays because a
// template for an expired offer is still a valuable re-run reference.
const TEMPLATE_TERMS_KEYS = [
  'bankName', 'offerName', 'offerType',
  'signupBonusAmount', 'offerExpirationDate',
  'requiredFundingAmount', 'daysAfterSignupAllowedBeforeDeposit', 'daysFundsMustRemain',
  'monthly_fee', 'fee_waiver_condition', 'promo_code',
  'early_termination_fee', 'etf_window_days',
  'bonus_post_min_days', 'bonus_post_max_days',
  'churnable', 'churn_wait_months', 'churn_anchor',
  'color', 'docUrl'
];

// Strip a requirement row down to its OBLIGATION shape for a template: keep what
// the obligation IS (type/label/amount/count/deadline_days/frequency/hold_days)
// but drop every trace of PROGRESS or import provenance (done, done_date, notes,
// _fromImport) and force source:'user' (a template only carries the user's own
// rows; derived rows are re-computed from the terms on instantiation).
function stripRequirementForTemplate(row) {
  if (!row) return null;
  return {
    type: row.type || 'custom',
    label: row.label || '',
    amount: (row.amount === undefined ? null : row.amount),
    count: (row.count === undefined ? null : row.count),
    deadline_days: (row.deadline_days === undefined ? null : row.deadline_days),
    frequency: row.frequency || 'total',
    hold_days: (row.hold_days === undefined ? null : row.hold_days),
    source: 'user'
  };
}

// Copy a template's ddRequirement CONFIG (the requirement shape — mode/count/
// frequency) without any per-DD planned dates/instances (those live in the
// offer's directDeposits[], which templates never carry). Returns null when the
// source offer had none.
function templateDdRequirement(dd) {
  if (!dd || typeof dd !== 'object') return null;
  return {
    mode: dd.mode === 'frequency' ? 'frequency' : 'count',
    count: (dd.count == null ? null : Number(dd.count)),
    freqEvery: dd.freqEvery || 'month',
    freqPeriods: (dd.freqPeriods == null ? null : Number(dd.freqPeriods))
  };
}

// Copy a debit requirement's CONFIG for a template: keep required/count/
// withinDays (the obligation) but drop byDate/byDateLegacy (absolute dates are
// personal-timeline artifacts). Returns null when absent.
function templateDebitRequirement(dr) {
  if (!dr || typeof dr !== 'object') return null;
  return {
    required: !!dr.required,
    count: (dr.count == null ? null : Number(dr.count)),
    withinDays: (dr.withinDays == null ? null : Number(dr.withinDays))
  };
}

// PURE: build a reusable template from an offer. Personal data is stripped by
// whitelist (TEMPLATE_TERMS_KEYS) — the returned object contains NONE of the
// personal fields. Requirement rows are reduced to obligation shape (user rows
// only). A fresh tplId (tpl_… via the shared uid idiom) + savedAt ISO stamp are
// the only non-offer-derived values. Never mutates `offer`.
function offerToTemplate(offer) {
  const o = offer || {};
  const tpl = {
    tplId: uid('tpl'),
    savedAt: new Date().toISOString()
  };
  // Terms whitelist — copy only keys that are actually present so a template's
  // shape mirrors the offer's known fields (undefined terms simply omitted).
  for (const k of TEMPLATE_TERMS_KEYS) {
    if (k in o) tpl[k] = o[k];
  }
  // Requirement CONFIG objects (not the offer's live instances).
  tpl.ddRequirement = templateDdRequirement(o.ddRequirement);
  tpl.debitRequirement = templateDebitRequirement(o.debitRequirement);
  // User requirement rows only, stripped of done/done_date/notes/_fromImport.
  const reqs = Array.isArray(o.requirements) ? o.requirements : [];
  tpl.requirements = reqs
    .filter(r => r && r.source === 'user')
    .map(stripRequirementForTemplate)
    .filter(Boolean);
  return tpl;
}

// PURE: instantiate a fresh, unsaved OFFER from a template. Today-agnostic — no
// dates are invented (plannedSignupDate/funding dates start blank; the user
// sets them in the modal). Status starts at the prospect/closed defaults (a new
// offer is always a fresh prospect regardless of what the source offer was).
// A fresh offer id (off_…) is minted. Requirement rows are rehydrated through
// makeRequirementRow so downstream code sees a full row shape; derived rows are
// left for readOfferForm/syncRequirementsWithLegacy to recompute from the terms.
// Never mutates `tpl`.
function templateToOffer(tpl) {
  const t = tpl || {};
  const offer = {
    id: uid('off'),
    // Terms — pull straight from the template, falling back to schema-sane
    // empties so the offer object is always well-shaped for the modal render.
    bankName: t.bankName || '',
    offerName: t.offerName || '',
    offerType: (t.offerType && t.offerType !== 'other') ? t.offerType : 'new-funds-held',
    signupBonusAmount: (t.signupBonusAmount == null ? null : t.signupBonusAmount),
    offerExpirationDate: t.offerExpirationDate || '',
    requiredFundingAmount: (t.requiredFundingAmount == null ? null : t.requiredFundingAmount),
    daysAfterSignupAllowedBeforeDeposit: (t.daysAfterSignupAllowedBeforeDeposit == null ? 30 : t.daysAfterSignupAllowedBeforeDeposit),
    daysFundsMustRemain: (t.daysFundsMustRemain == null ? null : t.daysFundsMustRemain),
    ddRequirement: templateDdRequirement(t.ddRequirement),
    debitRequirement: t.debitRequirement
      ? Object.assign(templateDebitRequirement(t.debitRequirement), { byDate: '', byDateLegacy: '' })
      : { required: false, count: null, withinDays: null, byDate: '', byDateLegacy: '' },
    // Fees & terms scalars.
    monthly_fee: (t.monthly_fee == null ? null : t.monthly_fee),
    fee_waiver_condition: t.fee_waiver_condition || '',
    promo_code: t.promo_code || '',
    early_termination_fee: (t.early_termination_fee == null ? null : t.early_termination_fee),
    etf_window_days: (t.etf_window_days == null ? null : t.etf_window_days),
    bonus_post_min_days: (t.bonus_post_min_days == null ? null : t.bonus_post_min_days),
    bonus_post_max_days: (t.bonus_post_max_days == null ? null : t.bonus_post_max_days),
    // Churnability.
    churnable: (t.churnable === true ? true : (t.churnable === false ? false : null)),
    churn_wait_months: (t.churn_wait_months == null ? null : t.churn_wait_months),
    churn_anchor: t.churn_anchor || 'bonus_received',
    churn_notes: '',
    // Cosmetic / provenance travel with the template.
    color: t.color || '',
    docUrl: t.docUrl || '',
    // Personal fields — reset to fresh-prospect defaults, NO invented dates.
    plannedSignupDate: '',
    optionalPlannedFundingDate: '',
    bonus_received_date: null,
    closed_date: null,
    lockStartsFrom: 'funded date',
    status: 'prospect',
    accountStatus: 'closed',
    subStatus: 'prospect',
    includeInScenario: true,
    confidence: 'likely',
    notes: '',
    entityUsed: '',
    emailUsed: '',
    directDeposits: [],
    last_edited: null
  };
  // User requirement rows: rehydrate to full row shape (fresh ids, un-done).
  const reqs = Array.isArray(t.requirements) ? t.requirements : [];
  offer.requirements = reqs.map(r => makeRequirementRow(Object.assign(
    {}, stripRequirementForTemplate(r), { id: uid('req'), source: 'user' }
  )));
  return offer;
}

// One-time migration to schema v2. Runs in App.init AFTER the legacy
// per-offer migrations (so derivation reads already-normalized legacy values).
// Per offer lacking the v2 marker (presence of a `requirements` array):
//   • seed the new scalar fields (only if absent — never clobber),
//   • seed requirements:[] and run derivation,
//   • set last_edited:null (unknown history — we don't fabricate a timestamp).
// Idempotent: a second run finds `requirements` present and does the always-on
// derived-row sync only (no scalar re-seed, no last_edited reset). Before the
// FIRST mutation, snapshots the whole state to localStorage 'yv-backup-pre-v2'
// (only if that key is absent) for the Settings restore path; a quota failure
// is logged and must NOT block the app. Does NOT save()/schedulePush — leaves
// persistence to the next genuine user save (like the other init migrations).
export { REQUIREMENT_TYPES, REQUIREMENT_TYPE_META, REQUIREMENT_FREQUENCIES, REQUIREMENT_FREQ_LABELS, requirementDisplayLabel, displayOfferName, offerDisplayLabel, requirementDeadlineISO, requirementSummary, makeRequirementRow, deriveRequirementsFromLegacy, syncRequirementsWithLegacy, schemaV2Defaults, offerToTemplate, templateToOffer };
