# Yield Vector — AI Assistant Brief

This document is for any AI assistant working in this directory. It is AI-agnostic — the same instructions apply whether you are Claude, Codex, Gemini, Cursor, or any other assistant. It is the **canonical technical reference** for the project; other docs link here rather than restating it.

See [../docs/USER_PROFILE.md](../docs/USER_PROFILE.md) for the workspace owner's working style and communication preferences.
See [../docs/PREFERENCES.md](../docs/PREFERENCES.md) for code and documentation standards.

---

## What This Project Is

Yield Vector is a credit card / bank-account bonus planner PWA. It helps the owner track bank account bonuses, model cash-flow timelines, and decide which bonuses to pursue and in what order. Think of it as a personal finance optimizer focused specifically on new-account bonuses (often called "churning").

**Current direction (2026-09-19):** the PWA is the read-mostly phone dashboard, and its UI is frozen, so make UI changes only when the owner asks for them. Offer intake moves to an assistant intake skill (`/bonus`, planned). Reminders flow through the Mac EventKit bridge (`tools/yv-reminders-bridge.swift`). The LLM reads and extracts; the engine modules compute every number, date and sequence. Full record: [docs/assessments/2026-09-19-strategic-direction.md](docs/assessments/2026-09-19-strategic-direction.md).

- **Live URL:** https://CMR2334.github.io/yield-vector/
- **Repo:** https://github.com/CMR2334/yield-vector
- **Local path:** `/Users/collinrekowski/Automation/Yield Vector/`

---

## Architecture

Zero-build PWA in vanilla JS and CSS. `index.html` holds the markup, all CSS (inline `<style>`), a `<head>` import map and a small bootstrap `<script type="module">`. The logic lives in 19 native ES modules under `js/`, and the import map versions each one as `?v=<APP_VERSION>`. `sw.js` precaches the shell and modules for offline use. Module map, import graph and service-worker flow: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Serve locally over HTTP (e.g. `python3 -m http.server 8765` from the repo root), because ES modules load only from an HTTP origin.

State is persisted to `localStorage`. Cloud sync is a GitHub Gist pulled on startup, focus and visibility change, and pushed after every `App.save()` (2.5 s debounce). Deployed via GitHub Pages from `main`; a push triggers a rebuild and the live URL reflects it within 30–90 seconds.

**Key files:**
- `index.html` — shell: markup, inline CSS, import map, bootstrap module
- `js/*.js` — the 19 app modules (engine, render, sync, DoC parser)
- `sw.js` — service worker; precache keyed to `APP_VERSION`
- `dd-methods.json` — baked DoC "methods that count as direct deposit" dataset (regenerate with `tools/build-dd-methods.js`)
- `cloudflare/` — DoC-import Worker; deploy notes in `cloudflare/README.md`
- `scripts/airtable-sync.mjs` — daily one-way Gist → Airtable mirror, run by `.github/workflows/airtable-sync.yml`
- `tools/` — `build-dd-methods.js`, `yv-reminders-bridge.swift` + `com.collin.yv-reminders-bridge.plist` (Mac EventKit reminders bridge, launchd), `create-reminders.swift`
- `docs/fixtures/*/harness/` — verification harnesses (DoC corpus, optimizer pins)
- `auto-push.js`, `package.json` — legacy watcher, scheduled for deletion; push manually (Commit & Push Protocol)

---

## Key Function Locations

Find a function by name: `grep -n "function <name>" js/*.js`. The Module column gives its current home.

| Function | Module | Purpose |
|----------|--------|---------|
| `setupPwa()` | `js/sync-pwa.js` | Runtime-generated canvas icon + manifest; smooth diagonal gradient |
| `usFederalHolidays(year)` | `js/date-format-core.js` | ACH holiday calendar (11/yr), cached per year |
| `directDepositEffectiveDate(dd)` | `js/dd-core.js` | Planned DD date → next business day if weekend/holiday |
| `lockStartDate(offer)` | `js/offer-model.js` | DD: earliest planned DD; held types: funding date on a business day; `''` when that path is inactive |
| `withdrawalEligibleDate(offer, cfg)` | `js/offer-model.js` | Capital-back date. DD: latest DD round-trip return; held types: hold release + return-transfer lag (`backDays`) |
| `generateProjection(state, options)` | `js/projection-optimizer.js` | Day-by-day cash-flow model |
| `effectiveHorizonDays(state)` | `js/projection-optimizer.js` | Auto mode: latest active withdrawal-eligible date + 30 days |
| `runOptimizer(state)` | `js/projection-optimizer.js` | Feasibility: `shortfallDays === 0 && belowBufferDays === 0` |
| plan sequencer | `js/optimizer-engine.js` | Snapshot-in / plan-out optimizer (ARCHITECTURE §6); same feasibility predicate |
| `renderTimeline()` | `js/render-main-views.js` | Horizontal bars; label col sticky, track col scrolls |
| `renderHeroChart(svg)` | `js/render-main-views.js` | SVG chart; tooltip appended to `<body>` for mobile clip fix |
| `logError(code, err, context)` | `js/runtime-status.js` | Categorized error → console + diagnostics ring buffer |
| `installErrorHandlers()` | `js/runtime-status.js` | Global `error` + `unhandledrejection` safety nets |
| `renderErrorState(err)` | `js/render-shell-overview.js` | Self-contained render-failure recovery panel |

---

## Offer Types

The offer-type radio has three types, each with distinct logic:

- **New funds held** (`new-funds-held`) — a lump sum must stay deposited for N days before the bonus posts. The hold runs from the funded date or the account-open date, depending on the bank.
- **Direct deposit** (`direct-deposit`) — qualifying ACH direct deposits within a window; no bank hold. Each DD ties up capital only for its transfer round trip. Business-day logic applies (weekends + federal holidays shift to the next business day).
- **Held + DD** (`held-and-dd`) — both: a held lump sum plus qualifying DDs.

The legacy `other` value is normalized to `new-funds-held` on every write.

---

## Versioning

`APP_VERSION` is the **single user-facing build identifier**, shown in **Settings → About & diagnostics**. Because the PWA is served from cache, it's the only reliable way to confirm which build a phone is actually running.

- **Format:** date-build `YYYY.MM.DD`, with a trailing letter (`2026.06.14b`) for a second build the same day.
- **On each release:** bump it in all three coupled places together (`js/runtime-status.js`, `sw.js`, and the 19 `?v=` literals in the `index.html` import map), run the checks, and add a CHANGELOG entry. The steps, checks and sweep command are in [docs/ARCHITECTURE.md §8](docs/ARCHITECTURE.md).
- **After the owner confirms the build on his phone:** tag it `stable-YYYY-MM-DD` (see Commit & Push Protocol).
- `package.json` `version` is semver dev-metadata, bumped independently; no tool consumes it.

---

## Error Handling & Diagnostics

The app runs on a phone with no console, so every failure must reach the diagnostics log where the owner can see it.

- **Global safety nets** (`installErrorHandlers`, called first in `App.init`): `window` `error` + `unhandledrejection` are caught, logged, and (for errors) toasted.
- **`logError(code, err, ctx)`** categorizes failures with a stable `ErrCode` (`E_STORAGE`, `E_PARSE`, `E_SYNC_PUSH`, `E_SYNC_PULL`, `E_RENDER`, `E_UNCAUGHT`, `E_PROMISE`, `E_PWA`) and keeps the last 25 in a `localStorage` ring buffer (`yv-diag-log-v1`).
- **Settings → About & diagnostics** surfaces version, storage/sync health, and the recent-error log, with a one-tap **Copy diagnostics** report (includes UA + stacks) for bug reports.
- **`render()` and `App.init()` are wrapped** so a render throw shows `renderErrorState()` (a recoverable panel) instead of a blank screen.
- When adding code that can fail (parse, network, storage), route every catch through `logError` with the matching `ErrCode`.

---

## Commit & Push Protocol

Always commit and push after a meaningful change — the live URL rebuilds automatically and the owner often checks on iPhone, so push early and often rather than batching to the end. Push at least every 30 minutes of active work, and immediately when the owner signals stepping away ("I have to go") or a session is nearing its context limit — unpushed work is lost if the session ends unexpectedly.

```bash
cd "/Users/collinrekowski/Automation/Yield Vector" && \
  git add <the files you changed> HANDOFF.md && \
  git commit -m "<descriptive, imperative summary>" && \
  git push origin main
```

- **Write one descriptive, imperative commit message per change** (style in [../docs/PREFERENCES.md](../docs/PREFERENCES.md)). The owner reverts specific changes from `git log` + tags, so each commit must identify its change.
- When working from a worktree, `cd` to the main repo path first so the commit lands on `main` (GitHub Pages serves `main`; worktree branches are not served).
- The live site is `main`: add new commits on top, and push `main` without force.
- After the owner confirms a good state, tag it: `git tag -a stable-YYYY-MM-DD -m "…" && git push origin stable-YYYY-MM-DD`.

---

## Locked design values (owner-approved; change only on request)

The owner signed off on these after many iterative rounds (HANDOFF_ARCHIVE Round 36). Keep them exactly as listed; change one only when the owner explicitly asks for that value, because "brighter/darker" passes undo a careful balance. Each raw hex recurs across `index.html` and several `js/` modules (chart marker fills, legend swatches, `labelLift` keys), so change every occurrence together: run `grep -n "<hex>" index.html js/*.js` first.

- **Chart marker fills / legend swatches:** initial funding `#5b5cf6` · direct deposit `#2d9cdb` · withdrawal / bonus payout / inflow `#10b981` · deposit deadline and outflow `#e87171` (red, **not** amber `#f59e0b` — amber is the buffer color and made outflows read as "warning").
- **Tooltip "Available" amount:** `#8e90ff` (≈⅓ between the trendline `#5b5cf6` and white).
- **Tooltip left labels** lift on dark BG via `labelLift`: `#5b5cf6→#8a8cff`, `#2d9cdb→#5cb4e4`, `#10b981→#6ee7b7`; red `#e87171` and amber `#f59e0b` stay raw. Event-type labels get inline `opacity:1` + `font-weight:600`.
- **Right-side identity color:** `lightenHexForDark(offerColor)` (HSL lighten to ~74% L) when the offer has a color; otherwise the lifted event color.

---

## Documentation Map

Record each fact in one file and link to it from the others (per [../docs/PREFERENCES.md](../docs/PREFERENCES.md)).

| File | Role |
|------|------|
| `AGENTS.md` (this file) | Canonical AI-agnostic technical brief — architecture, function map, conventions |
| `CLAUDE.md` | Short pointer to this file + Claude Code-only config |
| `README.md` | Human-facing overview + setup; links here for the function map |
| `CHANGELOG.md` | Sparse, **release-level** history: milestones, commit hashes, revert commands |
| `HANDOFF.md` | Granular **per-session** AI changelog; read the Current state block + top 2–3 entries at session start, prepend after meaningful work |
| `HANDOFF_ARCHIVE.md` | Older HANDOFF rounds, moved out to keep the live log readable |
| `docs/ARCHITECTURE.md` | Module map, import graph, service worker, release checklist (§8) |
| `docs/BACKLOG.md` | Open work, parked items |
| `docs/assessments/` | Dated decision records (e.g. 2026-09-19 strategic direction) |
| `cloudflare/README.md` | DoC-import Worker deploy notes |

---

## Session Protocol

1. Read `HANDOFF.md` at the start of every session (Current state block + top 2–3 entries).
2. Do the work.
3. Commit and push (descriptive message); push at least every 30 minutes of active work and before the owner steps away.
4. Prepend a new entry to `HANDOFF.md` summarizing what changed.
5. On a release, bump `APP_VERSION` and add a CHANGELOG entry (Versioning above); tag `stable-YYYY-MM-DD` once the owner confirms the build.
