---
run: 2026-07-13-capital-event-picker-chart-bonusmet
task: "On the settings page under add capital event: I want the click box calendar to not necessarily have the same colorization as the calendar pickers elsewhere that are displaying date optimization through the color schema, but I want the overall formatting to align, as that calendar pickers is the original styling, which is different. I also added some capital events which extneded the display time frame of the available capital today chart, which erroneously is displaying \"Dec Dec 11\" at the right end, some sort of visual bug. Also It looks like the default behavior is to have the bonus pay out when deposited funds are released. I'm not sure if that's currently alterable. I see under advanced fields the ability to define bonus posting window, but not sure what that drives, or how it would be interpreted when it's a window of time. Also with the newly added Brex offer logic handling it has the \"How is this bonus met?\" banner, and that appears to be static regardless of what the actual offer terms/conditions are, which is overly inflexible/not as dynamic as I want. I want the selection options to show what applies to that given offer and not additional clutter. Also the Brex offer is a new funds held, not a direct deposit. However, Even with new funds held as the selected offer type, it still shows direct deposit as the \"How is this bonus met?\" options, as I said."
status: in-progress
created: 2026-07-13T04:00:00-05:00
config_snapshot: { planner: fable, executor: opus, worker: sonnet, codex: { planner: review-before-approval, executor: review-after, worker: review-after } }
plan_approved: true
current_step: 2
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
- RE-SEQUENCE (2026-07-14): owner reported the fixes still invisible (nothing
  had shipped — push was gated behind Steps 2–4). Cut an INTERIM RELEASE
  v2026.07.14a (commit 8cdc26e, pushed): step 1 + the pre-existing fixes +
  Codex read-only diff-review findings (both fixed pre-release: (H)
  doc-import-templates.js either/or apply ordering vs the dynamic section; (M)
  invalid recurrence end date silently saving as repeat-forever —
  events-actions-data.js saveEventFromForm validation). Version bump + grep
  gates executed inline by the planner (mechanical, owner waiting; recorded
  as protocol exception). Step 3's full rendered-DOM behavioral pass is STILL
  OWED and now covers this release's changes together with Step 2's. Codex
  workspace-write unusable (2 hangs) — Codex READ-ONLY only until resolved.

## Steps
### 1. Clarify the "Bonus posting window" advanced field-hint  [tier: worker] [codex: review-after] [status: done] [executed-by: tier-worker (sonnet) after 2 codex stalls]
Note: first dispatch (`codex exec --sandbox workspace-write`) HUNG ~40 min with
zero output/CPU — likely an unanswerable interactive approval in a background
run. Killed; CLI smoke-test passed; `--full-auto` retry ALSO hung overnight.
RUNG DROP: fell back to Claude tier-worker (sonnet) per ladder. Codex
workspace-write is unusable in this environment for now — keep Codex to
READ-ONLY calls (those work) and execute via Claude workers.
Outcome: DONE (2026-07-14). Worker found the field already HAD a thin hint
(spec premise wrong) and enriched it IN PLACE rather than adding a duplicate —
correct call under the each-fact-once rule. Constants were already exported
from offer-model.js; only modals-forms.js changed (import extended + hint).
Hint verified against bonusWindowAnchor/expectedBonusWindow/safeToCloseDate
before wording. node --check clean.
Files: js/modals-forms.js
Decisions: enrichment-in-place over duplicate hint; no offer-model.js edit needed.
Open issues: none.
Commit: 8cdc26e (folded into the interim release commit)
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

### 2. Requirements-derived qualification paths (phases A+B merged)  [tier: executor] [codex: review-after] [status: done] [dispatched: 2026-07-14]
FIX-UP (same tier, commit 68a0160): all four findings fixed, 'all' byte-identical
restored. H1: pathState hasHeldLump = literal `offerType !== 'direct-deposit'`
(HELD_LUMP_TYPES stays only for family DETECTION). H2: deposit-deadline
constraint + horizon push + schedule derived.depositDeadline + hero marker all
gated on holdActive, reusing existing ps/psO (zero added hot-path pathState
calls; marker condition = ddActive for direct-deposit else holdActive,
held-and-dd exclusion preserved). M1: bonusWindowAnchor skips
non-requirementActive rows. M2: allRequirementsDone false while needsPath.
+4 pins (H2 → optimizer harness incl. hold-path control; H1/M1/M2 →
feasibility harness). Battery: optimizer 85/85, feasibility 21/21, parser
20/20, fidelity 67/67, dd-matrix + p2b PASS, beam 2071ms < 2200ms. Open: the
H2 chart-marker suppression needs a rendered-DOM assertion — owed to Step 3.
Files (+fix-up): js/offer-model.js, js/optimizer-engine.js,
js/render-main-views.js, js/projection-optimizer.js, design addendum updated.
Outcome: DONE. pathState() derives path availability from requirement rows via
the family map, returns holdActive + families; 'hold' plannedPath choosable
only for new-funds-held; held-and-dd hold unconditional; every hold/DD
consumer gated (debit-path Brex ties up ZERO capital; hold path models the
block). node --check clean; FULL battery green: optimizer 83/83, feasibility
18/18 (incl. new Brex hold-vs-spend pin), fidelity/parser/dd-matrix/p2b pass;
'all' logic byte-identical; chooser/back-compat/derive-unfiltering checked at
logic level.
Files: docs/assessments/2026-07-13-requirements-driven-paths.md (new),
js/offer-model.js, js/requirements-templates.js, js/projection-optimizer.js,
js/optimizer-engine.js, js/reminders.js, js/render-main-views.js,
js/modals-forms.js
Decisions: (a) family detection = requirement rows PLUS legacy-field fallbacks
(pins/imports seed offers before syncRequirementsWithLegacy materializes
rows); (b) holdActive under 'all' includes legacy offerType 'other' (= "not
direct-deposit" in practice, keeps raw stored 'other' held-lump modeling
byte-identical); (c) deriveRequirementsFromLegacy no longer path-filters rows
— filtering moved to consumers via new requirementActive() (keeps 'all'
byte-identical, family detection sees all paths); (d) families returned EMPTY
on the 'all' hot path + requirementActive short-circuits on ps.logic — eager
family scanning regressed the pinned 2200ms beam budget; documented in the
addendum.
Open issues: (i) Step 3 rendered-DOM pass still owed; (ii) DoC importer
(doc-import-templates.js) still writes only 'dd'/'debit' plannedPath — a
hold-or-spend import can't offer 'hold' (→ NEW STEP 2d); (iii)
annualizedReturn now null for a debit-path new-funds-held (intentional;
eyeball the card render in Step 3).
Commit: 87ff38c (local, no push, no version bump)
POST-REVIEW (codex read-only, adversarial): 2 HIGH + 2 MEDIUM — fix-up
delegated to same tier before step closes:
- H1 offer-model.js:55/138 — HELD_LUMP_TYPES allow-list gives holdActive:false
  under 'all' for MISSING/unknown offerType; before, every non-direct-deposit
  offer (incl. undefined type — the legacy/seed case reminders.js:91-95
  explicitly guards) took the held branch. Fix: 'all' holdActive must be
  literally offerType !== 'direct-deposit'.
- H2 optimizer-engine.js:573 (+652/713, render-main-views.js:2074) —
  validateOfferQualification + horizon/schedule/chart still enforce the
  deposit deadline when the hold path is DORMANT (debit-path Brex excluded by
  'deposit-deadline' though no funding is required). Gate on holdActive.
- M1 offer-model.js:530 — bonusWindowAnchor missing the requirementActive()
  sweep: a completed DORMANT row can anchor the expected-bonus window /
  safe-to-close months late.
- M2 offer-model.js:499 — allRequirementsDone can return true for 'any' +
  plannedPath null when only neutral rows are done → wrongly suggests/marks
  met-waiting despite needsPath. Must be false while needsPath.
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

### 2b. Remove "low cash" as an optimizer survival axis (owner-directed 2026-07-14)  [tier: executor] [codex: review-after] [status: done]
Outcome: DONE — lowCash dropped from altWeaklyDominates /
altStrictlyBetterSomewhere / altEdgeVsHeadline / formatAltEdge label;
altMetricLowCash deleted (zero remaining refs); buffer hard gate + card
info metric + ALT_LOW_CASH_NOISE dedup (reviewed: dedup, not survival)
untouched. 3 existing pins re-isolated via APY trade-offs; +1 pin: cushion-only
plan dominated, APY trade-off survives. optimizer 86/86, feasibility 21/21,
beam 2087ms < 2200ms, node --check clean.
Files: js/optimizer-engine.js, js/render-main-views.js
Decisions: clean removal over dormant fields; fattest-cushion v_1550 fixture
now correctly hidden.
Open issues: rendered-DOM confirmation (1-offer cushion plan gone) → Step 3.
Commit: 68e14d4 (local, no push)
POST-REVIEW (codex read-only): CLEAN — no findings. Confirmed: no surviving
altMetricLowCash/lowCashDelta consumers (only the undefined-assertion pin);
formatAltEdge consumes the new shape; tie/dedup semantics preserved (pin at
~2492); card metric reads capitalCurveSummary.lowestAvailable safely.
Verified independently: pins 86/86 + node --check.
Intent: Owner: alternatives list showed a 1-offer plan vs the 6-offer best-total
plan; he trusts the buffer hard gate and okayed removing low cash ("If you have
reason to think it's important, keep it, but otherwise I'm okay removing it and
trusting it won't go below my already-present cash buffer"). Planner call:
remove low cash from the Pareto SURVIVAL axes + edge annotations; KEEP it as an
informational metric on cards; buffer stays the hard feasibility gate.
Concretely in js/optimizer-engine.js: drop the lowCash term from
altWeaklyDominates + altStrictlyBetterSomewhere; drop lowCashDelta from
altEdgeVsHeadline gains (and the '+$X low cash' rendering path in
render-main-views.js formatAltEdge); leave altMetricLowCash + the card's
low-cash display line + capitalCurveSummary untouched; ALT_LOW_CASH_NOISE
dedup usage: review — dedup (treating near-identical plans as one) may keep
using it. Update every pin that asserts lowCash-driven survival/edges (e.g.
the edgeVsHeadline lowCashDelta pin ~line 2506); batteries must be green with
the NEW semantics, and the change must be pin-covered (a cushion-only plan is
now dominated/hidden). MUST run AFTER step 2 (same file). Commit locally (NO
push).
Expected files: js/optimizer-engine.js, js/render-main-views.js, pin harness files
Outcome:
Files:
Decisions:
Open issues:
Commit:

### 2c. Timeline bar minimum width to fit bar text (owner-directed 2026-07-14)  [tier: worker] [codex: review-after] [status: done]
Outcome: DONE — bars with on-bar text (currency / "DD") get content-driven
`min-width: max-content` via new `.tl-bar.has-label` CSS rule, class applied
by renderTimeline under the SAME w>1% gate that decides the text renders.
Start edge (left%) untouched; only the right edge grows, only when the label
would clip. Textless slivers keep the 28px floor; normal bars byte-identical.
Confirmed: abs-positioned bars don't feed .timeline-row's max-content intrinsic
sizing (out-of-flow excluded) → no runaway row growth; overrun absorbed by
.timeline-wrap's existing overflow-x:auto → no new mobile page overflow.
node --check clean.
Files: js/render-main-views.js, index.html
Decisions: max-content over fixed px (labels vary "DD"→"$1.2M"); .has-label
gate avoids shrinking empty slivers to ~15px.
Open issues: NO rendered/visual check possible (no browser tooling in env) —
pixel fit + 380px no-overflow owed to Step 3 explicitly.
Commit: e6db6d3 (local, no push)
POST-REVIEW (codex read-only): CLEAN — spec-verified min-width>width
resolution with border-box (label can't still clip), no sticky-label/hit-target
regression (bars carry no data-action), has-label condition exactly matches
text render (single barText var), no theme/locked-value violations.
Intent: Owner: "Can the Plan > Timeline bars have a minimum width/size to at
least accommodate the text input values without cutting off? doesn't have to
be much larger than current, just enough to fit." In renderTimeline
(js/render-main-views.js) + its CSS in index.html: bars are %-positioned by
date range; short commitments render too narrow for their text (the $ amount /
label rendered on the bar) and clip. Give bars a MINIMUM rendered width just
big enough for their text (e.g. min-width driven by content with the start
edge anchored; slight visual overrun of the true end date on tiny bars is
acceptable per the ask — do NOT enlarge normal bars). Respect owner density
rules (nothing loud); mobile must not gain horizontal overflow. MUST run
AFTER step 2 (same file). Commit locally (NO push).
Expected files: js/render-main-views.js, index.html (CSS)
Outcome:
Files:
Decisions:
Open issues:
Commit:

### 2d. DoC importer: support the 'hold' path in either/or imports  [tier: worker] [codex: review-after] [status: done]
Intent: Step 2 open issue (ii): generalize the importer's requirementLogic
apply so a hold-or-spend import (Brex) surfaces the 'hold' path.
Outcome: DONE — and found the gap ran deeper: doc-parser's docDetectEitherOr
could only detect DD-vs-spend (bridge required literal "direct deposit"), so
hold-or-spend prose never emitted requirementLogic:'any' at all. Added a
conservative parallel hold-term bridge (hold new funds / maintain balance;
same connective/qualification/fee-waiver guards, gold-silent). Importer:
force-DD decision factored into exported pure helper
_docEitherOrForceDdFamily(curOfferType, ddParsed) — flips a held offer to
DD-family ONLY when a DD requirement was actually parsed (signal =
ddRequired presence; no new parser field); hold-vs-spend stays
new-funds-held → chooser presents Hold funds vs Card spend. Dynamic-section
ordering + never-auto-pick preserved. Static DOC_FIELD_MAP copy for the row
updated ("DD or card spend" → "multiple paths"). Verified: node --check both
files; parser pins 22/22 (+2: hold-vs-spend positive + conjunctive control);
fidelity 67/67; p2b + dd-matrix PASS; gold corpus clean; 6-case pure-helper
exercise passed.
Files: js/doc-import-templates.js, js/doc-parser.js
Decisions: reuse ddRequired as the DD-vs-hold signal (minimal); parser
extension justified because the importer fix was inert without detection;
pins co-located in testDocParserRegressions per convention.
Open issues: DOM-level chooser render after a real import → Step 3; hold-term
bridge regex not yet checked against a real Brex DoC post (no fixture exists)
— spot-check when one is added to the corpus.
Commit: 5139981 (local, no push)
POST-REVIEW (codex read-only): 1 HIGH + 1 LOW/MED — fix-up delegated:
- H doc-parser.js:1309 — the hold bridge's fee-waiver guard is WHOLE-POST
  scoped: a post with any ordinary "Monthly fees/waived" text (≈ every real
  DoC post) suppresses legit hold-vs-spend detection (Codex verified
  empirically; the new positive pin misses it because its fixture omits fee
  rows). Fix: scope rejection to the matched snippet/sentence; +2 pins (legit
  hold-vs-spend WITH a separate monthly-fee row passes; fee-waiver hold/spend
  stays absent).
- L/M doc-import-templates.js:209 — ddParsed reads the RAW parse
  (fields.ddRequired.value), not the user's CHECKED preview rows: unchecking
  the DD row but keeping requirementLogic checked still forces #ot-dd. Fix:
  derive from the checked/effective row set.
Codex confirmed: apply ordering correct; no stale force-DD pin.
FIX-UP (commit 0447522): H1 — fee-waiver guard scoped to the matched
disjunction's own sentence/line (same boundary convention as the R70 window);
DD + hold bridges share the guard code path so both scoped identically —
gold corpus + regression output BYTE-IDENTICAL pre/post (satisfies the
DD-side condition), +2 pins → 24/24; fidelity/dd-matrix/p2b green. M1 —
ddParsed now derived from the CHECKED ddRequired preview row AND its parsed
value (4 DOM states verified via scratch jsdom). NOTE for owner: the worker
found a PRE-EXISTING unrelated stash@{0} in this repo ("WIP on main: 014274e",
content re an OAuth token refresh for a different repo, capone-shopping) —
briefly popped by a malformed stash command, fully reverted (HANDOFF.md
restored to HEAD byte-exact, stash entry left in place); owner may want to
inspect/drop it deliberately.

### 3. Behaviorally verify all working-tree changes, fix findings, commit  [tier: executor] [codex: review-after] [status: done — NO DEFECTS]
Outcome: REAL rendered-DOM E2E (Playwright 1.58 + Chromium, seeded fresh local
origin — owner data untouched): 63/63 assertions across all six groups, zero
console errors, zero horizontal overflow (desktop + 380px). Battery green:
optimizer 86/86 (beam 2059ms), feasibility 21/21, parser 24/24, fidelity
67/67, dd-matrix + p2b PASS; node --check all modules + sw.js. Highlights:
debit-path Brex = zero capital (hero + timeline agree), hold-path models the
block; "Dec Dec 11" gone at a Nov-DST-crossing horizon; neutral picker clean;
invalid recurrence end rejected; hold-or-spend import (with fee row) detects,
stays held, chooser = Hold funds/Card spend, nothing auto-picked; DD-unchecked
paste doesn't force DD; no cushion-only alternative, low-cash info metric
kept; "$1.2M" bar grows 28→50px unclipped, start anchored.
Files: none (no fixes needed; drivers in session scratchpad only).
Decisions: three initial driver assertions corrected (not app bugs): canonical
debit-before-hold label order; preserve-choice applies only while chooser stays
visible; DoC fixture needed a parseable min-deposit line.
Open issues → OWNER DEVICE-CHECK LIST (after release): (a) neutral picker
formatting alignment eye-call; (b) hero right-end reads clean at a Dec-11
horizon; (c) chooser copy is "Card spend or Hold funds" order — one-line
cosmetic flip if owner prefers hold-first; (e) tiny-bar right-edge overrun
acceptable + $-label fit at phone width; (f) NOTE: DoC import lives in
collapsed Advanced fields (pre-existing placement) — surface if owner wants it
more prominent.
Commit: none needed
Intent: Verify the three inline fixes + Step 1's hint (shipped v2026.07.14a) +
Step 2's requirements-derived paths + Step 2b's low-cash-axis removal in one
pass.
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

### 4. Release: version bump + CHANGELOG + HANDOFF + push  [tier: worker] [codex: off] [status: in-progress] [dispatched 2026-07-14]
Intent: Bump APP_VERSION to the next v2026.07.13 letter (c, or next free) in
BOTH js/runtime-status.js and sw.js, and update ALL 21 index.html import-map
`?v=` entries; then `grep -rn "2026\.07\.13b" index.html js/ sw.js` must return
zero strays. `node --check` all js/*.js + sw.js. Add a CHANGELOG entry covering the
items in THIS release (requirements-derived paths incl. Brex hold-vs-spend +
low-cash survival-axis removal; the earlier items shipped in v2026.07.14a),
prepend a HANDOFF.md round entry reflecting the final committed state, commit,
push to main. Codex off but the grep/check gates above are mandatory. NOTE:
version base is now 2026.07.14a — bump to the next free letter and grep for
strays of 14a.
Expected files: js/runtime-status.js, sw.js, index.html, CHANGELOG.md, HANDOFF.md
Outcome:
Files:
Decisions:
Open issues:
Commit:
