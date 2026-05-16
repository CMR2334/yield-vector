# Yield Vector — Changelog

Significant changes to this project, in reverse chronological order.

**How to revert a change:**
- To undo a commit cleanly (creates a new revert commit): `git revert HASH`
- To restore a single file to an earlier state without a revert commit: `git checkout HASH -- index.html`
- To see what a commit changed: `git show HASH`

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
