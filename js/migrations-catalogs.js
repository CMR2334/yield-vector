import { App } from './app-state.js';
import { render } from './render-shell-overview.js';
import { schemaV2Defaults, syncRequirementsWithLegacy } from './requirements-templates.js';
import { ErrCode, STORAGE_KEY, logError } from './runtime-status.js';
import { Sync } from './sync-pwa.js';
import { toast } from './ui-utils.js';
function migrateOffersToSchemaV2(state) {
  if (!state || !Array.isArray(state.offers)) return state;

  // F5: tolerant guard for the templates root key. This runs at boot AND at
  // every cloud-adoption point (migrateOffersToSchemaV2 is called from all of
  // them), so a state loaded from an OLDER build (which never wrote templates)
  // or a corrupt value is normalized to [] before any code reads it. Root-level
  // and idempotent — leaves an existing array untouched.
  state.templates = Array.isArray(state.templates) ? state.templates : [];

  // Tolerant guard for the per-action completion map (same idiom as templates):
  // an older payload never wrote it, so normalize a missing/corrupt value to {}
  // before any code reads it. Root-level and idempotent.
  state.action_done = (state.action_done && typeof state.action_done === 'object' && !Array.isArray(state.action_done))
    ? state.action_done : {};

  // Is there any pre-v2 offer? (one lacking the requirements marker) — gate the
  // backup on real work so we don't snapshot an already-v2 state.
  const needsMigration = state.offers.some(o => o && !Array.isArray(o.requirements));

  if (needsMigration) {
    // One-time full-state backup BEFORE the first mutation. Never overwrite an
    // existing (older, more original) backup. Quota/serialize failure is
    // degraded-not-fatal: log and continue migrating.
    try {
      if (localStorage.getItem('yv-backup-pre-v2') == null) {
        localStorage.setItem('yv-backup-pre-v2', JSON.stringify(state));
      }
    } catch (e) {
      logError(ErrCode.STORAGE, e, 'migrateOffersToSchemaV2: backup');
    }
  }

  for (const o of state.offers) {
    if (!o) continue;
    const firstTime = !Array.isArray(o.requirements);
    if (firstTime) {
      // Seed scalar defaults without clobbering any that somehow already exist.
      const defs = schemaV2Defaults();
      for (const k in defs) { if (!(k in o)) o[k] = defs[k]; }
      if (!('last_edited' in o)) o.last_edited = null; // unknown history
      o.requirements = [];
    }
    // Always-on: refresh derived rows from current legacy values (idempotent).
    syncRequirementsWithLegacy(o);
  }
  return state;
}

// True when the one-time pre-v2 backup snapshot exists in localStorage. Gates
// the Settings "Restore pre-v2 backup" button (rendered only when recoverable).
function hasPreV2Backup() {
  try { return localStorage.getItem('yv-backup-pre-v2') != null; }
  catch (e) { return false; }
}

// Drop the pre-v2 backup snapshot. Called by the destructive "Clear all data"
// flow so an erase can't be undone via the restore button (which would otherwise
// resurrect erased financial data), and after a successful restore consumes it.
// The next render re-hides the restore button (hasPreV2Backup() → false).
function clearPreV2Backup() {
  try { localStorage.removeItem('yv-backup-pre-v2'); }
  catch (e) { /* nothing to clear / storage unavailable — best effort */ }
}

// Restore the pre-v2 snapshot as an intentional local change.
//   • Sync configured → migrate the snapshot to v2 IN MEMORY first (so the
//     restored state renders coherently), stamp a fresh _lastModified, then hand
//     it to Sync.restoreState() — the existing "make THIS the truth" path, which
//     clears lineage (_baseRevision=null) and force-pushes past the CAS so the
//     restore becomes the new cloud head and CANNOT be silently clobbered by the
//     next startup pull (the R56 restore guard). No reload needed — restoreState
//     persists + renders; we migrated before handing off.
//   • Sync NOT configured → write localStorage directly + reload; the reload's
//     fresh init re-runs migrateOffersToSchemaV2, cleanly re-migrating the
//     restored pre-v2 payload (no cloud, so nothing to push).
// The consumed backup is cleared either way. Returns false (and toasts) on a
// missing/corrupt backup.
function restorePreV2Backup() {
  let raw;
  try { raw = localStorage.getItem('yv-backup-pre-v2'); }
  catch (e) { raw = null; }
  if (raw == null) { toast('No pre-v2 backup found', 'danger'); return false; }
  let snap;
  try { snap = JSON.parse(raw); }
  catch (e) { logError(ErrCode.PARSE, e, 'restorePreV2Backup'); toast('Backup is corrupt — could not restore', 'danger'); return false; }

  if (typeof Sync !== 'undefined' && Sync.isConfigured && Sync.isConfigured()) {
    // Migrate the pre-v2 snapshot to v2 before it becomes the live/pushed state,
    // and stamp it as a fresh intentional edit so timestamp comparisons on other
    // devices also pull it (restoreState's forced push already wins by lineage).
    App.state = snap;
    migrateOffersToSchemaV2(App.state);
    App.state._lastModified = Date.now();
    clearPreV2Backup();
    Sync.restoreState(App.state)
      .then(() => { render(); toast('Restored pre-v2 backup'); })
      .catch((e) => { logError(ErrCode.SYNC_PUSH, e, 'restorePreV2Backup: restoreState'); toast('Restore saved locally; cloud push failed', 'danger'); });
    return true;
  }

  // Unconfigured: direct write + reload (init re-migrates the restored payload).
  try {
    App.state = snap;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    clearPreV2Backup();
  } catch (e) {
    logError(ErrCode.STORAGE, e, 'restorePreV2Backup: write');
    toast('Could not write restored data', 'danger');
    return false;
  }
  location.reload();
  return true;
}

const CONFIDENCE_LABELS = { confirmed: 'Confirmed', likely: 'Likely', uncertain: 'Uncertain' };

/* ============================================================
   OFFER COLOR PALETTE — 16 swatches, names not hex so the palette
   can be re-tuned without breaking saved offers. Per-bank identity
   coding for the card border, timeline bar, and chart marker stroke.

   Curated constraints:
   - THREE blues: navy (deep) + sky (cyan-light) + cobalt (royal/mid)
   - ONE red-like: rose (#e11d48) — distinctly more saturated/cool
     than the app's deadline red (#e87171, a washed coral). No
     confusion between identity-rose and meaning-red.
   - TWO neutral-darks: slate (cool blue-gray) + graphite (neutral)
   - Hues spread evenly so adjacent picks are visually distinct.

   NOTE: the `name` keys are the STORED value on offer.color and must
   stay stable for back-compat. The `hex` and `label` are display-only
   and can be re-tuned freely — changing them just re-skins existing
   offers using that key. That's why e.g. `name:'pink'` now renders as
   Cobalt blue and `name:'amber'` renders as Gold.
   ============================================================ */
const OFFER_COLOR_PALETTE = [
  { name: 'navy',    hex: '#1e3a8a', label: 'Navy' },
  { name: 'sky',     hex: '#0ea5e9', label: 'Sky' },
  { name: 'teal',    hex: '#0d9488', label: 'Teal' },
  { name: 'emerald', hex: '#059669', label: 'Emerald' },
  { name: 'lime',    hex: '#65a30d', label: 'Lime' },
  { name: 'amber',   hex: '#eab308', label: 'Gold' },
  { name: 'orange',  hex: '#ea580c', label: 'Orange' },
  { name: 'rose',    hex: '#e11d48', label: 'Rose' },
  { name: 'pink',    hex: '#2563eb', label: 'Cobalt' },
  { name: 'violet',  hex: '#8b5cf6', label: 'Violet' },
  { name: 'brown',   hex: '#3f3f46', label: 'Graphite' },
  { name: 'slate',   hex: '#475569', label: 'Slate' },
  // R69: 4 more well-separated hues (owner: "more colors"). No brown, no
  // near-duplicates — green fills the lime→emerald gap; purple/fuchsia/pink
  // fill the wide violet→rose void. Keys are new+stable (note 'pink' was
  // already taken by Cobalt, so hot-pink uses the 'magenta' key).
  { name: 'green',   hex: '#16a34a', label: 'Green' },
  { name: 'purple',  hex: '#9333ea', label: 'Purple' },
  { name: 'fuchsia', hex: '#c026d3', label: 'Fuchsia' },
  { name: 'magenta', hex: '#ec4899', label: 'Pink' }
];
const OFFER_COLOR_BY_NAME = Object.fromEntries(OFFER_COLOR_PALETTE.map(c => [c.name, c.hex]));

// Hex for an offer's color. Returns '' if the offer has no color set
// (either field missing, empty string, or an unknown name) so callers
// can render a neutral default.
function offerColorHex(o) {
  if (!o || !o.color) return '';
  return OFFER_COLOR_BY_NAME[o.color] || '';
}

// Set of color names already in use by other offers — used to gray
// out picker swatches. excludeOfferId lets the offer being edited
// keep its own current color selectable.
function usedOfferColors(excludeOfferId) {
  const used = new Set();
  for (const o of (App.state && App.state.offers) || []) {
    if (!o.color) continue;
    if (excludeOfferId && o.id === excludeOfferId) continue;
    used.add(o.color);
  }
  return used;
}

// First palette color not currently in use. Returns '' if all 16 are
// taken so callers can decide what to do (toast + no color, prompt
// to clear one, etc.). Excludes the offer being edited so re-saving
// without a color change doesn't false-positive.
function firstUnusedOfferColor(excludeOfferId) {
  const used = usedOfferColors(excludeOfferId);
  for (const c of OFFER_COLOR_PALETTE) {
    if (!used.has(c.name)) return c.name;
  }
  return '';
}

const CONFIRMED_OFFER_STATUSES = new Set(['applied', 'funded']);
const HYPOTHETICAL_OFFER_STATUSES = new Set(['prospect', 'selected']);

const COMMITMENT_TYPES = [
  { value: 'minimum balance', label: 'Minimum Balance' },
  { value: 'opening deposit', label: 'Opening Deposit' },
  { value: 'direct deposit', label: 'Direct Deposit' },
  { value: 'manual hold', label: 'Manual Hold' },
  { value: 'other', label: 'Other' }
];

const EVENT_CATEGORIES = [
  { value: 'inflow', label: 'Inflow' },
  { value: 'outflow', label: 'Outflow' },
  { value: 'bonus payout', label: 'Bonus Payout' },
  { value: 'fee', label: 'Fee' },
  { value: 'correction', label: 'Correction' },
  { value: 'other', label: 'Other' }
];

// Categories with a definite cash-flow direction get an auto-applied
// sign on the amount field. Correction/Other stay neutral — the user
// decides. The convention is "positive = money in, negative = money out".
function categorySign(cat) {
  if (cat === 'outflow' || cat === 'fee') return -1;
  if (cat === 'inflow' || cat === 'bonus payout') return 1;
  return 0;
}
function applyCategorySign(amount, cat) {
  const s = categorySign(cat);
  if (s === 0) return amount;
  if (!Number.isFinite(amount) || amount === 0) return amount;
  return s * Math.abs(amount);
}

const ENTITY_OPTIONS = [
  'Collin Rekowski (Ind - SSN)',
  'Collin Rekowski (SP - EIN)',
  'Ethir Systems (LLC - EIN)'
];

const EMAIL_OPTIONS = [
  'cmreko91@gmail.com',
  'collinrekowski1@gmail.com',
  'ethirsystems@gmail.com'
];

export { migrateOffersToSchemaV2, hasPreV2Backup, clearPreV2Backup, restorePreV2Backup, CONFIDENCE_LABELS, OFFER_COLOR_PALETTE, OFFER_COLOR_BY_NAME, offerColorHex, usedOfferColors, firstUnusedOfferColor, CONFIRMED_OFFER_STATUSES, HYPOTHETICAL_OFFER_STATUSES, COMMITMENT_TYPES, EVENT_CATEGORIES, categorySign, applyCategorySign, ENTITY_OPTIONS, EMAIL_OPTIONS };
