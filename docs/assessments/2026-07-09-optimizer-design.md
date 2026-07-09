# Optimizer Design — Semantic Contract

**Run:** 2026-07-08-planner-optimizer · **Step 1 (executor), amended after the
Step 2 plan gate.** This document is the binding semantic contract for the
sequencer engine (`js/optimizer-engine.js`, step 3) and the Plan-tab UI
(step 4). It is grounded in verified reads of the shipping code; every factual
claim about existing behavior carries a `file:line` citation checked against the
source. The citations in this revision were re-verified against **HEAD
`bee6009`** (2026-07-08) — the modules the engine builds on (`offer-model.js`,
`projection-optimizer.js`, `requirements-templates.js`, `reminders.js`,
`dd-widgets.js`, `events-actions-data.js`, `modals-forms.js`) are byte-stable at
these lines since the doc's original commit `0f0194c`.

> **Revision — Step 2 gate fold (run 2026-07-08-planner-optimizer, step 2).**
> The Step 2 gate returned **needs-revision** (7 P1 / 4 P2 / 2 P3). Every finding
> is folded below as a **binding, re-verified amendment** — the affected section
> is rewritten so the doc reads as one contract, not an append-only errata. See
> **§12 Gate record** for the finding→disposition table and the two adopted
> architecture decisions (§11.1 config-threading + pure core; §11.2 pre-engine
> C2/C3 hotfix). The gate also caught one material misread in the original §3
> (it cited `deriveRequirementsFromLegacy` as if it *validates* DD count/cadence
> — it only materializes display rows); §3 is rewritten accordingly.

All **Plan-gate amendments P1-1 … P3-4** (checkpoint §"Plan-gate amendments") and
all **Step 2 gate findings** are folded here as hard requirements and
cross-referenced inline as `[P#-#]` / `[G-P1-#]` / `[G-P2-#]` / `[G-P3-#]`.

> **Terminology.** "Active offer" = an offer counted in the projection under the
> normal rules: `offerIsActiveForProjection(offer)` with no override
> (`js/offer-model.js:522`) → confirmed (`applied`/`funded`) unconditionally, or
> `prospect`/`selected` with `includeInScenario` true. "Candidate" = an offer the
> engine may add to or slide within a plan. "Plan" = a chosen include-set + a
> co-scheduled date assignment for every included offer.

---

## 0. Contradictions found vs. checkpoint assumptions (READ FIRST)

Finding these now is the purpose of this step. Three are latent bugs in the
**shipping** optimizer, not merely future risks:

| # | Severity | Finding | Evidence |
|---|----------|---------|----------|
| C1 | **High** | `generateProjection(state,…)` is **not pure**: it accepts a `state` arg, but its DD legs call `ddRoundTrip(dd)` → `ddTransferConfig()` which reads **`App.state.settings.ddTransfer`** — the *live* store, not `state.settings.ddTransfer`. Passing a self-contained snapshot does **not** control DD timing. `[P1-2]` is therefore not just "inject ddTransfer" — the projection path must be **config-threaded** or the engine cannot faithfully evaluate ddTransfer variants. | `js/projection-optimizer.js:153` → `js/dd-widgets.js:18,21,4-5` |
| C2 | **High (shipping bug)** | The existing `runOptimizer` drops **confirmed** offers during evaluation. It builds `includedIds` from candidates only (`prospect`/`selected`), then passes them as `includedOfferIds`; `offerIsActiveForProjection` returns *only* the override set (`js/offer-model.js:526`), so `applied`/`funded` offers with no manual commitment vanish from the capital model → feasibility is **over-optimistic**. This is exactly the `[P1-1]` pitfall, already live. | `js/projection-optimizer.js:330-361`, `js/offer-model.js:526` |
| C3 | **High (shipping bug)** | `effectiveHorizonDays` 'auto' hard-clamps to **180 days** (`Math.min(180,…)`) and considers only the *currently* active set (`offerIsActiveForProjection(o)` with **no** override, `:59`). Evaluating a candidate whose withdrawal/qualification lands past the current horizon truncates the projection (`applyCommitment` clamps to `horizon`, `:116-119`) → feasibility misjudged and late qualification unvalidated. Confirms `[P1-5]`. | `js/projection-optimizer.js:39-70,73,116-119,304-307` |
| C4 | Medium | `withdrawalEligibleDate` (DD), `ddCapitalTime`, and `annualizedReturn` **also** transitively read `App.state.settings.ddTransfer` via `ddRoundTrip` — so the tie-break objective silently depends on live settings too. Any function the engine borrows from `offer-model.js` for DD offers must receive the injected config. | `js/offer-model.js:58,400,446` → `js/dd-widgets.js:4-5` |
| C5 | Medium | Churn value-date trap: `offerToTemplate` stamps a **fresh** `savedAt` on every call (`:392`) and `templateToOffer` sets `last_edited:null` (`:468`). So the synthesized candidate carries no usable provenance date — the value date in `[P2-1]` must be read from the **source** offer's `last_edited` (or a *stored* template's `savedAt`), never from the freshly-synthesized object. | `js/requirements-templates.js:392,468` |
| C6 | Low | Feed nuance: work-item feed emission gates on the offer being **committed** (`js/reminders.js:121,137,173,203`), **not** on `includeInScenario`. Applying a plan that only toggles `includeInScenario`/dates on `prospect` offers moves no work-item feed items until the offer is actually committed. The apply-flow tombstone analysis (§8) must not assume date slides emit/retract feed items for prospects. | `js/reminders.js:86-94,119-121,137` |
| C7 | Low | `generateProjection` writes `window._horizonDebug` (side effect, guarded by `typeof window`). The pure engine must not depend on or replicate this. | `js/projection-optimizer.js:66` |

**Net design consequence:** the engine cannot simply call the existing
`generateProjection` / `withdrawalEligibleDate` / `annualizedReturn` for
evaluation. Step 3 must either (a) refactor `ddRoundTrip` to
`ddRoundTrip(dd, ddTransferCfg)` with `ddTransferConfig()` remaining the default
only for UI callers, and thread a projection variant that takes an explicit
`ddTransfer` + explicit `horizon` + explicit evaluated-set; or (b) re-implement
the pure projection kernel inside the engine from the injected snapshot. **This
doc specifies option (a)** (minimal duplication, one source of truth for the day
model) — see §7.

---

## 1. Decision variables `[P1-3]`

Two axes: **inclusion** (per candidate: in/out) and a **co-scheduled date group**
per included offer. Sliding `plannedSignupDate` alone is invalid — the cash curve
keys off funding and DD dates, which derive from the group.

### 1.1 The date group

| Variable | Field | Notes |
|----------|-------|-------|
| Sign-up / open date | `offer.plannedSignupDate` | Anchor for expiry, deposit deadline, debit deadline, requirement deadlines; also the hold anchor when `lockStartsFrom === 'open date'`. User-entered dates stay as-is; only *derived* dates business-day-shift (`js/offer-model.js:16-26`). |
| Funding date (optional) | `offer.optionalPlannedFundingDate` | `effectiveFundingDate = optionalPlannedFundingDate \|\| plannedSignupDate` (`js/offer-model.js:9-14`). Required for `held-and-dd` (`js/offer-model.js:491-492`). |
| Per-DD initiation | `offer.directDeposits[i].plannedDate` | Free variable within the DD window; drives round-trip dollar-days. Preserve `directDeposits[i].id` (see §8). |

### 1.2 Derived dates (NOT free — recomputed from the group)

| Derived date | Function | Formula (verified) |
|--------------|----------|--------------------|
| Lock start | `lockStartDate` | DD → `min(dd.plannedDate)`; held/new-funds → `bizDayISO(effectiveFundingDate)` (`:78-97`). |
| Withdrawal-eligible | `withdrawalEligibleDate` | DD → `max(ddRoundTrip.returnDate)`; held → `bizDayISO(anchor + daysFundsMustRemain)`, `anchor = plannedSignupDate` if `lockStartsFrom==='open date'` else `bizDayISO(effectiveFundingDate)` (`:50-76`). |
| Deposit deadline | `depositDeadline` | `plannedSignupDate + daysAfterSignupAllowedBeforeDeposit`, **literal** (no biz shift) (`:28-33`). |
| Debit deadline | `debitDeadlineISO` | `plannedSignupDate + debitRequirement.withinDays`, literal; `''` unless required & dated (`:40-48`). |
| Requirement deadline | `requirementDeadlineISO` | `plannedSignupDate + row.deadline_days`, literal (`js/requirements-templates.js:90-97`). |
| DD round-trip | `ddRoundTrip` | `initiate → post(+inDays biz) → returnInitiate(+seasonDays biz) → returnDate(+backDays biz)`; `heldDays = daysBetween(initiate, returnDate)` (`js/dd-widgets.js:18-27`). Config from `ddTransfer` **[C1]**. |
| DD effective landing | `directDepositEffectiveDate` | `nextBusinessDay(plannedDate)` (`js/dd-widgets.js:50-55`). |

### 1.3 Group-shift rules and allowed windows per offer type `[G-P1-2]`

**`plannedSignupDate` is a member of the date group for EVERY offer type — not
just held offers `[G-P1-2]`.** The gate caught the original §1.3 listing signup
only under `new-funds-held`. That is wrong: `plannedSignupDate` (the account
open date) is the anchor that **every** derived deadline keys off, for all
offer types:

| Derived date keyed off `plannedSignupDate` | Citation |
|---|---|
| Deposit deadline (`+daysAfterSignupAllowedBeforeDeposit`) | `js/offer-model.js:28-33` |
| Debit deadline (`debitDeadlineISO = signup + withinDays`) | `js/offer-model.js:40-48` |
| Each user-requirement deadline (`signup + deadline_days`) | `js/requirements-templates.js:90-97` |
| DD **frequency** window-end (`signup + periods×period`) | `ddWindowEndDate`, `js/reminders.js:36-44` |
| DD generator base date (`addBusinessDays(signup, 1)`) | `js/modals-forms.js:1133-1134` |
| Open-date hold anchor (`lockStartsFrom==='open date'` → hold from signup) | `js/offer-model.js:70-71` |

So a **standard direct-deposit** offer still has an open/signup date, and its DD
window, deposit deadline, and any user/debit deadlines all move when signup
moves. Omitting signup from the DD group would let the engine "satisfy" a DD
window it has actually invalidated.

**Group-shift rule (all offer types).** `plannedSignupDate` is the **primary
anchor**. The default slide moves the whole group rigidly: shifting signup by
Δ shifts `optionalPlannedFundingDate` and every `directDeposits[i].plannedDate`
by the same Δ (preserving current relative offsets), then the engine may
**independently** re-optimize the funding date and each DD date within their
sub-windows. All derived deadlines above are **recomputed** from the new signup;
none is a free variable. Business-day handling is a **preference, not a
constraint** (see below).

**Business-day dates are a PREFERENCE, not a validity rule `[G-P3-2]`.** The app
**accepts** a weekend/holiday `plannedDate`/`plannedSignupDate` and computes the
*effective* landing as the next business day —
`directDepositEffectiveDate(dd) = nextBusinessDay(plannedDate)`
(`js/dd-widgets.js:50-55`); the DD round trip likewise walks business days
(`ddRoundTrip`, `js/dd-widgets.js:18-27`). So the optimizer **prefers**
business-day (esp. Monday) initiations because they yield a shorter round trip
and fewer dollar-days — it never **rejects** a weekend date as invalid. User
dates are honored as entered; only *derived* dates business-day-shift
(`js/offer-model.js:16-26`).

**`new-funds-held`** (also the default for absent/`other` offerType,
`js/requirements-templates.js:427`)
- Group: `{plannedSignupDate (anchor), optionalPlannedFundingDate?}`. Held lump =
  `requiredFundingAmount` from `lockStartDate` → `withdrawalEligibleDate`
  (`js/projection-optimizer.js:181-184`).
- **`lockStartsFrom`**: `'open date'` → hold counts from `plannedSignupDate`
  (signup and funding are **independent** anchors — sliding signup moves the
  hold even if funding is fixed); `'funded date'` → hold counts from the
  business-day-shifted funding date (`js/offer-model.js:70-72`).
- Windows: `plannedSignupDate ∈ [today, offerExpirationDate]`;
  `optionalPlannedFundingDate ∈ [plannedSignupDate, depositDeadline]`;
  withdrawal is derived, not free.

**`direct-deposit`** (standard; no held lump)
- Group: `{plannedSignupDate (anchor), directDeposits[].plannedDate}`. There is
  no held lump and no `daysFundsMustRemain` (`js/offer-model.js:73`, held branch
  only), but signup still anchors the DD window-end, deposit/debit/user
  deadlines, and the DD generator's base date (table above). Each DD ties up its
  own amount **only** over its round trip (`js/projection-optimizer.js:151-160`).
- Windows: `plannedSignupDate ∈ [today, offerExpirationDate]`; each DD ∈
  `[signup, DD-window-end]` where window-end = `ddWindowEndDate` (frequency:
  `signup + periods×period`, `js/reminders.js:36-44`; count: bounded by expiry /
  requirement deadline — see §3). Business-day initiation preferred for a
  shorter round trip; a one-day weekend/holiday shift materially changes
  dollar-days `[P2-4]`.

**`held-and-dd`** (lump **and** per-DD, both held to the shared withdrawal date)
- Group: `{plannedSignupDate (anchor), optionalPlannedFundingDate (required),
  directDeposits[].plannedDate}`. Signup anchors the DD window and, when
  `lockStartsFrom==='open date'`, the hold; funding anchors the held lump.
  Held lump `requiredFundingAmount` from `lockStartDate`; **plus** each DD's
  amount from `directDepositEffectiveDate(dd)` — both through
  `withdrawalEligibleDate` (`js/projection-optimizer.js:166-178`). Missing
  funding date drafts the offer (`js/offer-model.js:491-492`).

---

## 2. Feasibility evaluation `[P1-1][P1-2][P1-5]`

### 2.1 Evaluated set — baseline vs. candidate clones `[P1-1][G-P1-1]`

The engine builds the evaluated set **explicitly**, and the split between
**baseline** and **candidates** is exact — the gate caught a real bug in the
naïve "active ∪ candidates" phrasing:

```
baseline      = { active offers that are NOT candidates }
                # active = offerIsActiveForProjection(o) with no override:
                #   confirmed (applied/funded) unconditionally, OR
                #   prospect/selected with includeInScenario (offer-model.js:522-528)
evaluatedSet  = baseline ∪ { each SELECTED candidate, cloned to its trial dates }
overrideIds   = ids(baseline) ∪ ids(selected candidate clones)
```

**A candidate that is currently included in the live scenario is REMOVED from the
baseline `[G-P1-1]`.** If a candidate offer is presently `includeInScenario:true`
(or an active prospect), it is *already* in the currently-active set. Leaving it
in the baseline **and** adding its clone would double-count it and — worse — make
it **impossible to exclude**: the baseline copy would keep contributing capital
even when the plan drops the candidate. So each candidate is represented **only**
by its clone, which may be **excluded** (absent from `overrideIds`) or **included
at trial dates**. The baseline holds exactly the active offers the engine is
*not* deciding about.

Concretely, the engine assembles a synthetic `state` whose `offers[]` carries the
baseline offers *and* the candidate clones at their trial dates, and calls the
projection with `includedOfferIds = overrideIds`, so
`offerIsActiveForProjection`'s override branch (`js/offer-model.js:526`) returns
**exactly** the intended set. It **never** passes a bare candidate-only
`includedOfferIds` — that is precisely the shipping `runOptimizer` bug
(**C2**): its mask loop builds `includedIds` from candidates alone
(`js/projection-optimizer.js:330,338`) and passes them at `:361`, so the override
branch drops every confirmed offer that has no manual commitment. Manual
commitments (`state.commitments`, unconditional at
`js/projection-optimizer.js:127-140`) are always carried; the virtual-commitment
loop suppresses any offer already backed by a non-cancelled linked commitment
(`offerIdsWithCommitments.has(o.id)`, `:145`) — see the addendum.

### 2.1a Source-linked manual commitments are NOT candidates `[G-P1-7]`

An offer can be "converted" to a manual capital commitment linked by
`sourceBonusOfferId` (`convertOffer`, `js/events-actions-data.js:637-648`; the
guard at `:641` blocks a second conversion). In the projection, such a commitment
adds the offer's id to `offerIdsWithCommitments` (`:136`) and the offer itself is
then **suppressed** from the virtual-commitment loop (`continue` at `:145`) — its
capital is represented **only** by the fixed-date commitment, to avoid
double-counting.

**Rule (chosen): a candidate offer that has a non-cancelled `sourceBonusOfferId`
commitment is EXCLUDED from the candidate pool.** Rationale: if the engine also
scheduled it as a candidate, the projection would suppress the offer at `:145`,
so sliding its dates would move **no** capital (the commitment's dates are fixed
and user-pinned) while the objective (§4) still credited its
`signupBonusAmount` — a phantom bonus with zero cash effect. The manual
commitment is by definition a **user-pinned** value that must not be silently
re-optimized. The candidate-review UI (§9) surfaces these as *"already committed —
managed as a commitment"* rather than as schedulable candidates. (The rejected
alternative — co-scheduling the linked commitment's `startDate`/`endDate` in
lockstep with the offer — is far more complex and violates the "commitments are
user-pinned" contract; deferred as a future enhancement if owners ask for it.)

### 2.2 Injected snapshot — every `App.state` read enumerated `[P1-2]`

**P1-2 sweep result (verified across the entire evaluation call graph:
`projection-optimizer.js`, `offer-model.js`, `dd-widgets.js`,
`date-format-core.js`, `requirements-templates.js`, `migrations-catalogs.js`).**

| Read | Site | Currently sourced from | Injection requirement |
|------|------|------------------------|-----------------------|
| `settings.projectionStartDate` | `js/projection-optimizer.js:42,75,297` | the passed `state` (falls back to `TODAY`) | carry `settings.projectionStartDate` + explicit `today` |
| `settings.minimumCashBuffer` | `js/projection-optimizer.js:76,324` | passed `state` | carry `buffer` |
| `settings.currentLiquidCapital` | `js/projection-optimizer.js:77` | passed `state` | carry `liquid` |
| `settings.projectionHorizonMode/Days` | `js/projection-optimizer.js:41-47` | passed `state` | **bypassed** — engine passes explicit horizon (§2.4) |
| `state.commitments / offers / events` | `js/projection-optimizer.js:128,143,193` | passed `state` | carry all three |
| **`App.state.settings.ddTransfer`** | **`js/dd-widgets.js:4-5`** via `ddRoundTrip` | **live `App.state` — NOT the passed state (C1/C4)** | **must be threaded explicitly** into every `ddRoundTrip` call site (`projection-optimizer.js:153`, `offer-model.js:58,400`) |

**The only un-injected read in the graph is `ddTransfer`** (dd-widgets.js:4-5),
reached from four sites. No other `App.*`, `Sync.*`, or `localStorage` reads
exist in the projection/offer/date modules. The clock singleton
`TODAY = startOfDay(new Date())` (`js/date-format-core.js:1`) is module-load
time; the engine input carries an explicit `today` so evaluation is
clock-independent (the projection only uses `TODAY` as a
`projectionStartDate` fallback, `:75`). The node harness must exercise altered
`ddTransfer` (e.g. `2/1/2`) and altered `today` variants `[P3-2]`.

### 2.3 Buffer floor — hard constraint

`belowBuffer = availableCapital < buffer`; `shortfall = availableCapital < 0`
(`js/projection-optimizer.js:214-215`). A plan is **cash-feasible** iff
`shortfallDays === 0 && belowBufferDays === 0` (identical to `runOptimizer`'s
gate, `:371`). The buffer is a HARD constraint — a violating plan is **invalid**,
never "penalized" or "ranked lower."

### 2.4 Horizon from the plan `[P1-5]`

The engine computes horizon from the **evaluated set at trial dates** — never via
`effectiveHorizonDays` (which clamps to 180 and reads the current active set,
**C3**):

```
horizonEnd = max over evaluatedSet of {
    withdrawalEligibleDate, depositDeadline, debitDeadlineISO,
    every requirementDeadlineISO, ddWindow end, expectedBonusWindow.endISO,
    max(ddRoundTrip.returnDate)
} + MARGIN
horizonDays = min( daysBetween(projectionStartDate, horizonEnd), HORIZON_CEILING )
```

**Exact margin `[G-P2]`: `MARGIN = 30` calendar days** — enough to let the
expected-bonus posting window (`bonus_post_max_days`, default 60 but typically
posted well inside a month after the last obligation) and any business-day
rounding land inside the projection without inflating the day loop. **Hard
ceiling: `HORIZON_CEILING = 730` days (2 years).** The ceiling exists only to
bound the `O(horizon)` day loop (`js/projection-optimizer.js:205-220`) against a
degenerate offer (e.g. a multi-year hold); it is **far** above the removed 180-day
clamp, so no realistic plan is truncated.

**Behavior when a plan exceeds the ceiling:** if any date in `horizonEnd` would
push `horizonDays` past `HORIZON_CEILING`, the plan is marked `valid:false` with
reason `horizon-exceeded` (offer id + the offending date) rather than silently
truncated — the projection is never run against a clamped horizon that would
mis-judge feasibility. This is a hard fail, not a penalty.

The engine passes `horizonDays` explicitly to the projection kernel (new
`options.horizonDays` override; see §7). A **horizon-overrun fixture** (a
candidate whose withdrawal is >180d out but < ceiling) is required and must show
the un-clamped horizon covers it `[P3-2 gate additions]`.

---

## 3. Qualification validator `[P1-4]`

Cash-feasibility alone never validates a plan. **Valid ⇔ cash-feasible AND fully
qualified.** Per included offer, at its trial dates, using existing helpers:

| Constraint | Check | Helper / citation |
|-----------|-------|-------------------|
| Offer not expired | `plannedSignupDate ≤ offerExpirationDate` | `offer.offerExpirationDate`; expiry feed `js/reminders.js:94` |
| Funding within deposit window | funding effective post `≤ depositDeadline` | `depositDeadline` `js/offer-model.js:28-33` |
| Debit requirement reachable | `debitDeadlineISO` computable & ≥ today | `debitDeadlineISO` `js/offer-model.js:40-48` |
| User requirement deadlines | each unmet row's `requirementDeadlineISO` ≥ its work start | `requirementDeadlineISO` `js/requirements-templates.js:90-97` |
| DD count / cadence / window | per **§3.1** (real spec below) | §3.1 |
| Completeness gate | offer passes `isOfferComplete` at trial dates | `isOfferComplete` `js/offer-model.js:463-496` |

Each failing constraint is recorded as a `bindingConstraint` reason on the plan
(§7) so the UI can explain *why* an offer was dropped or a date pinned.

### 3.1 DD qualification — the real spec `[G-P1-3]`

**The gate caught a material misread: the original §3 cited
`deriveRequirementsFromLegacy` as if it *validates* DD count/cadence. It does
not.** `deriveRequirementsFromLegacy` (`js/requirements-templates.js:129`) only
**materializes display rows** — it pushes a `req-ddreq` tracking row and per-DD
`req-dd-<id>` rows via `makeRequirementRow` (`:167-203`); it never checks that
the scheduled DDs actually satisfy the requirement. The engine must derive
qualification itself. Definitions from `ddRequirement`:

- **count mode** — `ddRequirement = { mode:'count', count:N }`.
- **frequency mode** — `ddRequirement = { mode:'frequency', freqPeriods:N,
  freqEvery:'week'|'2weeks'|'month'|'day' }`.

**(a) Count qualification.** Satisfied iff
`directDeposits.filter(scheduled).length ≥ ddRequirement.count`, and every DD's
**effective** date (`directDepositEffectiveDate`, next-business-day landing,
`js/dd-widgets.js:50-55`) is `≤ min(offerExpirationDate, any binding
requirementDeadlineISO)`. In count mode the "DD window-end" is a *report* of when
the set finishes (the max effective date, `js/reminders.js:46-51`), **not** a
deadline — so the binding cutoff is the offer expiry / requirement deadline, not
`ddWindowEndDate`.

**(b) Frequency qualification.** Satisfied iff there are `≥ freqPeriods`
scheduled DDs, they are **spaced one per period** (cadence below), and every DD's
effective date lands within `[plannedSignupDate, ddWindowEndDate]`, where
`ddWindowEndDate = plannedSignupDate + freqPeriods × period` (period =
`{week:7d, 2weeks:14d, day:1d, month:+freqPeriods months}`) — the exact
`js/reminders.js:36-44` formula.

**(c) The pure DD-window derivation — engine needs its own, NOT reminders'.**
`ddWindowEndDate` lives in `js/reminders.js:32-52`, and `reminders.js` imports
`App` (`:1`) and `dd-widgets.js` (`:3`, which imports `App`+`render`) — so
importing it would drag the impure UI graph into the pure engine (**§7**).
**Resolution (per §11.1 pure-core extraction):** the pure DD/projection core
newly **exports** `ddWindowEndDate(offer)` (alongside `directDepositEffectiveDate`
and `ddRoundTrip`), with this exact contract (a faithful move of the current
formula, one source of truth — the engine does **not** re-implement a divergent
copy):
```
ddWindowEndDate(offer):
  if offerType ∉ {direct-deposit, held-and-dd}          → ''
  if ddRequirement.mode === 'frequency':
    start = parseDate(plannedSignupDate); if !start      → ''
    periods = max(1, freqPeriods)
    freqEvery 'week'   → start + periods×7d
    freqEvery '2weeks' → start + periods×14d
    freqEvery 'day'    → start + periods days
    else ('month')     → start + periods months          # calendar-month add
    return isoDate
  else (count mode):
    return max( directDepositEffectiveDate(dd) over dds )  or '' if none
```

**(d) DD cadence — how the engine lays out / validates spacing.** The app's own
DD generator `generateDdDatesFromRequirement` (`js/modals-forms.js:1125-1164`) is
the cadence contract the engine mirrors — both to **materialize** DD rows for a
churn candidate that arrives with `directDeposits:[]` (§6) and to **validate**
that user-supplied DDs meet the frequency spacing:
- base date `= addBusinessDays(plannedSignupDate, 1)` (`:1134`);
- step per DD: `week → +7d`, `2weeks → +14d` (`:1145-1146`), `month → +1 calendar
  month` (`:1161`), **count mode → `+3 business days`** (`:1163`);
- default per-DD amount `= requiredFunding / count` (`:1151`).

**(e) Weekday minima are a PREFERENCE, not a validity check `[G-P3-2]`.** A DD
initiated on a weekend/holiday is **valid** — it just lands on the next business
day (`directDepositEffectiveDate`) and ties up more dollar-days. Monday-initiated
DDs give the shortest round trip; the search grid (§5) *prefers* business-day
initiations but the qualifier never *rejects* a weekend date.

---

## 4. Objective `[P3-3][P2-5]`

**Maximize GROSS expected bonus** `[P3-3]`: `Σ signupBonusAmount` over included
offers (matches `runOptimizer`'s `totalBonus`, `js/projection-optimizer.js:339`).
`monthly_fee` / `fee_waiver_condition` / `early_termination_fee` fields exist
(`js/requirements-templates.js:331-333`) but are **NOT netted** — labeled "gross"
in the UI; fee-netting is a declared future enhancement.

**Tie-breaks (in order):**
1. **Higher annualized return on locked capital** — `annualizedReturn`
   (`js/offer-model.js:431-461`), blended by dollar-days for a set exactly as
   `runOptimizer` weights it (`js/projection-optimizer.js:341-357`). *(Reads
   `ddTransfer` via `ddCapitalTime` — C4; thread the injected config.)*
2. **Earlier completion = cash-release only `[G-P2]`** — earlier max
   `withdrawalEligibleDate` across the set (the date all locked capital is free
   again, `js/offer-model.js:50-76`). **`safeToCloseDate` and ETF/`etf_window_days`
   timing are explicitly NOT in the objective** — the tie-break rewards freeing
   *cash* sooner, not closing the *account* sooner. `safeToCloseDate` exists and
   is exported (`js/offer-model.js:531`) but is deliberately excluded;
   account-close/ETF-aware sequencing is a **declared future enhancement**, noted
   so a later revision can add a third tie-break without reopening the contract.

**Determinism — full canonical-vector spec `[P2-5][G-P2]`.** Identical inputs ⇒
byte-identical plan. The engine never relies on incidental array/mask order
(today's `runOptimizer` falls through to mask order, `:391-396` — deterministic
but arbitrary). Every comparison that reaches a tie is broken by the **canonical
plan vector**, built as follows:

1. **Include-set key** — the plan's `includeSet` as offerIds sorted **ascending
   by string compare** (`localeCompare`-free byte order; ids are `off_…`/`tpl_…`
   ascii). A plan including strictly more of the same offers is *not* preferred
   by this key — objective already decided that; this key only orders ties.
2. **Per-offer schedule fields**, appended in this **fixed order**, iterating
   offers in the sorted-id order from (1):
   `plannedSignupDate`, `optionalPlannedFundingDate`, then `directDeposits`
   sorted **ascending by `id`**, each contributing `(id, plannedDate)`.
3. **Null / blank ordering** — a missing or `''` date maps to the empty string,
   which sorts **before** any real `YYYY-MM-DD` (ISO strings compare
   lexicographically == chronologically). So "no funding date" sorts ahead of any
   dated funding.
4. **DD id/date ordering** — DDs are ordered by **`id`** (stable, mint order),
   **not** by `plannedDate` and **not** by array position, so re-sorting the
   array can never change the vector. Within the vector each DD's `plannedDate` is
   compared as an ISO string.
5. **Numeric tie handling** — objective scalars are compared with a fixed
   epsilon: `grossBonus` rounded to whole dollars; `blendedAnnReturn` rounded to
   `1e-9` before compare (absorbs float jitter from the dollar-days blend). Within
   epsilon ⇒ treated as equal ⇒ fall through to the next key, ending at the
   canonical vector, which is total.

**Search-strategy selection `[G-P1-4]` (full budget math in §5):**
- **Exact enumeration** *only* when the **total combination count**
  `(1 + G_eff)^n ≤ EVAL_CAP` (§5), where `n` = candidate count and `G_eff` = trial
  dates per offer. This **replaces** the original (incoherent) "candidate count
  ≤ 7" rule — 7 offers × ~12 dates ≈ `13^7 ≈ 63M`, far over any interactive cap.
- Otherwise **bounded beam** (width `W = 64`, §5), then a **pair-swap /
  local-repair pass** (add/drop/shift each offer, swap pairs) to escape local
  optima.
- All paths counted against `EVAL_CAP` with early-out; determinism asserted in
  pins (§10).

---

## 5. Candidate date grid `[P2-4]`

The search space is subset × per-offer date-group assignment. Grid construction:

- **Anchor inventory** (business-day-aware, ±1–3 business days around each):
  today; funding/deposit deadlines; `offerExpirationDate`; capital-event
  inflow/outflow dates (`state.events`); withdrawal-release dates of *other*
  offers (frees capital); DD weekday minima (Mon-initiated = shortest round trip,
  `js/dd-widgets.js:133-147` shows the month-grid hold metric this mirrors).
- **Coarse-then-refine:** across a wide-open window (e.g. a distant expiry) take
  a coarse weekly pass first, then refine ±1–3 business days around the best
  coarse point and around each anchor. A one-day shift over a weekend/holiday
  materially changes DD round-trip dollar-days `[P2-4]`, so refinement is
  business-day-granular near DD dates.
- **Grid cap per offer:** `G ≤ 12` trial dates (`maxDateGridPerOffer`), plus the
  implicit "excluded" option → `G_eff = G + 1 ≤ 13` states per candidate.

### 5.1 Search budget & fallback ladder `[G-P1-4]`

**Hard total-evaluation cap: `EVAL_CAP = 50,000` projection evaluations.**
Rationale: each evaluation is one `O(horizon)` day loop
(`js/projection-optimizer.js:205-220`); with `horizon ≤ 730` (§2.4, typical
~210) and a per-day inner pass over commitments+offers, ~50k evaluations is the
band that keeps the whole run inside the **< ~2 s phone-class** budget with
margin. The engine **counts** evaluations and **early-outs** (returns
best-so-far, flagged) if it would exceed the cap — the cap is a circuit-breaker,
and the perf pin (§10) asserts both `evals ≤ EVAL_CAP` and wall-clock.

**Fallback ladder (in order; the first whose budget fits is used):**

1. **Exact enumeration** — used *only* when `(1 + G_eff)^n ≤ EVAL_CAP`, i.e. the
   full cross-product of {exclude ∪ ≤12 dates} over `n` candidates fits the cap.
   With a full 12-date grid this holds up to `n ≈ 4` (`13^4 = 28,561 ≤ 50k`;
   `13^5 = 371,293 >` cap). With a coarser grid it extends further. This is the
   **combination-count** gate — *not* the old candidate-count≤7 rule, which
   ignored the date multiplier entirely.
2. **Beam search**, width **`W = 64`** — process candidates in canonical
   sorted-id order; at each step expand each surviving partial plan by
   {exclude} ∪ {its ≤12 trial dates}, score each expansion with the **real**
   projection, keep the top `W` by (objective, canonical vector). Cost ≈
   `n × W × G_eff`. Then the **pair-swap / local-repair** pass (§4) adds `O(n²)`
   evaluations.
3. **Coarse-grid-first** — when even beam × full grid would overflow (large `n`
   *and* wide-open windows), first run beam with a **coarse grid** (`G_coarse ≤ 6`,
   weekly steps only), then **refine ±1–3 business days** around each offer's
   winning coarse date (a local grid of ~6 dates × `n`). Cost ≈
   `n × W × (1 + G_coarse) + 6n`.

**Worst-case math — cap holds for ~20 candidates × multi-date groups:**

| Strategy | Formula | n = 20, G = 12 | vs. cap (50k) |
|---|---|---|---|
| Exact | `(1+G)^n` | `13²⁰ ≈ 1.9×10²²` | **overflows → never used at n=20** |
| Beam (W=64, full grid) | `n·W·(1+G) + n²` | `20·64·13 + 400 ≈ 17,040` | **✓ holds** |
| Coarse-first (W=64, G_coarse=6) | `n·W·(1+G_coarse) + 6n` | `20·64·7 + 120 ≈ 9,080` | **✓ holds** |

So at the `n = 20` candidate ceiling (above which the engine returns the
`tooMany` signal, §7, mirroring `maxOptimizerCandidates` default 15 at
`js/projection-optimizer.js:310`), beam search evaluates ≈ 17k projections —
about a third of the cap — and coarse-first ≈ 9k. Exact enumeration is used only
in the small-`n` regime where it provably fits. The cap is therefore never
breached by the ladder; the counter + early-out guards the pathological residue.

---

## 6. Churn-hybrid candidates `[P2-1][P2-2][P2-3]`

**Synthesis `[P2-1][G-P1-6]`:** churn candidates are built via the exact
Run-again pipeline — `templateToOffer(offerToTemplate(sourceOffer))`
(`churnRunAgain`, `js/events-actions-data.js:616`; the compose call at `:620`).
This yields a fresh `prospect` offer, blank dates, `includeInScenario:true`,
`last_edited:null` (`js/requirements-templates.js:419-476`). But the pipeline is
**lossy for two capital-model inputs**, and the engine must repair both before
treating the result as a candidate:

**Whitelist sweep `[G-P1-6]` — every field the capital model / qualifier reads,
vs. what the synthesis produces.** `offerToTemplate` copies only
`TEMPLATE_TERMS_KEYS` (`js/requirements-templates.js:327-336,396-398`);
`templateToOffer` rebuilds the offer (`:419-476`):

| Field read by projection / qualifier | Carried? | Outcome | OK? |
|---|---|---|---|
| `offerType` | whitelist `:328` | copied (`'other'→'new-funds-held'` `:427`) | ✓ |
| `signupBonusAmount`, `offerExpirationDate` | whitelist `:329` | copied | ✓ |
| `requiredFundingAmount`, `daysAfterSignupAllowedBeforeDeposit`, `daysFundsMustRemain` | whitelist `:330` | copied | ✓ (hold **duration** survives) |
| `ddRequirement` | via `templateDdRequirement` `:400,:433` | copied | ✓ |
| `debitRequirement` | via `templateDebitRequirement` `:401,:434` | copied (`byDate` reset) | ✓ |
| **`lockStartsFrom`** (hold **anchor**, read at `js/offer-model.js:70-71`) | **NOT in whitelist** | **FORCED `'funded date'` `:458`** | **✗ must restore** |
| `plannedSignupDate`, `optionalPlannedFundingDate` | personal | `''` `:454-455` | ✓ engine schedules |
| `directDeposits` | personal | `[]` `:467` | ⚠ needs materialization |
| `status` | — | `'prospect'` `:459` | ✓ hypothetical |

**Repair rule 1 — carry the source hold anchor.** After synthesis the engine
sets `candidate.lockStartsFrom = sourceOffer.lockStartsFrom`. Without this, an
**open-date** offer (bank counts the hold from account-open, e.g. US Bank ~35d
from open) is silently re-anchored to **funded date** (`:458`), so
`withdrawalEligibleDate` (`js/offer-model.js:70-72`) computes the wrong
capital-release date — corrupting both feasibility *and* the sequencing objective
(which keys the next offer off when capital frees). `daysFundsMustRemain` (the
duration) does survive the whitelist, but a duration off the wrong anchor is
still wrong. This is the "under-hold clawback class" the gate named: modeling the
lock from the wrong origin mis-dates when funds may be withdrawn. *(The clean
long-term fix is to add `lockStartsFrom` to `TEMPLATE_TERMS_KEYS`, but that edits
shipping template code and is out of this engine's scope — the engine compensates
explicitly.)*

**Repair rule 2 — materialize DDs for DD-family candidates.** A DD/held-and-DD
churn candidate arrives with `directDeposits:[]`, so it contributes no DD capital
and fails DD qualification until the engine lays out DD rows from `ddRequirement`
using the §3.1(d) cadence (fresh `dd.id`s via `uid('dd')`, per
`js/modals-forms.js:1158`), then schedules them (§5).

**Apply/undo is a CREATE, not a mutation `[G-P1-6]`.** A synthesized churn
candidate is a **new** offer (fresh `off_…` id, `js/requirements-templates.js:422`)
that does not exist in `state.offers` until applied. §8 therefore models
**create** (push on apply) and **delete-on-undo** for these — the existing
`applyOptimizerCombo` only flips `includeInScenario` on *existing* offers
(`js/events-actions-data.js:703-716`) and has no create/remove path.

The engine then treats the repaired candidate like any dated candidate (§1),
scheduling its group within its windows.

**Exclusions:**
- `churnSnoozeActive(offer)` true → **excluded** (`js/offer-model.js:374-382`).
- `churnEligibleDate(offer)` null (not churnable, `churn_wait_months` ≤ 0, or
  missing anchor) → **not a candidate**; surfaced as **"needs date"**
  (`js/offer-model.js:355-365`). The candidate's earliest `plannedSignupDate`
  window start is `max(today, churnEligibleDate)`.

**Value-date precedence `[P2-1]` (with the C5 trap):** value date =
`sourceOffer.last_edited` → *stored* template `savedAt` → `"unknown"`. **Do not**
read `savedAt`/`last_edited` off the synthesized candidate — `offerToTemplate`
re-stamps `savedAt` every call (`:392`) and `templateToOffer` nulls `last_edited`
(`:468`). Badge copy per source:
- `last_edited` present → `"stored value from <M-D-YYYY> — unverified"`
- else stored-template `savedAt` → `"from saved template <M-D-YYYY> — unverified"`
- else → `"stored value — date unknown, unverified"`

**Re-check → re-run `[P2-2]`:** a prompt-gated Worker re-check (existing DoC
URL-import path) that changes **any** optimization input (bonus, funding, expiry,
hold anchor, tiers) triggers a **full re-run**, not an annotation update. The
engine treats values as given; only the UI carries verified/unverified.

**Tiered offers — no auto-pick `[P2-3]`:** never auto-select a tier. An un-chosen
tier ladder optimizes at the **stored** offer bonus, badged. An optional
pre-optimization tier prompt lives in candidate review (§9).

---

## 7. Engine API — `js/optimizer-engine.js` `[P1-1..P1-5][P2-5]`

**Pure, deterministic, no `App`/DOM/`Sync` imports `[P1-5][G-P1-5]`.** The engine
imports pure helpers from `date-format-core.js` and from a newly-extracted
**pure DD/projection core**. It must **not** import `dd-widgets.js` (it pulls
`App` at `js/dd-widgets.js:1` and `render` from `render-shell-overview.js` at
`:3`) and must **not** import `reminders.js` (which imports both, `:1,:3`).

**The pure-core extraction (adopted per §11.1 gate decision — config-threading,
not a duplicated kernel).** Step 3 extracts the pure day-model functions into a
core module with **no** `App`/`render` import; each function that currently reads
a live singleton gains an **optional trailing parameter that defaults to the
current UI-sourced value**, so every existing caller is byte-stable and the
fidelity/feed battery proves it:

| Function (current site) | New signature | Default keeps UI callers stable |
|---|---|---|
| `ddRoundTrip` (`dd-widgets.js:18`, reads `ddTransferConfig()` at `:21`) | `ddRoundTrip(dd, cfg = ddTransferConfig())` | UI passes nothing → live `ddTransfer` |
| `directDepositEffectiveDate` (`dd-widgets.js:50`, already pure) | move to core, unchanged | — |
| `ddWindowEndDate` (`reminders.js:32`, pure formula) | move to / re-export from core (§3.1c) | — |
| `generateProjection` (`projection-optimizer.js`) | `generateProjection(state, options)` gains `options.ddTransfer`, `options.horizonDays`, `options.includedOfferIds` | omitted → live config + `effectiveHorizonDays` |
| `withdrawalEligibleDate`, `ddCapitalTime`, `annualizedReturn` (`offer-model.js`, DD branches call `ddRoundTrip`) | accept optional `cfg` threaded into `ddRoundTrip` | omitted → live config |

This makes the C1/C4 hidden `App.state.settings.ddTransfer` read (`dd-widgets.js:4-5`,
reached from `projection-optimizer.js:153`, `offer-model.js:58,400`) an explicit
input — the engine passes `input.settings.ddTransfer` and controls DD timing
faithfully.

**Explicit `today` for module-load-`TODAY` readers `[G-P1-5]`.** Any borrowed
helper that compares against the module-load `TODAY` singleton
(`js/date-format-core.js:1`) must take an explicit `today`, or the engine's
clock-independent evaluation silently drifts to wall-clock:
- `churnSnoozeActive(offer, today = TODAY)` — compares
  `churn_snoozed_until` to `TODAY.getTime()` (`js/offer-model.js:374,381`);
  drives the §6 churn-exclusion.
- `bonusWindowAnchor(offer, today = TODAY)` — falls back to `TODAY` when no
  `done_date` (`js/offer-model.js:214,216,223`); feeds `expectedBonusWindow`,
  whose `endISO` enters the §2.4 horizon.

Both gain the same optional-default treatment (UI callers unchanged). The engine
always passes `input.today`; the node harness exercises altered-`today` variants
`[P3-2 gate additions]`.

### 7.1 Input snapshot (fully self-contained)

```
OptimizerInput = {
  today: 'YYYY-MM-DD',                 // explicit clock (never reads TODAY)
  settings: {
    ddTransfer: { inDays, seasonDays, backDays },   // [P1-2] — the C1 fix
    minimumCashBuffer: Number,
    currentLiquidCapital: Number,
    projectionStartDate: 'YYYY-MM-DD'
  },
  offers:      [ ...baseline (active non-candidates), ...candidate clones ], // §2.1 [P1-1][G-P1-1]
  commitments: [ ... ],                // carried verbatim
  events:      [ ... ],                // carried verbatim
  candidateIds: Set<offerId>,          // which offers the engine may add/slide
  options: {
    maxDateGridPerOffer: 12,           // G — §5.1
    beamWidth: 64,                     // W — §5.1
    evalCap: 50000,                    // hard total-evaluation cap — §5.1 [G-P1-4]
    horizonMargin: 30, horizonCeiling: 730,          // §2.4 [G-P2]
    exactEnumWhen: '(1 + G_eff)^n <= evalCap'        // combination-count gate, NOT candidate-count [G-P1-4]
  }
}
```

### 7.2 Output plan

```
OptimizerPlan = {
  valid: Boolean,                      // cash-feasible AND fully qualified
  reasons: [ '…' ],                    // why invalid / what bound it
  includeSet: Set<offerId>,
  schedule: {                          // per included offer
    [offerId]: {
      op: 'update' | 'create',         // create = synthesized churn offer §6/§8 [G-P1-6]
      plannedSignupDate, optionalPlannedFundingDate,
      directDeposits: [ { id, plannedDate } ],   // ids preserved [P2-6]
      derived: { lockStart, withdrawalEligible, depositDeadline }
    }
  },
  createdOfferIds: [ offerId, … ],     // synthesized offers apply must push / undo must delete [G-P1-6]
  capitalCurveSummary: {               // from the winning projection
    lowestAvailable, lowestDateISO, belowBufferDays, shortfallDays, horizonDays
  },
  // kind ∈ buffer-floor | expiry | deposit-deadline | debit-deadline |
  //        requirement-deadline | dd-window | horizon-exceeded
  bindingConstraints: [ { offerId, kind, dateISO } ],
  objective: { grossBonus, blendedAnnReturn, latestCompletionISO },
  alternatives: [ …top-N plans… ]      // for the proposal list
}
```

**Error / edge behavior:** empty candidate set → `valid:true`, empty include-set,
current-state curve. No feasible plan → `valid:false` with reasons (mirrors
`runOptimizer`'s no-feasible branch, `js/projection-optimizer.js:389-396`).
Candidate count over a hard cap → `tooMany` signal (as today, `:312-322`) so the
UI can ask the user to trim. Never throws on malformed offers — every date access
stays guarded, matching the existing helpers' null-safety.

---

## 8. Apply flow — `applyOptimizerPlan` `[P2-6]`

Mirrors modal-save semantics (`saveOfferFromForm`/`readOfferForm`) so the two
paths can't drift.

**Op model — every touched offer is classified `[G-P2][G-P1-6]`.** Unlike the
shipping `applyOptimizerCombo` (which only flips `includeInScenario` on existing
offers, `js/events-actions-data.js:703-716`), `applyOptimizerPlan` performs three
op kinds in one batched `App.update`:
- **update** — an offer already in `state.offers` (a rescheduled baseline offer,
  or an existing prospect candidate toggled/re-dated): mutate its fields in place.
- **create** — a **synthesized churn candidate** (§6), a new `off_…` offer not
  yet in `state.offers`: **push** the fully-built, repaired offer (hold anchor +
  materialized DDs) into `state.offers`, then apply its schedule.
- **delete** — not produced by apply (the engine never removes existing offers);
  reserved for symmetry so that **undo of a create is a delete**.

**Writes, per included offer, in one `App.update` (`js/app-state.js:193-197`):**
- `plannedSignupDate`, `optionalPlannedFundingDate`,
  `directDeposits[i].plannedDate` — **mutated in place**, preserving
  `directDeposits[i].id` (minted by `migrateDdIds`; per-DD feed items
  `yv-<offerId>-dd-<dd.id>` and derived rows `req-dd-<dd.id>` key on it —
  `js/reminders.js:143`, `js/requirements-templates.js:198`). Never rebuild the
  DD array.
- `includeInScenario` — the existing apply lever
  (`applyOptimizerCombo`, `js/events-actions-data.js:712`).
- `last_edited = new Date().toISOString()` on each mutated offer (matches
  `js/modals-forms.js:1323`).
- Then `syncRequirementsWithLegacy(offer)` per mutated offer
  (`js/requirements-templates.js:232`, as `readOfferForm` does at
  `js/modals-forms.js:1347`) — because requirement/derived deadlines are computed
  from `plannedSignupDate`, sliding it re-dates every derived row; the sync
  refreshes derived rows **in place**, preserving `done`/`done_date`/`notes`.
- `reconcileClosedDate` is a no-op here (no status transition) but call it for
  parity if status ever changes.

**No bare `App.update` scatter-writes** — one batched updater, one `save()`, one
`render()`.

**One-shot undo snapshot `[P2-6][G-P2]`** (captured BEFORE mutation, restored on
undo). Because `syncRequirementsWithLegacy` re-dates rows and the apply may add
whole offers, the snapshot is a **deep clone of every touched offer** plus the
ids of any created offers — not a hand-picked field list:
```
UndoSnapshot = {
  updated: {
    [offerId]: <deep clone of the ENTIRE offer as it was pre-apply>
    // structuredClone/JSON round-trip; restoring it verbatim undoes every
    // in-place mutation (dates, includeInScenario, last_edited) AND the
    // requirement-row re-dating that syncRequirementsWithLegacy performed,
    // preserving done/done_date/notes exactly.
  },
  createdOfferIds: [ offerId, … ]
    // synthesized churn offers pushed on apply; undo DELETES these by id.
}
```
**Undo (one shot):** for each `updated` id, replace the live offer with its deep
clone; for each `createdOfferIds` id, splice it out of `state.offers` — all
through the same batched `App.update` → one `save()` → one `render()`. Applying
the snapshot is idempotent and exactly inverts the three op kinds
(update↔update, create↔delete). Capturing whole offers (vs. the original
selective field list) is deliberate: it is the only way to guarantee the restore
covers fields a future §8 write might touch without the undo drifting.

**Feed / action-tombstone implications:** feed ids are stable (offer id + dd id +
row id), so date slides **move** `dueDate` on existing items rather than
tombstone+resurrect — no churn *provided ids are preserved*. Per **C6**,
work-item feed emission gates on **committed** status, not `includeInScenario`
(`js/reminders.js:119-121,137,173,203`), so applying a plan to `prospect`
candidates changes the capital scenario and the Optimize/Timeline view but does
**not** emit or retract to-do feed items until the offer is committed. Only
`offer-expires` is scenario-independent (`js/reminders.js:86-94`). The apply
toast + undo affordance should say what actually changed (dates + inclusion),
not imply new reminders fired.

---

## 9. UI spec — Plan tab (decided layout)

**Nav → 4 tabs: Home, Plan, Offers, Settings.** Today there are 5 views
(`overview`, `planner`, `timeline`, `offers`, `settings` —
`js/render-shell-overview.js:88-94`, mobile nav `:158-162`). Home/Overview stays
**as-is**, chart-first; actions are not promoted (owner uses iOS Reminders as his
action surface).

**Merge Planner + Timeline into one segmented "Plan" tab** — segments
*Planner / Timeline / Optimize*. **This merge ships as its own revertable commit
BEFORE the optimizer panel** (checkpoint step 4). `renderPlanner`
(`js/render-main-views.js:15`) and `renderTimeline` (`:565`) become the first two
segments largely intact; view routing (`js/render-shell-overview.js:180-186`)
collapses `planner`+`timeline` → `plan` with a segment selector.

**Optimize segment** (new, after the merge commit):
1. **Candidate review** — list of candidates incl. churn candidates with
   `unverified` badges (§6) and the "needs date" state; a prompt-gated Worker
   re-check control; the optional pre-optimization **tier prompt** for tiered
   ladders `[P2-3]`.
2. **Run control** — replaces/extends today's "Find feasible combinations"
   button (`js/render-main-views.js:73`). Gross-bonus objective labeled as gross.
3. **Proposal view** — the winning plan and top alternatives:
   **sequence view** (per-offer schedule + badges incl. unverified-churn),
   **capital curve** summary (lowest available, below-buffer/shortfall days),
   and **binding-constraint hints** (what pinned each date / dropped each offer).
   Reuses the combo-card idiom (`renderComboCard`,
   `js/render-main-views.js:136-163`) extended with dates + constraints.
4. **Apply / Undo** — `applyOptimizerPlan` (§8) with the one-shot undo.

**380px-first** throughout. The Home hero-chart styling batch (today-line,
gridlines, scrub line) is **explicitly out of scope** for this run (separate owner
batch, checkpoint step 4 "RELATED OWNER CHART BATCH").

---

## 10. Test plan `[P3-2]`

Mirrors the existing corpus harness: a Node runner under
`docs/fixtures/…/harness/` that `eval`s module bodies in a `vm` context (no
browser), per `docs/fixtures/doc-corpus/harness/parser-loader.js:1-45`, plus an
in-app `testOptimizerPins()` mirroring `testDocParserRegressions()`
(`js/doc-import-templates.js:914`). The existing full battery stays green:
**fidelity 67/67, pins 20/20**, p2b, feed byte-identity, preview E2E + 380px
(HANDOFF R74, checkpoint §Key decisions) — the engine is a new module + import-map
entry and touches none of the parser/feed paths, so those remain byte-stable.

**Optimizer pins (fixtures with hand-verified expected plans):**
- Single held offer within/over buffer; two offers where only one subset fits;
  a plan requiring a date slide to stay above buffer.
- **Determinism:** same input run twice ⇒ identical plan (and identical
  `(offerId,date)` vector) `[P2-5]`.

**Property tests (assert over generated inputs):**
- Buffer floor **never** violated in any returned `valid` plan.
- **Never** schedules a date before `today`.
- Every per-offer window respected (expiry, deposit deadline, DD window).
- Determinism (idempotent re-run).

**P3-2 gate additions:**
- **DD matrix** — Mon/Fri/pre-holiday initiations × ddTransfer variants; assert
  round-trip dollar-days shift correctly.
- **Confirmed-offer feasibility fixture** — a `funded` offer with no manual
  commitment must remain in the capital model during evaluation (guards **C2 /
  `[P1-1]`**).
- **ddTransfer settings variants** — evaluate the same offers under `1/1/1` vs
  `2/1/2`; results must differ, proving the injected config is honored (guards
  **C1 / `[P1-2]`**).
- **Horizon-overrun fixture** — candidate withdrawal >180d out (but < 730d
  ceiling) is fully modeled; a >730d degenerate offer returns
  `valid:false, reason:'horizon-exceeded'` (guards **C3 / `[P1-5]` / §2.4**).
- **Local-origin sync guard** stays green (`js/events-actions-data.js:778`).
- **Baseline-exclusion fixture** — a candidate that is currently
  `includeInScenario:true` must be excludable: a plan dropping it shows its
  capital gone from the curve (guards **`[G-P1-1]`**).
- **Commitment-linked exclusion** — an offer with a non-cancelled
  `sourceBonusOfferId` commitment is absent from the candidate pool; no phantom
  bonus (guards **`[G-P1-7]`**).
- **Open-date churn carry** — a churn candidate synthesized from an `open date`
  source keeps `lockStartsFrom:'open date'`; its `withdrawalEligibleDate` anchors
  on signup, not funding (guards **`[G-P1-6]`**).
- **DD-qualification fixture** — count and frequency `ddRequirement`s: too-few or
  mis-cadenced DDs fail qualification even when cash-feasible (guards
  **`[G-P1-3]`**).
- **Eval-cap / beam perf** — `n=20` candidates evaluate ≤ `EVAL_CAP` (50k) and
  under the wall-clock budget; determinism holds across the beam path (guards
  **`[G-P1-4]`**).

**Perf assertion:** ~10–20 candidates evaluate under the interactive budget
(< ~2 s phone-class); iteration count bounded and asserted `[P2-4]`.

---

## 11. Risks & decisions (§11.1 / §11.2 resolved at the step-2 gate)

1. **C1 refactor surface — DECIDED §11.1: config-threading + pure-core
   extraction.** The gate adopted the config-default refactor over a duplicated
   kernel (drift risk rejected): `ddRoundTrip`/`withdrawalEligibleDate`/
   `ddCapitalTime`/`annualizedReturn`/`generateProjection` gain optional
   `cfg`/`today`/`horizonDays` params defaulting to today's live values, and the
   pure day-model functions move to a core module with no `App`/`render` import
   (full table in §7). Because every new param defaults to the current value,
   existing UI callers are byte-stable — the fidelity/feed battery must prove it.
2. **C2/C3 live bugs — DECIDED §11.2: hotfix pre-engine, as a separate change.**
   The shipping `runOptimizer` over-reports feasibility (drops confirmed offers,
   C2) and truncates at 180d (C3). The gate ruled these must be **hotfixed before
   the engine ships** — a knowingly misleading feasibility tool must not stay
   live — as its **own** small green-boundary commit **outside this doc's engine
   scope**. **The engine is specified against the POST-hotfix semantics**; this
   contract does not re-derive the hotfix. (Per the checkpoint, the hotfix is
   queued to dispatch after the in-flight chart batch, taking the next version
   literal.)
3. **Search combinatorics — DECIDED §5.1: hard `EVAL_CAP = 50,000`.** Subset ×
   date-grid dwarfs today's `2^n`. The **combination-count** gate for exact
   enumeration (not the old candidate-count≤7), beam width `W=64`, and
   coarse-grid-first keep every path under the cap, with a counted early-out; the
   worst-case table (§5.1) shows `n=20` evaluates ≈17k (beam) / ≈9k (coarse).
4. **DST / business-day edges.** `parseDate` builds local-midnight dates
   (`js/date-format-core.js:67-74`); `daysBetween` rounds ms/86400000
   (`:210-213`). Spring-forward/fall-back days are 23/25h — the `Math.round`
   absorbs this, but DD round trips crossing a DST boundary should be pinned in
   the DD matrix to prove no off-by-one.
5. **Churn value-date trap (C5).** The provenance date must come from the source
   offer, not the synthesized candidate — easy to get wrong in step 3.
6. **Feed nuance (C6).** Applying to prospects changes the scenario but emits no
   to-do items until commit; the UI copy must not over-promise.
7. **`window._horizonDebug` side effect (C7).** The pure engine must not
   replicate it; keep it in the UI-facing `effectiveHorizonDays` only.
8. **Stale churn values.** Even post-refresh, a stored bonus can be out of date;
   the badge is the only guard — the engine trusts inputs.

---

## 12. Gate record `[step-2 plan gate]`

Step 2 (run 2026-07-08-planner-optimizer) returned **needs-revision — 7 P1 /
4 P2 / 2 P3**. Every finding is folded above as a binding, re-verified amendment;
each row's disposition names the rewritten section(s) and the key citation the
amendment now rests on.

| Finding | Disposition | Anchor citation(s) verified |
|---|---|---|
| **P1-1** evaluated-set = baseline (active non-candidates) + selected candidate clones; a currently-included candidate is removed from baseline | amended **§2.1** | `offerIsActiveForProjection` override branch `offer-model.js:526`; shipping mask bug `projection-optimizer.js:330,338,361` |
| **P1-2** `plannedSignupDate` joins the DD and held-and-dd date groups; group-shift rule per offer type | amended **§1.3** | deadlines key off signup: `offer-model.js:28-33,40-48`, `requirements-templates.js:90-97`; DD window `reminders.js:36-44`; open-date hold `offer-model.js:70-71` |
| **P1-3** real DD qualification; `deriveRequirementsFromLegacy` only materializes rows; pure `ddWindowEndDate` not reminders-internal | amended **§3 + §3.1** | `deriveRequirementsFromLegacy` materialize-only `requirements-templates.js:129,167-203`; `ddWindowEndDate` formula `reminders.js:32-52`; cadence `modals-forms.js:1125-1164` |
| **P1-4** total-evaluation cap + fallback ladder + worst-case math | amended **§4, §5.1, §11.3** | grid/beam knobs; `maxOptimizerCandidates` `projection-optimizer.js:310`; day loop `:205-220` |
| **P1-5** engine must not import `dd-widgets.js`; config-threading + pure core; explicit `today` | amended **§7** | `dd-widgets.js:1,3` imports `App`/`render`; `churnSnoozeActive` `offer-model.js:374,381`; `bonusWindowAnchor` `:214,216,223` |
| **P1-6** churn synthesis must carry source `lockStartsFrom`; whitelist sweep; create/delete apply-undo | amended **§6 + §8** | whitelist `requirements-templates.js:327-336`; forced `'funded date'` `:458`; new offer id `:422`; `applyOptimizerCombo` no-create `events-actions-data.js:703-716` |
| **P1-7** source-linked manual commitment → exclude candidate | amended **§2.1a** | suppression `projection-optimizer.js:145`; `convertOffer` `events-actions-data.js:637-648` |
| **P2** exact horizon margin + over-ceiling behavior | amended **§2.4** | `MARGIN=30`, `HORIZON_CEILING=730`, `horizon-exceeded` fail |
| **P2** completion tie-break = cash-release only (safeToCloseDate/ETF excluded) | amended **§4** | `withdrawalEligibleDate` `offer-model.js:50-76`; `safeToCloseDate` exported `:531` (excluded) |
| **P2** full deterministic-vector spec | amended **§4** | canonical field list/order, null-first, DD-by-id, epsilon ties |
| **P2** undo snapshot = deep-clone of every touched offer + `createdOfferIds`; create/update/delete op model | amended **§8** | op model + whole-offer clone |
| **P3** stale provenance sha | amended **header** | re-verified at HEAD `bee6009`; originally `0f0194c` |
| **P3** "DD must be on a business day" → optimizer **preference**, not validity | amended **§1.3, §3.1(e)** | `directDepositEffectiveDate = nextBusinessDay` `dd-widgets.js:50-55` |

**Adopted architecture decisions (both binding on step 3):**

- **§11.1 — config-threading + pure-core extraction** (duplicated kernel
  rejected as drift risk). The DD/offer/projection helpers gain optional
  `cfg`/`today`/`horizonDays` params defaulting to today's live values, and the
  pure day-model moves to a core module with no `App`/`render` import. Existing UI
  callers stay byte-stable; the fidelity/feed battery proves it. Spec: **§7**.
- **§11.2 — pre-engine C2/C3 hotfix.** The shipping `runOptimizer` bugs (drops
  confirmed offers; 180-day clamp) are hotfixed **before** the engine ships, as
  **its own green-boundary commit outside this doc's engine scope**. **The engine
  builds on the POST-hotfix semantics**; this contract does not re-derive the
  hotfix. Spec/scope note: **§11.2**.
