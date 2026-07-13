# Hold-release transfer lag — eligibility vs. landing (2026-07-13)

## The bug (owner-confirmed)

> "It should factor in actual cash deposit dates for when capital will be
> dispensed... if those overlap such that I go below my buffer, that's not an
> optimal plan and can't be an option."

The day model treated held capital as **spendable the same calendar day it
becomes withdrawal-eligible**. Tied-up intervals are `[start, end)` with the
eligibility date exclusive, so an offer whose withdrawal-eligible date was
Jul 17 was already spendable on Jul 17 — the same day a *different* offer funding
Jul 17 was debited. That is optimistic same-day netting: a hold release was
credited before a same-day funding debit.

Direct deposits never had this bug: `ddRoundTrip().returnDate` already bakes in
the return-transfer `backDays`, so a DD lands (is spendable) only on its
`returnDate`. Hold releases had **no analogous transfer-back leg** — the money
was assumed to teleport from the bonus bank into the spendable hub the instant
the bank permitted withdrawal.

Codex audit (`/tmp/yv-cash-ordering-audit.log`, VERDICT: OPTIMISTIC-NETTING
CONFIRMED) traced the owner's live case: a plan funding BMO $25k + Old National
$20k on the exact day Brex's $50k released claimed low cash **+$24,500** on
Jul 17; with a one-business-day return leg it is actually **−$25,500**.

## Eligibility vs. landing — two distinct dates

| Concept | Function | Meaning | Consumers |
|---|---|---|---|
| **Withdrawal-eligibility / hold-release** | `withdrawalInitiateDate(offer, cfg)` | The day the bank first permits withdrawal — when the owner *initiates* the return ACH back to the hub. | The withdraw **reminder** ("go withdraw now"), which must fire on release, not after the money has landed. |
| **Capital-back / landing** | `withdrawalEligibleDate(offer, cfg)` | The day the money is fully back in the hub and **spendable again** = hold-release + `ddTransfer.backDays` business days. | The **day model** (projection tied-up interval end), the optimizer **horizon**, plan **capital-back** metric, sequence-card "Capital back", champions/edge math, completion tie-break, offer-card "Capital back", timeline bar end, "days tied up". |

For **direct-deposit** offers the two coincide with the round-trip: `returnDate`
already includes `backDays`, so `withdrawalEligibleDate == withdrawalInitiateDate`
(no double lag). This makes DD and held **symmetric**: both return the landing
date, and both are spendable **ON** that day in the `[start, landing)` interval.

`backDays = 0` degenerates to the pre-fix behavior (landing == release).

## Implementation

`withdrawalEligibleDate` (offer-model.js) now returns the landing date for held
types by adding `ddTransfer.backDays` **business** days to the bank hold-release
date (shared `_heldReleaseDate` core, so the hot beam-search path avoids a
string↔Date round-trip). Every capital-back surface already routed through
`withdrawalEligibleDate`, so the projection, horizon, optimizer metric, champions,
sequence card, and timeline all became landing-consistent through this one
change — no downstream logic edits. The **reminder** was repointed to the new
`withdrawalInitiateDate` so its "go withdraw" prompt keeps firing on the
hold-release date.

The Optimize panel gained a **current-state banner** (`--danger-deep` muted
maroon): when the *entered* schedule already dips below buffer (per Home's
`generateProjection(App.state)`), it says the current schedule dips to −$X on
`<date>` and either that the proposal reschedules to stay above buffer (post-run,
feasible) or to run the optimizer to fix it (pre-run).

## Verification

Feasibility pins 7→12 (Clag-A landing boundary, Clag-B backDays 0/1/3 variants,
Clag-C the exact audit Jul-17 arithmetic: backDays=0 → +$24,500, backDays=1 →
−$25,500, swing = Brex's $50k; Clag-E the exported `runOptimizer` honors
`state.ddTransfer.backDays`). Optimizer pins 82→83 (Clag-D: the engine
re-sequences a candidate past the **landing** date, not the release day, and the
plan stays buffer-safe). A Codex adversarial review-after (RUNG 1) folded one
medium: the legacy `runOptimizer`/`optimizerHorizonForState` feasibility path now
threads `state.settings.ddTransfer` (Clag-E guards it). Preview E2E on the seeded
audit scenario: Home shows
−$25,500 / 3 shortfall days; the optimizer spreads BMO and Old National from
Jul 17 to Jul 22 (past Brex's Jul 20 landing), keeping BofA at Jul 15, low cash
$19,500, buffer-safe.
