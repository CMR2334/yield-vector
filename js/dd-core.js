import { addBusinessDays, addDays, daysBetween, isoDate, nextBusinessDay, parseDate } from './date-format-core.js';
/* ============================================================
   PURE DD / DAY-MODEL CORE  (run 2026-07-08-planner-optimizer, step 3)
   ============================================================
   The direct-deposit round-trip math, the effective-landing date, and the
   DD-window-end formula — extracted here as a PURE module that imports ONLY
   date-format-core.js (no App, no render). This is the single source of truth
   the optimizer engine imports so its graph never reaches the UI shell; the
   UI modules (dd-widgets.js, offer-model.js, projection-optimizer.js,
   reminders.js) import these back so there is exactly ONE implementation.

   ddTransfer config threading (C1/C4 fix): ddRoundTrip takes an explicit `cfg`
   so the engine can evaluate ddTransfer variants faithfully. For in-app callers
   that pass nothing, the LIVE config still applies via a provider the impure UI
   side (dd-widgets.js) registers with setDdTransferProvider() — the pure core
   itself never reads App.state, so importing it drags no UI graph along. The
   Node harness registers no provider (and always passes cfg), keeping the module
   pure there too.
   ============================================================ */

const DEFAULT_DD_TRANSFER = { inDays: 1, seasonDays: 1, backDays: 1 };

// Normalize a raw ddTransfer object to the {inDays, seasonDays, backDays}
// shape, defaulting each leg to 1 (matching the historical ddTransferConfig
// fallbacks). Tolerant of null/partial input.
function normalizeDdTransfer(t) {
  const o = (t && typeof t === 'object') ? t : {};
  return {
    inDays: Number.isFinite(o.inDays) ? o.inDays : 1,
    seasonDays: Number.isFinite(o.seasonDays) ? o.seasonDays : 1,
    backDays: Number.isFinite(o.backDays) ? o.backDays : 1
  };
}

// Live-config provider indirection. dd-widgets.js registers a resolver that
// reads App.state.settings.ddTransfer, so a bare in-app ddRoundTrip(dd) still
// defaults to the owner's live setting — byte-identical to the old direct read.
// Unset (Node harness / engine) → the 1/1/1 default, but those paths always
// pass an explicit cfg anyway.
let _ddTransferProvider = null;
function setDdTransferProvider(fn) { _ddTransferProvider = (typeof fn === 'function') ? fn : null; }
function ddTransferConfig() {
  return normalizeDdTransfer(_ddTransferProvider ? _ddTransferProvider() : null);
}

// For one DD (initiated on its planned date), compute the full round
// trip. Returns { initiate, post, returnInitiate, returnDate, heldDays }
// where heldDays = calendar days the money is OUT of the origin account
// (from initiation through the day it lands back). null if no date.
// `cfg` is the ddTransfer model; omitted → live config (in-app) or 1/1/1.
function ddRoundTrip(dd, cfg = ddTransferConfig()) {
  const initiate = dd && dd.plannedDate ? parseDate(dd.plannedDate) : null;
  if (!initiate) return null;
  const { inDays, seasonDays, backDays } = normalizeDdTransfer(cfg);
  const post = addBusinessDays(initiate, inDays);
  const returnInitiate = addBusinessDays(post, seasonDays);
  const returnDate = addBusinessDays(returnInitiate, backDays);
  const heldDays = daysBetween(initiate, returnDate);
  return { initiate, post, returnInitiate, returnDate, heldDays };
}

// Given a directDeposits[] entry { plannedDate, amount }, return the
// effective (actual processing) date as a YYYY-MM-DD string — same as
// planned if it's a business day, otherwise the next business day. Pure
// (no ddTransfer dependency).
function directDepositEffectiveDate(dd) {
  if (!dd || !dd.plannedDate) return '';
  const planned = parseDate(dd.plannedDate);
  if (!planned) return '';
  return isoDate(nextBusinessDay(planned));
}

// The deadline the WHOLE DD set must be complete by. Frequency mode
// ("N DDs, one every <period>") → signup + periods×period. Count mode →
// the latest planned DD effective (posting) date. Returns an ISO string or
// '' when it can't be derived (non-DD offer type, or no signup/DDs). Moved
// verbatim from reminders.js so the engine and the feed share one formula.
function ddWindowEndDate(offer) {
  if (offer.offerType !== 'direct-deposit' && offer.offerType !== 'held-and-dd') return '';
  const req = offer.ddRequirement;
  if (req && req.mode === 'frequency') {
    const start = parseDate(offer.plannedSignupDate);
    const periods = Math.max(1, Number(req.freqPeriods) || 1);
    if (!start) return '';
    const d = new Date(start);
    if (req.freqEvery === 'week') d.setDate(d.getDate() + periods * 7);
    else if (req.freqEvery === '2weeks') d.setDate(d.getDate() + periods * 14); // UI's biweekly option
    else if (req.freqEvery === 'day') d.setDate(d.getDate() + periods);
    else d.setMonth(d.getMonth() + periods); // 'month' default
    return isoDate(d);
  }
  // Count mode: the last DD must have POSTED — use the max effective date.
  const effs = (offer.directDeposits || [])
    .map(dd => directDepositEffectiveDate(dd))
    .filter(Boolean)
    .sort();
  return effs.length ? effs[effs.length - 1] : '';
}

export { DEFAULT_DD_TRANSFER, normalizeDdTransfer, setDdTransferProvider, ddTransferConfig, ddRoundTrip, directDepositEffectiveDate, ddWindowEndDate };
