---
run: 2026-07-13-capital-event-picker-chart-bonusmet
task: "On the settings page under add capital event: I want the click box calendar to not necessarily have the same colorization as the calendar pickers elsewhere that are displaying date optimization through the color schema, but I want the overall formatting to align, as that calendar pickers is the original styling, which is different. I also added some capital events which extneded the display time frame of the available capital today chart, which erroneously is displaying \"Dec Dec 11\" at the right end, some sort of visual bug. Also It looks like the default behavior is to have the bonus pay out when deposited funds are released. I'm not sure if that's currently alterable. I see under advanced fields the ability to define bonus posting window, but not sure what that drives, or how it would be interpreted when it's a window of time. Also with the newly added Brex offer logic handling it has the \"How is this bonus met?\" banner, and that appears to be static regardless of what the actual offer terms/conditions are, which is overly inflexible/not as dynamic as I want. I want the selection options to show what applies to that given offer and not additional clutter. Also the Brex offer is a new funds held, not a direct deposit. However, Even with new funds held as the selected offer type, it still shows direct deposit as the \"How is this bonus met?\" options, as I said."
status: in-progress
created: 2026-07-13T04:00:00-05:00
config_snapshot: { planner: fable, executor: opus, worker: sonnet, codex: { planner: review-before-approval, executor: review-after, worker: review-after } }
plan_approved: true
current_step: 1
---
## Context
Yield Vector (vanilla-JS PWA, `index.html` + `js/*` modules, no build step) at
`/Users/collinrekowski/Automation/Yield Vector`, deployed via GitHub Pages from
`main`. UNUSUAL STARTING STATE: fixes for issues #1/#2/#4 were ALREADY
implemented inline earlier this session and sit UNCOMMITTED in the working tree
(`js/dd-widgets.js`, `js/modals-forms.js`, `js/render-main-views.js`); issue #3
was answered as a question. This run verifies/reviews/lands that work and adds
the one net-new piece #3 exposed (the bonus-posting-window field is not
self-explanatory). Commit protocol + locked design values: AGENTS.md.
RELEASE-CRITICAL: version stamp lives in js/runtime-status.js (APP_VERSION),
sw.js (APP_VERSION), and index.html import map (21 `?v=` entries) — all must
bump together or phones stay on cached modules. Current: 2026.07.13b.
NO PUSH until the version-bump step.

Pre-existing working-tree changes (from the inline session):
- #1 Capital-event date fields: switched from native `<input type="date">` to the
  custom yv-dp picker with a NEW `neutral` mode (same formatting, no
  optimization colorization, no legend); save path parses M-D-YYYY back to ISO
  via `parseDateInput` (event `date` + recurrence `endDate`).
- #2 "Dec Dec 11" hero-chart bug: DST millisecond-arithmetic drift in the
  horizon-end label suppression; x-ticks now carry their true first-of-month
  `Date`, horizon date read from the last projection day.
- #4 "How is this bonus met?" section made dynamic: renders ONLY when the offer
  has BOTH a DD path (DD-family offerType) and a card-spend path (debit
  required); rebuilds live on offerType/debitRequired changes
  (`reqMetPaths`/`reqMetSectionField`/`syncReqMetSection`). New-funds-held
  offers (Brex) no longer see the inapplicable Direct-deposit chooser.
- `node --check` passes on all three files. NOT behaviorally verified, NOT
  committed.

## Key decisions
- Do not re-implement: the run's job is verify → review → land the existing
  working-tree fixes, plus one small net-new worker step for #3 discoverability.
- #3 is a semantics question, not a bug: bonus posting is modeled as
  [anchor+min, anchor+max] days after the LAST requirement done_date
  (fallback today, flagged estimated; defaults DEFAULT_BONUS_POST_MIN/MAX_DAYS
  = 90/105), driving the expected-bonus window + safe-to-close date
  (`expectedBonusWindow`, `bonusWindowAnchor` in offer-model.js);
  bonus_received_date overrides the expected window. The gap is the field-hint
  not explaining this — hence Step 1.
- Codex plan critique (2026-07-13, gpt-5.5) accepted findings: (a) no push
  before the version bump — per-step commits stay local, push only in Step 3
  after bumping runtime-status.js + sw.js + all 21 import-map `?v=` entries and
  grepping for strays; (b) the chooser hint's "e.g. Brex" example is now wrong
  (Brex is not DD-or-card-spend per owner) — rewrite in Step 2; (c) Step 1's
  hint must interpolate DEFAULT_BONUS_POST_MIN/MAX_DAYS, not hardcode 90–105,
  and scope its claim to the met-waiting/earned lifecycle stages with
  bonus_received_date override; (d) hint lands BEFORE the behavioral
  verification pass so one pass covers everything; (e) verification must
  include a rendered-DOM/browser-level check, not just node harnesses;
  (f) Step 1 fix scope may touch beyond the three changed files if verification
  finds real defects.
- Plan gate 2026-07-13: owner APPROVED the plan and answered the Brex-terms
  question: Brex is HOLD OR CARD SPEND. So the either/or engine must gain a
  held-vs-spend path (new Step 2, executor). Design decisions pinned by the
  planner so a wrong local choice can't propagate:
  (1) plannedPath gains value 'hold', valid ONLY for offerType 'new-funds-held'
      under requirementLogic 'any'; DD-family offers keep 'dd'|'debit'.
  (2) pathState() gains `holdActive`. logic 'all': holdActive = offerType is
      held-family ('new-funds-held' | 'held-and-dd') — mirrors today's
      unconditional hold, zero behavior change. logic 'any' + new-funds-held:
      paths are 'hold'|'debit'; holdActive = path==='hold'; debitActive =
      path==='debit'; needsPath when null. held-and-dd keeps EXACTLY today's
      'any' semantics (dd/debit qualifying-transaction choice) with holdActive
      ALWAYS true — its hold is not part of the either/or.
  (3) Every consumer that models the held lump (withdrawal/initiate/release
      dates, projection "new funds held" block, optimizer capital math,
      reminders, safe-to-close) must skip the hold when holdActive is false —
      a debit-path Brex ties up no capital.
  (4) Chooser UI shows when (hasDd && hasDebit) || (offerType==='new-funds-held'
      && hasDebit); held variant copy: "Either way (hold funds or card spend)",
      path labels "Hold funds"/"Card spend". Fix the now-wrong "e.g. Brex"
      example with truthful per-variant copy (Brex belongs to the held variant).
  (5) readOfferForm validation accepts 'hold' only for new-funds-held + 'any';
      no schema/migration bump (loose fields, 'all' default keeps existing
      offers byte-identical).
  Executor must read docs/assessments/2026-07-11-either-or-requirements.md
  before changing pathState.
- SCOPE EXPANSION (owner choice 2026-07-13, mid-run): fold phase B —
  requirements-DERIVED chooser + generalized any/all — into this run (owner
  picked "Expand this run" over narrow-now/pause). Phase A+B merge into ONE
  executor step because the data model is shared. Additional pinned design:
  (6) Path FAMILIES map requirement-row types → path keys:
      'dd'    = {direct_deposit_amt, direct_deposit_count}
      'debit' = {spend, debit_txns, transactions}   (stored key stays 'debit'
                 for back-compat with saved plannedPath values; DISPLAY label
                 is "Card spend")
      'hold'  = {deposit, maintain_balance}
      path-NEUTRAL (always active regardless of chosen path) =
      {activate_debit, estatements, online_banking, promo_code, custom}.
  (7) Chooser availability derives from the LIVE requirement rows (derived +
      user rows): show when ≥2 distinct path families are present. offerType
      no longer gates the chooser directly — but held-and-dd keeps its hold
      UNCONDITIONAL (footprint assertion, not qualification; its chooser is
      dd-vs-debit only). Only new-funds-held can put 'hold' in the either/or.
  (8) Under logic 'any' with a chosen path: rows of NON-chosen path families
      are excluded from checklist counts, requirement deadlines, reminders,
      and allRequirementsDone; neutral rows always count. Under 'all' (default)
      everything counts — byte-identical to today.
  (9) plannedPath stays type-keyed ('dd'|'debit'|'hold'), NOT row-id-keyed —
      a path = every row in that family. N-of-M logic explicitly OUT of scope
      (phase C+, backlogged).
  (10) Step 2 writes a design addendum
      docs/assessments/2026-07-13-requirements-driven-paths.md BEFORE coding
      (repo convention), covering 6–9 + consumer inventory.
  Phase C (capital-footprint auto-suggest + 'none' footprint) stays parked in
  docs/BACKLOG.md.

## Steps
### 1. Clarify the "Bonus posting window" advanced field-hint  [tier: worker] [codex: review-after] [status: in-progress] [executed-by: codex]
Note: first dispatch (`codex exec --sandbox workspace-write`) HUNG ~40 min with
zero output/CPU — likely an unanswerable interactive approval in a background
run. Killed; CLI smoke-test passed (default profile healthy, no usage-limit);
retried with `codex exec --full-auto` (non-interactive workspace-write). Use
--full-auto for all future background workspace-write dispatches.
Intent: Owner couldn't tell what the field drives. Add/extend a field-hint under
the min/max inputs in modals-forms.js (near `f-bonus-post-min/max`, ~line 495
post-edit) explaining: window = min–max days after your LAST completed
requirement (its done_date; estimated from today until one is recorded);
defaults interpolated from DEFAULT_BONUS_POST_MIN_DAYS/DEFAULT_BONUS_POST_MAX_DAYS
(import from offer-model.js — export them if not already exported) when blank;
once requirements are met (met-waiting/earned stages) it drives the card's
expected-bonus window, reminders, and the safe-to-close date (account isn't
called safe to close until the window END passes; an actual
bonus_received_date overrides the estimate). Match surrounding field-hint
tone/markup; ONE concise hint, no redundant restating elsewhere (owner's
each-fact-once rule). Commit locally (NO push).
Expected files: js/modals-forms.js (possibly js/offer-model.js export line)
Outcome:
Files:
Decisions:
Open issues:
Commit:

### 2. Requirements-derived qualification paths (phases A+B merged)  [tier: executor] [codex: review-after] [status: pending]
Intent: Implement Key-decisions items (1)–(10) as ONE coherent change. First
read docs/assessments/2026-07-11-either-or-requirements.md and write the design
addendum docs/assessments/2026-07-13-requirements-driven-paths.md (decisions
6–9 + a consumer inventory of everything reading pathState/requirementLogic/
plannedPath/offerType-for-capital). Then:
(a) MODEL: pathState() derives available paths from the offer's requirement
    rows via the family map (decision 6), returns
    {logic, path, ddActive, debitActive, holdActive, needsPath, families};
    'all' logic reduces byte-identically to today's semantics; held-and-dd
    hold stays unconditional (decision 7).
(b) CAPITAL: gate every hold-modeling consumer on holdActive and DD modeling
    on ddActive (offer-model dates/_heldReleaseDate path, projection-optimizer
    held block, optimizer-engine capital math, safe-to-close); a debit-path
    offer ties up no capital.
(c) LIFECYCLE: path-aware filtering per decision 8 (checklist counts,
    requirement deadlines, reminders, allRequirementsDone) — neutral rows
    always active.
(d) UI: reqMetPaths/reqMetSectionField/syncReqMetSection generate the chooser
    from the ≥2 present families (labels: Direct deposit / Card spend / Hold
    funds; truthful copy — fix the stale "e.g. Brex" DD example; Brex is the
    hold-or-spend case); rebuild live on requirement-row add/remove/type
    change AND legacy offerType/debitRequired toggles; readOfferForm accepts
    plannedPath only from currently-present families, else null.
Preserve 'all'-logic behavior EXACTLY. `node --check` every touched module.
Commit locally (NO push).
Expected files: docs/assessments/2026-07-13-requirements-driven-paths.md, js/offer-model.js, js/modals-forms.js, js/requirements-templates.js, js/projection-optimizer.js, js/optimizer-engine.js, js/reminders.js, js/render-main-views.js
Outcome:
Files:
Decisions:
Open issues:
Commit:

### 3. Behaviorally verify all working-tree changes, fix findings, commit  [tier: executor] [codex: review-after] [status: pending]
Intent: Verify the three inline fixes + Step 1's hint + Step 2's held-vs-spend
extension in one pass.
(a) Neutral picker — capital-event Date/Ends fields open the yv-dp popover with
NO good/amber/holiday classes and no optimality legend; selection highlight,
Today/Clear, blocked-day handling intact; event save round-trips M-D-YYYY
display → ISO storage (new event, edit event, recurrence end date; pre-existing
ISO-stored events render back correctly).
(b) DST label — exercise the horizon-label suppression across a Nov DST
boundary (projection ending Dec 11 with a Dec 1 tick → suppressed; horizon in a
month past the last tick → shown).
(c) Dynamic bonus-met section — new-funds-held: hidden; DD-family + debit
required: shown; live rebuild on offerType/debitRequired toggles preserving an
in-progress logic/path choice; saving with the section absent yields
requirementLogic 'all'/plannedPath null; an existing 'any' offer whose section
disappears saves cleanly.
(d) Requirements-derived paths (Step 2) — chooser appears iff ≥2 path families
among requirement rows; Brex case (new-funds-held + spend row): hold-vs-spend
chooser, plannedPath 'hold' models the hold block, 'debit' ties up NO capital
(projection + safe-to-close + reminders + checklist counts all agree); neutral
rows (estatements etc.) count under both paths; 'all'-logic offers
byte-identical before/after; saved plannedPath 'dd'/'debit' values still work.
Method: rendered-DOM verification, not just pure-logic checks — serve the repo
(e.g. `python3 -m http.server`) and drive it with whatever browser tooling is
available (check node_modules/tools first); if none, use jsdom-style or
temporary node harnesses for logic + targeted DOM assertions and FLAG the
visual-polish check for the owner explicitly in the Step Report. No new test
framework. Fix any real defects found (scope may extend beyond the three files
if a defect requires it — record why). `node --check` every touched module.
Commit locally (NO push).
Expected files: js/dd-widgets.js, js/modals-forms.js, js/render-main-views.js (+ others only if defects require)
Outcome:
Files:
Decisions:
Open issues:
Commit:

### 4. Release: version bump + CHANGELOG + HANDOFF + push  [tier: worker] [codex: off] [status: pending]
Intent: Bump APP_VERSION to the next v2026.07.13 letter (c, or next free) in
BOTH js/runtime-status.js and sw.js, and update ALL 21 index.html import-map
`?v=` entries; then `grep -rn "2026\.07\.13b" index.html js/ sw.js` must return
zero strays. `node --check` all js/*.js + sw.js. Add a CHANGELOG entry covering
all five items (neutral event picker, DST horizon-label fix, dynamic bonus-met
section, held-vs-spend either/or, posting-window hint), prepend a HANDOFF.md
round entry reflecting the final committed state, commit, push to main. Codex
off but the grep/check gates above are mandatory.
Expected files: js/runtime-status.js, sw.js, index.html, CHANGELOG.md, HANDOFF.md
Outcome:
Files:
Decisions:
Open issues:
Commit:
