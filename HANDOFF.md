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

## Current state (as of 2026-07-11, Round 86)

- **R86 (v2026.07.11a — owner-directed phone-review batch: sequence-card copy/identity/bonus + alternative edge annotations + verify-value fallback clarity + two color changes):**
  Six items from the owner's phone review. **ITEM 1 — sequence-card copy (`js/render-main-views.js` `renderOptSequenceRow`):**
  the proposed-plan offer rows read "Free <date>"; VERIFIED that `derived.withdrawalEligible` = `withdrawalEligibleDate(offer)`
  = for DD offers the LATEST round-trip return across ALL DDs, for held/other offers the hold release (bizDayISO(anchor +
  daysFundsMustRemain)) — i.e. the full capital release for THAT offer. Relabeled **"Free <date>" → "Capital back <date>"**
  to match the plan-level metric. **ITEM 2 — sequence-card identity (same fn; new PURE `optimizerOfferBankName`):** the rows
  now show ONLY the bank name (the op badge "New · churn"/"Reschedule" + dates carry the rest); the full "Bank · Offer name"
  stays in the modal + the "Not in this plan" review rows (`optimizerOfferName`/`optReviewName` untouched). **ITEM 3 —
  sequence-card bonus (`js/optimizer-engine.js` `scheduleForOffer` now emits per-offer `bonus = Math.round(signupBonusAmount)`
  — the MATERIALIZED candidate's value, so a churn re-run shows its synthesized bonus, not the stored source; renderer +
  new `.opt-seq-bonus` CSS):** the offer's bonus renders in the LOWER-RIGHT corner (absolute, full comma dollars, green;
  `.opt-seq-dates`/`.opt-seq-badges` reserve a 68px right-gutter so wrapped content never slides under it). **ITEM 4 —
  edge annotations on "Other feasible plans" (`js/optimizer-engine.js` new PURE `altEdgeVsHeadline` wired into
  `filterDominatedAlternatives`; renderer new `formatAltEdge` + `.opt-alt-edge` CSS):** every surviving non-champion card
  renders a one-line WHY — the axis(es) where it beats the headline (alts[0]/"best"), with deltas, e.g. "+$8,000 low cash
  vs best" / "+7.9% APY · capital back 318 days sooner vs best" / "+8.8% APY · +$20,000 low cash · capital back 367 days
  sooner vs best" (full comma dollars; card axis names — APY/low cash/gross/capital back; owner example order). DERIVED FROM
  THE SAME altMetric* comparison + APY epsilon the 10a Pareto filter uses (computed AFTER survival, vs alts[0]), so the
  label can NEVER disagree with the dominance that kept the card; the filter guarantees a displayed alt beats the headline
  on ≥1 axis so it's non-empty (empty only in the pathological invalid-headline case → no line). Champions keep their
  labels (edge suppressed when `isChampion`). Deterministic (integer/ISO metric diffs). **ITEM 5 — verify-value fallback
  clarity (`js/events-actions-data.js` `verifyChurnValue` + `recheckChurnCandidate`):** ROOT CAUSE (reproduced READ-ONLY on
  the preview origin's stale state): the genuine churnable US Bank source has NO stored docUrl AND no DoC Worker is
  configured on that origin → a "Verify value" tap fell back to the modal with a GENERIC "use Import from URL … then Save"
  bubble that never said why. **FIX (a):** a stored URL missing only its scheme is now normalized (https://) so one-tap
  verify works instead of wrongly falling back as "no URL" (the 5a bug — a scheme-less stored URL used to hit the modal).
  **FIX (b):** every fallback now states the SPECIFIC reason via `CHURN_RECHECK_REASON_COPY` (no-url / no-worker / tiered /
  structural-dd / structural-requirements), and when the reason is a missing URL the modal opens with the **DoC URL field
  (`#f-doc`) scrolled-to + flash-highlighted** (reuses the 10a `focusOfferField`/`yv-field-flash` idiom, auto-expands
  Advanced). **ITEM 6a — reason-text color (`index.html`):** the "Not in this plan" reason text is now a muted maroon via a
  new token **`--danger-deep: #8b3a46`** (deliberately NOT the vibrant `--danger #e87171` family; reads as "didn't make the
  cut", AA-legible on the light card). **ITEM 6b — offer palette reskin (`js/migrations-catalogs.js` OFFER_COLOR_PALETTE):**
  the owner wanted rid of "the pink" (VERIFIED = swatch labeled Pink = key `magenta` #ec4899) and the darker/right-most
  purple (VERIFIED against the rendered picker order = key `fuchsia` #c026d3, the right-most purple-family swatch before
  Pink). KEYS stay stable (stored values, back-compat) — only hex+label retuned so existing offers re-skin automatically:
  **`magenta` → #7b243c "Burgundy"** (deep wine) and **`fuchsia` → #14532d "Pine"** (dark forest) — two dark, well-separated
  jewel tones, distinct from each other, from the 14 other swatches, and from the deadline-red family so identity never
  reads as "danger" (comment block + labels updated). **Pins +3 → optimizer 61/61:** ITEM 4 — every survivor's edge axes
  EXACTLY equal its strict-beat axes vs the headline (never empty), deltas equal the exact metric differences, annotation
  deterministic across runs. **Full battery green:** node --check all 19 modules + inline entry + sw.js; **fidelity 67/67,
  parser 20/20, p2b PASS, dd-matrix ALL PASS, feasibility 5/5, optimizer 61/61 (~3.1s)**. **APP_VERSION → 2026.07.11a**
  (runtime-status.js + sw.js + 19 import-map `?v=`; sw precache derives `yv-precache-2026.07.11a`; **0 strays** of 10a).
  **Preview E2E** (port 8765, owner's real localStorage STRICTLY READ-ONLY — App.save NEVER called, stored bytes
  4967→4967 + backup 5301 identical; a transient in-memory `bonus_received_date` set on the US Bank offer to force a
  scheduled churn candidate was restored to null): drove the REAL render pipeline — sequence rows showed **bank-name only**,
  **"Capital back <date>"**, and the **bonus lower-right** ($2,500/$1,500/$1,000/$600/$400 + the churn candidate's $450);
  the "Other feasible plans" cards each rendered a green edge line matching the dominance math (headline low cash $22,000 vs
  a card's $30,000 → **"+$8,000 low cash vs best"**); tapping **Verify value** on the (no-URL) US Bank churn candidate
  toasted **"No source URL stored — paste the DoC link below, then Save to enable one-tap verify"**, auto-expanded Advanced,
  and scrolled-to + flash-highlighted the **DoC URL field** (`yv-field-flash` box-shadow ring confirmed); the review-row
  reason rendered **`rgb(139,58,70)` = #8b3a46**; the color picker showed **16 swatches** with `magenta`→#7b243c "Burgundy"
  + `fuchsia`→#14532d "Pine" and **zero** #ec4899/#c026d3; **380px zero horizontal overflow** (bonus never overlaps the
  wrapped dates; edge lines unclipped); **zero console errors**. **REVIEW-AFTER — Codex (RUNG 1, `codex-companion.mjs review --scope branch --base origin/main
  -m gpt-5.5`, ran clean):** inspected the full diff — edge-annotation math vs the dominance helpers, the churn-verify
  fallback branches + `focusOfferField`, `optimizerOfferBankName`/`sourceOfferId` resolution, `scheduleForOffer` bonus,
  `formatCurrency`, the palette + version bump — and reported **no actionable regressions** (SHIP). Zero CRITICAL/HIGH.
  Owner-owned
  dirty paths (`.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`, deleted `.codex/hooks.json`) untouched — explicit-path
  `git add` only. **Remaining (owner gate): device-check v2026.07.11a.** **Open:** the `no-worker` fallback can't be
  end-to-end exercised on this origin (no Worker configured) — the branch decision is unit-proven but the successful
  headless re-fetch of a scheme-normalized URL is only reachable once a Worker is set.

- **R85 (v2026.07.10a — owner-directed fix batch: PARETO-DOMINANCE alternatives filter + NEVER-RUN-PROSPECT churn fix + reason specificity + tap-through focus):**
  Two owner issues, both grounded in phone screenshots. **ISSUE 1 — dominated plans cluttered "Other feasible
  plans":** owner's real run showed 7 alternatives all with the same Oct 8 capital-back, four of them
  ($1,800/$1,750/$1,400/$1,350) STRICTLY DOMINATED by the $1,950 or $1,550 plan (worse-or-equal on gross, low cash,
  AND blended APY, same-or-later capital back). **FIX (`js/optimizer-engine.js`, new PURE `filterDominatedAlternatives`
  + axis helpers `altMetricGross/LowCash/Apy/Back`, `altWeaklyDominates`, `altStrictlyBetterSomewhere`):** wired into
  `optimizePlanner` AFTER champion extraction + the 09i same-set dedup. Hides any alternative a DISPLAYED plan
  beats-or-ties on ALL of (gross, low cash, blended APY) with a same-or-EARLIER capital-back date and strictly beats
  on ≥1; a cross-set EXACT tie on all four is a duplicate → later representative hidden (earlier kept). Champions +
  the headline (alts[0]) are EXEMPT from removal but still DOMINATE. Strict domination is transitive → tested against
  the full displayed pool = order-independent (yields the Pareto frontier); exact-tie pass keeps the earliest.
  Deterministic (byteCompare on the ISO capital-back axis; `-1e-9` APY FP tolerance). Exported for E2E. **ISSUE 2 —
  a never-run prospect demanded a close date + aimless reasons.** **(2a) churn candidacy (`js/offer-model.js` new PURE
  `hasGenuinePriorRun`, shared; `js/optimizer-engine.js` churn-synthesis guard):** ROOT CAUSE — a churnable offer at a
  PRE-ACCOUNT status (subStatus prospect/applied; accountStatus auto-set to 'closed' meaning "not opened yet", NOT a
  real closure) entered the churn-synthesis loop; with `churn_anchor='account_closed'` and no `closed_date`,
  `churnEligibleDate` returned null → a generic `missing-churn-anchor` needs-date row demanding a close date that can
  NEVER exist for a never-opened account. `hasGenuinePriorRun` (accountStatus 'open' → true; else non-pre-account &&
  non-denied subStatus; legacy funded/completed fallback) now GATES churn synthesis — a never-run prospect is skipped
  SILENTLY (it is already a NORMAL candidate). **(2b) reason specificity (`js/render-main-views.js` new
  `CHURN_ANCHOR_MISSING_COPY` + `optReviewReasonCopy`; engine tags the review row with `anchor`):** a genuine churn
  source still owing its anchor names the EXACT date — "Needs the prior run's close date (churn timing)" /
  "…sign-up date…" / "Needs the prior bonus-received date (churn timing)" per churn_anchor, not "Needs a date to
  re-run". **(2c) tap-through focus (`js/render-main-views.js` `optReviewFocusField`; `js/events-actions-data.js`
  `editOfferFromOptimize`+`focusOfferField`; `index.html` `.yv-field-flash`):** the needs-data review row carries a
  `data-focus` (f-closed/f-signup/f-bonus-received/dd-entries/f-funded); the tap-through expands the Advanced section
  if needed, scrolls to, and flashes an accent ring on the named field (transient, 1.8s, auto-clears; no programmatic
  focus so a yv-date picker never pops). The lifecycle CHURN row (`renderLifecycleInfo`) for a never-run offer now
  reads "applies after this offer completes" instead of "needs account closed date"; the Offers `needs-churn-date`
  chip is likewise gated to genuine sources. **RIDER (CSS regression the longer copy exposed):** the horizontal
  `.opt-review-row` squeezed a full-sentence reason + the offer name into 1-char columns at 380px → restacked to a
  vertical name-over-reason list (both `overflow-wrap:anywhere`), readable at any width. **Pins +7 → optimizer 57/57:**
  ISSUE 1 — owner-numbers fixture (four dominated hidden, three trade-offs survive), exact-tie duplicate hidden,
  headline exempt when dominated, determinism; ISSUE 2 — never-run prospect gets NO churn row + is scheduled as a
  normal candidate, genuine completed run still needs its anchor tagged with the anchor kind. All existing 50 stay
  green (the single-offer near-dup/determinism/earliest-representative alternatives pins unaffected — the filter only
  drops dominated same-outcome variants, headline always survives). **Full battery green:** node --check all 19
  modules + inline entry + sw.js; **fidelity 67/67, parser 20/20, p2b PASS, dd-matrix ALL PASS, feasibility 5/5,
  optimizer 58/58 (~3.7s)**. **APP_VERSION → 2026.07.10a** (runtime-status.js + sw.js + 19 import-map `?v=`; sw
  precache derives `yv-precache-2026.07.10a`; 0 strays of 09m; 2 remaining `09h` are historical comments).
  **Preview E2E** (port 8765, owner's real localStorage STRICTLY READ-ONLY — App.save() NEVER called, stored bytes
  10337→10337 identical, transient BofA injection reverted from an in-memory snapshot): dominance before/after on the
  owner's exact numbers via the real exported `filterDominatedAlternatives` — 7 plans → 3 (the four dominated hidden);
  a real optimizer run rendered **1 champion + 5 "Other feasible plans"** with **0 Pareto violations** among displayed
  alternatives; the owner's genuine churnable US Bank source (account open, no bonus_received_date) surfaced a tappable
  row reading **"Needs the prior bonus-received date (churn timing)"** with `data-focus="f-bonus-received"`; tapping it
  opened the modal ("Save & run" primary), **auto-expanded Advanced**, and the flash animation (`yv-field-flash`, 1.8s)
  validated; a transiently-injected BofA-class never-run prospect got **NO churn row, NO synthetic churn candidate,
  and was scheduled as a normal candidate**; `renderLifecycleInfo` returned "applies after this offer completes" for a
  never-run offer vs "needs account closed date" for a genuine one; **380px zero horizontal overflow**; zero console
  errors/warnings. **REVIEW-AFTER — Codex (credits RESET, ran clean; `--scope branch --base 9d53d28`):** ONE **P2**
  — the dominance dominator pool included INVALID (infeasible) alternatives, so an infeasible plan with superior
  metrics could hide a valid displayed trade-off (the renderer drops invalid plans, so it would vanish silently).
  **FIXED pre-final-push:** new `altIsDisplayable` (valid + ≥1 offer) gates BOTH the dominator pool and the
  duplicate-representative set; an invalid/0-offer alternative is passed through untouched (renderer filters it) and
  never dominates or dedups. Pin added (infeasible plan never hides a displayed feasible trade-off) → **optimizer
  58/58**; re-verified live. Zero CRITICAL/HIGH. Owner-owned dirty paths
  (`.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`, deleted `.codex/hooks.json`) untouched — explicit-path `git add`
  only. **Remaining (owner gate): device-check v2026.07.10a.** **Open:** `no-valid-date-window` review copy stays
  generic (not a single missing field); the Offers needs-info chip vs draft-banner co-occurrence dedupe still an owner
  call (carried from R84).

- **R84 (v2026.07.09m — owner-directed: CONSTRAINED CHAMPION CARDS + validator-excluded review rows + 2 riders):**
  Owner on seeing 09k live: *"I don't think I like the 3 scenario focus… I didn't create this tool to run an
  optimization pass to return a single offer that I entered/identified myself."* The unconstrained 09k axis
  champions degenerated to trivial single-offer answers. **ITEM 1 — constrained champions (`js/optimizer-engine.js`,
  `selectChampions` rewritten, PURE):** the headline "Best total return" plan is always the first champion (and
  the default plan, unchanged). A **secondary** champion (rate/fastest) now renders ONLY when it clears every gate:
  (a) **≥1 offer** — the 0-offer do-nothing plan is NEVER champion-eligible (also fixes the 09l NIT that a lone
  empty plan could surface as a champion); (b) **gross ≥ `CHAMPION_GROSS_THRESHOLD` (0.85) × best gross** — must
  compete near the top of total return; (c) **genuinely distinct** (post-09i `alternativeCollapses` + distinct
  canonicalVector); (d) **material axis margin** — rate: blended APY better by ≥ `CHAMPION_RATE_MATERIAL_PP`
  (0.02 = **2 percentage points**); fastest: final capital-release ≥ `CHAMPION_FASTEST_MATERIAL_DAYS` (**7 days**)
  earlier. No qualifying plan for an axis → **no card** (owner's no-filler rule). Merged behavior now applies to the
  SECONDARY axes only (total is always its own card): a single qualifying plan winning BOTH rate+fastest → one card,
  both labels. Each secondary carries a PURE `trade = { grossDelta, apyDeltaPp, daysSooner }` (new `championTrade`);
  render (`js/render-main-views.js`, new `formatChampionTrade`) shows it as an explicit trade line on the scenario
  card AND the proposal pane — e.g. **"+9.2% APY · capital back 159 days sooner · -$150 vs best"** (full comma
  dollars, owner rule; new `.opt-alt-trade` / `.opt-plan-trade` CSS in `index.html`). APY material gate carries a
  `-1e-9` FP tolerance so a delta landing exactly on 2pp isn't lost to IEEE-754 subtraction noise. **ITEM 2 —
  validator-excluded review rows (`js/optimizer-engine.js`, new PURE `captureValidatorExclusions` wired into
  `optimizePlanner`):** a candidate that clears BUILD (has a date grid) but the qualifier rejects at EVERY
  schedulable date — while a valid alternative outranks it — now gets a tappable "Not in this plan" row with the
  specific reason (dd-post-late / dd-window / deposit/debit/requirement-deadline / expiry; new copy in
  `OPT_REVIEW_REASON_COPY`, `js/render-main-views.js`). TRUTHFUL by construction: an offer IN the final plan gets no
  row; an offer that qualifies at ANY grid date (absent only for cash/ranking) gets no row — only genuine
  every-date validator drops surface. The existing 09j tap-through + "Save & run" flow works unchanged (rows carry
  a resolvable source offerId). `completeness`/`schedule-before-today` are excluded (drafts are surfaced by the
  Offers needs-info chip, not this timing review). **ITEM 3 — riders:** removed the unused
  `directDepositEffectiveDate` import in `js/reminders.js` (09l NIT); removed the unreachable legacy
  `case 'timeline'` route in `js/render-shell-overview.js` after re-verifying by grep (`App.view` defaults to
  `'overview'`, never hydrated from storage nor set to `'timeline'`; `goto-timeline` routes via
  `App.setView('planner')` + `_planSegment='timeline'`) — dropped the now-orphaned `renderTimeline` import from the
  shell (still used inside render-main-views.js). Both `docs/BACKLOG.md` entries moved to Recently-resolved.
  **Champion pins UPDATED (per-pin, sanctioned):** *distinct axis winners* — 09k used tiny-gross secondaries
  ($300/$500 vs $1000), exactly the degenerate case now rejected → lifted secondaries above the 85% floor with
  material APY/day margins (3 cards). *Merged card* — 09k merged total+rate on one plan; merge now applies to
  secondaries only → fixture is one plan winning rate+fastest → one merged card (two labels, one trade). *No
  feasible → no champions* KEPT + extended (lone 0-offer plan never a champion; 0-offer excluded alongside a real
  plan). *Engine-wires-winner-as-total* KEPT (single-offer run now yields exactly the headline card — secondaries
  that resolve to the headline are skipped, no label absorption). *Deterministic across runs* KEPT + a shuffle-
  invariance assert. **Pins ADDED:** gross-threshold boundary (≥85% qualifies / below excludes), rate
  material-margin boundary (+2pp / +1.5pp), fastest material-margin boundary (7d / 6d), trade-delta arithmetic
  (gross/apy/days), no-filler (degenerate tiny-gross plan → only headline), + 3 review-row pins (validator drop
  surfaces its reason; included offer gets no row; cash-dropped-but-qualifying offer gets no row). **Optimizer
  39 → 50** (all green; champion pins 5 → 11, +3 review). **Full battery green:** node --check all 19 modules +
  inline entry module + sw.js; **fidelity 67/67**, parser **20/20**, p2b PASS, dd-matrix ALL PASS, **feasibility
  5/5**, **optimizer 50/50** (~3.08s). **APP_VERSION → 2026.07.09m** (runtime-status.js + sw.js + 19 import-map
  `?v=`; sw precache derives `yv-precache-2026.07.09m`; **0 strays** of 09l; 1 historical `09h` comment only).
  **Preview E2E** (port 8765, ISOLATED headless preview — owner's real localStorage present: **treated strictly
  read-only, App.save() NEVER called, 8 offers verified unchanged, transient `App.optimizerPlan` injected + restored
  from snapshot**): drove the REAL render pipeline — headline "Best total return" (no trade line); a merged secondary
  badged "Best rate of return · Fastest capital back" rendering **"+9.2% APY · capital back 159 days sooner · -$150
  vs best"** on both the scenario card and (when focused) the proposal pane; a **no-qualifying-secondary** state
  showing exactly **1 champion card, no filler**; a validator-excluded **tappable** review row reading
  "Direct-deposit cadence/window can't be met" whose tap flipped `_optimizerEditReturn` and opened the modal with
  the **"Save & run"** primary button (cancelled without saving); **380px zero horizontal overflow**; **zero
  console errors/warnings**. **REVIEW-AFTER — Codex OUTAGE (still out of credits):** per the outage rule, substituted an INDEPENDENT ADVERSARIAL
  CLAUDE REVIEW (fresh general-purpose subagent, prompted to REFUTE; not self-review) over the batch diff
  `899679f..a4ff92f`. **Verdict: SHIP** — zero CRITICAL/HIGH/MEDIUM; it re-ran pins 50/50 + node --check and probed
  `selectChampions`/`captureValidatorExclusions` on adversarial inputs. Confirmed: the `-1e-9` APY tolerance admits
  only `[0.019999999, 0.02)` (never a meaningfully-sub-2pp delta); the reason-pick loop never misses a whitelisted
  reason nor false-positives a qualifying offer (uses the FULL grid, shared ctx/ddTransfer, cloned records);
  build-time vs validator rows are disjoint; churn ids resolve cleanly; render values are numeric + `escapeHtml`-
  wrapped (no XSS); Apply/renderer index the same list (lockstep intact); the timeline route is genuinely
  unreachable and `renderTimeline` still serves the Plan segment. **2 LOW (dispositioned, not actioned):** (1)
  validator rows can appear when NO feasible plan exists to "outrank" them — this is the *intended* R83-gap fix
  (explains why nothing could be scheduled) and stays strictly truthful, so kept; (2) `championGrossQualifies`
  degenerates to a no-op when the headline gross rounds to $0 (needs a $0-bonus offer) — gate (d) still applies and
  the output stays truthful, and the suggested guard is itself a no-op for non-negative gross, so not actioned.
  **1 NIT (out of scope):** `renderTimeline` is still exported though no module imports it now (still used internally
  by the Plan segment) — harmless, left for a future cleanup pass. Owner-owned dirty paths
  (`.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`, deleted `.codex/hooks.json`) untouched — explicit-path
  `git add` only. **Remaining (owner gate): device-check v2026.07.09m.** **Open:** cash-only exclusions (offers
  that qualify but lose on cash/ranking) remain unsurfaced in the review — by design (ITEM 2 scope is validator
  drops; surfacing a single "reason" for a cash-drop would be less truthful).


- **R83 (v2026.07.09l — CORRECTNESS FIX: close the DD posting-date qualification gaps from the 2026-07-09 Codex deadline audit):**
  The engine's DD qualification compared `directDepositEffectiveDate` (weekend/holiday shift ONLY) against literal
  cutoffs, ignoring ACH transit — so a DD initiated Fri 2026-01-16 with a Mon 2026-01-19 (MLK) deadline and
  inDays=1 returned `valid:true` even though the modeled post is Tue 2026-01-20. Now every DD qualification check
  compares the **ACH POST date** — `ddRoundTrip(dd, cfg).post` = initiate + inDays business days — using the SAME
  explicit `ctx.ddTransfer` the engine already threads (never the live provider). **Fixes:** **(1) Count-mode
  cutoff** (`validateDdCadence`, `js/optimizer-engine.js`): compares each DD's post date to the literal
  user/expiry cutoff; a post-after-cutoff now emits a distinct **`dd-post-late`** binding constraint → the review
  hint reads **"a direct deposit would post after the deadline — initiate it sooner"** (`BINDING_CONSTRAINT_COPY`,
  `js/render-main-views.js`). **(2) Frequency-mode bucket/window** checks now compare post dates against the
  literal window/period bounds (bounds stay literal). **(3) Frequency mode now APPLIES the user/expiry cutoffs**
  it already built into `cutoffCandidates` but previously never enforced — same `dd-post-late` semantics as count
  mode. `validateDdCadence` now takes `ctx` so it can read the threaded cfg. **(4) `ddWindowEndDate` count mode
  (`js/dd-core.js`) → max ACH POST date** (was max effective date); gained an optional `cfg` param defaulting to
  the live provider exactly like `ddRoundTrip` (in-app callers unchanged in mechanism; the engine passes explicit
  cfg). Consumers enumerated first: engine (`validateDdCadence` freq-only + `horizonDatesForOffer`, both now pass
  `ctx.ddTransfer`; horizon is dominated by the DD return date so no material change) and **`reminders.js:131`
  (the feed's "all DDs complete by" item)**. **⚠️ DELIBERATE FEED CHANGE ⚠️:** this moves the feed's "all DDs
  complete by" reminder LATER by the ACH in-days for count-mode DD offers — this is intentional and *more
  truthful* (that item's own copy already says "all qualifying direct deposits must have POSTED by this date")
  and stricter for qualification. The **frequency branch keeps its literal window formula** unchanged. **(5)
  Legacy `runOptimizer` (`js/projection-optimizer.js`)** — added a prominent ⚠️ header comment stating it is
  **cash-feasibility-ONLY** (no qualification layer: no deadline/DD-post/cutoff/cadence/horizon checks), unused by
  the UI, kept only for the C2/C3 feasibility pins — DO NOT wire it to any UI as a validator (use
  `optimizePlanner`). **(6) ENHANCEMENT DEFERRED (per-DD earlier-nudge local repair):** the search representation
  keys entirely on ONE per-offer signup date (`assignment[record.id]=signupISO`); DD dates are deterministically
  re-materialized from that signup (`applyDateGroup`/`materializeDirectDeposits`) and the apply path re-derives
  them the same way, so moving a single DD independently needs per-DD date freedom threaded through the assignment
  keyspace + `canonicalPlanVector` + apply materialization — a cross-module representational change, NOT a clean
  drop-in. Deferred with rationale; no repair pin added. **(7) RIDER (owner-approved, planner-approved):** the
  0-offer "do nothing" plan is now hidden from **"Other feasible plans"** (a $0 empty card is noise; doing
  nothing is implicitly feasible) — one-line filter in `optimizerProposalModel` (`js/render-main-views.js`), shared
  by the renderer AND Apply so indices stay in lockstep; the no-feasible-plan fallback is untouched. **Pins:
  optimizer 35→39** (+4, all green): the MLK count-mode repro (Fri-before-holiday DD → REJECTED via `dd-post-late`),
  a control (DD two days earlier → accepted), a frequency-mode user-cutoff fixture (3 monthly DDs, 3rd posts past a
  user deadline → rejected), and a post-date window fixture (a weekly DD whose effective date sits ON the window end
  but whose post spills one business day past it → rejected via `dd-window`). **No existing pin asserted the buggy
  weak-date semantics, so ZERO pins were updated** (all 35 stayed green untouched). **Full battery green:** node
  --check all modules + sw.js; **fidelity 67/67**, parser **20/20**, p2b PASS, dd-matrix ALL PASS, **feasibility
  5/5**, **optimizer 39/39**. **Preview E2E** (port 8765, owner's real local state SNAPSHOTTED + restored
  byte-identical — `App.save` never called, `localStorage` verified untouched, sync guard active): drove the
  Labor-Day-2026 equivalent through the REAL modules + render pipeline — a DD initiated Fri 2026-09-04 posts Tue
  2026-09-08 → plan card shows **"Not feasible"** + the binding hint **"…a direct deposit would post after the
  deadline — initiate it sooner (Sep 8)"**; pulling the DD to Wed 2026-09-02 (posts Thu 09-03) → **"Feasible"**,
  offer in the sequence, Apply button shown; **380px zero overflow**, **zero console errors**; live bundle reads
  **2026.07.09l** (runtime + sw + 19 import-map, 0 strays). **APP_VERSION → 2026.07.09l** (2 consts + 19 import-map
  `?v=`; sw precache derives `yv-precache-2026.07.09l`). **REVIEW-AFTER — Codex OUTAGE (out of credits):** per the
  framework's outage rule, substituted an INDEPENDENT ADVERSARIAL CLAUDE REVIEW (fresh general-purpose subagent,
  not self-review) over the combined diff `6013ab2..HEAD` (covers BOTH the un-reviewed v2026.07.09k champions batch
  and these v2026.07.09l changes — 09k's Codex review was also blocked). **Reviewer verdict: SHIP** — zero
  CRITICAL/HIGH/MEDIUM; it independently re-ran the pins (39/39) + node --check and confirmed the fix is
  boundary-safe (a DD posting exactly ON the cutoff qualifies), config-threaded per C1/C4, and the 0-offer
  render filter is shared by renderer + Apply (no desync). One **LOW** actioned (commit `399629a`): `validateDdCadence`
  read `ctx && ctx.ddTransfer`, which could silently fall back to the live provider if a future caller passed a
  ctx without ddTransfer → changed to read `ctx.ddTransfer` directly so a missing cfg fails LOUD (C1/C4). NITs
  noted, not actioned: freq per-period bucketing now uses post dates (documented intent of gap 2, not triggered
  by engine-materialized DDs); a lone 0-offer "do nothing" plan can still surface as a champion card (Apply
  safe-no-ops); pre-existing unused `directDepositEffectiveDate` import in `reminders.js` (out of scope). Owner-owned dirty paths (`.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`, deleted
  `.codex/hooks.json`) untouched — explicit-path `git add` only. **Remaining (owner gate): device-check
  v2026.07.09l.** **Open:** a DD offer that qualifies in NO feasible plan due to `dd-post-late`/`dd-window` only
  surfaces its reason via the plan-card binding hint when the infeasible include is the focused plan — when a valid
  alternative (e.g. the empty plan) outranks it, the offer is dropped without a dedicated tappable "Not in this
  plan" review row (pre-existing: `candidateReview` only captures BUILD-time exclusions). Surfacing
  qualification-excluded candidates as tappable review rows is a candidate follow-up.

- **R82 (v2026.07.09k — standalone owner batch: LABELED CHAMPION SCENARIO CARDS in Optimize; commit `94a557c`):**
  Owner-approved redesign of the Optimize runner-up list. The old "Other options" ranked runners-up on ONE
  axis (max gross), making extra cards near-pointless. Replaced with **NAMED CHAMPIONS**, one card per
  objective axis, all drawn from the engine's EXISTING feasible plan pool (no new search). **(1) Engine —
  `selectChampions(plans)` (`js/optimizer-engine.js`):** pure, over the FEASIBLE plans only (empty when none
  feasible), ordered **total → rate → fastest**:
  **Best total return** = max-gross winner via the full `comparePlans` chain (always plan[0], stays the
  default/selected plan); **Best rate of return** = highest `blendedAnnReturn` (ties fall through
  `comparePlans` — may be a small single-offer plan at far lower gross, which is the point); **Fastest
  capital back** = earliest `latestCompletionISO` (ties → `comparePlans`, i.e. gross then the standard chain).
  Merge is keyed on **canonicalVector** so a plan winning multiple axes collapses to ONE entry with combined
  labels (`{plan, axes[], labels[]}`), first-seen order preserved — never a duplicate card. Attached as
  **`plan.champions`** in `exactSearch` (`selectChampions(plans)`) + `beamSearch` (`selectChampions(beamPool)`,
  the same `allPlans.concat(repaired.plans)` pool `rankAlternatives` reads) + `champions:[]` default in
  `invalidPlan`. **`plan.alternatives` output is UNCHANGED** — the 09i diversity dedup is untouched, so all
  prior pins stay green. **(2) Render (`js/render-main-views.js`):** new pure **`optimizerProposalModel(topPlan)`**
  builds the ordered selectable list = champion plans first (index 0 = Best total), then the 09i diversity-
  deduped **feasible** remainder with champion vectors removed (raw remainder as fallback when NO feasible
  plan, under the old "Other options" header). Champion cards keep the 09i full-width comparison-row format
  (gross · offers · low cash · APY · capital back) with the axis label(s) in a full-width **`.opt-alt-badge`**;
  "Other feasible plans" header below. Proposal-pane rank line shows the focused champion's merged label
  ("Proposed plan · Best total return"). New `renderOptChampionList` + `renderOptScenarioCard` replace
  `renderOptAltList`. **(3) Apply consistency (`js/events-actions-data.js`) — the one real defect this batch,
  caught in E2E, fixed pre-commit:** `applyOptimizerPlan` used to index `App._optimizerAltIndex` into
  `top.alternatives`, but the render now indexes the champions+others combined list — so selecting a champion
  then Apply applied the WRONG plan. Both now call the SHARED `optimizerProposalModel(top).list` (exported
  from render-main-views, imported here — the modules already cross-import `diagReportText`), so tap-to-focus
  + Apply stay byte-identical. **New pins (+5 → optimizer 35/35):** distinct axis winners identified; a plan
  winning two axes collapses to one merged card; no-feasible → empty champion set; engine wires a feasible
  champion set with the winner as total (plan[0], all valid, no vector dup); deterministic across runs. All
  existing 30 pins stay green untouched. **APP_VERSION → 2026.07.09k** (2 consts sw.js + runtime-status.js +
  19 import-map `?v=`; sw precache derives `yv-precache-2026.07.09k`; **0 strays** — 2 remaining `…09h` are
  historical comments). **Full battery green:** node --check ALL modules + sw.js; **fidelity 67/67**, parser
  **20/20**, p2b PASS, dd-matrix ALL PASS, feasibility **5/5**, optimizer **35/35** (~3.0s). **Preview E2E**
  (port 8765, isolated headless browser — owner's real localStorage snapshotted, then **restored
  byte-identical** via a temp fetch file removed after; no sync token present so no gist push; `runPlannerOptimizerNow`
  never saves): seeded a 3-offer fixture (Whale $3000/150k/120d · Sprint $250/5k/30d · Quick $300/30k/10d,
  $300k capital) → run produced **3 DISTINCT champion cards** — Best total return {Whale+Sprint+Quick} $3,550 /
  7.0% APY / capital back Nov 6, **Best rate of return {Sprint} $250 / 60.8% APY** (the owner's exact point:
  small single-offer plan maxing rate), Fastest capital back {Quick} $300 / Jul 20 — plus "Other feasible
  plans" with 5 distinct remainders; badges render, `champCards=3`. **Selection**: tapping Best rate loaded
  Sprint into the proposal pane (rank "Proposed plan · Best rate of return"). **Apply**: applied ONLY
  off_sprint (incl+signup 2026-07-13; Whale/Quick untouched) → "Plan applied" + Undo → Undo reverted cleanly.
  **Merged-label case**: a 1-day-window single offer → ONE card badged "Best total return · Best rate of
  return · Fastest capital back", `champCards=1`, no duplication. **380px zero overflow** (scrollWidth==clientWidth==380,
  no wide offenders); zero console errors/warnings; live module APP_VERSION reads **2026.07.09k**. Owner-owned
  dirty paths (`.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`, deleted `.codex/hooks.json`) untouched —
  explicit-path `git add` only. **Codex review-after BLOCKED: the Codex workspace is out of credits**
  (`--scope branch --base origin/main` returned "Your workspace is out of credits"). Did a careful manual
  self-review of the diff instead (champion selection edge cases, render/apply list identity, no other
  `_optimizerAltIndex`/`alternatives[idx]` consumers) — the index-mismatch defect above was the only real
  finding and is fixed. **Remaining (owner gate): device-check v2026.07.09k + re-run the Codex review once
  credits are topped up.** **Open:** "Other feasible plans" can include the empty "do-nothing" plan as a
  genuinely-distinct feasible alternative (truthful, low value — owner call whether to hide 0-offer plans);
  legacy `case 'timeline'` route cleanup still carried.

- **R81 (v2026.07.09j — standalone owner batch: Optimize tap-through + "Save & run" + Offers "needs info" chip + churn-throughput tie-breaker + delete inert max-candidates setting):**
  Five owner-directed items. **(1) Tap-through from Optimize (`js/render-main-views.js`):** every "Not in this plan" review row is now a **tappable button** (`edit-offer-from-optimize`, `data-id` = resolved SOURCE offer) that opens that offer's edit modal — for churn re-run candidates the SOURCE offer, not the synthetic `churn_<id>`. Extracted `optReviewResolve(topPlan, r)` (shared by `optReviewName` + the tap-through) to resolve the source id; the exclusion reason stays visible on the row; rows whose source offer isn't in state stay non-tappable `<div>`s. New CSS `button.opt-review-row.tappable` (transparent border, accent-mid hover). **(2) Contextual "Save & run" (`js/events-actions-data.js`, `js/modals-forms.js`, `js/app-state.js`):** new one-shot gate `App._optimizerEditReturn` set by `editOfferFromOptimize` (clears the churn re-check gate so the two paths can't both fire). When set, the modal's primary button reads **"Save & run"**; after a normal save `saveOfferFromForm` ALWAYS re-runs the optimizer and returns to the Optimize panel (`_planSegment='optimize'`, `view='planner'`, `runPlannerOptimizerNow()`). Cleared on cancel/close/plain-edit so it never fires spuriously; Cancel unchanged. **(3) Offers "needs info" chip (`js/render-main-views.js`):** `offerNeedsInfoChip(o)` (+ pure `offerNeedsInfoReason`) adds a `chip-warn` to prospect/selected offer cards for a FIXABLE date gap the optimizer would exclude on — `needs-dd-date` (DD/held-and-dd with zero dated DDs), `needs-fund-date` (held-and-dd no funding date), `needs-signup-date` (OPEN account, no sign-up date), `needs-churn-date` (churnable, no re-run anchor → matches review `missing-churn-anchor`). Derived PURELY from the offer (never transient run state). A dateless CLOSED prospect is intentionally NOT flagged — it's a valid candidate the optimizer schedules a date for, so it isn't "excluded" (keeps the chip truthful). Placed after the status chip, before the expiration chip. **(4) Churn-throughput tie-breaker (`js/offer-model.js`, `js/optimizer-engine.js`):** inserted in `comparePlans` **after gross bonus + blended APY, BEFORE earliest cash-release**. New `churnNextEligibleAfterPlan(offer, cfg)` (offer-model) HONORS `churn_anchor` — reuses `churnEligibleDate` (account_opened measures from the plan sign-up date; falls back to plan-scheduled `withdrawalEligibleDate` + `churn_wait_months` when a fresh prospect has no anchor date); `objectiveForOffers` collects a **sorted vector** `objective.churnNextEligible` over churnable included offers; `compareChurnThroughput` compares each plan's **throughput key** lexicographically — a churnable plan keys on its sorted next-eligibility vector, a churnless plan on a single-element **`[cash-release]` proxy** so every plan has a real, comparable key and the comparator is a **TOTAL, transitive order** (a bare "empty ⇒ neutral 0" is non-transitive once the cash-release fallback runs — Codex P2, fixed pre-commit). Because a churnable offer's next-eligibility is always its own cash-release + wait (strictly later), the churnless proxy **never demotes it below a churnable plan that frees capital later** → never penalized; shorter key (fewer churnables) sorts first on a shared prefix. Deterministic (byteCompare); only reorders gross+APY ties. Design doc §4 updated (tie-break now #2, cash-release #3) + a **future-enhancement note**: a WEIGHTED continuation-value variant (bonus × decay on next-cycle timing) is documented as a future owner decision with its calibration risk stated. **(5) Delete inert "Optimizer max candidates" Settings input (owner reversed the earlier "do not touch"):** removed the Settings number input + hint, its 1–20 change-handler clamp, the sample-seed write, and the `app-state.js` default (`maxOptimizerCandidates: 15`). Engine-internal `MAX_OPTIMIZER_CANDIDATES` (cap 20) + `options.maxOptimizerCandidates` handling UNTOUCHED; the retired `runOptimizer` still tolerates the absent field via `|| 15`; old persisted values simply unread (no migration). `docs/BACKLOG.md`: entry moved to Recently-resolved (owner chose DELETE). **New pins (+5 → optimizer 30/30):** equal-value/equal-APY plans order by earlier next-eligibility; account_opened anchor measures next-eligibility from sign-up (Codex-P2#3 guard); non-churnable plan contributes an empty vector; churnless plans still order by cash release + never penalized; comparator stays a transitive total order (no A<B<C<A cycle — Codex-P2#1 guard). All existing 25 pins stay green untouched. **APP_VERSION → 2026.07.09j** (2 constants + 19 import-map `?v=`; sw precache derives `yv-precache-2026.07.09j`; **0 strays** — 2 remaining `…09h` are historical comments). **Full battery green:** node --check all modules + sw.js; **fidelity 67/67**, parser **20/20**, p2b PASS, dd-matrix ALL PASS, feasibility **5/5**, optimizer **30/30** (~2.9s). **Preview E2E** (port 8765, isolated headless browser — owner device data untouched): seeded a churnable-missing-anchor offer + a DD prospect with no dated DDs; Offers tab shows **"Needs DD date"** chip (chip row: DD · Prospect · Needs DD date · Expires… · Closed…); Optimize run → **2 tappable review rows** ("Re-run: … · Needs a date to re-run"); tapped one → modal opened with **"Save & run"** + `_optimizerEditReturn=true`; filled the anchor + Save & run → modal closed, **landed back on Optimize**, re-ran (toast "6 offers · $6,500 gross"), and the fixed churn offer **moved from review into the plan sequence** (NEW·CHURN, churn-eligible 2); Settings input **gone** (no `s-max`/label/hint); **380px zero overflow** on Optimize + Offers; zero console errors/warnings. **Codex review-after** (`--scope branch --base origin/main`, two rounds): **3 findings, all fixed pre-push.** Round 1 — **P2** the churn comparator was non-transitive (empty-vector "neutral 0" cycles `sort()` once cash-release runs) → gave every plan a real throughput key (churnless = `[cash-release]` proxy) making it a total order + added a transitivity pin; **P3** `delete-offer-from-modal` didn't clear `_optimizerEditReturn` so a later add/edit could inherit a stale "Save & run" → cleared it (+`_optimizerRecheck`) on the modal-delete path. Round 2 — **P2** `churnNextEligibleAfterPlan` added the wait to `withdrawalEligibleDate` uniformly, ignoring `churn_anchor` (wrong for account_opened) → now reuses `churnEligibleDate` (anchor-honoring) with the withdrawal-date fallback only for anchorless prospects + an account_opened pin. All re-verified in preview (add-offer after modal-delete reads "Add offer"; pins 30/30). Owner-owned dirty paths (`.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`, deleted `.codex/hooks.json`) untouched — explicit-path `git add` only. **Remaining (owner gate): device-check v2026.07.09j.** **Open:** the `needs-dd-date`/`needs-fund-date`/`needs-signup-date` chips co-occur with the existing "Draft — …" banner on incomplete offers (both truthful; chip is the compact review-matching flag) — dedupe is an owner call if it reads as noise; legacy `case 'timeline'` route cleanup still carried.

- **R80 (v2026.07.09i — make Optimize "Other options" meaningfully distinct + informative; commit `0f5ae10`):**
  Standalone owner batch (phone screenshots: 8 alternative cards all read "$2,550 · 4 offers · $12K low",
  indistinguishable; raw synthetic id shown in "Not in this plan"). **(1) Alternatives diversity —
  `rankAlternatives` (`js/optimizer-engine.js`):** replaced exact-`canonicalVector` dedup with a two-stage
  pass. **Collapse:** `alternativeCollapses(a,b)` folds a plan into an already-kept representative only when
  same offer SET + materially identical outcomes (same rounded gross, low cash within **$500** noise,
  completion within **5** calendar days) + every per-offer signup/funding/DD date within **≤3 business days**
  (`withinBizDays` via `addBusinessDays`); same-validity required so a feasible plan never hides an infeasible
  near-twin. Because the pool is pre-sorted best-first (`comparePlans` tie-breaks on earliest
  `latestCompletionISO` = earliest cash release), the survivor is always the **earliest representative** —
  matches the owner's "return it sooner" reasoning. **Re-rank:** survivors ordered to prefer a DIFFERENT offer
  composition first (one best-of-each-set pass), then materially different schedules of an already-shown set;
  winner stays index 0. **Perf guard:** per-composition cap (`max(limit,4)`) + total survivor cap
  (`max(limit*8,48)`) short-circuit the dominant winner-composition's thousands of near-schedules so the
  O(survivors) collapse scan never goes quadratic on the beam pool (perf pin back to ~1.5s, was 1.49s;
  a naive unbounded version hit 2.5s > budget). **(2) Alt cards (`renderOptAltList`):** now full-width
  single-column comparison rows — **gross · offer count · low cash · blended APY · capital-back date** — using
  **full comma dollars** (`formatCurrency`, dropped the compact-K `formatCompactCurrency` per the owner's
  formatting rule), filling the horizontal space (no more cramped 2-col grid). **(3) Copy:** "done <date>"
  → **"capital back <date>"** on the plan card AND alt cards (label = last cash release); restyled the plan
  info pane's low-cash/APY/**capital back**/horizon into labeled `.opt-metric` cells (below-buffer/shortfall
  stay as inline warn chips) so it reads as designed, not appended. **(4) Churn name bug:** "Not in this plan"
  resolved a raw `churn_<sourceId>` synthetic id for the `no-valid-date-window` review row (grid-empty churn
  candidate is filtered out of `plan.candidates`, so the old `state.offers` lookup missed). New `optReviewName`
  strips/resolves to the SOURCE offer's **bank · name** with a **"Re-run:"** prefix for churn context; sequence
  rows + binding hints already routed through `optimizerOfferName` (unchanged). **New pins (+3 → optimizer
  25/25):** same-set near-date variants collapse to one representative, alternatives list deterministic,
  representative is the earliest cash-release variant. **APP_VERSION → 2026.07.09i** (2 constants +
  19 import-map `?v=`; sw precache `yv-precache-2026.07.09i`; 0 strays — 2 remaining `…09h` are historical
  comments). **Full battery green:** node --check all modules; **fidelity 67/67**, parser **20/20**, p2b PASS,
  dd-matrix ALL PASS, feasibility **5/5**, optimizer **25/25** (11,806 evals / ~1.5s). **Preview E2E** (port
  8765, owner's real state snapshotted + restored **byte-identical**, `localStorage` never written during the
  run): seeded 2 held prospects (near-tie cluster) + 1 churnable-completed offer with past expiry (forces the
  synthetic-id review path); real run pipeline → **8 alternatives, ZERO echoes**, ordered distinct-composition-
  first ({A+B} $1,200 → {B} $700 → {A} $500 → none $0, then materially-different {A+B} schedules varying low
  cash 145k/160k + capital-back Sep/Oct/Nov); each card shows all 5 comparison metrics in full comma dollars;
  **"capital back" ×9, no "done"**; "Not in this plan" renders **"Re-run: Chase · Sapphire Checking"** (no raw
  `churn_off_…`); **380px zero overflow**; clean reload, zero console errors. **Codex review-after**
  (`--scope branch --base origin/main`): **no actionable bugs** (de-dup, review-name, formatting, version/cache
  all internally consistent) — nothing critical/high to fix. Owner-owned dirty paths (`.claude/settings.json`,
  `AGENTS.md`, `CLAUDE.md`, deleted `.codex/hooks.json`) untouched — explicit-path `git add` only.
  **Remaining (owner gate): device-check v2026.07.09i.** **Open (carried from R79):** inert Settings
  "Optimizer max candidates" input (owner deciding its fate — NOT touched, per directive); legacy
  `case 'timeline'` route candidate cleanup.

- **R79 (v2026.07.09h — RETIRE the Plan tab's Planner segment; commits `08ab968` removal + release commit):**
  Owner decision (2026-07-09, post-optimizer): the manual offer-toggle + brute-force **combo-feasibility
  Planner** is subsumed by the Optimize engine, so the Plan tab is now **Timeline / Optimize** (no Planner),
  defaulting to **Timeline** (monitoring-first; Home stays chart-first). **Audit first (blocking):** every
  Planner widget/stat/handler was classified — ALL turned out (a) duplicated or (b) subsumed; **nothing
  (c)-unique, so no migration was needed.** The include toggle already lives in the **shared `renderOfferCard`**,
  which the **Offers-tab card view** (default, `renderOfferCardWithActions` + `.planner-grid`) renders with the
  same checkbox → toggling offers in/out survives untouched. The three metric stats map to existing surfaces:
  "Selected"/"Expected bonus" → Overview **"Selected bonuses"** card; "Lowest projected" → Overview **"Lowest
  projected"** card; "Candidates" → Optimize **"Candidates"** metric. **Removed (each proven dead by re-grep,
  one revertable commit `08ab968`):** `renderPlannerBody`, `renderOptimizerResults`, `currentlyAppliedComboMask`,
  `renderComboCard` (+ exports); `run-optimizer`/`clear-optimizer`/`apply-combo` handlers, `runOptimizerNow`,
  `applyOptimizerCombo` (+ exports); orphaned `runOptimizer`/`summarizeProjection` imports + a stale
  `applyOptimizerCombo` comment ref in `projection-optimizer.js`; `App.optimizer` combo state; `_planSegment`
  default `'planner'→'timeline'` with **stale persisted `'planner'` coerced to `'timeline'`** in `renderPlanner`;
  CSS `.combo-card/.combo-header/.combo-offers/.recommended-tag/.combo-grid/.planner-add-btn`. **KEPT (still
  used — do not confuse):** the `runOptimizer` *engine* fn (feasibility pins 5/5 import it directly); `.planner-grid`
  (Offers tab); `.optimizer-bar`/`.optimizer-summary`/`.metric` AND `.combo-rank`/`.combo-bonus`/`.combo-meta`
  (the Optimize plan card reuses these — I over-deleted then **restored** the three `.combo-*` rules after the
  E2E; verified `.combo-bonus` computes 22px/700/#10b981). **APP_VERSION → 2026.07.09h** (19 import-map `?v=`
  + `js/runtime-status.js` + `sw.js` precache `yv-precache-2026.07.09h`; **0 strays**, all `2026.07.09*` consistent).
  **Battery green (unchanged pins):** node --check ALL PASS, fidelity **67/67**, parser **20/20**, p2b PASS,
  dd-matrix ALL PASS, feasibility **5/5**, optimizer **22/22** (11,806 evals). **Preview E2E** (port 8765, 7-offer
  sample): 4-tab nav; Plan defaults to Timeline; segment control is exactly Timeline/Optimize (no Planner btn);
  stale `'planner'`→Timeline coercion verified; Optimize run → valid **$6,000** plan / 8 options / plan card +
  restored `.combo-*` styling intact; Offers-tab card view shows 7 cards WITH the include toggle; **380px no
  overflow** on Overview/Timeline/Optimize/Offers; version reads **2026.07.09h** live; **zero console errors**.
  **Codex review-after** (`--scope branch --base origin/main`): **1 finding, P2** (not critical/high) — the
  Settings **"Optimizer max candidates"** control (default 15) is now inert because `buildOptimizerInput` sends
  only `options:{includeChurn:true}` and the live Optimize engine falls back to its default cap 20; the retired
  `runOptimizer` was its last UI consumer. **Left as an Open issue** (pre-existing forwarding gap my change
  merely exposes; wiring it in vs. removing the control is an owner design call — see below). No critical/high
  to fix. Owner-owned dirty paths (`.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`, deleted `.codex/hooks.json`)
  untouched — explicit-path `git add` only. **Open issue (owner):** either forward `settings.maxOptimizerCandidates`
  into `buildOptimizerInput().options` (makes the control affect Optimize) or remove the now-inert Settings input;
  also the legacy `case 'timeline'` view route in `renderActiveView` appears unreachable (goto-timeline routes via
  the Plan tab segment) — candidate cleanup. **Remaining (owner gate): device-check v2026.07.09h.**

- **R78 (v2026.07.09g — standalone owner batch: one-click churn Verify + restore-button aesthetic; commits `727f87a`, `c7a5a65`):**
  Owner-approved follow-on batch on top of the completed optimizer run (v2026.07.09f). **(1) Restore-backup
  button aesthetic** (owner: the label "fills" the button): shortened the Settings restore label
  "Restore pre-v2 backup" → **"Restore backup"** (Data section, `js/render-main-views.js`) so it breathes in
  its `.btn-grid` cell (~20px side whitespace, no 380px overflow); the `restore-pre-v2` confirm dialog now
  carries the explicit "pre-v2" wording. Action untouched. **(2) One-click churn Verify** (owner-approved
  BACKLOG item / amendment P2-2): the Optimize panel's churn control is now a one-tap **"Verify value"**
  (`verify-churn-value` → `verifyChurnValue` in `js/events-actions-data.js`) that fetches the source offer's
  stored DoC URL through the Worker WITHOUT opening the modal (the tap is the prompt gate). Extracted a shared
  DOM-free **`docWorkerFetchParse(url)`** out of `docImportFetch` (`js/doc-import-templates.js`) so the modal
  fetch AND the headless verify reuse ONE proven fetch+parse pipeline — parsing is never re-implemented.
  Behavior: a changed optimization input persists through `App.update` (last_edited + `syncRequirementsWithLegacy`)
  and forces a full re-run ("values changed — plan re-optimized"); an unchanged one flips the badge to
  **"Verified today"** (transient `App._churnVerifiedToday`, cleared on the next run / clear-plan). No stored
  URL, no Worker, a tiered ladder, or a structural DD/requirements change → falls back to the existing modal
  re-check flow (`recheckChurnCandidate`). In-flight spinner on the badge (`_churnVerifyInFlight`); Worker
  failure toasts and leaves the badge unchanged (`logError` E_SYNC_PULL). `churnVerifyPatch` maps the
  safely-headless inputs (scalars + churn_wait/anchor + debit); `churnVerifyStructuralChange` routes
  offer-type/DD + new-requirement changes to the modal. **(3) Rider:** the index.html bootstrap comment
  "17 versioned module URLs" → **19**. APP_VERSION → **2026.07.09g** (19 import-map `?v=` + `js/runtime-status.js`
  + `sw.js` precache `yv-precache-2026.07.09g`; 0 strays). **Battery green:** fidelity **67/67**, parser pins
  **20/20**, p2b PASS, dd-matrix ALL PASS, feasibility **5/5**, optimizer **22/22** (11,806 evals / ~1.49s).
  **Preview E2E** on the owner's real-but-stale local copy (7 offers, sync guard active, NOTHING persisted —
  state restored byte-identical, 4995 bytes / 2 keys): "Restore backup" @380px no overflow; one-click verify
  driven through EVERY path via a synthetic churn-eligible offer + a stubbed Worker returning real committed
  fixtures 01/03 — in-flight spinner, CHANGED→persist+re-run (incl. churn_wait 12→24 flipping eligibility so
  the re-run correctly drops it), UNCHANGED→"Verified today" badge + no re-run, Worker-failure→toast/badge
  unchanged, no-URL/tiered/structural→modal fallback with the button restored; the modal Fetch&Parse still
  works post-refactor (16 fields). **Codex review-after:** 2 findings, both fixed — P2 (the verify
  compare/persist now covers churn-eligibility + debit; structural DD/requirement changes defer to the modal)
  + P3 (restore the verify button before the modal-defer so it can't stick as "Verifying…"). `docs/BACKLOG.md`:
  one-click-verify item moved to Recently-resolved. Owner-owned dirty paths (`.claude/settings.json`,
  `AGENTS.md`, `CLAUDE.md`, `.codex/hooks.json`) untouched — explicit-path `git add` only. **Remaining (owner
  gate): device-check v2026.07.09g.**

- **R77 (DOCS + VERIFY + release prep — DOCS-ONLY, no version bump; run 2026-07-08-planner-optimizer step 5):**
  Release documentation round for the optimizer (v2026.07.09f stays — docs aren't precached, protocol
  bumps on app changes only; **no app file touched**). **Docs:** `docs/ARCHITECTURE.md` updated to **19
  `js/` modules** (added `dd-core.js` pure DD/day-model core + `optimizer-engine.js` pure sequencer to the
  module map, import-graph, bootstrap, versioning, and release-checklist counts) + **two new sections** —
  §5 Navigation & the Plan tab (4-tab nav Home·Plan·Offers·Settings; `renderPlanner` segment wrapper over
  Planner/Timeline/Optimize keyed by `App._planSegment`; transient `App.optimizerPlan`) and §6 Optimizer
  engine (snapshot-in/plan-out, candidate synthesis + churn/tier badging, `EVAL_CAP` 50k → beam-64 →
  coarse ladder + pair-swap, real-`generateProjection` scoring, qualification validator → `bindingConstraints`,
  plan-derived horizon 30d/730d, apply materialization + one-shot undo). `CHANGELOG.md` gained release
  entries for **v2026.07.09c** (`f54c9d0` chart batch) / **09d** (`3ed67e8` C2/C3+template hotfix) / **09e**
  (`2231b37`+`44b844a` engine + dd-core + .card-soft rule removal) / **09f** (`c8bd429..ed7d0f5` Plan-tab
  merge + Optimize UI + apply/undo + P0 offer-save fix). `docs/BACKLOG.md`: Today-label item marked shipped
  (`a1babb6`); added **churn re-check one-click verify UX** (owner-review candidate — the re-check is
  modal-gated by design) and **`localRequirementDeadlineISO` → `requirementDeadlineISO` consolidation [low]**.
  **Full battery re-confirmed at HEAD** (app code == `ed7d0f5`; HEAD `bbffd56` only adds the planner's
  checkpoint `.md`): `node --check` 19 modules + inline entry + `sw.js` all pass; **fidelity 67/67**; parser
  regression pins **20/20**; **p2b** synthetic PASS; **DD matrix** ALL PASS (17); **feasibility pins 5/5**;
  **optimizer pins 22/22** (11,806 evals / ~1.48s — under the <2s / 50k-eval budget). **E2E smoke +
  READ-ONLY real-data dry-run** on the preview origin (`localhost:4173`, owner's real-but-stale offline copy:
  7 offers, $200k liquid, $20k buffer; sync unconfigured + local-origin guard in force — `yv-allow-local-sync`
  never set, ZERO cross-origin calls): clean boot, SW converged to **`yv-precache-2026.07.09f`**, all 3 Plan
  segments switch, 380px no overflow. **Dry-run proposal (owner reads this):** verdict **FEASIBLE**, **6
  candidates / 1 churn-eligible** (+1 excluded: a churn offer missing its anchor date → "needs date"); best
  plan **$5,000 gross** across **4 offers** — Citi · Priority Checking (sign up Jul 10), BMO · Premier Checking
  (Jul 9), PNC · Virtual Wallet Plus (Jul 10), HSBC · Premier (Oct 1); low cash **$72,450 on Oct 1** (buffer
  $20k → ~$52k headroom, **0 binding constraints**), 12.5% blended APY, 204d horizon, done Dec 30, 8
  alternatives; beam search, 3,830 sequences, ~377ms click-to-rendered. **Closed WITHOUT applying —
  nothing persisted** (state hash unchanged before/during/after, no undo entry, `optimizerPlan` cleared to null).
  **Run status: step 5 DONE.** Remaining (planner/owner, NOT this round): owner device-check on the phone,
  then the `stable-2026-07-09` tag.

- **R76 (v2026.07.09f — PLAN-TAB UI + OPTIMIZE PANEL + APPLY; run 2026-07-08-planner-optimizer step 4, `4b4ca96..3361222`):**
  The optimizer engine now has a UI. **(i) Nav merge** (`c8bd429`): Plan + Timeline
  fold into ONE segmented **Plan** tab (Planner · Timeline · Optimize) → **4-tab nav**
  (Home · Plan · Offers · Settings); Home/Overview stays chart-first (owner decision).
  `renderPlanner` is now a segment wrapper over `renderPlannerBody`/`renderTimeline`/
  `renderOptimizeSegment`; `App._planSegment` holds the active segment; `goto-timeline`
  routes to the Plan tab's Timeline segment. **(ii) Optimize panel** (`97f9e68`): runs the
  pure `optimizePlanner` on an injected snapshot (ddTransfer via the live resolver) and
  renders the TRANSIENT proposal (`App.optimizerPlan`, never persisted) — sequence view,
  capital-curve summary, per-offer op + unverified-churn provenance badge
  (`last_edited`→template `savedAt`→unknown), binding-constraint hints, an alternatives
  picker, and a "not in this plan" review. **(iii) applyOptimizerPlan** (`61d1dec`, P2-6):
  ONE batched `App.update` — update (mutate in place, DD dates moved BY ID, `last_edited`,
  `syncRequirementsWithLegacy`) / create (churn candidate → a REAL run-again offer via
  `templateToOffer(offerToTemplate(source))` + overlaid schedule, fresh `uid`) + a one-shot
  deep-clone undo (create↔delete). **Parity fix (P1-1):** a currently-included candidate the
  optimizer DROPS is de-selected on apply, else the live curve diverged from the proposal
  (verified: dropped-but-included Citi left live at −$30k vs the plan's +$20k). **(iv) Churn
  re-check** (`92118b0`, P2-2): a "Re-check value" control opens the source offer's edit
  modal (existing DoC Worker import path); a changed optimization input on save forces a
  FULL re-run, unchanged just confirms. **(v) Hero "Today" label** (`a1babb6`): left-aligned
  (`text-anchor=start`) at padL so it no longer clips the SVG left edge. **(vii) Codex
  review** (`3361222`): 2 P2s fixed (broadened + backfill-robust re-check signature; explicit
  empty-candidate sentinel so drafts don't pollute a run). **P0 side-fix (`1aed621`):**
  `readOfferForm` called `schemaV2Defaults()` without importing it — **every offer add/edit
  save was throwing** (pre-existing since the module split); one-line import fix, discovered
  because the re-check routes through the modal save. APP_VERSION → **2026.07.09f** (import
  map ×19 + runtime-status + sw.js; 0 strays). Battery green throughout: fidelity **67/67**,
  parser pins **20/20**, p2b PASS, dd-matrix PASS, feasibility **5/5**, optimizer **22/22**
  (11,806 evals / ~1,486ms). Preview E2E @ 09f: clean boot, 4-tab nav, all 3 segments,
  run→proposal→apply→undo, churn materialization (hold anchor preserved), SW converged to
  `yv-precache-2026.07.09f`, 380px no overflow. **Remaining: step 5** (release docs / CHANGELOG /
  ARCHITECTURE, owner device-check, `stable-` tag). Open notes: `localRequirementDeadlineISO`
  vs `requirementDeadlineISO` consolidation still deferred [low]; churn re-check is prompt-gated
  through the modal (no inline auto-fetch — reuses the proven path by design).

- **R75 (v2026.07.09e — OPTIMIZER ENGINE LANDED; run 2026-07-08-planner-optimizer step 3, commit `44b844a`):**
  Pure planner sequencer `js/optimizer-engine.js` (1,261 lines) + in-app `testOptimizerPins()` +
  Node harness (`docs/fixtures/optimizer/harness/optimizer-pins.js`) + import-map/SW-precache wiring
  for `js/dd-core.js` (extracted in `2231b37`) and `js/optimizer-engine.js`, APP_VERSION → 2026.07.09e
  (three literals: import map ×19, `js/runtime-status.js`, `sw.js` — 0 strays), and the `.card-soft`
  **dead-CSS-rule deletion** rider (rule at old index.html:446 removed; citing comment ~1979 synced;
  BACKLOG moved to Recently-resolved). The `--card-soft` COLOR VARIABLE + all ~12 live `var()` uses
  STAY (verified 0 `.card-soft` elements in the live DOM). **Split: Codex (GPT-5.5) implemented
  overnight under owner authorization; Claude adversarially verified + committed (review-after
  INVERTED).** Codex's sandbox could not write `.git` (index.lock EPERM) → all work was uncommitted;
  hence ONE combined commit (rider not path-splittable from index.html wiring). Engine PURITY
  confirmed: imports only the pure closure (date-format-core, dd-core, projection-optimizer,
  offer-model, runtime-status); transitive graph never reaches App/render/Sync/dd-widgets/reminders;
  `ddTransfer` + `today` threaded at every call site; `generateProjection` honors
  `options.{ddTransfer,horizonDays,includedOfferIds}` (post-hotfix `3ed67e8` semantics).
  Battery (independent re-run, not the overnight log): fidelity **67/67**, doc-parser regressions
  **20/20**, P2B-SEG PASS, DD MATRIX ALL PASS, testFeasibilityPins **5/5**, testOptimizerPins
  **22/22** (interactive 14-candidate optimize **1487ms / 11,806 evals** — the number the <2s /
  50k-eval budget governs; the 2963ms suite PERF is total test time, not the interactive budget).
  Browser: boots clean on 127.0.0.1:4173 (local-origin sync guard active — cloud safe), in-app
  testOptimizerPins 22/22 + testFeasibilityPins 5/5, 380px no overflow, SW precache
  `yv-precache-2026.07.09e` carries both new modules. Feed byte-identity holds by construction
  (reminders.js / events-actions-data.js untouched). Embargo since `2231b37` RELEASED by this push
  (dd-core now in map+precache → offline boot safe). **Remaining: step 4 (Plan-tab UI merge +
  Optimize panel + applyOptimizerPlan) + step 5 (release docs, stable- tag on owner device-check).**
  Open notes for step 4: churn synthesis is hand-rolled in the engine (stable `churn_<id>` ids for
  determinism) rather than the `templateToOffer(offerToTemplate())` pipeline — capital-model-faithful
  for evaluation, but applyOptimizerPlan must reconcile create-fidelity to the real Run-again offer.

- **R74 (v2026.07.09b — owner batch + sync guard; run 2026-07-08-module-split-efficiency COMPLETE, commit `1fc39b3`):**
  "Lowest projected" now full comma format (was compact "$35K") on Home AND Plan; Plan's stat takes
  Home's exact three-state color logic (root cause: only the HEALTHY state had drifted — Plan green
  vs Home amber `#c88b2c`; shortfall/belowBuffer already matched; residual: Plan's amber is a
  documented hardcode — unify both tabs on one color system if `.stat-value.lighten` ever recolors).
  **LOCAL-ORIGIN SYNC GUARD:** on localhost/127.0.0.1, ALL Gist sync (push+pull; 7 sync-pwa.js
  chokepoints + the Save&test join-flow pull in events-actions-data.js) is skipped unless
  `localStorage yv-allow-local-sync === '1'` — local test/preview instances can never touch cloud
  data (DoC-worker fetches unaffected). All gates green (fidelity 67/67, pins 20/20, feed
  sha-identical, 380px, SW converged 09b); Codex CLEAN; owner's real local state byte-verified
  untouched. Owner confirmed v2026.07.09a good on his phone (zero errors) → tag
  `stable-2026-07-08` (at `7a25b1a`). Pre-split rollback = `checkpoint-2026-07-08-pre-modules`.
  Owner-directed follow-ons: Tier-3 backlog, `.card-soft` decision, layout mocks, the OPTIMIZER run.
  **Durable cross-session backlog now lives in [docs/BACKLOG.md](docs/BACKLOG.md)** (added late 07-08;
  dark mode from closed PR #2, .card-soft decision, Tier-3, optimizer future enhancements, etc.).

- **R73 (v2026.07.09a RELEASED — split-run wrap, steps 4–5):** step-4 consolidations done under the
  deletion ratchet (Tier-1: 6 classes, net −20 lines, `.card-soft` retained on a live comment ref;
  Tier-2: 3 classes + 4 evidence-backed SKIPS incl. a PROVEN formatCurrency rounding divergence a
  naive dedup would have regressed; parser byte-untouched → corpus 84.9% stands; Tier-3 DEFERRED).
  Step 5: three-literal APP_VERSION bump → 2026.07.09a (import map ×17, `js/runtime-status.js`,
  `sw.js` — sweep 0 strays), SW 08e→09a transition validated LIVE (old precache evicted, zero
  errors), full battery green, feature smoke pass, `docs/ARCHITECTURE.md` added (fold into
  AGENTS.md once the owner's pending AGENTS.md edits land). Before/after: index.html 14,993→2,929
  lines; 17 js/ modules (12,308 lines); +27,385 bytes total (ESM wiring + SW + bootstrap).
  **SYNC INCIDENT (owner restored the 2:09AM Gist version after a stale push): test instances
  EXONERATED** — the step-5 audit proved the only test origin (127.0.0.1:4173) carries NO sync
  config (no token/gistId), so no test could push; its local state is a real-but-stale offline
  copy (net-zero mutation by the smoke; the "Delete template?" dialog the owner saw was the
  smoke's own created-then-deleted template). Primary hypothesis now: a stale owner DEVICE pushed
  on wake — if it recurs, Settings → Copy diagnostics immediately (E_SYNC entries name the
  culprit). Hardening + owner UX items (lowest-projected "K"→",000", Planner-tab stat color match,
  localhost auto-sync guard, bump 09b) dispatched as run step 6 (R74). stable- tag awaits owner
  confirmed-good. Tier-3 backlog + the optimizer run = owner-directed follow-ons.

- **R72 (module split SHIPPED LIVE — run 2026-07-08-module-split-efficiency, step 3):**
  `index.html` (~15k lines) → **17 native ES modules** under `js/` + a ~30-line entry bootstrap +
  Path-B network-first service worker (`sw.js`: precache `yv-precache-<APP_VERSION>`,
  api.github.com/gist NEVER cached, controllerchange→reload). 8 commits `affca79..6f0c58b`,
  pushed; live URL confirmed serving the module build (sw.js SHA-match). Every phase gated:
  fidelity 67/67, pins 20/20, feed byte-identity via line-multiset proofs, preview E2E, 380px,
  and a true-offline reload (17/17 modules fromServiceWorker, zero errors). Codex-reviewed per
  phase (P0: 1 P1 fixed — bare console-test aliases; P1: 1 P3 accepted — import-block comments;
  P2: CLEAN; P3: 2 P2s — SW cache cleanup was origin-wide + update reload could fire mid-edit —
  both fixed+proven in `b18e323`, pushed). Zero code lost — byte-multiset verified.
  **APP_VERSION intentionally still 2026.07.08e until step 5**; the bump now touches THREE
  places: the import-map `?v=` literals, `js/runtime-status.js`, `sw.js`. Corpus harness now
  imports module source (extraction-identity proven). Remaining: step 4 (ranked consolidations
  under the deletion ratchet) + step 5 (ARCHITECTURE.md, bump 2026.07.09a, tag, changelog).
  Run checkpoint = the authoritative record.

- **R71 (handoff, nothing new on disk beyond docs):** the module-split run is PARKED at its
  plan gate awaiting a fresh session. Authoritative handoff (mission, exact phase, amended
  contract, first action, verify commands) = the **FRESH-SESSION HANDOFF** section at the top of
  `.claude/orchestrator/runs/2026-07-08-module-split-efficiency.md` — read that before anything.
  Key facts: v2026.07.08e committed+pushed = `447c57f`; fixtures 67/67 + pins 20/20 green;
  Codex audit step done → 17-module map in `docs/assessments/2026-07-08-module-split-design.md`
  (untracked; amendment COMPLETE — 522-line contract, P0→leaves→atomic-SCC→shell, one
  sanctioned setter `seedManifestHwm`); offline decision = Path B
  minimal network-first SW; plan gate caught 2 P1 bootability issues (cross-module `_manifestHwm`
  rebind; DOM/state SCC needs one atomic phase); NO heartbeat/auto-resume exists (cron cancelled
  by owner) — continuation requires a manual nudge. ZERO module code written yet.
  **RESUMED 07-08 ~09:2x (fresh session):** amendment independently verified (marker grep = 8;
  P0→P1→P2→P3 table confirmed), baseline green (syntax OK, fidelity 67/67, pins 20/20),
  split-contract commit + tag `checkpoint-2026-07-08-pre-modules` pushed, step-3 P0 dispatched
  to the executor. Codex outage root-cause corrected: 5h usage window at 0% (not credits),
  reset ≈09:52 — review-after routes through Codex again.
- **R70 (committed+pushed `447c57f`):** removed the Overview "At a glance" panel and added
  per-action completion on the Upcoming-actions list — a quiet done control per row,
  `state.action_done` map (+ requirement-row write-through), completed items linger greyed
  7 days then drop, feed excludes+tombstones completed actions (Shortcut auto-completes the
  reminder), and an app-side reverse channel that consumes an optional `yv-completions.json`
  Gist file (phone→app). Same round also: chart legends → tight 2-col grid; tier-picker ROI
  chips; and a **DoC URL-importer live-test batch** (Worker `title` fill + client slug fallback,
  clawback-critical hold-anchor fix "days X through day Y"→Y/opening, waiver colon+bullets append,
  capFirst-except-promo, tier-radio centering, card-foot link stacked below the Updated stamp).
  `APP_VERSION` → `2026.07.08e`. See the R70 log entry. **Owner action:** redeploy the Cloudflare
  Worker to unlock the higher-quality title fill (old worker still works via the slug fallback).
- `index.html` ≈ 15,000 lines, single-file PWA. `APP_VERSION` = `2026.07.08e`
  (shown in Settings → About & diagnostics; bump + tag `stable-YYYY-MM-DD` +
  CHANGELOG entry on each confirmed-good release). R56–R61 are all committed
  and deployed (R56 sync fix passed a 10-round Codex review before shipping;
  the per-round "DO NOT COMMIT" notes meant "coordinator commits after
  verification," not that work stays uncommitted). R62/R63/R64 are working-tree
  changes pending review before commit. No stable- tag yet — owner hasn't
  confirmed-good. Sync guard is bilateral once both devices run ≥ 2026.07.05
  (confirmed on the owner's phone via diagnostics).
- **Bonusflow run (R66, 2026-07-07):** the overnight orchestrated run (steps
  2–11 of run `2026-07-07-bonusflow`) shipped schema v2 + migration/backup,
  the requirements engine, the derived lifecycle pipeline, churnability, the
  DoC paste-import parser (+ gated v2 URL-import Worker scaffold), offer
  templates, freshness/sort UI, and an aesthetics sweep — all committed locally
  (`46c0c49`→`f336a2e`; baseline tag `checkpoint-2026-07-07-pre-bonusflow`).
  Step 11 (this entry) ran the end-to-end verification battery + docs + version
  bump; the one issue verification surfaced (inline card status-change didn't
  stamp `closed_date`) was fixed pre-push via a shared `reconcileClosedDate`
  helper. See the R66 log entry for the full feature list. **R67** then shortened
  the Overview churn "Upcoming" window to 60 days and added per-offer churn snooze
  (`churn_snoozed_until`, timed or indefinite) across the Overview section, the
  card line, and the feed (suppressed while snoozed) — owner requests; both R66
  and R67 are working-tree changes pending the planner's review/commit.
- **Parser-calibration run (R68, 2026-07-07):** calibrated R66's DoC
  `parseDocPost` against a real, independently-labeled **31-post gold corpus**
  (`docs/fixtures/doc-corpus/`) after the owner challenged whether the accuracy
  stats were fabricated. Shipped tier-aware parsing (`docScanTiers` → `tiers[]` +
  preview "select your tier" picker) and delta-aware stale-value demotion; field
  accuracy **73.4→84.9%**, high-confidence-wrong **26→2**, calibration
  un-inverted — all in `docs/fixtures/doc-corpus/verification-log.md` as **verbatim
  machine output** (reproducible; `testDocParserRegressions()` = 12 in-app pins).
  Steps 4a/4b are committed (`eedb027`, `0126e2a`); step 5 (this entry: corpus
  artifacts + docs + `APP_VERSION` 2026.07.08c) is working-tree pending the
  planner's review/commit.
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
- **Sign-up date (R64):** `plannedSignupDate` is REQUIRED only when
  `accountStatus === 'open'` (`isOfferComplete`/`offerIssues`). A prospect/
  applied (closed) offer saves as a full non-draft offer WITHOUT a date — it
  emits no dated work items and ties up no projected capital (all date
  consumers are null-safe; no "Invalid Date"/"NaN"), but its expiry still
  shows. Don't re-add an unconditional signup-date requirement.
- **Status model:** `accountStatus` (open/closed) + 9-value `subStatus`;
  legacy `offer.status` survives as a derived shadow — don't remove (R38).
  User-facing label is **"Offer status"** (R64; identifiers stay `subStatus`).
  subStatus auto-drives accountStatus BOTH ways via `defaultAccountForSub`
  (R64): approved/on-track/met-waiting/earned/didnt-track → open;
  prospect/applied/denied/archived → closed. Wired in the modal `change`
  handler AND the inline change-status handler.
- **Debit requirement (R64):** `debitRequirement` = `{ required, count,
  withinDays, byDate, byDateLegacy }`. The deadline is a day-count from sign-up
  (`withinDays`), NOT an absolute date; derive via `debitDeadlineISO(offer)` =
  sign-up + withinDays (emits nothing when underivable). `byDate` is retired
  (kept `''` for payload shape); legacy absolute deadlines migrate on load
  (`migrateDebitRequirement`/`reconcileDebitWithinDays`) to `withinDays`,
  preserving the original in `byDateLegacy`. Feed/list/card all derive via
  `debitDeadlineISO`.
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
- **Reminder feed = contract v2 (R63):** ONE shared `buildReminderItems(state)`
  (~line 5293) is the sole source of every actionable date; `computeReminderFeed`
  (schema-2 machine feed), `computeUpcomingActions` (overview list, 90-day
  horizon, but past-due dropped) all consume it — they reconcile by
  construction: count = the isWork items due TODAY-or-later; list = builder
  items within [today, today+90]; BOTH drop past-due dates, so a committed
  offer past its funding date reads count 0 / list 0 (never 1 / 0). `_feed`
  is now `{schema:2, generatedAt, manifestVersion, feedStatus,
  lastGoodGeneratedAt, items, removed}`; `risk` deliberately omitted (later
  phase). Gates key on the MODERN `subStatus` fields, never the legacy
  `deriveLegacyStatus` shadow (which is why funding deadlines used to vanish
  on Approved — legacy maps approved→'funded'): offer-expires shows for ALL
  non-terminal offers INCLUDING scenario-excluded prospects (it bypasses
  `offerIsActiveForProjection` on purpose — scenario inclusion is capital
  modeling, not expiry visibility; the owner's live BMO is a prospect w/
  `includeInScenario:false` and must still surface its expiry); work items
  (deposit/dd/debit) only for committed (approved/on-track, met-waiting
  excluded); withdrawal while capital is live (approved/on-track/met-waiting).
  deposit-deadline emits for the fund-a-lump types only — NOT standard
  `direct-deposit` (its money movement IS the DDs) — gated as "not
  direct-deposit" so a legacy/seed offer with absent `offerType` (app-default
  new-funds-held) still emits it. Per-DD items are keyed `yv-<offerId>-dd-<ddId>`
  off a persisted per-DD `id` (minted at row creation, back-filled on load by
  `migrateDdIds`) — never array index; id stability assumes all devices run ≥
  this build (an OLD build editing DDs re-mints ids — accepted: both owner
  devices are current and no Shortcut consumer exists yet). Deletions/
  disappearances tombstone into `removed[]` (90-day fixed TTL;
  `state._feedEmitted` tracks prior ids). Feed computation on the push path
  routes through `computeFeedSafely` (logError + last-good reuse marked
  `feedStatus:'stale'`) — never a silent `try{}catch{}`. `deriveLegacyStatus`
  is UNCHANGED (R38 shadow stays). Don't re-introduce a legacy-status read in
  these functions or a bare feed try/catch.
- **Chart/tooltip colors are LOCKED** — see AGENTS.md → "Locked design
  values" before touching any chart, legend, or tooltip hex.
- **Pending:** iOS Reminders Shortcut on-device build (SHORTCUT_SETUP.md);
  DoC URL ingestion (needs backend or client-side LLM); per-link DD
  success/recency (deferred — requires following thousands of DoC comment links).

---

## Log (newest first)

### 2026-07-08 — Session (claude-fable-5 planner, handoff round)
**Round 71 — Module-split run parked; durable handoff written**
- No app code changed this round. Wrote the FRESH-SESSION HANDOFF section (12 points:
  mission, exact phase, done/not-done, amended split contract, first action, read-first /
  avoid lists, verify commands, git state, audit-output locations, no-heartbeat warning)
  into `.claude/orchestrator/runs/2026-07-08-module-split-efficiency.md` — that section
  is the single entry point for whoever picks this up.
- Why: owner requested a clean stop before implementation; heartbeat cron cancelled, so
  a cutoff mid-split would otherwise strand undocumented in-flight state.
- Do-not-redo: the plan-gate P1s are REAL (imported-binding reassignment SyntaxError;
  SCC has no valid incremental extraction order) — do not attempt the original P4–P8
  phase table; the atomic-SCC restructure in the handoff §5 is the binding contract.
- Pending follow-ups: verify the design-doc amendment landed (handoff §6), owner Worker
  redeploy, Codex credits, then step-3 execution.

### 2026-07-08 — Session (opus-4-8[1m], /orchestrate executor — action tracking)
**Round 70 — Remove "At a glance"; add per-action completion + feed/reverse-channel wiring; chart-legend 2-col grid; tier ROI chips; DoC URL-importer live-test fixes (title fill, hold anchor, waiver bullets, capFirst, tier-radio, card-foot); v2026.07.08e**
(Owner: the At-a-glance panel "doesn't seem fully necessary" — he wants to TRACK actions performed/pending, tick them done, ideally reactive to iOS Reminders completions, with completed items showing status instead of lingering as if unactioned. Single working-tree release; DO NOT COMMIT — pending the planner's review.)
- **[Investigation — At-a-glance consumers]** `computeActionsRequired` had EXACTLY ONE
  consumer: the At-a-glance "Actions required" cell (grep-confirmed — every other hit is
  its def or a doc comment). The other snap cells were inline `.filter().length` reads of
  `offers/commitments/events`, no shared helper. So removing the panel orphaned only
  `computeActionsRequired`; I removed it too and updated the builder's RECONCILIATION-
  INVARIANT comment. The prior **[P1] "past-dated work items inflate Actions required"**
  miscount is therefore **fully mooted** — nothing else counts work items (the current
  `it.dueDate < todayISO` guard had already fixed it in-place; now the surface is gone).
  Shared constants `WORKING_SUB_STATUSES`/`CONFIRMED_OFFER_STATUSES` are used elsewhere
  (buildReminderItems) and were left intact; `expectedBonusTotal` still feeds the
  "Selected bonuses" stat card, so its computation stayed.
- **[1] Removed the At-a-glance `<aside>`** + its entire `.snapshot-*`/`.snap*` CSS block
  (no orphan CSS) + the `.overview-aside` media rules. `.overview-main` (Upcoming actions)
  now spans the full 3-col grid — the owner's action surface gets the whole width.
- **[2] Per-action completion.** New root key `state.action_done = { [feedItemId]: doneISO }`
  (defaulted in `defaultState`; tolerant guard in `migrateOffersToSchemaV2`, templates-style).
  Each Upcoming-actions row on a **completable** kind (`ACTION_COMPLETABLE_KINDS`) gets a
  quiet circle control (`.action-check`, checklist idiom). **Semantics by kind:**
  `requirement-deadline` **writes through** to the requirement row's `done`/`done_date`
  (two-way — same source of truth as the offer-card checklist; reuses `toggleRequirementDone`),
  so it is NOT stored in `action_done`. Every other completable kind
  (deposit/dd-initiate/dd-window-end/debit/withdrawal/churn-eligible/expected-bonus-window/
  safe-to-close/offer-expires) toggles `action_done[id]`. Pure capital-flow rows
  (commitment-end/inflow/outflow) get **no** control (not "actions the owner performs").
  `ACTION_DONE_LINGER_DAYS = 7`: completed rows stay greyed/struck with "Done M-D-YYYY",
  sorted to the list bottom, then drop; id stability prevents resurrection.
- **[3] Feed integration (envelope FROZEN).** `buildReminderItems` now annotates every item
  with `done`/`doneDate` (requirement rows read their own flag — done rows are no longer
  skipped, they emit annotated; other kinds read `action_done`). `computeReminderFeed`
  filters `built → emitted = built.filter(!done)` for `items[]`, `liveIds`, and `_feedEmitted`,
  so a completed action leaves the live set and the **existing tombstone diff** retires it
  into `removed[]` — the iOS Shortcut's existing Section-F mark-complete loop then completes
  the reminder. Mirrors the requirement-done precedent exactly. **Byte-frozen when nothing is
  completed** (verified: fresh-seed feed item-id set unchanged; complete→tombstone→
  un-complete→resurrect cycle verified in-browser).
- **[4] Reverse channel — app side FULLY implemented (auth reality: the Shortcut ALREADY has
  write auth).** The build guide's P4 PAT (`gist` scope) + Section-G heartbeat PATCH prove the
  Shortcut can write the Gist; and the app's own Sync pull already fetches the whole Gist file
  list (`ghGet .../gists/<id>` → `data.files`), holding the same gist-id+PAT. So consuming a
  sibling `yv-completions.json` costs no new fetch and no new credential. New async
  `applyRemoteCompletions(state, files)` reads that file on pull (hooked at the tail of
  `Sync.safeSync`), applies `{id, completedAt}` entries newer than a high-water timestamp
  `state._completionsHwm` (idempotent; app never writes/prunes the file), routes req-ids to
  write-through and others to `action_done`, ignores unknown ids, and is a **no-op when the
  file is absent** (app behaves identically). On apply it `save()`s + pushes so the item
  tombstones. Guide gains an **optional Section I** (phone→app) with the file contract, the
  PAT reuse, and a security note; Section F notes app-side completions arrive as tombstones.
- **[5] Display-name strip (deferred item).** `renderActionRow` wraps the title in
  `displayOfferName(item.name)` (display-side only; feed payload untouched) so "…$600"
  suffixes drop from the list (verified: "BMO — Premier Checking", not "…$600").
- **[6] Chart legends → tight 2-column grid (owner correction of R69 Item D — "back to
  stacked but tighter").** `.chart-legend` (shared hero + timeline) goes from the R69
  flex-wrap row to a content-sized 2-col grid (`grid-template-columns: max-content
  max-content; justify-content: start`) so the columns sit adjacent (col 2 at ~131px), NOT
  the pre-R69 `1fr 1fr` half-card spread: hero 6 items → 2×3, timeline 4 items → 2×2.
  `column-gap 18px`/`row-gap 6px`; a `≤340px` media query collapses to 1 col as a pure
  ultra-narrow safety net (2 cols total ~250px, so they stay 2-up at 380px, verified both
  desktop 1280px and 380px, no overflow).
- **[7] Tier-picker annualized-return chips.** `_docRenderTierGroup` adds a muted
  `.doc-tier-roi` chip after each tier's bonus: `rate = bonus/threshold_min`, annualized by
  `365/lockDays`, `lockDays = tier.hold_days ?? offer-level daysFundsMustRemain` → "≈N%/yr";
  no hold anywhere → plain "N% ROI (no hold data)". Guarded (`threshold_min>0`,`lockDays>0`);
  compact `_docFmtPct` (int ≥10, one decimal below); render-only (parser untouched). Sanity
  on the BofA-modeled `06-tiered-ladder.html`: as-parsed it has no captured hold → chips read
  5% / 3.6% / 2% / 1.2% ROID; with the offer hold present (60d ≈ its days-31–90 window) they
  annualize to ≈30 / ≈22 / ≈12 / ≈7.3 %/yr — small tier ~4× the top, as expected. (The real
  BofA corpus post body isn't committed — copyright — so the synthetic fixture was the check.)
- **Gates:** `node --check` (extracted script) PASS; in-browser E2E on the owner's real
  state (deep-copied / snapshot-restored, sync unconfigured so local-only) — complete→feed
  excl+tombstone, un-complete→resurrect, byte-frozen baseline, linger today vs drop @8d,
  requirement write-through excludes from feed, reverse-channel apply+idempotent+absent-noop+
  req-routing+unknown-ignored, real delegated click persists `action_done`, greyed/struck
  render (opacity .6, line-through, green check), reload-survival, mobile 380px (grid
  `48px 190px 22px`, no h-overflow, control present on completable / absent on inflow),
  churn untouched, no console errors, At-a-glance fully gone. **[6]** legends computed
  `display:grid`, hero `113/111px` 2×3, timeline `78/88px` 2×2, col 2 at 131px at both 1280px
  and 380px, no overflow. **[7]** tier chips render the values above with no row overflow at
  380px; `testDocParserRegressions` 13/13; feed byte-identical (11 items / 0 removed / keys
  `id,kind,title,dueDate,notes`). Owner state restored to original 9811 bytes (`action_done`
  absent) after testing. `APP_VERSION` → 2026.07.08e.
- **DoC URL-importer live-test batch (still v2026.07.08e; owner deployed the Worker and hit
  real bugs).** Six items + a clawback-critical hold-anchor addendum. **[i1]** tier radio
  `align-items: center` (vertically centered vs the multi-line row body; verified centerOffset 0).
  **[i2]** waiver colon+bullets: `docBulletsAfterClause`/`docCapText` append a dropped bullet
  list ("… you must:" + `<ul>`) joined "; or ", cap ~260 — the owner's exact BofA waiver now
  captures all 3 conditions. **[i3]** `_docSetInput` capFirst on applied prose (`_docCapFirst`),
  EXCLUDING promo/URL/`<select>`-enum/machine tokens (promo `q3bus26` passes through). **[i4]**
  Worker gains additive `title` (`extractTitle`: og:title→`<title>`→`<h1>`, "- Doctor of Credit"
  stripped); client `docImportFetch` prepends `title` (or `_docSlugTitle(url)` at LOW conf for an
  OLD worker) when the body yields no bank/offer name, then adopts only the name fields. README
  changelog notes the redeploy. **[i5 + ADDENDUM — clawback]** the hold parser missed "days 31
  through **day** 90" and computed 60/funded (a ~30-day under-hold); now a day-span → `daysFundsMustRemain
  = Y` (through-day) + `lockStartsFrom='open date'`, matching corpus GOLD (`01.json` hold_days=90 =
  "total days from opening"). New `lockStartsFrom` `DOC_FIELD_MAP` entry; the tier ROI chip
  subtracts the deposit window for opening-anchored holds (90−30=60 → ≈30%/yr top). `plannedSignupDate`
  checked: it is the new-offer modal DEFAULT (`isoDate(addDays(TODAY,7))` → 7-15-2026), NOT written
  by the importer (absent from `DOC_FIELD_MAP`) — reported, not changed. **[i6]** "DoC ↗" link
  STACKS below the "Updated" stamp (`.offer-card-foot` column + `flex-end`; order `${stamp}${doc}`).
  Fixture 06 + `DOC_TEST_EXPECT['06']` (+harness copy) updated; `parser-loader` NEEDED list gained
  the 2 helpers.
- **Gates (importer batch):** `node --check` app + Worker PASS; Worker `extractTitle` unit 5/5;
  in-app `testDocParser` **67/67** (fixture 06 P12/F0) + `testDocParserRegressions` **18/18** (13+5);
  node harness (jsdom `--no-save`, not committed) fidelity **67/67** + regressions **18/18**; corpus
  score ≥84.9 **not runnable offline** (post bodies uncommitted, copyright) — but the change ALIGNS
  with gold (90/opening), so `daysFundsMustRemain` can only improve; capFirst/title/slug are outside
  `parseDocPost` (zero corpus effect). Preview E2E: [i1] radio center offset 0 (multi-line), [i2]
  waiver full 3-condition string, [i3] capFirst incl. promo passthrough, [i4] mock round-trip with
  title→bank+offer, without→slug bank at low-conf/unchecked, [i5] chips ≈30/22/12/7.3%/yr, [i6] foot
  column/flex-end/stamp-above-link. Feed byte-identical (11/0). 380px no overflow. git status scoped
  (index.html, cloudflare/{doc-import-worker.js,README.md}, docs/fixtures/{doc-samples/06,doc-corpus/harness/{fidelity-check,parser-loader}}.js, HANDOFF, CHANGELOG, SHORTCUT guide + 4 pre-existing + runs file).
- **Release-review fixes (1 P2 + 3 P3, all in the R70 new code; still v2026.07.08e).**
  **[P2]** `applyRemoteCompletions` dedup was a **lexicographic string compare** on
  `completedAt` — a malformed/far-future/offset value could lift the HWM above all real
  Z-timestamps and silently kill the channel, and backdated/offline-queued completions were
  dropped. Replaced the single HWM with a **bounded per-event ledger** (`_completionsApplied`,
  `id@epochMillis`, last 200): `Date.parse` epoch compare, NaN entries skipped + counted (a
  `console.warn` diag note, not an app error), each event applied once regardless of order,
  legacy `_completionsHwm` dropped on read; domain presence checks resist re-applying a locally
  un-done completion. **[P3-1]** `action_done` growth bounded — `computeReminderFeed` prunes keys
  not in the freshly BUILT id set (pre-exclusion, so done items' own ids stay) AND older than the
  90-day tombstone TTL (grace stops flicker-prune); orphaned-offer keys drop within one compute
  past TTL. **[P3-2]** reverse channel gates the `action_done` write on `ACTION_COMPLETABLE_KINDS`
  (kind from the built items by id) — a phone-completed commitment-end/inflow/outflow (or unknown)
  id is log-skipped, never suppressing its feed item. **[P3-3]** a BARE "days X through Y" (no
  opening-context in the sentence) no longer asserts `lockStartsFrom='open date'` at HIGH — opening
  cue → count=Y + open HIGH; bare span → count=Y HIGH but anchor LOW/default-unchecked (a bare span
  at the funded default over-holds, never under-holds). `testDocParserRegressions` gained a
  `wantConf` assertion + 2 bare-span pins (→ 20 pins). **Gates:** `node --check` app + Worker;
  harness fidelity 67/67 + regressions 20/20; reverse-channel unit passes hostile `completedAt`
  (malformed/far-future/offset/backdated) + non-completable + idempotency + un-do-resist +
  migration; P3-1 prune + P3-3 confidence verified; feed byte-identical (11/0); owner state
  untouched (9811 bytes). SHORTCUT guide Section I wording updated (per-event ledger, parseable
  `completedAt`, completability log-skip). git status still scoped (same file set).

### 2026-07-07 — Session (claude-opus-4-8, /orchestrate executor — owner UX batch)
**Round 69 — 13 owner UX items across the offer card, modal, overview & charts; v2026.07.08d**
(Two folded batches — items 1-6 below, then A-G. Single uncommitted release; version stays 2026.07.08d.)
- **[1] De-dupe requirement dates vs the legacy "Fund date."** `renderRequirementChecklist`
  now builds a `shownDates` set from the dates the card already prints ABOVE it —
  `lockStartDate` (Fund date), `withdrawalEligibleDate` (Withdrawal date), and each
  `directDepositEffectiveDate` (the `.offer-dds` block) — and a **derived** row whose
  computed deadline equals one of those drops its date suffix (row + done state still
  render). The legacy `.offer-dates` block keeps owner-preferred placement/format; the
  MODAL editing surface is untouched (keeps every "Due <date>"). Verified: BMO card shows
  the fund date exactly once; a synthetic offer with `daysAfter…Deposit=0` (deposit
  deadline == fund date) suppresses the checklist date, while a 30-day window still shows it.
- **[2] Clickable DoC link on the card.** New `offerDocLink(o)` renders a quiet "DoC ↗"
  (`--text-tertiary`, hover `--accent`) only when `offer.docUrl` is set — `target="_blank"
  rel="noopener"`, escapeAttr'd href, inline `stopPropagation`. Sits in a new
  `.offer-card-foot` shared right-aligned with the Updated stamp (wrapper omitted when both
  empty). Verified: click opens no modal, no bubble; absent when docUrl empty.
- **[3] More offer colors.** Appended 4 well-separated hues to `OFFER_COLOR_PALETTE`
  (12→16, order preserved): `green #16a34a`, `purple #9333ea`, `fuchsia #c026d3`,
  `magenta #ec4899` (label "Pink" — the `pink` key was already Cobalt). No brown, no
  near-duplicates; picker is data-driven so no other change needed.
- **[4] Tighten the "$"-to-digit gap (repeat request — finally landed).** `.field-box`/
  `.dd-row` prefix `margin-right` 4px→2px; base `.input-group .input` `padding-left`
  28px→24px. Measured (BMO modal): f-funding/f-bonus **4px→2px**, req-row amount **7.33px→3.33px**.
  No clipping/caret issues at desktop or 380px.
- **[5] Strip SUB amounts from displayed offer names.** New `displayOfferName()` strips a
  trailing `$N` (display-only) across **every user-visible name surface** — card subtitle,
  offers table, combo picker, Overview churn rows (`renderOverviewChurnSection`), hero-chart
  offer labels (`renderHeroChart`'s `displayName`), and the template picker row + delete/replace
  confirms. Stored `offerName` untouched, and **feed titles are left raw**: the shared
  `buildReminderItems` name builder (`nm`) stays raw so Shortcut matching / feed byte-identity
  hold — that is the one same-pattern helper deliberately NOT stripped (it feeds the feed, not a
  display; my first pass mislabeled it a churn helper and stripped it, then reverted). Import
  side: the DoC parser's offerName extraction strips trailing `$N` / `$X-$Y` / "up to $N" tails,
  with a new `testDocParserRegressions` pin (now 13/13). Verified: BMO stored
  `"Premier Checking $600"` → card/table/combo/churn/chart/template all render
  `"Premier Checking"`; feed still carries `"…$600"`.
- **[6] Requirements-row box alignment.** The modal's `.modal .input[type=number|date] {height:44px!important}`
  tap-target rule hit the req-row number inputs (no `.field-box` reset there), so the deadline "d"
  and count "×" boxes rendered 44px vs the 34px money box. Added a `.modal .req-row .input[type=…]`
  reset (34px, 6px vertical padding). Measured: deadline box **44px→34px**; every req-row control now 34px.
- **[A] Conditional "Closed date" field.** New `.yv-date` field by the status selects in the offer
  modal, shown iff `accountStatus==='closed' && !PRE_ACCOUNT_SUB_STATUSES.has(subStatus)` — the EXACT
  `reconcileClosedDate` stamp guard mirrored, so what's visible is what anchors churn. `refreshClosedDateField()`
  live-toggles it on status change (defaults today on a fresh flip-to-closed, still backdatable; clears the
  input when hidden so a stale date can't submit). `readOfferForm` reads `closed_date` BEFORE
  `reconcileClosedDate` runs, so a user value always wins (reconcile only fills a blank). Verified: backdate
  `2026-01-01` kept, blank→today stamped, `churnEligibleDate` computes `2026-07-01` from the backdate
  (null → needs-date state).
- **[B] Chart tooltip bank-only (repeat).** The hero "Available capital today" tooltip's per-offer rows now show
  BANK NAME ONLY — added `bankName: o.bankName` to the 4 offer markers and the tooltip renders
  `m.bankName || m.name || m.label` (events keep their name). Timeline tooltips were already bank-only
  (`r.label = o.bankName` on the row label + bar `title`). Verified: ambiguous-bank marker → tooltip "BMO".
- **[C] "Run again" on churn rows.** A quiet "Run again" button (sibling to Snooze) on eligible-now + upcoming
  rows → `churnRunAgain(id)` builds a seed via the exact template-Use pipeline
  (`templateToOffer(offerToTemplate(o))`) → `showOfferModal(null, seed)` with a `Re-run of <bank> — <stripped
  name>` notes line. Prior offer untouched; sibling structure means no row-nav bubble. Verified.
- **[D] Tighten chart-label gaps.** `.chart-legend` (shared by the hero AND timeline legends) went from a 2-col
  `1fr 1fr` grid (huge inter-column gap) to a `flex-wrap` row, `gap: 6px 14px` — comfortable adjacency,
  both charts consistent.
- **[E] Unified overview headers.** Removed the churn description line; the churn header now uses `.card-header`
  markup (like Upcoming actions), and `.overview-grid .card-header h2` is restyled to EXACTLY match the hero
  `.hero-label` (14px/600/uppercase/0.02em/`--text-tertiary`; 13px at mobile). Verified all three identical.
- **[F] Churn card = Upcoming-actions width.** Moved `renderOverviewChurnSection()` INTO `.overview-grid` with
  `grid-column: span 2` (matching `.overview-main`) so the two cards are same-width siblings (806px desktop,
  full-width ≤720/≤480). **Gotcha fixed:** the base `.churn-section{grid-column:span 2}` was declared AFTER the
  responsive `@media` overrides, so span-2 leaked into the mobile 1-col grid and spawned a phantom column
  (380px overflow); moved the base rule ABOVE the media queries so the overrides win in source order.
- **[G] Checklist checkbox alignment.** `.offer-req-item` `align-items: baseline → center` + dropped the
  `.offer-req-check` `margin-top:1px` — the checkbox now centers on its text line (measured offset 0).
- **Review fixes (1×P1 + 2×P2, index.html only):**
  - **[P1] Closed-date flap wiped backdates.** `refreshClosedDateField` used to CLEAR the input on hide and
    re-stamp today on re-show, so a Closed→Open→Closed toggle silently replaced a historical `closed_date`
    with today. Fixed by hiding via **`disabled` instead of clearing** — a disabled input is absent from
    FormData (stale date can't submit) but KEEPS its value, so the flap restores the backdate. Prefill
    precedence on an empty field: (1) the input's preserved value, (2) the offer's stored `closed_date`
    (`data-stored` attr), (3) today. Reopen→SAVE still clears: the disabled field is absent from FormData →
    `readOfferForm` sets `closed_date: dateIso(undefined) || null` → **null** (overrides the prior-offer spread,
    since `parseDateInput(undefined)===null`), and `reconcileClosedDate`'s close→open branch confirms the null.
    The `.yv-date` picker is delegation-based (`closest('.yv-date')`), so it still works once the field is
    re-enabled. Verified repro matrix: flap keeps `1-1-2026` (save→`2026-01-01`, churn→`2026-07-01`); fresh
    flip-to-closed still prefills today; reopen→save clears to null.
  - **[P2-1] docUrl scheme gate (XSS).** `offerDocLink` rendered any `docUrl` as an href and `escapeAttr`
    doesn't restrict schemes, so an imported `javascript:`/`data:` docUrl became a working XSS link. Now the
    link renders ONLY when `docUrl` matches `/^https?:\/\//i` (else nothing); a commented security invariant
    marks the guard. Verified: `javascript:`/`data:`/mixed-case → no link; http/https → link.
  - **[P2-2] Name-strip gaps.** `displayOfferName()` now also applied at: (a) `convertOfferToCommitment`
    `commitmentName` (build-side), (b) `renderCommitmentsTable` name cell (render-side, covers legacy stored
    names), (c) the capital-event "Linked offer" `<option>` labels — the Name autofill reads the option's
    `textContent`, so that one edit covers both the dropdown and the auto-filled event Name. Feed stays raw.
    Verified BMO: convert→commitment `"BMO — Premier Checking"`, all dropdown labels + autofill amount-free.
- **Gates (both batches):** `node --check` (extracted inline JS) clean; preview E2E each item + console clean;
  feed code path untouched (no diff hunk in `computeReminderFeed`/`buildReminderItems`) and, after removing
  the in-memory test-churnable offer, the feed returns to baseline (no `churn-eligible` delta); 380px full pass,
  no horizontal scroll. Test offers were in-memory only (never `App.update`d), so storage/feed are pristine.
- **Pending:** working-tree changes for the planner to review/commit (do not self-commit).

### 2026-07-07 — Session (claude-opus-4-8, /orchestrate — parser-calibration run)
**Round 68 — DoC parser calibrated against a real 31-post corpus; tier-aware parsing + tier picker; v2026.07.08c**

The overnight orchestrated run `2026-07-07-doc-parser-calibration` (planner fable,
executor opus, worker sonnet). R66's `parseDocPost` had shipped validated against
only 5 synthetic fixtures; the owner flagged two real failure classes — tiered
offers (BofA "up to $2,500" where the true ladder is in the body) and stale
values in living posts — and explicitly challenged whether our accuracy stats were
fabricated. This run built the evidence to answer that.

- **Corpus (do not re-harvest).** 31 real DoC posts (BofA tiered post + recent
  bank-account-bonus posts, nationwide- or WI-eligible only) live as **facts** in
  `docs/fixtures/doc-corpus/`: `manifest.json` (32 rows incl. the 1 body-confirmed
  exclude), `excluded.json`, `labels/gold/NN.json` (31 gold labels) +
  `_adjudication.md`, and `harness/` (the scoring scripts). **Post bodies are NOT
  committed (copyright)** — re-hydrate with `harness/fetch-posts.js` (reads the
  manifest) or Save-Page-As. A `.gitignore` makes an accidental `git add posts/` a
  no-op.
- **Gold labels = 3 independent labelers + adjudication.** 79.2% raw inter-rater
  agreement on 6 double-labeled posts (worst post 16 @ 50%); conventions resolved
  in `_adjudication.md` (tiered bonus = the max tier a careful churner reaches;
  stacked/affiliate totals unified; availability drift honored, e.g. Wings/BMO now
  nationwide despite stale title tags). Labels are fallible human reads — the
  honest-limits note is in the verification-log + corpus README.
- **Parser fixes (4a, commit `eedb027`).** `docScanTiers` (top-level `tiers[]` on
  10 posts, BofA ladder complete, glance "up to" forced low + `tiered` flag);
  `docDateSegments`+`docReconcileScalar` (newest-dated-segment-wins per FIELD,
  undated fine print keeps confidence); `docIsCardFundingLabel` (kills the #1 bug —
  "Credit card funding" glance row mis-read as funding, 11/11→0); keyed-phrase
  `docChurnAnchor`; year-in-date guard (kills "2026→$825"). Loader helper names
  are listed in `harness/parser-loader.js` `NEEDED[]` — **add new parser helpers
  there or the brace-match extraction misses them.**
- **Preview tier picker (4b, commit `0126e2a`).** ≥2 tiers → a radio "Select your
  tier" group (none pre-selected, nothing auto-applies); `_docEffectiveFields`
  resolves render+Apply; balance kind forces funding=threshold + keeps
  maintain-balance row; `dd_total` kind wires the legacy DD model via
  `_docWireDdModel`; user checkbox choices survive tier switches
  (`_docUserChecks`/`resolveChecked`). Non-tiered pastes render byte-identical.
- **Verbatim numbers (do-not-redo the residuals).** `verification-log.md` has the
  machine output: accuracy **73.4→84.9%**, recall **57.8→70.7%**, high-conf-wrong
  **26→2**, calibration un-inverted (high 96.7% > med 87.1%), fidelity 63/63,
  regressions 12/12, parity 55/55. The final is **84.9% not 85.4%**: three later
  same-segment/negation/segmentation fixes (from an adversarial Codex review)
  corrected behavior that posts **[06]/[16] had been passing by ACCIDENT of a bug**
  — recovering those 2 cells means reverting the correct fix, so the planner
  accepted 84.9% (correctness over the ≥85 vanity threshold; every dangerous metric
  held). **The two surviving high-conf-wrongs are intentional** and must not be
  "fixed" naively: **[05]** glance "Monthly fees: None" (unconditional) vs a body $5
  fee, and **[10]** a stale glance expiration vs a body app-window date — promoting
  body over glance here over-fits and breaks fixtures 06/28 (the over-fit guard).
- **Three Codex adjudications this run**, all reproduced + fixed: (1) reduction-verb
  bonus ("lowered to $250") must beat the `Math.max` extractor — fixture 07 had
  masked it via a different path; (2) DD negation-before-affirm ("Not required"); (3)
  glance heading = a segment boundary resuming the undated base (BofA glance was
  being swallowed into the oldest dated segment). Net −1 cell, on the record.
- **Future sessions:** the gold corpus + `verification-log.md` + `harness/` are the
  regression bed for any future `parseDocPost` change; `testDocParserRegressions()`
  (12 pins, in-app) is the fast in-browser check. jsdom is a **verify-time** tool
  (`npm i --no-save jsdom`), deliberately NOT a repo dependency.
- **This step (5):** persisted the artifacts + docs + `APP_VERSION`→`2026.07.08c`;
  backfilled the two stale CHANGELOG `_pending_` commit fields (churn→`6b101bd`,
  bonusflow→`46c0c49..c2aa49d` pushed as `7c06e5f..c2aa49d`). Planner commits/pushes
  after review — 4a/4b already committed; this step's files are working-tree.

### 2026-07-07 — Session (claude-opus-4-8, /orchestrate executor — churn tweaks)
**Round 67 — Churn window shortened + churnability snooze**

Two owner-requested changes on top of R66's churnability feature.
- **Churn window 90 → 60.** `CHURN_HORIZON_DAYS` (index.html ~line 5674) is now
  60 (owner: "Make the churnability window 60 days"). This governs ONLY the
  Overview "Upcoming" bucket; the feed's `CHURN_FEED_LOOKAHEAD_DAYS` was already
  60 and the 180-day past-grace constant is untouched.
- **Churn snooze** (owner: "snooze option … with option for snooze to be
  indefinite"). New per-offer `churn_snoozed_until: ISO | 'forever' | null`
  (default null) in `schemaV2Defaults()`. Snoozed = `'forever'` OR an ISO strictly
  after today (a lapsed timed snooze reads as unsnoozed — the comparison handles
  expiry, no cleanup migration). New pure `churnSnoozeActive(offer)` is the single
  reader for all three surfaces. **Deliberately NOT in `TEMPLATE_TERMS_KEYS`** —
  personal state must never travel into a template; the whitelist excludes it by
  construction (the harness asserts a real `offerToTemplate` strip omits it).
  - *Overview section:* snoozed offers drop out of both buckets; each visible row
    gets a subtle "Snooze" affordance (inline expanding menu, no modal: **30 days
    / 90 days / Indefinitely** → today+N ISO or `'forever'`); a bottom muted
    "N snoozed — show" reveal lists snoozed rows ("Snoozed until <M-D-YYYY>" /
    "Snoozed indefinitely") each with **Unsnooze**. Render gate is now ≥1 visible
    row OR ≥1 snoozed (reveal stays reachable); hidden only when neither.
  - *Card churn line:* while snoozed appends a muted one-line suffix — "eligible
    now — snoozed" / "eligible <date> — snoozed until <date>".
  - *Feed:* `churn-eligible` is suppressed while snoozed (disappear/reappear
    rides the existing `_feedEmitted`/`_feedRemoved` tombstones — snooze →
    `removed[]`, unsnooze/lapse → resurrects). Feed-contract comment +
    `docs/SHORTCUT_BUILD_GUIDE.md` Finding 9 note the suppression.
- Persistence rides the existing `App.update` save path (debounced Gist push).
  New onClick handlers: `churn-snooze-toggle`/`churn-reveal-toggle` (local DOM,
  no re-render, mirror `toggleTemplatePicker`) and `churn-snooze`/`churn-unsnooze`
  (App.update). `APP_VERSION` `2026.07.08a` → `2026.07.08b`.
- **Verification:** `node --check` clean; a 42/42 Node VM harness (snooze-state
  null/lapsed/future/'forever' × eligible-now/upcoming/none, template whitelist
  exclusion, horizon-60 boundary 59d shown/61d not); Preview scenarios all green.
  DO NOT COMMIT — planner reviews then commits.

### 2026-07-07 — Session (claude-opus-4-8, /orchestrate step 11 — verification + docs)
**Round 66 — Bonusflow run verification, documentation & version bump**

Final step of the overnight `2026-07-07-bonusflow` run (steps 2–10 shipped the
features locally, `46c0c49`→`f336a2e`; baseline tag
`checkpoint-2026-07-07-pre-bonusflow`). This step ran the full verification
battery, wrote the four doc updates, and bumped `APP_VERSION`
`2026.07.07b` → `2026.07.08a`. No feature code changed here; the only
`index.html` edit is the version constant (~line 2764).

- **What the run shipped** (verified this step): schema v2 + one-time migration
  (`migrateOffersToSchemaV2`, derives `requirements[]` from legacy fields,
  seeds v2 scalars, snapshots `yv-backup-pre-v2`, idempotent) + Settings restore
  button; the requirements engine (modal rows with per-type money/count inputs,
  forward+reverse write-through, card checklist with done-toggle + strikethrough
  + resort, `requirement-deadline` feed kind); the derived 4-stage lifecycle
  pipeline (`meeting→waiting→earned→closed`) with expected-bonus window +
  `safeToCloseDate` + `expected-bonus-window`/`safe-to-close` feed kinds and the
  "mark waiting" auto-suggest; churnability (`churnEligibleDate`, 3 anchors,
  clamp-safe month math, overview "Upcoming churn dates" section, `churn-eligible`
  feed kind); DoC paste import v1 (glance parser + preview/confirm, 5 fixtures);
  gated v2 URL-import Worker scaffold (`cloudflare/`, Settings-gated); offer
  templates (whitelist strip, searchable picker); freshness chips + 4-mode sort
  + updated stamp + monthly-fee detail; aesthetics sweep.
- **Verification results:** `node --check` on the extracted inline JS + on
  `cloudflare/doc-import-worker.js` both clean. Preview (`yield-vector-static`,
  4173): console clean on load + across all 5 views. Migration: legacy-shaped
  state → offers migrated, backup created, second reload byte-identical
  (double-migrate diff = 0), restore round-trips + re-migrates. Feed contract:
  envelope EXACTLY `{schema:2, generatedAt, manifestVersion, feedStatus,
  lastGoodGeneratedAt, items, removed}`, every item EXACTLY `{id,kind,title,
  dueDate,notes}`, manifestVersion strictly monotonic across 3 computes, kinds ⊆
  the 9 pre-run + 4 new, each new kind emits only under its documented condition,
  tombstones appear in `removed` (reason `superseded`) on trigger-removal and
  clear on re-trigger. `testDocParser` 44/44 across all 5 fixtures; E2E paste
  fixture 03 → preview → apply → save verified; garbage graceful; >200KB
  truncation notice present. Churn: 3 anchors + Jan-31/leap/Aug-31 month-end
  clamp all correct. Templates: both save entry points, dedupe confirm-replace,
  picker search (incl. no-match), Use→prospect→save, delete→affordance-hides,
  DoC-checkbox path; saved-template JSON carries ZERO personal keys. Cross-cutting:
  localStorage keys unchanged except the documented `yv-backup-pre-v2` (docWorker
  URL/secret ride inside the existing sync-config key, device-local); ZERO
  external network on load (only same-origin `dd-methods.json`); mobile 380px —
  every view + the offer modal, no horizontal scroll.
- **Fixed during verification (do-not-redo context):** the INLINE offer-card
  "Offer status" dropdown handler (`onChange` `change-status`, ~line 12359)
  originally set `subStatus` + `accountStatus` + `normalizeOfferStatus` but did
  NOT stamp/clear `closed_date` the way the modal save path does — so a
  card-dropdown close left `closed_date` null (undated "Account closed."
  caption; an `account_closed`-anchored churnable offer couldn't compute
  eligibility until re-saved via the modal). Fix shipped in this run: the
  stamp/clear logic was extracted into a shared `reconcileClosedDate(offer,
  priorAccountStatus)` helper (~line 5529) called by BOTH the modal save path
  (`readOfferForm`) and the inline handler — do not reintroduce per-path copies;
  any new status-mutation path must call the same helper. Verified live:
  dropdown close stamps today, dropdown reopen clears, modal path unchanged.

### 2026-07-06 — Session J continued (claude-fable-5, planner direct fix)
**Round 65 — Uppercase-label letterspacing normalized app-wide (owner re-report)**
- R62's tightening only hit `.hero-label` + `.timeline-row-label.axis`; the owner still saw wide labels because the rest of the uppercase micro-label family (`.stat-label`, `.offer-stat-label`, `.snapshot-title`, `.card-title`, optimizer/about/DD labels — 15 rules at 0.04–0.06em) kept their old spacing. All letter-spacing 0.04/0.05/0.06em → 0.02em (18 rules now uniform; negative heading spacings and `.diag-code` untouched; chart text is SVG-internal, unaffected). Verified at desktop width on Overview + Timeline. `APP_VERSION` → `2026.07.07b`.

### 2026-07-07 — Session (claude-opus-4-8, /orchestrate executor)
**Round 64 — Status-model & form changes: sign-up-date-when-open, subStatus auto-revert, "Offer status" rename, debit day-count, "sign up" wording (Phase 1b)**

Owner batch of five app changes + a docs refresh, kept coherent with Phase 1a
(shared `buildReminderItems`, feed v2, subStatus-keyed gates). Scope: `index.html`
+ `docs/SHORTCUT_BUILD_GUIDE.md`. No chart/tooltip/legend changes; Gist payload
additive. `APP_VERSION` 2026.07.07 → 2026.07.07a.

- **[1] Sign-up date required only when account is OPEN.** `isOfferComplete`/
  `offerIssues` (~line 4457/4485) now require `plannedSignupDate` iff
  `accountStatus === 'open'`. A prospect/applied (closed) offer is a full
  non-draft offer WITHOUT a date — it emits no dated work items and ties up no
  projected capital (projection loop already `continue`s on empty
  `lockStartDate`; swept every date consumer — projection, suggested-funding,
  chart markers, timeline, table, ROI, feed builder, upcoming list — all
  null-safe → no "Invalid Date"/"NaN"), but its expiry still surfaces. Other
  missing required fields still draft the offer.
- **[2] accountStatus auto-reverts to Closed** (mirror of the existing
  auto-open). Both the modal `change` handler (~line 7757) and the inline
  change-status handler (~line 8700) now set `accountStatus` via the shared
  `defaultAccountForSub(subStatus)` — open for the 5 in `SUBSTATUS_FLIPS_OPEN`
  (approved/on-track/met-waiting/earned/didnt-track), closed for the other 4
  (prospect/applied/denied/archived). Modal hint describes both directions.
- **[3] "Sub status" → "Offer status"** (modal label + hint, offers-table
  header, inline-select `title`). Identifiers (`subStatus`, ids) unchanged. The
  commitments-table "Status" column is a DIFFERENT field — left alone.
- **[4] Debit "Complete by" date → day-count.** `debitRequirement.byDate` date
  picker replaced by "Complete debits within X days of sign up"
  (`name="debitWithinDays"`, id `f-debit-within`), with a derived-deadline hint
  (`f-debit-deadline`) beneath once a sign-up date exists. New `debitDeadlineISO`
  (~line 4321, after `depositDeadline`) = sign-up + `withinDays`, literal
  calendar date. Migration on load: `migrateDebitRequirement` +
  `reconcileDebitWithinDays` (~line 2606, called next to `migrateDdIds` in
  `App.init` ~line 4162) convert legacy `byDate` → `withinDays =
  max(1, round(byDate − signup))`, stashing the original in `byDateLegacy`
  (never lost); no signup date → preserve `byDateLegacy`, derive `withinDays`
  lazily when a date appears. Feed/list/card debit-deadline derivation switched
  to `debitDeadlineISO` (emits nothing when underivable). `readOfferForm` reads
  `withinDays`, carries `byDateLegacy` forward on edit, retires `byDate` to `''`.
  US-Bank-style (count, no byDate) → new field empty, no deadline until filled.
- **[5] "signup" → "sign up"** in user-facing text ("Planned sign up date *",
  "Sign up date *", "Days after sign up to deposit", "Complete DDs within X days
  of sign up", "Complete debits within X days of sign up", "Sign up date
  required"). Code identifiers (`plannedSignupDate`, `f-signup`, etc.) unchanged.
  Comments left with prose "sign-up" (not user-facing).
- **[6] Docs — `docs/SHORTCUT_BUILD_GUIDE.md`.** Compatibility note rewritten:
  schema 2 is the LIVE feed (v2026.07.07), Section F tombstone deletes are live,
  only `risk` remains absent (skip steps 23/25 until it ships). Section F
  reworked: RECOMMENDED unattended path marks tombstoned reminders COMPLETE
  ("Edit Reminder" → Is Completed = true, no prompt, completed items leave the
  default view); actual "Remove Reminders" deletion demoted to optional manual
  **F′** cleanup (steps renumbered 44→57; Finding 5 + corrections table updated).
- **Follow-up fix + display-value sweep (coordinator-requested).** Fixed a
  latent R62 bug: `refreshFundingSuggest` (~line 7893) passed `#f-signup`'s
  M-D-YYYY DISPLAY value straight to `suggestedFundingDate` (expects ISO), so
  the "Latest safe funding" hint silently stopped live-updating after R62 added
  display formatting — now wrapped in `parseDateInput(...)`, null-safe, exactly
  like `refreshDebitDeadline`. SWEPT every `.value` read in the file for the
  same class (yv-date display → ISO-expecting fn, or money display → Number-
  expecting fn without `parseDateInput`/`parseMoneyInput`): line 7893 was the
  ONLY remaining offender. All other live/handler read sites already route
  correctly — `generateDdDatesFromRequirement` (`parseDate(parseDateInput(...))`
  + `parseMoneyInput`), `readDdRowsFromForm`, settings `onChange` (money →
  `parseMoneyInput`, else `type=number`), the event-modal live sign-flip
  (`parseMoneyInput`), the blur normalizer, and `reformatMoneyFieldLive` (pure
  display) — plus the two inline `onchange`s just set static label text. The
  `#f-days-deposit`/`#f-debit-within` fields are `type=number`, so their raw
  `.value` is correctly consumed as a number. [3] The `DatePicker.setValue`
  commit path (~line 3917) ALREADY dispatches `input`+`change` on the input, so
  picker selection drives both hints with no code change — verified live rather
  than assumed.
- **Verified:** `node --check` passes; locked hex counts identical to HEAD
  (9/4/9/9/1/4/1/1/1). Node VM harness on the real extracted functions: 36/36
  (9-value classification; undated-prospect complete-but-dateless vs undated-open
  incomplete; undated offer emits expiry-only, no malformed dates;
  `debitDeadlineISO` 7-13-2026 + 45 → 8-27-2026; feed debit-deadline 2026-08-27;
  byDate→withinDays migration incl. min-1 floor + idempotency + US-Bank empty).
  Live (Preview `yield-vector-static`, port 4173): "Offer status" label + both-
  directions hint; modal subStatus drives accountStatus live BOTH ways with the
  sign-up label following; debit day-count field present (old date field gone),
  derived hint "Complete by: Aug 27"; real create→save persists a dateless
  prospect as a full non-draft card (expiry shows, no NaN) contributing 0 to
  "Actions required" but present in the Upcoming list; edit→Approved + 8-1-2026
  stores ISO. Follow-up-fix re-verify: with signup TYPED as 7-13-2026 + 30 days
  the funding hint now shows "Latest safe funding: Aug 11" (was silently blank
  pre-fix); selecting 7-13-2026 via the DATE PICKER refreshes BOTH the funding
  ("Aug 11") and debit ("Complete by: Aug 27") hints. Zero console errors; owner
  state (7 offers, original `_lastModified`/`_dirtySince`) restored byte-for-byte.

### 2026-07-07 — Session (claude-opus-4-8, /orchestrate executor)
**Round 63 — Reminder-feed contract v2: one shared item-builder, coverage + gate fixes, tombstones (Phase 1a)**

Phase 1a of the reminders redesign (feed contract v2 + step-3 P1). Scope was
`index.html` plus doc updates; no chart/tooltip/legend changes; Gist payload
kept additively compatible (new fields on offers/DDs only).

- **One shared builder.** New `buildReminderItems(state)` (~line 5293) is the
  SOLE source of every actionable date. `computeReminderFeed`,
  `computeUpcomingActions`, and `computeActionsRequired` were all rewritten to
  consume it, so the machine feed, the overview list, and the headline count
  can never drift apart again. Reconciliation invariant (stated inline):
  count = the builder's `isWork` items regardless of horizon; list = every
  builder item within the 90-day horizon (the list keeps its horizon by
  design; the feed emits all future items, no horizon).
- **Feed contract v2.** `_feed` is now `{ schema:2, generatedAt,
  manifestVersion, feedStatus:'ok'|'stale'|'error', lastGoodGeneratedAt,
  items:[{id,kind,title,dueDate,notes}], removed:[{id,tombstonedAt,reason}] }`.
  `risk` deliberately OMITTED (later phase). `manifestVersion` is monotonic:
  `max(prev+1, minutes-since-epoch, sessionHWM+1)` where the session
  high-water mark (`_manifestHwm`, seeded on load from `_manifestVersion`)
  guarantees no regression even when restore-from-history swaps in an old
  snapshot — this was a real edge case the plain `max(prev+1, epochMin)`
  formula missed within a single minute; the HWM term fixes it.
- **Stable per-DD ids.** DD rows carry a persisted `id` minted at row
  creation (`readDdRowsFromForm`/`addDdRow`/`generateDdDatesFromRequirement`
  now thread it via a `data-dd-id` attribute) and back-filled on load by new
  `migrateDdIds` (called next to `normalizeOfferStatus` in `App.init`).
  Per-DD feed items key `yv-<offerId>-dd-<ddId>` — never array index.
- **Coverage** now emitted consistently by both feed and list: offer-expires,
  deposit-deadline (fund-a-lump types only — NOT standard `direct-deposit`),
  dd-initiate (one per future planned DD), dd-window-end (frequency mode →
  signup + periods×period incl. `2weeks`; count mode → last DD effective
  date), debit-deadline (from `debitRequirement.byDate`), withdrawal/
  lock-release, commitment-end, inflow/outflow (respecting `showInUpcoming`;
  recurring events surface their next instance).
- **Gate fix (step-3 P1).** Both surfaces key on the MODERN `subStatus`
  fields, not the legacy `deriveLegacyStatus` shadow. The legacy map sends
  approved→'funded', which hid funding deadlines the instant an account
  opened. New rule: offer-expires shows for ALL non-terminal offers,
  INCLUDING scenario-excluded prospects (see review fix 4 below); work items
  (deposit/dd/debit) emit only for committed offers (approved/on-track),
  met-waiting excluded (work done); withdrawal shows while capital is live
  (approved/on-track/met-waiting, so a met-waiting offer keeps its release
  date). Legacy-status reads are gone from these functions;
  `deriveLegacyStatus` itself is UNTOUCHED (R38 shadow stays elsewhere).
- **Count semantics (owner decision).** `computeActionsRequired` counts work
  items only for committed offers, and only those due TODAY-or-later (past-due
  drops — see review fix 1); prospects/applied contribute ZERO (their
  expiries still show in the list).
- **Tombstones.** Deleting an offer/commitment (or an item that permanently
  disappears) moves its id to `removed[]` with a `reason`
  (`offer-deleted`/`commitment-deleted`/`event-deleted`/`superseded`),
  retained a fixed 90-day TTL. `state._feedEmitted` (id→ownerId) tracks
  previously-emitted ids to detect disappearances; a tombstoned id that
  re-appears is resurrected (tombstone dropped). Ack-based retention is a
  later phase.
- **No silent feed failure.** The `try{}catch{}` around feed computation in
  `Sync.push` and `createGist` is replaced by `computeFeedSafely`, which logs
  via `ErrCode.RENDER` (ctx `'reminder-feed'`) and reuses the last good feed
  marked `feedStatus:'stale'` (or a minimal `'error'` envelope when there is
  no last-good) rather than shipping absent/stale silently.
- **Docs.** `SHORTCUT_SETUP.md` gets a deprecation banner pointing to the v2
  build guide; `APP_VERSION` 2026.07.06e → 2026.07.07.
- **Review fixes (independent adversarial pass, all applied + re-verified).**
  (1) `computeActionsRequired` dropped past-due work items — a committed offer
  past its funding date was count 1 / list 0; now 0 / 0. (2) deposit-deadline
  was spuriously emitted for standard `direct-deposit` offers (no lump sum);
  now gated to "not `direct-deposit`" — NB gated as NOT-direct-deposit, not an
  allow-list, because the seed/legacy offers carry an ABSENT `offerType` that
  the app treats as new-funds-held, and an allow-list wrongly dropped US
  Bank's deposit-deadline (caught by re-running the seed reconciliation). (3)
  `ddWindowEndDate` fell through to the month branch for the UI's `2weeks`
  option (signup 7-10 → wrong 10-10); added the biweekly branch → 8-21. (4)
  offer-expires now bypasses the `offerIsActiveForProjection` gate so a
  scenario-excluded prospect's expiry still shows (the owner's BMO is exactly
  this: prospect + `includeInScenario:false` + a near expiry that would
  otherwise vanish). This raised the sample-seed list from 6 → 10 rows.
- **Verified** via `node --check` (extracted script), a Node VM harness running
  the real functions against the sample seed + synthetic offers (14/14 fix
  assertions pass), and the live app (Preview MCP, port 4173): sample seed
  (TODAY 2026-07-06) renders Actions-required **1** vs Upcoming **10 rows**
  (2 pages of 6), reconciling (US Bank's deposit-deadline 2026-07-11 —
  formerly hidden by the legacy gate — is the one work item, present in both;
  the list now also shows the four previously-hidden excluded-prospect
  expiries PNC/Chase/BMO/HSBC + Citi's, Charles Schwab's 11-03 beyond the 90d
  horizon); `_feed` is schema 2 with correct kinds/ids and no `risk`; deleting
  US Bank tombstones its 2 ids as `offer-deleted`; a synthetic committed
  standard-DD offer emits DD items only (no deposit-deadline, count 2), a
  held-and-dd keeps its lump deposit-deadline, a biweekly window-end computes
  8-21, and prospect/met-waiting variants gate to expiry-only / withdrawal-only.
  Locked hex counts identical to HEAD.

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
