---
run: 2026-07-29-ios-simulator-mobile-qa
task: "when finished with the previous tasks, utilize the iOS Simulator to ensure that Yield Vector functions 100% appropriately, and presents 100% appropriately on mobile in addition to desktop. Ensure no odd formatting, asymmetrical spacing, excessive or inadequate sizing of any component causing cut off text, excessive white space infringing upon something else/adjacent, etc."
status: in-progress
created: 2026-07-29T06:55:00Z
config_snapshot: { planner: fable, executor: opus, worker: sonnet, codex: { planner: review-before-approval, executor: review-after, worker: review-after } }
plan_approved: true  # owner advance directive (in-chat 2026-07-29): elect top plan following Codex review; Codex findings folded below
current_step: 1
---
## Context
Sequel run queued behind 2026-07-29-scope-arch-aesthetic-review (dispatch only after that run reaches done). Yield Vector v2026.07.14b on main (HEAD 63facc2). Goal: real-device-class QA — the app driven in the iOS Simulator (Safari, real WebKit + safe-areas + touch) AND desktop, hunting layout/formatting defects (cut-off text, asymmetric spacing, over/under-sized components, whitespace collisions) and functional breaks in core flows. Defects found get fixed, re-verified, and released per repo protocol. Owner advance-approval (in-chat 2026-07-29) covers electing the top plan after each Codex review — no further approval gates this run except a genuine scope fork.

## Key decisions
- BASELINE REVALIDATED at dispatch (2026-07-29, per G8): HEAD still 63facc2, v2026.07.14b, live==HEAD confirmed by run-1 step 2; worktree carries the pre-existing modified 2026-07-13 run checkpoint + run-1/run-2 checkpoint files (committed by planner at run-1 close) — no product-file changes. Run 1 reached step 5 (email) at dispatch time; QA sweep is read-only so no conflict.
- PLAN GATE (Codex Sol, 2026-07-29) — findings FOLDED: (G1) owner-data safety hardened: unique fresh port, clear storage/caches/service-workers first, assert `yv-allow-local-sync` absent + sync unconfigured, block/monitor api.github.com + any Worker URL (localhost guard alone doesn't cover the DoC Worker, sync-pwa.js:235). (G2) Chromium-380px fallback CANNOT close an iOS gate — if no simulator boots, R92 stays open and the report says so. (G3) results scoped to Safari-in-simulator explicitly; standalone-PWA safe-area checked only if installable there, else stated as untested. (G4) breakpoint matrix added: automated Playwright checks bracketing the CSS boundaries 340/420/480/720/880/1024 (index.html:270) + desktop 1024 AND 1280; simulator covers one small + one notched phone if available, portrait AND landscape, keyboard-open modal state. (G5) "zero console errors" is unmeasurable via the simulator MCP — desktop console via Playwright, simulator via the in-app diagnostics ring, limitation reported honestly. (G6) surface sweep replaced with a concrete checklist: 4 nav views + 2 Plan segments; "Upcoming actions" on Home; checklists live on offer cards (render-shell-overview.js:88); include optimizer apply/undo, persistence-after-reload, chart tap targets, validation failures, commitment/event tables, offline/SW-reload — anything skipped is listed as an exclusion. (G7) R92 gate items: only (b) hero-label and (e) timeline-label-fit are objectively verifiable; (a)(c)(f) are owner eye-calls — screenshots are EVIDENCE, closure stays with the owner. (G8) baseline (HEAD/version/git status/HANDOFF) re-validated at dispatch time — run 1 may move it. (G9) full battery runs EVEN IF zero defects found (else "functions appropriately" rests on manual sampling alone). (G10) synthetic fixture made reproducible: schema, scenario→offer mapping, dates, expected states, reset procedure recorded in the QA report. (G11) QA artifacts live in the SESSION SCRATCHPAD (/private/tmp/..., outside the checkout) — Codex's untracked-files concern is moot but the absolute path is now explicit. (G12) fixes split by subsystem with per-subsystem commits (30-min push protocol respected). (G13) post-review fold → RERUN affected UI cases + pins + node --check + stray-scan BEFORE push. (G14) release protocol completed: CHANGELOG.md entry required (AGENTS.md:67); target version 2026.07.29 if fixes ship; verify all 21 literals + 0 strays; verify LIVE Pages serves the new version post-push; tag naming follows AGENTS.md convention stable-YYYY-MM-DD (so stable-2026-07-29 for a new release) — run 1's "stable-2026-07-14b" suggestion is dropped as convention-breaking; report distinguishes "no new release" from "v2026.07.14b now eligible for an owner-approved stable tag". (G15) tiers: step 3 split — executor re-verifies + folds review findings; NEW worker step handles the mechanical release (bump ×21, CHANGELOG, HANDOFF, commit/push) after final verification, matching the prior release's separation.
- OWNER-DATA SAFETY (hard rule, same as run 1): the simulator NEVER opens the live site with sync configured; QA runs against a locally served fresh origin (simulator Safari shares the host loopback, so http://localhost:<port> works) seeded with SYNTHETIC data via a same-origin seed page (write localStorage → redirect into the app). The app's `yv-allow-local-sync` guard already blocks sync on localhost by default. Zero Gist/token exposure.
- iOS Simulator is the primary mobile surface (real WebKit rendering, notch/safe-area, touch targets) — Playwright 380px emulation is the FALLBACK only if no simulator can boot on this Mac (record the substitution honestly if so).
- The simulator MCP is a single shared resource → exactly ONE agent drives it at a time. Desktop verification uses Playwright headless in the same agent (no Browser-pane contention with the main session).
- This QA doubles as evidence capture for the outstanding owner device-check gate (R92 items a,b,c,e,f) — each item gets a screenshot + pass/attention note so the owner can close the gate from the report and the stable tag can finally be cut (recommended name per run 1: stable-2026-07-14b; cutting it stays an owner call).
- Fix scope guard: layout/formatting/functional DEFECTS only. No palette/theme changes (run 1's aesthetic variants are a separate owner decision); locked design values in AGENTS.md respected — a defect whose fix would touch a locked value gets flagged, not fixed. Typography stays parked.
- If the sweep finds ZERO defects: no version bump, no release — the report says so plainly and the run closes.
- Release protocol if fixes ship: APP_VERSION bump ×21 (js/runtime-status.js, sw.js, index.html ×19 `?v=`), full battery (optimizer 86, feasibility 21, parser 24, fidelity 67, dd-matrix, p2b, node --check), HANDOFF.md entry prepended, Codex adversarial post-review pre-push, explicit-path git add only (owner-owned paths untouched), push to main.

## Steps
### 1. Simulator + desktop QA sweep  [tier: executor] [codex: review-after] [status: in-progress]
Intent: Boot an iPhone simulator (attach the live panel first — cheap, and the owner may watch), serve the repo on a local port with a synthetic-data seed page, and sweep EVERY surface at mobile: Home (hero chart, stat row, banners), offer cards (all statuses incl. stale-chip + windowPassed states), timeline (narrow bars with $ labels, phone width), Optimize panel (pre/post-run, breach banner, alternative cards), Add/Edit offer modal (all offer types, requirement rows, date pickers incl. grayed days + violation hints, either/or chooser), Add/Edit event modal (neutral picker, recurrence), Settings, reminders/checklist views, DoC import (paste mode). Functional passes on simulator: add offer → appears everywhere; edit dates via picker; run optimizer; Move-to-today tap; modal open/close; scroll behaviors. Same sweep on desktop via Playwright 1280px. Hunt specifically: cut-off/clipped text, asymmetric spacing, over/under-sized components, whitespace collisions, safe-area intrusions (notch/home-indicator), tap-target adequacy, horizontal overflow, console errors. Capture R92 gate items (a) neutral-picker formatting vs colored pickers, (b) hero-chart right end at a Dec-11-horizon scenario, (c) chooser copy order, (e) timeline $-label fit at phone width, (f) DoC import placement — one screenshot each + note. OUTPUT: severity-ranked findings list (P1 functional / P2 clear visual defect / P3 polish) each with screenshot path + suspected cause (file:line where cheap), plus the gate-item evidence pack. Screenshots to scratchpad/qa/. Read-only step — no fixes yet.
Expected files: scratchpad/qa/*.png, scratchpad/qa/findings.md (no repo changes)
Outcome:
Files:
Decisions:
Open issues:

### 2. Fix batch  [tier: executor] [codex: review-after] [status: pending]
Intent: Fix confirmed P1/P2 findings (P3 only where trivial and riskless), respecting the scope guard in Key decisions. CSS/layout in index.html + render modules; behavioral fixes get pins. If any finding's fix would touch a locked design value or is a taste call, flag it in the report instead of fixing. APP_VERSION bump ×21 + HANDOFF entry IF anything shipped. Skipped entirely if step 1 finds nothing actionable.
Expected files: index.html, js/render-main-views.js and/or other touched modules, HANDOFF.md
Outcome:
Files:
Commit:
Decisions:
Open issues:

### 3. Re-verify + fold review findings  [tier: executor] [codex: review-after] [status: pending]
Intent: Re-drive every fixed screen on simulator + desktop (before/after screenshots at the affected breakpoints), run the FULL battery + node --check (this step runs even if step 2 shipped nothing — battery-only in that case), confirm desktop console clean via Playwright + simulator diagnostics ring clean, zero horizontal overflow at 340/380/simulator widths. Then Codex adversarial post-review (scope branch, -m gpt-5.6-sol); fold critical/high findings and RERUN affected cases + pins + stray-scan after folding.
Expected files: repo (fix-up edits only if review findings folded)
Outcome:
Files:
Commit:
Decisions:
Open issues:

### 4. Mechanical release  [tier: worker] [codex: review-after] [status: pending]
Intent: Only if steps 2-3 shipped changes: APP_VERSION → 2026.07.29 across all 21 literals (js/runtime-status.js, sw.js, index.html ×19 `?v=`), 0-stray scan, CHANGELOG.md entry per AGENTS.md:67, HANDOFF.md entry prepended, explicit-path git add, commit + push to main, then verify the LIVE Pages site serves 2026.07.29 (curl, allow 30-90s rebuild + 600s edge TTL). Skipped with a stated reason if nothing shipped.
Expected files: js/runtime-status.js, sw.js, index.html, CHANGELOG.md, HANDOFF.md
Outcome:
Files:
Commit:
Decisions:
Open issues:

### 5. Run report  [tier: planner] [codex: review-after] [status: pending]
Intent: Compact owner summary — findings table (fixed / flagged / gate-item evidence), before/after shots, battery results, release version if any, and the device-check gate disposition (objective items (b)(e) verified or not; eye-call items (a)(c)(f) presented as evidence for the owner). Because this report may declare gate/release readiness, it gets a lightweight Codex look before delivery.
Expected files: none
Outcome:
Files:
Decisions:
Open issues:
