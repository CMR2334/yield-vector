import { daysBetween, parseDate, uid } from './date-format-core.js';
import { toast } from './ui-utils.js';
'use strict';

/* ============================================================
   CONSTANTS & STORAGE
   ============================================================ */
const STORAGE_KEY = 'capital-planner-v1';

/* --- App version & build stamp ------------------------------------------
   APP_VERSION is the single user-facing build identifier, shown in
   Settings → About. Bump it on every meaningful release (date-build
   format: YYYY.MM.DD, append a letter — 2026.06.14b — for a second build
   the same day) and create a matching `stable-YYYY-MM-DD` git tag. Because
   the PWA is served from cache, this is the only reliable way to confirm
   which build a phone is actually running. package.json `version` is
   dev-only metadata and tracked separately. */
const APP_VERSION = '2026.07.11c';

/* --- Diagnostics & error logging ----------------------------------------
   The app runs on a phone with no console, so an uncaught error would
   otherwise vanish. logError() categorizes failures with a stable code and
   keeps the last DIAG_MAX in a localStorage ring buffer, surfaced in
   Settings → About & diagnostics where they can be copied into a report. */
const DIAG_KEY = 'yv-diag-log-v1';
const DIAG_MAX = 25;
const ErrCode = {
  STORAGE:   'E_STORAGE',    // localStorage read/write failed
  PARSE:     'E_PARSE',      // JSON.parse of local/cloud state failed
  SYNC_PUSH: 'E_SYNC_PUSH',  // Gist push failed
  SYNC_PULL: 'E_SYNC_PULL',  // Gist pull/fetch failed
  RENDER:    'E_RENDER',     // a render pass threw
  UNCAUGHT:  'E_UNCAUGHT',   // window 'error' event
  PROMISE:   'E_PROMISE',    // unhandledrejection
  PWA:       'E_PWA',        // icon/manifest setup
};

function readDiagLog() {
  try { const a = JSON.parse(localStorage.getItem(DIAG_KEY) || '[]'); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function clearDiagLog() { try { localStorage.removeItem(DIAG_KEY); } catch {} }

function logError(code, err, context) {
  const entry = {
    t: new Date().toISOString(),
    code: code || 'E_UNKNOWN',
    msg: (err && err.message) ? err.message : String(err == null ? '' : err),
    ctx: context || '',
    stack: (err && err.stack) ? String(err.stack).split('\n').slice(0, 4).join('\n') : ''
  };
  try { console.error(`[${entry.code}] ${entry.ctx}`.trim(), err); } catch {}
  try {
    const log = readDiagLog();
    log.unshift(entry);
    localStorage.setItem(DIAG_KEY, JSON.stringify(log.slice(0, DIAG_MAX)));
  } catch {}
  return entry;
}

/* Global safety nets. Without these an uncaught exception or rejected
   promise dies silently — a blank screen on iOS with no breadcrumb. */
function installErrorHandlers() {
  window.addEventListener('error', (e) => {
    // Bubbling-phase listener: catches script errors, not resource 404s.
    logError(ErrCode.UNCAUGHT, e.error || e.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '');
    toast('Something went wrong — see Settings → About & diagnostics', 'danger');
  });
  window.addEventListener('unhandledrejection', (e) => {
    // Rejections are often benign (aborted fetch on navigation); log
    // quietly without a toast so we don't cry wolf.
    logError(ErrCode.PROMISE, e.reason, 'unhandledrejection');
  });
}

/* Storage probe for the About panel. */
function storageHealth() {
  try { const k = '__yv_probe__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return 'OK'; }
  catch { return 'Unavailable'; }
}

/* Minimal clipboard helper (no existing one to reuse). GitHub Pages is
   https, so the async Clipboard API is available; fall back to a hidden
   textarea + execCommand for older iOS. */
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy command rejected'));
    } catch (e) { reject(e); }
  });
}


const STATUS_LABELS = {
  prospect: 'Prospect',
  selected: 'Selected',
  applied: 'Applied',
  funded: 'Funded',
  completed: 'Completed',
  skipped: 'Skipped'
};

/* ============================================================
   TWO-FIELD STATUS MODEL (account status + sub status)
   ============================================================
   The UI exposes two fields per offer:
     accountStatus: 'open' | 'closed'
     subStatus:     prospect | applied | approved | denied | on-track |
                    met-waiting | earned | didnt-track | archived
   The legacy single `offer.status` (prospect/selected/applied/funded/
   completed/skipped) is KEPT as a derived shadow value so all existing
   projection/timeline/chip/optimizer logic (44 call sites) keeps working
   untouched. deriveLegacyStatus() maps the two new fields onto it.
   ============================================================ */
const ACCOUNT_STATUSES = ['open', 'closed'];
const ACCOUNT_STATUS_LABELS = { open: 'Open', closed: 'Closed' };
const SUB_STATUSES = ['prospect', 'applied', 'approved', 'denied', 'on-track', 'met-waiting', 'earned', 'didnt-track', 'archived'];
const SUB_STATUS_LABELS = {
  prospect: 'Prospect', applied: 'Applied', approved: 'Approved', denied: 'Denied',
  'on-track': 'On-Track', 'met-waiting': 'Met (Waiting)', earned: 'Earned',
  'didnt-track': "Didn't Track", archived: 'Archived'
};
const SUB_STATUS_CHIP_CLASS = {
  prospect: 'chip-muted', applied: 'chip-accent', approved: 'chip-accent',
  denied: 'chip-danger', 'on-track': 'chip-accent', 'met-waiting': 'chip-warn',
  earned: 'chip-success', 'didnt-track': 'chip-muted', archived: 'chip-muted'
};
// Sub-statuses that auto-flip the account to Open when selected.
const SUBSTATUS_FLIPS_OPEN = new Set(['approved', 'on-track', 'met-waiting', 'earned', 'didnt-track']);
// Card 1 "Working toward a SUB": account open + actively pursuing.
const WORKING_SUB_STATUSES = new Set(['approved', 'on-track', 'met-waiting']);
// "Pre-account" sub-statuses: you haven't opened the account yet, so the
// account defaults to Closed but that does NOT force-exclude them (they
// remain hypothetical, includable via the scenario checkbox). Only an
// account that was OPENED and then Closed force-excludes.
const PRE_ACCOUNT_SUB_STATUSES = new Set(['prospect', 'applied']);
// Legacy-status partitions used by the projection/optimizer. Homed here (a pure
// module) so offer-model.js + projection-optimizer.js can import them without
// pulling in migrations-catalogs.js (which imports App/render) — that edge is
// what would otherwise drag the UI shell into the pure optimizer engine's graph.
// migrations-catalogs.js re-exports these so its own consumers stay unchanged.
const CONFIRMED_OFFER_STATUSES = new Set(['applied', 'funded']);
const HYPOTHETICAL_OFFER_STATUSES = new Set(['prospect', 'selected']);
function defaultAccountForSub(subStatus) {
  return SUBSTATUS_FLIPS_OPEN.has(subStatus) ? 'open' : 'closed';
}

// New (account, sub) → legacy status, encoding the projection rules:
//  - Account Closed force-excludes ONLY when the account was meaningfully
//    open (not for pre-account prospect/applied, which stay hypothetical).
//  - Approved/On-Track/Met/Earned → 'funded' (confirmed; capital frees
//    naturally at the withdrawal date via the projection engine).
//  - Prospect → 'prospect', Applied → 'selected' (both hypothetical).
//  - Denied → 'skipped'; Didn't Track / Archived → 'completed' (excluded).
function deriveLegacyStatus(accountStatus, subStatus) {
  if (accountStatus === 'closed' && !PRE_ACCOUNT_SUB_STATUSES.has(subStatus)) return 'completed';
  switch (subStatus) {
    case 'prospect': return 'prospect';
    case 'applied': return 'selected';
    case 'approved':
    case 'on-track':
    case 'met-waiting':
    case 'earned': return 'funded';
    case 'denied': return 'skipped';
    case 'didnt-track': return 'completed';
    case 'archived': return 'completed';
    default: return 'prospect';
  }
}
// Legacy status → new fields (one-time migration for offers saved before
// the redesign). Pre-account statuses (prospect/selected) → account
// Closed (not opened yet). old 'applied' was confirmed → Approved (open);
// 'funded' → On-Track (open); completed/skipped → closed.
function migrateLegacyStatus(legacy) {
  switch (legacy) {
    case 'prospect': return { accountStatus: 'closed', subStatus: 'prospect' };
    case 'selected': return { accountStatus: 'closed', subStatus: 'prospect' };
    case 'applied': return { accountStatus: 'open', subStatus: 'approved' };
    case 'funded': return { accountStatus: 'open', subStatus: 'on-track' };
    case 'completed': return { accountStatus: 'closed', subStatus: 'earned' };
    case 'skipped': return { accountStatus: 'closed', subStatus: 'archived' };
    default: return { accountStatus: 'closed', subStatus: 'prospect' };
  }
}
// Ensure an offer has both new fields and a synced legacy status. Safe to
// call repeatedly. Run on load (migration) and after any status edit.
function normalizeOfferStatus(o) {
  if (!o) return o;
  if (!o.subStatus) {
    const m = migrateLegacyStatus(o.status || 'prospect');
    o.subStatus = m.subStatus;
    if (!o.accountStatus) o.accountStatus = m.accountStatus;
  }
  if (!o.accountStatus) o.accountStatus = defaultAccountForSub(o.subStatus);
  o.status = deriveLegacyStatus(o.accountStatus, o.subStatus);
  return o;
}

// Mint a stable per-DD `id` on any direct-deposit row loaded from storage
// that predates the field, so reminder-feed items keyed
// `yv-<offerId>-dd-<ddId>` bind to the DD identity, never its array index
// (step-6 amendment 5). Idempotent: rows that already have an id keep it.
// Runs on load; new rows get ids at creation (readDdRowsFromForm/addDdRow).
function migrateDdIds(o) {
  if (!o || !Array.isArray(o.directDeposits)) return o;
  for (const dd of o.directDeposits) {
    if (dd && !dd.id) dd.id = uid('dd');
  }
  return o;
}

// Migrate the debit requirement from the legacy absolute `byDate` (a fixed
// calendar deadline) to the new relative `withinDays` (days after the
// planned sign-up date), the same shape as daysAfterSignupAllowedBeforeDeposit.
// Idempotent + additive (never drops the user's constraint):
//   • Already has withinDays → leave it.
//   • Has byDate + a sign-up date → withinDays = round(byDate − signup),
//     floored at 1; byDate is stashed in `byDateLegacy` (not lost, but no
//     longer authoritative) so a re-derivation is possible if the user
//     later changes the sign-up date.
//   • Has byDate but NO sign-up date yet → can't derive days now; preserve
//     byDate in `byDateLegacy` and derive withinDays lazily once a sign-up
//     date exists (see reconcileDebitWithinDays).
function migrateDebitRequirement(o) {
  const dr = o && o.debitRequirement;
  if (!dr) return o;
  if (dr.withinDays != null && dr.withinDays !== '') return o; // already migrated
  const legacyByDate = dr.byDate || dr.byDateLegacy || '';
  if (!legacyByDate) return o; // nothing to convert (new/empty requirement)
  const signup = parseDate(o.plannedSignupDate);
  const by = parseDate(legacyByDate);
  if (signup && by) {
    dr.withinDays = Math.max(1, Math.round(daysBetween(signup, by)));
  }
  // Preserve the original absolute deadline so nothing is lost and a later
  // sign-up-date change can re-derive; clear the now-non-authoritative byDate.
  dr.byDateLegacy = legacyByDate;
  dr.byDate = '';
  return o;
}

// Lazily derive withinDays from a preserved legacy absolute deadline once a
// sign-up date becomes available (the migration deferred it when the offer
// had no sign-up date). Safe to call on every load after migrateDebitRequirement.
function reconcileDebitWithinDays(o) {
  const dr = o && o.debitRequirement;
  if (!dr || !dr.required) return o;
  if (dr.withinDays != null && dr.withinDays !== '') return o;
  if (!dr.byDateLegacy) return o;
  const signup = parseDate(o.plannedSignupDate);
  const by = parseDate(dr.byDateLegacy);
  if (signup && by) dr.withinDays = Math.max(1, Math.round(daysBetween(signup, by)));
  return o;
}

export { STORAGE_KEY, APP_VERSION, ErrCode, readDiagLog, clearDiagLog, logError, installErrorHandlers, storageHealth, copyText, STATUS_LABELS, ACCOUNT_STATUSES, ACCOUNT_STATUS_LABELS, SUB_STATUSES, SUB_STATUS_LABELS, SUB_STATUS_CHIP_CLASS, WORKING_SUB_STATUSES, PRE_ACCOUNT_SUB_STATUSES, CONFIRMED_OFFER_STATUSES, HYPOTHETICAL_OFFER_STATUSES, defaultAccountForSub, deriveLegacyStatus, normalizeOfferStatus, migrateDdIds, migrateDebitRequirement, reconcileDebitWithinDays };
