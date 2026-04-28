# HANDOFF — Yield Vector

This file is the cross-session changelog for Yield Vector. The user works
across multiple Claude logins (Opus 4.7 in one, Opus 4.6 / Sonnet 4.6 in
another). Each entry below is what *the previous session* changed so that
*this session* can pick up without the user having to re-narrate.

---

## How to use this file

**At the start of every session**, read the most recent 3–5 entries below to
understand what was just changed. Then proceed.

**At the end of every meaningful round of changes**, prepend a new entry at
the top of the log following the template at the bottom. Keep entries
factual and short — file paths, line ranges, the *why* behind any
non-obvious choice. Do NOT re-list small color tweaks or copy edits in
detail; group them under a single line.

The user will not always remind you to update this file — be proactive: if
you've shipped a batch of changes, append before responding so the next
agent (which may be you, may not) starts cold and still has the picture.

**Model note.** The agent that wrote each entry is recorded in the header.
This matters because:
- Older models (Sonnet 4.6, Opus 4.6) may not have the same context-window
  size or recent tool capabilities that 4.7 has. If a 4.6 session is going
  to pick up, write entries assuming less inferred context — be more
  explicit about file paths, gotchas, and what *not* to redo.
- 4.6 sessions: when you read an entry written by 4.7, treat its summary as
  authoritative; don't second-guess unless something in the live code
  contradicts it.
- Either way: when you're about to make a change, check this log for "do
  not redo" notes from a prior session that hit a dead end.

---

## Log (newest first)

### 2026-04-28 — Session C (claude-opus-4-7)
**Round 21 — chip arrow, portrait header scroll, landscape modal, daily start-date roll**
- **Brand mark v6 — back to chip + cleaner white arrow.** Reverted v5's
  no-chip thick-stroke design per user request. Chip is a 22×22 rounded
  square with a corner-to-corner gradient (`#1e1b4b → #4338ca → #7c3aed
  → #b69cff`) — the bottom-left is deeper navy than v3, the top-right
  is a notable shade lighter (`#b69cff` vs `#a78bfa`) for more lift.
  Inner arrow is no longer a layered filled triangle: it's a smooth
  Bezier shaft `M 5.5 16.5 Q 9 12 16 6.5` plus a chevron arrowhead
  `M 10.8 7.2 L 16.5 6 L 15.3 12`, both pure white stroke at width 2.
  Reads as crisp vector rather than chunky stock clipart.
- **Portrait header scrolls away.** `.app-header` was `position: sticky`
  on every breakpoint; phones in portrait were eating ~64 px of the
  short viewport for chrome that didn't need to follow. Added
  `@media (max-width: 720px) and (orientation: portrait) { .app-header
  { position: static; top: auto; } }` so it scrolls naturally with the
  page in portrait. Landscape phones keep it sticky (handled by the
  prior landscape media block via `--header-height: 50px`) since you
  need quick nav access on a short screen.
- **Landscape Add-Offer modal — single-column form.** In landscape on a
  phone (≥720 px wide), the form-grid `auto-fit minmax(220px, 1fr)`
  was producing 2 columns inside a 640-px modal-card; combined with a
  430-px-tall viewport, labels and inputs were crashing into each
  other. Added `.form-grid { grid-template-columns: minmax(0, 1fr); }`
  inside the landscape media block, plus `.modal-body { overflow-y:
  auto; }` so long forms scroll vertically rather than compressing.
- **Daily projection-start-date roll.** Added `App.rollProjectionStart-
  IfStale()` — if `settings.projectionStartDate` is older than today,
  advance to today and save. Wired into three triggers: (1) `App.init`
  before first render so a stale state file from yesterday rolls
  forward immediately; (2) `visibilitychange → visible` so an app left
  open overnight rolls forward when the user comes back; (3) a 60-s
  `setInterval` that early-returns when the date hasn't changed —
  cheap belt-and-suspenders for keeping a foreground tab honest. Only
  advances, never rolls backward, so a user manually setting a future
  start date in Settings is preserved.

### 2026-04-28 — Session C (claude-opus-4-7)
**Round 20 — fix Round 19 regressions: scroll, horizon, arrow visibility**
- **Restored mobile chart/timeline horizontal scroll.** Round 19 set
  `overflow: visible` and removed `min-width` from `.chart-svg` /
  `.timeline-tracks-col` to fit screen width — the chart got compressed
  into 1/3 of the viewport without scrollability. Reverted to the
  pre-Round 19 model: `.chart-wrap` is `overflow-x: auto` with
  `-webkit-overflow-scrolling: touch`; `.chart-svg` carries
  `min-width: 600px`. Tooltip is still appended to `<body>` (Round 18)
  so bubble-clipping is still solved.
- **Restored timeline two-column scroll.** `.timeline-labels-col` back
  to flex-fixed at 96 px (with belt-and-suspenders `position: sticky;
  left: 0; z-index: 2`); `.timeline-tracks-col` back to 600 px wide
  inside an `overflow-x: auto` scroll container. Labels stay pinned
  while the user scrolls bars horizontally.
- **Reverted JS preserveAspectRatio override.** The
  `preserveAspectRatio = 'none'` kludge from Round 18 (used to stretch
  the chart vertically when the box was taller than the viewBox) is
  gone. Back to plain `xMidYMid meet`.
- **Horizon for real this time.** `effectiveHorizonDays()` was still
  counting any offer that wasn't `completed`/`skipped`, which meant
  prospect/selected offers without `includeInScenario` checked were
  pushing the X-axis out to October even though they don't appear on
  the chart. Now the loop filters by the same
  `offerIsActiveForProjection()` predicate the projection engine uses.
  Also exposes `window._horizonDebug` (= `{ lastAction, considered }`)
  for inspection when this surfaces again.
- **Brand mark v5 — visible arrowhead.** v4's hairline stroke (1.7)
  with tiny barbs read as "just a line" at 22 px. v5 bumps stroke to
  2.4, viewBox to 24×22, lengthens the chevron barbs to ~8 px with a
  ~32° opening angle, and shifts the tip out to (20, 3) so the
  arrowhead has room. The barbs are at (12.5, 4.6) → (20, 3) →
  (18.6, 11). Same indigo→violet gradient, same Bezier shaft, no
  fills.

### 2026-04-28 — Session C (claude-opus-4-7)
**Round 19 — horizon hard-cap, mobile timeline width, form overflow, brand v4, flat sync chip**
- **Timeline horizon cap.** `effectiveHorizonDays()` auto mode had a
  baseline of `let last = addDays(start, 30)`, then later wrapped that
  in `addDays(last, 30)` — so the minimum horizon was 60 days even with
  no offers, and every offer's withdrawal date got an extra 30 baked
  in twice. Fixed: `last` starts as `null`, only gets pushed by
  active/planned withdrawal-eligible dates (offer expiration is still
  ignored), and the final return is `min(180, daysBetween(start,
  lastAction + 30))`. Empty planner → 30-day floor.
- **Mobile-portrait timeline width.** Labels column shrunk from
  120 px → 88 px; tracks column flipped from `width: 640px` (forcing
  horizontal scroll) to `width: 100%; min-width: 0` so the chart fills
  the visible portion of the screen instead of being a 1/3-visible
  sliver. Wrap padding tightened to `var(--space-3)`, axis ticks 10 px,
  row labels truncate with ellipsis.
- **Modal/form overflow.** Reasserted `box-sizing: border-box;
  width: 100%; max-width: 100%; min-width: 0` on `.input/.select/
  .textarea` and the `.input-group` wrapper, so Safari's intrinsic
  native-control width can't push the right edge past the modal.
  `.modal-card` on mobile now `width: 100%`; `.modal-body` clamps with
  `overflow-x: hidden`; form-grid uses `minmax(0, 1fr)` so cells can
  shrink below content width.
- **Brand mark v4 — single curved diagonal stroke.** Dropped the
  rounded-square indigo chip + layered triangle entirely. Brand mark is
  now one quadratic Bezier `M 3 17 Q 8 12 18 3` (uptrend curve) with a
  3-point chevron arrowhead `M 13 3.5 L 18 3 L 17.5 8` at the tip.
  Both paths share the same `brand-arrow-g` indigo→violet gradient,
  stroke-width 1.7, round caps. No fills. Reads as a financial-chart
  uptrend rather than a stock icon.
- **Flat sync chip.** Top-right sync indicator: removed border, removed
  the colored halo `box-shadow` from `.sync-dot`, swapped pill radius
  for `border-radius: 8px`, and lightened background from
  `var(--card-soft)` to `rgba(13, 20, 33, 0.04)` (very faint
  translucency over the page bg). Dot is now a flat single-color 7 px
  circle. The chip recedes into the chrome instead of competing with
  the brand mark.

### 2026-04-28 — Session C (claude-opus-4-7)
**Round 18 — mobile layout fixes (chart clip, portrait sizing, landscape, form alignment)**
- **Chart tooltip clipping (overview).** Tooltip is now appended to
  `document.body` on first show and stays there. Position is unified to
  `position: fixed` + viewport coords on both desktop and mobile.
  Root cause was `-webkit-overflow-scrolling: touch` on `.chart-wrap`
  (mobile) — iOS Safari demotes `position:fixed` descendants of such an
  ancestor to behave like `position:absolute`, which clipped bubbles to
  the wrap's `overflow-y: hidden`. Moving the tooltip out of the wrap
  side-steps that entirely.
- **Portrait chart sizing.** Dropped `min-width: 720px` on `.chart-svg`
  for `(max-width: 720px) and (orientation: portrait)`. Chart now fits
  the screen width with `aspect-ratio: 1.55 / 1` (≈242 px tall at 375 px
  wide). The viewBox is still 800×280, but `preserveAspectRatio` is
  switched to `none` for portrait phones via JS in `renderHeroChart()`
  so the chart stretches vertically to fill the box instead of letter-
  boxing to a 130 px sliver. Cursor mapping in `handleHover()` already
  scales `W/rect.width` and `H/rect.height` independently, so non-
  uniform stretch maps correctly.
- **Landscape orientation rules.** New
  `@media (max-width: 1024px) and (orientation: landscape)` block:
  header 64→50 px, bottom nav 70→56 px, hero amount 44→32 px, section
  titles 22→18 px, timeline rows 44→38 px, modal switches from bottom-
  sheet to centered card. Plus a separate landscape rule for
  `.chart-wrap` with `aspect-ratio: 2.6/1` and `max-height: 240px` so
  the chart doesn't dominate the short viewport.
- **Form alignment in Add-Offer modal.** Labels of different lengths
  ("Days after signup to deposit" wraps to 2 lines vs. "Status" on 1)
  were pushing the inputs below them onto different baselines, breaking
  row alignment. Fixed by giving `.field label, .field-label` a
  `min-height: 30px` with `align-items: flex-end`, and pinning inputs
  to the bottom of each cell with `margin-top: auto`. Now every input
  in a form-grid row aligns horizontally regardless of label wrap.
- **Re-render on rotate.** Added debounced `orientationchange` +
  `resize` listeners (120 ms) in `bindGlobalEvents()` that call
  `render()`, so the chart's `preserveAspectRatio` and the CSS
  `aspect-ratio` rules pick up orientation changes immediately.

### 2026-04-28 — Session B (claude-opus-4-7)
**Round 17 — wide-arrowhead chip + hero typography + reds + broken-line $**
- Brand chip: outer is now a 4-vertex kite (`M 3 3 L 19 3 L 19 19 L 13 9 Z`)
  — straight-line concave back instead of a plain triangle. No rounded
  corners. Inner arrowhead widened to barbs at (12, 6) and (16, 10) and
  lightened to `#c8c8d0`.
- Hero overview: label larger (12px → 14px) with extra spacing below;
  amount smaller (56px → 48px) and lighter (700 → 600). Currency symbol
  weight matched to digits.
- All reds lightened: `--danger` token `#ef4444` → `#e87171`; chart
  deposit-deadline marker hardcode updated; banner.danger color
  `#991b1b` → `#c95555`; tooltip lightenColor map updated.
- Broken-line dollar sign: added `@font-face { font-family: 'BrokenDollar' }`
  with `unicode-range: U+0024` mapping the $ glyph alone to Helvetica
  Neue. Prepended `'BrokenDollar'` to `--font-sans` so every $ in the
  app gets Helvetica's broken-line variant while everything else stays
  in SF Pro.

**Auto-push died.** The `node auto-push.js` watcher process exited at
some point during the session (no process running by 1:30 AM). Recent
changes were pushed manually via `git add index.html && git commit
&& git push origin main`. To restart the watcher, run from the repo
root: `cd /Users/collinrekowski/Automation/Churning && nohup node
auto-push.js > nohup.out 2>&1 &`.

### 2026-04-28 — Session B (claude-opus-4-7)
**Round 16 — mobile timeline stacking fix**
- Mobile timeline: bars and axis ticks were bleeding through the sticky
  label column when the user scrolled the track horizontally. Cause:
  the row didn't create a bounded stacking context, so the label's
  `z-index: 2` didn't reliably stack above the track's children.
- Fix: added `isolation: isolate` to `.timeline-row` (mobile only)
  to create a bounded stacking context. Bumped label z-index 2 → 5,
  stronger right-edge box-shadow `8px 0 12px -6px rgba(13, 20, 33, 0.12)`
  for clearer visual separation, plus `transform: translateZ(0)` to
  put the label on its own GPU layer (avoids sub-pixel ghosting on
  iOS Safari during fast scrolls).
- Explicit `z-index: 1` on `.timeline-row-track` + the visual children
  (`.tl-bar`, `.tl-axis-tick`, `.tl-grid-line`, `.tl-shortfall-band`,
  `.tl-today`) so they always sit beneath the label regardless of
  DOM order.

### 2026-04-28 — Session B (claude-opus-4-7)
**Round 15 — triangle chip + small inner arrow + lighter wordmark**
- Brand mark simplified per user feedback. Outer chip is the
  upper-right triangle of a 22×22 square (path `M 3 3 L 19 3 L 19 19 Z`),
  filled with the indigo gradient and stroked at width 2.5 with
  `stroke-linejoin: round` for soft corners. Inside, a small gray
  filled arrowhead (`M 17 5 L 12 7 L 15 10 Z`, symmetric barbs ~5.4
  units from the tip) points to the upper-right corner.
- Inner arrow color is `#b3b3be` — gray instead of pure white for a
  softer feel.
- Wordmark refined: `font-weight: 700` → `600` (less bold), letter-
  spacing `-0.025em` → `-0.018em` (slightly looser), font stack now
  prefers `'SF Pro Display', 'SF Pro Text'` before `-apple-system` so
  the more refined display variant lands on Apple devices.
- **Backtick-in-template-literal trap (third time).** I put
  backticks inside an HTML comment that lived inside the
  `renderHeader()` template literal — same bug that took down round 5.
  Fixed by replacing the comment text. **Strict rule going forward:
  no backticks in HTML comments inside JS template literals.**

### 2026-04-28 — Session B (claude-opus-4-7)
**Round 14 — arrow polish: filled head, symmetric barbs, thicker base**
- Arrowhead is now a filled triangle (instead of stroked barbs) — the
  shaft tucks into the back-midpoint of the triangle so the join is
  seamless. No more visible barb-cap artifact at the tip.
- Barbs are now symmetric: upper at (13, 6) and lower at (16, 9), both
  ~5.4 units from the tip at (18, 4), at ±23° off the shaft tangent. The
  earlier arrowhead flared up-left because the upper barb was further
  from the tip; that's gone.
- Stroke width 1.8 → 2.4 for a chunkier base. Gradient stops unchanged.
- Render size 22×22 → 26×26 (viewBox kept 22×22) so the mark scales up
  ~18% in the header without re-laying-out the path coordinates.

### 2026-04-28 — Session B (claude-opus-4-7)
**Round 13 — single curved diagonal arrow (no chip)**
- Dropped the circular chip + double-chevron entirely. Brand mark is now
  a single curved diagonal arrow on the page background.
- Shaft: quadratic Bezier `M 4 18 Q 9 8 16 6` — starts at the lower-left
  (tail), bows gently upward through the control point (9, 8), arrives
  at the upper-right tip (16, 6).
- Arrowhead: two-barb path `M 11 4 L 16 6 L 14 11` meeting at the tip.
- Stroke is a gradient anchored to the shaft endpoints (deep indigo at
  the tail → light violet at the tip), matching the wordmark's color
  flow. Stroke width 1.8 with round caps + joins. No fill.
- This is the simplest brand mark we've shipped: pure diagonal arrow,
  no background, no extra detail. Easier to refine without re-arguing
  about chip shape.

### 2026-04-28 — Session B (claude-opus-4-7)
**Round 12 — chevron uniformity + thinner stroke + tuned colors**
- Both chevrons now sit symmetrically around the chip center: front
  vertex (15, 7), back vertex (10, 12), each chevron's centroid offset
  ~2.5 units along the NE-SW axis from chip center. Pure translation
  between them — no axis bias.
- Arm length reduced 6 → 5 (tighter, more like the reference's
  proportions). Stroke width reduced 2 → 1.6 for less visual weight.
- Colors tuned per user: front gray darkened from `#d4d4dc` →
  `#b3b3be`; back charcoal lightened from `#1f222a` → `#33384a`. The
  contrast between them is gentler now.

### 2026-04-28 — Session B (claude-opus-4-7)
**Round 11 — double-chevron polish**
- Circle precision: inset chip from `r=11` to `r=10.5` (with `cx=cy=11`)
  so anti-aliasing at the viewBox edges renders cleanly. The full-radius
  version had a faint flat spot at the upper-right where the circle
  touched the viewBox boundary. Also added
  `shape-rendering="geometricPrecision"` on the SVG.
- Chevron colors swapped + tuned per user request: front chevron is now
  warm light gray `#d4d4dc` (was black) and back chevron is now charcoal
  `#1f222a` (was white). The SW-diagonal offset and 2-unit stroke remain
  symmetric — only color/position swapped.

### 2026-04-28 — Session B (claude-opus-4-7)
**Round 10 — double-chevron brand mark**
- Brand chip swapped to a **stacked double-chevron** pointing diagonally
  up-right, inspired by user's reference image (a `«`-style double chevron
  but tilted NE). The FRONT chevron is stroke-only (delicate angle line);
  the BACK chevron is filled solid (chunky L-shaped wedge), so the bottom
  reads heavy and the top reads delicate. Same indigo gradient chip with
  shimmer overlay.
- Front chevron: stroke path `M 10 4.5 L 16.5 4.5 L 16.5 11`,
  `stroke-width: 1.7`, white at 0.95 opacity, rounded line caps/joins.
- Back chevron: filled L-polygon
  `M 4.5 11 L 11.5 11 L 11.5 18 L 9.5 18 L 9.5 13 L 4.5 13 Z`, white at
  0.95 opacity. Offset down-left from the front chevron's vertex.

### 2026-04-28 — Session B (claude-opus-4-7)
**Round 9 — chip with actual arrow + desktop tooltip clamp**
- Brand chip now contains a proper **tapered shaft + triangular arrowhead**
  (the same arrow shape used in the iOS PWA icon), not the lozenge
  compass-needle. The needle didn't read as an arrow; user wanted "some
  form of an arrow." Same soft-rounded chip outer (rx=6, indigo
  gradient + shimmer overlay).
- Desktop chart tooltip now clamps inside `chart-wrap` so the
  "Lowest projected" click-through near the start of the horizon doesn't
  cut off the left side of the panel. Same logic that mobile already had:
  measure tooltip rect, compute left/right margins, clamp tx to
  `[halfW + 6, wrapRect.width - halfW - 6]`. Also added a top-flip
  fallback if the tooltip would clip the top of the chart-wrap.

### 2026-04-28 — Session B (claude-opus-4-7)
**Round 8 — brand mark reset to compass-chip + modal overflow fix**
- User rejected the flowing-flourish brand mark (round 7); reverted to a
  **soft-rounded chip + sleek compass needle** pointing up-right. The
  needle is a slim leaf/lozenge (two pointed ends) drawn with two
  quadratic curves: `M 17 5 Q 13 13 5 17 Q 9 9 17 5 Z`. Chip is a 22x22
  rounded rect (`rx=6`) filled with the indigo gradient + shimmer overlay.
  No fletching, no inner detail beyond the needle.
- `.brand` reverted to a normal `inline-flex` row (chip + wordmark) — the
  absolutely-positioned-flourish CSS from rounds 6/7 is gone. `.brand-name`
  no longer has z-index/position because there's nothing to stack against.
- **Modal horizontal-scroll bug fixed.** Mobile users could scroll the
  Add-offer modal left/right and labels were cut off on the left. Cause:
  flex/grid items have `min-width: auto` by default, which forces the
  cell wider than the parent when contents (long hint text, native date
  inputs) carry intrinsic widths. Fix: added `min-width: 0` to `.field`
  and `.input/.select/.textarea`, plus `overflow-x: hidden` on
  `.modal-body` as a defensive clip. Inputs now uniform and the modal
  no longer scrolls horizontally.

### 2026-04-28 — Session B (claude-opus-4-7)
**Round 7 — bubble stack + brand mark v3**
- Chart cluster bubbles now stack in the SAME order the tooltip lists
  them: each cluster group is sorted by `markers.indexOf(m)` before
  rendering, and the dot at the TOP of the visual stack is the FIRST line
  in the tooltip (last entry sits on the line at `baseY`). Reading top-to-
  bottom now maps cleanly between dots and tooltip text.
- Brand mark redesigned (third pass) per user description: "tail of the
  arrow slightly to the right of the 'r' in Vector, loop through both
  words to the left, curving forward and back up and diagonal to the
  right slightly." Implementation:
  - Single continuous path: `M 140 22 L 24 22 A 8 8 0 1 0 25 22 L 140 4`
    — tail at (140,22), horizontal left to (24,22), near-full loop arc on
    the far left, diagonal up-right to the head at (140,4).
  - Two short barbs form the arrowhead at the tip.
  - Four short slanted feathers at the tail render fletching.
  - The diagonal segment passes BACK through the wordmark area at angle
    — wordmark is in front via z-index 1, so the line appears in the
    gaps between letters.
  - viewBox 156x36, `preserveAspectRatio="none"` so the SVG stretches to
    match the brand container's aspect (depends on text width).

### 2026-04-28 — Session B (claude-opus-4-7)
**Round 6 — flourish brand mark**
- Brand mark redesigned (again, per user). Replaced the chunky polygon
  arrow with a **flowing single-stroke flourish** behind the wordmark:
  small loop at lower-left → sweeping curve under "Yield Vector" → small
  arrowhead just past "Vector". Inspired by hand-drawn elegant logotypes.
- `.brand` is now `position: relative` with extra left padding for the
  loop; `.brand-flourish` is absolutely positioned and z-index 0;
  `.brand-name` sits at z-index 1 so the curve reads as a behind-the-text
  accent. SVG class renamed `brand-arrow` → `brand-flourish`. Old class
  block removed; old polygon SVG gone.
- **Comment-in-template-literal trap (again).** When updating SVG
  comments inside the JS template literal at `renderHeader()`, kept all
  inline references in plain text — no backticks, no nested template
  characters. The previous round's broken-page bug came from that
  exactly. Future sessions: same warning still applies.

### 2026-04-28 — Session B (claude-opus-4-7)
**Round 5 — broken-page fix + reminder feed + Shortcut spec**
- **Critical fix.** Earlier in the day a comment in the brand SVG used
  backticks (`` `stroke-linejoin: round` ``) inside a JS template literal.
  Inner backticks closed the template prematurely → the entire script
  block failed to parse → live page went blank for a window. Removed the
  backticks; verified the inline JS now parses with `vm.Script`. Auto-push
  picked up the fix and pushed (commit `88bc3f2`). **Going forward: never
  use backticks inside HTML comments that live inside JS template
  literals.** Use plain text or single quotes.
- Added `computeReminderFeed(state)` — emits a structured snapshot of
  every actionable date (offer expirations, deposit deadlines, withdrawal
  releases, commitment ends, included events) with stable per-item IDs
  shaped like `yv-offer-<id>-<kind>`. Time component is always `T09:00:00`.
- Hooked into `Sync.push` and `Sync.createGist` so every Gist push stamps
  `App.state._feed = computeReminderFeed(...)` just before serializing.
  Anyone reading the Gist now gets the feed alongside the state.
- Wrote [SHORTCUT_SETUP.md](SHORTCUT_SETUP.md) — step-by-step doc for
  building the iOS Shortcut + Personal Automation. Implements the **merge**
  pattern: each reminder gets `https://yieldvector.local/id/<feed-id>` in
  its URL field, the Shortcut uses that as the merge key, and updates only
  the title + due date on each run (notes / alarms / completion are
  preserved). User builds the Shortcut once on phone; iCloud propagates
  resulting Reminders to every device.
- Status of Reminders sync: **JSON feed shipped on app side**; **Shortcut
  not built** (user has to build it on their phone from the doc — there is
  no way to author a `.shortcut` binary remotely from this side).

### 2026-04-27 — Session B (claude-opus-4-7)
**Round 4 — clickable stat cards + brand fix + Today gray (timeline)**
- Brand mark redone as a **single chunky arrow polygon** (no chip/box).
  Seven-vertex path rotated 45° CCW from a rightward arrow, soft corners
  via `stroke-linejoin: round` + same-gradient stroke at width 2.6, plus a
  white-shimmer overlay. The earlier "triangle outer + white inner arrow"
  is gone. See `.brand-arrow` SVG in `renderHeader()`.
- Timeline "Today" line + pill (`.tl-today` and `.tl-today::before`) were
  still pulling from `var(--accent)` — switched to `#9099a8` line and
  `#6b7280` pill so the chart Today and Timeline Today now match (both
  gray, neither purple).
- **Clickable stat-cards** on the overview hero:
  - `statCard()` helper now takes an optional `action` parameter; when set,
    the card gets `data-action`, `role="button"`, `tabindex="0"`, plus
    cursor + hover-lift + focus-ring CSS (selector `.stat-card[data-action]`).
  - Tied up today → `goto-timeline` → `App.setView('timeline')`.
  - Selected bonuses → `goto-offers-included` → sets
    `App.filters.offersStatus = 'included'` (new synthetic value) and
    switches to Offers view. `renderOffers()` filter now treats `'included'`
    as `offerIsActiveForProjection(o)`. Dropdown also has the new option.
  - Lowest projected → `goto-lowest` → scrolls `#hero-chart-wrap` into
    view, then calls a new `svg.showAtIndex(i)` method on the chart that
    synthesizes `clientX/Y` and re-uses the existing `handleHover` path
    (so no parallel rendering logic). Auto-clears after 5s.

**iOS Reminders, follow-up.** User asked whether a subscribed iCal feed
flows into Reminders.app. It doesn't — feeds populate Calendar only.
Reminders.app and Calendar.app are separate stores. Apple does not expose
a public way to subscribe Reminders to a remote URL. The only path that
ends in real Reminders entries that auto-update is **Apple Shortcuts +
Personal Automation** (option B from prior chat). URL-scheme path (option
C) is per-tap manual, not "dynamically updating." Outline given but not
implemented. If user picks it up later: start with a Calendar `.ics`
export + a separately-distributed Shortcut for Reminders.

**Doctor of Credit URL ingestion (asked, not implemented).** User asked
whether pasting a DoC URL could auto-fill an offer card. Three honest
paths:
- Direct `fetch()` from the browser → blocked by DoC's CORS policy.
- CORS proxy (allorigins, etc.) → works but unreliable; DoC may IP-block
  the proxy.
- LLM extraction (Claude API) → server fetches the page, hands the HTML
  to a model that returns structured JSON. Reliable but requires either a
  small backend or storing an API key client-side. ~$0.005–$0.02 per
  offer with Haiku.
- Zero-backend manual paste: textarea where user copies the DoC post text,
  regex/heuristic extraction. Brittle but works without infra.
Recommend Haiku-extraction if they want clean URL input, manual-paste-
into-textarea as a 30-min ship without backend. Skip if not actually a
pain.

### 2026-04-27 — Session B (claude-opus-4-7)
**Round 3 — design tuning + cross-session handoff**
- HANDOFF.md created at repo root; CLAUDE.md updated to instruct sessions
  to read it on start.
- Brand mark: replaced the rounded-square chip with a **triangle outer**
  shape (purple gradient) containing a small white tapered-arrow inside.
  See [index.html](index.html) `.brand-arrow` SVG in `renderHeader()`.
- "Today" anchor on the hero chart and the hover-follow dot: switched from
  `#5b5cf6` (purple) to neutral grays (`#6b7280` fill, `#9099a8` line/text)
  so they don't read as another Outflow purple bubble.
- Lowest-projected amber: darkened from `#e0a23a` to `#c88b2c` — a touch
  closer to the action-tag warn text shade `#b45309`. Applies to both
  `.stat-value.warn` and `.stat-value.lighten` plus the planner toolbar
  inline color in `renderPlanner()`.
- Synced worktree → main `/Users/collinrekowski/Automation/Churning/index.html`
  so `auto-push.js` picks the changes up on next save.

**iOS Reminders question (asked, not implemented).** User wants to know if
deadline dates from the planner can become iOS reminders. Outline given in
chat — three viable paths: (1) `.ics` calendar export + import, (2)
`x-apple-reminderkit` URL scheme launching the Reminders app prefilled,
(3) Apple Shortcuts integration. None implemented. If the user picks one,
start there.

### 2026-04-27 — Session B (claude-opus-4-7)
**Round 2 — major UI iteration following user screenshots**
- Auto horizon now caps at **180 days** (6 months) — `effectiveHorizonDays()`
  no longer extends past 6 months even if a withdrawal date is further out.
- Chart marker clustering: switched from a "≤1 day apart" rule to a
  pixel-distance rule (`CLUSTER_PX = 16` SVG units). Then redesigned the
  cluster visualization entirely: removed cycling chevrons, replaced with a
  **vertical stack of dots** above the line. The existing hover tooltip
  already aggregates every marker within 12 SVG units of cursor x, so
  hovering the column shows one combined panel listing every action on
  those days.
- Hero card: new top-left CAPS `.hero-label`; `$` symbol now matches digit
  size and weight (was `0.62em` superscripted, now `1em`); shortfall pill
  moved to start of meta row.
- Color tokens:
  - `--text` lifted `#0d1421` → `#1c2030` (smidge off pure black, not gray).
  - `.stat-value.danger` / `.action-tag.danger` → `#e87171` (lighter red,
    matching shades).
  - `.stat-value.success` / `.action-tag.success` → `#0ea968` (mint green,
    deeper than `#10b981`, lighter than `#047857`).
  - `.stat-value.accent` / `.action-tag` (Outflow) → `#6c6ce5` (slightly
    deeper purple).
  - `.stat-value.warn` / `.lighten` → `#e0a23a` then darkened to `#c88b2c`
    in round 3.
- Hero shortfall coloring: added `shortfallTone(v)` in `renderOverview()`
  that returns red if value < 0, buffer-yellow if value < buffer, normal
  text otherwise. Applied to hero amount and inline "Lowest $X". Hero
  amount now formats as `-$10,000` when negative (was clamped to 0).
- Upcoming Actions:
  - Date digit: weight 700 → 500, month 700 → 600 (Mac Calendar feel).
  - Switched `.action-day .day` from tabular-nums to **proportional-nums**
    so narrow numerals like "1" don't sit in extra left bearing — fixes
    "16" looking right-shifted vs "30".
  - Pagination scroll jump fixed: `updateUpcomingPage()` does a targeted
    DOM swap of just the action-list innerHTML instead of calling full
    `render()`. Combined with `min-height: 312px` (360px on small mobile)
    on `.action-list`, the section's vertical footprint is locked.
- Mobile fixes:
  - Tooltip now wraps and is JS-clamped inside the viewport, with a flip-
    below-dot fallback when it would clip the top edge.
  - FAB add-offer button: previously had no `data-action` so clicks
    weren't dispatched; now `data-action="add-offer"` plus
    `pointer-events="none"` on the inner SVG.
  - Timeline portrait: `.timeline-row` is `120px label + 640px track` on
    mobile (forces horizontal scroll instead of crushed labels), label
    column is `position: sticky; left: 0` so rows stay readable while
    scrolling the track.
  - Form-grid bug: 4 fields had `style="grid-column: span 2"` which forced
    a phantom 2nd column on the mobile `1fr` grid. Changed to
    `grid-column: 1 / -1` so spans adapt to the actual column count.
- Optimizer banner + toast both now `text-align: center`.

### 2026-04-27 — Session B (claude-opus-4-7)
**Round 1 — auto-sync verification**
- Investigated user's question about adding cloud auto-sync. Discovered
  the entire feature was already wired up:
  - `App.save()` → `Sync.schedulePush()` (2.5s debounce)
  - `App.init()` → `Sync.startupSync()` (after first paint)
  - `focus` and `visibilitychange` listeners → `Sync.safeSync()`
  - `_lastModified` timestamp comparison in `safeSync()` for last-writer-
    wins conflict resolution.
- Only fix needed: settings banner copy said "~1.5s" but actual debounce
  is 2.5s. Updated banner text only — no behavior change.
- **Do not redo.** Sync infrastructure is complete. If a future user
  question hints at "build auto-sync," confirm before implementing — they
  may be unaware it already works.

---

## Entry template

```markdown
### YYYY-MM-DD — Session [letter] (claude-opus-4-7 | claude-opus-4-6 | claude-sonnet-4-6)
**Round N — short title**
- Bullet 1: what changed, with file path or function name.
- Bullet 2: any non-obvious *why* (a constraint the user gave, a dead end
  to avoid).
- Bullet 3: pending follow-ups or open questions.
```

Keep entries under ~25 lines each. If a round is huge, summarize and link
to a commit hash.
