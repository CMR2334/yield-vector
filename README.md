# Yield Vector

A single-file PWA for planning and tracking bank account opening bonuses (credit card churning). Model cash flow timelines, track hold periods, and decide which offers to pursue and in what order.

**Live URL:** https://CMR2334.github.io/yield-vector/
**Repo:** https://github.com/CMR2334/yield-vector

---

## What it does

- **Offer tracking** — add bonus offers with their funding requirements, hold periods, and expiration dates
- **Cash flow projection** — day-by-day chart showing available capital, tied-up capital, and buffer floor
- **Timeline view** — horizontal bar chart of all active commitments, color-coded by status
- **Optimizer** — finds feasible bonus sequences within your capital budget (requires zero shortfall days)
- **Cloud sync** — state synced via GitHub Gist; last-writer-wins conflict resolution
- **iOS Reminders** — structured `_feed` on every Gist push; Apple Shortcut syncs deadlines to Reminders.app
- **PWA** — installable on iPhone/Mac, works offline

---

## Local dev

No build step. Open `index.html` directly in a browser.

To auto-push to GitHub Pages on every save:

```bash
npm install          # installs chokidar (file watcher)
node auto-push.js    # watches index.html, commits + pushes on change
```

> **Note:** `auto-push.js` dies on terminal close or laptop sleep. For reliable pushes, use the manual protocol below.

---

## Architecture

**Single-file PWA.** The entire application — HTML, CSS, and JavaScript — lives in [`index.html`](index.html) (~4 500 lines). Vanilla JS and CSS only; no framework, no bundler, no build step.

State is persisted to `localStorage`. Cloud sync is a GitHub Gist polled on focus/visibility and pushed on every `App.save()` call (2.5 s debounce).

### Key function locations

Line numbers are approximate; search by name if they drift.

| Function | ~Line | Description |
|---|---|---|
| `generateProjection()` | 2800 | Day-by-day cash-flow model |
| `effectiveHorizonDays()` | 1961 | Auto horizon: withdrawal-eligible dates + 30 d |
| `runOptimizer()` | 2176 | Feasibility: `shortfallDays === 0 && belowBufferDays === 0` |
| `renderHeroChart()` | 3342 | SVG chart; tooltip appended to `<body>` for mobile clip fix |
| `renderTimeline()` | 2745 | Horizontal bars; label col sticky, track col scrolls |
| `setupPwa()` | 1542 | Canvas-generated home-screen icon (matches header SVG) |
| `lockStartDate(offer)` | 2560 | DD: max effective DD date; Held/Other: funding date |
| `withdrawalEligibleDate(offer)` | 2580 | `lockStart + daysFundsMustRemain` |
| `usFederalHolidays(year)` | 2310 | ACH holiday calendar, cached per year |
| `directDepositEffectiveDate(dd)` | 2336 | Planned date → next business day if needed |

---

## Offer types

### New Funds Held
Deposit a lump sum and keep it for N days. The hold period is measured from either the **funded date** or the **account open date**, depending on the bank's terms.

### Direct Deposit
One or more qualifying ACH direct deposits within a window. Each planned DD is shifted to the next US business day if it falls on a weekend or federal bank holiday. The hold period starts after the **final DD's effective date**.

### Other
Catch-all for combination offers or anything that doesn't fit the above.

---

## Business-day logic

`usFederalHolidays(year)` computes the 11 ACH holidays each year:

- **Fixed-date** holidays (New Year's, Juneteenth, Christmas, etc.) observe the standard Sat→Fri / Sun→Mon shift.
- **Floating** holidays (MLK 3rd Mon Jan, Presidents' Day 3rd Mon Feb, Memorial Day last Mon May, Labor Day 1st Mon Sep, Columbus Day 2nd Mon Oct, Thanksgiving 4th Thu Nov) are derived via weekday-ordinal arithmetic.

Results are cached per year. `directDepositEffectiveDate(dd)` returns the planned date unchanged if it's already a business day, or advances it to the next business day otherwise. The original planned date is stored; the effective date is derived on the fly and shown in the UI with a `⇢` indicator.

---

## GitHub Pages deploy

Every push to `main` triggers a GitHub Pages rebuild. The live URL updates within 30–90 seconds.

**Manual push (recommended — auto-push.js is unreliable):**

```bash
cd "/Users/collinrekowski/Automation/Yield Vector" && \
  git add index.html HANDOFF.md && \
  git commit -m "auto update" && \
  git push origin main
```

When working from a Claude Code worktree, `cd` to the main repo path first so the commit lands on `main` (worktree commits land on the worktree branch, which GitHub Pages does not serve).

---

## Task workflow

- **GitHub Issues** — feature requests and bugs tracked on the repo.
- **HANDOFF.md** — cross-session AI changelog; every AI session prepends a new entry after meaningful changes. Read the top 3–5 entries at the start of each session.
- **AGENTS.md** — AI assistant brief (architecture, key functions, session protocol).
- **CHANGELOG.md** — human-readable change log with commit hashes and revert instructions.
- **iOS Reminders** — deadlines flow from the planner's `_feed` array into Apple Reminders via a one-time Apple Shortcut setup (see [SHORTCUT_SETUP.md](SHORTCUT_SETUP.md)).

---

## Pending items

- **iOS Reminders Shortcut** — the JSON feed is fully wired and stamped on every Gist push. The Shortcut must be built once on-device (~15 min); follow [SHORTCUT_SETUP.md](SHORTCUT_SETUP.md).
- **DoC URL ingestion** — paste a Doctor of Credit URL to auto-fill an offer card. Requires either a small backend or client-side LLM extraction (Haiku ~$0.01/offer). See Round 4 in [HANDOFF.md](HANDOFF.md) for the options analysis.

---

## AI / development notes

See [AGENTS.md](AGENTS.md) for the AI assistant brief and [HANDOFF.md](HANDOFF.md) for the cross-session change log.
