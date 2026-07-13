# Yield Vector — AI Assistant Brief

This document is for any AI assistant working in this directory. It is AI-agnostic — the same instructions apply whether you are Claude, Codex, Gemini, Cursor, or any other assistant. It is the **canonical technical reference** for the project; other docs link here rather than restating it.

See [../docs/USER_PROFILE.md](../docs/USER_PROFILE.md) for the workspace owner's working style and communication preferences.
See [../docs/PREFERENCES.md](../docs/PREFERENCES.md) for code and documentation standards.

---

## What This Project Is

Yield Vector is a credit card / bank-account bonus planner PWA. It helps the owner track bank account bonuses, model cash-flow timelines, and decide which bonuses to pursue and in what order. Think of it as a personal finance optimizer focused specifically on new-account bonuses (often called "churning").

- **Live URL:** https://CMR2334.github.io/yield-vector/
- **Repo:** https://github.com/CMR2334/yield-vector
- **Local path:** `/Users/collinrekowski/Automation/Yield Vector/`

---

## Architecture

Single-file PWA. The entire application — HTML structure, CSS styles, and JavaScript logic — lives in one file: `index.html` (~8,000 lines). There is no build step, no bundler, no framework. Vanilla JS and CSS only.

State is persisted to `localStorage`. Cloud sync is a GitHub Gist polled on focus/visibility and pushed on every `App.save()` (2.5 s debounce). Deployed via GitHub Pages from `main`; a push triggers a rebuild and the live URL reflects it within 30–90 seconds.

**Key files:**
- `index.html` — entire app (HTML + CSS + JS)
- `dd-methods.json` — baked DoC "methods that count as direct deposit" dataset (regenerate with `tools/build-dd-methods.js`)
- `auto-push.js` — file watcher that auto-commits/pushes on save (unreliable; don't depend on it — see Commit protocol)
- `package.json` — only dependency is `chokidar` (for the watcher)
- `tools/` — maintenance scripts (`build-dd-methods.js`, `create-reminders.swift`)

---

## Key Function Locations

Line numbers drift as the file grows — **search by function name** if they don't match. (Accurate as of `index.html` ≈ 8,000 lines.)

| Function | ~Line | Purpose |
|----------|-------|---------|
| `setupPwa()` | ~2700 | Runtime-generated canvas icon + manifest; smooth diagonal gradient |
| `usFederalHolidays(year)` | ~2910 | ACH holiday calendar (11/yr), cached per year |
| `directDepositEffectiveDate(dd)` | ~3030 | Planned DD date → next business day if weekend/holiday |
| `withdrawalEligibleDate(offer)` | ~3510 | `lockStart + daysFundsMustRemain` |
| `lockStartDate(offer)` | ~3530 | DD: max effective DD date; Held/Other: funding date |
| `generateProjection()` | ~3550 | Day-by-day cash-flow model |
| `effectiveHorizonDays()` | ~3735 | Auto mode: withdrawal-eligible dates only, +30 days |
| `runOptimizer()` | ~3985 | Feasibility: `shortfallDays === 0 && belowBufferDays === 0` |
| `renderTimeline()` | ~4270 | Horizontal bars; label col sticky, track col scrolls |
| `renderHeroChart()` | ~5640 | SVG chart; tooltip appended to `<body>` for mobile clip fix |
| `logError(code,err,ctx)` | ~2110 | Categorized error → console + diagnostics ring buffer |
| `installErrorHandlers()` | ~2127 | Global `error` + `unhandledrejection` safety nets |
| `renderErrorState(err)` | ~4140 | Self-contained render-failure recovery panel |

---

## Offer Types

The app models three offer types, each with distinct logic:

- **New Funds Held** — minimum balance must be maintained for a specified period before the bonus is awarded. Hold measured from funded date or account-open date depending on the bank.
- **Direct Deposit** — requires qualifying ACH direct deposits within a window. Business-day logic applies (weekends + federal holidays shift to the next business day). Hold starts after the final DD's effective date.
- **Other** — catch-all for combination offers or anything that doesn't fit the above.

---

## Versioning

`APP_VERSION` (top of the `<script>` block in `index.html`) is the **single user-facing build identifier**, shown in **Settings → About & diagnostics**. Because the PWA is served from cache, it's the only reliable way to confirm which build a phone is actually running.

- **Format:** date-build `YYYY.MM.DD`, with a trailing letter (`2026.06.14b`) for a second build the same day.
- **On each meaningful release:** bump `APP_VERSION`, then create a matching `stable-YYYY-MM-DD` git tag (the named restore point) and add a CHANGELOG entry.
- `package.json` `version` is semver dev-metadata, bumped independently; no tool consumes it.

---

## Error Handling & Diagnostics

The app runs on a phone with no console, so failures must never vanish silently.

- **Global safety nets** (`installErrorHandlers`, called first in `App.init`): `window` `error` + `unhandledrejection` are caught, logged, and (for errors) toasted.
- **`logError(code, err, ctx)`** categorizes failures with a stable `ErrCode` (`E_STORAGE`, `E_PARSE`, `E_SYNC_PUSH`, `E_SYNC_PULL`, `E_RENDER`, `E_UNCAUGHT`, `E_PROMISE`, `E_PWA`) and keeps the last 25 in a `localStorage` ring buffer (`yv-diag-log-v1`).
- **Settings → About & diagnostics** surfaces version, storage/sync health, and the recent-error log, with a one-tap **Copy diagnostics** report (includes UA + stacks) for bug reports.
- **`render()` and `App.init()` are wrapped** so a render throw shows `renderErrorState()` (a recoverable panel) instead of a blank screen.
- When adding code that can fail (parse, network, storage), route the catch through `logError` with the right code rather than an empty `catch {}`.

---

## Commit & Push Protocol

Always commit and push after a meaningful change — the live URL rebuilds automatically and the owner often checks on iPhone, so push early and often rather than batching to the end. Push at least every 30 minutes of active work, and immediately when the owner signals stepping away ("I have to go") or a session is nearing its context limit — unpushed work is lost if the session ends unexpectedly. Do not rely on `auto-push.js` (it dies on terminal close / laptop sleep).

```bash
cd "/Users/collinrekowski/Automation/Yield Vector" && \
  git add index.html HANDOFF.md && \
  git commit -m "<descriptive, imperative summary>" && \
  git push origin main
```

- **Use descriptive, imperative commit messages** ("Fix nav icon clipping", not "Fixed…", not "auto update"). The owner reverts specific changes from `git log` + tags, so each commit must be identifiable. `"auto update"` is reserved for the automated `auto-push.js` watcher only.
- When working from a worktree, `cd` to the main repo path first so the commit lands on `main` (GitHub Pages serves `main`; worktree branches are not served).
- After the owner confirms a good state, tag it: `git tag -a stable-YYYY-MM-DD -m "…" && git push origin stable-YYYY-MM-DD`.

---

## Locked design values (do not re-tune)

The owner signed off on these after many iterative rounds (HANDOFF Round 36). Do **not** adjust them unless explicitly asked — "make it brighter/darker" passes undo a careful balance. The raw hexes recur in 3+ places (chart marker fills, legend swatches, `labelLift` lookup keys) — search the exact hex before editing any one occurrence, or they fall out of sync silently.

- **Chart marker fills / legend swatches:** initial funding `#5b5cf6` · direct deposit `#2d9cdb` · withdrawal / bonus payout / inflow `#10b981` · deposit deadline and outflow `#e87171` (red, **not** amber `#f59e0b` — amber is the buffer color and made outflows read as "warning").
- **Tooltip "Available" amount:** `#8e90ff` (≈⅓ between the trendline `#5b5cf6` and white).
- **Tooltip left labels** lift on dark BG via `labelLift`: `#5b5cf6→#8a8cff`, `#2d9cdb→#5cb4e4`, `#10b981→#6ee7b7`; red `#e87171` and amber `#f59e0b` stay raw. Event-type labels get inline `opacity:1` + `font-weight:600`.
- **Right-side identity color:** `lightenHexForDark(offerColor)` (HSL lighten to ~74% L) when the offer has a color; otherwise the lifted event color.

---

## Documentation Map

One source of truth per fact — don't duplicate (per [../docs/PREFERENCES.md](../docs/PREFERENCES.md)).

| File | Role |
|------|------|
| `AGENTS.md` (this file) | Canonical AI-agnostic technical brief — architecture, function map, conventions |
| `CLAUDE.md` | Claude Code-specific config; references this file + shared docs, doesn't restate them |
| `README.md` | Human-facing overview + setup; links here for the function map |
| `CHANGELOG.md` | Sparse, **release-level** history: milestones, commit hashes, revert commands |
| `HANDOFF.md` | Granular **per-session** AI changelog; read the Current state block + top 2–3 entries at session start, prepend after meaningful work |
| `HANDOFF_ARCHIVE.md` | Older HANDOFF rounds, moved out to keep the live log readable |
| `SHORTCUT_SETUP.md` | One-time iOS Reminders Shortcut build guide |

---

## Session Protocol

1. Read `HANDOFF.md` at the start of every session (Current state block + top 2–3 entries).
2. Do the work.
3. Commit and push (descriptive message); push at least every 30 minutes of active work and before the owner steps away.
4. Prepend a new entry to `HANDOFF.md` summarizing what changed.
5. On a confirmed-good state, bump `APP_VERSION` + tag `stable-YYYY-MM-DD` + add a CHANGELOG milestone entry.
