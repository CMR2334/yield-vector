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

### 2026-06-23 — Session H (claude-opus-4-8)
**Round 52 — Held+DD card "Fund date" = funding date (not DD date)**
- On a Held+DD offer card, "Fund date" used `lockStartDate(o)`, which for
  `held-and-dd` anchors on the DD landing date — so it just duplicated the
  "DD 1" row (e.g. both showed Jun 29). Per user: it should reflect the
  planned funding date (the held LUMP SUM deposit), which is distinct.
- Fix (`renderOfferCard`, the `.offer-dates` block, ~line 4885): for
  `held-and-dd` the card's Fund date now shows `bizDayISO(effectiveFunding-
  Date(o))` (planned funding date → next business day); all other offer
  types keep `lockStartDate`. **Display-only** — does NOT touch
  `lockStartDate`/`withdrawalEligibleDate`/projection/timeline (held-and-dd
  still ties up the DD amounts from the DD date through withdrawal). Verified
  in preview: Fund date Jul 20, DD 1 Jun 29 — no longer redundant.
- Coordination note: started cold as a NEW session with 2 stale overlapping
  claims (idle, already committed+pushed). Released both with `--force`
  (the only "dirty" path was the pre-existing untracked
  `Deal Stack Calculator.html`, left untouched). My Round 44–50 work is
  intact in HEAD; Session G (Rounds 51, chart sizing, version stamp) built
  on top of it.

### 2026-06-15 — Session G (claude-opus-4-8)
**Round 51 — File-manager pass: versioning, error handling, doc realignment, repo hygiene**
- **Repo hygiene.** Pruned 6 orphaned git worktrees (stale `Churning`-path
  gitdirs left from the folder rename) + deleted 7 leftover local `claude/*`
  branches; removed the on-disk `.claude/worktrees/` copies, `nohup.out`, and
  stray `.DS_Store`. `main` is now the only branch; working tree clean (~2 MB
  reclaimed).
- **In-app version stamp.** New `APP_VERSION` (top of the `<script>` in
  `index.html`) = `2026.06.15`, shown in **Settings → About & diagnostics**.
  Date-build format — bump it + tag `stable-YYYY-MM-DD` on each release so a
  cached PWA can be identified. `package.json` 1.0.0 → 1.1.0.
- **Error handling + diagnostics.** Global `error`/`unhandledrejection`
  handlers (`installErrorHandlers`, first line of `App.init`) + `logError`/
  `ErrCode` taxonomy + 25-entry localStorage ring buffer (`yv-diag-log-v1`).
  `render()`/`init()` wrapped → `renderErrorState()` recovery panel instead of
  a blank iOS screen. Settings panel: Copy-diagnostics (version/UA/stacks) +
  Clear. Silent `JSON.parse`/sync `catch {}` blocks now log. Code commit
  `9dc560f`; verified every path in preview (E_UNCAUGHT/E_PROMISE/E_RENDER all
  logged; recovery panel + copy-report work).
- **Doc realignment.** Fixed stale "~4500 lines" → ~8,000 across
  README/AGENTS/CLAUDE; resolved the `"auto update"` vs descriptive-commit
  contradiction; de-duplicated the key-function table into **AGENTS.md** (now
  the single canonical source — README/CLAUDE link to it); revived
  **CHANGELOG.md** with milestone entries bridging 2026-05-17 → 06-15 + a
  CHANGELOG-vs-HANDOFF role note; added Documentation Map / Versioning /
  Error-handling sections to AGENTS.md.
- **HANDOFF archive.** Rounds 34→1 moved to `HANDOFF_ARCHIVE.md` (this file
  was 1,251 lines / 76 KB). Live log keeps Rounds 51→35 + the entry template.
- **Do not redo.** Versioning/diagnostics/error-handling exist — to ship a
  good state, just bump `APP_VERSION` + tag `stable-YYYY-MM-DD` + add a
  CHANGELOG line.

### 2026-06-14 — Session F (claude-sonnet-4-6)
**Round 50 — Settings native date overflow + DD count-box balance**
- **Projection start date overflow (mobile).** `#s-start` is a native
  `<input type="date">` in the (non-modal) Settings form, so it never got
  the modal blast-radius `appearance:none` treatment — on iOS Safari its
  intrinsic UA min-width overflowed the right edge. Added a GLOBAL rule
  (~line 1455) for `.input[type="date"|"datetime-local"|"time"]`:
  `appearance:none` + width:100%/max-width:100%/min-width:0/border-box.
  Calendar icon still shows on desktop; native picker still opens on tap.
  (Custom offer-modal date fields are `type="text"` yv-date pickers —
  unaffected.)
- **DD count "deposits" box still gappy.** R49 left it at 200px, so a
  single "1" sat far from the right-aligned "deposits" suffix. Narrowed to
  138px (matches the freq box's visual balance) so number + suffix read
  together. Freq controls (112px/122px) unchanged.

### 2026-06-13 — Session F (claude-sonnet-4-6)
**Round 49 — DD requirement "rule boxes" mobile sizing fix**
- The offer modal's DD requirement controls (Once-per [select] / for [N]
  [unit], and the count "[N] deposits" box) were stretching to full width
  and stacking awkwardly on mobile. Root cause: the MODAL BLAST-RADIUS CSS
  (~line 1480) sets `.modal .select/.input-group { max-width:100% !important }`,
  which overrode the inline `max-width:130px/160px/200px` on those controls.
- Fix (~line 1520): re-assert compact widths with higher specificity +
  `!important` — `#ddreq-freq-fields .select` 112px, `.input-group` 122px
  (both `flex:0 0 auto`), `#ddreq-count-fields .input-group` max 200px. Now
  "Once per [month] for [3] months" reads inline on one line and "Generate
  dates" wraps beneath; the count box is a sensible 200px.
- Checked the DD date picker popover (`.yv-dp`) and the DD-row date fields
  in preview — both already fit within the mobile viewport (280px popover,
  no overflow); no change needed there. If the user means a different
  "date bubble", get a pointer.
- Context: user had accidentally hit Settings → Data → "Reset to sample
  data" (mistook it for the new Restore-from-history button). Recovery path
  given: Settings → Cloud sync → Restore from history → pick the revision
  just before the sample-data one. (No code change for that — the R47 tool
  handles it.)

### 2026-06-13 — Session F (claude-sonnet-4-6)
**Round 48 — Settings "Capital & projection" desktop grid fix**
- The section's `.form-grid` used `repeat(auto-fit, minmax(220px, 1fr))`,
  which on desktop produced 5 cramped columns and ragged wrapping; 2-line
  hints ("Days below this threshold…", "Brute force evaluates…") with
  `align-items:start` also left inputs on uneven baselines.
- Scoped fix: gave the grid `id="capital-grid"` (~line 5014) and added CSS
  (~line 1397) — `repeat(3, minmax(0,1fr))` desktop, `repeat(2,…)` ≤1024px,
  `align-items:stretch` + `margin-top:auto` on the field controls so every
  input in a row shares one baseline even when a hint wraps. Mobile (≤720
  flex-column rules) is unchanged. Other form-sections (Cloud sync, etc.)
  keep the auto-fit base, so only Capital & projection changed.
- Verified 3/2/1 columns at 1280 / 900 / 375 in preview.

### 2026-06-13 — Session F (claude-sonnet-4-6)
**Round 47 — Cloud sync: revision-history restore + push overwrite guard**
- **Incident:** user had ~6 offers + extra events on mobile. Logged into a
  STALE desktop (3 offers), pasted the token, and pushed → last-writer-wins
  overwrote the Gist's 6-offer state with 3. `Sync.push()` always stamps
  `_lastModified = Date.now()`, so a stale device's push silently wins.
- **Recovery — "Restore from history"** (`showSyncHistoryModal()` ~near
  `closeModal`; `Sync.listHistory/fetchRevision/restoreState` in the Sync
  object). GitHub keeps every Gist revision; the modal lists the last 20
  newest-first with each revision's offer/commitment/event counts +
  timestamp, and a Restore button. Restore sets `App.state` to that revision
  and pushes it up (fresh timestamp) so it becomes current on all devices.
  Reversible — the pre-restore state stays in history. New button in the
  sync section + `sync-history`/`sync-restore` actions. CSS `.sync-hist-*`.
  Caches fetched revisions in `App._syncHistoryCache` keyed by version.
- **Prevention — `guardedManualPush()`** now backs the "Push now" button
  (was `Sync.push()`). It peeks at the cloud first; if `remote._lastModified
  > local._lastModified` it confirms with the offer counts ("Cloud: 6, this
  device: 3 — push anyway?") so a stale device can't silently clobber newer
  data. Auto-push (debounced, post-edit) is unchanged.
- Verified the modal UI in preview with stubbed history (renders rows with
  counts; "current" chip on newest). Live Gist calls need real creds.

### 2026-06-13 — Session F (claude-sonnet-4-6)
**Round 46 — Overview "Available capital" chart: frozen $ Y-axis; timeline tweaks**
- **Hero chart Y-axis now frozen on mobile.** The $ axis labels ($0–$200K)
  were `<text>` drawn INSIDE the scrolling SVG, so they scrolled off. New
  structure in `renderOverview()` (~line 4062): `.chart-wrap` (overflow
  visible, tooltip anchor) > `.chart-scroll` (overflow-x auto, flex) >
  `.chart-yaxis` (sticky left:0, 48px, HTML labels) + `svg.chart-svg`
  (plot). `renderHeroChart()` now: padL 56→32 (labels are external), the
  yTicks loop emits ONLY the gridline, and after `svg.innerHTML` it
  populates `#hero-chart-yaxis` with `.ylab` spans at `top:(yFor(t)/H*100)%`
  — vertical % is scale-independent so labels line up with gridlines at any
  width (SVG has no vertical letterbox at height:auto). Verified: Y-axis
  `yaxisFrozen:true` scrolled to end on mobile; desktop fills, no scroll;
  tooltip still works (parented to body, Round 18). Removed the old
  `-webkit-overflow-scrolling:touch` + `min-width:600` on `.chart-svg`
  (broke iOS sticky); SVG is now flex (mobile width:540 forces scroll,
  desktop flex:1 fills).
- **Timeline label col 5% narrower:** desktop 165→157px, mobile 89→85px.
- **Timeline rows no longer show offer sub-status.** Offer row `sub` is now
  just `formatCurrency(o.requiredFundingAmount)` (was `$25,000 · On-Track`).
  Commitment rows still show amount · type (that's a type, not a status).
- NOTE: the original "Y-axis/value labels scroll off" report was about THIS
  chart (Overview "Available capital"), not the Timeline. R44/R45 fixed the
  Timeline; R46 fixes the Overview chart with the same sticky pattern.

### 2026-06-13 — Session F (claude-sonnet-4-6)
**Round 45 — Timeline Y-axis freeze (real fix), label widen, DoC method clarity**
- **Root-cause fix for sticky Y-axis on mobile.** Round 44 made labels
  `position:sticky` but they still scrolled off near the scroll END on
  mobile. Cause: `.timeline-row` (flex) was clamped to the viewport width
  (~343px), so the sticky label was trapped inside the row's box — once the
  row scrolled past, it dragged the label with it (verified: label hit
  -50px at scrollLeft 320). Fix: `.timeline-row { width:100%;
  min-width:max-content }` — `width:100%` fills the wrap on desktop (track
  stretches, no scroll), `min-width:max-content` forces the row to span
  label+track (≥600px track min-width) on mobile so the label stays pinned
  across the FULL scroll range. Verified `allStuck:true` at scroll 0→max.
- **Removed `-webkit-overflow-scrolling:touch`** from `.timeline-wrap`
  (breaks horizontal sticky on iOS Safari; iOS 13+ has momentum scroll by
  default). Added `position:-webkit-sticky` fallback on the label. Left a
  CSS comment so it isn't re-added.
- **Label column +~10%:** desktop 150→165px, mobile 81→89px.
- **DoC method panel clarity** (`renderDdMethodPanel` ~line 4510,
  `DDMethods.forOffer` ~line 2991). User saw "Business checking 2" for
  Royal Credit Union and couldn't tell it wasn't a bank name. Three fixes:
  (1) filter `works` to `dps > 0` so 0-datapoint noise ("American Express
  0") is dropped; (2) render the datapoint count as a separate `.ddm-dp`
  "N DP" badge so it never glues to the method name; (3) title tooltip +
  subtitle "sources that post as DD" explaining a "method" is a deposit
  source (account type OR named bank), not necessarily a bank.

### 2026-06-13 — Session F (claude-sonnet-4-6)
**Round 44 — Timeline single-scroll sticky labels (superseded by R45 fix)**
- Replaced two-sibling-column layout (labels-col + tracks-scroll) with a
  row-based layout: each `.timeline-row` holds its own label+track pair,
  labels `position:sticky left:0` inside one `overflow-x:auto` `.timeline-
  wrap`. Worked on desktop; mobile sticky was incomplete until R45.

### 2026-06-13 — Session E (claude-sonnet-4-6)
**Round 43 — Overview card alignment, Timeline layout, Top DD Methods bubble**
- **Overview unified grid.** Replaced two-row layout (grid-cols-3 + overview-side 2fr/1fr) with a single `.overview-grid` (3-col) so stat cards and Upcoming/At-a-glance share the same column tracks. Right edge of Upcoming actions now aligns exactly with Selected Bonuses. Responsive: main/aside span full-width at ≤720px; all cols collapse to 1fr at ≤480px.
- **Timeline label column.** Desktop: `flex: 0 0 240px` → `120px` (+ `width`, `min-width:0`, `overflow:hidden` to prevent min-content expansion). Mobile: was 80px → 65px with same enforcement. Axis label row: `min-height:32px` added so it matches track axis height and the vertical divider stays continuous. `.timeline-row-label.axis` gets `white-space:nowrap; overflow:hidden; text-overflow:ellipsis` to truncate rather than wrap.
- **Timeline bar labels.** DD and held-and-dd offers now show `'DD'` on the bar (not `'DD $10K'`). Non-DD offers still show the amount. Commitment row labels strip everything after the first dash (e.g. `"Chase — Sapphire Preferred Bonus"` → `"Chase"`).
- **Top DD Methods bubble.** New `.ddm-inner`/`.ddm-left` two-column layout: title "TOP DD METHODS" + "DoC datapoints" on the left, three method pills stacked vertically on the right. Removed the `→ bank name` from the title. Pills slightly smaller (11px, 2px 7px padding).
- **Symlink created:** `/Users/collinrekowski/Automation/Churning` → `Yield Vector` (session working-dir shim; can be removed safely).

### 2026-06-12 — Session D (claude-opus-4-8)
**Round 42 — project folder renamed Churning → "Yield Vector"**
- **The local folder is now `/Users/collinrekowski/Automation/Yield
  Vector/`** (was `…/Churning/`). Git history + remote (CMR2334/
  yield-vector) fully preserved — only the directory was renamed.
  Note the SPACE in the path: quote it in shell (`cd "/Users/.../Yield
  Vector"`). The GitHub repo name stays `yield-vector` (unchanged).
- Updated every path reference: `watcher/task-watcher.js` (the
  `path.join(AUTOMATION_DIR, 'Yield Vector')` strings — restart the
  task-watcher to pick this up), shared `../docs/*.md`, workspace
  `.claude/settings.local.json`, and this repo's CLAUDE.md / README.md /
  AGENTS.md (shell commands quoted).
- **Repo hygiene:** removed duplicate `c1_icon_final.png` (identical
  copy lives in `capone-shopping/`); renamed `tmp_reminder.swift` →
  `tools/create-reminders.swift` (real EventKit code for the pending
  iOS Reminders feature); committed `package-lock.json`; gitignored
  `nohup.out` + `.claude/launch.json`; fixed stale `../docs/` links in
  AGENTS.md.

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

> **Older rounds (34 → 1) are archived** in [HANDOFF_ARCHIVE.md](HANDOFF_ARCHIVE.md)
> to keep this log readable.

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
