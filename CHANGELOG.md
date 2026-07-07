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

## 2026-07-06 — Display formats for dates & money (M-D-YYYY, live thousands commas) + `$`-prefix, un-abbreviated K, label letterspacing
**Commit:** _pending — not yet committed, DO NOT COMMIT per owner instruction_ (v2026.07.06e)
**Files:** `index.html`
**What changed:** A five-item owner batch, all display/input-UX. **Hard constraint honored:** storage/sync formats are unchanged — dates remain ISO `YYYY-MM-DD` and money remains a plain Number in state/localStorage/Gist and every internal comparison. The new display forms (dates `M-D-YYYY` with no leading zeros e.g. `7-6-2026`; money comma-grouped e.g. `25,000`) live ONLY in input `value`s and rendered strings, converted at a single boundary by four new helpers near line 4025: `formatDateDisplay`/`parseDateInput` (ISO↔`M-D-YYYY`, the parser also tolerates `M/D/YYYY` and a pasted ISO and rejects impossible dates) and `formatMoneyInput`/`parseMoneyInput` (Number↔comma-grouped; parser strips `$`/commas/spaces, empty→`null` to preserve the existing `num('')===null` contract). **[1] Dates:** every `yv-date` field (offer modal `#f-debit-by`/`#f-expires`/`#f-signup`/`#f-funded`, DD-row `plannedDate`) renders and round-trips through the date helpers; placeholders `YYYY-MM-DD`→`M-D-YYYY`; fields are no longer `readonly` so the custom picker still opens on tap AND typing/paste works, with a capture-phase `blur` normalizer that rewrites a valid typed/pasted value in canonical `M-D-YYYY`. Already-humanized renders ("Aug 11", timeline axis "Jul 6 → Oct 11"), native `<input type="date">` (commitment start/end), and chart-internal date rendering are untouched. **[2] Money:** all money inputs are now `type="text" inputmode="decimal" data-money`, render stored values with commas, format live on each keystroke (`reformatMoneyFieldLive`, caret preserved by significant-digit count), and every read path parses via `parseMoneyInput` — `readOfferForm`, settings `onChange`, `readDdRowsFromForm`, the DD funding-split divisor in `generateDdDatesFromRequirement`, `readCommitmentForm` (amount + expectedBonus), `readEventForm`, and the event-modal live sign-flip. (The one surviving `Number(el.value)` is the non-money settings branch — projectionHorizonDays/maxOptimizerCandidates, still `type=number` — verified correct.) **[3] `$` prefix:** `.field-box` and `.dd-row` `.input-prefix` color `--text-tertiary`→`--text-strong` (`#374151`), gap kept snug at `margin-right:4px`, so the symbol reads as part of the value. **[4] Un-abbreviated K in exactly two spots:** Overview hero "Lowest" sub-line and the at-a-glance BONUS POOL card value switch `formatCompactCurrency`→`formatCurrency` (now `$125,000` not `$125K`); the card is not resized — a render-time `.snap-v-sm` class (19px→16px) engages when the formatted string is ≥8 glyphs so large values fit at 375px. Chart axis labels (`200K`), offer-card stat abbreviations (`$25K FUNDING`), timeline bar labels, and "Lowest projected" stat cards stay abbreviated. **[5] Letterspacing:** the spaced-out uppercase labels `.hero-label` ("AVAILABLE CAPITAL TODAY", 0.06em→0.02em; mobile 0.04em→0.02em) and the Timeline `.timeline-row-label.axis` date-range row (0.05em→0.02em) tightened to read cohesively. No chart-internal text changed. `APP_VERSION` bumped 2026.07.06d → 2026.07.06e.
**Verification:** `node --check` on the extracted inline script passes; 24 isolated helper assertions pass (date/money round-trips + overflow rejection); locked chart/legend/tooltip hex counts (AGENTS.md) identical to HEAD. Full behavior verified via the Preview MCP (`yield-vector-static`, port 4173) at 375px: a create→save→reopen cycle stores `plannedSignupDate:"2026-08-01"` and `requiredFundingAmount:5000` (ISO string / plain Number, no display leakage) and repopulates the form as `8-1-2026` / `5,000`; typing `5000` shows `5,000` live with a correct caret; `8/1/2026` and a pasted ISO both normalize to `M-D-YYYY` on blur; settings and DD-row money round-trip to plain Numbers; the hero "Lowest $125,000 on Jul 13" line and the full BONUS POOL value fit at 375px; hero + Timeline label letterspacing measure 0.0200em. Zero console errors and zero diagnostics-ring entries across the cycle; injected test data was cleaned up afterward (owner state restored).
**Revert:** `git checkout HASH -- index.html` once committed, or discard the uncommitted working-tree changes.

---

## 2026-07-06 — Field-box vertical rhythm (label/value spacing + modal label-height fix)
**Commit:** _pending — not yet committed, DO NOT COMMIT per owner instruction_ (v2026.07.06d)
**Files:** `index.html`
**What changed:** Owner feedback on R57–R60's `.field-box` boxes: "It just looks awkward now with the box heights. They may be a bit big/tall but also think it's just that the label text is a bit too close to input vertically." Diagnosis: generous outer padding paired with a tight label-to-value gap made the pair read cramped inside an oversized box. Fixed both ends. **(1) Label-to-value gap:** `.field-box` `gap` 2px → 6px, so the label visibly separates from its value instead of nearly touching it. **(2) Container padding:** `.field-box` vertical padding 12px → 10px (horizontal 18px unchanged), trimming the outer margin by the same 4px the gap grew by — net box height is unchanged for single-line-label fields (e.g. Settings → "Current liquid capital": 68.59px before and after), but the *internal balance* moved from "way more space around the pair than between its two halves" (13px above / 2px gap / 13px below) to a balanced rhythm (11px above / 6px gap / 11px below) matching the requested ~1.8x ratio. **(3) Modal label-height bug (found during verification, not previously known):** measuring the Add-offer modal's boxes surfaced a real, separate defect — `#offer-form .field label` (R57, ~line 1504) sets `min-height:30px; display:flex; align-items:flex-end` for the OUTSIDE-box group-label bottom-pin pattern, but its selector also matches labels nested *inside* `.field-box` in every offer/commitment/event modal, and wins the cascade there (ID+class beats `.field-box label`'s class+class). Every single-line in-box label in those modals was being force-stretched to 30px instead of its natural ~15.6px, inflating those boxes to 79–83px — well above the 64–72px target and above Settings' otherwise-identical fields, which explains why modal boxes specifically looked oversized. Added `#offer-form .field-box label { min-height:0; display:block; align-items:normal }` immediately after the existing `#offer-form .field > .field-box { margin-top:auto }` box-pinning rule (same file region, same specificity trick already used for the analogous `.modal .field-box .input[type="date"]` 44px-override at ~line 1817) to reset it back to `.field-box`'s own sizing. Two-line labels (e.g. "Funds must remain deposited through day * (from funded date)") are unaffected by either change and still grow naturally to fit their wrapped text. `.dd-row`'s slimmed variant does not share `.field-box`'s `gap`/`padding` rules (has its own `padding:8px 10px`) and was left untouched per scope. The native `<select>` chevron uses `appearance:auto` (browser-drawn, no custom `background-position`), so it is unaffected by the padding/gap change by construction. `APP_VERSION` bumped 2026.07.06c → 2026.07.06d.
**Before → after measurements (375px, via `preview_inspect`/`getBoundingClientRect`):**
| Field | Before height | After height | Before (above/gap/below) | After (above/gap/below) |
|---|---|---|---|---|
| Settings "Current liquid capital" (single-line label) | 68.59px | 68.59px | 13 / 2 / 13.9 | 11 / 6 / 11.9 |
| Settings "Projection horizon" (select) | 64.59px | 64.59px | 13 / 2 / 13 | 11 / 6 / 11 |
| Modal "Bank name *" (single-line label) | 79.59px | 65.19px | 13 / 2 / 13.9* | 11 / 6 / 11 |
| Modal "Bonus amount *" (single-line label) | 83.00px | 68.59px | 13 / 2 / 13.9* | 11 / 8.5 / 11.9 |
| Modal "Funds must remain deposited through day * (from funded date)" (2-line label) | 81.78px (label force-capped, value already not crowded) | 81.78px | 11 / 7 / 11 | 11 / 7 / 11 (unchanged — 2-line label already exceeded the 30px cap) |

*Modal single-line rows' "before" spacing numbers reflect the 30px-label bug on top of the old 2px/12px box rules — the modal-only label-height fix (item 3) is what actually drops their height from ~80px to the Settings-matching ~65–69px; the gap/padding change alone (items 1–2) would not have been sufficient there.
**Verification:** `node --check` on the extracted inline script passes. Locked chart/legend/tooltip hex count (AGENTS.md) unchanged (33, before and after). Visually verified via the Preview MCP (`yield-vector-static` config) at 375px — Settings (Capital & projection fields) and the Add-offer modal (Bank name focused + unfocused, Bonus amount with a typed value, the two-line "Funds must remain..." field under Held+DD, a select, a date field) — and at desktop (1280px), both rendering correctly with no regressions. Whole-box click-to-focus verified structurally intact: every `.field-box` label keeps its native `<label for>` / `<input id>` pairing (e.g. `for="f-expires"` / `id="f-expires"`), which neither CSS change touches; the browser's native label-click-forwards-to-control behavior is unaffected.
**Revert:** `git checkout HASH -- index.html` once committed, or discard the uncommitted working-tree changes.

---

## 2026-07-06 — Button-row uniformity + offer-card height verification
**Commit:** _pending — not yet committed, DO NOT COMMIT per owner instruction_ (v2026.07.06c)
**Files:** `index.html`
**What changed:** Two owner-reported UI refinements. **(1) Button-row uniformity (mobile):** Settings → sync-actions row (Save & test / Create new Gist / Pull now / Push now / Restore from history / Disconnect) and the Data row (Export JSON / Import JSON / Reset to sample data / Clear all data) previously used `display:flex; flex-wrap:wrap`, which sized each button to its own label width and wrapped into ragged, mismatched-width rows on phones. Replaced both with a new shared `.btn-grid` class (`display:grid; grid-template-columns:repeat(auto-fit, minmax(140px,1fr))`) — the same auto-fit/minmax pattern R58 already established for `.dd-timing-row` — giving every button equal width and height at any viewport, 2-up on phones, wider rows on desktop, with no hardcoded breakpoint. "Disconnect" additionally lost its `.btn-ghost.btn-danger` combo (no border, sat visually misaligned beside its bordered `.btn-secondary` siblings) in favor of a new `.btn-outline-danger` class — transparent background, `--danger`-colored border and text, so it reads as an outlined danger pill matching its siblings' shape rather than a borderless link or a solid destructive button. Swept diagnostics ("Copy diagnostics"/"Clear log") and the error-state actions row (Reload/Copy diagnostics) — both are 2-button rows that fit side-by-side at 375px and were left unchanged; modal footers (Delete | Cancel | Save changes) were confirmed intentional per explicit owner sign-off and also left unchanged. **(2) Offer-card height verification (no code change):** owner asked whether offer cards had picked up new blank space above the card label during the recent form-restyle rounds (R57/R58). Extracted the pre-restyle build (commit `0ae5ee3`) and diffed `.offer-card`/`.offer-card-header`/`.offer-name` CSS rules byte-for-byte against the current build — identical in both. Rendered both builds side-by-side at 375px (Offers tab and Planner tab, which share the same `renderOfferCard()` function) and confirmed pixel-identical layout, header height (41.5px), and label position (flush at the header's top edge, zero internal gap). The only "space above the label" is the card's own `padding-top: var(--space-5)` (20px) — the same shared card-padding token used by the hero card, stat cards, and every other card type in the app, not something oversized or leaked specifically onto offer cards. Verdict: **the card did not change; the appearance is pre-existing and is standard, intentional, systemic card padding** — not a regression, and not a low-risk isolated artifact, so no compaction was applied (would require touching a token shared by every card in the app, outside this task's spacing/alignment-only, non-restructuring scope). `APP_VERSION` bumped 2026.07.06b → 2026.07.06c.
**Verification:** `node --check` on the extracted inline script passes; locked chart/legend/tooltip hex counts (AGENTS.md) unchanged before/after. Visually verified via the Preview MCP (`yield-vector-static` config) at 375px and desktop (1280px): both button grids render with equal-width cells (measured via computed `grid-template-columns`, e.g. 6×190.664px at desktop for the sync row), "Disconnect" confirmed transparent-bg/red-border/red-text at both widths, Offers-tab and Planner-tab cards confirmed unchanged pre/post edit.
**Revert:** `git checkout HASH -- index.html` once committed, or discard the uncommitted working-tree changes.

---

## 2026-07-06 — Typography hierarchy, segmented-control centering, DD-timing uniformity
**Commit:** _pending — not yet committed_ (v2026.07.06a)
**Files:** `index.html`
**What changed:** Three owner-requested refinements to the R57 `.field-box` label-inside-container pattern. **(1) Typography hierarchy:** labels and values were too visually close. Group labels (the uppercase letterspaced headings outside boxes, e.g. "OFFER TYPE *") moved one shade lighter (`--text-secondary` → `--text-tertiary`) and one weight step down (600 → 500). Inside-box labels (`.field-box label`) matched to the same `--text-tertiary` tone (were `--text-secondary`, one shade darker than the group labels). Input VALUE text (`.field-box` inputs/selects/textareas, plus the slimmed `.dd-row` variant) dropped to regular weight (500 → 400) and moved to a new dedicated `--text-strong` token (`#374151`) — one shade lighter than the heading-tone `--text` (`#2a2e3d`) it previously used, added because no existing token sat between `--text` and `--text-secondary`. Net effect: muted small label vs. dark regular value, clearly distinct at a glance, still comfortably AA-readable (9.9:1 contrast on the field background). **(2) Segmented-control vertical centering:** single-line options (e.g. "HELD + DD") were bottom-anchored instead of centered against two-line siblings ("NEW FUNDS HELD") because `#offer-form .field label`'s bottom-pin rule (`align-items:flex-end`, meant for the group-level label) was unintentionally winning over `.radio-group label`'s own `align-items:center` for every individual segment inside `#offer-form`. Added a higher-specificity `#offer-form .field .radio-group label` override restoring `align-items:center; justify-content:center` with a uniform `min-height:40px` — fixes every segmented control sharing the component (Offer type, DD-requirement mode, Funded/Open date, Debit requirement), not just offer type. **(3) DD transfer-timing row uniformity:** the three "in"/"season"/"back" mini inputs (Settings → Direct-deposit transfer timing) previously sized by mismatched per-item `max-width` guesses (130/150/140px) tuned to roughly fit each suffix word. Replaced with a new `.dd-timing-row` CSS Grid (`repeat(auto-fit, minmax(132px, 1fr))`) — identical widths by construction at every viewport, collapsing gracefully to fewer columns on narrow screens instead of wrapping untidily; the 132px floor was tuned against a defensively-typed 3-digit value ("999") to confirm the suffix never crowds the value. Locked chart/legend/tooltip/card-title/modal-title/button hexes and text (AGENTS.md) untouched — grepped locked-hex counts before/after to confirm no drift. `APP_VERSION` bumped 2026.07.06 → 2026.07.06a.
**Verification:** `node --check` on the extracted inline script passes. Visually verified via the Preview MCP (`yield-vector-static` config) at desktop (1280px) and mobile (390px, 320px) widths: Settings page (group labels vs. values, DD-timing row equal-width + no crowding at 999), and the Add/Edit Offer modal (box labels vs. values, offer-type segmented control, DD-requirement mode, Funded/Open date) at both widths.
**Revert:** `git checkout HASH -- index.html` once committed, or discard the uncommitted working-tree changes.

---

## 2026-07-06 — Form inputs restyled to inside-label container pattern
**Commit:** _pending — not yet committed_ (v2026.07.06)
**Files:** `index.html`
**What changed:** Restyled every text/number/date/select/textarea field to a fintech-settings-style pattern (owner-provided reference): a rounded bordered container (`--card-soft`/`--border-soft` tokens, `--radius-lg`) with the label moved INSIDE it, sitting small and muted above the value; the input itself becomes borderless/transparent inside the box. New `.field-box` wrapper class holds `label` + the control (input/select/textarea, or an `.input-group` for $-prefixed/suffixed fields); focus state moves the border/ring to `.field-box:focus-within` using the app's own `--accent`/`--accent-soft` tokens (not the reference screenshot's purple). Applied to the Settings "Capital & projection" grid, the Cloud sync Gist ID/PAT fields, and every text/number/date/select field across the Add/Edit Offer, Capital Commitment, and Capital Event modals — including the advanced fields (DoC URL, Entity, Email, Notes). Radio-groups, checkbox rows, and the offer color-picker are intentionally left unstyled (no single label+value shape to box) per the design brief. The DD entry rows (`renderDdRow`, no per-row label) got a slimmed variant instead of the full container — a compact rounded border on each input rather than a label-holding box, since a per-row label would just repeat the group's "Planned direct deposits" label N times. Locked chart/legend/tooltip design values (AGENTS.md) untouched — this change never touches those hexes or their CSS rules. `APP_VERSION` bumped 2026.07.05 → 2026.07.06. No behavior, ids, name attributes, or form-reading logic (`readOfferForm`, etc.) changed — verified via `node --check` on the extracted inline script and a diff confirming only HTML template-literal regions changed.
**Follow-up fix (same round):** The `$`-prefix in `.input-group` fields (Settings liquid capital/buffer, offer Bonus amount/Required funding, DD-row amount, commitment Amount/Expected bonus, event Amount) overlapped the value's first digit once a value existed — the base `.input-group` mechanism absolutely-positions `.input-prefix` and relies on a padding-left guess on the input to clear it, and the guess (16px) was too small for a 16px-font "$" flush at `left:0`. Fixed by making `.field-box .input-group` (and the DD-row's slimmed equivalent) a real flex row: prefix as a static in-flow item, input `flex:1` with no padding hack — overlap isn't possible by construction. Suffix fields (`with-suffix`, e.g. "days") kept their original absolute-right mechanism unchanged (confirmed already rendering correctly). Also fixed a double border on the DD-row amount input (it sat inside `.input-group`, which already carried the border/background — the inner input needed `border:none;background:transparent`). Verified visually via the preview server with real values typed into every affected field, plus a repeat `node --check` and locked-hex count check.
**Revert:** `git checkout HASH -- index.html` once committed, or discard the uncommitted working-tree changes.

---

## 2026-07-05 — Sync compare-and-swap (stop stale-device data loss)
**Commit:** _pending Codex review_ (v2026.07.05)
**Files:** `index.html`
**What changed:** Fixed a data-loss class where a device editing stale data could forge newness (both `App.save` and `Sync.push` stamped `_lastModified = Date.now()` unconditionally) and the automatic push path had no cloud check — a stale desktop auto-push clobbered offers added on mobile. Added a per-state lineage field `_baseRevision` (the Gist `history[0].version` the local state was last pulled-from / pushed-as, persisted to localStorage + the Gist payload). `Sync.push` is now a single unified compare-and-swap: it peeks at the cloud head before PATCHing and, if the cloud moved off our lineage, treats that as a conflict **regardless of timestamps** (a stale device that re-stamped `_lastModified` newer can no longer wave a clobber through). Resolution keys off a dirty marker persisted with the state as `_dirtySince` (so unsynced edits survive a reload — a volatile flag alone would reset on reopen and the CAS would then silently adopt over saved-but-unpushed edits): a merely-stale device (no unsynced edits) adopts the cloud silently; a device with unsynced edits AND a moved cloud gets a `confirm` dialog (adopt cloud = safe default / overwrite cloud); a background auto-sync that can't ask defers the cycle and logs a `*-conflict-deferred` diagnostic for the next foreground sync to resolve — never silently picking a side. Both sync directions are guarded and share ONE conflict resolver (`resolveDirtyConflict`) so the dialog and semantics can't drift: the PUSH side blocks a stale/dirty device from clobbering a diverged cloud, and the PULL side (`safeSync`'s remote-newer branch) no longer blind-adopts over a dirty device — previously it silently discarded the very unsynced edits the dirty marker exists to protect (the mirror of the push hole). On a successful PATCH — or whenever a sync sees equal cloud/local timestamps (proof the local edit is already in the cloud) — it clears the dirty marker, so a PATCH whose response was lost can't leave the device falsely dirty and raise bogus conflict prompts later. The uploaded payload is scrubbed of `_dirtySince` (serialized from a shallow copy) so another device can't inherit this device's dirty marker and later offer to clobber newer cloud data; the local marker itself clears only on PATCH success. The precheck fails CLOSED — if the cloud GET fails it never falls back to an unguarded PATCH: a permanent failure (HTTP 401/403/404 — expired/revoked token, deleted or wrong gist id) surfaces as a sync error with a "Push failed: HTTP <code>" prompt so the user fixes credentials, while a transient/network failure defers (status pending, dirty marker kept, retried next cycle), so a flaky network can't bypass the guard. Purely-automatic saves (the projection-date auto-roll, the fresh-device sample seed) use an `App.save({system:true})` path that does NOT mark the device dirty, so a stale-but-clean device whose date rolled won't wrongly trip the conflict dialog (a reflexive Cancel would otherwise clobber the cloud with stale data). `safeSync` (including the equal-timestamp path, which now seeds `_baseRevision` so the guard isn't silently disabled on a build's first run), manual pull/push, "Save & test", "Restore from history", and new-Gist creation all set/refresh `_baseRevision`; manual "Pull now" additionally warns before discarding a dirty device's edits. `force`-overwrite is reachable only after an explicit user overwrite/make-truth choice (the conflict dialog's overwrite branch on either side, or "Restore from history"); the manual "Push now" button routes through the unforced CAS (it no longer does its own timestamp check and force past the guard, which a re-stamped stale device could sail through). Unknown lineage (an old payload with no `_baseRevision`) is handled by ONE unified first-sync rule (`resolveFirstSync`, shared by both the push and pull paths): the cloud is adopted silently (seeding lineage) when nothing can be lost — equal live timestamps, OR the state loaded this session matched the cloud and only automatic system stamps have moved local since (a load-time snapshot, so a startup date-roll doesn't force a needless prompt), OR a trivial local state (no offers, commitments, events, or source banks, and not dirty — nothing a user could lose) — while an existing but DIVERGENT cloud triggers exactly one prompt that recommends "Adopt cloud" ("First sync on this device's new version…") — timestamps carry no signal while lineage is unknown, so this single rule replaces the earlier per-direction timestamp heuristics (which had a pull-side hole: a device whose local timestamp was OLDER than the cloud would silently adopt over genuine unpushed pre-upgrade edits). Only a truly empty/fresh gist accepts an unguarded seed push. After the first resolution lineage seeds and the rule never fires again; explicit adopt actions (manual Pull with its dirty warning, "Save & test", "Restore from history") bypass it. Expected UX: at most one dialog per device on its first divergent sync after upgrading. **Caveat:** the guard is only bilateral once BOTH devices are on v2026.07.05. Per-offer merge deferred (needs per-offer timestamps).
**Revert:** `git revert <hash>`

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
