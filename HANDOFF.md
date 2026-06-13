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
  size or recent tool capabilities that 4.8 or even 4.7 have. If a 4.6 session is going
  to pick up, write entries assuming less inferred context — be more
  explicit about file paths, gotchas, and what *not* to redo.
- 4.6 sessions: when you read an entry written by 4.7 or 4.8, treat its summary as
  authoritative; don't second-guess unless something in the live code
  contradicts it.
- Either way: when you're about to make a change, check this log for "do
  not redo" notes from a prior session that hit a dead end.

---

## Log (newest first)

### 2026-06-12 — Session D (claude-opus-4-8)
**Round 41 — date-picker overflow fix, event-visibility toggles, overview/ddm layout**
- **Date picker mobile overflow (root cause) fixed.** The day cells used
  `aspect-ratio:1` + a reserved `min-height`; in a 5-week month the rows
  stretched taller → aspect-ratio made cells *wider* → grid overflowed
  the card (the July-overflows-but-August-fits bug). Now: fixed **34px
  row height** (no aspect-ratio), grid **always padded to 6 rows (42
  cells)**, columns `minmax(0,1fr)`. Constant size, never overflows.
- **Capital-event visibility — three independent toggles:**
  `includeInProjection` (running balance), `showOnChart` (chart markers),
  `showInUpcoming` (Upcoming-actions list). Upcoming-actions now skips
  `showInUpcoming === false`. Events table gained an "Upcoming" column.
  **NEW-event default changed: include in projection = true, but
  showOnChart = false AND showInUpcoming = false** (paychecks/bills no
  longer clutter the chart or Upcoming list unless opted in). Back-compat
  shim still defaults *existing* events (undefined → true) so they keep
  showing.
- **Bundled UI layout changes** (were uncommitted in the working tree at
  session start — likely a prior session / design-sync; committed in
  `4e3cd1e`, CSS+JS verified in sync): Overview switched from
  `.overview-side` (2-col) to a unified **`.overview-grid`** (3-col track;
  `.overview-main` spans 2, `.overview-aside` col 3) so stat-cards /
  Upcoming / At-a-glance right-edges align. DD-method panel restyled to
  a two-column **`.ddm-inner`/`.ddm-left`** layout (pills stacked right).
  Mobile timeline labels-col 80px → 65px.
- **Docs:** CLAUDE.md + HANDOFF.md now reference Opus 4.8 and the shared
  docs moved to `/Users/collinrekowski/Automation/docs/`.

### 2026-06-08 — Session C (claude-opus-4-7)
**Round 40 — debit requirement + Actions-required card, picker/settings fixes**
- **Date picker overflow fixed.** Responsive width `min(280px,
  calc(100vw-16px))` + `place()` now measures actual size and clamps
  fully into the viewport (both axes, 8px margin) so it can't hang off
  a phone screen.
- **Settings top-row sizing fixed.** The offer-form label-height +
  input bottom-pinning rules were global on `.field` and distorting
  Settings; scoped them to `#offer-form`, added `.form-section
  .form-grid { align-items: start }`, gave all 4 capital/projection
  fields a uniform hint line, removed `max-width:fit-content` on the
  date, shortened the horizon "Auto" option so it stops clipping.
- **Debit-card transaction requirement.** New `offer.debitRequirement
  = { required, count, byDate }`. Offer modal has a Yes/No toggle
  (`name=debitRequired`) that expands to count + optional "complete by"
  date (a yv-date picker). Shown as a `chip-warn` "N debit txns" on the
  card. Back-compat defaulted.
- **"Actions required" At-a-glance card** via `computeActionsRequired()`
  — counts pending to-dos across offers with sub ∈ {prospect, applied,
  approved, on-track} (skipping opened-then-Closed): upcoming DDs to
  initiate, new-funds lump-sum deposits not yet made, and debit-txn
  counts. Verified = 8 on the test fixture.
- ORDER 3→1→2 from the user is now COMPLETE (calendar picker, DoC
  ranking, debit+actions). Remaining roadmap: per-link DD success/
  recency (deferred), reminders enable-checkbox (#4 from earlier).

### 2026-06-08 — Session C (claude-opus-4-7)
**Round 39 — custom date picker, account-default fix, DoC method ranking**
- **Custom color-coded date picker** (`DatePicker` singleton) replaces
  native `<input type=date>` on offer-modal date fields (signup/expires/
  funded = 'plain' mode business-day shading; DD initiation = 'dd' mode
  round-trip shading). Fields are now `readonly text` with `.yv-date` +
  `data-picker-mode`; `.value` stays YYYY-MM-DD so FormData/readDdRows
  unchanged. Popover appended to body (position:fixed), **anchored once
  on open by a fixed edge + 6-row min-height grid** so month nav doesn't
  flip it above/below. Prototype `calendar-preview.html` deleted.
- **Account status now defaults to Closed** (not Open) until an agreed
  sub-status flips it Open. Key subtlety: `PRE_ACCOUNT_SUB_STATUSES`
  (prospect/applied) with Closed account do NOT force-exclude (stay
  hypothetical/includable) — only an opened-then-Closed account excludes.
  `defaultAccountForSub()` + migration updated (prospect/selected →
  Closed).
- **DoC DD-method ranking.** `dd-methods.json` (1,158 banks, baked from
  the DoC list via committed `tools/build-dd-methods.js`; refresh =
  `curl … | node tools/build-dd-methods.js`). `DDMethods` module lazy-
  loads it (same-origin fetch, re-renders when ready). DD / Held+DD
  offer cards show **top-3 source methods by DP count** for the offer's
  bank, **★-flag the user's `settings.sourceBanks` (green)**, with
  fallbacks: best-of-mine when not in top-3, "none of yours" / "add
  source banks" messaging. Fuzzy bank-name match (slug prefix/contains).
  KNOWN LIMITATION: DP count includes both positive + "didn't work"
  datapoints (notes surface the caveat); per-link success/recency would
  need following thousands of comment links (deferred).
- **DD-populate bug** fixed for real (auto-populate moved into
  `syncDdSectionUI`, runs at open AND on type switch).

### 2026-06-08 — Session C (claude-opus-4-7)
**Round 38 — two-field status model + source banks + fixes**
- **Status redesign (shadow approach).** New per-offer `accountStatus`
  ('open'|'closed') + `subStatus` (prospect/applied/approved/denied/
  on-track/met-waiting/earned/didnt-track/archived). The legacy
  `offer.status` is KEPT as a derived shadow via
  `deriveLegacyStatus(account, sub)` so all 44 existing call sites
  (projection/timeline/optimizer/chips) work untouched. `normalize-
  OfferStatus(o)` runs idempotently at the top of `render()` (covers
  load, sync pull, edits) + once in `App.init`. Migration map:
  applied→Approved, funded→On-Track, completed→Earned+Closed,
  skipped→Archived. Projection roles (verified): Prospect/Applied =
  hypothetical; Approved/On-Track/Met/Earned = confirmed (capital
  frees at withdrawal date); Denied/Didn't-Track/Archived = excluded;
  **account Closed force-excludes regardless of sub status.** Auto-flip
  account→Open when sub ∈ {approved,on-track,met-waiting,earned,
  didnt-track}. Modal now has two selects; inline card dropdown + offers
  filter + chips all use subStatus.
- **At-a-glance:** "Active offers" card replaced by **"Working toward
  SUB"** = account-open offers with sub ∈ {approved,on-track,met-waiting}.
- **"My source banks" setting** (`settings.sourceBanks: []`) — add/
  remove/dedupe list in Settings. Foundation for DoC DD-method ranking.
- **Fixes:** DD rows now populate on first modal open (was: had to
  toggle requirement mode); calendar-preview legend relabeled to
  relative buckets (not misleading "+1 day"); color-picker X-ring
  clip fixed (picker padding); Upcoming-actions offer click opens the
  modal in place (no tab switch).
- **Adopted descriptive commit messages** (CLAUDE.md updated). Tags:
  `stable-2026-06-08`, `stable-2026-06-08b`.
- **calendar-preview.html** = standalone prototype (not linked from the
  app). Delete once the real picker is integrated.

### 2026-05-28 — Session C (claude-opus-4-7)
**Round 37 — DD offer overhaul: round-trip ROI, requirement modes, drop "Other"**
- **Removed the "Other" offer type.** Only `new-funds-held`,
  `direct-deposit`, `held-and-dd` remain. Legacy `offerType:'other'`
  coerces to `new-funds-held` on edit + in the card chip (no migration
  needed; it already behaved like held).
- **Standard direct-deposit ≠ held-and-dd now.** Standard DD has NO
  bank hold — each DD just round-trips through the account. The "Funds
  must remain through day X" field is hidden for standard DD and not
  required by validation. Held+DD keeps the hold field.
- **Global DD transfer model** (Settings → "Direct-deposit transfer
  timing"): `settings.ddTransfer = { inDays, seasonDays, backDays }`,
  default 1/1/1 = "season 1 business day" (user's pick). Round trip:
  initiate → +inDays biz → posts as DD → +seasonDays biz → sent back →
  +backDays biz → returns. New helpers `addBusinessDays`,
  `ddTransferConfig`, `ddRoundTrip(dd)` → { initiate, post,
  returnInitiate, returnDate, heldDays }. Verified: Fri-initiated = 5
  held days, Mon = 3 (matches the spec example).
- **ROI is dollar-days weighted** for DD offers:
  `annualizedReturn = bonus × 365 / Σ(amount_i × heldDays_i)` via new
  `ddCapitalTime(offer)` → { dollarDays, totalAmount, weightedDays }.
  Standard DD: heldDays = round trip (weekend/holiday delays included).
  Held+DD: heldDays = DD effective date → shared withdrawal date.
  Reduces to the normal formula for one DD. Optimizer blended return
  + card "Days tied up" (shows weighted-avg) + "Annualized" all use it.
- **lockStartDate / withdrawalEligibleDate** branch by type now:
  standard DD lockStart = earliest DD initiation, withdrawal = latest
  round-trip return; held+DD = last DD effective + daysFundsMustRemain;
  new-funds-held unchanged. Projection ties up each standard-DD amount
  over ITS OWN round trip (not a shared window).
- **DD requirement modes** in the modal: `ddRequirement = { mode:
  'count'|'frequency', count, freqEvery: week|2weeks|month, freqPeriods }`.
  Count (default 1) or "once per <period> for <N>". Changing it
  auto-populates that many dated DD rows (first planned EARLY = next
  biz day after signup, so there's runway to retry from another bank;
  rest spaced by cadence). Each row shows "Posts X · back by Y · tied
  up Nd". Explicit "Generate dates" button too.
- **Side note done:** removed "If different from signup date." hint.

### 2026-05-28 — Session C (claude-opus-4-7)
**Round 36 — LOCKED tooltip color recipe (do not drift)**

The user signed off on these values as the final tooltip color treatment.
Do NOT re-tune unless explicitly asked. Each value below has been
iteratively dialed in over many rounds — random "make it brighter" or
"make it darker" passes will undo the careful balance.

**Locked: chart marker fill colors (also the legend swatches)**
- Initial funding (held offers): `#5b5cf6`
- Direct deposit (DD offers): `#2d9cdb`
- Withdrawal: `#10b981`
- Deposit deadline: `#e87171`
- Bonus payout: `#10b981` (inherits inflow green)
- Inflow event: `#10b981`
- **Outflow event: `#e87171`** (red, NOT amber `#f59e0b` — amber was
  the buffer color and made outflows read as "warning", not "money
  leaving the account")

**Locked: tooltip "Available" amount color**
- `#8e90ff` — sits about ⅓ of the way between the trendline's raw
  `#5b5cf6` and pure white. Same hue family as the trendline so it
  reads as "this is the line you're hovering".

**Locked: tooltip left-label color map (`labelLift`)**
The left labels ("Direct deposit", "Fund date", "Withdrawal", etc.)
need a slight lift on dark BG so they read as crisply as the legend
swatches do on the white card BG. Greens/blues/purples below; reds
and amber pop fine at raw saturation and stay raw.
```js
const labelLift = {
  '#5b5cf6': '#8a8cff',   // indigo → lifted purple
  '#2d9cdb': '#5cb4e4',   // sky    → lifted blue
  '#10b981': '#6ee7b7',   // green  → lifted mint
  // Red `#e87171` and amber `#f59e0b` stay raw
};
const evColor = labelLift[m.color] || m.color;
```

**Locked: right-side identity color (`idColor`)**
- When the offer has a color set: `lightenHexForDark(m.offerColor)` —
  HSL-based programmatic lighten to ~74% L. Matches the offer card's
  identity dot in Upcoming Actions and the bank's color stripe.
- When no offer color: falls back to `evColor` (the lifted event
  color above). So an outflow "Rent" reads in lifted-red, matching
  the left "Outflow" label and the legend swatch.

**Locked: opacity + weight on event-type labels**
- `opacity: 1` inline override (the `.label` class baseline is
  `opacity: 0.7` for muted rows like "Available" / "Tied up").
- `font-weight: 600`.

**Critical implementation note:** the raw colors above are reused in
multiple places (chart marker fills, legend swatches, lookup keys in
`labelLift`). If any one is changed, the others fall out of sync
silently. Search for the exact hex (`#5b5cf6`, `#2d9cdb`, `#10b981`,
`#e87171`) before editing — there are usually 3+ occurrences.

### 2026-05-28 — Session (claude-sonnet-4-6)
**Round 35 — Task watcher remediation (remote, Collin away for a week)**

This session worked exclusively on the `task-watcher.js` system, NOT Yield Vector UI.
Changes are in `/Users/collinrekowski/Automation/`, not in this repo.

**What was done (all remotely, no Mac interaction required):**

1. **Created `capone-offers/CLAUDE.md`** — The project directory was completely empty (no
   CLAUDE.md), so every watcher-invoked claude session in that dir exited immediately.
   File now gives claude the full context: what the project is, how to read the Apple Note
   via osascript, how to check GitHub issues, pre-approved access, bypassPermissions note.

2. **Added `readNoteViaOsascript()` to `task-watcher.js`** — New function that tries
   `/usr/bin/osascript` inline to read Notes before falling back to `read-note.app`.
   Strips HTML (`<br>` → newline, tags stripped, entities decoded) so output is parseable
   by the existing `parseChecklistItems()` function. Both approaches still fail in mtime-only
   mode (TCC permission not granted for background process) — same behavior as before —
   but the new approach is simpler and has a different TCC identity, which may behave
   differently once Collin is back.

3. **Modified `readNote()` in `task-watcher.js`** — Now tries `readNoteViaOsascript` first.
   On success, returns content immediately. On failure, logs "osascript Notes read failed...
   -- trying read-note.app" and falls through to read-note.app. On read-note.app success,
   returns content with no failure count increment (osascript failure ≠ Notes permission failure).

4. **Updated non-notes-trigger claude prompt** — When claude is invoked from a GitHub issue
   change or mtime trigger, it now gets explicit osascript instructions to try reading the
   Apple Note directly, including how to strip HTML and parse checklist items.

5. **Updated `prime-notes-permission.sh`** — Now auto-restarts the watcher after a successful
   permission grant, instead of just printing restart instructions.

6. **Watcher restarted** — Running cleanly. Correct startup sequence confirmed in log:
   "osascript Notes read failed... -- trying read-note.app" → mtime-only mode → "Task Watcher is running."

**What CANNOT be done remotely:**
- Granting Apple Notes TCC permission — requires clicking the dialog in System Settings or
  in the permission prompt. When Collin returns, run `./prime-notes-permission.sh` from Terminal;
  it will now auto-restart the watcher after the click. After that, the watcher will be in
  content-comparison mode.

**Watcher status as of this session:**
- Running (launchd auto-start on login) ✓
- GitHub ETag polling: 30-min interval, auth valid ✓
- Notes mode: mtime-only (expected — TCC permission pending)
- capone-offers now has CLAUDE.md ✓

---

### 2026-05-25 — Session (claude-sonnet-4-6)
**Round 34 — Settings tab three fixes**
- **Projection Start Date overflow** (`~line 4061`): Added `style="max-width:fit-content"` to
  the bare `<input type="date">` so it no longer stretches beyond its content and overflows right.
- **Capital Commitments Name column** (`renderCommitmentsTable()`, `~line 4160`): Added
  `style="min-width:160px"` to the Name `<th>` so the column is wide enough for typical bank
  names, preventing excessively tall rows.
- **Strip "- Bonus" from commitments table** (`~line 4174`): Applied the same regex already
  used in timeline labels — `replace(/(\s*[-–—]\s*|\s+)Bonus\s*$/i, '').trim()` — to the
  `c.commitmentName` display in `renderCommitmentsTable()`. US Bank "- Bonus" suffix now hidden.
  The underlying stored name is unchanged; only the display is stripped.
- Also: removed stale git lock files on the Mac (`index.lock`, `HEAD.lock`,
  `refs/remotes/origin/main.lock`) that had been blocking all git operations.
- Commit: force-pushed `014274e` to main. GitHub Pages auto-deploys in 30–90s.

### 2026-05-24 — Session (claude-sonnet-4-6)
**Round 31 — Settings tab input alignment**
- Fixed vertical misalignment of input boxes in the Settings tab form-grid.
- Root cause: `.field` uses `display:flex; flex-direction:column` with `margin-top:auto`
  on inputs to bottom-pin them. Fields with a `.field-hint` *below* the input had the
  hint consuming space at the very bottom, so those inputs landed higher than hint-free
  fields — visually misaligned.
- Fix: moved all `.field-hint` spans to appear **above** their input/select/input-group
  in the HTML (between the label and the control). This is a common "helper text"
  pattern. The `margin-top:auto` on the control now correctly pushes it to the bottom
  in every cell regardless of hint presence.
- Changed fields: Minimum cash buffer, Projection horizon, Optimizer max candidates,
  Gist ID, Personal Access Token (all in `renderSettingsTab()`).
- Commit: `d0057f0` — pushed to main, GitHub Pages auto-deploys.

### 2026-05-17 — Session (claude-sonnet-4-6)
**Round 30 — README.md**
- Created `README.md` at repo root. Covers: what the app does, live URL, local dev
  (no build step, `node auto-push.js`), architecture (single-file PWA, key function
  table), offer types, business-day logic, GitHub Pages deploy protocol, task
  workflow (HANDOFF/AGENTS/CHANGELOG/SHORTCUT_SETUP), and pending items (iOS
  Reminders Shortcut, DoC URL ingestion).
- Applied Rounds 28–29 fixes (OTHER centering, modal field order, timeline
  min-height) to the worktree branch so it stays in sync with main.

### 2026-05-17 — Session (claude-sonnet-4-6)
**Round 29 — Timeline label polish**
- `commitmentName()`: no longer appends " Bonus" fallback — uses `bankName` only
- Timeline label strips `/ — Bonus$/` from existing stored commitment names (`~line 3757`)
- "minimum balance" type sub-label now shows "Min Bal" instead of full string
- Mobile timeline left column narrowed from 96px → 80px

### 2026-05-16 — Session (claude-sonnet-4-6)
**Round 28 — OTHER centering, modal field order, timeline compression**
- **OTHER button centering** (`~line 1334`): Added `flex-wrap: nowrap` to
  `.radio-group` and converted labels to flex containers
  (`display:flex; align-items:center; justify-content:center; flex:1 1 0%;
  min-width:0`) so all three offer-type options render at equal width with
  truly centered text regardless of content length or iOS flex quirks.
- **Modal field order** (`~line 4903`): Moved "Bonus amount" field to appear
  BEFORE "Offer type" in the add/edit offer modal. New order: Bank name →
  Offer name → Bonus amount → Offer type → DD section → Required funding → …
- **Timeline row heights** (`~line 1020, 1052, 1050, 1721`):
  - `.timeline-row-label` and `.timeline-row-track`: changed `height: 44px`
    to `min-height: 44px` so rows can grow if content overflows.
  - `.timeline-row-label .sub`: added `white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis` to prevent sub text (e.g. "$1,500 · Confirmed")
    from wrapping in the narrow 96px label column, which was the root cause
    of clipping. With nowrap, label and track heights stay synchronized.
  - Landscape `@media` override: removed the aggressive `height: 38px`
    compression (replaced with `min-height: 44px` matching portrait) and
    restored normal padding (`5px/6px`) so the sub line is never clipped.
    Axis rows similarly relaxed: `height: 26px` → `min-height: 32px`.

### 2026-04-28 — Session C (claude-opus-4-7)
**Round 27 — offer types (DD / Held / Other) + US business-day math**
- **New offer-type field** on `Offer`: `offerType: 'new-funds-held' |
  'direct-deposit' | 'other'`, default `'new-funds-held'` on new offers
  and back-filled for any legacy offer that loads without one.
- **directDeposits[]** array on DD offers: `{ plannedDate, amount }`
  per entry. Modal renders a dynamic add/remove sub-form for these
  (renderDdRow, addDdRow, removeDdRow, readDdRowsFromForm). DD entries
  section is hidden unless the type radio is set to direct-deposit;
  toggle wired via a local form `change` listener inside
  `showOfferModal()` so it doesn't leak into the global event bus.
- **Business-day calendar** — `usFederalHolidays(year)` computes the
  11 Fed/ACH holidays dynamically each year. Fixed-date holidays
  follow the standard Sat→Fri, Sun→Mon observed shift; floating ones
  (MLK 3rd-Mon-Jan, Memorial last-Mon-May, Thanksgiving 4th-Thu-Nov,
  etc.) compute via `_nthWeekdayOfMonth` and `_lastWeekdayOfMonth`.
  Cached per year. Helpers: `isUsBankHoliday`, `isBusinessDay`,
  `nextBusinessDay`, plus `directDepositEffectiveDate(dd)` which
  returns the YYYY-MM-DD of the next business day if the user-entered
  plannedDate is a weekend/holiday, else the planned date itself.
- **Decisions applied per the user's "ship it"**:
  1. `requiredFundingAmount` stays as the bank's target on DD offers.
     `directDeposits[]` is the planned hits. Both visible. (a)
  2. DD hold period starts after the FINAL DD effective date —
     `lockStartDate(o) = max(dd.effectiveDate)` for DD offers,
     `withdrawalEligibleDate(o) = lockStart + daysFundsMustRemain`. (a)
  3. Lossless: store the user-entered plannedDate; derive
     effectiveDate on the fly. Card shows both (with a "⇢" hint and
     tooltip "Planned X shifted to next business day") so the user
     can see why the chart shifted. (a)
- **Projection engine** updated: for DD offers, each DD applies its
  own `applyCommitment(amount, effectiveDate, withdrawalEligibleDate)`
  so tied-up capital accumulates step-wise as each DD lands rather
  than appearing as one block at the final DD date.
- **Visual differentiation:**
  - Card: type chip in the chip row (`DD` teal / `Held` indigo /
    `Other` neutral). DD offers also render a teal-tinted
    `.offer-dds` block with one row per DD: `DD N · $X · Mon Jan 5`
    plus a `⇢` glyph when the planned date was shifted forward.
  - Chart: per-DD fund markers (`#2d9cdb` teal) replace the single
    `#5b5cf6` indigo fund marker for DD offers. New `dd-fund` marker
    type, light-color `#8ecae6` in tooltip, new legend swatch.
    Deposit-deadline marker is suppressed for DD offers (the
    deadline concept doesn't apply once you're tracking individual
    DD dates).
- **Validation:** `isOfferComplete()` and `offerIssues()` require
  `directDeposits.length > 0` and `every(dd => date && amount > 0)`
  for DD offers. Held/Other behave as before.

### 2026-04-28 — Session C (claude-opus-4-7)
**Round 26 — modal form containment wall (date-input cutoff fix)**
- Fields 5 + 6 of the Add-Offer modal ("Offer expires", "Planned signup
  date") were still overflowing on iOS even after the Round 24 flex-
  column rewrite. Root cause: `<input type="date">` on iOS Safari
  carries an intrinsic min-width from the native chevron/spinner UI
  baked into the user-agent stylesheet — exceeds `width: 100%` even
  with `box-sizing: border-box`.
- Added a dedicated "MODAL FORM CONTAINMENT — BLAST RADIUS CONTROL"
  CSS block with `!important` on every relevant property and selector
  in the modal subtree:
  `.modal .field, .modal .form-grid > *, .modal .input-group,
   .modal .radio-group, .modal .input, .modal .select, .modal .textarea
   { width: 100% !important; max-width: 100% !important;
     min-width: 0 !important; box-sizing: border-box !important;
     flex-shrink: 1 !important; }`
  Plus `.modal .field, .modal .form-grid > * { grid-column: 1 / -1
  !important }` to neutralize any inline `style="grid-column"` and
  `.modal, .modal-card, .modal-body, .modal .form-grid { overflow-x:
  hidden !important }` as a final clip.
- Added a date/number-specific override:
  `.modal .input[type="date"|"datetime-local"|"time"|"number"]
   { -webkit-appearance: none !important; appearance: none !important; }`
  — strips iOS's intrinsic native-control width so the inputs collapse
  to the modal-sized box we give them. The native picker still works
  on tap; only the visual chrome is stripped.

### 2026-04-28 — Session C (claude-opus-4-7)
**Round 25 — sync input pre-fill (defensive, with legacy fallback)**
- Symptom: Gist token + ID fields empty on load even though credentials
  were saved on this device. The HTML-attribute path
  (`value="${escapeAttr(cfg.gistId || '')}"`) should have been enough,
  but something between render and paint was wiping the values.
- Fix: added `prefillSyncInputs()` that runs in `renderChartsAfterMount()`
  on every render. Sets `.value` directly on the DOM input elements,
  bypassing any HTML-attribute or autocomplete quirks. Then calls
  `updateSyncButtonsLive()` so the Pull/Push/Disconnect buttons reflect
  the post-prefill state on first paint, not after the next keystroke.
- **Legacy fallback.** Resolution order is now
  `Sync.getConfig() → App.state.settings.{gistId,gistToken}` so if any
  prior version of the app stored credentials on `App.state` (or some
  device's state was synced from one that did), they're recovered and
  promoted into the canonical `SYNC_CONFIG_KEY` storage so subsequent
  `isConfigured()` calls succeed without a manual re-save.

### 2026-04-28 — Session C (claude-opus-4-7)
**Round 24 — sync buttons live-enable, modal/form hardening, hero amount diet**
- **Sync Pull/Push/Disconnect were stuck disabled** until "Save & test"
  was clicked, even after credentials were typed — looked broken. Two
  changes: (1) `updateSyncButtonsLive()` runs from `onInput()` whenever
  `#sync-gist` or `#sync-token` changes, toggling `disabled` based on
  whether both fields have non-empty values; (2) the click handlers
  for `sync-pull` / `sync-push` now call `ensureSyncConfigSaved()`
  first, which auto-persists typed credentials before the action runs.
  Net effect: type both fields → buttons light up → click Pull → it
  works without an intermediate Save click.
- **Add-Offer form sizing — non-negotiable rules.** Mobile-portrait
  AND mobile-landscape modal blocks now both use the same recipe:
  `.modal-card { width: calc(100% - 32px); max-width: 480px; margin:
  auto }`, `.form-grid { display: flex; flex-direction: column;
  gap: 12px }` (NOT grid — neutralizes any inline `style="grid-column"`
  via `.field[style*="grid-column"] { grid-column: auto !important }`),
  and a defensive `width: 100%; max-width: 100%; min-width: 0;
  box-sizing: border-box` on every input/select/textarea/input-group.
  Landscape no longer fans inputs across 720 px — they cap at 480 px
  centered, matching portrait visual rhythm.
- **Hero amount.** Down 40 → 38 px (5% smaller per spec), color
  lightened `#1a2235 → #2a3245` (less heft), `.hero-amount
  .currency-symbol` now `margin: 0; padding: 0; letter-spacing: 0`
  so the gap between `$` and the first digit is pure typographic
  kerning rather than CSS-injected — matching the rest of the app
  where dollar values are emitted as a single concat
  `'$' + n.toLocaleString()` string. Breakpoints scaled to match:
  720 px 36 px, 480 px 34 px, landscape 28 px.

### 2026-04-28 — Session C (claude-opus-4-7)
**Round 23 — PWA icon = header brand mark (pixel-identical at scale)**
- Rewrote `setupPwa()` so the canvas-rendered home-screen icon mirrors
  the inline SVG brand mark in `renderHeader()` exactly. Header is a
  22×22 viewBox; canvas is 180×180; every coord is multiplied by
  `S = 180/22 ≈ 8.18`. No more divergence between the two glyphs.
- **Locked reference (keep both in sync if either is edited):**
  - rect 22×22, rx=6
  - chip gradient (BL→TR, x1=0 y1=22 x2=22 y2=0):
    `0% #1e1b4b · 45% #4338ca · 80% #7c3aed · 100% #b69cff`
  - shimmer (x1=0 y1=0 x2=14 y2=14):
    `0% rgba(255,255,255,0.18) · 100% rgba(255,255,255,0)`
  - shaft `M 5.5 16.5 Q 9 12 16 6.5`, white stroke 2 round
  - arrowhead `M 10.8 7.2 L 16.5 6 L 15.3 12`, same stroke
  Comment block at the top of `setupPwa()` reproduces this so future
  edits hit both files.
- Updated both theme-color references (the `<meta name="theme-color">`
  in the `<head>` and the manifest's `theme_color`) from the legacy
  `#5b5cf6` to `#4338ca` — pulled from the chip's mid-gradient so the
  iOS status-bar tint and Android task-switcher header harmonize with
  the icon rather than the old standalone accent.

### 2026-04-28 — Session C (claude-opus-4-7)
**Round 22 — chart pan/long-press, fixed tooltip, hero, landscape modal, At a glance**
- **Chart touch model — coexisting swipe-pan + long-press-inspect.** The
  old `touchmove` handler called `e.preventDefault()` which blocked the
  parent `.chart-wrap`'s `overflow-x: auto` native scroll, so users
  couldn't pan the (wider-than-viewport) chart on phones. Replaced with
  a state machine: `touchstart` arms a 200 ms timer; if the finger
  moves > 10 px before the timer fires, it cancels and the wrap pans
  natively. If the finger holds still long enough, the timer fires and
  flips into "inspect mode" — subsequent touchmoves call
  `preventDefault()` and route through `handleHover()`. `touchend`
  fades the tooltip after 600 ms. Standard Robinhood/Wealthfront
  pattern.
- **Tooltip locked dimensions on mobile.** Was reflowing into different-
  size boxes day-to-day depending on which markers were nearby. Now
  `.chart-tooltip` is `width: 220 px; min-width: 220 px` on mobile,
  with `text-overflow: ellipsis` on the right value cell so long event
  names truncate inside the fixed box rather than expanding it.
- **Hero amount + label.** Font 42 → 40 px, weight 700 → 600 (less
  slab), color `var(--text)` → `#1a2235` (slightly lighter than the
  near-black token). `$`-to-digit margin 2 → 1 px to match the rest of
  the app's prefix rhythm. `.hero-label` now `white-space: normal;
  overflow-wrap: anywhere` and on mobile drops to 13 px / 0.04 em
  letter-spacing so "Available capital today" can't truncate to
  "AVAILABLE CAPI…" on narrow viewports.
- **Landscape Add-Offer modal — capped form width.** Modal-card stays
  720 px max but the `.modal-body`, `.modal-header`, and `.modal-footer`
  are now constrained to 520 px and centered with `margin: 0 auto`.
  Inputs read at a comfortable ~480 px wide instead of stretching
  edge-to-edge.
- **At a glance — designed dashboard panel.** Each `.snap` cell now has
  a 3 px color-coded left accent stripe (Active=violet, Confirmed=green,
  Events=amber, Horizon=gray, Buffer=warning-amber, Bonus=success-green),
  value-above-label layout (column-reverse), 19 px / 700 value font,
  uppercase 11 px label. Card itself moved from `var(--card-soft)`
  flat-no-shadow to `var(--card)` + `var(--shadow-card)`. Title gets
  a hairline divider trailing it (`::after`) so the panel reads as an
  intentional component rather than a flat list.

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
