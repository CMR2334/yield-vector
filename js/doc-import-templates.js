import { App } from './app-state.js';
import { formatCompactCurrency, formatDateDisplay, formatDateMedium, formatMoneyInput, formatDollarInput, parseMoneyInput, uid } from './date-format-core.js';
import { parseDocPost } from './doc-parser.js';
import { generateDdDatesFromRequirement, readUserReqsFromForm, refreshLifecycleStrip, refreshRequirementsSection, showOfferModal, writeUserReqsToForm } from './modals-forms.js';
import { offerDisplayLabel, makeRequirementRow, requirementSummary, templateToOffer } from './requirements-templates.js';
import { ErrCode, logError } from './runtime-status.js';
import { Sync } from './sync-pwa.js';
import { escapeAttr, escapeHtml, toast } from './ui-utils.js';
/* ============================================================
   DoC IMPORT: preview/confirm panel + apply-to-form
   ============================================================
   Bridges parseDocPost() output → the offer-form inputs. NOTHING here saves
   state — Apply only fills FORM inputs (legacy inputs for mappable fields, so
   the existing write-through/derivation refresh fires; #f-user-reqs additions
   for row-only types; scalars for Fees & terms / Churnability / expiration /
   names). The user still presses the normal Save. All parsed strings + snippets
   are escaped before reaching innerHTML (paste is untrusted). */

// Field-mapping metadata. Order here is the preview render order. Each entry:
//   key       parseDocPost field key
//   label     preview display label (0.02em uppercase via CSS)
//   format(v) → human display string for the parsed value
//   apply(v)  → writes into the form; may be a scalar-input write or bespoke
//   current() → the CURRENT non-empty form value as a display string (for the
//               overwrite strike-through), or '' when the field is empty
// The Dom helpers (`_docSetInput`, etc.) dispatch input+change so the modal's
// existing reverse-write-through / derived-row refresh recomputes.
function _docForm() { return document.getElementById('offer-form'); }
function _docEl(sel) { const f = _docForm(); return f ? f.querySelector(sel) : null; }
// Set a scalar input's value and fire input+change so dependent logic runs.
// Capitalize the FIRST letter of an applied free-text value ("smaller companies…"
// → "Smaller companies…"). Leaves the rest untouched (not title-case). Returns
// the input unchanged when it has no letter to capitalize.
function _docCapFirst(s) {
  const str = String(s);
  const m = str.match(/[A-Za-z]/);
  if (!m) return str;
  return str.slice(0, m.index) + str[m.index].toUpperCase() + str.slice(m.index + 1);
}
function _docSetInput(sel, value, kind) {
  const el = _docEl(sel);
  if (!el) return;
  if (kind === 'money') el.value = (value == null || value === '') ? '' : formatMoneyInput(value);
  else if (kind === 'date') el.value = value ? formatDateDisplay(value) : '';
  else {
    let out = (value == null) ? '' : String(value);
    // R70: capitalize the first letter of applied prose so imported text reads
    // naturally. EXCLUSIONS that must pass through byte-for-byte: promo codes and
    // URL/doc fields (case-sensitive at the bank — mangling flips a valid code),
    // <select> enums (churnable / churn-anchor — a capital breaks option matching),
    // and machine tokens (true|false, snake_case). A value with no leading letter
    // is untouched by _docCapFirst anyway.
    const skip = /promo|url|link|\bdoc\b|f-doc/i.test(sel)
      || (el.tagName === 'SELECT')
      || /^(?:true|false)$/i.test(out)
      || /^[a-z]+(?:_[a-z]+)+$/.test(out);
    if (out && !skip) out = _docCapFirst(out);
    el.value = out;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function _docCurrentInput(sel, kind) {
  const el = _docEl(sel);
  if (!el || el.value == null || String(el.value).trim() === '') return '';
  if (kind === 'money') { const n = parseMoneyInput(el.value); return formatDollarInput(n, { fallback: '' }); }
  return String(el.value).trim();
}
// Add (or update) a user requirement row of `type` with amount/count into the
// hidden #f-user-reqs payload, then refresh the requirements section. Reuses the
// same mechanism the modal's "+ Add requirement" uses so the row survives Save.
function _docAddUserReq(type, over) {
  const rows = (typeof readUserReqsFromForm === 'function') ? readUserReqsFromForm() : [];
  // De-dupe on type + NORMALIZED LABEL, not type alone: re-importing the same
  // post updates the matching import-row in place, but two genuinely different
  // rows of the same type (e.g. two distinct "Spend" requirements with different
  // labels) no longer collapse into one on re-apply.
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
  const wantLabel = norm((over || {}).label);
  let row = rows.find(r => r && r._fromImport && r.type === type && norm(r.label) === wantLabel);
  if (!row) { row = makeRequirementRow(Object.assign({ id: uid('req'), type, source: 'user', _fromImport: true }, over || {})); rows.push(row); }
  else { Object.assign(row, over || {}); }
  if (typeof writeUserReqsToForm === 'function') writeUserReqsToForm(rows);
  if (typeof refreshRequirementsSection === 'function') refreshRequirementsSection();
}
// Append a line to the Notes textarea (shared by points-bonus + the LLM-only
// prose fields). Fires input so the modal's write-through picks it up.
function _docAppendNote(line) {
  const el = _docEl('#f-notes');
  if (!el) return;
  el.value = el.value && el.value.trim() ? (el.value.replace(/\s+$/, '') + '\n' + line) : line;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// Wire the legacy DIRECT-DEPOSIT model for a dd_total tier (step 4b / P2a). The
// projection + completeness read directDeposits[] (dated rows with amounts), not
// the requirement spec, so a user-req row alone is invisible. This: (1) flips the
// offer type to 'direct-deposit' (the DD radio) if not already a DD variant —
// which reveals the DD section and, via syncDdSectionUI, auto-generates rows when
// empty; (2) explicitly (re)generates dated DD rows from the requirement controls
// + the just-applied #f-funding (= the DD total, divided across the deposits).
// After this the offer is NOT a draft and its DD amounts project as capital. All
// targets are the existing modal inputs/functions — no new persistence path.
function _docWireDdModel() {
  const cur = (_docEl('[name="offerType"]:checked') || {}).value;
  if (cur !== 'direct-deposit' && cur !== 'held-and-dd') {
    const r = _docEl('#ot-dd');
    if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  // Regenerate rows unconditionally so the amounts reflect the tier's funding
  // even if syncDdSectionUI already seeded rows from a prior (stale) funding.
  if (typeof generateDdDatesFromRequirement === 'function') generateDdDatesFromRequirement();
}

// Pure decision helper (2026-07-14 hold-vs-spend generalization) for the
// requirementLogic apply path below. The importer's either/or apply used to
// FORCE the DD-family offer type unconditionally whenever the current type
// was new-funds-held — which can never surface the 'hold' path for a held
// offer whose either/or is actually hold-vs-spend (e.g. Brex: hold new funds
// 1 day OR meet card spend), because the DD offer type it forces excludes
// 'hold' as a choosable family (docs/assessments/2026-07-13-requirements-driven-paths.md
// §2). Distinguish the two shapes the parser can emit for requirementLogic:
// 'any' on a held-type offer: a genuine DD-vs-spend disjunction (a "Direct
// deposit required" row was actually parsed AND left checked in the preview
// → ddParsed true; an unchecked/absent row is no DD signal — preview
// checkboxes are authoritative) still forces the DD-family type (existing
// behavior, unchanged); a hold-vs-spend disjunction (held-type offer, no DD
// requirement parsed/checked) must NOT force it, so the offer
// stays new-funds-held and the requirements-derived chooser can surface
// Hold funds vs Card spend. An explicit Held+DD offer type is never touched
// either way (curOfferType !== 'new-funds-held').
function _docEitherOrForceDdFamily(curOfferType, ddParsed) {
  return curOfferType === 'new-funds-held' && !!ddParsed;
}

const DOC_FIELD_MAP = [
  { key: 'bankName', label: 'Bank name', format: v => v, current: () => _docCurrentInput('#f-bank'), apply: v => _docSetInput('#f-bank', v) },
  { key: 'offerName', label: 'Offer name', format: v => v, current: () => _docCurrentInput('#f-offer'), apply: v => _docSetInput('#f-offer', v) },
  { key: 'signupBonusAmount', label: 'Bonus amount', format: v => formatDollarInput(v), current: () => _docCurrentInput('#f-bonus', 'money'), apply: v => _docSetInput('#f-bonus', v, 'money') },
  { key: 'offerExpirationDate', label: 'Expiration date', format: v => formatDateDisplay(v), current: () => _docCurrentInput('#f-expires'), apply: v => _docSetInput('#f-expires', v, 'date') },
  { key: 'ddRequired', label: 'Direct deposit required', format: v => v ? 'Yes' : 'No',
    current: () => { const t = (( _docForm() || {}).querySelector ? _docForm().querySelector('[name="offerType"]:checked') : null); return t ? ({ 'new-funds-held': 'New funds held', 'direct-deposit': 'Direct deposit', 'held-and-dd': 'Held + DD' }[t.value] || '') : ''; },
    apply: v => {
      // Only switch offer type when DD is required and the form is still on the
      // default new-funds-held — never clobber a user's explicit Held+DD choice.
      if (!v) return;
      const cur = (_docEl('[name="offerType"]:checked') || {}).value;
      if (cur === 'new-funds-held') { const r = _docEl('#ot-dd'); if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); } }
    } },
  { key: 'requiredFundingAmount', label: 'Funding amount', format: v => formatDollarInput(v), current: () => _docCurrentInput('#f-funding', 'money'), apply: v => _docSetInput('#f-funding', v, 'money') },
  { key: 'daysAfterSignupAllowedBeforeDeposit', label: 'Deposit/DD window (days)', format: v => v + ' days', current: () => _docCurrentInput('#f-days-deposit'), apply: v => _docSetInput('#f-days-deposit', v) },
  { key: 'daysFundsMustRemain', label: 'Hold period (days)', format: v => v + ' days', current: () => _docCurrentInput('#f-days-remain'), apply: v => _docSetInput('#f-days-remain', v) },
  // Hold ANCHOR (R70). Only emitted by the parser for an opening-anchored day-span
  // ("days 31 through day 90"), where getting it wrong under-holds; a funded hold
  // leaves the form's default 'funded date' radio and this row is simply absent.
  { key: 'lockStartsFrom', label: 'Hold counted from', format: v => (v === 'open date' ? 'Account opening' : 'Funded date'),
    current: () => { const r = _docEl('[name="lockStartsFrom"]:checked'); return r ? (r.value === 'open date' ? 'Account opening' : 'Funded date') : ''; },
    apply: v => { const r = _docEl(v === 'open date' ? '#lsf-open' : '#lsf-fund'); if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); } } },
  { key: 'debitCount', label: 'Debit transactions', format: v => v + '×',
    current: () => { const y = _docEl('#debit-yes'); return (y && y.checked) ? _docCurrentInput('#f-debit-count') : ''; },
    apply: v => { const y = _docEl('#debit-yes'); if (y) { y.checked = true; y.dispatchEvent(new Event('change', { bubbles: true })); } _docSetInput('#f-debit-count', v); } },
  { key: 'debitWithinDays', label: 'Debit window (days)', format: v => v + ' days', current: () => _docCurrentInput('#f-debit-within'), apply: v => _docSetInput('#f-debit-within', v) },
  { key: 'monthly_fee', label: 'Monthly fee', format: v => formatDollarInput(v), current: () => _docCurrentInput('#f-monthly-fee', 'money'), apply: v => _docSetInput('#f-monthly-fee', v, 'money') },
  { key: 'fee_waiver_condition', label: 'Fee waiver condition', format: v => v, current: () => _docCurrentInput('#f-fee-waiver'), apply: v => _docSetInput('#f-fee-waiver', v) },
  { key: 'early_termination_fee', label: 'Early termination fee', format: v => formatDollarInput(v), current: () => _docCurrentInput('#f-etf', 'money'), apply: v => _docSetInput('#f-etf', v, 'money') },
  { key: 'etf_window_days', label: 'ETF window (days)', format: v => v + ' days', current: () => _docCurrentInput('#f-etf-window'), apply: v => _docSetInput('#f-etf-window', v) },
  { key: 'promo_code', label: 'Promo code', format: v => v, current: () => _docCurrentInput('#f-promo-code'), apply: v => _docSetInput('#f-promo-code', v) },
  { key: 'bonus_post_min_days', label: 'Bonus posting min (days)', format: v => v + ' days', current: () => _docCurrentInput('#f-bonus-post-min'), apply: v => _docSetInput('#f-bonus-post-min', v) },
  { key: 'bonus_post_max_days', label: 'Bonus posting max (days)', format: v => v + ' days', current: () => _docCurrentInput('#f-bonus-post-max'), apply: v => _docSetInput('#f-bonus-post-max', v) },
  { key: 'churnable', label: 'Can be churned', format: v => v ? 'Yes' : 'No',
    current: () => { const el = _docEl('#f-churnable'); return (el && el.value) ? ({ 'true': 'Yes', 'false': 'No' }[el.value] || '') : ''; },
    apply: v => _docSetInput('#f-churnable', v ? 'true' : 'false') },
  { key: 'churn_wait_months', label: 'Churn wait (months)', format: v => v + ' months', current: () => _docCurrentInput('#f-churn-wait'), apply: v => _docSetInput('#f-churn-wait', v) },
  { key: 'churn_anchor', label: 'Churn counted from', format: v => ({ bonus_received: 'Bonus received', account_closed: 'Account closed', account_opened: 'Account opened' }[v] || v),
    current: () => { const el = _docEl('#f-churn-anchor'); return (el && el.value) ? ({ bonus_received: 'Bonus received', account_closed: 'Account closed', account_opened: 'Account opened' }[el.value] || '') : ''; },
    apply: v => _docSetInput('#f-churn-anchor', v) },
  { key: 'churn_notes', label: 'Churn notes', format: v => v, current: () => _docCurrentInput('#f-churn-notes'), apply: v => _docSetInput('#f-churn-notes', v) },
  // LLM-only prose fields (Phase 7 v2) with no dedicated schema slot — they
  // append to the Notes textarea (same idiom as bonusPointsNote). Only ever
  // present when the Worker's grounded LLM tier returns them, always marked AI
  // + low-confidence + default-unchecked in the preview.
  { key: 'eligibility_notes', label: 'Eligibility notes (→ notes)', format: v => v, current: () => '',
    apply: v => _docAppendNote('Eligibility: ' + v) },
  { key: 'early_close_notes', label: 'Early-close notes (→ notes)', format: v => v, current: () => '',
    apply: v => _docAppendNote('Early close: ' + v) },
  { key: 'bonus_posting_notes', label: 'Bonus posting (→ notes)', format: v => v, current: () => '',
    apply: v => _docAppendNote('Bonus posting: ' + v) },
  // Row-only requirement types (no legacy field): land in #f-user-reqs.
  { key: 'spendAmount', label: 'Spend requirement', format: v => formatDollarInput(v), current: () => '', apply: v => _docAddUserReq('spend', { amount: v, label: 'Spend' }) },
  { key: 'transactionsCount', label: 'Transactions requirement', format: v => v + '×', current: () => '', apply: v => _docAddUserReq('transactions', { count: v, label: 'Transactions' }) },
  // EITHER/OR (2026-07-11, generalized 2026-07-14): the bonus is met by ONE of
  // several alternative paths — DD-vs-spend OR (for a held offer with no DD
  // requirement parsed) hold-vs-spend. Applying flips the form to "Either
  // way", ensures the alternative requirement blocks exist, and reveals the
  // path selector — which the user picks at review time (left at "Decide
  // later" = null; never auto-picked).
  { key: 'requirementLogic', label: 'Qualify either way (multiple paths)',
    format: v => v === 'any' ? 'Yes — choose a qualifying path at review' : 'No',
    current: () => { const r = _docEl('[name="requirementLogic"]:checked'); return r ? (r.value === 'any' ? 'Either way' : 'All required') : ''; },
    apply: v => {
      if (v !== 'any') return;
      // Order matters with the DYNAMIC chooser (2026-07-13): the "Either way"
      // radio only EXISTS once both paths are present, so establish the
      // required families FIRST (their change events rebuild the section),
      // THEN flip the revealed radio.
      const cur = (_docEl('[name="offerType"]:checked') || {}).value;
      // A genuine DD-vs-spend disjunction needs a DD-family offer type; a
      // hold-vs-spend disjunction (held offer, no DD requirement parsed) must
      // NOT be forced to DD-family — see _docEitherOrForceDdFamily above.
      // Leave an explicit Held+DD offer type alone either way.
      // ddParsed signal (2026-07-14 fix-up, Step 2d POST-REVIEW M1): preview
      // checkboxes are authoritative in this UI (docImportApply below only
      // applies CHECKED rows) — reading the raw parse (fields.ddRequired.value)
      // regardless of checked state let a user UNCHECK the "Direct deposit
      // required" row while keeping requirementLogic checked, and still get
      // forced to DD-family. Require the ddRequired preview row to exist AND
      // be checked, on top of its parsed value, so an unchecked/absent DD row
      // means ddParsed=false.
      const ddRow = document.querySelector('#doc-import-preview .doc-field[data-doc-key="ddRequired"] .doc-check');
      const ddField = _docLastParse && _docLastParse.fields && _docLastParse.fields.ddRequired;
      const ddParsed = !!(ddRow && ddRow.checked && ddField && ddField.value);
      if (_docEitherOrForceDdFamily(cur, ddParsed)) {
        const r = _docEl('#ot-dd'); if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      // The card-spend path needs the debit block present either way.
      const dy = _docEl('#debit-yes'); if (dy && !dy.checked) { dy.checked = true; dy.dispatchEvent(new Event('change', { bubbles: true })); }
      const any = _docEl('#reqlogic-any'); if (any) { any.checked = true; any.dispatchEvent(new Event('change', { bubbles: true })); }
      // plannedPath deliberately left at "Decide later" (null) — P2-3 no auto-pick.
    } },
  // Notes-only (points bonus, quirk 1): appended to the Notes textarea.
  { key: 'bonusPointsNote', label: 'Points bonus (→ notes)', format: v => v, current: () => '',
    apply: v => _docAppendNote('Bonus: ' + v) },
  // P0: the "Credit card funding" glance row is its OWN concept (how you may fund
  // with a card + any cap), never the deposit requirement. Surface it as a
  // notes-only row so the user sees it captured — it is NEVER requiredFundingAmount.
  { key: 'cc_funding_note', label: 'Card funding (→ notes)', format: v => v, current: () => '',
    apply: v => _docAppendNote('Card funding: ' + v) },
];
const DOC_FIELD_BY_KEY = DOC_FIELD_MAP.reduce((m, e) => { m[e.key] = e; return m; }, {});

// Confidence → dot color class + label.
function _docConfDot(conf) {
  const c = conf === 'high' ? 'high' : conf === 'medium' ? 'medium' : 'low';
  return `<span class="doc-conf doc-conf-${c}" title="${c} confidence"></span>`;
}

/* ---- Tier picker (step 4b) -------------------------------------------------
   A parse result may carry a top-level `tiers` array (>=2 rows) from the 4a
   scanner. When it does, the preview shows a "Select your tier" group ABOVE the
   ordinary field rows: a radio per tier + a "No tier" radio. Nothing is
   auto-selected (the owner's motivating case is a LOWER tier than the headline,
   so we never guess). Choosing a tier feeds tier.bonus / threshold into the
   field rows (or a maintain_balance / spend / DD user-req on Apply), all through
   the SAME apply paths as any other row. Selection state lives in _docTierSel. */

// True when this result should render the tier picker: a real >=2 ladder.
function _docHasTiers(result) {
  return !!(result && Array.isArray(result.tiers) && result.tiers.length >= 2);
}

// The human label for a tier's threshold, e.g. "Deposit $15,000+" or a range
// "Balance $5,000–$9,999". Kind drives the noun; min/max drive the figure. Money
// is formatted via formatMoneyInput (comma groups, no cents unless present).
function _docTierKindNoun(kind) {
  return kind === 'balance' ? 'Balance'
    : kind === 'dd_total' ? 'Direct deposit'
    : kind === 'spend' ? 'Spend'
    : 'Deposit';
}
function _docTierThresholdLabel(t) {
  if (!t) return '';
  const noun = _docTierKindNoun(t.threshold_kind);
  const lo = formatDollarInput(t.threshold_min);
  if (t.threshold_max != null && Number.isFinite(t.threshold_max)) {
    return `${noun} ${lo}–${formatDollarInput(t.threshold_max)}`;
  }
  return `${noun} ${lo}+`;
}

// A compact one-line description of what a tier maps a threshold INTO, used both
// in the picker row and in the provenance note. Deposit → funding amount; the
// row-only kinds name the requirement they create.
function _docTierThresholdTargetDesc(t) {
  if (!t) return '';
  switch (t.threshold_kind) {
    case 'balance':  return 'Funding + maintain-balance';
    case 'dd_total': return 'Direct-deposit total';
    case 'spend':    return 'Spend requirement';
    default:         return 'Funding amount';
  }
}

// Describe the user-requirement row a tier threshold should ALSO create on Apply
// to carry the requirement SEMANTICS (its type + deadline/hold), on top of the
// legacy field wiring in _docEffectiveFields. deposit/spend/dd_total live purely
// in the legacy model (funding field / DD rows) so they return null here; only
// 'balance' adds a row (maintain_balance carries the "keep $X on deposit"
// meaning the funding lump can't express). deadline_days / hold_days come from
// the OFFER-LEVEL parsed fields when present (the 4a scanner emits per-tier holds
// as null — stated once for the whole offer). Returns { type, over } or null.
function _docTierReqDescriptor(result, t) {
  if (!t || t.threshold_kind !== 'balance') return null;
  const fields = (result && result.fields) || {};
  const numField = (k) => {
    const f = fields[k];
    if (!f || f.value == null || f.value === '') return null;
    const n = Number(f.value);
    return Number.isFinite(n) ? n : null;
  };
  const deadline = numField('daysAfterSignupAllowedBeforeDeposit');
  const hold = numField('daysFundsMustRemain');
  const over = { amount: t.threshold_min, label: 'Maintain balance' };
  if (deadline != null) over.deadline_days = deadline;
  if (hold != null) over.hold_days = hold;
  return { type: 'maintain_balance', over };
}

// Compute the EFFECTIVE fields map to render/apply given the current tier
// selection. Pure: returns a shallow clone of result.fields with tier overrides
// layered on, plus Sets of field keys the selection force-CHECKS or force-
// UNCHECKS, plus a ddWire flag (dd_total needs the legacy DD model wired at
// Apply). Nothing is mutated on the cached parse result.
//   • no selection (null) or "No tier" (-1): parser's original fields, nothing
//     forced (headline bonus stays low/unchecked).
//   • a tier index: signupBonusAmount := tier.bonus HIGH + force-checked. Then
//     per threshold_kind, funding-row disposition (the capital model keys off
//     #f-funding for cash-flow/ROI/withdrawal + requires requiredFundingAmount>0
//     for completeness):
//       deposit → funding := threshold_min, force-checked (existing behavior).
//       balance → funding := threshold_min, force-checked (capital IS locked at
//                 that balance); a maintain_balance user row is ALSO added at
//                 Apply for the requirement semantics.
//       dd_total→ funding := threshold_min, force-checked (the DD TOTAL; the DD
//                 rows divide it into per-DD amounts that project as capital) and
//                 ddWire=true so Apply flips offerType→direct-deposit + generates
//                 dated DD rows. Completeness needs requiredFundingAmount>0, so
//                 the funding row can't be dropped here.
//       spend  → the parser's funding row is a misread lowest rung for a spend
//                ladder, so FORCE-UNCHECK it (user may re-check); a spend user
//                row carries the real obligation. Bonus still applies.
// Returns { fields, forced:Set, unchecked:Set, ddWire:boolean, tier|null }.
function _docEffectiveFields(result, tierSel) {
  const base = (result && result.fields) || {};
  const out = {};
  for (const k in base) out[k] = base[k];
  const forced = new Set();
  const unchecked = new Set();
  let ddWire = false;
  const tiers = (result && result.tiers) || [];
  const idx = (typeof tierSel === 'number') ? tierSel : null;
  if (idx == null || idx < 0 || idx >= tiers.length) return { fields: out, forced, unchecked, ddWire, tier: null };
  const t = tiers[idx];
  // Headline bonus becomes the chosen tier's bonus at HIGH confidence (explicit
  // user pick) — clone the entry so we never mutate the cached parse result.
  const prevBonus = out.signupBonusAmount || {};
  out.signupBonusAmount = {
    value: t.bonus, confidence: 'high',
    snippet: t.snippet || prevBonus.snippet || '',
    note: 'From selected tier'
  };
  forced.add('signupBonusAmount');
  const kind = t.threshold_kind;
  const setFunding = () => {
    const prevFund = out.requiredFundingAmount || {};
    out.requiredFundingAmount = {
      value: t.threshold_min, confidence: 'medium',
      snippet: t.snippet || prevFund.snippet || '',
      note: kind === 'dd_total' ? 'From selected tier (DD total)' : 'From selected tier'
    };
    forced.add('requiredFundingAmount');
  };
  if (kind === 'deposit' || kind === 'balance') {
    setFunding();
  } else if (kind === 'dd_total') {
    setFunding();
    ddWire = true;
  } else if (kind === 'spend') {
    // Leave the parser's funding value as-is but force its row UNCHECKED so the
    // misread lowest rung doesn't get applied (user can opt back in).
    if (out.requiredFundingAmount && out.requiredFundingAmount.value != null && out.requiredFundingAmount.value !== '') {
      unchecked.add('requiredFundingAmount');
    }
  }
  return { fields: out, forced, unchecked, ddWire, tier: t };
}

// Render the "Select your tier" radio group. NONE pre-selected (never auto).
// Each row: formatted threshold → bonus, plus the muted verbatim snippet (<=120c,
// escaped) and a tiny "→ funding amount / maintain-balance requirement" target
// hint. A trailing "No tier" radio keeps the manual/headline values. `sel` is
// _docTierSel (null / -1 / index).
// Compact percent for the tier ROI chip: whole number at ≥10, one decimal below
// (keeps "≈30%/yr" tight while "≈6.2%/yr" stays informative). Numeric-only.
function _docFmtPct(v) {
  if (!Number.isFinite(v)) return '0';
  return v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
}

function _docRenderTierGroup(result, sel) {
  const tiers = (result && result.tiers) || [];
  if (tiers.length < 2) return '';
  // Offer-level hold (daysFundsMustRemain) from the parsed fields, used as the
  // lock-days fallback when a tier carries no per-tier hold (the 4a scanner emits
  // per-tier holds as null — the hold is stated once for the whole offer).
  const _f = (result && result.fields) || {};
  const offerHoldRaw = _f.daysFundsMustRemain ? Number(_f.daysFundsMustRemain.value) : NaN;
  let offerHoldDays = (Number.isFinite(offerHoldRaw) && offerHoldRaw > 0) ? offerHoldRaw : 0;
  // The chip annualizes over the ACTUAL capital lock (funded → withdrawal). When
  // the hold is anchored to ACCOUNT OPENING, daysFundsMustRemain is a through-day
  // measured from opening, but the money isn't tied up until it's DEPOSITED — so
  // subtract the deposit window to get the real lock (BofA: through-day 90 from
  // opening − 30-day deposit window = 60 days actually locked → ≈30%/yr, not the
  // ≈20%/yr a naive 90-day basis would show). A funded-date hold is already the
  // real lock and is used as-is.
  const anchor = (_f.lockStartsFrom && _f.lockStartsFrom.value) || 'funded date';
  const depWinRaw = _f.daysAfterSignupAllowedBeforeDeposit ? Number(_f.daysAfterSignupAllowedBeforeDeposit.value) : NaN;
  const depWin = (Number.isFinite(depWinRaw) && depWinRaw > 0) ? depWinRaw : 0;
  if (anchor === 'open date' && depWin > 0 && offerHoldDays > depWin) offerHoldDays = offerHoldDays - depWin;
  const rows = tiers.map((t, i) => {
    const checked = (sel === i) ? 'checked' : '';
    const threshold = escapeHtml(_docTierThresholdLabel(t));
    const bonus = escapeHtml(formatDollarInput(t.bonus));
    const target = escapeHtml(_docTierThresholdTargetDesc(t));
    const snip = String(t.snippet || '').slice(0, 120);
    const snipLine = snip ? `<span class="doc-tier-snippet">"${escapeHtml(snip)}"</span>` : '';
    // Annualized-return chip. rate = bonus / threshold_min; annualize by
    // 365/lockDays, lockDays = per-tier hold ?? offer-level hold. With NO hold
    // data anywhere, fall back to plain ROI. Division guarded on both operands;
    // all numeric so nothing new to escape.
    const tmin = Number(t.threshold_min);
    const lockDays = (t.hold_days != null && Number(t.hold_days) > 0) ? Number(t.hold_days) : offerHoldDays;
    let roiChip = '';
    if (Number.isFinite(tmin) && tmin > 0 && Number.isFinite(Number(t.bonus))) {
      const roiPct = (Number(t.bonus) / tmin) * 100;
      roiChip = (lockDays > 0)
        ? `<span class="doc-tier-roi" title="Annualized: ${_docFmtPct(roiPct)}% return over a ${lockDays}-day hold, ×365/${lockDays}">≈${_docFmtPct(roiPct * (365 / lockDays))}%/yr</span>`
        : `<span class="doc-tier-roi" title="No hold period parsed — showing simple return, not annualized">${_docFmtPct(roiPct)}% ROI (no hold data)</span>`;
    }
    return `
      <label class="doc-tier-opt">
        <input type="radio" name="doc-tier-pick" class="doc-tier-radio" value="${i}" ${checked} />
        <span class="doc-tier-body">
          <span class="doc-tier-line">
            <span class="doc-tier-thresh">${threshold}</span>
            <svg class="doc-tier-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            <span class="doc-tier-bonus">${bonus}</span>
            ${roiChip}
            <span class="doc-tier-target">→ ${target}</span>
          </span>
          ${snipLine}
        </span>
      </label>`;
  }).join('');
  const noneChecked = (sel === -1) ? 'checked' : '';
  const noneRow = `
    <label class="doc-tier-opt doc-tier-none">
      <input type="radio" name="doc-tier-pick" class="doc-tier-radio" value="-1" ${noneChecked} />
      <span class="doc-tier-body">
        <span class="doc-tier-line"><span class="doc-tier-thresh">No tier — keep manual/headline values</span></span>
      </span>
    </label>`;
  return `
    <div class="doc-tier-group" data-doc-tier-group>
      <div class="doc-tier-head">Select your tier</div>
      <div class="doc-tier-sub">This offer has ${tiers.length} bonus tiers. Pick the one you'll pursue — it fills the bonus and its deposit/requirement below. None is selected by default.</div>
      <div class="doc-tier-opts">${rows}${noneRow}</div>
    </div>`;
}

// Render the preview list from a parse result into #doc-import-preview. Every
// parsed value + snippet is escaped. Checkbox defaults: checked for high/medium,
// unchecked for low. Overwrite visibility: if the target form field already has
// a non-empty value that differs, show it struck-through beside the new value.
function renderDocPreview(result) {
  const host = document.getElementById('doc-import-preview');
  if (!host) return;
  // Layer the current tier selection over the raw parser fields: a chosen tier
  // overrides signupBonusAmount (+ requiredFundingAmount for a deposit tier) and
  // force-checks those rows; no selection / "No tier" leaves the parser values
  // untouched (headline bonus stays low/unchecked). `fields` below is always the
  // EFFECTIVE map so the rows re-render straight from _docTierSel.
  const eff = _docEffectiveFields(result, _docTierSel);
  const fields = eff.fields;
  const forced = eff.forced;
  const unchecked = eff.unchecked || new Set();
  const keys = DOC_FIELD_MAP.map(e => e.key).filter(k => fields[k] && fields[k].value != null && fields[k].value !== '');
  // Resolve a row's checked state with precedence (P2b — preserve user choices
  // across tier switches): a tier-FORCED row is always checked (tier wins); a
  // tier-force-UNCHECKED row (e.g. the misread funding row on a spend tier) is
  // unchecked; otherwise a remembered explicit user choice (_docUserChecks) wins;
  // else the default rule (AI/low → unchecked, deterministic high/medium →
  // checked). Rows a PREVIOUS tier forced but the current one doesn't fall
  // through to the user's remembered pre-tier choice, or the default.
  const defaultChecked = (f) => !f._ai && ((f.confidence || 'low') === 'high' || (f.confidence || 'low') === 'medium');
  const resolveChecked = (key) => {
    if (forced.has(key)) return true;
    if (unchecked.has(key)) return false;
    if (Object.prototype.hasOwnProperty.call(_docUserChecks, key)) return !!_docUserChecks[key];
    return defaultChecked(fields[key]);
  };
  // The tier picker renders ABOVE the field rows whenever the parse carried a
  // >=2 ladder — even if (edge case) no ordinary field rows survived.
  const tierGroup = _docHasTiers(result) ? _docRenderTierGroup(result, _docTierSel) : '';
  if (!keys.length) {
    const nFailed = Number(result && result._aiFailed) || 0;
    const failLine = nFailed ? `<div class="doc-ai-note">${nFailed} AI suggestion${nFailed === 1 ? '' : 's'} failed verification and ${nFailed === 1 ? 'was' : 'were'} discarded.</div>` : '';
    host.innerHTML = `${tierGroup}<div class="doc-import-empty">No fields could be read. Fill the form manually.</div>${failLine}`;
    return;
  }
  const rows = keys.map(key => {
    const meta = DOC_FIELD_BY_KEY[key];
    const f = fields[key];
    let display = '';
    try { display = meta.format(f.value); } catch (e) { display = String(f.value); }
    const conf = f.confidence || 'low';
    // AI (LLM-sourced) fields always default UNCHECKED and low-confidence,
    // regardless of any confidence the model implied — the user opts in per
    // field after eyeballing the grounding quote. Deterministic fields keep the
    // existing high/medium = checked default. A tier-FORCED row (the user picked
    // a tier) is always checked and shows the tier's confidence.
    const isAi = !!f._ai;
    const checked = resolveChecked(key) ? 'checked' : '';
    let curr = '';
    try { curr = meta.current(); } catch (e) { curr = ''; }
    const overwrite = curr && curr !== display
      ? `<span class="doc-overwrite"><span class="doc-old">${escapeHtml(curr)}</span><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></span>`
      : '';
    const noteLine = f.note ? `<div class="doc-note">${escapeHtml(f.note)}</div>` : '';
    const aiBadge = isAi ? `<span class="doc-ai-badge" title="AI-extracted — verified against a quote from the post">AI</span>` : '';
    return `
      <label class="doc-field" data-doc-key="${escapeAttr(key)}">
        <input type="checkbox" class="doc-check" ${checked} />
        <span class="doc-field-main">
          <span class="doc-field-head">
            <span class="doc-field-label">${escapeHtml(meta.label)}</span>
            ${aiBadge}
            ${_docConfDot(isAi ? 'low' : conf)}
          </span>
          <span class="doc-field-val">${overwrite}<span class="doc-new">${escapeHtml(display)}</span></span>
          ${noteLine}
          <span class="doc-snippet">"${escapeHtml(f.snippet || '')}"</span>
        </span>
      </label>`;
  }).join('');
  const leftovers = Array.isArray(result.unparsed) && result.unparsed.length
    ? `<div class="doc-leftovers"><div class="doc-leftovers-head">Not auto-filled (manual reference)</div>${result.unparsed.map(s => `<div class="doc-leftover">${escapeHtml(s)}</div>`).join('')}</div>`
    : '';
  // Muted note when the Worker's LLM tier returned fields that failed the
  // verbatim-quote tripwire (client-side) and were discarded before display.
  const aiFailed = Number(result._aiFailed) || 0;
  const aiFailNote = aiFailed
    ? `<div class="doc-ai-note">${aiFailed} AI suggestion${aiFailed === 1 ? '' : 's'} failed verification and ${aiFailed === 1 ? 'was' : 'were'} discarded.</div>`
    : '';
  // Count exactly the rows that render checked (same precedence as the rows),
  // so the "Apply N" number matches the boxes on screen.
  const applyCount = keys.filter(k => resolveChecked(k)).length;
  host.innerHTML = `
    ${tierGroup}
    <div class="doc-preview-head">Review ${keys.length} field${keys.length === 1 ? '' : 's'} — uncheck anything you don't want. Values only fill the form; nothing saves until you press Save.</div>
    <div class="doc-fields">${rows}</div>
    ${aiFailNote}
    ${leftovers}
    <div class="doc-apply-row">
      <button type="button" class="btn btn-primary btn-sm" data-action="doc-import-apply">Apply <span id="doc-apply-count">${applyCount}</span> selected</button>
      <span class="doc-apply-hint">Fills the form for your review — then Save as usual.</span>
    </div>
    <label class="doc-tpl-save"><input type="checkbox" id="doc-save-template" /> <span>Also save these terms as a template</span></label>`;
}

// Re-render the preview after a tier radio changes. `sel` is the new selection
// (null / -1 / index). Cheapest correct mechanism: stash it and re-run
// renderDocPreview from the cached parse — the field rows recompute their values
// + checked state from _docEffectiveFields, so switching tiers, or picking "No
// tier", reverts/updates in one pass with no per-row DOM surgery.
function docTierSelect(sel) {
  if (!_docLastParse || !_docHasTiers(_docLastParse)) return;
  // Remember the user's current per-row checkbox choices BEFORE swapping the
  // selection, so unrelated toggles survive the re-render (P2b).
  _docCaptureUserChecks();
  _docTierSel = (typeof sel === 'number' && sel >= -1) ? sel : null;
  renderDocPreview(_docLastParse);
  docImportUpdateApplyCount();
}

// Live-update the "Apply N selected" count as checkboxes toggle.
function docImportUpdateApplyCount() {
  const host = document.getElementById('doc-import-preview');
  const out = document.getElementById('doc-apply-count');
  if (!host || !out) return;
  out.textContent = String(host.querySelectorAll('.doc-check:checked').length);
}

// Cache of the last parse result for Apply (avoids re-parsing / re-escaping).
let _docLastParse = null;

// Tier-picker selection state (step 4b). `null` = no radio chosen yet (the
// initial, never-auto-selected state); an integer 0..n-1 = that tier index in
// _docLastParse.tiers; -1 = the explicit "No tier — keep manual/headline
// values" radio. Reset to null on every fresh parse and on Clear so a stale
// selection can never leak across parses.
let _docTierSel = null;

// Remembered EXPLICIT checkbox choices by data-doc-key (P2b). Keyed only when
// the user has toggled a row (or when captured pre-tier-switch); untracked keys
// fall through to the default-checked rule. Survives tier switches so unchecking
// an unrelated row or opting into an AI/low row persists across selections, while
// tier-forced/unchecked rows still win. Reset on every fresh parse and on Clear.
let _docUserChecks = {};
// Snapshot the current DOM checkbox state into _docUserChecks (called before a
// tier-change re-render so manual toggles since the last render are remembered).
// Rows the CURRENT selection force-checks/unchecks are skipped — their box shows
// the tier's forced value, not a user choice, so capturing it would wrongly
// pin that value once a later tier stops forcing the row.
function _docCaptureUserChecks() {
  const host = document.getElementById('doc-import-preview');
  if (!host) return;
  const eff = _docEffectiveFields(_docLastParse, _docTierSel);
  const skip = (key) => eff.forced.has(key) || (eff.unchecked && eff.unchecked.has(key));
  host.querySelectorAll('.doc-field').forEach(row => {
    const key = row.getAttribute('data-doc-key');
    const cb = row.querySelector('.doc-check');
    if (key && cb && !skip(key)) _docUserChecks[key] = cb.checked;
  });
}

// Parse handler — reads the textarea, runs parseDocPost inside try/catch so a
// throw can never break the modal, and renders the preview (or a graceful
// error). Empty/garbage paste → inline muted message, form untouched.
function docImportParse() {
  const ta = document.getElementById('doc-import-paste');
  const status = document.getElementById('doc-import-status');
  const preview = document.getElementById('doc-import-preview');
  if (!ta) return;
  let raw = ta.value || '';
  // Every parse (success OR failure) starts from a clean tier selection AND a
  // clean remembered-checkbox map — no stale state may survive a re-parse.
  _docTierSel = null;
  _docUserChecks = {};
  if (!raw.trim()) {
    if (status) { status.textContent = 'Paste a post first.'; status.className = 'doc-import-status muted'; }
    if (preview) preview.innerHTML = '';
    _docLastParse = null;
    return;
  }
  // Hard cap the input before the synchronous parse. A real DoC post is a few
  // KB; anything past 200KB is either a mis-paste or a deliberate pathological
  // input. Capping keeps the parse bounded (defense-in-depth alongside the
  // bounded regexes) and never freezes the modal (P2-1). Truncation is surfaced.
  const DOC_MAX_CHARS = 200000;
  let truncated = false;
  if (raw.length > DOC_MAX_CHARS) { raw = raw.slice(0, DOC_MAX_CHARS); truncated = true; }
  const truncNote = truncated ? ' (large paste truncated to 200KB)' : '';
  let result;
  try {
    result = parseDocPost(raw);
  } catch (e) {
    if (typeof logError === 'function') logError(ErrCode.PARSE, e, 'docImportParse');
    if (status) { status.textContent = "Couldn't parse that paste — fill the form manually."; status.className = 'doc-import-status danger'; }
    if (preview) preview.innerHTML = '';
    _docLastParse = null;
    return;
  }
  _docLastParse = result;
  const nFields = Object.keys((result && result.fields) || {}).filter(k => result.fields[k] && result.fields[k].value != null && result.fields[k].value !== '' && DOC_FIELD_BY_KEY[k]).length;
  if (nFields === 0) {
    if (status) { status.textContent = "Couldn't find a glance list — fill manually." + truncNote; status.className = 'doc-import-status muted'; }
    if (typeof logError === 'function') logError(ErrCode.PARSE, new Error('no fields parsed from paste'), 'docImportParse: empty');
    if (preview) preview.innerHTML = '';
    return;
  }
  if (status) { status.textContent = `Found ${nFields} field${nFields === 1 ? '' : 's'} — review below.` + truncNote; status.className = 'doc-import-status success'; }
  renderDocPreview(result);
}

/* ---- Fetch-from-URL mode (Phase 7 v2, GATED) ------------------------------
   Only reachable when a Worker URL is configured (the button doesn't render
   otherwise). Calls the owner's Cloudflare Worker, which fetches the DoC page
   server-side (DoC has no CORS) and optionally runs an AI pass on the ~5 fuzzy
   prose fields. The returned article text flows through the SAME parseDocPost
   pipeline as a paste; AI fields are merged into the preview ONLY after each
   passes a client-side verbatim-quote tripwire against that same article text.
   Every failure path degrades to the paste flow — it can never block it. */

// Normalize text for the client-side tripwire — must mirror the Worker's
// normalizeForQuote (collapse whitespace, trim, lowercase) so a quote the
// Worker accepted is re-checkable here against the article we received.
function _docNormForQuote(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}
// Merge grounded LLM fields from the Worker into a parseDocPost result. Each
// candidate must (a) map to a known DOC field, (b) have a non-empty value +
// quote, and (c) have its quote appear verbatim (normalized) in `articleText`.
// Survivors are marked `_ai` + low-confidence (default-unchecked in preview);
// failures are counted into result._aiFailed. Never overwrites a field the
// deterministic parser already produced with higher confidence — AI only fills
// gaps (if the parser already has the key, the AI candidate is skipped).
function _docMergeLlmFields(result, llm, articleText) {
  result._aiFailed = 0;
  if (!llm || typeof llm !== 'object') return result;
  const article = _docNormForQuote(articleText);
  Object.keys(llm).forEach(key => {
    if (!DOC_FIELD_BY_KEY[key]) return;                 // not a mappable field
    const entry = llm[key];
    if (!entry || typeof entry !== 'object') return;
    const value = entry.value;
    const quote = entry.quote;
    if (value == null || String(value).trim() === '') return;
    if (typeof quote !== 'string' || !quote.trim()) { result._aiFailed++; return; }
    // Tripwire: the quote must be present verbatim in the fetched article.
    if (!article.includes(_docNormForQuote(quote))) { result._aiFailed++; return; }
    // Don't clobber a deterministic parse of the same field — prefer the parser.
    if (result.fields[key] && result.fields[key].value != null && result.fields[key].value !== '') return;
    result.fields[key] = { value: String(value), confidence: 'low', snippet: String(quote), _ai: true };
  });
  return result;
}

// Derive a pseudo-title from a DoC URL slug when the Worker returned no `title`
// (old deployment). "…/bank-of-america-business-500-3000-bonus/" → "Bank Of
// America Business 500 3000 Bonus". Hyphens → spaces, alpha words title-cased,
// numeric tokens (amounts) left as-is. Best-effort → '' on any parse failure.
function _docSlugTitle(url) {
  try {
    const u = new URL(url);
    let slug = (u.pathname.replace(/\/+$/, '').split('/').pop() || '').replace(/\.(html?|php|aspx?)$/i, '');
    if (!slug) return '';
    return slug.split('-').filter(Boolean)
      .map(w => /^[0-9]/.test(w) ? w : (w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ')
      .trim();
  } catch { return ''; }
}

// DOM-FREE Worker fetch + parse pipeline. Calls the configured Cloudflare
// Worker for `url`, runs the returned article through the SAME parseDocPost +
// name-recovery + grounded-LLM-merge path the modal fetch uses, and RETURNS the
// parse result (or throws with a user-facing message). Factored out of
// docImportFetch so the modal "Fetch & Parse" button AND the headless one-click
// churn verify (verifyChurnValue) share one proven pipeline — no re-parsing.
async function docWorkerFetchParse(url) {
  const workerUrl = Sync.getDocWorkerUrl();
  if (!workerUrl) throw new Error('no-worker');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000); // 15s client budget
  try {
    // Attach the optional shared secret as X-YV-Key when configured (matches
    // the Worker's WORKER_SECRET gate). Omitted entirely when unset.
    const headers = { 'Content-Type': 'application/json' };
    const secret = Sync.getDocWorkerSecret();
    if (secret) headers['X-YV-Key'] = secret;
    const resp = await fetch(workerUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: controller.signal
    });
    if (!resp.ok) {
      let detail = '';
      try { const j = await resp.json(); detail = j && j.error ? ' (' + j.error + ')' : ''; } catch {}
      throw new Error('worker responded ' + resp.status + detail);
    }
    const data = await resp.json();
    if (!data || data.ok !== true || typeof data.html !== 'string' || !data.html.trim()) {
      throw new Error((data && data.error) ? data.error : 'empty response');
    }
    // Feed the fetched article through the EXACT same parser as a paste. All
    // returned strings are untrusted → parseDocPost + the preview escape them
    // identically to pasted text.
    let result;
    try { result = parseDocPost(data.html); }
    catch (e) {
      if (typeof logError === 'function') logError(ErrCode.PARSE, e, 'docWorkerFetchParse: parse');
      throw new Error('could not parse the fetched post');
    }
    // BANK / OFFER NAME (R70): the post TITLE lives OUTSIDE entry-content, so the
    // article body the Worker returns has no headline for the name heuristic to
    // read. If the body alone produced neither a bank nor an offer name, prepend
    // the Worker's returned `title` (or, for an OLD worker that predates the field,
    // a pseudo-title derived from the URL slug at LOW confidence) as a synthetic
    // first line and re-parse — then adopt ONLY the name fields it recovers.
    const _gotName = (f) => f && f.value != null && String(f.value).trim() !== '';
    if (!_gotName(result.fields.bankName) || !_gotName(result.fields.offerName)) {
      let titleLine = (typeof data.title === 'string' && data.title.trim()) ? data.title.trim() : '';
      let lowConf = false;
      if (!titleLine) { titleLine = _docSlugTitle(url); lowConf = true; }   // old worker fallback
      if (titleLine) {
        let reparsed = null;
        try { reparsed = parseDocPost(titleLine + '\n\n' + data.html); } catch (e) { reparsed = null; }
        if (reparsed) {
          for (const k of ['bankName', 'offerName']) {
            if (!_gotName(result.fields[k]) && _gotName(reparsed.fields[k])) {
              result.fields[k] = lowConf ? Object.assign({}, reparsed.fields[k], { confidence: 'low' }) : reparsed.fields[k];
            }
          }
        }
      }
    }
    _docMergeLlmFields(result, data.llm, data.html);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function docImportFetch() {
  const urlInput = document.getElementById('doc-fetch-url');
  const btn = document.getElementById('doc-fetch-btn');
  const errBox = document.getElementById('doc-fetch-err');
  const status = document.getElementById('doc-import-status');
  const preview = document.getElementById('doc-import-preview');
  const setErr = (msg) => { if (errBox) errBox.textContent = msg || ''; };
  setErr('');
  if (!Sync.getDocWorkerUrl()) { setErr('No Worker URL configured — paste the post text instead.'); return; }
  const url = urlInput ? urlInput.value.trim() : '';
  if (!url) { setErr('Enter a Doctor of Credit post URL first.'); return; }

  // Loading state on the button (label swap + busy flag). Restored in finally.
  const origLabel = btn ? btn.textContent : '';
  if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; btn.textContent = 'Fetching…'; }
  if (status) { status.textContent = 'Fetching from Worker…'; status.className = 'doc-import-status muted'; }

  try {
    const result = await docWorkerFetchParse(url);
    _docLastParse = result;
    _docTierSel = null;   // fresh fetch → no tier selection carried over
    _docUserChecks = {};
    const nFields = Object.keys(result.fields || {}).filter(k => result.fields[k] && result.fields[k].value != null && result.fields[k].value !== '' && DOC_FIELD_BY_KEY[k]).length;
    const nAi = Object.keys(result.fields || {}).filter(k => result.fields[k] && result.fields[k]._ai).length;
    renderDocPreview(result);
    if (status) {
      const aiBit = nAi ? ` · ${nAi} AI` : '';
      status.textContent = nFields ? `Fetched — found ${nFields} field${nFields === 1 ? '' : 's'}${aiBit}. Review below.` : 'Fetched, but no fields were readable — paste the text instead.';
      status.className = nFields ? 'doc-import-status success' : 'doc-import-status muted';
    }
    // Keep the paste box + the docUrl field in sync with what was fetched.
    if (urlInput) { const df = document.getElementById('f-doc'); if (df && !df.value.trim()) { df.value = url; df.dispatchEvent(new Event('input', { bubbles: true })); } }
  } catch (e) {
    if (typeof logError === 'function') logError(ErrCode.SYNC_PULL, e, 'docImportFetch');
    setErr('Fetch failed — paste the post text instead.');
    if (status) { status.textContent = ''; status.className = 'doc-import-status'; }
    if (preview) preview.innerHTML = '';
  } finally {
    if (btn) { btn.removeAttribute('aria-busy'); btn.disabled = false; btn.textContent = origLabel || 'Fetch & Parse'; }
  }
}

// Apply handler — writes every CHECKED field into the form via its map entry.
// Wrapped per-field so one bad apply can't abort the rest. Reports a toast.
function docImportApply() {
  const host = document.getElementById('doc-import-preview');
  if (!host || !_docLastParse) return;
  // Apply the SAME effective field map the preview rendered from, so a chosen
  // tier's bonus / funding values (not the raw parser headline) flow into the
  // form. Field rows write through the ordinary DOC_FIELD_MAP.apply() paths.
  const eff = _docEffectiveFields(_docLastParse, _docTierSel);
  let applied = 0;
  host.querySelectorAll('.doc-field').forEach(row => {
    const cb = row.querySelector('.doc-check');
    if (!cb || !cb.checked) return;
    const key = row.getAttribute('data-doc-key');
    const meta = DOC_FIELD_BY_KEY[key];
    const f = eff.fields[key];
    if (!meta || !f) return;
    try { meta.apply(f.value); applied++; }
    catch (e) { if (typeof logError === 'function') logError(ErrCode.RENDER, e, 'docImportApply: ' + key); }
  });
  // Tier-specific extras beyond the field rows applied above:
  //   • balance → ALSO add a maintain_balance user row (requirement semantics +
  //     deadline/hold); the funding field already carried the locked capital.
  //   • dd_total → wire the legacy DD model (a user req row alone is invisible to
  //     completeness/cash-flow): flip offerType→direct-deposit and generate dated
  //     DD rows whose amounts come from the just-applied funding = the DD total,
  //     so the offer is NOT a draft and projects DD capital.
  //   • Always → drop a provenance line into Notes so the chosen tier is auditable.
  if (eff.tier) {
    const t = eff.tier;
    try {
      const req = _docTierReqDescriptor(_docLastParse, t);
      if (req) { _docAddUserReq(req.type, req.over); applied++; }
    } catch (e) { if (typeof logError === 'function') logError(ErrCode.RENDER, e, 'docImportApply: tier req'); }
    if (eff.ddWire) {
      try { _docWireDdModel(); applied++; }
      catch (e) { if (typeof logError === 'function') logError(ErrCode.RENDER, e, 'docImportApply: dd wire'); }
    }
    try {
      const prov = `Tier selected: ${_docTierThresholdLabel(t)} → ${formatDollarInput(t.bonus)}` + (t.snippet ? ` — ${String(t.snippet).slice(0, 120)}` : '');
      _docAppendNote(prov);
    } catch (e) { if (typeof logError === 'function') logError(ErrCode.RENDER, e, 'docImportApply: tier note'); }
  }
  // Refresh the requirements section once more so any user rows + derived rows
  // reflect the freshly-applied legacy values (funding/debit → derived rows).
  if (typeof refreshRequirementsSection === 'function') refreshRequirementsSection();
  if (typeof refreshLifecycleStrip === 'function') refreshLifecycleStrip();
  const status = document.getElementById('doc-import-status');
  if (status) { status.textContent = `Applied ${applied} field${applied === 1 ? '' : 's'} to the form — review, then Save.`; status.className = 'doc-import-status success'; }
  if (typeof toast === 'function') toast(`Applied ${applied} field${applied === 1 ? '' : 's'} — review and Save`);
}

// Clear handler — collapses the preview + empties the paste area. Form untouched.
function docImportClear() {
  const ta = document.getElementById('doc-import-paste');
  const preview = document.getElementById('doc-import-preview');
  const status = document.getElementById('doc-import-status');
  if (ta) ta.value = '';
  if (preview) preview.innerHTML = '';
  if (status) { status.textContent = ''; status.className = 'doc-import-status'; }
  _docLastParse = null;
  _docTierSel = null;
  _docUserChecks = {};
}

// Toggle the import body open/closed.
function docImportToggle(btn) {
  const body = document.getElementById('doc-import-body');
  if (!btn || !body) return;
  const open = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!open));
  body.hidden = open;
  if (!open) { const ta = document.getElementById('doc-import-paste'); if (ta) setTimeout(() => ta.focus(), 30); }
}

// ---- Dev-only self-test hook (step-11 regression; NOT auto-run) -------------
// testDocParser(rawText, fixtureKey) parses `rawText` and asserts it against a
// compact embedded expected-value map for the given fixture. No network/file IO
// — paste the fixture text in the console. Returns {pass,fail,failures}. Call
// with no args to see the available fixture keys + usage.
const DOC_TEST_EXPECT = {
  '01': { bankName: 'Meridian Trust Bank', signupBonusAmount: 300, offerExpirationDate: '2026-09-30', ddRequired: true, monthly_fee: 0, early_termination_fee: 25, etf_window_days: 90, promo_code: 'PREMIER300', daysAfterSignupAllowedBeforeDeposit: 60, bonus_post_max_days: 30 },
  '02': { bonusPointsNote: '@present', signupBonusAmount: '@absent', offerExpirationDate: '2026-12-31', ddRequired: false, monthly_fee: 95, early_termination_fee: 0, churn_wait_months: 12 },
  '03': { signupBonusAmount: 560, offerExpirationDate: '2026-08-31', ddRequired: true, churn_wait_months: 24, bonus_post_min_days: 45, bonus_post_max_days: 60 },
  '04': { signupBonusAmount: 400, ddRequired: true, monthly_fee: 10, early_termination_fee: 50, etf_window_days: 120, promo_code: 'RELAY400', debitCount: 5, debitWithinDays: 60, bonus_post_max_days: 20, offerExpirationDate: '2026-10-15' },
  // 05 also covers "$50k" shorthand → 50000 (P2-2) and "6 to 8 weeks" → 42/56 (P3).
  '05': { bankName: 'Summit Brokerage', signupBonusAmount: 1000, requiredFundingAmount: 50000, ddRequired: false, offerExpirationDate: '2026-11-30', daysFundsMustRemain: 90, churnable: true, churn_wait_months: 24, churn_anchor: 'account_closed', bonus_post_min_days: 42, bonus_post_max_days: 56 },
  // 06 — TIERED deposit ladder (step-4a P1). ≥2 tiers ⇒ signupBonusAmount forced
  // LOW-confidence (default-unchecked) + a top-level tiers[] (checked via _tiers).
  // The "Credit card funding: … up to $500" row is a cc_funding_note, NOT the
  // funding requirement (P0); requiredFundingAmount = the lowest deposit tier.
  '06': { signupBonusAmount: 3000, ddRequired: false, requiredFundingAmount: 10000, offerExpirationDate: '2026-12-31', early_termination_fee: 0, cc_funding_note: '@present', _tiers: 4, _signupBonusConfidence: 'low', daysFundsMustRemain: 90, lockStartsFrom: 'open date', daysAfterSignupAllowedBeforeDeposit: 30, fee_waiver_condition: '@present' },
  // 07 — DELTA updates (step-4a P2). The newest "Update 5/20/2026" LOWERS the
  // bonus to $250, EXTENDS expiration to 9/30/2026, and changes the promo code to
  // SUMMER250 — each supersedes the stale glance box + the older 2/2/2026 update.
  // Also: "Yes, no minimum mentioned" ⇒ ddRequired true (P4 negation guard);
  // "through July 7, 2026" is NOT read as a $2026 bonus (P4 year-as-money guard).
  '07': { signupBonusAmount: 250, offerExpirationDate: '2026-09-30', promo_code: 'SUMMER250', ddRequired: true, monthly_fee: 12, early_termination_fee: 30, etf_window_days: 180, daysAfterSignupAllowedBeforeDeposit: 90, cc_funding_note: '@present', churnable: true, churn_wait_months: 12 },
};
function testDocParser(rawText, fixtureKey) {
  const keys = Object.keys(DOC_TEST_EXPECT);
  if (rawText == null || fixtureKey == null) {
    console.log('Usage: testDocParser(rawText, fixtureKey) — fixtureKey ∈ ' + JSON.stringify(keys));
    console.log('Paste a fixture from docs/fixtures/doc-samples/ (key = leading number, e.g. "01").');
    return { pass: 0, fail: 0, failures: ['no args'] };
  }
  const exp = DOC_TEST_EXPECT[String(fixtureKey)];
  if (!exp) { console.warn('Unknown fixtureKey', fixtureKey, '— expected one of', keys); return { pass: 0, fail: 0, failures: ['unknown key'] }; }
  let res;
  try { res = parseDocPost(rawText); } catch (e) { console.error('parseDocPost threw', e); return { pass: 0, fail: 1, failures: ['threw: ' + e.message] }; }
  let pass = 0, fail = 0; const failures = [];
  Object.keys(exp).forEach(k => {
    const want = exp[k];
    // Meta-assertions (underscore-prefixed keys) check the RESULT SHAPE, not a
    // fields.<key> entry: `_tiers` asserts res.tiers.length (the top-level tier
    // ladder count — step-4a P1); `_signupBonusConfidence` asserts the forced
    // confidence on the headline bonus (LOW when a tier ladder is detected).
    if (k[0] === '_') {
      let actual;
      if (k === '_tiers') actual = Array.isArray(res.tiers) ? res.tiers.length : 0;
      else if (k === '_signupBonusConfidence') actual = res.fields.signupBonusAmount ? res.fields.signupBonusAmount.confidence : undefined;
      else { fail++; failures.push('unknown meta-assertion ' + k); return; }
      if (actual === want) pass++; else { fail++; failures.push(k + ' = ' + JSON.stringify(actual) + ' want ' + JSON.stringify(want)); }
      return;
    }
    const got = res.fields[k];
    if (want === '@present') { if (got && got.value != null && got.value !== '') pass++; else { fail++; failures.push(k + ' expected present'); } return; }
    if (want === '@absent') { if (!got) pass++; else { fail++; failures.push(k + ' expected absent, got ' + JSON.stringify(got.value)); } return; }
    if (!got) { fail++; failures.push(k + ' MISSING (want ' + JSON.stringify(want) + ')'); return; }
    if (got.value !== want) { fail++; failures.push(k + ' = ' + JSON.stringify(got.value) + ' want ' + JSON.stringify(want)); return; }
    pass++;
  });
  const line = `testDocParser[${fixtureKey}]: PASS ${pass}  FAIL ${fail}`;
  if (fail) { console.warn(line); failures.forEach(f => console.warn('  ✗ ' + f)); }
  else console.log('%c' + line, 'color:#10b981');
  return { pass, fail, failures };
}

// Pinned regressions for the Codex 4a adjudication (P1 reduction-bonus, P2a DD
// negation, P2b date-segment glance boundary). Self-contained literal inputs —
// no fixture files — so each adversarial phrasing that reproduced a bug stays
// asserted. Call testDocParserRegressions() in the console; returns {pass,fail}.
function testDocParserRegressions() {
  const cases = [
    // P1 — a REDUCTION in a SINGLE update paragraph (no cross-segment conflict for
    // reconcile to resolve): the target (new) value must win over the old max.
    { name: 'P1 single-seg "lowered to $250 (was $350)"',
      html: '<article><p><strong>Update 6/1/2026</strong>: Bonus lowered to $250 (was $350).</p><p>Open a Foo Checking account and receive your bonus.</p></article>',
      key: 'signupBonusAmount', want: 250 },
    { name: 'P1 "reduced to $200 (previously $500)" + glance $500',
      html: '<article><p><strong>Update 6/1/2026</strong>: The bonus has been reduced to $200 (previously $500).</p><p><strong>Offer at a glance</strong></p><ul><li>Maximum bonus amount: $500</li></ul></article>',
      key: 'signupBonusAmount', want: 200 },
    { name: 'P1 "is now $250 (previously $300)"',
      html: '<article><p><strong>Update 6/16/2026</strong>: Maximum bonus is now $250 (previously $300).</p><p>Open an account.</p></article>',
      key: 'signupBonusAmount', want: 250 },
    // P1 CONTROL — a genuine INCREASE to a RANGE keeps the HIGH end (must NOT be
    // hijacked by the reduction shortcut just because "from $Y" appears).
    { name: 'P1 CONTROL increase "increased to $300/$500 from $250/$350" → 500',
      html: '<article><p><strong>Update 1/4/2026</strong>: Bonus has now been increased to $300/$500 from $250/$350.</p><p>Open an account.</p></article>',
      key: 'signupBonusAmount', want: 500 },
    // P1 CONTROL — a plain range stays high-end.
    { name: 'P1 CONTROL range "$200 to $400" → 400',
      html: '<article><p><strong>Update 6/1/2026</strong>: Bonus is now $200 to $400 depending on tier.</p><p>Open an account.</p></article>',
      key: 'signupBonusAmount', want: 400 },
    // P2a — a "required"/"needed" token INSIDE a negation must not affirm.
    { name: 'P2a DD "Not required" → false',
      html: '<article><p><strong>Offer at a glance</strong></p><ul><li>Direct deposit required: Not required</li><li>Maximum bonus amount: $300</li></ul></article>',
      key: 'ddRequired', want: false },
    { name: 'P2a DD "None required" → false',
      html: '<article><p><strong>Offer at a glance</strong></p><ul><li>Direct deposit required: None required</li><li>Maximum bonus amount: $300</li></ul></article>',
      key: 'ddRequired', want: false },
    { name: 'P2a DD "No, not required" → false',
      html: '<article><p><strong>Offer at a glance</strong></p><ul><li>Direct deposit required: No, not required</li><li>Maximum bonus amount: $300</li></ul></article>',
      key: 'ddRequired', want: false },
    // P2a CONTROL — the P4 "no minimum" qualifier must still read affirmative.
    { name: 'P2a CONTROL DD "Yes, no minimum mentioned" → true',
      html: '<article><p><strong>Offer at a glance</strong></p><ul><li>Direct deposit required: Yes, no minimum mentioned</li><li>Maximum bonus amount: $300</li></ul></article>',
      key: 'ddRequired', want: true },
    // P2b — the "Offer at a glance" heading is a segment boundary: the glance box
    // + body must land in the UNDATED base segment, never be swallowed into the
    // preceding update's dated segment (which corrupted per-segment extraction).
    // Corpus-faithful direction (updates are FRESHER than the stale glance box):
    // a stale glance $350 with a NEWER update lowering it to $250 → 250, AND the
    // glance's OTHER rows (expiration, ETF) must still parse correctly — proof the
    // glance block was read as base, not lost inside the update segment.
    { name: 'P2b glance-in-base: stale $350 glance, newer update $250 → 250',
      html: '<article><p><strong>Update 5/20/2026</strong>: Bonus lowered to $250 (was $350).</p><p><strong>Offer at a glance</strong></p><ul><li>Maximum bonus amount: $350</li><li>Expiration date: 12/31/2026</li><li>Early account termination fee: $30 if closed within 180 days</li></ul></article>',
      key: 'signupBonusAmount', want: 250 },
    { name: 'P2b glance-in-base: glance expiration row still parsed → 2026-12-31',
      html: '<article><p><strong>Update 5/20/2026</strong>: Bonus lowered to $250 (was $350).</p><p><strong>Offer at a glance</strong></p><ul><li>Maximum bonus amount: $350</li><li>Expiration date: 12/31/2026</li><li>Early account termination fee: $30 if closed within 180 days</li></ul></article>',
      key: 'offerExpirationDate', want: '2026-12-31' },
    { name: 'P2b glance-in-base: glance ETF row still parsed → 30',
      html: '<article><p><strong>Update 5/20/2026</strong>: Bonus lowered to $250 (was $350).</p><p><strong>Offer at a glance</strong></p><ul><li>Maximum bonus amount: $350</li><li>Expiration date: 12/31/2026</li><li>Early account termination fee: $30 if closed within 180 days</li></ul></article>',
      key: 'early_termination_fee', want: 30 },
    // Item 5b — the proposed offerName must NOT carry a trailing bonus amount.
    // "Ridgeline $500 Premier Checking $600" → offerName "Premier Checking":
    // the "$600" tail is stripped at import so it never lands in stored data.
    { name: 'Item5b trailing $600 stripped from offerName',
      html: '<article><p>Ridgeline $500 Premier Checking $600</p><p>Open a Ridgeline account to earn your bonus.</p></article>',
      key: 'offerName', want: 'Premier Checking' },
    // R70 [5] + addendum — HOLD ANCHOR. "days 31 through day 90" is counted from
    // ACCOUNT OPENING, so the funds must remain THROUGH day 90 (not 60 = the
    // window duration) and the anchor is 'open date' (getting this wrong
    // under-holds → clawback). Both directions pinned.
    { name: 'R70 hold: "days 31 through day 90 of opening" → daysFundsMustRemain 90',
      html: '<article><p>You must deposit funds within 30 days of account opening and maintain the balance from days 31 through day 90.</p><p>Open a Foo Business account to earn your bonus.</p></article>',
      key: 'daysFundsMustRemain', want: 90 },
    { name: 'R70 hold: opening-context span → lockStartsFrom "open date" HIGH',
      html: '<article><p>You must deposit funds within 30 days of account opening and maintain the balance from days 31 through day 90.</p><p>Open a Foo Business account to earn your bonus.</p></article>',
      key: 'lockStartsFrom', want: 'open date', wantConf: 'high' },
    // P3-3 — a BARE span (no opening-context language) still counts the through-day
    // (high) but the ANCHOR is only a LOW-confidence suggestion (default-unchecked),
    // so the parser never asserts open-date at high confidence off a bare span.
    { name: 'R70 P3-3 bare span (no opening ctx) → daysFundsMustRemain 90',
      html: '<article><p>Maintain the balance from days 31 through day 90 to keep the bonus.</p><p>Open a Foo account.</p></article>',
      key: 'daysFundsMustRemain', want: 90 },
    { name: 'R70 P3-3 bare span → lockStartsFrom "open date" but LOW confidence',
      html: '<article><p>Maintain the balance from days 31 through day 90 to keep the bonus.</p><p>Open a Foo account.</p></article>',
      key: 'lockStartsFrom', want: 'open date', wantConf: 'low' },
    { name: 'R70 hold CONTROL: "maintain the balance for 60 days" → 60, funded',
      html: '<article><p>Keep the funds on deposit and maintain the balance for 60 days after funding to keep the bonus.</p><p>Open a Foo account to earn your bonus.</p></article>',
      key: 'daysFundsMustRemain', want: 60 },
    { name: 'R70 hold CONTROL: funded duration emits NO lockStartsFrom (form default)',
      html: '<article><p>Keep the funds on deposit and maintain the balance for 60 days after funding to keep the bonus.</p><p>Open a Foo account to earn your bonus.</p></article>',
      key: 'lockStartsFrom', want: undefined },
    // R70 [2] — WAIVER COLON + BULLETS. A condition clause ending at a colon whose
    // terms live in a following bullet list must APPEND those bullets (joined
    // "; or "), not drop them. Owner's exact BofA-import text.
    { name: 'R70 waiver: colon + bullet list appended',
      html: '<article><p>Fee is waived for smaller companies for the first 12 months, otherwise you must:</p><ul><li>Maintain a $5,000 combined average balance, or</li><li>Spend at least $500 in new net purchases on your business debit card, or</li><li>Become a member of Preferred Rewards for Business</li></ul></article>',
      key: 'fee_waiver_condition', want: 'Fee is waived for smaller companies for the first 12 months, otherwise you must: maintain a $5,000 combined average balance; or spend at least $500 in new net purchases on your business debit card; or become a member of Preferred Rewards for Business' },
    // HOLD-vs-SPEND either/or (2026-07-14, Step 2d) — a held-type disjunction
    // names no direct deposit at all (Brex: hold new funds OR meet card
    // spend), so it needs its own bridge in docDetectEitherOr — the pre-existing
    // DD-literal bridge can never fire for this shape.
    { name: 'HoldVsSpend either/or: "either hold new funds ... or ... spend" → requirementLogic any',
      html: '<article><p>To qualify for the bonus, either hold new funds in your account for 1 business day or meet a $2,000 card spend requirement.</p><p>Open a Foo Business account to earn your bonus.</p></article>',
      key: 'requirementLogic', want: 'any' },
    // CONTROL — the same terms stated CONJUNCTIVELY (no or/either connective)
    // must NOT fire; conservative-by-design like the DD bridge's own control.
    { name: 'HoldVsSpend CONTROL conjunctive "hold new funds ... and ... spend" → requirementLogic absent',
      html: '<article><p>To earn the bonus, hold new funds in your account for 1 business day and meet a $2,000 card spend requirement.</p><p>Open a Foo Business account to earn your bonus.</p></article>',
      key: 'requirementLogic', want: undefined },
    // 2026-07-14 fix-up (Step 2d POST-REVIEW H1) — the fee-waiver guard used to
    // be WHOLE-POST scoped, so a post's unrelated "Monthly fees: $0" glance row
    // (present on nearly every real DoC post) silently suppressed a legitimate
    // hold-vs-spend detection elsewhere in the same post. Guard is now scoped to
    // the matched disjunction's own sentence/line — this pin fails on the old
    // whole-post guard and passes on the fix.
    { name: 'HoldVsSpend WITH unrelated "Monthly fees: $0" row → requirementLogic still any',
      html: '<article><p>Offer at a glance</p><ul><li>Monthly fees: $0</li></ul><p>To qualify for the bonus, either hold new funds in your account for 1 business day or meet a $2,000 card spend requirement.</p><p>Open a Foo Business account to earn your bonus.</p></article>',
      key: 'requirementLogic', want: 'any' },
    // CONTROL for the scoped guard — genuine fee-waiver prose (the fee-avoidance
    // path itself, not the bonus-qualification path) must still be rejected.
    { name: 'HoldVsSpend fee-waiver phrasing ("avoid the monthly fee by maintaining a balance or making purchases") stays absent',
      html: '<article><p>Avoid the monthly fee by maintaining a balance or making purchases on your debit card each statement cycle.</p><p>Open a Foo account to earn your bonus.</p></article>',
      key: 'requirementLogic', want: undefined },
  ];
  let pass = 0, fail = 0; const failures = [];
  for (const c of cases) {
    let res; try { res = parseDocPost(c.html); } catch (e) { fail++; failures.push(c.name + ' THREW ' + e.message); continue; }
    const got = res.fields[c.key];
    const val = got ? got.value : undefined;
    // Optional confidence assertion (c.wantConf) — used to pin the P3-3 anchor
    // distinction (opening-context span = high, bare span = low).
    const confOk = (c.wantConf === undefined) || (got && got.confidence === c.wantConf);
    if (val === c.want && confOk) pass++;
    else { fail++; failures.push(`${c.name}: got ${JSON.stringify(val)}${got ? '/' + got.confidence : ''} want ${JSON.stringify(c.want)}${c.wantConf ? '/' + c.wantConf : ''}`); }
  }
  const line = `testDocParserRegressions: PASS ${pass}  FAIL ${fail}`;
  if (fail) { console.warn(line); failures.forEach(f => console.warn('  ✗ ' + f)); }
  else console.log('%c' + line, 'color:#10b981');
  return { pass, fail, failures };
}

/* ============================================================
   TEMPLATE PICKER (F5) — "Start from a template" in the new-offer flow
   ============================================================ */

// A concise "key requirement" chip label for a template. Prefers the funding
// obligation (the headline number for most bank bonuses); falls back to the DD
// requirement, then the first user requirement row (via the shared
// requirementSummary). Returns '' when nothing summarizable — the chip is then
// omitted rather than rendered empty.
function templateRequirementChipText(tpl) {
  if (!tpl) return '';
  const funding = (tpl.requiredFundingAmount != null && tpl.requiredFundingAmount !== '')
    ? Number(tpl.requiredFundingAmount) : null;
  if (funding != null && funding > 0) return `Fund ${formatCompactCurrency(funding)}`;
  const dd = tpl.ddRequirement;
  if (dd && dd.mode === 'count' && dd.count) return `${dd.count} DD${dd.count === 1 ? '' : 's'}`;
  if (dd && dd.mode === 'frequency' && dd.freqPeriods) {
    const unit = dd.freqEvery === 'week' ? 'wk' : dd.freqEvery === '2weeks' ? 'cycle' : 'mo';
    return `DD ×${dd.freqPeriods}/${unit}`;
  }
  const dr = tpl.debitRequirement;
  if (dr && dr.required && dr.count) return `${dr.count} debit${dr.count === 1 ? '' : 's'}`;
  const firstUser = Array.isArray(tpl.requirements) ? tpl.requirements.find(r => r && r.source === 'user') : null;
  if (firstUser) {
    const s = requirementSummary(firstUser);
    if (s) return s;
    if (firstUser.label) return firstUser.label;
  }
  return '';
}

// The chips row for one template: bonus amount (accent) + key-requirement
// (muted). Each omitted when it has no value.
function templateRowChips(tpl) {
  const chips = [];
  if (tpl.signupBonusAmount != null && tpl.signupBonusAmount !== '' && Number(tpl.signupBonusAmount) > 0) {
    chips.push(`<span class="chip chip-accent">${escapeHtml(formatCompactCurrency(Number(tpl.signupBonusAmount)))} bonus</span>`);
  }
  const reqText = templateRequirementChipText(tpl);
  if (reqText) chips.push(`<span class="chip chip-muted">${escapeHtml(reqText)}</span>`);
  return chips.join('');
}

// One template row: title (bank — offer), chips, savedAt muted, Use + delete.
function renderTemplateRow(tpl) {
  const name = offerDisplayLabel(tpl) || 'Untitled offer';
  const saved = tpl.savedAt ? `Saved ${escapeHtml(formatDateMedium(tpl.savedAt))}` : '';
  return `
    <div class="tpl-row" data-tpl-row="${escapeAttr(tpl.tplId)}">
      <div class="tpl-row-main">
        <div class="tpl-row-title">${escapeHtml(name)}</div>
        <div class="tpl-row-chips">${templateRowChips(tpl)}</div>
        ${saved ? `<div class="tpl-row-meta">${saved}</div>` : ''}
      </div>
      <div class="tpl-row-actions">
        <button type="button" class="btn btn-primary btn-sm" data-action="use-template" data-tpl-id="${escapeAttr(tpl.tplId)}">Use</button>
        <button type="button" class="tpl-del" data-action="delete-template" data-tpl-id="${escapeAttr(tpl.tplId)}" aria-label="Delete template" title="Delete template">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
        </button>
      </div>
    </div>`;
}

// Render the filtered template list into markup. `query` filters by bank/offer
// name (case-insensitive substring). Empty-after-filter shows a muted line.
function renderTemplateList(query) {
  const q = String(query || '').trim().toLowerCase();
  const all = Array.isArray(App.state.templates) ? App.state.templates : [];
  const rows = (q
    ? all.filter(t => `${t.bankName || ''} ${t.offerName || ''}`.toLowerCase().includes(q))
    : all);
  if (!rows.length) {
    return `<div class="tpl-empty">${q ? 'No templates match your search.' : 'No templates yet.'}</div>`;
  }
  return rows.map(renderTemplateRow).join('');
}

// The whole "Start from a template (N)" affordance. Returns '' entirely when
// there are zero templates (empty-state: the affordance is hidden, not shown
// disabled), so a fresh install's new-offer modal is unchanged. Collapsed by
// default; the toggle expands the search + list.
function renderTemplatePicker() {
  const n = (Array.isArray(App.state.templates) ? App.state.templates : []).length;
  if (n === 0) return '';
  return `
    <div class="tpl-picker" id="tpl-picker">
      <button type="button" class="tpl-picker-toggle" data-action="toggle-template-picker" aria-expanded="false" aria-controls="tpl-picker-body">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5a2 2 0 0 1 2-2h2"/><path d="M4 17v2a2 2 0 0 0 2 2h2"/><path d="M16 3h2a2 2 0 0 1 2 2v2"/><path d="M16 21h2a2 2 0 0 0 2-2v-2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        <span>Start from a template (${n})</span>
        <svg class="tpl-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-left:auto;"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="tpl-picker-body" id="tpl-picker-body" hidden>
        <input id="tpl-search" class="input tpl-search" type="text" placeholder="Search by bank or offer name…" autocomplete="off" aria-label="Search templates" />
        <div class="tpl-list" id="tpl-list">${renderTemplateList('')}</div>
      </div>
    </div>`;
}

// Expand/collapse the template picker; focus the search box on open.
function toggleTemplatePicker(btn) {
  const body = document.getElementById('tpl-picker-body');
  if (!btn || !body) return;
  const open = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!open));
  body.hidden = open;
  if (!open) setTimeout(() => document.getElementById('tpl-search')?.focus(), 30);
}

// Re-render the template list against the current search box value (bound as an
// input listener when the modal opens — see the setTimeout wiring below).
function filterTemplateList() {
  const list = document.getElementById('tpl-list');
  const search = document.getElementById('tpl-search');
  if (!list) return;
  list.innerHTML = renderTemplateList(search ? search.value : '');
}

// "Use" a template: instantiate a fresh offer via templateToOffer and re-render
// the NEW-offer modal seeded from it. Closing + reopening the same modal-root is
// how the app swaps modal content; the picker is gone (isEdit still false but
// showOfferModal only renders the picker before there's a seed... it stays
// visible, which is fine — the user can pick another). The user reviews the
// populated form and Saves normally.
function useTemplate(tplId) {
  if (!tplId) return;
  const tpl = (App.state.templates || []).find(t => t && t.tplId === tplId);
  if (!tpl) { toast('Template not found', 'danger'); return; }
  showOfferModal(null, templateToOffer(tpl));
}

// Delete a template (confirm). If the picker is open, re-render the list in
// place; when the last template goes, re-render the whole picker so the
// affordance disappears (empty-state hides it entirely).
function deleteTemplate(tplId) {
  if (!tplId) return;
  const tpl = (App.state.templates || []).find(t => t && t.tplId === tplId);
  const label = tpl ? offerDisplayLabel(tpl) : 'this template';
  if (!confirm(`Delete the template "${label}"?`)) return;
  App.update(s => {
    s.templates = (s.templates || []).filter(t => t && t.tplId !== tplId);
  });
  // App.update re-renders the main view, but the modal is separate — patch it.
  const picker = document.getElementById('tpl-picker');
  if (picker) {
    if ((App.state.templates || []).length === 0) {
      picker.remove();  // affordance hidden entirely at zero
    } else {
      filterTemplateList();
    }
  }
  toast('Template deleted');
}

export { _docForm, _docEl, _docCapFirst, _docSetInput, _docCurrentInput, _docAddUserReq, _docAppendNote, _docWireDdModel, _docEitherOrForceDdFamily, DOC_FIELD_MAP, DOC_FIELD_BY_KEY, _docConfDot, _docHasTiers, _docTierKindNoun, _docTierThresholdLabel, _docTierThresholdTargetDesc, _docTierReqDescriptor, _docEffectiveFields, _docFmtPct, _docRenderTierGroup, renderDocPreview, docTierSelect, docImportUpdateApplyCount, _docLastParse, _docTierSel, _docUserChecks, _docCaptureUserChecks, docImportParse, _docNormForQuote, _docMergeLlmFields, _docSlugTitle, docWorkerFetchParse, docImportFetch, docImportApply, docImportClear, docImportToggle, DOC_TEST_EXPECT, testDocParser, testDocParserRegressions, templateRequirementChipText, templateRowChips, renderTemplateRow, renderTemplateList, renderTemplatePicker, toggleTemplatePicker, filterTemplateList, useTemplate, deleteTemplate };
