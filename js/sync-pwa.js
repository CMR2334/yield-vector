import { App } from './app-state.js';
import { isoDate } from './date-format-core.js';
import { migrateOffersToSchemaV2 } from './migrations-catalogs.js';
import { ACTION_COMPLETABLE_KINDS, buildReminderItems, computeFeedSafely } from './reminders.js';
import { render } from './render-shell-overview.js';
import { ErrCode, STORAGE_KEY, logError } from './runtime-status.js';
import { escapeAttr, toast } from './ui-utils.js';
/* ============================================================
   CLOUD SYNC (GitHub Gist)
   ============================================================
   Persists state to a private GitHub Gist so the app syncs across
   devices. Each device stores a Personal Access Token (PAT, scope:
   `gist`) and the Gist ID in localStorage. On startup we pull the
   Gist; if its `_lastModified` timestamp is newer than local, the
   remote replaces local. Otherwise we push local up.

   Conflict resolution is last-writer-wins on the `_lastModified`
   timestamp embedded in the state. For a single user across devices
   this is sufficient — the loser's edits are overwritten only if
   they were strictly older than the winner's.

   Token security note: a PAT with only the `gist` scope can only
   read/write your gists. It cannot touch your repos, your account
   settings, or any GitHub-authenticated services. Loss = revoke
   at github.com/settings/tokens.
   ============================================================ */
const SYNC_CONFIG_KEY = 'capital-planner-sync-config-v1';
const SYNC_FILENAME = 'capital-planner.json';
// Reverse channel (Reminders → app). A SIBLING file in the same Gist that the
// iOS Shortcut appends to when it marks a reminder complete; the app only ever
// READS it (never writes it) on pull. Kept separate from SYNC_FILENAME so the
// Shortcut's writes never race the app's writes to capital-planner.json. Absent
// file → the app behaves exactly as before (see applyRemoteCompletions).
const REVERSE_COMPLETIONS_FILENAME = 'yv-completions.json';

const Sync = {
  status: 'unconfigured',  // 'unconfigured' | 'syncing' | 'synced' | 'pending' | 'error'
  lastError: null,
  lastSyncAt: 0,            // Date.now() of last successful round-trip
  pushTimer: null,
  startupDone: false,
  // True when this device has local edits not yet confirmed onto the cloud.
  // Set in App.save(); cleared on every pull-adopt and every successful PATCH.
  // Used by the CAS push to distinguish "just stale, adopt silently" from
  // "both sides changed, must ask" on a head divergence. Backed by the
  // persisted App.state._dirtySince so it survives a reload (see App.save).
  localDirty: false,
  // _lastModified of the state as LOADED this session (set once in App.init,
  // before any save re-stamps it). Used by the first-sync equal-state
  // exemption: if the state we loaded was identical to the cloud and only
  // system stamps (a projection date-roll) have moved local since, the device
  // was really in sync — adopt+seed silently instead of prompting.
  loadedModified: 0,

  // Clear the dirty marker in BOTH places it lives (the volatile flag and the
  // persisted _dirtySince field) so a reload can't resurrect it. Call after a
  // pull-adopt or a successful PATCH — whenever this device's state is known
  // to match the cloud. Note: on a pull-adopt the adopted cloud payload may
  // carry the OTHER device's _dirtySince; nulling it here clears THIS
  // (adopting) device's marker, which is what we want.
  markClean() {
    this.localDirty = false;
    if (App.state) App.state._dirtySince = null;
  },

  // Single source of truth for resolving a "both sides changed" conflict —
  // BOTH the push-side CAS and the pull-side remote-newer branch call this so
  // the dialog text and OK/Cancel semantics can never drift between the two.
  // `side` is 'push' | 'pull' — only used to log the right deferred code.
  // `unknownLineage` switches to the one-time first-sync-after-upgrade copy
  // (recommend Adopt — timestamps carry no signal there, so a reflexive
  // keep-local is the hazard).
  // Returns one of:
  //   'defer'      — can't ask (background, no user) → caller leaves state
  //                  untouched, sets status 'pending', keeps the dirty marker;
  //                  the next foreground sync re-detects. Logged here.
  //   'adopt'      — user chose the cloud → caller adopts remote (discarding
  //                  this device's unsynced edits).
  //   'keep-local' — user chose to keep local → caller pushes local up
  //                  (overwrite intent), routed through the CAS push.
  resolveDirtyConflict(remote, side, { unknownLineage = false } = {}) {
    // No UI available (a background auto-sync) → never silently pick a side.
    if (typeof document !== 'undefined' && document.hidden) {
      if (side === 'pull') {
        logError(ErrCode.SYNC_PULL, new Error('remote newer with local edits, no UI to resolve'), 'pull-conflict-deferred');
      } else {
        logError(ErrCode.SYNC_PUSH, new Error('head divergence with local edits, no UI to resolve'), 'cas-conflict-deferred');
      }
      return 'defer';
    }
    const rO = (remote && Array.isArray(remote.offers)) ? remote.offers.length : 0;
    const lO = (App.state && Array.isArray(App.state.offers)) ? App.state.offers.length : 0;
    const counts = `\n\n• Cloud: ${rO} offer${rO === 1 ? '' : 's'}\n• This device: ${lO} offer${lO === 1 ? '' : 's'}`;
    const msg = unknownLineage
      ? `First sync on this device's new version: the cloud and this device differ.${counts}\n\nRecommended: Adopt cloud (OK).\nChoose Keep this device (Cancel) ONLY if you made changes here that never synced.`
      : `Sync conflict.\n\nThe cloud has changes from another device AND this device has unsynced edits.${counts}\n\nOK  = Adopt the cloud (discard this device's recent edits) — safe default.\nCancel = Keep this device's edits and overwrite the cloud.`;
    const adopt = confirm(msg);
    return adopt ? 'adopt' : 'keep-local';
  },

  // Is the local state trivial (nothing a user could lose)? Must cover EVERY
  // user-editable collection — offers, commitments, standalone cash-flow
  // events, and user-entered source banks — so a device holding only, say,
  // events doesn't silently adopt the cloud and lose them. Also never trivial
  // if the device is dirty (a pending unsynced edit is by definition
  // something to lose, regardless of counts). Used to skip the unknown-lineage
  // prompt and silently adopt an untouched fresh install.
  _trivialLocalState() {
    if (this.localDirty) return false;
    const s = App.state;
    if (!s) return true;
    const len = (a) => (Array.isArray(a) ? a.length : 0);
    return len(s.offers) === 0
        && len(s.commitments) === 0
        && len(s.events) === 0
        && len(s.settings && s.settings.sourceBanks) === 0;
  },

  // THE UNIFIED FIRST-SYNC RULE. While lineage is unknown (no _baseRevision),
  // any sync encounter with an EXISTING, DIVERGENT cloud state prompts ONCE
  // (recommend Adopt) — timestamps carry zero signal in this window, so this
  // replaces the old per-direction legacy-timestamp inferences. After any
  // resolution (adopt seeds lineage; keep-local pushes and the PATCH seeds it)
  // the rule never fires again. Called by BOTH safeSync and push before their
  // normal (known-lineage) logic. Adopts in-place when it decides to adopt.
  // Returns: 'n/a' (lineage known, or no real cloud state, or same state —
  // caller proceeds with normal logic), 'adopted' (handled — caller returns),
  // 'deferred' (background, no UI — caller sets 'pending' and returns), or
  // 'keep-local' (user kept local — caller pushes it up, force).
  resolveFirstSync({ remote, cloudHead, side }) {
    const baseRev = App.state && App.state._baseRevision;
    if (baseRev) return 'n/a';                 // lineage known — normal path
    if (!(cloudHead && remote)) return 'n/a';  // fresh/empty cloud — normal path

    const adoptCloud = () => {
      App.state = remote;
      // Adopted cloud payload may predate schema v2 — migrate before persist/
      // render so requirements[]/scalars exist (idempotent; the one-time backup
      // guard means repeat adoptions don't churn yv-backup-pre-v2).
      migrateOffersToSchemaV2(App.state);
      App.state._baseRevision = cloudHead;
      this.markClean();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state)); } catch {}
      this.lastSyncAt = Date.now();
      this.setStatus('synced');
      render();
    };

    const remoteMod = (remote && remote._lastModified) || 0;
    const localMod = (App.state && App.state._lastModified) || 0;
    // Silently adopt + seed lineage (no prompt, no toast — nothing to lose)
    // when any of:
    //   • equal live timestamps — same state right now; OR
    //   • the state we LOADED matched the cloud and only system stamps have
    //     moved local since (a projection date-roll re-stamps _lastModified,
    //     which would otherwise defeat the equal check and force a needless
    //     prompt). Gated on !localDirty so a genuine user edit since load still
    //     prompts; OR
    //   • trivial local state (no offers/commitments — an untouched install).
    // adoptCloud() calls markClean(), so an equal-stamp encounter also clears a
    // stale dirty marker (e.g. a PATCH that landed but whose response was lost).
    if (remoteMod === localMod ||
        (!this.localDirty && remoteMod === this.loadedModified) ||
        this._trivialLocalState()) {
      adoptCloud();
      return 'adopted';
    }
    // Divergent, non-trivial, unknown lineage → ask ONCE.
    const decision = this.resolveDirtyConflict(remote, side, { unknownLineage: true });
    if (decision === 'defer') return 'deferred';
    if (decision === 'adopt') {
      adoptCloud();
      toast('Adopted cloud — this device was behind after an update');
      return 'adopted';
    }
    return 'keep-local';  // caller pushes local up (force)
  },

  getConfig() {
    try { return JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY)) || null; }
    catch { return null; }
  },
  setConfig(cfg) {
    if (cfg) localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(SYNC_CONFIG_KEY);
  },
  // Optional DoC-import Worker URL (Phase 7 v2). Stored in the same local sync-
  // config blob (device-local, never in the public state payload synced to the
  // Gist), but independent of the Gist credentials: it is read/written on its
  // own key and deliberately survives a sync disconnect, since it's a separate
  // integration. Empty string / null when unconfigured — the whole URL-import
  // feature is gated on this being a non-empty https URL.
  getDocWorkerUrl() {
    const c = this.getConfig();
    const u = c && typeof c.docWorkerUrl === 'string' ? c.docWorkerUrl.trim() : '';
    return u;
  },
  setDocWorkerUrl(url) {
    const c = this.getConfig() || {};
    const clean = (url == null ? '' : String(url)).trim();
    if (clean) c.docWorkerUrl = clean;
    else delete c.docWorkerUrl;
    // Persist even if there are no Gist credentials yet — the URL is standalone.
    if (Object.keys(c).length) localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(c));
    else localStorage.removeItem(SYNC_CONFIG_KEY);
  },
  // Optional shared secret for the DoC Worker (matches the Worker's
  // WORKER_SECRET; sent as the X-YV-Key header). Same storage + privacy
  // guarantees as the URL: device-local in SYNC_CONFIG_KEY, NEVER in App.state,
  // so it is never synced to the Gist or written to a JSON export, and it
  // survives a sync disconnect. Empty when unconfigured (then no header is sent
  // and the Worker's secret gate must also be unset for fetches to work).
  getDocWorkerSecret() {
    const c = this.getConfig();
    return c && typeof c.docWorkerSecret === 'string' ? c.docWorkerSecret.trim() : '';
  },
  setDocWorkerSecret(secret) {
    const c = this.getConfig() || {};
    const clean = (secret == null ? '' : String(secret)).trim();
    if (clean) c.docWorkerSecret = clean;
    else delete c.docWorkerSecret;
    if (Object.keys(c).length) localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(c));
    else localStorage.removeItem(SYNC_CONFIG_KEY);
  },
  isConfigured() {
    const c = this.getConfig();
    return Boolean(c && c.token && c.gistId);
  },
  setStatus(s, err = null) {
    this.status = s;
    this.lastError = err;
    updateSyncIndicator();
  },

  // LOCAL-ORIGIN SYNC GUARD. A dev/test instance served from localhost or
  // 127.0.0.1 must NEVER touch the owner's real Gist: a stray push would
  // overwrite live cloud data and a pull/sync would clobber the test copy. When
  // the page origin is local AND the explicit opt-in flag is absent, every Gist
  // network entry point (push scheduler + executor, safeSync/pull, history,
  // createGist) short-circuits on this check. Set localStorage
  // yv-allow-local-sync="1" to deliberately develop against a real Gist. Logs
  // ONCE per session, then stays silent. Guards the sync METHODS only — never the
  // shared ghGet/ghFetch helpers — so the DoC-import Worker fetch (a separate
  // integration on its own URL) is unaffected.
  _localSyncNoticeShown: false,
  _localOriginBlocked() {
    const h = (typeof location !== 'undefined' && location.hostname) || '';
    if (h !== 'localhost' && h !== '127.0.0.1') return false;
    try { if (localStorage.getItem('yv-allow-local-sync') === '1') return false; } catch {}
    if (!this._localSyncNoticeShown) {
      this._localSyncNoticeShown = true;
      console.info('[yv] sync disabled on local origin — set localStorage yv-allow-local-sync="1" to enable');
    }
    return true;
  },

  // Schedule a debounced push after local edits.
  schedulePush(delayMs = 2500) {
    if (this._localOriginBlocked()) return;
    if (!this.isConfigured()) { this.setStatus('unconfigured'); return; }
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.setStatus('pending');
    this.pushTimer = setTimeout(() => this.push({ silent: true }), delayMs);
  },

  // Timestamp-aware sync: pulls from Gist; if remote newer, replaces local
  // (after flushing any pending push). If local newer, pushes. Safe to call
  // from startup, focus, and visibilitychange. Throttled by SAFE_SYNC_COOLDOWN.
  _lastSafeSyncAt: 0,
  async safeSync({ force = false, reason = '' } = {}) {
    if (this._localOriginBlocked()) return;
    if (!this.isConfigured()) { this.setStatus('unconfigured'); return; }
    const SAFE_SYNC_COOLDOWN = 5000;
    const now = Date.now();
    if (!force && now - this._lastSafeSyncAt < SAFE_SYNC_COOLDOWN) return;
    this._lastSafeSyncAt = now;

    const cfg = this.getConfig();
    // If a debounced push is queued, the user has unsaved local edits — flush
    // them first so we don't clobber them by pulling.
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
      await this.push({ silent: true });
    }

    this.setStatus('syncing');
    try {
      const data = await ghGet(`https://api.github.com/gists/${cfg.gistId}`, cfg.token);
      const file = data.files[SYNC_FILENAME] || Object.values(data.files || {})[0];
      let remote = null;
      if (file) {
        const content = file.truncated
          ? await (await fetch(file.raw_url)).text()
          : file.content;
        if (content && content.trim()) {
          try { remote = JSON.parse(content); } catch (e) { remote = null; logError(ErrCode.PARSE, e, 'startupSync: cloud payload'); }
        }
      }
      const remoteModified = (remote && remote._lastModified) || 0;
      const localModified = (App.state && App.state._lastModified) || 0;
      // Reuse the same GET response for the lineage head (no extra request).
      const cloudHead = revisionOf(data);

      // UNIFIED FIRST-SYNC RULE (unknown lineage). Runs before the timestamp
      // branching because timestamps carry NO signal while lineage is unknown
      // — a divergent cloud must be resolved by one prompt regardless of which
      // side's stamp is newer (this is the pull-side twin of the push guard;
      // the old per-direction legacy inferences are gone). 'n/a' → fall through
      // to the normal known-lineage logic below.
      const first = this.resolveFirstSync({ remote, cloudHead, side: 'pull' });
      if (first === 'adopted') return;
      if (first === 'deferred') { this.setStatus('pending'); return; }
      if (first === 'keep-local') { await this.push({ silent: true, force: true }); return; }

      if (remote && remoteModified > localModified) {
        // Remote is newer. If this device has NO unsynced edits, adopt the
        // cloud (below). But if it's dirty (_dirtySince set — e.g. a failed or
        // deferred push, or a reload with unsynced edits), a blind adopt would
        // silently discard exactly the edits the dirty marker exists to
        // protect — the mirror image of the push-side clobber. Route through
        // the SAME shared conflict resolver as the push side.
        const adoptRemote = () => {
          App.state = remote;
          // Cloud payload may predate v2 — migrate before persist/render.
          migrateOffersToSchemaV2(App.state);
          App.state._baseRevision = cloudHead;
          this.markClean();
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state)); } catch {}
          this.lastSyncAt = Date.now();
          this.setStatus('synced');
          render();
          if (reason) toast(`Pulled latest from cloud (${reason})`);
        };
        if (!this.localDirty) {
          adoptRemote();
        } else {
          const decision = this.resolveDirtyConflict(remote, 'pull');
          if (decision === 'defer') {
            // Leave local state untouched; keep the dirty marker so the next
            // foreground sync re-detects and asks.
            this.setStatus('pending');
          } else if (decision === 'adopt') {
            adoptRemote();
            toast('Adopted cloud — this device’s recent edits were discarded');
          } else {
            // 'keep-local' — the user chose to keep this device's edits and
            // overwrite the cloud. Push them up with overwrite intent (force
            // past the CAS so we don't re-prompt for the same decision — the
            // single shared dialog above already covered it).
            await this.push({ silent: true, force: true });
          }
        }
      } else if (!remote || localModified > remoteModified) {
        // Local newer or remote empty — push up. Skip if remoteModified > 0
        // and local seeded with no edits (avoids overwriting with sample data
        // on a fresh device); only push if local has been touched.
        if (remoteModified > 0 && localModified === 0) {
          // Local is fresh / unsaved — pull remote rather than push
          App.state = remote;
          // Cloud payload may predate v2 — migrate before persist/render.
          migrateOffersToSchemaV2(App.state);
          App.state._baseRevision = cloudHead;
          this.markClean();
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state)); } catch {}
          this.lastSyncAt = Date.now();
          this.setStatus('synced');
          render();
          if (reason) toast(`Pulled latest from cloud (${reason})`);
        } else {
          // Local newer → push through the CAS push (guards against a stale
          // device clobbering data the cloud gained since our last pull).
          await this.push({ silent: true });
        }
      } else {
        // Timestamps equal (common on the first run of a new build against an
        // already-synced device). Nothing to transfer, but seed our lineage
        // from the GET response we already have — otherwise _baseRevision
        // stays falsy and the CAS guard is silently disabled on the next
        // push. Persist without re-stamping _lastModified and without pushing.
        if (cloudHead && App.state && App.state._baseRevision !== cloudHead) {
          App.state._baseRevision = cloudHead;
        }
        // Equal stamps mean this device's edit is provably already in the
        // cloud, so clear any lingering dirty marker — otherwise a PATCH that
        // landed but whose response was lost leaves the device falsely dirty
        // and it would raise bogus conflict prompts on later syncs.
        this.markClean();
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state)); } catch {}
        this.lastSyncAt = Date.now();
        this.setStatus('synced');
      }

      // REVERSE CHANNEL: consume the Shortcut's completions file if present.
      // Runs after the state resolution above so it overlays onto whichever
      // state won this sync. Non-fatal and idempotent (high-water mark); an
      // absent file is a no-op. On a real apply, save() persists + schedules a
      // push whose feed recompute tombstones the now-done item(s), and render()
      // greys the row. (First-sync early-returns above skip this; those apply on
      // the next steady-state sync — acceptable for a one-time bootstrap path.)
      try {
        if (await applyRemoteCompletions(App.state, data.files)) {
          App.save();
          render();
        }
      } catch (e) { logError(ErrCode.SYNC_PULL, e, 'applyRemoteCompletions'); }
    } catch (e) {
      this.setStatus('error', e.message);
      console.warn('safeSync failed', e);
    }
  },

  async startupSync() {
    if (this.startupDone) return;
    this.startupDone = true;
    return this.safeSync({ force: true });
  },

  async pull({ silent = false } = {}) {
    if (this._localOriginBlocked()) return;
    if (!this.isConfigured()) { toast('Sync not configured', 'danger'); return; }
    const cfg = this.getConfig();
    this.setStatus('syncing');
    try {
      const data = await ghGet(`https://api.github.com/gists/${cfg.gistId}`, cfg.token);
      const file = data.files[SYNC_FILENAME] || Object.values(data.files || {})[0];
      if (!file) throw new Error('Gist has no file yet');
      const content = file.truncated
        ? await (await fetch(file.raw_url)).text()
        : file.content;
      if (!content || !content.trim()) throw new Error('Gist file is empty');
      const remote = JSON.parse(content);
      // Manual pull is an explicit user action to adopt the cloud, so it
      // adopts unconditionally — but if this device has unsynced edits, warn
      // first so the user doesn't silently discard them.
      if (this.localDirty && !silent) {
        if (!confirm('This device has unsynced edits. Pulling replaces them with the cloud copy and cannot be undone here (use "Restore from history" to recover a prior cloud revision).\n\nPull and discard this device’s edits?')) {
          this.setStatus('synced');
          return;
        }
      }
      App.state = remote;
      // Manually-pulled cloud payload may predate v2 — migrate before persist/
      // render (idempotent; backup guard prevents churn on repeat pulls).
      migrateOffersToSchemaV2(App.state);
      // Record the cloud head as our lineage so later CAS pushes compare
      // correctly (manual pull is a pull-adopt path like the others).
      App.state._baseRevision = revisionOf(data);
      this.markClean();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state)); } catch {}
      this.lastSyncAt = Date.now();
      this.setStatus('synced');
      render();
      if (!silent) toast('Pulled from cloud');
    } catch (e) {
      logError(ErrCode.SYNC_PULL, e, 'Sync.pull');
      this.setStatus('error', e.message);
      if (!silent) toast('Pull failed: ' + e.message, 'danger');
    }
  },

  // Single unified push. All push paths (App.save debounce, safeSync's
  // local-newer branch, the manual "Push now" button) route through here so
  // there is ONE place that talks to the Gist. It is a compare-and-swap:
  // unless {force} is set, it GETs the gist first and, if the cloud head has
  // moved off our lineage (_baseRevision) OR our lineage is unknown while a
  // real cloud state exists, it treats that as a conflict and either silently
  // adopts the cloud (this device was just stale) or asks the user (this
  // device has unsynced edits) — the guard that stops a stale device from
  // clobbering newer data. The pre-check FAILS CLOSED: if the cloud GET fails
  // we DEFER (status 'pending', dirty marker kept) rather than fall back to an
  // unguarded PATCH, so a flaky network can't bypass the guard. {force:true}
  // skips the CAS check and is reachable ONLY after an explicit user
  // "overwrite" decision or an explicit make-this-the-truth action: (1) the
  // push-side CAS conflict dialog's overwrite branch (falls through to the
  // PATCH below, in-place), (2) the pull-side (safeSync) conflict resolver's
  // 'keep-local' branch — both route through the ONE shared
  // resolveDirtyConflict() dialog, so a force here never double-prompts — and
  // (3) restoreState. NEVER from a plain manual push.
  async push({ silent = false, force = false } = {}) {
    if (this._localOriginBlocked()) return;
    if (!this.isConfigured()) { if (!silent) toast('Sync not configured', 'danger'); return; }
    const cfg = this.getConfig();
    this.setStatus('syncing');
    try {
      // Stamp last-modified + reminder feed snapshot just before sending so
      // remote reflects the upload. The feed is what an iOS Shortcut will
      // read to build merge-style Reminders entries.
      App.state._lastModified = Date.now();
      App.state._feed = computeFeedSafely(App.state);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state)); } catch {}

      if (!force) {
        // Compare-and-swap pre-check. Peek at the cloud before PATCHing.
        let cloudData = null;
        try {
          cloudData = await ghGet(`https://api.github.com/gists/${cfg.gistId}`, cfg.token);
        } catch (e) {
          // FAIL CLOSED. If we can't read the cloud head we cannot prove this
          // push is safe, so we never blind-PATCH — a fail-open would bypass
          // the whole guard exactly when the network is flaky.
          logError(ErrCode.SYNC_PUSH, e, 'cas-precheck-failed');
          // A permanent failure (401/403 expired/revoked PAT, 404 deleted or
          // wrong gist id) will never self-heal by retrying — surface it as an
          // error so the indicator turns red and the manual "Push now" path can
          // show "Push failed: HTTP <code>" so the user knows to fix creds.
          // Transient/network-ish failures keep the defer-and-retry: 'pending',
          // dirty marker kept, next cycle retries.
          if (e && (e.status === 401 || e.status === 403 || e.status === 404)) {
            this.setStatus('error', e.message);
            if (!silent) toast('Push failed: ' + e.message, 'danger');
          } else {
            this.setStatus('pending');
          }
          return;
        }
        const cloudHead = revisionOf(cloudData);
        const baseRev = App.state && App.state._baseRevision;
        const remote = cloudHead ? await parseGistState(cloudData) : null;

        // UNKNOWN LINEAGE → the unified first-sync rule (shared with safeSync).
        // Prompts once on a divergent existing cloud, silently adopts/seeds
        // otherwise; only an empty/fresh cloud falls through to the seed PATCH.
        if (!baseRev) {
          const first = this.resolveFirstSync({ remote, cloudHead, side: 'push' });
          if (first === 'adopted') return;
          if (first === 'deferred') { this.setStatus('pending'); return; }
          // 'keep-local' → fall through to PATCH (overwrite intent).
          // 'n/a'        → empty/fresh cloud → fall through to seed PATCH.
        } else if (cloudHead && cloudHead !== baseRev && remote) {
          // KNOWN LINEAGE, head moved off ours → marker-based CAS. Timestamps
          // get NO vote (a re-stamp forges newness); the persisted dirty marker
          // is the only signal.
          const adoptCloud = () => {
            App.state = remote;
            // Cloud payload may predate v2 — migrate before persist/render.
            migrateOffersToSchemaV2(App.state);
            App.state._baseRevision = cloudHead;
            this.markClean();
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state)); } catch {}
            this.lastSyncAt = Date.now();
            this.setStatus('synced');
            render();
          };
          if (!this.localDirty) {
            // Merely stale (no unsynced edits) — cloud is authoritative.
            adoptCloud();
            toast('Cloud had newer data — updated this device instead of overwriting');
            return;
          }
          // Both sides changed — shared resolver. 'defer' → 'pending';
          // 'adopt' → take cloud; 'keep-local' → fall through to PATCH.
          const decision = this.resolveDirtyConflict(remote, 'push');
          if (decision === 'defer') { this.setStatus('pending'); return; }
          if (decision === 'adopt') {
            adoptCloud();
            toast('Adopted cloud — this device’s recent edits were discarded');
            return;
          }
          // 'keep-local' → fall through to PATCH (overwrite).
        }
      }

      // Scrub _dirtySince from the UPLOADED copy only. If we shipped our own
      // non-null marker, an old-build device (which has no markClean) would
      // pull and store it verbatim, then after IT upgrades believe itself
      // dirty during a later divergence and offer to overwrite newer cloud
      // data. The wire copy is a shallow clone with _dirtySince:null; the
      // LOCAL App.state keeps its marker until the PATCH actually succeeds
      // (markClean in the success tail — a failed PATCH must stay dirty).
      const wire = { ...App.state, _dirtySince: null };
      const body = JSON.stringify({
        files: { [SYNC_FILENAME]: { content: JSON.stringify(wire, null, 2) } }
      });
      const patched = await ghFetch(`https://api.github.com/gists/${cfg.gistId}`, cfg.token, 'PATCH', body);
      // The PATCH response carries the updated gist (incl. history); record the
      // new head as our lineage so the next CAS check compares correctly, and
      // persist it so lineage survives a reload. Our edits are now on the
      // cloud, so this device is no longer dirty.
      const newRev = revisionOf(patched);
      if (newRev) App.state._baseRevision = newRev;
      this.markClean();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state)); } catch {}
      this.lastSyncAt = Date.now();
      this.setStatus('synced');
      if (!silent) toast('Pushed to cloud');
    } catch (e) {
      logError(ErrCode.SYNC_PUSH, e, 'Sync.push');
      this.setStatus('error', e.message);
      if (!silent) toast('Push failed: ' + e.message, 'danger');
    }
  },

  async createGist(token) {
    if (this._localOriginBlocked()) throw new Error('sync disabled on local origin — set localStorage yv-allow-local-sync="1" to enable');
    // Convenience: create a private Gist seeded with current state + feed.
    App.state._lastModified = Date.now();
    App.state._feed = computeFeedSafely(App.state);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state)); } catch {}
    const body = JSON.stringify({
      description: 'Yield Vector sync',
      public: false,
      files: { [SYNC_FILENAME]: { content: JSON.stringify(App.state, null, 2) } }
    });
    const data = await ghFetch('https://api.github.com/gists', token, 'POST', body);
    // Seed lineage from the creation response so the brand-new Gist starts
    // with known lineage (otherwise _baseRevision stays falsy and the CAS
    // guard is disabled until the first pull). The local state is now on the
    // cloud, so this device is clean.
    App.state._baseRevision = revisionOf(data);
    this.markClean();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state)); } catch {}
    return data.id;
  },

  // ---- Revision history / recovery -------------------------------------
  // GitHub keeps every Gist revision, so an accidental overwrite (e.g. a
  // stale device pushing over newer data) is recoverable. listHistory()
  // returns the revisions newest-first; fetchRevision() pulls one version's
  // parsed state; restoreState() makes a chosen revision current everywhere.
  async listHistory() {
    if (this._localOriginBlocked()) return [];
    if (!this.isConfigured()) throw new Error('Sync not configured');
    const cfg = this.getConfig();
    const data = await ghGet(`https://api.github.com/gists/${cfg.gistId}`, cfg.token);
    return Array.isArray(data.history) ? data.history : [];
  },
  async fetchRevision(version) {
    if (this._localOriginBlocked()) return null;
    const cfg = this.getConfig();
    const data = await ghGet(`https://api.github.com/gists/${cfg.gistId}/${version}`, cfg.token);
    const file = (data.files && (data.files[SYNC_FILENAME] || Object.values(data.files)[0])) || null;
    if (!file) return null;
    const content = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
    if (!content || !content.trim()) return null;
    try { return JSON.parse(content); } catch (e) { logError(ErrCode.PARSE, e, 'fetchRevision'); return null; }
  },
  // Replace local state with a recovered revision and push it up so it
  // becomes the current version on every device (push stamps a fresh
  // _lastModified, so other devices pull it on their next sync).
  async restoreState(state) {
    App.state = state;
    // A restored cloud-history revision may predate schema v2 — migrate before
    // it becomes the pushed/rendered truth (idempotent: a caller that already
    // migrated, e.g. restorePreV2Backup, gets a no-op here).
    migrateOffersToSchemaV2(App.state);
    // A restore is an explicit "make THIS the truth" action, so clear any
    // inherited lineage and force the push past the CAS check — otherwise a
    // cloud that looks newer could decline the restore itself. The forced
    // push records the fresh head as _baseRevision, which then BLOCKS a stale
    // device's later auto-push (its lineage won't match) — this is the
    // "restore won't recur-clobber" guarantee.
    App.state._baseRevision = null;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state)); } catch {}
    await this.push({ silent: true, force: true });
    this.lastSyncAt = Date.now();
    this.setStatus('synced');
    render();
  },

  disconnect() {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    // Preserve the optional DoC-import Worker URL + secret across a sync
    // disconnect — they're a separate integration, not Gist credentials, so
    // dropping them here would silently break URL import when someone just
    // resets cloud sync.
    const keepWorkerUrl = this.getDocWorkerUrl();
    const keepWorkerSecret = this.getDocWorkerSecret();
    this.setConfig(null);
    if (keepWorkerUrl) this.setDocWorkerUrl(keepWorkerUrl);
    if (keepWorkerSecret) this.setDocWorkerSecret(keepWorkerSecret);
    this.lastSyncAt = 0;
    this.setStatus('unconfigured');
  }
};

// Head revision SHA of a Gist API response (newest history entry). Used as
// the lineage marker (_baseRevision) for compare-and-swap sync. Returns null
// if the response has no history (unknown lineage → callers degrade soft).
function revisionOf(gistData) {
  const h = gistData && Array.isArray(gistData.history) ? gistData.history : null;
  return (h && h[0] && h[0].version) || null;
}

// Parse the synced state file out of a Gist API response. Mirrors the
// truncated-file handling used elsewhere. Returns null on missing/empty/bad
// payload (logged as a parse error) so callers can fall back.
async function parseGistState(gistData) {
  const file = (gistData && gistData.files &&
    (gistData.files[SYNC_FILENAME] || Object.values(gistData.files)[0])) || null;
  if (!file) return null;
  const content = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
  if (!content || !content.trim()) return null;
  try { return JSON.parse(content); }
  catch (e) { logError(ErrCode.PARSE, e, 'parseGistState: cloud payload'); return null; }
}

async function ghGet(url, token) {
  const r = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json'
    }
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const err = new Error(`HTTP ${r.status}${t ? ': ' + t.slice(0, 80) : ''}`);
    err.status = r.status;  // structured so callers can branch (e.g. auth vs transient)
    throw err;
  }
  return r.json();
}

async function ghFetch(url, token, method, body) {
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const err = new Error(`HTTP ${r.status}${t ? ': ' + t.slice(0, 80) : ''}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/* REVERSE CHANNEL (Reminders → app). The iOS Shortcut, when it marks a reminder
   complete, appends {id, completedAt} to REVERSE_COMPLETIONS_FILENAME — a
   SIBLING file in the same Gist (the app's capital-planner.json is never touched
   by it). Because the app already fetches the whole Gist file list on every pull
   (ghGet → data.files), reading this file costs NOTHING extra and needs no new
   auth: the app already holds the same PAT/gist-id the Shortcut uses.

   Contract (additive, optional):
     • file body: { "completions": [ { "id": "<feed item id>",
                                       "completedAt": "<ISO8601>" }, ... ] }
       (a bare array is also accepted). The app READS ONLY; the Shortcut owns
       the file and is responsible for appends (and any pruning). `completedAt`
       must PARSE as a timestamp (Date.parse) — offset forms ("…-05:00") and Z
       both work; unparseable values ("pending") are skipped, not applied.
     • idempotency: a bounded APPLIED-LEDGER of `id@epochMillis` keys
       (state._completionsApplied, last 200). An event is applied at most once;
       because dedup is per-EVENT (not a single high-water clock), a malformed or
       far-future `completedAt` can NOT poison the channel, and a backdated /
       offline-queued completion still applies (P2). Timestamps compare via
       Date.parse epoch millis, never lexicographically. The legacy string
       `_completionsHwm` (pre-fix) is migrated tolerantly to an epoch FLOOR
       clamped to now (so a poisoned far-future value can't permanently gate).
     • completability (P3-2): the write is gated on the SAME
       ACTION_COMPLETABLE_KINDS the UI uses — kind is looked up from the freshly
       built items by id. A requirement-deadline id writes through to its row;
       another completable kind lands in state.action_done; a commitment-end /
       inflow / outflow (or an id not currently built) is LOG-SKIPPED, never
       suppressing its feed item.
     • ABSENT FILE → exact no-op. The app behaves identically to today when the
       Shortcut hasn't been upgraded to write it.
   Returns true iff something to persist changed (a completion applied, or the
   applied-ledger grew) so the caller persists + pushes and the feed tombstones
   the item exactly as a local completion does. */
async function applyRemoteCompletions(state, files) {
  if (!state || !files || typeof files !== 'object') return false;
  const f = files[REVERSE_COMPLETIONS_FILENAME];
  if (!f) return false;                                   // absent → no-op
  let content = f.content || '';
  if (f.truncated && f.raw_url) {                         // large file → fetch raw
    try { content = await (await fetch(f.raw_url)).text(); }
    catch (e) { logError(ErrCode.SYNC_PULL, e, 'applyRemoteCompletions: raw fetch'); return false; }
  }
  if (!content || !content.trim()) return false;
  let parsed;
  try { parsed = JSON.parse(content); }
  catch (e) { logError(ErrCode.PARSE, e, 'applyRemoteCompletions'); return false; }
  const list = Array.isArray(parsed) ? parsed
             : (parsed && Array.isArray(parsed.completions) ? parsed.completions : null);
  if (!list) return false;

  if (!state.action_done || typeof state.action_done !== 'object' || Array.isArray(state.action_done)) state.action_done = {};
  // Migrate away the legacy high-water string (pre-fix). It's simply DROPPED — a
  // single lexicographic clock is exactly the poisoning/backdating vector this
  // rewrite removes, and it can't be safely re-interpreted as an epoch floor (a
  // poisoned far-future value clamped to now would dead-channel every past
  // completion). Dedup is per-event via the ledger + the domain presence checks
  // below, so dropping it is safe (the feature is unshipped, so no real state
  // carries it yet anyway). Tolerant: presence is ignored, never trusted.
  if (typeof state._completionsHwm !== 'undefined') delete state._completionsHwm;
  let ledger = Array.isArray(state._completionsApplied) ? state._completionsApplied.slice() : [];
  const ledgerSet = new Set(ledger);
  const before = ledger.length;
  const ledgerAdd = (key) => { if (!ledgerSet.has(key)) { ledger.push(key); ledgerSet.add(key); } };
  // Kind by id from the freshly built items (includes done items, annotated) so
  // completability can be checked and requirement ids routed to write-through.
  const kindById = new Map(buildReminderItems(state).map(it => [it.id, it.kind]));

  let applied = 0, skippedBad = 0, skippedNonCompletable = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' ? entry.id : '';
    const at = typeof entry.completedAt === 'string' ? entry.completedAt : '';
    if (!id || !at) continue;
    const epoch = Date.parse(at);
    if (!Number.isFinite(epoch)) { skippedBad++; continue; }   // unparseable → skip + count
    const key = id + '@' + epoch;
    if (ledgerSet.has(key)) continue;           // this exact event already applied
    const doneISO = /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : isoDate(new Date(epoch));
    const kind = kindById.get(id);
    if (kind === 'requirement-deadline') {
      const m = /^yv-offer-(.+)-req-(.+)$/.exec(id);
      const o = m ? (state.offers || []).find(x => x && x.id === m[1]) : null;
      const row = (o && Array.isArray(o.requirements)) ? o.requirements.find(r => r && r.id === m[2]) : null;
      if (row) { if (!row.done) { row.done = true; row.done_date = doneISO; applied++; } ledgerAdd(key); }
      // unknown row → skip (no ledger; may become valid on a later pull)
    } else if (kind && ACTION_COMPLETABLE_KINDS.has(kind)) {
      if (!Object.prototype.hasOwnProperty.call(state.action_done, id)) { state.action_done[id] = doneISO; applied++; }
      ledgerAdd(key);
    } else {
      // commitment-end / inflow / outflow, or an id not currently built → the
      // feed item must NOT be suppressed. Log-skip; do NOT ledger (a not-yet-
      // built id can legitimately become completable on a later pull).
      skippedNonCompletable++;
    }
  }
  if (ledger.length > 200) ledger = ledger.slice(ledger.length - 200);   // bound the ledger
  state._completionsApplied = ledger;
  // Diagnostic NOTE (not an error): skipped entries are expected (a phone may
  // tick a non-action reminder, or a timestamp may be malformed) and must not
  // pollute the app's error diagnostics — console.warn keeps it dev-visible only.
  if (skippedBad || skippedNonCompletable) {
    console.warn('[reverse-channel] skipped ' + skippedBad + ' unparseable + ' + skippedNonCompletable + ' non-completable/unknown completedAt entries');
  }
  return applied > 0 || ledger.length !== before;
}

function relativeTimeShort(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 10000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function renderSyncIndicator() {
  const rel = Sync.lastSyncAt ? relativeTimeShort(Sync.lastSyncAt) : '';
  const labels = {
    synced: rel ? `Synced ${rel}` : 'Synced',
    syncing: 'Syncing…',
    pending: 'Pending',
    error: 'Sync error',
    unconfigured: 'Not synced'
  };
  const title = Sync.lastError
    ? `Error: ${Sync.lastError}. Click to fix.`
    : (Sync.status === 'synced' && Sync.lastSyncAt
      ? `Last synced ${new Date(Sync.lastSyncAt).toLocaleTimeString()}. Click for sync settings.`
      : `Click for sync settings.`);
  return `
    <button class="sync-indicator" data-status="${Sync.status}" data-action="open-sync" title="${escapeAttr(title)}">
      <span class="sync-dot"></span>
      <span class="sync-text">${labels[Sync.status] || 'Sync'}</span>
    </button>
  `;
}

function updateSyncIndicator() {
  // Patch in place to avoid full re-render
  const old = document.querySelector('.sync-indicator');
  if (!old) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = renderSyncIndicator();
  const next = wrap.firstElementChild;
  old.replaceWith(next);
}

/* ============================================================
   PWA: runtime-generated icon + manifest, no external assets
   ============================================================ */
function setupPwa() {
  // Yield Vector home-screen icon — pixel-identical (modulo raster vs.
  // vector) to the inline SVG brand mark in renderHeader(). The header
  // SVG is a 22×22 viewBox; this canvas is 180×180. Every coordinate
  // below is the header coord × (180/22) ≈ 8.18181818, so the icon
  // and the header read as the same mark at two scales.
  //
  // Header reference (LOCKED — keep in sync if either is edited):
  //   - rect 22×22, rx=6
  //   - chip gradient (BL→TR, x1=0 y1=22 x2=22 y2=0):
  //       0%   #1e1b4b     45%  #4338ca
  //       80%  #7c3aed    100%  #b69cff
  //   - shimmer (x1=0 y1=0 x2=14 y2=14):
  //       0%   rgba(255,255,255,0.18)
  //       100% rgba(255,255,255,0)
  //   - arrow shaft:  M 5.5 16.5 Q 9 12 16 6.5    stroke=#fff w=2 round
  //   - arrowhead:    M 10.8 7.2 L 16.5 6 L 15.3 12  same stroke
  const c = document.createElement('canvas');
  c.width = 180; c.height = 180;
  const ctx = c.getContext('2d');
  const W = 180;
  const S = W / 22;            // header→canvas scale
  const R = 6 * S;             // 49.09 — corner radius

  // Round-corner clip (rx=6 in header, rx=49 here)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(R, 0);
  ctx.lineTo(W - R, 0);
  ctx.quadraticCurveTo(W, 0, W, R);
  ctx.lineTo(W, W - R);
  ctx.quadraticCurveTo(W, W, W - R, W);
  ctx.lineTo(R, W);
  ctx.quadraticCurveTo(0, W, 0, W - R);
  ctx.lineTo(0, R);
  ctx.quadraticCurveTo(0, 0, R, 0);
  ctx.closePath();
  ctx.clip();

  // Chip gradient: corner-to-corner, bottom-left → top-right
  const grad = ctx.createLinearGradient(0, W, W, 0);
  grad.addColorStop(0.00, '#1e1b4b');
  grad.addColorStop(0.45, '#4338ca');
  grad.addColorStop(0.80, '#7c3aed');
  grad.addColorStop(1.00, '#b69cff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, W);

  // Upper-left shimmer overlay — same stops/extent as the header SVG
  const shimmer = ctx.createLinearGradient(0, 0, 14 * S, 14 * S);
  shimmer.addColorStop(0, 'rgba(255,255,255,0.18)');
  shimmer.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shimmer;
  ctx.fillRect(0, 0, W, W);

  // White arrow — same Bezier shaft + chevron arrowhead as the header.
  // Stroke width 2 in header → 2 × S ≈ 16.36 here.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2 * S;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Shaft: M 5.5 16.5 Q 9 12 16 6.5
  ctx.beginPath();
  ctx.moveTo(5.5 * S, 16.5 * S);
  ctx.quadraticCurveTo(9 * S, 12 * S, 16 * S, 6.5 * S);
  ctx.stroke();
  // Arrowhead: M 10.8 7.2 L 16.5 6 L 15.3 12
  ctx.beginPath();
  ctx.moveTo(10.8 * S, 7.2 * S);
  ctx.lineTo(16.5 * S, 6 * S);
  ctx.lineTo(15.3 * S, 12 * S);
  ctx.stroke();

  ctx.restore();

  const dataUrl = c.toDataURL('image/png');
  const apple = document.getElementById('apple-icon');
  const fav = document.getElementById('favicon');
  if (apple) apple.href = dataUrl;
  if (fav) fav.href = dataUrl;
  // Sync the <meta name="theme-color"> too — it controls the iOS Safari
  // status-bar tint and the Android task-switcher header. Pick a color
  // pulled from the chip's mid-gradient so the OS chrome harmonizes
  // with the icon rather than being the old standalone accent.
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', '#4338ca');
  // Web App Manifest (Android/Chrome)
  const manifest = {
    name: 'Yield Vector',
    short_name: 'Yield Vector',
    display: 'standalone',
    start_url: location.pathname,
    scope: location.pathname,
    background_color: '#f5f5f7',
    theme_color: '#4338ca',
    icons: [
      { src: dataUrl, sizes: '180x180', type: 'image/png', purpose: 'any maskable' }
    ]
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
  const m = document.getElementById('manifest');
  if (m) m.href = URL.createObjectURL(blob);
}

export { SYNC_CONFIG_KEY, SYNC_FILENAME, REVERSE_COMPLETIONS_FILENAME, Sync, revisionOf, parseGistState, ghGet, ghFetch, applyRemoteCompletions, relativeTimeShort, renderSyncIndicator, updateSyncIndicator, setupPwa };
