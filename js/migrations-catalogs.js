import { App } from './app-state.js';
import { render } from './render-shell-overview.js';
import { schemaV2Defaults, syncRequirementsWithLegacy } from './requirements-templates.js';
import { CONFIRMED_OFFER_STATUSES, ErrCode, HYPOTHETICAL_OFFER_STATUSES, STORAGE_KEY, logError } from './runtime-status.js';
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
  // Entity/email pick-lists: rebuild from the values this state's own offers
  // carry (2026-08-23 — the lists left source, see migrateEntityCatalogs).
  migrateEntityCatalogs(state);
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
  // R69: 4 more well-separated hues (owner: "more colors"). Green fills the
  // lime→emerald gap; the last two keys ('fuchsia', 'magenta') originally held a
  // bright fuchsia + a hot-pink filling the violet→rose void.
  // R86 (owner-directed 2026-07-11): the owner asked to drop "the pink" (the
  // swatch labeled Pink = key 'magenta') and the darker/right-most of the purple
  // options (the right-most purple-family swatch in picker order = key
  // 'fuchsia'). Per the back-compat rule above, the KEYS stay stable — only hex
  // + label are retuned — so a stored color:'magenta' now re-skins to Burgundy
  // and color:'fuchsia' to Pine automatically. The two replacements are dark,
  // well-separated jewel tones (a deep wine-red + a dark pine-green): distinct
  // from each other, from the 14 other swatches, and from the deadline-red
  // family (#e87171) so an offer's identity never reads as "danger".
  { name: 'green',   hex: '#16a34a', label: 'Green' },
  { name: 'purple',  hex: '#9333ea', label: 'Purple' },
  { name: 'fuchsia', hex: '#14532d', label: 'Pine' },
  { name: 'magenta', hex: '#7b243c', label: 'Burgundy' }
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

// CONFIRMED_OFFER_STATUSES / HYPOTHETICAL_OFFER_STATUSES moved to the pure
// runtime-status.js (so the optimizer engine can reach them without this
// App/render-importing module); imported above and re-exported below so every
// existing consumer of migrations-catalogs.js is unchanged.

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

/* ============================================================
   ENTITY / EMAIL CATALOGS (owner directive 2026-08-23)
   ============================================================
   The "Entity used" / "Email used" pick-lists used to be hard-coded here. They
   are personal identifiers and this repo is public, so they now live in the
   user's own SYNCED state (settings.entityOptions / settings.emailOptions) and
   source carries only neutral placeholders. Nothing is lost on upgrade:
   migrateEntityCatalogs rebuilds each list from the UNION of the values the
   user's OWN offers already carry, so an existing device reconstitutes its
   catalog from its own private data on first load of this version.
   ============================================================ */
// Seeded ONLY on a device with no entity history at all (fresh install, nothing
// synced yet). Deliberately generic — a real identity is something the user
// types in Settings or inherits from their own offers.
const PLACEHOLDER_ENTITY_OPTIONS = ['Individual (SSN)', 'Business (EIN)'];

// Live catalogs (absent-safe reads of the synced settings). Every consumer —
// the offer form's selects, the Settings editor, the auto-default pickers —
// goes through these two so there is a single source of truth.
function entityCatalog() {
  const s = App.state && App.state.settings;
  return (s && Array.isArray(s.entityOptions) ? s.entityOptions : []).filter(Boolean);
}
function emailCatalog() {
  const s = App.state && App.state.settings;
  return (s && Array.isArray(s.emailOptions) ? s.emailOptions : []).filter(Boolean);
}

// Union-merge helper: keep existing order, append new values, drop blanks and
// exact duplicates. PURE.
function _mergeCatalog(existing, additions) {
  const out = [];
  const seen = new Set();
  for (const v of [].concat(existing || [], additions || [])) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// Rebuild the catalogs from the user's own data. IDEMPOTENT: re-running over an
// already-migrated state is a no-op (the union of a set with its own members).
// Runs inside migrateOffersToSchemaV2, so it fires at boot AND after every sync
// pull/restore — a device that pulls a peer's offers picks up their entity
// values too. Placeholders seed ONLY when nothing at all is known.
function migrateEntityCatalogs(state) {
  if (!state || !state.settings) return state;
  const s = state.settings;
  const offers = Array.isArray(state.offers) ? state.offers : [];
  // Tolerant guard for the defaults map (older payloads never wrote it), same
  // idiom as the templates/action_done guards above. Idempotent.
  s.entityDefaults = (s.entityDefaults && typeof s.entityDefaults === 'object' && !Array.isArray(s.entityDefaults))
    ? s.entityDefaults
    : { businessEntity: '', businessEmail: '', personalEntity: '', personalEmail: '' };
  const ents = _mergeCatalog(s.entityOptions, offers.map(o => o && o.entityUsed));
  const mails = _mergeCatalog(s.emailOptions, offers.map(o => o && o.emailUsed));
  s.entityOptions = ents.length ? ents : PLACEHOLDER_ENTITY_OPTIONS.slice();
  s.emailOptions = mails;
  return state;
}

// Add values the user committed on an offer to the catalogs (the "anything you
// use joins the list" affordance — covers DoC-imported and legacy values that
// never passed through the Settings editor). Caller supplies the mutable state.
function rememberEntityValues(state, entityUsed, emailUsed) {
  if (!state || !state.settings) return state;
  state.settings.entityOptions = _mergeCatalog(state.settings.entityOptions, [entityUsed]);
  state.settings.emailOptions = _mergeCatalog(state.settings.emailOptions, [emailUsed]);
  return state;
}

// ---- Entity-catalog pins (2026-08-23) ---------------------------------------
// Bare-node runnable (this module imports no DOM at load). Run from the optimizer
// harness: docs/fixtures/optimizer/harness/optimizer-pins.js.
function testEntityCatalogPins() {
  const results = [];
  const check = (name, ok, extra = '') => results.push({ name, ok: !!ok, extra });
  const mkState = (over) => Object.assign({ settings: { entityOptions: [], emailOptions: [] }, offers: [] }, over || {});

  {
    // Union rebuild from the user's own offers — the upgrade path that lets the
    // hard-coded lists leave source without the owner losing his entries.
    const st = mkState({
      offers: [
        { entityUsed: 'Entity A', emailUsed: 'a@example.com' },
        { entityUsed: 'Entity B', emailUsed: 'b@example.com' },
        { entityUsed: 'Entity A', emailUsed: 'a@example.com' },   // duplicate
        { entityUsed: '', emailUsed: '' },                        // blanks ignored
        null
      ]
    });
    migrateEntityCatalogs(st);
    check('catalog migration: rebuilt from the offers\' own values, deduped, in order',
      st.settings.entityOptions.join('|') === 'Entity A|Entity B'
      && st.settings.emailOptions.join('|') === 'a@example.com|b@example.com',
      st.settings.entityOptions.join('|') + ' / ' + st.settings.emailOptions.join('|'));
    const before = JSON.stringify(st.settings);
    migrateEntityCatalogs(st);
    migrateEntityCatalogs(st);
    check('catalog migration: idempotent (re-running changes nothing)', JSON.stringify(st.settings) === before);
  }
  {
    // Existing catalog entries survive and lead; new offer values append.
    const st = mkState({
      settings: { entityOptions: ['Kept First'], emailOptions: ['kept@example.com'] },
      offers: [{ entityUsed: 'Added Later', emailUsed: 'added@example.com' }]
    });
    migrateEntityCatalogs(st);
    check('catalog migration: existing entries keep their order, new values append',
      st.settings.entityOptions.join('|') === 'Kept First|Added Later'
      && st.settings.emailOptions.join('|') === 'kept@example.com|added@example.com');
  }
  {
    // Fresh device, nothing synced: generic placeholders only — never a real
    // identity, because source carries none.
    const st = mkState();
    migrateEntityCatalogs(st);
    check('catalog migration: a fresh device gets only the generic placeholders',
      st.settings.entityOptions.join('|') === PLACEHOLDER_ENTITY_OPTIONS.join('|') && st.settings.emailOptions.length === 0,
      st.settings.entityOptions.join('|'));
  }
  {
    // Values committed on an offer join the lists (the "anything you use joins
    // the list" affordance), deduped.
    const st = mkState({ settings: { entityOptions: ['Entity A'], emailOptions: [] } });
    rememberEntityValues(st, 'Entity A', 'new@example.com');
    rememberEntityValues(st, 'Entity C', 'new@example.com');
    check('catalog: a saved offer\'s entity/email join the lists without duplicating',
      st.settings.entityOptions.join('|') === 'Entity A|Entity C' && st.settings.emailOptions.join('|') === 'new@example.com');
  }

  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  if (typeof console !== 'undefined') {
    console.log(`testEntityCatalogPins: PASS ${pass}  FAIL ${fail}`);
    for (const r of results) console.log(`  ${r.ok ? 'ok ' : 'X  '}${r.name}${r.extra ? '  [' + r.extra + ']' : ''}`);
  }
  return { pass, fail, results };
}

export { migrateOffersToSchemaV2, migrateEntityCatalogs, testEntityCatalogPins, rememberEntityValues, entityCatalog, emailCatalog, _mergeCatalog, PLACEHOLDER_ENTITY_OPTIONS, hasPreV2Backup, clearPreV2Backup, restorePreV2Backup, CONFIDENCE_LABELS, OFFER_COLOR_PALETTE, OFFER_COLOR_BY_NAME, offerColorHex, usedOfferColors, firstUnusedOfferColor, CONFIRMED_OFFER_STATUSES, HYPOTHETICAL_OFFER_STATUSES, COMMITMENT_TYPES, EVENT_CATEGORIES, categorySign, applyCategorySign };
