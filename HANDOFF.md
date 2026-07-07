# HANDOFF — Yield Vector

Cross-session AI changelog. Sessions run across multiple Claude logins and
models; each entry records what the *previous* session shipped so *this*
session picks up without the user re-narrating.

**Session start:** read the Current state block below plus the top 2–3 log
entries, then proceed. **After each meaningful round of changes:** prepend a
new log entry (template at the bottom). Keep entries factual and short — file
paths, function names, the *why* behind non-obvious choices, and any "do not
redo" dead ends. Be proactive; the user won't remind you.

Durable facts (architecture, protocols, locked design values) belong in
[AGENTS.md](AGENTS.md), not here — log entries eventually get archived to
[HANDOFF_ARCHIVE.md](HANDOFF_ARCHIVE.md). Archive older rounds when this file
grows past ~8 entries, keeping the newest 3–4 live.

---

## Current state (as of 2026-07-06, Round 62)

- `index.html` ≈ 8,900 lines, single-file PWA. `APP_VERSION` = `2026.07.06e`
  (shown in Settings → About & diagnostics; bump + tag `stable-YYYY-MM-DD` +
  CHANGELOG entry on each confirmed-good release). R56–R61 are all committed
  and deployed (R56 sync fix passed a 10-round Codex review before shipping;
  the per-round "DO NOT COMMIT" notes meant "coordinator commits after
  verification," not that work stays uncommitted). No stable- tag yet — owner
  hasn't confirmed-good. Sync guard is bilateral once both devices run
  ≥ 2026.07.05 (confirmed on the owner's phone via diagnostics).
- **Field-box vertical rhythm (R61):** `.field-box` `gap` 6px (was 2px),
  vertical padding 10px (was 12px) — box height is unchanged for single-line
  fields, but the label now visibly separates from its value instead of
  nearly touching it. Also fixed a real bug found during verification:
  `#offer-form .field label`'s `min-height:30px` bottom-pin rule (meant for
  labels OUTSIDE a box) was also winning inside `.field-box` in the offer/
  commitment/event modals, force-stretching every single-line in-box label
  there to 30px and inflating those boxes ~15px taller than Settings'
  otherwise-identical fields. Reset via `#offer-form .field-box label {
  min-height:0; display:block; align-items:normal; }` (~line 1672, right
  after the `#offer-form .field > .field-box { margin-top:auto; }`
  box-pinning rule). Don't reintroduce a `min-height`/`align-items:flex-end`
  on `.field-box label` without re-checking this interaction.
- **Display ↔ storage boundary (R62):** dates and money now have a
  DISPLAY form (dates `M-D-YYYY` no-leading-zero e.g. `7-6-2026`; money
  comma-grouped e.g. `25,000`) that exists ONLY in input `value`s and
  rendered strings. Storage/sync is unchanged — dates stay ISO
  `YYYY-MM-DD`, money stays a plain Number, in state/localStorage/Gist
  and every internal comparison. Four helpers (~line 4025) are the single
  conversion point: `formatDateDisplay`/`parseDateInput` and
  `formatMoneyInput`/`parseMoneyInput`. Every money read-site parses via
  `parseMoneyInput` and every `yv-date` read-site via `parseDateInput` —
  do NOT add a bare `Number(el.value)`/`parseFloat`/`dateEl.value` on a
  `data-money` or `.yv-date` field (a `"5,000"`→NaN or `"8-1-2026"`→state
  path is data corruption). Native `<input type="date">` fields
  (commitment start/end) are already ISO and are left browser-formatted.
- **Button-row layout (R60):** standalone multi-button action rows (Settings
  sync-actions row, Data row) use a new `.btn-grid` class
  (`grid-template-columns:repeat(auto-fit, minmax(140px,1fr))`) instead of
  `flex-wrap`, for equal-width buttons at every viewport — same pattern as
  `.dd-timing-row` (R58). New `.btn-outline-danger` class (transparent bg,
  `--danger` border+text) replaces the `.btn-ghost.btn-danger` combo on
  "Disconnect" so it gets a visible pill outline like its siblings. Modal
  footers and 2-button rows (diagnostics, error-state) were swept and
  intentionally left on flex — see R60 log entry for why.
- **Form styling (R57 + R58 + R61 tuning):** every text/number/date/select/
  textarea field uses the `.field-box` label-inside-container pattern;
  radio-groups, checkbox rows, and the color-picker are intentionally NOT
  boxed. DD entry rows (`renderDdRow`) use a slimmed bordered-input variant
  instead of the full box (own `padding:8px 10px`, does not share
  `.field-box`'s gap/padding rules). R58 tuned the typography hierarchy
  (group/box labels lighter + lighter weight via `--text-tertiary`; values
  regular-weight via new `--text-strong` token), fixed segmented-control
  vertical centering (`#offer-form .field .radio-group label` override), and
  gave the DD transfer-timing row a real equal-width grid (`.dd-timing-row`).
  R61 tuned the label/value gap + container padding and fixed the modal
  label-height bug above. See AGENTS.md-adjacent reasoning in the R57/R58/R61
  HANDOFF entries before changing input/label CSS again.
- **Offer types:** `new-funds-held`, `direct-deposit`, `held-and-dd` ("Other"
  removed, R37). Held+DD models the held lump sum AND the DDs (R53); planned
  funding date is *required* for Held+DD, optional for new-funds-held.
- **Status model:** `accountStatus` (open/closed) + 9-value `subStatus`;
  legacy `offer.status` survives as a derived shadow — don't remove (R38).
- **Cloud sync:** GitHub Gist; restore-from-history modal + a compare-and-swap
  `Sync.push` (lineage field `_baseRevision` = last-synced `history[0].version`;
  R56) protect against last-writer-wins overwrites — the auto-push path now
  declines + adopts when the cloud is genuinely newer. `guardedManualPush`
  keeps its confirm dialog but routes through the same `{force}` push (R47/R56).
- **DD tooling:** custom `yv-date` picker on offer-modal date fields; DoC
  DD-method ranking from baked `dd-methods.json` (R39); global DD transfer
  timing model + dollar-days-weighted ROI (R37).
- **Diagnostics:** `logError`/`ErrCode` ring buffer, global error handlers,
  recovery panel — exists since R51; don't rebuild.
- **Chart/tooltip colors are LOCKED** — see AGENTS.md → "Locked design
  values" before touching any chart, legend, or tooltip hex.
- **Pending:** iOS Reminders Shortcut on-device build (SHORTCUT_SETUP.md);
  DoC URL ingestion (needs backend or client-side LLM); per-link DD
  success/recency (deferred — requires following thousands of DoC comment links).

---

## Log (newest first)

### 2026-07-06 — Session (claude-opus-4-8, /orchestrate executor)
**Round 62 — Display formats for dates & money (M-D-YYYY + live thousands commas), tighter `$` prefix, un-abbreviated K in two spots, tightened uppercase-label letterspacing**

Owner batch of five display/UX items. HARD CONSTRAINT throughout: storage/sync
formats do NOT change — dates stay ISO `YYYY-MM-DD` and money stays a plain
Number in state/localStorage/Gist and every internal comparison; this is
display/input-UX only, funneled through shared helper pairs so a missed site
can't corrupt an offer.

- **New boundary helpers (~line 4025):** `formatDateDisplay(iso)` → `M-D-YYYY`
  no-leading-zero (`2026-07-06`→`7-6-2026`); `parseDateInput(str)` accepts
  `M-D-YYYY`, tolerates `M/D/YYYY` and a pasted ISO, and returns canonical ISO
  or `null` (rejects overflow dates like `13-40-2026` via a real-calendar-date
  check in `_isoFromYMD`); `formatMoneyInput(val)` → thousands-grouped display
  preserving in-progress decimals/trailing dot/leading `-` and safe to re-run
  on its own output; `parseMoneyInput(str)` strips `$`/commas/spaces → plain
  Number (empty → `null`, matching the existing `num('')===null` contract).
- **[1] Dates → `M-D-YYYY` everywhere a raw ISO was shown.** `yv-date` inputs
  (offer modal `#f-debit-by`/`#f-expires`/`#f-signup`/`#f-funded`, DD-row
  `plannedDate`) render via `formatDateDisplay`, placeholder `YYYY-MM-DD`→
  `M-D-YYYY`; fields are no longer `readonly` (`inputmode="numeric"`) so the
  picker still opens on tap AND typing/paste works. Added a capture-phase
  `blur` handler in `bindGlobalEvents` that re-parses a typed/pasted value and
  rewrites it in canonical `M-D-YYYY` (so `8/1/2026` or a pasted ISO become
  `8-1-2026`); unparseable input is left visible and every reader re-parses so
  state stays clean. `DatePicker.setValue`/`open`/`render` convert through the
  helpers. Already-humanized renders (card/timeline "Aug 11", axis "Jul 6 →
  Oct 11") and native `<input type="date">` are untouched; chart-internal date
  rendering untouched.
- **[2] Live thousands commas in ALL money inputs.** Every money field is now
  `type="text" inputmode="decimal" data-money` and renders stored values via
  `formatMoneyInput`. A single `onInput` branch (`reformatMoneyFieldLive`)
  reformats on each keystroke and restores the caret by counting significant
  digits (comma-insertion-stable). Swept EVERY read path to `parseMoneyInput`:
  `readOfferForm` (`money()`), settings `onChange` (currentLiquidCapital/
  minimumCashBuffer), `readDdRowsFromForm`, `generateDdDatesFromRequirement`
  (the funding-split divisor), `readCommitmentForm` (amount + expectedBonus),
  `readEventForm` (`applyCategorySign`), and the event-modal live sign-flip.
  Verified sweep: the only remaining `Number(el.value)` is the non-money
  branch of settings `onChange` (projectionHorizonDays / maxOptimizerCandidates,
  still `type=number`) — correct, not a money site.
- **[3] `$` prefix tie-to-value.** `.field-box .input-group .input-prefix` and
  the `.dd-row` slimmed variant: color `--text-tertiary`→`--text-strong`
  (`#374151`), gap kept snug at `margin-right:4px` (low end of the 4-6px
  target) so the symbol reads as part of the amount, not the label.
- **[4] Un-abbreviated K in exactly two spots.** Overview hero sub-line
  "Lowest" (`formatCompactCurrency`→`formatCurrency`, now `$125,000`) and the
  at-a-glance BONUS POOL card value (same swap). Card is NOT resized: a
  render-time length check adds `.snap-v-sm` (19px→16px) when the formatted
  string is ≥8 glyphs (6-digit dollar amounts and up) so a large value fits.
  Chart axis labels (`ylab` 200K), offer-card stat abbreviations ($25K
  FUNDING), timeline bar labels, and "Lowest projected" stat cards stay
  ABBREVIATED (all still `formatCompactCurrency`).
- **[5] Tightened uppercase-label letterspacing.** `.hero-label` ("AVAILABLE
  CAPITAL TODAY") 0.06em→0.02em (mobile override 0.04em→0.02em) and the
  Timeline `.timeline-row-label.axis` date-range row 0.05em→0.02em, so the
  spaced-out uppercase labels read cohesively. No chart-internal text changed.
- **Verified (Preview MCP `yield-vector-static`, port 4173, 375px + full
  create→save→reopen cycle):** typing `5000` in offer funding shows `5,000`
  live with correct caret; a full offer save stores `plannedSignupDate:
  "2026-08-01"` / `requiredFundingAmount: 5000` (plain Number, no comma) and
  reopens showing `8-1-2026` / `5,000`; typed `8/1/2026` and a pasted ISO both
  normalize to `M-D-YYYY` on blur; settings + DD-row money round-trip to plain
  Numbers; hero "Lowest $125,000 on Jul 13" and BONUS POOL full value fit at
  375px; hero + Timeline letterspacing measure 0.0200em. Zero console errors
  and zero diagnostics-ring entries across the whole cycle; test data cleaned
  up (owner state restored: 7 offers, liquid 200000, buffer 20000). `node
  --check` on the extracted inline script passes; locked chart/legend/tooltip
  hex counts (AGENTS.md) unchanged vs HEAD. 24 isolated helper unit tests pass.
  Also ran 24 standalone assertions on the four helpers (round-trips + overflow
  rejection). `APP_VERSION` → `2026.07.06e`.

### 2026-07-06 — Session O (claude-sonnet-5, /orchestrate worker)
**Round 61 — Field-box vertical rhythm: label/value gap + padding + a real modal label-height bug (owner-reported)**
- Owner feedback on the R57–R60 `.field-box` boxes: "It just looks awkward now
  with the box heights. They may be a bit big/tall but also think it's just
  that the label text is a bit too close to input vertically." Diagnosis
  (given in the task brief, confirmed correct by measurement): generous outer
  padding + tight label-to-value gap made the pair read cramped inside an
  oversized box.
- **Gap + padding (both ends of the diagnosis):** `.field-box` `gap` 2px → 6px;
  vertical padding 12px → 10px (horizontal 18px untouched). Net effect for
  single-line-label fields: box height is **unchanged** (the 4px padding cut
  exactly offsets the 4px gap gain — e.g. Settings "Current liquid capital"
  measured 68.59px both before and after) but the internal split moves from
  lopsided (13px above the label / 2px gap / 13.9px below the value — 6-7x
  more space around the pair than between its two halves) to balanced (11px /
  6px / 11.9px — ~1.8-2x, matching the requested ratio).
- **Found during verification — a real, separate bug, not just "nothing to
  fix":** measuring the Add-offer modal surfaced that its single-line-label
  boxes (Bank name, Bonus amount, Offer expires, etc.) were rendering at
  79-83px — well outside the 64-72px target — even after the gap/padding fix,
  while Settings' otherwise-identical single-line fields sat at 64-69px. Root
  cause: `#offer-form .field label` (R57, ~line 1504; `min-height:30px;
  display:flex; align-items:flex-end`) was written for the group-level label
  bottom-pin pattern (labels sitting OUTSIDE a box), but its selector also
  matches every label nested INSIDE a `.field-box` in that modal, and wins
  the cascade there (`#offer-form .field label` is ID+class+tag,
  `.field-box label` is only class+class) — so every single-line in-box
  label was being force-stretched to 30px instead of its natural ~15.6px,
  inflating the whole box by the difference. This is exactly the "verify
  nothing similar still forces extra height" check the task asked for; it
  surfaced a real hit, not a clean bill of health. Fixed with
  `#offer-form .field-box label { min-height:0; display:block;
  align-items:normal; }` placed directly after the existing
  `#offer-form .field > .field-box { margin-top:auto; }` box-pinning rule
  (~line 1671) — same file region, same "give .field-box its own reset"
  pattern already used for the analogous `.modal .field-box .input[type=
  "date"]` 44px override (~line 1817, itself an R57 fix). Two-line labels
  (e.g. "Funds must remain deposited through day * (from funded date)")
  were never affected by the 30px cap (their natural height already exceeds
  it) and still grow to fit their wrapped text without crowding the value.
- **Confirmed out of scope, left alone:** `.dd-row`'s slimmed input variant
  has its own `padding:8px 10px` and doesn't inherit `.field-box`'s `gap`/
  `padding`, so it wasn't touched. The native `<select>` uses `appearance:
  auto` (browser-drawn chevron, no custom `background-position` to
  recalculate), so it's structurally unaffected by the padding/gap change.
  Whole-box click-to-focus is unaffected by either change — every
  `.field-box` label keeps its native `<label for="...">` / `<input id=
  "...">` pairing, which neither edit touches; confirmed the pairing is
  still intact post-fix (e.g. `for="f-expires"` / `id="f-expires"`).
- **A note on repo state during this session:** partway through, `CLAUDE.md`
  changed on disk mid-task (external edit, not mine) — turned out to be part
  of a broader, coherent removal of the `agent-session.js` claim/release
  session-coordination protocol across `AGENTS.md`/`CLAUDE.md`/
  `.claude/settings.json`/`.codex/hooks.json` (the `docs/AI_COORDINATION.md`
  reference and the numbered claim/release steps are gone from both docs).
  Not something this round touched or reverted — out of scope for a
  CSS-spacing task — left as-is; `index.html`'s diff contains only the two
  rules above (confirmed via `git diff index.html` showing exactly the
  `gap`/`padding` change plus the one new label-reset rule, nothing else).
- `APP_VERSION` → `2026.07.06d`. Verified: `node --check` on the extracted
  inline script passes; locked chart/legend/tooltip hex count (AGENTS.md)
  unchanged (33, before and after). Visually verified via Preview MCP
  (`yield-vector-static`, port 4173) at 375px — Settings (Capital &
  projection fields) and the Add-offer modal (Bank name focused + unfocused,
  Bonus amount with a typed value, the two-line "Funds must remain..." field
  under Held+DD, a select, a date field) — and at desktop (1280px), both
  clean. Full before/after measurement table in the CHANGELOG entry.
  **DO NOT COMMIT per explicit task instruction** — working tree only, same
  as R57-R60.

### 2026-07-06 — Session N (claude-sonnet-5, /orchestrate worker)
**Round 60 — Button-row grid uniformity + offer-card height verification (owner-reported, mobile screenshots)**
- **[1] Button-row uniformity:** Settings sync-actions row (6 buttons: Save & test / Create new Gist / Pull now / Push now / Restore from history / Disconnect) and the Data row (4 buttons: Export JSON / Import JSON / Reset to sample data / Clear all data) used `display:flex; flex-wrap:wrap`, which let each button keep its own label-driven width and wrap into ragged, mismatched-width rows on phones. Both converted to a new shared `.btn-grid` class (`display:grid; grid-template-columns:repeat(auto-fit, minmax(140px,1fr))`) — the same auto-fit/minmax approach R58 already used for `.dd-timing-row` — giving equal-width, equal-height buttons at any viewport with no hardcoded breakpoint. "Disconnect" also swapped `.btn-ghost.btn-danger` (no border — sat visually misaligned beside its bordered `.btn-secondary` siblings, the owner's specific complaint) for a new `.btn-outline-danger` class (transparent bg, `--danger`-colored border + text) so it now participates as an outlined danger pill instead of a borderless link, without becoming solid red. Swept `.diag-actions` (Copy diagnostics/Clear log) and `.error-state-actions` (Reload/Copy diagnostics) — both are 2-button rows that fit comfortably side-by-side at 375px (verified by injecting a fake diag-log entry and screenshotting), so left unchanged. Modal footers (Delete | Cancel | Save changes, 3 instances) left unchanged per explicit owner sign-off in the task brief. `#sync-buttons`'s only JS dependency is `updateSyncButtonsLive()`'s `querySelectorAll('#sync-buttons [data-action=...]')` id-scoping — confirmed it doesn't touch the `style`/class attributes, so safe to convert.
- **[2] Offer-card height verification — verdict: card did NOT change.** Owner asked whether offer cards had picked up new blank space above the label during the R57/R58 form-restyle rounds. Extracted the pre-restyle build (`git show 0ae5ee3:index.html`) and diffed `.offer-card`, `.offer-card-header`, `.offer-name` CSS rule bodies byte-for-byte against the current build — **identical in all three**. Rendered both builds side-by-side at 375px (two `python3 -m http.server` instances, separate origins so localStorage sample-data seeding didn't cross-contaminate) on the Offers tab and the Planner tab (same `renderOfferCard()` function, confirmed only one render call site exists — `renderOfferCardWithActions()` is defined but dead/unused, out of scope) — pixel-identical layout, identical `.offer-card-header` height (41.5px) and `.offer-name` top-position (flush with the header's own top, zero internal gap) in both builds. The R58 suspects named in the task brief (`.field label`/`.field-label`, `#offer-form .field label`) don't apply — `renderOfferCard()`'s template uses none of those classes; grepped the full CSS diff between builds for anything touching `.offer-stat-label`/`.offer-stats`/`.offer-card*` and found zero matches. The only "space above the label" is the card's `padding-top: var(--space-5)` (20px) — the same shared token used by the hero card, stat cards, and every other card type in the app (6+ other rules reference it), not something oversized or leaked specifically onto offer cards. Per the task's own branch-e instructions, did not compact this: it's systemic/intentional card padding shared app-wide, not an isolated low-risk artifact, and touching it would ripple across every card's visual language — outside this task's spacing/alignment-only, non-restructuring scope. No code change for this half of the round; diagnosis + this note stand in for a fix.
- `APP_VERSION` → `2026.07.06c`. Verified: `node --check` on extracted script passes; locked chart/legend/tooltip hex counts (AGENTS.md) unchanged before/after; both button grids confirmed equal-width via computed `grid-template-columns` at 375px and 1280px (desktop screenshots were unreliable this session — a viewport/capture-timing glitch in the Preview tool unrelated to the HTML/CSS changes — cross-verified desktop via `preview_inspect` computed-style reads instead, e.g. 6×190.664px columns on the sync row at 1280px). **DO NOT COMMIT per explicit task instruction** — working tree only, same as R57–R59.

### 2026-07-06 — Session J continued (claude-fable-5, planner direct fix)
**Round 59 — About-grid version overflow on mobile (owner-reported)**
- `.about-grid` used `minmax(0, 1fr)` — all three cells forced onto one row at any width, shrinking below content width, so `v2026.07.06a` overflowed its box on phones. Fixed: `minmax(140px, 1fr)` (cells wrap to rows on narrow screens) + `min-width:0; overflow-wrap:anywhere` on `.about-value` as a guard for long values. Full version format kept (owner offered 2-digit year; layout fix chosen instead — version string is load-bearing for build verification). Verified at 375px. `APP_VERSION` → `2026.07.06b`.

### 2026-07-06 — Session M (claude-sonnet-5, /orchestrate worker)
**Round 58 — Typography hierarchy tuning, segmented-control centering, DD-timing uniformity (owner-requested)**
- Three refinements to R57's form styling, all owner-requested with item 1's
  exact tuning delegated to my judgment ("lightening slightly and ever so
  slightly less bold"). `APP_VERSION` → `2026.07.06a`.
- **Typography:** group labels + box labels both now `--text-tertiary`
  (were split between `--text-secondary`/`--text-tertiary` levels, box
  labels darker than group labels) at weight 500 (group labels were 600).
  Values (`.field-box` inputs + `.dd-row` slimmed variant) now weight 400
  (was 500) and a new `--text-strong` token (`#374151`, ~line 28) — no
  existing token sat between `--text` (#2a2e3d) and `--text-secondary`
  (#5b6374), so minted one rather than reusing `--text` (which stays the
  card-title/modal-title/stat-value heading tone, untouched).
- **Segmented-control centering:** root cause was `#offer-form .field label`
  (the R57 bottom-pin rule meant for the group-level label like "Offer
  type *") also matching every individual `.radio-group` segment label,
  its `align-items:flex-end` beating `.radio-group label`'s own
  `align-items:center` on specificity. Added `#offer-form .field
  .radio-group label { align-items:center; justify-content:center;
  min-height:40px; }` — fixes ALL segmented controls in the offer modal
  (Offer type, DD-requirement mode, Funded/Open date, Debit requirement),
  confirmed at 390px where "HELD + DD" (1-line) was visibly bottom-anchored
  against "NEW FUNDS HELD" (2-line) before the fix.
- **DD-timing row:** new `.dd-timing-row` class (~line 1206, near `.dd-row`)
  replaces the old per-item inline `max-width:130/150/140px` guesses with
  a real `grid-template-columns: repeat(auto-fit, minmax(132px, 1fr))` —
  identical widths by construction, collapses to fewer columns on narrow
  viewports instead of wrapping unevenly. 132px floor (not a rounder
  number) is deliberate: the base `.input-group.with-suffix .input`
  padding (28px left + 60px right) clips a 3-digit value below that;
  verified by forcing "999" into all three inputs at 320px width.
- **Scope respected:** did not touch the "inline DD-requirement count/
  frequency mini-controls" (`ddreq-count-n` etc.) — R57 deliberately left
  these unboxed/unlabeled, and they're neither `.field-box` nor `.dd-row`
  nor the DD-timing row, so they're out of item 1's stated scope and still
  read `--text`/inherited weight. Not a defect, a scope boundary.
- **Verification:** `node --check` on extracted inline script passes.
  Locked-hex counts (AGENTS.md) diffed before/after against HEAD — all 9
  unchanged. Visually verified via Preview MCP (global `yield-vector-static`
  launch config, port 4173 — this one resolves correctly against the repo
  root, unlike R57's session-local `yield-vector`/8765 config) at desktop
  (1280px) and mobile (390px, 320px): Settings (group labels/values,
  DD-timing row) and the Add/Edit Offer modal (box labels/values,
  offer-type + DD-req-mode + Funded/Open-date segmented controls) at both
  widths. Did not commit or push per explicit instruction.

### 2026-07-06 — Session L (claude-sonnet-5, /orchestrate worker)
**Round 57 — Input restyle: label-inside-container pattern**
- Restyled every text/number/date/select/textarea field to a fintech-style
  bordered container with the label moved INSIDE it (owner-provided
  reference). New `.field-box` wrapper class (`.field label`/`.field-hint`
  CSS block, ~line 1377) holds `label` + the control; uses the app's own
  `--card-soft`/`--border-soft`/`--radius-lg` tokens for the box and
  `--accent`/`--accent-soft` for `:focus-within` — NOT the reference's
  purple. Touched: Settings `#capital-grid` + Cloud sync fields
  (`renderSettings`/`renderSyncSection`), and every qualifying field in
  `showOfferModal`, `showCommitmentModal`, `showEventModal` (~line 6813+),
  including the advanced fields (DoC URL, Entity, Email, Notes).
- **Deliberately left unboxed** (per the design brief — "checkbox/radio/
  color-picker stays as-is"): all `.radio-group` fields (Offer type, Debit
  requirement, Lock-from, DD-req mode), the checkbox-row fields (Include in
  projection/scenario, Display on chart, etc.), the offer color-picker, the
  inline DD-requirement count/frequency mini-controls (no `<label for>`,
  just adjacent text like "Once per"/"for" — boxing would need invented
  labels), the DD-transfer-timing 3-input row (no per-control label), and
  `source-bank-input` (no label at all, just a placeholder).
- `renderDdRow`'s DD entry-table inputs got a SLIMMED variant instead
  (`.dd-row .input` CSS, ~line 1145) — compact rounded border, no
  label-in-box, since there's no per-row label to move (the group label
  "Planned direct deposits *" sits once above the whole list; boxing each
  row would repeat it N times).
- Modal blast-radius date/number height rule (`.modal .input[type=date]`
  etc., fixed 44px + 10px padding) fought the new borderless-inside-box
  look at equal CSS specificity — added a later, box-scoped override
  (`.modal .field-box .input[type=date]` etc.) right after it so the
  cascade resolves correctly; noted inline so a future edit to one doesn't
  silently desync from the other.
- **Verification:** extracted the inline `<script>` and ran `node --check`
  — passes; diffed the extracted script against a pre-edit copy and
  confirmed every changed line is inside an HTML template-literal (no
  `id`/`name`/`for` attributes changed, no JS logic touched). Locked
  chart/legend/tooltip hexes (AGENTS.md) untouched — grepped to confirm.
  **Could NOT complete the visual screenshot pass myself**: this session's
  Preview MCP (`preview_start`) resolves `.claude/launch.json` against the
  agent's home directory, not the repo root, so it couldn't find the
  project's existing `.claude/launch.json` (config name `yield-vector`,
  port 8765) — writing a new one at `~/.claude/` would be a persistent,
  out-of-scope change to the user's global config, so declined to do that
  unilaterally. Worked around by serving the repo directly via
  `python3 -m http.server 4173` and confirming via `curl` that the served
  HTML contains the expected `.field-box` markup/CSS.
- **Coordinator visual re-verify found ONE defect, now fixed:** the `$`
  prefix in `.input-group` fields overlapped the value's first digit once
  a value existed (Settings liquid capital/buffer, offer Bonus
  amount/Required funding, DD-row amount, commitment Amount/Expected
  bonus, event Amount). Root cause: the base `.input-group` mechanism
  absolutely-positions `.input-prefix` and relies on a padding-left guess
  on the input to clear it (original: 12px prefix inset + 28px padding =
  16px clearance); my R57 override shrank that to 16px padding while ALSO
  bumping the prefix font-size to 16px, leaving ~0px clearance. Fixed by
  making `.field-box .input-group` (and the `.dd-row` slimmed equivalent)
  a real flex row instead: prefix as a static in-flow item, input
  `flex:1` with no padding hack — overlap isn't possible by construction.
  Suffix fields (`with-suffix`, "days" etc.) were confirmed already
  correct and deliberately left on the original absolute-right mechanism
  — not touched. Also caught and fixed a second, related bug while in
  this code: the DD-row amount input sat inside `.input-group`, which
  already carried a border/background from the shared `.dd-row .input,
  .dd-row .input-group` rule, so the input needed its own
  `border:none;background:transparent` to avoid a doubled border (this
  one wasn't reported — an R57-introduced bug I found doing the sweep).
  Re-verified with a live preview server (serverId
  `979ac45d-f665-4509-8af4-247327fcc2f9`, port 4173): typed real values
  into all 8 prefix sites and screenshotted each — `$ 200000`, `$ 1500`,
  `$ 50000`, `$ 75000`, `$ 2500`, `$ 12345` all render with clean
  prefix/value separation, focus ring still uses `--accent`, suffix
  "days" fields still right-aligned correctly. Re-ran `node --check` and
  the locked-hex count check — both still clean.
- `APP_VERSION` bumped 2026.07.05 → 2026.07.06. NOT committed (working-tree
  only, per instruction) and NOT tagged — do that after final sign-off.

---

### 2026-07-05 — Session K (claude-opus-4-8, /orchestrate executor)
**Round 56 — Sync compare-and-swap: stop stale-device data loss**
- ROOT CAUSE: `App.save` and `Sync.push` stamped `_lastModified = Date.now()`
  unconditionally, so a device on STALE data forged newness; the auto-push
  path (`App.save`→`schedulePush`→`Sync.push`, and safeSync's local-newer
  branch) had NO cloud check — only `guardedManualPush` peeked first. A stale
  desktop auto-push clobbered 2 offers added on mobile; mobile then pulled the
  loss (night of 2026-07-05).
- FIX: new lineage field `_baseRevision` on the state = the Gist
  `history[0].version` the local state was last pulled-from / pushed-as
  (persisted to localStorage + Gist payload). `Sync.push` is now ONE unified
  compare-and-swap with a `{force}` option: unless forced it GETs the gist
  first and, if the cloud head moved off `_baseRevision` OR our lineage is
  UNKNOWN while a real cloud state exists, it treats that as a CONFLICT —
  **timestamps get no vote** (a stale device that ran `App.save` has already
  re-stamped `_lastModified` newer, so a timestamp gate would wave the clobber
  through). Only a truly empty/fresh gist lets an unknown-base push proceed
  (R56 round 5 — the first-run stale-overwrite window: an old payload with no
  `_baseRevision` that auto-saved before startup sync seeded lineage). On a
  successful PATCH it reads the response's new `history[0].version` into
  `_baseRevision`. The precheck FAILS CLOSED: a failed cloud GET DEFERS (status
  'pending', dirty marker kept, `logError(E_SYNC_PUSH, 'cas-precheck-failed')`,
  next cycle retries) rather than falling back to an unguarded PATCH — a
  fail-open would bypass the guard exactly when the network is flaky (R56
  round 5, reversing the earlier fall-back-to-plain-push behavior).
- Conflict resolution keys off a `Sync.localDirty` flag, PERSISTED with the
  state as `_dirtySince` (ISO string, set in `App.save`; nulled by
  `Sync.markClean()` on every pull-adopt + successful PATCH; `localDirty`
  re-inits from `_dirtySince != null` in `App.init`, so unsynced edits survive
  a reload — a volatile-only flag would reset to false on reopen and the CAS
  would then silently adopt over saved-but-unpushed edits). `_dirtySince` rides
  in the payload but does NOT affect `_lastModified`/"who's newer"; a device
  adopting a cloud state nulls it for ITSELF in `markClean`. `App.save` takes a
  `{system:true}` option that stamps + schedules the push but does NOT mark
  dirty — used by the purely-automatic saves (`rollProjectionStartIfStale`, the
  fresh-device sample-data seed; R56 round 5). Without it a stale-but-CLEAN
  device whose date auto-rolled would look dirty on the KNOWN-lineage CAS and
  trip the conflict dialog. User/import/reset (non-system) saves keep the
  default dirty-marking. Conflict handling is factored into ONE shared resolver
  `Sync.resolveDirtyConflict(remote, side, {unknownLineage})` that BOTH the
  push-side CAS and the pull-side (safeSync) call, so the dialog text/semantics
  can never drift: NOT dirty → merely stale → adopt the other side silently +
  toast; dirty (both sides changed) → `confirm` (OK = adopt cloud / discard
  local edits = safe default; Cancel = keep local & overwrite cloud); can't
  ask — background (`document.hidden`) → DEFER: status 'pending', stays dirty,
  next foreground sync asks. The resolver returns `defer|adopt|keep-local`;
  each caller does its own mechanics (push falls through to PATCH on keep-local;
  pull calls `Sync.push({force:true})` on keep-local so the single shared dialog
  isn't shown twice). Deferred logs are side-specific:
  `E_SYNC_PUSH/'cas-conflict-deferred'` vs `E_SYNC_PULL/'pull-conflict-deferred'`.
  Never silently picks a side.
- UNIFIED FIRST-SYNC RULE (R56 round 8; supersedes the R6/R7 per-direction
  timestamp inferences — `_userModified` DELETED; `Sync.loadedModified` re-added
  in R9 for a narrower use, below). `Sync.resolveFirstSync({remote,cloudHead,
  side})` is called by BOTH `safeSync` and `push` BEFORE their normal
  (known-lineage) logic. While lineage is unknown (`!_baseRevision`), it
  silently adopts + seeds lineage when nothing can be lost — equal live
  `_lastModified`, OR (R9) `!localDirty && remoteMod === Sync.loadedModified`
  (the state we LOADED matched the cloud and only system stamps have bumped
  local since — e.g. the startup projection date-roll), OR a trivial local
  state (0 offers AND 0 commitments). An EXISTING DIVERGENT cloud → prompt ONCE
  via `resolveDirtyConflict(..., {unknownLineage:true})` which recommends Adopt
  ("First sync on this device's new version…"). Timestamps carry NO signal in
  this window — a divergent cloud is resolved by one prompt regardless of which
  side's stamp is newer (that's why the pull-side twin of the R6 hole existed:
  an old-payload device with local stamp OLDER than cloud would blind-adopt on
  the pull path). After any resolution (adopt seeds lineage; keep-local
  force-pushes and the PATCH seeds it) `!_baseRevision` becomes false and the
  rule never fires again. Explicit adopt actions (manual `Sync.pull` with its
  dirty warning, "Save & test", `restoreState`) bypass the rule and seed
  lineage directly. EXPECTED UX: at most ONE dialog per device on its first
  divergent sync after upgrading — none if the device was in sync when it
  upgraded (equal live OR loaded-equal timestamps) or had a trivial state.
- BOTH sync directions are now guarded. Push side: a stale/dirty device can't
  clobber a diverged cloud (R56 round 2–3). Pull side (R56 round 4): safeSync's
  remote-newer branch no longer BLIND-adopts when this device is dirty — it was
  the mirror hole, silently discarding the very unsynced edits `_dirtySince`
  exists to protect (e.g. a reload with edits, or a failed/deferred push). It
  now routes dirty conflicts through the same shared resolver.
- Helpers `revisionOf(gistData)` / `parseGistState(gistData)` added (module
  scope, above `ghGet`) and reused. All pull-adopt paths — `safeSync` (all
  branches, reusing its existing GET; the equal-timestamp `else` also seeds
  `_baseRevision` from that GET so the guard isn't silently disabled on the
  first run of this build), manual `Sync.pull`, `saveSyncConfigFromForm`
  ("Save & test") — set `_baseRevision` + `markClean()`. `Sync.createGist`
  seeds `_baseRevision` from the POST response (a new Gist starts with known
  lineage). Manual `Sync.pull` and "Save & test" are EXPLICIT adopt-the-cloud
  actions so they adopt unconditionally (like restore); manual pull now first
  WARNS via `confirm` if the device is dirty (don't silently discard). The
  fresh-device seed (`localModified === 0`) can't be dirty → left as-is.
  `restoreState` clears lineage then force-pushes so the restored state becomes
  the legit head (a stale device's later auto-push is then blocked).
  `force:true` is reachable ONLY after an explicit user overwrite/make-truth
  choice: (1) the push-side CAS overwrite fall-through, (2) the pull-side
  resolver's `keep-local` branch, (3) `restoreState`. `guardedManualPush` now
  just calls `Sync.push()` UNFORCED so the CAS decides (it previously did its
  own timestamp check + `force:true`, which a re-stamped stale device sailed
  straight through).
- Missing `_baseRevision` (old payloads / a device still on an old build) =
  unknown lineage → the UNIFIED FIRST-SYNC RULE above governs (silent adopt for
  same-state/trivial, one recommend-Adopt prompt for a divergent existing
  cloud, unguarded seed only against a truly empty/fresh gist). Never crashes.
  `APP_VERSION` → `2026.07.05`; CHANGELOG entry added.
- ACCEPTED RESIDUAL (do not chase): an upgraded device with a non-trivial
  divergent state may see exactly ONE recommend-Adopt prompt on its first sync
  (there is no reliable way to tell a merely-stale device from one with genuine
  unpushed pre-upgrade edits — the old build wrote no lineage/marker — so we ask
  once). Never a silent overwrite. After that first resolution lineage seeds and
  the rule never fires again.
- CAVEAT: the guard is only BILATERAL once BOTH devices refresh to
  v2026.07.05 (verify in Settings → About). Per-offer merge DEFERRED — needs
  per-offer timestamps (a whole-state CAS can't merge two devices' disjoint
  edits, only pick a winner). `node --check` on the extracted inline script
  passed. Codex reviewed in 9 rounds: R2 fixed blind-PATCH-on-re-stamp +
  equal-timestamp lineage seeding; R3 fixed `guardedManualPush` forcing past
  the CAS, `localDirty` not surviving reload (→ persisted `_dirtySince`), and
  `createGist` not seeding lineage; R4 fixed the mirror hole on the PULL side
  (safeSync blind-adopting over a dirty device) and factored conflict handling
  into the shared `resolveDirtyConflict`; R5 closed the unknown-lineage
  first-run overwrite window, made the precheck FAIL CLOSED on GET failure, and
  exempted automatic system saves (`{system:true}`) from dirty-marking; R6/R7
  attempted a per-direction legacy-timestamp inference for the upgrade window
  (with `_userModified`/`loadedModified`) — SUPERSEDED by R8, which replaced
  both with the single UNIFIED FIRST-SYNC RULE (`resolveFirstSync`, shared by
  safeSync + push) after finding the pull-side twin: an old-payload device with
  local stamp OLDER than cloud would blind-adopt on the pull path (timestamps
  carry no signal when lineage is unknown, so per-direction heuristics were
  removed entirely); R9 (SHIPPING) — three polish fixes: (a) re-added the
  `Sync.loadedModified` load-time snapshot and widened the first-sync equal-state
  exemption to `!localDirty && remoteMod === loadedModified` so a device that
  was in sync at load but system-date-rolled before its first sync silently
  seeds instead of getting a needless prompt; (b) the fail-closed precheck now
  distinguishes PERMANENT failures (HTTP 401/403/404 — expired/revoked PAT,
  deleted/wrong gist) → status 'error' + a "Push failed: HTTP <code>" toast on
  the manual path, from transient failures → keep 'pending' defer-and-retry
  (`ghGet`/`ghFetch` now attach `err.status`); (c) every equal-timestamp seed
  path also `markClean()`s (a PATCH that landed but lost its response left the
  device falsely dirty → bogus later prompts); R10 (SHIPPED) — two final fixes:
  (a) `_trivialLocalState()` now counts ALL user collections (offers +
  commitments + events + `settings.sourceBanks`) and returns false whenever
  `localDirty`, so a device holding only events/banks or a pending edit is
  never silently overwritten; (b) `Sync.push` scrubs `_dirtySince` from a
  shallow-copy WIRE payload (`{ ...App.state, _dirtySince: null }`) so an
  old-build device can't pull a foreign dirty marker and later offer to
  clobber newer cloud data — the LOCAL marker still clears only on PATCH
  success. All fixed above; shipping (no further review round).

### 2026-07-05 — Session J (claude-fable-5, /orchestrate multi-tier run)
**Round 55 — Full assessment archived to docs/assessments/2026-07-05/ (no app code changes)**
- Ran a 7-step orchestrated assessment (worker=Sonnet 5, executor=Opus 4.8, Codex cross-review at plan/design/report): DoC URL import feasibility, whole-tool critique, Reminders pipeline audit + from-first-principles redesign. Deliverables in `docs/assessments/2026-07-05/` (report.md = synthesis; step files = full analyses); run checkpoint in `.claude/orchestrator/runs/`.
- Verdicts to know: DoC import feasible (deterministic glance parser v1 → Cloudflare Worker + Sonnet 5 + snippet tripwire v2, validated on 25 posts incl. Collin's 18); three HIGH bugs in reminder surfacing — `debitRequirement.byDate` reaches neither `computeUpcomingActions` nor `computeReminderFeed`; per-DD dates never enter the feed; deposit-deadline item gated on legacy `applied|selected|prospect` while `deriveLegacyStatus` maps Approved→'funded' (reminder vanishes when funding is pending). `safeToCloseDate` (~:3560) is a dead stub. Reminders redesign ("one brain, three surfaces": feed contract v2 w/ tombstones + heartbeats + ICS calendar channel + minimal Shortcut) supersedes SHORTCUT_SETUP.md's single-channel vision — see step6 doc before building the legacy 20-stepper.
- Dead ends / do-not-redo: CalDAV push into modern Apple Reminders is impossible (post-iOS-13 silo — verified); JSON-LD/OpenGraph on DoC posts carry no offer fields; glance-list positional parsing breaks on real corpus (fuzzy label matching required — 8 amendments in step5 doc).
- In flight at entry-write time: sync data-loss incident diagnosis (2 offers added on mobile clobbered by stale desktop push, 2026-07-05 night) and a verified-action-name Shortcuts build guide.
**Round 54 — Docs restructure for token efficiency (no app code changes)**
- HANDOFF.md: condensed preamble, added the "Current state" block above,
  archived Rounds 50→35 to HANDOFF_ARCHIVE.md (file was 34 KB; sessions were
  re-reading long-superseded UI-fix rounds every start).
- R36's LOCKED tooltip/marker color recipe moved to AGENTS.md → "Locked
  design values" so it survives archiving; push-cadence rules (30-min flush,
  step-away flush) folded into AGENTS.md → Commit & Push Protocol.
- CLAUDE.md slimmed to Claude-specific config + pointers (it duplicated
  AGENTS.md's architecture, file map, and push protocol nearly verbatim).
- Keep the Current state block updated when a round changes anything it lists.

### 2026-06-23 — Session H (claude-opus-4-8)
**Round 53 — Held+DD: model the held lump sum (was only modeling the DDs)**
- BUG: a Held+DD offer's `requiredFundingAmount` (the held lump sum) never
  appeared on the hero chart / projection — `generateProjection` only tied
  up the DD amounts. The hold was also wrongly anchored to the DD date, and
  ROI ignored the lump sum (e.g. 476% on a $10K/$600 offer).
- Reframed Held+DD = "new-funds-held" held portion + qualifying DDs on top:
  - `lockStartDate(held-and-dd)` → reflected funding date (was last DD date);
    `withdrawalEligibleDate(held-and-dd)` → open/funded anchor + daysFunds-
    MustRemain (same as new-funds-held; was DD-date + days). Both achieved by
    removing the held-and-dd special-cases so they fall through to the held
    logic.
  - `generateProjection` held-and-dd: now applies the held lump sum
    (requiredFundingAmount, funding date → withdrawal) AND each DD (landing →
    withdrawal). Verified: $0 → $505 (after DD) → $10,505 (after lump sum) →
    $0 (after withdrawal).
  - `ddCapitalTime(held-and-dd)`: includes the lump sum's dollar-days, so
    "Days tied up" + "Annualized" are realistic (32.6% vs 476.6%).
  - Hero chart: emits the indigo "Initial funding" marker for held-and-dd
    (the lump sum) in addition to the teal DD markers.
- Planned funding date is now REQUIRED for Held+DD (label flips to "*" via
  `syncDdSectionUI`; `isOfferComplete`/`offerIssues` enforce it) — it drives
  the held deposit. Optional still for new-funds-held (falls back to signup).
- Reverted R52's card special-case (lockStartDate already returns the
  funding date for held-and-dd now, so the card shows it via plain `start`).

### 2026-06-23 — Session H (claude-opus-4-8)
**Round 52 — Held+DD card "Fund date" = funding date (not DD date)**
- On a Held+DD offer card, "Fund date" used `lockStartDate(o)`, which for
  `held-and-dd` anchors on the DD landing date — so it just duplicated the
  "DD 1" row. Per user: it should reflect the planned funding date (the held
  LUMP SUM deposit), which is distinct.
- Fix in `renderOfferCard` (the `.offer-dates` block); display-only.
  Superseded by R53, which made `lockStartDate` itself return the funding
  date for held-and-dd.

### 2026-06-15 — Session G (claude-opus-4-8)
**Round 51 — File-manager pass: versioning, error handling, doc realignment, repo hygiene**
- **Repo hygiene.** Pruned 6 orphaned git worktrees + 7 stale `claude/*`
  branches; `main` is the only branch.
- **In-app version stamp.** `APP_VERSION` (top of the `<script>` in
  `index.html`), shown in Settings → About & diagnostics. `package.json`
  bumped independently (semver dev-metadata, nothing consumes it).
- **Error handling + diagnostics.** Global `error`/`unhandledrejection`
  handlers + `logError`/`ErrCode` taxonomy + 25-entry localStorage ring
  buffer (`yv-diag-log-v1`); `render()`/`init()` wrapped →
  `renderErrorState()` recovery panel; Copy-diagnostics in Settings. Commit
  `9dc560f`; every path verified in preview.
- **Doc realignment.** De-duplicated the key-function table into AGENTS.md
  (single canonical source); revived CHANGELOG.md with milestone entries.
- **Do not redo.** Versioning/diagnostics/error-handling exist — to ship a
  good state, just bump `APP_VERSION` + tag `stable-YYYY-MM-DD` + add a
  CHANGELOG line.

---

> **Older rounds (50 → 1) are archived** in [HANDOFF_ARCHIVE.md](HANDOFF_ARCHIVE.md)
> to keep this log readable. Notable archived rounds: R36 locked tooltip colors
> (now in AGENTS.md), R38 status-model migration map, R39 date picker + DoC
> ranking, R47 sync restore-from-history.

---

## Entry template

```markdown
### YYYY-MM-DD — Session [letter] (model id)
**Round N — short title**
- Bullet 1: what changed, with file path or function name.
- Bullet 2: any non-obvious *why* (a constraint the user gave, a dead end
  to avoid).
- Bullet 3: pending follow-ups or open questions.
```

Keep entries under ~25 lines each. If a round is huge, summarize and link
to a commit hash. Update the Current state block if the round changes
anything it lists.
