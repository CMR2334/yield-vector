# Yield Vector — module-split + efficiency design

**Date:** 2026-07-08
**Baseline:** `index.html` @ HEAD `447c57f`, `APP_VERSION 2026.07.08e`, 14,993 lines.
**Scope:** Split the single-file inline `<script>` into native ES modules (same
repo, same GitHub Pages URL, **zero build step**) and stage a ratcheted
efficiency-consolidation backlog. This document is the **contract** for the
split/consolidation phases (run `2026-07-08-module-split-efficiency`, steps 3–5):
precise enough that phase executors need no re-analysis.

**Prime directive (owner):** NOTHING LOST — no feature, behavior, formatting, or
aesthetic regression. "Erroneous deletion" is the named fear. Every line of JS is
accounted for in the coverage ledger (§3); every removal is gated by the deletion
ratchet (§10).

> **Line numbers are point-in-time** (v2026.07.08e). They are provenance anchors,
> not the split's source of truth — phase executors re-locate by symbol name
> (the whole-file skeleton is stable) and move byte-preserving. Any commit landing
> before the split shifts these; re-derive with a `grep -nE '^(async function|function|const|let|var|class) '` skeleton pass.

---

## 0. How this was produced (Codex token-offload)

Four `codex exec --sandbox read-only` analyses read the 15k-line file (the heavy
reading was offloaded to Codex/OpenAI credits, per owner directive); Claude
verified samples and synthesized this doc. Raw analyses live in the run
scratchpad: `audit-boundaries.md`, `audit-dead.md`, `audit-dupes.md`,
`audit-css.md`.

**Verification grades (Claude spot-check, ~17 claims sampled, 0 wrong):**

| Analysis | Sampled | Result | Grade |
|---|---|---|---|
| Boundaries | coverage endpoints, `useTemplate↔showOfferModal↔renderTemplatePicker` cycle, 2 inline `onchange` @12374/12377, window globals | all correct; caught 2 `onchange` Claude's own survey missed | A |
| Dead-code | `STATUSES`/`STATUS_CHIP_CLASS`/`formatCurrencyDecimal` (0 external refs), `summarizeProjection` call-sites 6707/7721/14066 | all correct; unusually conservative (6 HIGH, all narrow) | A |
| Dupes | clusters 1/5/6/11 at cited lines; schema-v2 exclusion honored (0 derive/sync mentions) | all correct; semantic differences flagged | A |
| CSS | `.btn-lg`/`.sr-only`/`grid-cols-*` orphans; `.chip-offer-type-` dynamic caveat | all correct; sophisticated dynamic-class reasoning | A |

No analysis required a re-run.

---

## 0b. Plan-gate amendments (2026-07-08) — structural corrections

An adversarial plan-gate review confirmed every **factual** claim in this doc but
found structural errors in the phase plan; this revision folds the fixes.
Load-bearing corrections:

### The extraction invariant (why the phase order in §6 is what it is)
Once `index.html`'s script becomes `<script type="module">`, **an extracted
external module cannot import a name that is still inline** — you cannot import
from the HTML entry module.

> **A set of modules S is extractable in a phase iff no member of S references any
> name that remains inline after that phase.** (inline→extracted and
> extracted→extracted imports are fine — the inline entry module CAN import from
> extracted files. Only extracted→inline is impossible.)

Leaves satisfy this. **No single member of the DOM/state strongly-connected
component (SCC) does** — it references sibling SCC members that would still be
inline — so the SCC must move in **one atomic phase** (§6). This replaces the
original P4–P8 incremental order, which had no valid topological sequence.

### Sanctioned CHANGE-class edits inside the MOVE-ONLY split
ES imported bindings are **read-only** (reassigning one is a parse-time
SyntaxError), so the split needs a small, *declared* set of setter edits. A scan
of all five top-level `let`/`var` (`grep -nE '^(let|var) '`) for cross-module
reassignment:

| Binding | Decl → module | Reassigned at | Cross-module? | Action |
|---|---|---|---|---|
| `_manifestHwm` | 7453 → `reminders.js` | 5461 (`App.init` → **app-state.js**); 7497 (same module) | **YES** | **`reminders.js` exports `seedManifestHwm(v)`; `app-state.js` `App.init` calls `seedManifestHwm(…)` instead of `_manifestHwm = …`** |
| `_docLastParse` | 11480 → `doc-import-templates.js` | 11528/11546/11549/11694/11778 | no (all same module) | none |
| `_docTierSel` | 11487 → `doc-import-templates.js` | 11466/11523/11695/11779 | no (same module) | none |
| `_docUserChecks` | 11494 → `doc-import-templates.js` | 11524/11696/11780 | no (same module) | none |
| `toastTimer` | 13864 → `ui-utils.js` | 13871 (`toast()`, same module) | no | none |

**The sanctioned-setter list is exactly one item: `seedManifestHwm(v)`.** No other
top-level binding is reassigned across a module boundary. (Mutating *properties* of
an imported `const` object — `App.state = …`, `_holidayCache[k] = …` — is allowed
and needs no setter; only whole-binding reassignment breaks.) The setter lands in
the atomic SCC phase (both `_manifestHwm` and its cross-module writer are SCC
members). Any *new* cross-module `let`/`var` reassignment introduced later must add
its own declared setter — never a silent workaround.

---

## 1. PWA / service-worker reality (INVESTIGATED, not assumed)

**There is no service worker and no on-disk cache manifest.** Grep for
`serviceWorker`/`navigator.serviceWorker`/`caches.`/`sw.js`/`workbox` = 0 hits;
no `sw.js`/`*.webmanifest` on disk. The web-app manifest and icon are
**runtime-generated** (`setupPwa()` builds a manifest object, Blobs it, and sets
`<link id="manifest">.href` at runtime — index.html:4739-4752; placeholder link
at :17). The many `manifestVersion` references (`computeReminderFeed` etc.) are
the **reminder-feed monotonic counter — a different concept**, not a PWA cache
list. This corrects the run-checkpoint's step-3 assumption of "an existing
service-worker/PWA cache list to update": there is none.

### Offline-capability implication (the #1 PWA risk of this split)
Today the app is offline-capable **by being one self-contained file**: load it
once and the browser cache serves the whole app (atomic — one object). Splitting
into ~18 files means offline boot now needs **all** module files present in the
browser HTTP cache (non-atomic — a partially-evicted cache = broken offline
boot). There is no SW to guarantee this. "Offline-capable" is a hard project
constraint, so this is a real regression risk, not a nit.

**Decision point (needs owner/planner sign-off — two viable paths):**

- **Path A (default — zero new caching surface):** ship no service worker; rely
  on browser HTTP cache exactly as today, but make the **offline-reload gate a
  HARD blocker** at every split phase (§6 gate battery already lists it). Serve
  modules with `./js/` relative paths so Pages caches them under the app scope.
  Pro: preserves the app's current always-fresh-on-network behavior; no
  cache-invalidation trap. Con: N-file cache is non-atomic.
- **Path B (only if Path A's offline gate regresses):** add a minimal,
  dependency-free service worker. Spec — all points are hard requirements (a SW is
  exactly the stale-content bug class the single-file design avoided, so it must be
  precise):
  - **Navigation requests network-first** (preserves always-fresh HTML), falling
    back to cached `index.html` only when offline.
  - **Static assets (`index.html`, `js/*.js`, extracted CSS if any) cache-first**
    under a precache **named from `APP_VERSION`** (e.g. `yv-precache-2026.07.09a`);
    `activate` deletes every cache whose name ≠ the current one; `skipWaiting` +
    `clients.claim`.
  - **Consistent versioned asset set (no mixed-version window):** the HTML carries
    an **import map keyed to `APP_VERSION`** mapping each module specifier to
    `./js/<name>.js?v=<APP_VERSION>`. The inline HTML is regenerated per release,
    so this is the zero-build way to version *all* module URLs at once (static
    sub-imports inside `.js` files can't carry `?v` without a build). Deploy
    transition: v2 HTML's import map requests the `?v=v2` set → the v2 precache; a
    client still on v1 HTML keeps requesting `?v=v1`; **v2 HTML never runs v1
    modules and vice-versa.** (Versioned module URLs also sharpen Path-A
    cache-busting.)
  - **Passthrough — never cache dynamic/cross-origin:** the `fetch` handler
    **early-returns (no `respondWith`) for any cross-origin request, specifically
    `api.github.com` (Gist read/write) and the DoC-import Worker origin.** A cached
    stale cloud state is the erroneous-deletion fear made real — Gist/Worker calls
    must always hit the network. Only same-origin GET (navigation + static assets)
    is cached.
  - **iOS / update story:** on `navigator.serviceWorker` `controllerchange`, call
    `location.reload()` once (guarded against reload loops) — or show an
    "update ready" nudge tied to the existing `APP_VERSION` display — so a
    mid-session SW activation never leaves the page running v1 modules under a v2
    controller (iOS standalone PWAs are the sensitive case).
  - Con: introduces cache-busting discipline the repo has deliberately avoided —
    ship only if Path A's offline gate actually fails.

Recommendation: **start Path A**; pre-write Path B's SW so it can drop in the
moment the offline gate fails, without blocking the split. Do NOT add a SW
speculatively (it adds the exact stale-content class of bug the single-file
design avoided).

---

## 2. Final module map (17 `js/` modules + inline bootstrap)

Target: `<script type="module" src="./js/…">`-style imports from a tiny inline
bootstrap. Class = PURE-LOGIC (Node-importable, no DOM), DOM-COUPLED, or MIXED.
Ranges are contiguous and exhaustive (see §3 ledger).

| # | File | Source ranges | Responsibility | Class |
|---|---|---|---|---|
| 1 | `js/runtime-status.js` | 2827-2924, 2926-3090 | Build/storage consts, diagnostics, error handlers, status model, DD/debit migrations | MIXED |
| 2 | `js/requirements-templates.js` | 3091-3564 | schema-v2 `requirements[]`, derived-row derivation, template strip/hydrate | PURE |
| 3 | `js/migrations-catalogs.js` | 3565-3804 | v2 migration/restore, offer-color/category/source catalogs | MIXED |
| 4 | `js/sync-pwa.js` | 3805-4755 | Gist sync, reverse-completion channel, sync indicator, runtime PWA setup | DOM |
| 5 | `js/date-format-core.js` | 2925, 4756-4932, 5215-5406 | date math, holiday/business-day, event expansion, display↔storage format, money fmt, `uid` | PURE |
| 6 | `js/dd-widgets.js` | 4933-5214 | DD transfer timing/effective dates, `DatePicker`, `DDMethods` loader | DOM |
| 7 | `js/app-state.js` | 5407-5596 | `App` singleton: load/save/update/init, projection-date rollover | MIXED |
| 8 | `js/offer-model.js` | 5597-6121 | derived dates, lifecycle, churnability, returns, completeness/eligibility | PURE |
| 9 | `js/projection-optimizer.js` | 6122-6524 | projection engine, summary, offer→commitment, brute-force optimizer | MIXED |
| 10 | `js/render-shell-overview.js` | 6525-7001 | render shell, header/nav, overview hero + churn section, stat cards, error panel | DOM |
| 11 | `js/reminders.js` | 7002-7706 | reminder-feed builder, feed/tombstone envelope, upcoming-actions rows/pager | MIXED |
| 12 | `js/render-main-views.js` | 7707-9686 | planner, cards, timeline, offers, settings, diagnostics, tables, charts | DOM |
| 13 | `js/doc-parser.js` | 9687-10954 | deterministic DoC paste/HTML parser + tier/churn extraction | MIXED* |
| 14 | `js/doc-import-templates.js` | 10955-12120 | DoC preview/apply UI, Worker import, parser test hooks, template picker/list | DOM |
| 15 | `js/modals-forms.js` | 12121-13851 | offer/commitment/event/sync-history modals, form readers, DD/req rows | DOM |
| 16 | `js/ui-utils.js` | 13852-13873 | `escapeHtml`, `escapeAttr`, `toast` (leaf util, imported widely) | DOM |
| 17 | `js/events-actions-data.js` | 13874-14980 | global event delegation, `onClick`/`onChange`/`onInput` switches, all action handlers, import/export, seed | DOM |
| — | `index.html` inline `<script type="module">` | 14981-14990 | bootstrap: import modules, `window.App/Sync`, `App.init()`, FAB listener | DOM |

\* `doc-parser.js` is pure at module-eval time; its only DOM touch is
`new DOMParser()` **inside function bodies**, so Node can import it with a
`globalThis.DOMParser` shim (see §7 — this is what makes the harness cleaner).

**Optional sub-splits (only if the owner wants finer files — total stays ≤19):**
`render-main-views.js` (~1,980 lines, the largest) → `render-offers-cards.js` /
`render-settings-diag.js` / `render-charts.js`; `modals-forms.js` (~1,730) →
`offer-modal.js` / `aux-modals.js` / `form-readers.js`. Defer; the 17-map is the
baseline and keeps phase count manageable.

**Leaf/util note:** `ui-utils.js` (16) and `date-format-core.js` (5) are the
most-imported leaves — extract them **first** so later phases can import a stable
target. `escapeHtml`/`escapeAttr` are referenced by nearly every render fn.

---

## 3. Coverage ledger (the anti-erroneous-deletion property)

Script body = **2827-14990** (`<script>` 2826, `</script>` 14991). Every JS line
lands in exactly one destination — **contiguous, no gaps, no overlaps**:

```
2827-2924  runtime-status     |  6525-7001  render-shell-overview
2925       date-format-core   |  7002-7706  reminders
2926-3090  runtime-status     |  7707-9686  render-main-views
3091-3564  requirements-templates | 9687-10954 doc-parser
3565-3804  migrations-catalogs|  10955-12120 doc-import-templates
3805-4755  sync-pwa           |  12121-13851 modals-forms
4756-4932  date-format-core   |  13852-13873 ui-utils
4933-5214  dd-widgets         |  13874-14980 events-actions-data
5215-5406  date-format-core   |  14981-14990 inline bootstrap (stays in index.html)
5407-5596  app-state          |
5597-6121  offer-model        |
6122-6524  projection-optimizer
```

Only intentional discontiguity: line **2925** (`TODAY`) is pulled into
`date-format-core.js` (it is computed with `startOfDay()`) to avoid a
`runtime-status ↔ date-format-core` eval cycle. **Verification gate for each
split phase:** after moving a module, `sort`+diff the moved line-set against the
byte range in this ledger — the moved bytes must equal the source bytes (only
added `import`/`export` lines differ). This ledger is the checklist that makes
"nothing dropped" mechanically checkable.

---

## 4. Dependency graph, cycles, and the MOVE-ONLY decision

Codex identified 5 reference cycles (evidence in `audit-boundaries.md §3`):

1. `app-state ↔ sync-pwa` — `App.init` calls `Sync.startupSync()`/writes
   `Sync.loadedModified` (5433-5470), `App.save`→`Sync.schedulePush()`
   (5571-5576); `Sync` reads/writes `App.state` (3858-3860, 3905-3908).
2. `app-state → render-shell-overview → render-main-views → events-actions-data → app-state`
   — the render/action loop (`App.init`→`render()`+`bindGlobalEvents()`;
   handlers call back into `App`/`render()`).
3. `doc-import-templates ↔ modals-forms` — `useTemplate`→`showOfferModal`
   (12095); `showOfferModal`→`renderTemplatePicker` (12190). **Verified.**
4. `migrations-catalogs` — `restorePreV2Backup` reaches `App`/`Sync`/`render`/
   `location.reload` (3643-3677) while `migrateOffersToSchemaV2` is pure-ish.
5. `dd-widgets` — `ddTransferConfig` reads `App.state`; `DDMethods.load` calls
   `render()`.

**Decision (refines Codex's recommendation):** Codex proposed breaking the cycles
with coordinator/setter dependency-injection *before* the split. That is
**CHANGE-class work and conflicts with the run's MOVE-ONLY-first mandate.** For a
**browser ES-module target these cycles are safe as-is**: every cyclic reference
is dereferenced at **call time** (inside function bodies — `App.init`,
`App.save`, handlers, `DDMethods.load`), never at module-evaluation time. ES
module **live bindings** resolve call-time cycles correctly. The only failure
mode — a module reading a cyclic import at top-level (TDZ) — does not occur here
because every module's top level is pure declarations; all bootstrap calls
(`App.init`, `bindGlobalEvents`, `installErrorHandlers`) live in the 14981-14990
span and run **after** all imports resolve.

**Therefore, for RUNTIME correctness:** the MOVE-ONLY split adds `import`/`export`
only and relies on live bindings for the cycles. **Do NOT refactor cycles during
the split.** The coordinator/setter refactors are logged as **optional CHANGE-class
items in the consolidation backlog (§9 Tier 3)**, to be done post-split, one commit
each, only if desired for readability. Pre-split task: confirm no top-level
statement in any module dereferences a cyclic import (audit the 14981-14990
bootstrap span; move all top-level side-effect calls there).

**But for the SPLIT PROCESS, the cycles force an atomic move.** Runtime-safe ≠
extractable-incrementally. Per the extraction invariant (§0b), no single cyclic
(SCC) member can be extracted alone — it would reference sibling SCC members still
inline, which an external module cannot import. So the entire SCC moves in one
atomic phase (§6 P2), still MOVE-ONLY plus the single sanctioned setter
`seedManifestHwm(v)` (§0b — needed because `_manifestHwm`, a `reminders.js`
binding, is reassigned by `App.init` in `app-state.js`, and imported bindings are
read-only).

---

## 5. Window / global export strategy (minimal — no HTML-dispatch coupling)

The split's biggest de-risking finding: **no application function needs `window`
exposure for HTML-attribute dispatch.**

- Inline `on*=` handlers are only: `onclick="location.reload()"` (6574),
  `onclick="event.stopPropagation();"` (8119), and two `onchange="document.getElementById(...).textContent=…"`
  (12374, 12377). **All use browser built-ins — zero app-function references.**
- All 111 `data-action` / `data-view` dispatch routes through **JS-internal
  delegation**: `onClick`/`onChange`/`onInput` (13972/14105/14190) `switch` on
  `dataset.action` and call ~60 handlers **by lexical reference**. In modules,
  `events-actions-data.js` simply `import`s every handler it dispatches to
  (mechanical, safe). Strings stay byte-identical.
- Only 2 real globals: `window._horizonDebug` (6182, console debug) and
  `window._searchTimer` (14202, debounce handle). Both are explicitly
  `window.`-qualified → keep as-is (zero-regression); `_searchTimer` may later
  become a module `let`.

**Bootstrap re-exposure (for console/harness/tests only, not dispatch):**
```js
window.App = App;               // console + existing debug ergonomics
window.Sync = Sync;
window.YieldVector = { App, Sync, parseDocPost, testDocParser,
                       testDocParserRegressions, render };
```
Converting the classic `<script>` to `<script type="module">` moves top-level
`const`s out of global scope — the above restores console access. **Critical
Pages note:** use **relative** import specifiers (`./js/x.js`). This is a GitHub
**project** page (`cmr2334.github.io/yield-vector/`); absolute `/js/x.js` would
resolve to the domain root and 404.

---

## 6. Migration order — corrected: context → leaves → atomic SCC → shell

Per the extraction invariant (§0b), **there is no valid module-by-module order for
the SCC** — its members reference each other, and an extracted module cannot import
a name still inline. So the plan is three macro-phases around one atomic SCC move,
not the eight incremental phases originally drafted (that draft was structurally
unbootable — e.g. extracting `app-state` while `render`/`bindGlobalEvents` stay
inline leaves `app-state` unable to import them).

**Gate battery (every phase boundary; a phase that can't go green is reverted):**
`testDocParser` 63/63 + 13 regression pins · corpus ≥ 84.9% via
`docs/fixtures/doc-corpus/harness` · feed byte-identity on the fixed seed ·
preview E2E **including offline reload** (Path-A blocker, §1) · 380px pass. The
atomic phase runs this **once, as one big gate.**

| Phase | Moves | Notes |
|---|---|---|
| **P0 — context** | Tag+push `checkpoint-2026-07-08-pre-modules`; convert the inline `<script>`→`<script type="module">`; add the bootstrap import block + APP_VERSION import map (§1); move every top-level side-effect call (`App.init`, `installErrorHandlers`, `bindGlobalEvents`, listener/`setInterval` registrations) into the 14981-14990 bootstrap span | App still runs as ONE module; no extraction yet. Gate: full battery (boots as a single module). |
| **P1 — leaves** (5 modules) | `date-format-core.js` + `ui-utils.js` (sinks), then `runtime-status.js`, `requirements-templates.js`, `doc-parser.js` | Verified extractable: none references a name that stays inline (grep = 0 `App.`/`Sync.`/`render(` in runtime-status, requirements-templates, doc-parser — the one hit was a comment). The still-inline entry module imports the leaf exports it uses. Sub-committable in the dependency order shown. **At the END of P1, convert all three harness extractors (§7).** Gate: full battery + extraction-identity (§7). |
| **P2 — atomic SCC** (12 modules) | `migrations-catalogs`, `sync-pwa`, `dd-widgets`, `app-state`, `offer-model`, `projection-optimizer`, `reminders`, `render-shell-overview`, `render-main-views`, `doc-import-templates`, `modals-forms`, `events-actions-data` — **moved together, one commit** | Move-only + the ONE sanctioned setter `seedManifestHwm(v)` (§0b). Runtime cycles resolve via ES live bindings (§4). `offer-model` and `migrations-catalogs` ARE SCC members (verified: `offer-model`→`ddRoundTrip`/`directDepositEffectiveDate` @5648/5991/6009 into `dd-widgets`; `restorePreV2Backup` @3643-3677 → `App`/`Sync`/`render`). Gate: full battery, one big pass. |
| **P3 — shell** | Finalize the inline bootstrap: imports of all modules, `window.App`/`Sync`/`YieldVector` exposure (§5), the FAB listener | Inline module is now just imports + boot. Gate: full battery incl. offline reload. Push at green. |

**Making the atomic P2 tractable (implementation aid, not a committed
intermediate):** extract the 12 modules one at a time on a local working branch,
temporarily scaffolding still-inline siblings via `window.*` so each step runs;
once all 12 are external and the scaffolding is removed, **squash to one move-only
commit**. The committed history never contains a half-extracted (broken) SCC state.
Each moved module is byte-preserving; only `import`/`export` lines and the one
setter differ.

---

## 7. Corpus-harness update — converts at P1 (not P3), all THREE extractors

The harness has **three** brace-match extractors that read functions out of
`index.html`, and each breaks the moment its target symbols leave the file:

- `harness/parser-loader.js` — `NEEDED[]` includes `_isoFromYMD` (→
  `date-format-core.js`) **and** `parseDocPost` + doc helpers (→ `doc-parser.js`).
  Both move in **P1** → the loader breaks in P1, not P3.
- `harness/regressions-check.js:11` — its own brace-match extractor (13 pins).
- `harness/p2b-segmentation-pin.js:14` — its own brace-match extractor
  (segmentation).

**Amendment: convert all three to ES-module imports at the END of P1**, when
`date-format-core.js` + `doc-parser.js` are external. `parseDocPost` calls
`new DOMParser()` **inside its body** (not at module top level), so Node import
succeeds with the global shim set before the first call:
```js
globalThis.DOMParser = new (require('jsdom').JSDOM)('').window.DOMParser;
const P = await import(require('url').pathToFileURL(path.join(REPO,'js/doc-parser.js')).href);
// P.parseDocPost(...) ; doc-parser's own `import {_isoFromYMD} from './date-format-core.js'` resolves transitively
```

**`_isoFromYMD` export surface (confirmed once):** declared @5357 in
`date-format-core.js`; consumed internally (`parseDateInput` @5348/5351) **and** by
the parser (`doc-parser.js` @9842/9851/9860). → `date-format-core.js` **exports
`_isoFromYMD`; `doc-parser.js` imports it** — the only cross-leaf edge in P1.

**Extraction-identity gate (must pass before P1 proceeds):** for each of the three
scripts, run its scorer **both ways on the same tree** — old brace-match extraction
vs new module import — and require **byte-identical outputs** (corpus score, the 13
pins, the segmentation pin). Only when old == new does the loader switch land; then
re-run the normal battery (corpus ≥ 84.9%, 63/63, pins) on the post-P1 tree. This
deletes the `NEEDED[]` maintenance burden and the eval/brace-match fragility. Keep
each loader's public interface (`{ parseDocPost, … }`) stable so `score.js` /
`fidelity-check.js` / `dd-matrix.js` need no change.
`testDocParser`/`testDocParserRegressions` stay in the app (verification hooks →
KEEP, Codex marked them LOW/do-not-remove).

---

## 8. CSS decision

**Keep CSS inline in `<style>` (18-2819) for the entire split.** Both the
boundaries and CSS analyses independently recommend this; reasons specific to
this app: no build step; no service worker to precache an external file; inline
avoids a second request + FOUC (notably iPhone home-screen launch); freshness
stays tied to the single `index.html`/`APP_VERSION` payload; **CSS is not
generated by JS** (JS emits HTML/SVG/canvas + inline `style` attrs, but injects no
`<style>`), so extraction buys little during the risky JS untangle. ~676 rule
blocks / ~757 selectors / ~353 unique class-id tokens.

Extraction to `css/app.css` is reasonable **later, as a separate release** with a
blocking `<link>`, manual cache-bust (`app.css?v=<APP_VERSION>`), and a visual
regression pass — and it must join Path-B's SW precache list if that exists by
then. Not part of this split.

---

## 9. Consolidation backlog — RANKED by risk (post-split, step 4)

Rules: (1) split must be fully green + pushed first; (2) **one consolidation
class per commit**, independently revertable; (3) CHANGE commits never mix with
MOVE commits; (4) each commit re-runs the full gate battery; (5) any dead/orphan
removal obeys the **deletion ratchet (§10)**; (6) **any item that changes emitted
HTML/DOM gates on an OBJECTIVE snapshot diff — the affected view's returned HTML
string (string-returning render fns) or jsdom `innerHTML` (DOM-mutating fns),
rendered on the fixed seed, must be byte-identical before vs after. A subjective
"visual pass" is never sufficient for a render-affecting change.** Ranked
safest+highest-value first.

### Tier 1 — EASY, low risk (do first)
| Item | Sites | Helper / action | Gate |
|---|---|---|---|
| Reminder due-date normalization (dupes #1) | 11+ in 7079-7327 + 7481 | `isoDateOnly(v)` / `pushReminderItem(...)`; **preserve regex-only shape validation — do NOT switch to `parseDate`** | feed byte-identity (objective) |
| Projection shortfall bands (dupes #4) | 8281-8291/8353, 9154-9165 | `projectionBands(proj, pred)` | DOM-snapshot diff of timeline+chart on fixed seed |
| Requirement due/no-date markup (dupes #2) | 12920-12969, 13120-13135, 13189-13199 | `requirementDateLineHtml(offer,row)` | DOM-snapshot diff + 380px |
| `'$'+formatMoneyInput` money display (dupes #5) | 27 sites (11012,11064-11114,11159…) | `formatDollarInput(v,{fallback,suffix})`; **do NOT fold in `formatCurrency`/`formatCompactCurrency` (round/abbreviate differently)** | DOM-snapshot diff on fixed seed |
| CSS orphan removal | `.btn-lg`(393), `.card-soft`(416), `.card-title`(418), `.ddm-src`(1213), `.field-error`(2132), `.divider`(2569), `.sr-only`(2815), `grid-cols-1..4`(681-684 + media 2636-2696) | delete rule **and** its responsive overrides together | ratchet re-grep + DOM/computed-style snapshot |
| Dead-const/param removal | `STATUSES`(2927), `STATUS_CHIP_CLASS`(2936), `opts` param(5286), `hoverArea` local(9393) | remove | ratchet (§10) |

### Tier 2 — MODERATE (explicit semantics, more sites)
| Item | Sites | Note | Gate |
|---|---|---|---|
| Local date-time formatting (dupes #11) | 8786, 8895/8898, 13794 | `formatLocalDateTime(v,{fallback})`; preserve each fallback (`''`/`—`) | DOM-snapshot diff (diagnostics, sync, history) |
| Offer display-label composition (dupes #3) | 6374, 6848-6893, 7841, 9177, 12012, 12103, 13600, 14308, 14480 | `offerDisplayLabel(o,{separator,…})`; separator varies (` — ` vs ` ·`); chart keeps bank-only-unless-ambiguous; **feed builder uses raw names — leave out** | DOM-snapshot diff of all 9 sites on fixed seed |
| Hero currency parts (dupes #6) | 5286-5290 + 6746-6752 | `formatCurrencyParts(n)`; hero keeps `.currency-symbol` split | DOM-snapshot diff (hero) |
| Anchor+N-days→ISO deadline math (dupes #7) | 3165, 4964, 5619, 5631, 5829, 5879, 14440 | `isoAfterDays(anchor,days,{minDays,empty})`; zero-day validity + return-type (`''`/`null`/`Date`/ISO) differ per site — encode explicitly | unit-equivalence per site + full battery |
| DoC parser internals (dupes #8/#9/#10) | parser 9939-10812 | reduction-target, `$`-regex fragment (`DOC_DOLLAR_SRC`), presence guard (`docHasValue`) | **corpus ≥84.9% + 63/63 + 13 pins (hard) — calibration-sensitive, RISKY-adjacent** |
| CSS token consolidation | soft-panel surface; micro-label typography; status colors (`#047857`/`#b45309`/`#1f7a99`); DD-blue `rgba(45,156,219,…)`→custom props | — | computed-style/DOM snapshot diff |
| CSS dead/overridden decls | `.action-day .month` 880→904 (fw 700→600), `.doc-import-empty` 1383→1385, `.field-box .textarea` 2023→2079, `.modal-body` 2213/2411 | keep `-webkit-sticky` fallbacks (556/557, 1729/1730) | computed-style snapshot |

### Tier 3 — RISKY / judgment (defer; extra evidence required)
| Item | Why risky |
|---|---|
| Text normalization/capitalization modes (dupes #12) | 8 sites with **materially different** punctuation/casing rules; only as explicit `normalizeText(s,mode)` + per-mode tests, else silent behavior drift |
| CSS mobile/modal containment merge (2216-2224 / 2686-2690 / 2774-2785) | responsive interaction; high visual-regression surface |
| `formatCurrencyDecimal` removal (5293, 0 refs) | HIGH-confidence dead, but a plausible future-API affordance — **owner call** before removing |
| `summarizeProjection` `settings` param (6344) + 3 call-args (6707/7721/14066) | cosmetic; verify param truly unused in body 6344-6369 first |
| Cycle-breaking coordinator/setters (§4 cycles 1-5) | CHANGE-class; only for readability, not required — each its own commit + full battery |
| `typeof Sync !== 'undefined'` guard @3652 (in `restorePreV2Backup`) | Under modules `Sync` is always imported → the guard is **always true** and its no-Sync `else` branch (~3665) is dead. Harmless; **do NOT change at split time** (moves byte-identical in P2). Optional simplification later. |
| Relocate `restorePreV2Backup` out of `migrations-catalogs` | Would let `migrations-catalogs` become a clean leaf (its other fns are pure), shrinking a future SCC. CHANGE-class function-move; not required — noted for a later refactor. |
| `.chip-offer-type-other` (1178) | **DO NOT remove** on static grep alone — dynamically built; the 8204 ternary currently maps `other`→`new-funds-held` so it's unemitted **today**, but is one edit from live. MEDIUM. |

---

## 10. Deletion ratchet (restated — the anti-erroneous-deletion contract)

Code/CSS is removed **only** when ALL hold, logged per removal in the step
checkpoint with its evidence:
1. **Codex flags it dead/orphan** (from `audit-dead.md` / `audit-css.md`), AND
2. **A Claude executor independently re-confirms zero references** at removal
   time — full call-graph + dynamic-dispatch sweep: `onclick`/`on*` strings,
   `data-action`/`data-view` names + the `onClick`/`onChange`/`onInput` switches,
   `DOC_FIELD_MAP` keys, feed `kind`/`yv-*` id patterns, CSS class strings built
   by concatenation/template-literal (grep the token **and** its prefix, e.g.
   `grep 'badge-'` before deleting `.badge-x`), `window.*`, bracket-key access, AND
3. **All gates stay green after removal.**
Any leg failing → it stays. The dead-code candidate table (Tier-1/Tier-3 above)
is the **input**, never the authority.

**HIGH-confidence dead inventory (from `audit-dead.md`, all re-verified by Claude
except where noted):** `STATUSES`(2927, 0 refs ✓), `STATUS_CHIP_CLASS`(2936, 0
refs ✓ — current UI uses `SUB_STATUS_CHIP_CLASS`), `formatCurrencyDecimal`(5293,
0 refs ✓ — Tier-3 owner call), `formatCurrency` `opts` param(5286),
`summarizeProjection` `settings` param(6344, body-unused claim not independently
grepped), `hoverArea` local(9393 — do NOT remove the `<rect id="chart-hover-area">`
at 9371, only the unused binding). **KEEP:** `testDocParser`(11817),
`testDocParserRegressions`(11860) — verification hooks (the 63/63 gate runs them).
No MEDIUM-confidence dead code was found (conservative pass — good).

---

## 11. Rollback plan

- **Tag `checkpoint-2026-07-08-pre-modules`** at pre-split HEAD (`447c57f` or
  the then-current green HEAD), **pushed immediately** in P0.
- **Per-phase:** local commit each phase; a phase that fails its gate battery is
  `git revert`/`reset`-ed to the prior green phase commit — never forced. Push
  only at split-complete green, then per green consolidation batch.
- **Full abort:** `git reset --hard checkpoint-2026-07-08-pre-modules` returns
  the single-file app byte-for-byte; the runtime-generated manifest/PWA path is
  unaffected (no external artifacts to unwind, no SW to unregister on Path A).
- **Consolidation stop-loss (step 4):** any gate regression → revert **that batch
  only**, log, continue with the next class.

---

## 12. Open risks / watch-items for the split phases

- **Offline reload (§1)** — the one genuine behavior change (atomic 1-file cache →
  N-file cache). Path-A hard gate catches it; Path-B SW is the fallback. Owner
  decision pending.
- **`<script type="module">` timing/scope** — modules are deferred + module-scoped;
  verify boot order (`App.init` on `DOMContentLoaded`, delegation binds on
  `document`) and that `window.App/Sync/YieldVector` exposure covers every console/
  harness/test consumer. Low risk (dispatch is delegation-based), but verify.
- **Relative import paths** — absolute `/js/` breaks on the project-Pages subpath;
  enforce `./js/`.
- **Cycles via live bindings (§4)** — correct for call-time refs; the pre-split
  audit (no top-level cyclic deref) must actually confirm the bootstrap span holds
  all side-effect calls.
- **Atomic SCC phase (§6 P2) is large** (12 modules / ~8k lines in one commit) —
  unavoidable given the extraction invariant (§0b); de-risk with the working-branch
  squash technique (§6) and treat its single big gate as a hard stop.
- **Read-only import bindings (§0b)** — only `_manifestHwm` needed the sanctioned
  `seedManifestHwm` setter; the rest stays pure MOVE-ONLY. Any *new* cross-module
  `let`/`var` reassignment introduced later must add its own declared setter.
- **Harness breaks at P1, not P3 (§7)** — all three brace-match extractors convert
  to module imports at P1 with the extraction-identity gate; missing one leaves a
  silently-broken corpus/pin/segmentation scorer.
- **Parser-loader switch (§7)** — corpus fidelity must be byte-identical after the
  import-based loader; the DOMParser global shim must be set before first
  `parseDocPost` call.
- **Calibration-sensitive consolidations** — dupes #8/#9/#10 (DoC parser) and #1
  (feed) touch measured behavior; their gates (corpus %, feed byte-identity) are
  non-negotiable blockers.
- **`AGENTS.md` is owner-dirty** — do NOT touch; the architecture map goes to
  HANDOFF + a new `docs/ARCHITECTURE.md` (step 5), flagged to fold into AGENTS.md
  after the owner commits his pending edits.
```
