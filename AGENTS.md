# Yield Vector — AI Assistant Brief

This document is for any AI assistant working in this directory. It is AI-agnostic — the same instructions apply whether you are Claude, Codex, Gemini, Cursor, or any other assistant.

See [../docs/USER_PROFILE.md](../docs/USER_PROFILE.md) for the workspace owner's working style and communication preferences.
See [../docs/PREFERENCES.md](../docs/PREFERENCES.md) for code and documentation standards.

---

## What This Project Is

Yield Vector is a credit card bonus planner PWA. It helps the owner track bank account bonuses, model cash flow timelines, and decide which bonuses to pursue and in what order. Think of it as a personal finance optimizer focused specifically on new-account bonuses (often called "churning").

- **Live URL:** https://CMR2334.github.io/yield-vector/
- **Repo:** https://github.com/CMR2334/yield-vector
- **Local path:** `/Users/collinrekowski/Automation/Yield Vector/`

---

## Architecture

Single-file PWA. The entire application — HTML structure, CSS styles, and JavaScript logic — lives in one file: `index.html` (~4500 lines). There is no build step, no bundler, no framework. Vanilla JS and CSS only.

Deployed via GitHub Pages from the `main` branch. A push to `main` triggers an automatic rebuild; the live URL reflects changes within 30–90 seconds.

**Key files:**
- `index.html` — entire app
- `auto-push.js` — file watcher that auto-commits and pushes on save (unreliable; don't depend on it)
- `package.json` — only dependency is `chokidar` (for the watcher)
- `HANDOFF.md` — cross-session changelog; read at the start of every session, prepend new entries after meaningful changes

---

## Key Function Locations

These line numbers are approximate and shift as the file grows. Search by function name if they don't match.

| Function | ~Line | Purpose |
|----------|-------|---------|
| `effectiveHorizonDays()` | ~1961 | Auto mode: uses withdrawal-eligible dates only, adds +30 days |
| `setupPwa()` | ~1542 | Runtime-generated canvas icon, smooth diagonal gradient |
| `runOptimizer()` | ~2176 | Feasibility check: requires `shortfallDays === 0 && belowBufferDays === 0` |
| `renderTimeline()` | ~2745 | "Today" label suppressed on data rows via CSS |
| `renderHeroChart()` | ~3342 | Chart with marker tooltips; mobile uses `position:fixed` for tooltip |

---

## Offer Types

The app models three offer types, each with distinct logic:

- **New Funds Held** — minimum balance must be maintained for a specified period before the bonus is awarded.
- **Direct Deposit** — requires a qualifying direct deposit within a window. Business-day logic applies (weekends and federal holidays do not count).
- **Other** — catch-all for offers that don't fit the above categories.

---

## Auto-Push Protocol

Always commit and push after making changes. The live URL rebuilds automatically.

```bash
cd "/Users/collinrekowski/Automation/Yield Vector" && \
  git add index.html HANDOFF.md && \
  git commit -m "auto update" && \
  git push origin main
```

After pushing, the live URL is updated within 30–90 seconds. The owner often checks on their iPhone — push early and push often rather than batching all changes to the end.

---

## Session Protocol

1. Read `HANDOFF.md` at the start of every session (top 3–5 entries).
2. Do the work.
3. Commit and push.
4. Prepend a new entry to `HANDOFF.md` summarizing what changed.

Push at least every 30 minutes of active work. Push before the owner steps away.
