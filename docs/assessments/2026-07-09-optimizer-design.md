# Optimizer Design — Semantic Contract

**Run:** 2026-07-08-planner-optimizer · **Step 1 (executor).** This document is
the binding semantic contract for the sequencer engine (`js/optimizer-engine.js`,
step 3) and the Plan-tab UI (step 4). It is grounded in verified reads of the
shipping code at HEAD `aa12c95`; every factual claim about existing behavior
carries a `file:line` citation checked against the source. Step 2 will
adversarially review it — claims are meant to be re-checked.

All **Plan-gate amendments P1-1 … P3-4** (checkpoint §"Plan-gate amendments")
are folded here as hard requirements and cross-referenced inline as `[P#-#]`.

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

### 1.3 Group-shift rules and allowed windows per offer type

Business-day-aware re-anchoring; default preserves current relative offsets.

**`new-funds-held`** (also the default for absent/`other` offerType,
`js/requirements-templates.js:427`)
- Group: `{plannedSignupDate, optionalPlannedFundingDate?}`. Held lump =
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
- Group: `directDeposits[].plannedDate`. Each DD ties up its own amount **only**
  over its round trip (`js/projection-optimizer.js:151-160`). No
  `daysFundsMustRemain` required (`js/offer-model.js:466,480`).
- Windows: each DD ∈ `[today, DD-window-end]` (window-end from
  `ddRequirement`/expiry), on a **business day** for a shorter round trip.
  A one-day weekend/holiday shift materially changes dollar-days `[P2-4]`.

**`held-and-dd`** (lump **and** per-DD, both held to the shared withdrawal date)
- Group: `{optionalPlannedFundingDate (required), directDeposits[].plannedDate}`.
  Held lump `requiredFundingAmount` from `lockStartDate`; **plus** each DD's
  amount from `directDepositEffectiveDate(dd)` — both through
  `withdrawalEligibleDate` (`js/projection-optimizer.js:166-178`). Missing
  funding date drafts the offer (`js/offer-model.js:491-492`).

---

## 2. Feasibility evaluation `[P1-1][P1-2][P1-5]`

### 2.1 Evaluated set — no `includedOverride` pitfall `[P1-1]`

The engine builds the evaluated set **explicitly**:

```
evaluatedSet = { every currently-active offer (confirmed ∪ includeInScenario) }
             ∪ { each plan candidate, cloned to its candidate dates }
```

It never passes a bare candidate-only `includedOfferIds` — that would drop
confirmed offers (**C2**). Concretely, the engine assembles a synthetic `state`
whose `offers[]` already carries the active offers *and* the candidates at their
trial dates, and calls the projection with the override set = the union of ids,
so `offerIsActiveForProjection`'s override branch (`js/offer-model.js:526`)
returns the full intended set. Manual commitments (`state.commitments`,
unconditional at `js/projection-optimizer.js:127-140`) are always carried;
a candidate that already has a non-cancelled `sourceBonusOfferId` commitment is
suppressed exactly as today (`:136,144`).

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
} + margin (≥30d)
horizonDays = daysBetween(projectionStartDate, horizonEnd)
```

and passes it explicitly to the projection kernel (new `options.horizonDays`
override; see §7). A **horizon-overrun fixture** (a candidate whose withdrawal is
>180d out) is required and must show the un-clamped horizon covers it `[P3-2]`.

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
| DD count / cadence | `directDeposits.length` and dates satisfy `ddRequirement` (count or frequency) | `deriveRequirementsFromLegacy` `js/requirements-templates.js:161-184` |
| DD window-end + weekday minima | every DD lands (business-day) on/before the DD window end | `directDepositEffectiveDate` `js/dd-widgets.js:50-55`; `ddWindowEndDate` (feed `js/reminders.js:155`) |
| Completeness gate | offer passes `isOfferComplete` at trial dates | `isOfferComplete` `js/offer-model.js:463-496` |

Each failing constraint is recorded as a `bindingConstraint` reason on the plan
(§7) so the UI can explain *why* an offer was dropped or a date pinned.

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
2. **Earlier completion** — earlier max `withdrawalEligibleDate` across the set.

**Determinism `[P2-5]`:**
- Final tie-break on the full **sorted `(offerId, date)` vector** — never
  incidental array/mask order (today's `runOptimizer` falls through to mask
  order, `:391-396`, which is deterministic but arbitrary).
- **Exact enumeration** when candidate count ≤ 7: enumerate every subset ×
  date-assignment within budget.
- Beyond 7: bounded beam/greedy-with-lookahead, then a **pair-swap / local-repair
  pass** (try add/drop/shift each offer, and swap pairs) to escape local optima.
- Identical inputs ⇒ byte-identical plan (asserted in pins, §10).

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
- **Perf budget:** interactive < ~2 s on a phone for ~10–20 candidates; explicit
  **iteration budget** with early-out. Grid size per offer capped (e.g. ≤ ~12
  trial dates); total evaluations bounded and asserted in a perf pin (§10). Each
  evaluation is one projection pass (`O(horizon)` day loop,
  `js/projection-optimizer.js:205-220`).

---

## 6. Churn-hybrid candidates `[P2-1][P2-2][P2-3]`

**Synthesis `[P2-1]`:** churn candidates are built via the exact Run-again
pipeline — `templateToOffer(offerToTemplate(sourceOffer))`
(`js/events-actions-data.js:620`, `churnRunAgain`). This yields a fresh
`prospect` offer, blank dates, `includeInScenario:true`, `last_edited:null`
(`js/requirements-templates.js:419-476`). The engine then treats it like any
dated candidate (§1), scheduling its group within its windows.

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

**Pure, deterministic, no `App`/DOM/`Sync` imports.** It may import pure helpers
from `date-format-core.js` and **config-threaded** variants of the DD/offer
helpers (per C1/C4, step 3 refactors `ddRoundTrip(dd, ddTransferCfg)` and a
projection kernel taking explicit `ddTransfer` + `horizonDays` + evaluated-set;
existing UI callers keep `ddTransferConfig()` as the default). It must **not**
import `dd-widgets.js` as-is (that pulls `App` + `render` from
`render-shell-overview.js`, `js/dd-widgets.js:1,3`).

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
  offers:      [ ...active offers, ...candidate offers ],  // explicit union [P1-1]
  commitments: [ ... ],                // carried verbatim
  events:      [ ... ],                // carried verbatim
  candidateIds: Set<offerId>,          // which offers the engine may add/slide
  options: { maxDateGridPerOffer, iterationBudget, exactEnumMax: 7 }
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
      plannedSignupDate, optionalPlannedFundingDate,
      directDeposits: [ { id, plannedDate } ],   // ids preserved [P2-6]
      derived: { lockStart, withdrawalEligible, depositDeadline }
    }
  },
  capitalCurveSummary: {               // from the winning projection
    lowestAvailable, lowestDateISO, belowBufferDays, shortfallDays, horizonDays
  },
  bindingConstraints: [ { offerId, kind, dateISO } ],  // e.g. buffer floor / expiry / deposit-deadline
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

**One-shot undo snapshot** (captured BEFORE mutation, restored on undo):
```
UndoSnapshot = {
  [offerId]: {
    plannedSignupDate, optionalPlannedFundingDate,
    directDeposits: [ { id, plannedDate } ],
    includeInScenario, last_edited,
    requirements: <deep clone>          // sync mutates rows; restore verbatim
  }
}
```
A single "Undo" applies the snapshot through the same `App.update` path.

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
- **Horizon-overrun fixture** — candidate withdrawal >180d out is fully modeled
  (guards **C3 / `[P1-5]`**).
- **Local-origin sync guard** stays green (`js/events-actions-data.js:778`).

**Perf assertion:** ~10–20 candidates evaluate under the interactive budget
(< ~2 s phone-class); iteration count bounded and asserted `[P2-4]`.

---

## 11. Risks & open questions (for the step-2 gate)

1. **C1 refactor surface.** Threading `ddTransfer` through `ddRoundTrip` touches
   `withdrawalEligibleDate`, `ddCapitalTime`, `annualizedReturn`, and
   `generateProjection`. Decision needed: refactor those to accept an optional
   config (default `ddTransferConfig()`), vs. a parallel pure kernel in the
   engine. **This doc recommends the config-default refactor** — one day model,
   no drift — but it edits shipping functions, so the fidelity/feed battery must
   prove byte-stability. *Open: does step 2 accept editing `offer-model.js` /
   `projection-optimizer.js` signatures, or mandate a duplicated kernel?*
2. **C2/C3 are live bugs.** The shipping `runOptimizer` over-reports feasibility
   (drops confirmed offers) and truncates at 180d. The engine supersedes it, but
   should we also patch or retire the old `runOptimizer` + `applyOptimizerCombo`
   in the same run, or leave them until the UI cutover (step 4)? *Open.*
3. **Search combinatorics.** Subset × date-grid is far larger than today's `2^n`
   subsets. The ≤7 exact-enumeration bound `[P2-5]` plus a capped date grid keeps
   it interactive, but the perf cliff is real for wide-open windows — the coarse
   weekly pass (§5) is load-bearing. *Open: hard cap on total evaluations?*
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
