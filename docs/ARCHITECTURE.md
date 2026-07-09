# Yield Vector — Architecture reference

> **Status / fold-in note:** This file is the durable module-split reference produced by
> run `2026-07-08-module-split-efficiency` (step 5). It is a **standalone doc for now
> because `AGENTS.md` is currently owner-dirty (uncommitted edits) and must not be
> touched.** Once the owner commits his pending `AGENTS.md` changes, fold this content
> into `AGENTS.md` (the canonical technical reference) and reduce this file to a pointer,
> or delete it. Until then, read this alongside `AGENTS.md`.

**As of:** `APP_VERSION 2026.07.09a`. The app is a single-page PWA served from GitHub
Pages (`https://CMR2334.github.io/yield-vector/`) with **zero build step** — native ES
modules loaded via a `<head>` import map. CSS stays inline in `index.html` `<style>`
(design decision — no build, no second request, freshness tied to one payload).

---

## 1. Module map (17 `js/` modules + inline bootstrap)

Each module is `js/<name>.js`, byte-preserving-extracted from the former single-file
`index.html` inline `<script>`. Class: **PURE** (Node-importable, no DOM), **DOM**, or
**MIXED**.

| # | Module | Class | Domain | Key exports |
|---|--------|-------|--------|-------------|
| 1 | `runtime-status.js` | MIXED | Build/storage consts, diagnostics, error handlers, status model, DD/debit migrations | `APP_VERSION`, `STORAGE_KEY`, `ErrCode`, `logError`, `installErrorHandlers`, `storageHealth`, `STATUS_LABELS`, `SUB_STATUS_*`, `migrateDdIds` |
| 2 | `requirements-templates.js` | PURE | schema-v2 `requirements[]`, derived-row derivation, offer-label composition | `REQUIREMENT_TYPES`, `makeRequirementRow`, `requirementDeadlineISO`, `offerDisplayLabel`, `displayOfferName` |
| 3 | `migrations-catalogs.js` | MIXED | v2 migration/restore, offer color/category/source catalogs | `migrateOffersToSchemaV2`, `restorePreV2Backup`, `OFFER_COLOR_PALETTE`, `offerColorHex` |
| 4 | `sync-pwa.js` | DOM | Gist sync, reverse-completion channel, sync indicator, runtime PWA setup | `Sync`, `SYNC_CONFIG_KEY`, `parseGistState`, `renderSyncIndicator`, `setupPwa` |
| 5 | `date-format-core.js` | PURE | date math, holiday/business-day, event expansion, display↔storage format, money fmt, `uid` | `TODAY`, `parseDate`, `isoDate`, `addBusinessDays`, `daysBetween`, `_isoFromYMD`, `uid` |
| 6 | `dd-widgets.js` | DOM | DD transfer timing/effective dates, `DatePicker`, `DDMethods` loader | `ddTransferConfig`, `ddRoundTrip`, `directDepositEffectiveDate`, `DatePicker`, `DDMethods` |
| 7 | `app-state.js` | MIXED | `App` singleton: load/save/update/init, projection-date rollover | `App` |
| 8 | `offer-model.js` | PURE | derived dates, lifecycle, churnability, returns, completeness/eligibility | `depositDeadline`, `withdrawalEligibleDate`, `lifecycleStage`, `churnEligibleDate`, `churnSnoozeActive` |
| 9 | `projection-optimizer.js` | MIXED | projection engine, summary, offer→commitment, brute-force optimizer | `generateProjection`, `summarizeProjection`, `convertOfferToCommitment`, `runOptimizer` |
| 10 | `render-shell-overview.js` | DOM | render shell, header/nav, overview hero + churn section, stat cards, error panel | `render`, `renderShell`, `renderOverview`, `renderOverviewChurnSection`, `renderErrorState` |
| 11 | `reminders.js` | MIXED | reminder-feed builder, feed/tombstone envelope, upcoming-actions rows/pager | `computeReminderFeed`, `computeUpcomingActions`, `ACTION_COMPLETABLE_KINDS`, `ACTION_DONE_LINGER_DAYS`, `seedManifestHwm` |
| 12 | `render-main-views.js` | DOM | planner, cards, timeline, offers, settings, diagnostics, tables, charts | `renderPlanner`, `renderComboCard`, `renderRequirementChecklist`, `renderPipelineStrip` |
| 13 | `doc-parser.js` | MIXED* | deterministic DoC paste/HTML parser + tier/churn extraction | `parseDocPost`, `docNormalizeInput`, `docDateSegments`, `docExtractGlanceRows` |
| 14 | `doc-import-templates.js` | DOM | DoC preview/apply UI, Worker import, parser test hooks, template picker/list | `docImportParse`, `docImportApply`, `renderDocPreview`, `renderTemplatePicker`, `useTemplate`, `testDocParser`, `testDocParserRegressions`, `DOC_TEST_EXPECT` |
| 15 | `modals-forms.js` | DOM | offer/commitment/event/sync-history modals, form readers, DD/req rows | `showOfferModal`, `closeModal`, `renderRequirementRows`, `readUserReqsFromForm` |
| 16 | `ui-utils.js` | DOM | leaf util, imported widely | `escapeHtml`, `escapeAttr`, `toast` |
| 17 | `events-actions-data.js` | DOM | global event delegation, `onClick`/`onChange`/`onInput` switches, all action handlers, import/export, seed | `bindGlobalEvents`, `onClick`, `onChange`, `onInput`, `saveOfferFromForm`, `deleteOffer`, `toggleActionDone` |
| — | `index.html` inline `<script type="module">` | DOM | bootstrap (see §3) | — |

\* `doc-parser.js` is pure at module-eval time; its only DOM touch is `new DOMParser()`
**inside function bodies**, so Node imports it with a `globalThis.DOMParser` shim (§4).

---

## 2. Import-graph shape (leaves vs SCC)

- **Leaves (no app-internal callers of still-inline names):** `date-format-core.js`,
  `ui-utils.js` (the two most-imported sinks — extract/keep first), then
  `runtime-status.js`, `requirements-templates.js`, `doc-parser.js`.
- **DOM/state strongly-connected component (SCC) — 12 modules** (`migrations-catalogs`,
  `sync-pwa`, `dd-widgets`, `app-state`, `offer-model`, `projection-optimizer`,
  `reminders`, `render-shell-overview`, `render-main-views`, `doc-import-templates`,
  `modals-forms`, `events-actions-data`): mutually referential. **Every cyclic reference
  is dereferenced at call time** (inside function bodies — `App.init`, handlers,
  `DDMethods.load`), never at module-evaluation time, so ES **live bindings** resolve the
  cycles correctly. Module top levels are pure declarations; all side-effect calls live in
  the bootstrap.
- **One sanctioned cross-module setter:** `_manifestHwm` (a `reminders.js` binding) is
  reassigned by `App.init` in `app-state.js`; because imported bindings are read-only,
  `reminders.js` exports **`seedManifestHwm(v)`** and `app-state.js` calls it. This is the
  *only* whole-binding cross-module reassignment (verified by a top-level `let`/`var`
  sweep). Any new one must add its own declared setter — never a silent workaround.

---

## 3. Entry bootstrap (`index.html` inline `<script type="module">`)

In load order, the bootstrap:
1. **Named imports** (6) consumed directly: `parseDocPost`, `App`, `Sync`, `render`,
   `showOfferModal`, `testDocParser`/`testDocParserRegressions`.
2. **Side-effect imports** (11) rooting the rest of the 17-module graph directly from the
   HTML entry, so the SW precache + offline module set stay in lockstep with the import
   map (not merely transitive).
3. **Console/harness exposure** (not dispatch — dispatch is delegation-based):
   `window.App`, `window.Sync`, `window.YieldVector = { App, Sync, parseDocPost,
   testDocParser, testDocParserRegressions, render }`, plus **bare** `window.testDocParser`
   / `window.testDocParserRegressions` (documented DevTools workflow).
4. `App.init()` on `DOMContentLoaded`; the FAB (`#fab-add`) click listener → `showOfferModal()`.
5. **Service-worker registration** + `controllerchange` reload policy (§4).

Dispatch needs **no `window` exposure**: all 111 `data-action`/`data-view` routes go
through JS-internal `onClick`/`onChange`/`onInput` switches that call handlers by lexical
reference. Import specifiers are **relative** (`./js/x.js`) — this is a GitHub *project*
page; absolute `/js/` would resolve to the domain root and 404.

---

## 4. Versioning + service-worker update/convergence flow

**Cache-busting (zero build):** the `<head>` import map maps each module specifier to
`./js/<name>.js?v=<APP_VERSION>`. Regenerating the inline HTML per release is the
zero-build way to version *all* module URLs at once (static sub-imports in `.js` files
can't carry `?v` without a build). Sibling `import './x.js'` specifiers resolve via the
import map's absolute-URL match, so each module is fetched once at the versioned URL.

**Service worker (`sw.js`, Path B — minimal, dependency-free, network-first):**
- **Precache** `yv-precache-<APP_VERSION>` = app shell (`./`, `./index.html`) + all 17
  `?v=<APP_VERSION>` module URLs; `install` → `addAll` + `skipWaiting`.
- **`activate`** deletes only **`yv-precache-*` caches ≠ current** (prefix-scoped —
  `CacheStorage` is origin-wide on `cmr2334.github.io`, so unrelated/future project-page
  caches are left untouched), then `clients.claim()`.
- **Same-origin GET → network-first** (always-fresh HTML/JS), cache fallback only when
  offline; successful responses refresh the cache opportunistically.
- **Passthrough (early-return, never cached):** any cross-origin request (Gist at
  `api.github.com`, the DoC-import Cloudflare Worker) and any non-GET. A stale cached
  cloud state is the "erroneous deletion" fear made real — cloud calls always hit the network.
- **`controllerchange` → reload, guarded** (index.html bootstrap): skip the first-install
  reload (page already fresh); on a real update reload immediately **unless a modal is
  open**, in which case defer via a `MutationObserver` on `#modal-root`'s class so unsaved
  form edits survive (state persists only on explicit save); a once-flag prevents reload loops.

**Deploy transition (validated live):** bumping the three literals byte-changes `sw.js` →
the browser's SW update check installs the new worker → `activate` evicts the old
`yv-precache-*` → `clients.claim` → `controllerchange` → guarded reload → the page
converges to the `?v=<new>` module set. A client still on the old HTML keeps requesting the
old `?v=` set until it reloads; **new HTML never runs old modules and vice-versa.**

---

## 5. Verification harness integration (`docs/fixtures/doc-corpus/harness/`)

Since the P1 split the harness sources the **real module files** (no more brace-matching
`index.html`). Requires jsdom for the run: `npm i --no-save jsdom` (or repo-root
`node_modules/jsdom`). The DoC post bodies are **not committed** (copyright) — corpus
scoring needs a local `posts/` dir or `$DOC_CORPUS_POSTS`; the pins/fidelity run without it.

- **`parser-loader.js`** — `buildParser()` reads `js/date-format-core.js` +
  `js/doc-parser.js`, strips their `import`/`export` lines, and `vm`-evals the bodies in a
  sandbox whose globals are jsdom's real `DOMParser` + `console` (synchronous — the parser
  wires exactly as the browser wires it). Public surface stays stable so `fidelity-check` /
  `score` / `dd-matrix` need no change.
- **`fidelity-check.js`** — runs the app's own `DOC_TEST_EXPECT` fixtures (01–07) through
  the loaded parser; **67 assertions must pass** (has a drift guard vs
  `doc-import-templates.js`'s live literal).
- **`regressions-check.js`** — brace-extracts `testDocParserRegressions` from
  `doc-import-templates.js` and runs it: **20 pins**.
- **`p2b-segmentation-pin.js`** — pins the "offer at a glance" segmentation (synthetic case
  always runs; real BofA id-01 only with a re-hydrated corpus).
- **`dd-matrix.js`** — 17 direct-deposit phrasing → boolean cases.
- In-browser equivalents: `testDocParser(rawText, fixtureKey)` and
  `testDocParserRegressions()` from the DevTools console (bare aliases exposed in bootstrap).

---

## 6. Release checklist

1. **Bump `APP_VERSION` in exactly THREE places** (they are coupled; a partial bump
   cache-busts wrong or leaves a mixed-version window):
   - `index.html` `<head>` import map — **all 17** `?v=<APP_VERSION>` literals.
   - `js/runtime-status.js` — the `APP_VERSION` string literal (the user-facing build id,
     shown in Settings → About + the error-panel foot).
   - `sw.js` — the `APP_VERSION` string literal (the cache name `CACHE_PREFIX + APP_VERSION`
     and every precache URL `./js/<m>.js?v=<APP_VERSION>` **derive** from it — verify the
     derivation, only the one literal changes).
   Format: `YYYY.MM.DD` + a letter for same-day rebuilds (e.g. `2026.07.09a`). **Sweep:**
   `grep -rn "<old-version>" index.html js/ sw.js` must return **zero** (docs/fixtures don't count).
2. **Full battery** (all must stay green): `node --check` all 17 modules + the inline entry
   module + `sw.js`; fidelity **67/67**; regression pins **20/20**; p2b synthetic PASS; DD
   matrix PASS; corpus ≥ 84.9% (or byte-identity reasoning when posts are unavailable); feed
   byte-identity on the fixed seed; preview E2E (5 views, 380px) incl. the **live SW
   version-transition** on the preview origin; zero console errors.
3. **Worker deploys (owner, when the DoC-import Worker changes):** `npx wrangler deploy`
   from `cloudflare/`. **Gotcha (documented in `cloudflare/README`):** `wrangler.jsonc` is
   gitignored and must carry every **non-secret** var (notably `ALLOWED_ORIGIN`) —
   dashboard-set vars are **dropped** on deploy (the Worker fails closed → URL import dies).
   A fresh checkout must mirror the vars before deploying. Secrets are unaffected by deploys.
4. **Tag on owner confirmation only:** create the `stable-YYYY-MM-DD` git tag once the owner
   confirms the release on his phone (per `AGENTS.md` protocol) — not automatically at release.
5. **Push** `main` from the main repo path (Pages serves `main`); the live URL rebuilds
   ~30–90 s after push. From a Claude Code worktree, `cd` to the main repo path first.
