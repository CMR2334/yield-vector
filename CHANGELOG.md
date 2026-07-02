# Yield Vector — Changelog

Significant changes to this project, in reverse chronological order.

> **CHANGELOG vs HANDOFF.** This file is the **release-level** history: milestones
> and notable feature waves, each with commit hashes and a revert command, kept
> sparse so a human can scan the arc of the project. [HANDOFF.md](HANDOFF.md) is
> the **per-session** AI changelog — granular, round-by-round, prepended every
> session. If you want "what shipped and how do I undo it," read here; if you
> want "what did the last agent just touch," read HANDOFF.

**How to revert a change:**
- To undo a commit cleanly (creates a new revert commit): `git revert HASH`
- To restore a single file to an earlier state without a revert commit: `git checkout HASH -- index.html`
- To restore to a tagged milestone: `git checkout stable-YYYY-MM-DD -- index.html`
- To see what a commit changed: `git show HASH`

---

## 2026-07-02 — Robustness audit: modal-safe renders, sync flush on close, bank autocomplete (v2026.07.02)
**Branch:** `claude/yield-vector-audit-ajzdaq` (draft PR — merges to `main` on approval)
**Files:** `index.html`, `HANDOFF.md`, `CHANGELOG.md`
**What changed:** Background renders (sync pull, midnight roll, resize) no longer destroy an open Add/Edit modal — the live modal node is detached and re-attached across the re-render. Resize only re-renders on width changes (kills iOS toolbar/keyboard-triggered rebuilds). `TODAY` refreshes at midnight so Today markers/relative dates stay current. Pending debounced sync pushes flush via `fetch keepalive` when the app is backgrounded or closed (closes the R47-class data-loss window). `duplicateOffer` resets sub/account status and picks a fresh identity color. Bank-name autocomplete (`<datalist>` of the 1,158 DoC banks) on the offer modal + source-bank input. Escape closes the date picker before the modal; chart-tooltip DOM leak fixed; toast/nav a11y attributes.
**Revert:** revert the PR merge commit, or `git checkout stable-2026-06-15 -- index.html` if tagged fallback needed.

---

## 2026-06-15 — In-app versioning, error handling & diagnostics
**Commit:** `9dc560f` (code) + docs realignment (this commit)
**Files:** `index.html`, `package.json`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `HANDOFF.md`, `HANDOFF_ARCHIVE.md`
**What changed:** Added `APP_VERSION` date-build stamp (v2026.06.15) shown in a new **Settings → About & diagnostics** panel; global `error`/`unhandledrejection` handlers + `logError`/`ErrCode` ring buffer (no more silent blank-screen failures on iOS); `render()`/`init()` wrapped to show a recovery panel instead of a blank page; upgraded silent `JSON.parse`/sync catches to logged errors. Docs realigned to the workspace standard (de-duplicated function map into AGENTS.md, revived this changelog, archived old HANDOFF rounds). `package.json` 1.0.0 → 1.1.0.
**Revert:** `git revert 9dc560f`

---

## 2026-06-13 — Cloud-sync recovery + frozen-axis charts
**Commits:** `bc45a7f` (restore-from-history + push-overwrite guard), `448b613` / `851aff6` / `6682f49` (freeze chart $ Y-axis + timeline label column on mobile)
**Files:** `index.html`
**What changed:** "Restore from history" recovery lists the last 20 Gist revisions with their offer/event counts so a bad overwrite can be undone; `guardedManualPush()` warns before a stale device clobbers newer cloud data. Froze the overview chart's $ Y-axis and the timeline label column on mobile via a sticky single-scroll layout.
**Revert:** `git revert bc45a7f` (sync) · `git checkout 448b613~1 -- index.html` (charts)

---

## 2026-06-09 — Debit-card requirement + capital events
**Commits:** `191888d` (debit requirement + "Actions required" card), `e46cee1` / `4e3cd1e` (capital events)
**Files:** `index.html`
**What changed:** Per-offer debit-card transaction requirement (count + deadline) and an "Actions required" at-a-glance card counting pending DDs, lump-sum deposits, and debit txns. One-time capital events (inflows/outflows) with independent "in projection" vs "in Upcoming actions" visibility.
**Revert:** `git revert 191888d`

---

## 2026-06-08 — DD overhaul, status redesign, DoC method ranking
**Tags:** `stable-2026-06-08` (`68f997d`), `stable-2026-06-08b` (`3fc777b`) — named restore points
**Commits:** `88be7e7` (two-field status model + migration), `8abd6c0` (bake `dd-methods.json`, 1,158 banks) + `20dc8f4` (top-3 method ranking on cards), `a3e47a0` (color-coded date picker), `697b37c` (standard-DD field visibility)
**Files:** `index.html`, `dd-methods.json`, `tools/build-dd-methods.js`
**What changed:** Major feature wave. Open/Closed account status + 9-state sub-status with auto-flip and legacy migration; DD requirement modes (once-per-frequency / count) with business-day round-trip shading; baked DoC direct-deposit dataset with per-bank method ranking on offer cards; integrated custom color-coded date picker.
**Revert:** `git checkout stable-2026-06-08 -- index.html` (restore to the tagged milestone)

---

## 2026-06-12 — Project rename (Churning → Yield Vector) + repo hygiene
**Commits:** `cfb54bc` (folder rename + internal path refs), `8c83740` / `1b4af87` / `47b8614` (gitignore `nohup.out`/`launch.json`, commit `package-lock.json`, remove duplicate icon)
**Files:** `index.html`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `package-lock.json`
**What changed:** Renamed the project folder `Churning` → `Yield Vector`, updated internal doc path references (quoted for the space), and general repo cleanup.
**Revert:** `git revert cfb54bc`

---

## 2026-05-17 — Timeline label/column polish
**Commits:** `42b6326`, `c6cca5b`, `f3262f8`, `d0057f0`, `d592216`
**Files:** `index.html`
**What changed:** Shortened timeline labels (robust "Bonus" suffix stripping across all separator styles), narrowed the left label column, fixed settings date-input overflow and field-hint alignment.
**Revert:** `git checkout 42b6326~1 -- index.html`

---

## 2026-05-11 — Remove orphan .claude/worktrees gitlink blocking GitHub Actions
**Commit:** `a40c80f`
**Files:** `.gitmodules`, `.claude/`
**What changed:** Removed a stale `.claude/worktrees` gitlink that was causing GitHub Actions to fail when checking out the repo.
**Revert:** `git revert a40c80f`

---

## 2026-05-11 — Add bypassPermissions, update gitignore and auto-push docs
**Commit:** `c7a5a73`
**Files:** `.claude/settings.json`, `.gitignore`, `CLAUDE.md`
**What changed:** Enabled `bypassPermissions` in Claude Code project settings so tool calls are auto-approved. Updated `.gitignore` and documented the auto-push protocol.
**Revert:** `git revert c7a5a73`

---

## 2026-05-09 — Chart legend: 2-column grid, withdrawal+funding on top
**Commit:** `e4b6dc1`
**Files:** `index.html`
**What changed:** Reorganized the hero chart legend into a 2-column grid. Withdrawal and funding items appear on the top row; capital and buffer on the bottom.
**Revert:** `git checkout e4b6dc1~1 -- index.html`

---

## 2026-05-09 — Tighten hero card padding on mobile
**Commit:** `f5aa395`
**Files:** `index.html`
**What changed:** Reduced padding in the hero card container so the chart has more vertical room on small screens.
**Revert:** `git checkout f5aa395~1 -- index.html`

---

## 2026-05-08 — Fix timeline: names visible in landscape, descenders not clipped
**Commit:** `c61b296`
**Files:** `index.html`
**What changed:** Fixed timeline row rendering so institution names are visible in landscape orientation and descenders (g, p, y) are not clipped at the bottom.
**Revert:** `git checkout c61b296~1 -- index.html`

---

## 2026-05-08 — Shrink header height from 80px to 56px
**Commit:** `c6aed3b`
**Files:** `index.html`
**What changed:** Reduced the top header from 80px to 56px to recover vertical space on mobile.
**Revert:** `git checkout c6aed3b~1 -- index.html`

---

## 2026-05-08 — Nav bar layout and icon polish (multiple commits)
**Commits:** `49656c5`, `8edc33f`, `1f43cca`, `8adc628`, `3b5c05f`, `6420892`
**Files:** `index.html`
**What changed:** Iterative nav bar refinement — height, padding, button alignment, icon sizes, and tooltip label cleanup. Final state: 60px nav height, 44px buttons, flex-start alignment, 20px icons, 4px top padding. Compass icon for Plan tab, bank building icon for Offers tab.
**Revert:** `git checkout c8db403 -- index.html` (restores to state before this series)

---

## 2026-05-08 — Fix chart marker clustering and tooltip
**Commit:** `d0cc059`
**Files:** `index.html`
**What changed:** Tightened the marker stack threshold from a larger value to 9px so nearby markers cluster correctly. Tooltip now shows all markers in a cluster.
**Revert:** `git checkout d0cc059~1 -- index.html`

---

## 2026-05-08 — Fix portrait nav icon clipping (safe-area height math)
**Commit:** `0380573`
**Files:** `index.html`
**What changed:** Corrected the safe-area-inset calculation for the nav bar height in portrait mode. Icons were being clipped at the bottom on notched iPhones.
**Revert:** `git checkout 0380573~1 -- index.html`

---

## 2026-05-08 — Add icons to primary nav, fix date input vertical centering
**Commit:** `d4703167`
**Files:** `index.html`
**What changed:** Added SVG icons to the primary navigation tabs. Fixed date input vertical centering — was using `line-height` incorrectly; switched to padding.
**Revert:** `git checkout d4703167~1 -- index.html`

---

## 2026-05-07 — Nav icons redesigned, modal footer safe-area padding
**Commit:** `111ae62`
**Files:** `index.html`
**What changed:** Nav icons redesigned with simpler SVG paths (L/H/V commands only) for Safari compatibility. Modal footer now respects safe-area-inset-bottom. Added 280ms search debounce.
**Revert:** `git checkout 111ae62~1 -- index.html`

---

## 2026-05-07 — Fix offer-dates vertical alignment
**Commit:** `c8db403`
**Files:** `index.html`
**What changed:** Offer date rows now use `display:flex` with `align-items:center` so the label and date value are vertically aligned.
**Revert:** `git checkout c8db403~1 -- index.html`
