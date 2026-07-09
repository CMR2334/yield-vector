import { TODAY, isoDate } from './date-format-core.js';
import { DDMethods } from './dd-widgets.js';
import { bindGlobalEvents, seedSampleData } from './events-actions-data.js';
import { migrateOffersToSchemaV2 } from './migrations-catalogs.js';
import { seedManifestHwm } from './reminders.js';
import { render, renderErrorState } from './render-shell-overview.js';
import { ErrCode, STORAGE_KEY, installErrorHandlers, logError, migrateDdIds, migrateDebitRequirement, normalizeOfferStatus, reconcileDebitWithinDays } from './runtime-status.js';
import { Sync, setupPwa } from './sync-pwa.js';
import { toast } from './ui-utils.js';
/* ============================================================
   STATE MANAGEMENT
   ============================================================ */
const App = {
  state: null,
  view: 'overview',
  filters: {
    timelineShowCancelled: false,
    timelineShowCompleted: true,
    offersStatus: 'all',
    offersSearch: '',
    offersSort: 'default',
    offersAdvanced: false
  },
  optimizer: { results: null, candidates: [], evaluated: 0, infeasibleCount: 0, lastRunAt: null },
  // Which segment of the merged Plan tab is active: 'planner' | 'timeline' | 'optimize'.
  _planSegment: 'planner',
  // Transient optimizer-engine proposal (NEVER persisted — like a DoC parse
  // result; nothing hits state.offers until applyOptimizerPlan). Holds the
  // winning plan object (with .alternatives), or a {tooMany} signal.
  optimizerPlan: null,
  _optimizerAltIndex: 0,   // which of plan.alternatives is focused for detail/apply
  _optimizerUndo: null,    // one-shot undo snapshot after an apply (set in step 4-iii)
  _optimizerRecheck: null, // in-flight churn re-check gate: { sourceId, before, hadPlan }
  _churnVerifyInFlight: null, // sourceId of an in-flight one-click churn verify (spinner guard)
  _churnVerifiedToday: null,  // { [sourceId]: todayISO } — one-click verifies that found no change (badge flip)

  init() {
    installErrorHandlers();
    try {
      const saved = this.load();
      this.state = saved || this.defaultState();
      // Snapshot the state's freshness AS LOADED, before any save (the fresh
      // seed below, the projection roll) can re-stamp _lastModified this
      // session. The first-sync equal-state exemption reads this so a device
      // that was perfectly in sync at load still silently seeds lineage even
      // after a system date-roll bumps local's live _lastModified.
      Sync.loadedModified = (saved && saved._lastModified) || 0;
      // Restore the persisted dirty marker: if localStorage holds edits that
      // never reached the cloud (_dirtySince set), this device is dirty even
      // across a reload, so the CAS conflict path won't silently adopt over
      // them.
      Sync.localDirty = Boolean(this.state && this.state._dirtySince);
      if (!saved) {
        // Fresh device: seeding sample data is not a user edit, so save it
        // system (no dirty marker) — otherwise a brand-new device would
        // conflict-prompt instead of cleanly adopting real cloud data on its
        // first sync.
        this.state = seedSampleData(this.state);
        this.save({ system: true });
      }
      // Migrate offers to the two-field status model + sync legacy status,
      // mint stable per-DD ids for feed item keys (never array index), and
      // convert the debit requirement's absolute byDate → relative withinDays.
      (this.state.offers || []).forEach(o => {
        normalizeOfferStatus(o); migrateDdIds(o);
        migrateDebitRequirement(o); reconcileDebitWithinDays(o);
      });
      // Schema v2: add the requirements[] layer + churn/fee/promo scalar fields
      // and derive rows from the now-normalized legacy fields. One-time full-
      // state backup to 'yv-backup-pre-v2' happens inside (before first mutation);
      // no save/schedulePush here — persistence waits for the next user save.
      migrateOffersToSchemaV2(this.state);
      // Seed the manifestVersion high-water mark from the loaded state so the
      // feed version never regresses below what a prior session already shipped.
      seedManifestHwm(Number(this.state._manifestVersion) || 0);
      this.rollProjectionStartIfStale();
      setupPwa();
      if (Sync.isConfigured()) Sync.setStatus('synced'); // optimistic until startup pull replies
      else Sync.setStatus('unconfigured');
      render();
      bindGlobalEvents();
      // Async pull — runs after first paint, doesn't block UI
      if (Sync.isConfigured()) {
        setTimeout(() => Sync.startupSync(), 50);
      }
      // Lazy-load the DD-method datapoints (re-renders cards when ready).
      setTimeout(() => DDMethods.load(), 80);
    } catch (e) {
      // A throw during boot must not leave a blank screen — show a
      // self-contained recovery panel that reads the diag log directly.
      logError(ErrCode.RENDER, e, 'App.init');
      const root = document.getElementById('app');
      if (root) root.innerHTML = renderErrorState(e);
    }
  },

  // Auto-roll the projection start date forward to today whenever it
  // falls behind. Called on init, on visibilitychange (tab back from
  // background), and once a minute via setInterval (covers the case
  // where the app is left open overnight). Returns true if the state
  // changed, so callers can re-render. We only advance — never roll
  // backward — so a user explicitly setting a future start date in
  // Settings is preserved.
  rollProjectionStartIfStale() {
    if (!this.state || !this.state.settings) return false;
    const today = isoDate(new Date());
    const cur = this.state.settings.projectionStartDate;
    if (!cur || cur < today) {
      this.state.settings.projectionStartDate = today;
      // System save: an automatic date-roll is NOT a user edit, so it must not
      // set the dirty marker (else a clean-but-stale device trips the conflict
      // dialog and a reflexive Cancel clobbers the cloud — see App.save).
      this.save({ system: true });
      return true;
    }
    return false;
  },

  defaultState() {
    return {
      version: 1,
      settings: {
        currentLiquidCapital: 200000,
        minimumCashBuffer: 20000,
        projectionStartDate: isoDate(TODAY),
        projectionHorizonMode: 'auto',  // 'auto' | '3months' | '6months' | '1year' | '2years' | 'custom'
        projectionHorizonDays: 365,     // used only when mode === 'custom'
        maxOptimizerCandidates: 15,
        defaultLockStartsFrom: 'funded date',
        // Global DD transfer-timing model (business days per leg). The
        // round trip is initiate → +inDays → posts as DD → +seasonDays
        // → sent back → +backDays → returns to origin. Default 1/1/1
        // ("season 1 business day").
        ddTransfer: { inDays: 1, seasonDays: 1, backDays: 1 },
        // Banks the user can transfer money FROM (for DD-method ranking).
        sourceBanks: []
      },
      offers: [],
      commitments: [],
      events: [],
      // F5: reusable offer templates (terms only, personal data stripped).
      // Root-level so localStorage + Gist sync carry them; never read by
      // buildReminderItems, so they can't emit feed items.
      templates: [],
      // Per-action completion map: { [feedItemId]: doneDateISO } for action
      // kinds that have NO domain done-field (everything except
      // requirement-deadline, which writes through to its requirement row).
      // Root-level so it round-trips through localStorage + Gist sync.
      action_done: {}
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (e) {
      logError(ErrCode.PARSE, e, 'App.load: localStorage state');
      return null;
    }
  },

  // {system:true} marks a purely-automatic save (projection-date roll,
  // fresh-device seed) — it stamps _lastModified and schedules the push as
  // usual, but does NOT set the dirty marker. Without this, a stale-but-clean
  // device whose date auto-rolled would look "dirty" and trip the CAS conflict
  // dialog; a reflexive Cancel would then clobber the cloud with stale data
  // despite ZERO user edits. Default (user/import/reset saves) marks dirty.
  save({ system = false } = {}) {
    try {
      // Stamp last-modified so cloud sync can resolve "who's newer"
      this.state._lastModified = Date.now();
      // Mark unsynced local edits so the CAS push can tell "this device is
      // just stale" from "both sides changed" on a head divergence. Persist
      // the marker WITH the state (_dirtySince) so it survives a reload —
      // a volatile flag alone would reset to false on reopen while
      // localStorage still holds edits that never reached the cloud, and the
      // next CAS check would then wrongly treat this device as clean and
      // discard them. _dirtySince rides along in the payload; it does NOT
      // affect _lastModified/"who's newer" semantics. Keep the earliest
      // dirty time (don't churn it on every keystroke-save).
      if (!system) {
        if (!this.state._dirtySince) this.state._dirtySince = new Date().toISOString();
        Sync.localDirty = true;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      Sync.schedulePush();
    } catch (e) {
      logError(ErrCode.STORAGE, e, 'App.save');
      toast('Could not save: storage unavailable', 'danger');
    }
  },

  setView(view) {
    if (this.view === view) return;
    this.view = view;
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  },

  update(updater) {
    updater(this.state);
    this.save();
    render();
  }
};

export { App };
