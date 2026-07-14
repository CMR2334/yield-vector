# Requirements-Driven Qualification Paths — Design Addendum

**Run:** 2026-07-13-capital-event-picker-chart-bonusmet, Step 2 (phases A+B
merged). **Generalizes:** `docs/assessments/2026-07-11-either-or-requirements.md`
(the binary DD-vs-debit either/or). **Binding pins:** run checkpoint Key-decisions
(1)–(10). This note restates decisions (6)–(9) and inventories every consumer.

---

## 0. What changes and why

The 2026-07-11 either/or model hard-coded a **binary** choice: a DD-family
`offerType` versus `debitRequirement.required`. The owner's Brex offer is a
**hold-OR-card-spend** bonus (new-funds-held with a card-spend alternative), which
the binary model cannot express — its chooser only ever offered "Direct deposit".

The generalization makes qualification-path **availability derive from the offer's
requirement ROWS** (derived + user), classified by a fixed family map, instead of
from `offerType`/`debitRequirement` alone. Three qualification families —
`dd`, `debit`, `hold` — become the choice set; a chooser appears whenever **≥2**
choosable families are present. `plannedPath` gains `'hold'`.

The **hard rail is unchanged**: under `requirementLogic` `'all'` (default/absent)
every consumer reduces **byte-identically** to today's semantics, proven by the
existing pin battery staying green with no edits.

---

## 1. Decision (6) — path FAMILY map (requirement TYPE → path key)

Lives in `js/requirements-templates.js` as `REQUIREMENT_PATH_FAMILY`
(+ `requirementPathFamily(type)`), colocated with the type list so the two can't
drift; imported by `offer-model.js` (no cycle — templates never imports
offer-model).

| Family | Requirement types | Display label |
|---|---|---|
| `dd` | `direct_deposit_amt`, `direct_deposit_count` | Direct deposit |
| `debit` | `spend`, `debit_txns`, `transactions` | **Card spend** |
| `hold` | `deposit`, `maintain_balance` | Hold funds |
| *(neutral)* | `activate_debit`, `estatements`, `online_banking`, `promo_code`, `custom` | — always active |

`plannedPath` stays **type-keyed** — `'dd'` \| `'debit'` \| `'hold'` — never
row-id-keyed. A path = **every** row in that family (decision 9). Saved
`'dd'`/`'debit'` values keep working unchanged. N-of-M logic is OUT of scope.

## 2. Decision (7) — availability derives from live rows

`pathState(offer)` now returns
`{ logic, path, ddActive, debitActive, holdActive, needsPath, families }`.

- `families` = the distinct path families present (via the family map over
  `offer.requirements`, with legacy-field fallbacks so detection is robust before
  the derived rows are materialized). This is the raw "what could qualify" set.
  **Perf note:** `pathState` is a beam-search hot path and the capital/
  qualification consumers read only the active flags, so `families` is returned
  as an empty array on the `'all'` fast path (no requirement scan there) — the
  path chooser never renders for an `'all'` offer, and any cold caller wanting the
  present set on an `'all'` offer calls `offerPathFamilies(offer)` directly. It is
  populated normally on the `'any'`/degenerate branches. This keeps the existing
  beam wall-clock pin green.
- **Choosable** paths (`choosablePaths(offer)`, exported, shared by pathState +
  the modal chooser): `dd` when a `dd` row is present **and** `offerType` is
  DD-family; `debit` when a `debit` row is present; `hold` when a `hold` row is
  present **and** `offerType === 'new-funds-held'`.
- **held-and-dd keeps its hold UNCONDITIONAL** — its hold is a footprint
  assertion, not a qualification choice, so `hold` is never choosable for it and
  `holdActive` is **always true**; its chooser is dd-vs-debit only.
- **Only `new-funds-held` can put `hold` in the either/or.**
- `offerType` no longer gates the chooser directly; it only shapes which families
  are choosable (the two rules above).

`requirementLogic` semantics by branch:

- **`'all'` (default/absent):** `ddActive = DD-family offerType`,
  `debitActive = debitRequirement.required`,
  **`holdActive = (offerType !== 'direct-deposit')`** — the literal predicate every
  held-lump consumer used pre-87ff38c. `path=null`, `needsPath=false`, and rows are
  never filtered. **Byte-identical to today.**
  (H1 fix-up, 2026-07-14: the initial commit derived `holdActive` from the
  `HELD_LUMP_TYPES` allow-list `{new-funds-held, held-and-dd, other}`, which dropped
  a **MISSING/unknown** `offerType` to `holdActive:false` — but the legacy/seed case
  with an absent `offerType` took the held branch before, and `reminders.js:91-95`
  explicitly guarded on `offerType !== 'direct-deposit'`. `holdActive` is now that
  literal predicate, so a typeless offer keeps its held-lump modeling. `HELD_LUMP_TYPES`
  survives ONLY as the family-detection allow-list in `pathFamilyFlags` — which
  enumerated types seed the `hold` family — and no longer derives `holdActive`.
  'other' is a legacy catch-all normalized to `new-funds-held` at every write path.)
- **`'any'` with <2 choosable paths (degenerate):** falls back to the `'all'`
  active flags so capital is never spuriously dropped (the chooser never renders
  in this case anyway). `needsPath=false`.
- **`'any'` with ≥2 choosable paths:** `path = plannedPath` when it is in the
  choosable set, else `null`; `needsPath = (path === null)`. Active flags:
  `ddActive = path==='dd'`; `debitActive = path==='debit'`;
  `holdActive = (offerType is held-and-dd/other) ? true : (offerType is
  new-funds-held && path==='hold')`.

## 3. Decision (8) — path-aware lifecycle filtering

`requirementActive(offer, row)` (offer-model.js, exported): neutral rows and all
`'all'`-logic rows are **always active**; under `'any'` a `dd`/`debit`/`hold`
row is active iff the corresponding `ddActive`/`debitActive`/`holdActive` is true.
Non-chosen-family rows are excluded from: checklist counts + rendered checklist,
requirement deadlines (safe-to-close, optimizer requirement/DD-cutoff/horizon
scans), and requirement-deadline reminders, and `allRequirementsDone`. Neutral
rows always count. Byte-identical for `'all'` (every row active).

`deriveRequirementsFromLegacy` **no longer filters** derived rows by
`plannedPath` — it emits the full obligation set for every family (so
`offer.requirements` is the complete set family-detection reads). The path filter
moved to the consumers above. This keeps `'all'` byte-identical (it already
emitted every row) while making family detection see all paths.

## 4. Decision (9) — type-keyed, N-of-M out of scope

`plannedPath` is a family key, not a row id; no schema/migration bump (loose
absent-safe fields, `'all'` default). N-of-M ("2 of these 3") is backlogged.

---

## 5. Consumer inventory

Everything reading `pathState`/`requirementLogic`/`plannedPath` or keying capital
on `offerType`, and how each changes. **No-op for `'all'`** unless noted.

### offer-model.js
| Consumer | Change |
|---|---|
| `pathState` | Generalized (§2). New `holdActive`, `families`; new `choosablePaths` helper. |
| `requirementActive` | NEW helper (§3). |
| `_heldReleaseDate` / `withdrawalInitiateDate` (held branch) | Gate held-release on `holdActive` → `''`/null for a debit-path new-funds-held (no hold, no capital). held-and-dd/other stay true. |
| `withdrawalEligibleDate` (held branch) | Same `holdActive` gate. |
| `lockStartDate` (held branch) | Same `holdActive` gate → `''` when hold inactive, so the projection's lump block gets `start=null` and skips. |
| `ddCapitalTime` | Already `ddActive`-gated (DD legs). held-and-dd lump path unchanged (holdActive always true). |
| `annualizedReturn` (new-funds-held/other branch) | Gate on `holdActive` → `null` for a debit-path new-funds-held (no held capital). |
| `allRequirementsDone` | Count only `requirementActive` rows; empty active set → false. **(M2 fix-up 2026-07-14: also returns `false` while `pathState(offer).needsPath` — an `'any'` offer with no path chosen must not read "all met" from neutral rows alone and advance to met-waiting. Byte-identical for `'all'`: `needsPath` always false.)** |
| `bonusWindowAnchor` | **(M1 fix-up 2026-07-14: the latest-`done_date` scan now skips non-`requirementActive` rows — a completed DORMANT-path row can no longer anchor the expected-bonus window / safe-to-close months late. Neutral rows still anchor. Byte-identical for `'all'`.)** |
| `safeToCloseDate` | (a) `withdrawalEligibleDate` already gated; (b) expected-bonus window END now via the M1-fixed `bonusWindowAnchor`; (d) unmet-deadline loop skips inactive rows via `requirementActive`. |
| `isOfferComplete` / `offerIssues` | Already `ddActive`-gated for DD/funding; unchanged (held-lump requirement still keyed on offerType, which is correct — a hold-path or all offer still needs its funding). |

### requirements-templates.js
| Consumer | Change |
|---|---|
| `REQUIREMENT_PATH_FAMILY` / `requirementPathFamily` | NEW export (§1). |
| `deriveRequirementsFromLegacy` | Drop the `plannedPath` row filter — always derive the full obligation set (§3). |

### projection-optimizer.js
| Consumer | Change |
|---|---|
| §2 virtual-commitment loop, new-funds-held/other lump block | Gate on `ps.holdActive` (lockStartDate already returns `''` when inactive, but gate explicitly for clarity + the daysFundsMustRemain fallback). held-and-dd lump unchanged (holdActive true); DD legs already `ddActive`. |

### optimizer-engine.js
| Consumer | Change |
|---|---|
| `validateDdCadence` | Already `ddActive`-gated; its requirement-cutoff scan skips inactive rows via `requirementActive`. |
| `validateOfferQualification` | `needsPath` binding already emitted; requirement-deadline loop skips inactive rows. **(H2 fix-up 2026-07-14: the `deposit-deadline` constraint is now gated on `ps.holdActive`, not the raw `offerType !== 'direct-deposit'` — a debit-path/dormant-hold offer funds nothing on its chosen path, so a stale `optionalPlannedFundingDate` no longer excludes it. Byte-identical for `'all'`: `holdActive === offerType !== 'direct-deposit'`.)** |
| `horizonDatesForOffer` | Requirement-deadline pushes skip inactive rows; DD/debit already path-gated; held dates via the gated lockStart/withdrawalEligible. **(H2 fix-up: the `depositDeadline` horizon push is now gated on `ps.holdActive` so a dormant-hold deadline can't extend the plan horizon.)** |
| `scheduleForOffer` / `offerReleaseWeights` | DD already `ddActive`-gated; held lump via gated withdrawalEligible/lockStart. **(H2 fix-up: the schedule row's `derived.depositDeadline` — a plan-identity field — is now gated on `ps.holdActive`; a dormant-hold offer emits `''`.)** |
| `objectiveForOffers` capital weight | new-funds-held/other else-branch weight gated on `holdActive` (its daysFundsMustRemain fallback would otherwise weight a debit-path offer). |

### reminders.js
| Consumer | Change |
|---|---|
| deposit-deadline (`fundsLump`) | `fundsLump = pathState(o).holdActive` (was `offerType !== 'direct-deposit'`; byte-identical for 'all'). No fund-a-lump nag on a debit-path new-funds-held. |
| dd-initiate / dd-window-end | Already `ddActive`-gated. |
| debit-deadline | Already `debitActive`-gated. |
| requirement-deadline (user rows) | Skip inactive rows via `requirementActive`. |

### render-main-views.js
| Consumer | Change |
|---|---|
| `requirementChecklistCounts` / `renderRequirementChecklist` | Count/render only `requirementActive` rows. |
| `eitherOrChip` | Generalized to name the chosen path (DD / card spend / hold), truthful per family. |
| `OFFER_NEEDS_INFO_COPY['needs-path']` | Copy generalized (no longer "DD or card spend" only). |
| DD block / debit chip / chart markers | Already `ddActive`/`debitActive`-gated. **(H2 fix-up 2026-07-14: the hero-chart `deposit-deadline` MARKER for a held type is now gated on `psO.holdActive` — a dormant-hold (debit-path) new-funds-held offer renders no deposit-deadline dot. held-and-dd still excluded separately; direct-deposit still gated on `ddActive`.)** |

### modals-forms.js
| Consumer | Change |
|---|---|
| `reqMetPaths` / `reqMetSectionField` / `syncReqMetSection` | Generate the "How is this bonus met?" chooser from `choosablePaths` of the LIVE requirements offer (≥2 choosable families). Labels Direct deposit / Card spend / Hold funds. Fix the stale "e.g. Brex" DD copy. |
| Change-listener wiring | Rebuild the chooser on requirement-row add/remove/type change AND legacy offerType/debitRequired toggles, preserving an in-progress logic/path choice. |
| `buildLiveRequirementsOffer` | Carries live logic/plannedPath; derived rows now unfiltered so families are all visible. |
| `readOfferForm` | `plannedPath` accepted only when in `choosablePaths(offer)` after the derived sync, else null. |

---

## 6. New pins (added to the optimizer/feasibility harness)

- **Brex debit-path ties up ZERO capital:** a new-funds-held `'any'` +
  `plannedPath='debit'` offer contributes no tied-up capital to the projection
  (curve identical to the DD-less/held-less baseline) — vs the same offer on
  `plannedPath='hold'` which models the held block.
- **Hold-path models the block:** new-funds-held `'any'` + `plannedPath='hold'`
  ties up `requiredFundingAmount` across the hold, exactly like the `'all'` case.
- **`'all'` unchanged:** the existing battery stays green with no pin edits
  (byte-identity rail).

### 6a. Fix-up pins (2026-07-14 adversarial-review findings H1/H2/M1/M2)

Added to the SAME harnesses (`testFeasibilityPins` in projection-optimizer.js;
`testOptimizerPins` in optimizer-engine.js). Batteries after fix-up:
**optimizer 85/85, feasibility 21/21, parser 20/20, fidelity 67/67, dd-matrix PASS,
p2b PASS; beam wall-clock 2071 ms < 2200 ms budget.**

- **H1 (feasibility):** an offer with `offerType` **undefined** keeps its held-lump
  modeling — `holdActive === true`, a real `lockStartDate`/`withdrawalEligibleDate`,
  and its projection ties up `requiredFundingAmount` (curve dips) — restoring
  pre-87ff38c behavior for the legacy/seed typeless case.
- **H2 (optimizer):** a new-funds-held `'any'` + `plannedPath='debit'` offer with a
  stale `optionalPlannedFundingDate` past the deposit deadline is **NOT** excluded by
  `deposit-deadline` and its schedule row emits **no** `derived.depositDeadline`;
  the `plannedPath='hold'` control **still** enforces + emits the deadline (gate, not
  a dead branch). (The chart-marker gate shares the same `holdActive`; a DOM
  assertion is owed in Step 3.)
- **M1 (feasibility):** an `'any'` offer with the chosen (hold) row done earlier and a
  dormant (card-spend) row done later anchors `bonusWindowAnchor` on the **chosen**
  path's `done_date`, not the later dormant one.
- **M2 (feasibility):** an `'any'` offer with `plannedPath=null` (needsPath) whose only
  done rows are **neutral** yields `allRequirementsDone === false` and
  `shouldSuggestWaiting === false`.
