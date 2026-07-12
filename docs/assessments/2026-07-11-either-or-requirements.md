# EITHER/OR Qualification Paths — Design Note

**Run:** 2026-07-11 feature batch (v2026.07.11b candidate). **Gate:** this note is
the binding design contract; it is Codex-critiqued before any implementation.
Grounded in verified reads of HEAD `bcb8b62` (v2026.07.11a). Every `file:line`
below was checked against source.

**Owner ask (verbatim):** "when entering a new Brex bank offer that has 2
different options for meeting the requirements, in either a direct deposit, or a
card spend minimum, but not needing to do both, there was no way to account for
that on the card, and the DoC importer (and I assume the text parser) didn't seem
to account for that. Whatever the best way to implement that capability, carefully
proceed."

---

## 0. The problem in the current model

Today an offer carries **two independent requirement structures**, both treated
**conjunctively** (AND):

- `ddRequirement = {mode:'count'|'frequency', count, freqEvery, freqPeriods}` +
  the scheduled `directDeposits[]` — the direct-deposit path.
- `debitRequirement = {required, count, withinDays, byDate, byDateLegacy}` — the
  card-spend / debit-transaction path.

There is **no way to say "either one satisfies the bonus."** Confirmed by grep:
no `either`/`one of the following`/disjoint handling anywhere in the parser or
model. A Brex-style "DD **or** card-spend" offer is therefore mis-modeled — both
obligations are tracked, DD capital is always tied up, and both reminders fire,
even though the owner only needs to do one.

**Key capital fact (verified `js/projection-optimizer.js`, grep = no matches for
`debit|spend|purchase`):** `debitRequirement` creates **zero** capital events.
Only `directDeposits[]` (round-trip legs, `:162-171`/`:183-188`) and
`requiredFundingAmount` (held lump, `:191-195`) move the cash curve. So the two
paths have **very different capital footprints**: the DD path ties up money over
each round trip; the debit path ties up **nothing**. Choosing the path is
therefore a real capital-model decision, not a cosmetic label.

---

## 1. Schema (minimal-first) — DECIDED

Two new offer fields, both **absent-safe** so existing offers and old sync
payloads are byte-untouched (no migration mutation):

| Field | Values | Absent ≡ | Meaning |
|---|---|---|---|
| `requirementLogic` | `'all'` \| `'any'` | `'all'` | `'all'` = today's conjunctive semantics (unchanged). `'any'` = satisfy **either** the DD path **or** the debit path. |
| `plannedPath` | `'dd'` \| `'debit'` \| `null` | `null` | Which path the owner intends. Only meaningful when `requirementLogic==='any'`. |

**Backward-compat guarantee (the hard rail):** when `requirementLogic` is absent
or `'all'`, `plannedPath` is ignored and **every** consumer behaves exactly as
today. This is enforced structurally (see §2's single helper), so the entire
existing battery (fidelity 67, parser 20, feasibility 5, optimizer 61) must stay
green with zero pin edits except additions.

**Defaults:** added to `schemaV2Defaults()` (`requirementLogic:'all'`,
`plannedPath:null`) so a *new* offer written by the form carries them, but the v2
migration's "seed only if absent" rule means **existing** offers are **not**
rewritten (they simply read as `'all'`/`null` via the absent-safe helper). No
`yv-backup-pre-v2`-style migration is triggered.

### 1.1 Why NOT a general OR-group system (rail: reject unless blocker)

Rejected. Concrete reasons: (a) the only real-world case the owner has is the
**binary** DD-vs-debit choice; (b) the offer *already* has exactly two
first-class requirement structures (`ddRequirement`, `debitRequirement`) — a
binary flag maps onto them with zero new containers; (c) a general N-way OR-group
needs a new nested schema, a migration, group-aware validation, and group UI —
large surface, high regression risk, no demand; (d) the **P2-3 "never auto-pick"**
precedent (`docs/assessments/2026-07-09-optimizer-design.md §6`) maps cleanly onto
a binary path selector (exactly like the tier picker). If a genuine 3-way offer
ever appears, `plannedPath` can widen to an id without reopening the flag.

### 1.2 What represents the "card spend minimum"

The debit path is represented by the **existing `debitRequirement`** block (per
the rails). `debitRequirement` natively holds a transaction **count** + deadline
(`withinDays`), not a dollar figure. A dollar "spend $Y" minimum, if the owner
wants it recorded, rides an existing `source:'user'` `spend` requirement row (the
parser already emits `spendAmount` → a user row, `doc-import-templates.js:168`) —
**no new schema field.** This is a deliberate scope boundary: the either/or
plumbing switches between the DD structure and the debit structure; it does not
add a new "spend amount" first-class field. Documented as a known limitation.
Because the debit path has **zero capital footprint** regardless, the missing
dollar figure never affects the cash curve or the optimizer — only the reminder
copy, where the existing debit-count/deadline is sufficient.

---

## 2. The linchpin: one pure path-state helper — DECIDED

To guarantee the backward-compat rail *structurally* and avoid scattering
`requirementLogic` checks across 8 files, add ONE pure helper in
`js/offer-model.js` (exported), and route **every** capital/qualification/reminder
consumer through it:

```
pathState(offer) -> { logic, path, ddActive, debitActive, needsPath }

  logic = offer.requirementLogic === 'any' ? 'any' : 'all'
  hasDdPath   = offerType ∈ {direct-deposit, held-and-dd}      // a real DD obligation
  hasDebitPath= !!(debitRequirement && debitRequirement.required)

  if logic === 'all':                       // today, exactly
     ddActive    = hasDdPath
     debitActive = hasDebitPath
     path = null, needsPath = false
  else (logic === 'any'):
     path = offer.plannedPath ∈ {dd,debit} ? offer.plannedPath : null
     ddActive    = (path === 'dd')    && hasDdPath      // [Codex P1] defensive
     debitActive = (path === 'debit') && hasDebitPath   // [Codex P1] defensive
     needsPath   = (path === null)
```

`hasDebitPath = !!(debitRequirement && debitRequirement.required)`. The card-spend
path is represented by the `debitRequirement` block (§1.2); the importer sets
`debitRequirement.required` when it maps a detected card-spend either/or path, so
`hasDebitPath` is always real for an `'any'` offer.

**Proof of no-op for existing offers:** with `logic='all'`, `ddActive` reduces to
`offerType ∈ {direct-deposit,held-and-dd}` and `debitActive` to
`debitRequirement.required` — the *exact* conditions every current site already
tests. So swapping a raw `offer.offerType === 'direct-deposit' || …` test for
`pathState(offer).ddActive` is behavior-identical for all `'all'` offers, and the
harness proves it.

**`requirementLogic==='any'` is only *offered* (in the UI) when BOTH paths exist**
(`hasDdPath && hasDebitPath`). But the helper is defensive: if somehow `'any'` is
set with only one path present, the chosen/needs-path logic still resolves
sanely (an `'any'`+`path='dd'` with no debit block just behaves like DD-only).

### 2.1 Consumer routing (every site that must consult the helper)

| Site | File:line | Change |
|---|---|---|
| DD capital legs | `projection-optimizer.js:162-171,183-188` | wrap DD loop in `ddActive` (else skip). `logic='all'` DD-family → `ddActive=true` → unchanged. |
| Held lump | `projection-optimizer.js:191-195,181-182` | **unchanged** — `requiredFundingAmount` is orthogonal to the DD/debit choice; a held lump always applies. |
| DD cadence validation | `optimizer-engine.js:479-541 validateDdCadence` (called `:565`) | run only when `ddActive`. |
| Debit deadline validation | `optimizer-engine.js:556-559` | run only when `debitActive`. |
| `needsPath` → binding | `optimizer-engine.js:validateOfferQualification` | new `kind:'needs-path'` constraint when `needsPath`. |
| `isOfferComplete` DD-required | `offer-model.js:527-537` | require `directDeposits[]` only when `ddActive` (not merely offerType). |
| `offerIssues` | `offer-model.js:552-562` | same path-awareness for messages. |
| DD reminders | `reminders.js:113-143` | emit only when `ddActive`. |
| Debit reminder | `reminders.js:149-165` | emit only when `debitActive`. |
| Objective capital weight | `optimizer-engine.js:690-698` | DD-weight only when `ddActive`; else held/none. |
| Card DD block + debit chip | `render-main-views.js:938-952,974` | show chosen-path state; needs-info chip when `needsPath`. |
| Churn synth field copy | `optimizer-engine.js:140-218` | carry `requirementLogic` (a TERM) onto the synthesized candidate; **NOT** `plannedPath` (personal — re-run starts unchosen). [Codex P2 fix — was inconsistent with §6] |
| Template round-trip — **TWO** key lists | `requirements-templates.js:327` **AND** `optimizer-engine.js:34` | add `requirementLogic` to **both** `TEMPLATE_TERMS_KEYS` (else churn candidates drift). `plannedPath` in **neither** (personal → re-run starts unchosen, correctly re-prompting). [Codex P2] |
| DD-derived helpers read `directDeposits` directly | `offer-model.js:49-62 withdrawalEligibleDate`, `:78-97 lockStartDate`, `:438-473 ddCapitalTime` | gate the `direct-deposit` DD branch on `ddActive` (return `''`/null when the debit path is chosen). No-op for `logic='all'`. [Codex P1 — else a debit-path offer keeps a stale DD capital-back/hold/annualized figure] |
| Derived requirement rows | `requirements-templates.js:129-220 deriveRequirementsFromLegacy` | emit DD-count/per-DD rows only when the DD path is active, the debit row only when the debit path is active (inline path check — no `offer-model` import, avoids the cycle). No-op for `logic='all'`. [Codex P1 — else the card checklist shows a suppressed path] |
| Optimizer horizon dates | `optimizer-engine.js:614-629 horizonDatesForOffer` | push DD window/return dates only when `ddActive`; `debitDeadlineISO` only when `debitActive`. [Codex P1 — else a debit-path candidate is horizon-extended/exceeded on inactive DDs] |
| Optimizer schedule / canonical vector | `optimizer-engine.js:659-668 scheduleForOffer`, `:723-724 canonicalPlanVector` | serialize the DD vector only when `ddActive`. [Codex P1] |
| `isOfferComplete` funding gate | `offer-model.js:519-524` | require `requiredFundingAmount>0` only when `ddActive` or the type is `new-funds-held`/`held-and-dd` — a pure debit-path DD offer with no held lump can complete. [Codex P1] |

**`withdrawalEligibleDate` / `lockStartDate` / `ddCapitalTime` ARE made
path-aware [Codex P1 correction].** Their `offerType==='direct-deposit'` branch
reads `directDeposits[]` directly and feeds the card "capital back" date, the
timeline start, the horizon, safe-to-close, and the annualized-return stat — so
leaving them raw would give a **debit-path** offer (with stale DD rows still
stored) a phantom DD-based hold. The DD branch is gated on `ddActive`: when the
debit path is chosen it returns `''`/null (no hold — the debit path ties up no
capital, so capital-back is immediate). Every one of these gates is a **no-op for
`logic='all'`** (`ddActive` reduces to the offerType test), so the battery proves
no drift.

---

## 3. Semantics (P2-3 precedent — never auto-pick) — DECIDED

- **`logic='any'`, `plannedPath='dd'`:** DD path modeled & validated (DDs
  scheduled → capital legs; DD cadence checked). Debit obligation **suppressed**
  (no debit deadline validation, no debit reminder).
- **`logic='any'`, `plannedPath='debit'`:** debit deadline honored & validated.
  **No DD capital events**, no DD cadence validation, no DD reminders. Capital
  footprint = the held lump only (usually zero for a Brex DD-or-spend offer).
- **`logic='any'`, `plannedPath=null`:** the offer is **NOT silently modeled**:
  - Optimizer: **excluded as a candidate**, surfaced in `candidateReview` with
    `status:'needs-date'`, `reason:'needs-path'` (a specific row). Tap-through
    opens the edit modal with the **path selector flash-highlighted** (reuse the
    `focusOfferField`/`yv-field-flash` idiom).
  - Live projection: an included/committed such offer contributes **no DD
    capital** (path unknown → not fabricated) — the held lump still applies if
    present. The card shows a **needs-info chip** ("choose qualification path").
  - The optimizer **never** chooses the path for him.

**Feed delta (intentional, documented):** for a chosen path, only that path's
reminders emit; the unchosen path's reminders are **withheld** (no nag). For an
unchosen `'any'` offer, **neither** DD nor debit reminders emit (the offer is
in a needs-info state) — the needs-info chip is the prompt, not a feed item.
This is the intended behavior, not a regression.

---

## 4. Modal / card UI — DECIDED

**Form (`modals-forms.js`).** Insert an **"How to qualify"** control between the
DD section (ends `:177`) and the debit block (`:178`). It renders the
`requirementLogic` choice and, when `'any'`, the `plannedPath` selector:

- A checkbox/toggle "This bonus can be met **either** way (DD **or** card
  spend) — I only need to do one" → sets `requirementLogic`. Visible/enabled only
  when both blocks are populated (DD-family offerType **and** debit = Yes), or the
  user can enable it to reveal both blocks.
- When `'any'`: a radio `plannedPath` — **Direct deposit** / **Card spend** /
  **Decide later** (default **Decide later** = null; never auto-pick, P2-3).
- Wire into the existing delegated `change` listener (`:568-637`): on
  `requirementLogic`/`plannedPath` change, re-run `syncDdSectionUI`-style show/hide
  so the *inactive* path's inputs read as de-emphasised (not removed — the offer
  still stores both blocks). `readOfferForm` (`:1213-1349`) reads both new values
  (near the `offerType`/`ddRequirement`/`debitRequirement` reads, `:1226-1251`)
  and attaches them to the offer before `syncRequirementsWithLegacy` (`:1347`).

**Card (`render-main-views.js`).** When `logic='any'`:
- `plannedPath` chosen → a compact chip "via Direct deposit" / "via Card spend"
  (the chosen path), and the *unchosen* block's chip/DD-rows are **not** shown
  (or shown muted as "or …"). Keep 380px clean.
- `needsPath` → the **needs-info chip** "Choose how to qualify" (extend
  `OFFER_NEEDS_INFO_COPY`/`offerNeedsInfoChip` `:803-814`). **Gate fix:**
  `offerNeedsInfoReason` currently early-returns unless the offer is hypothetical
  (`:790`); a needs-path offer can be **committed**, so the needs-path reason must
  be checked *before* that hypothetical gate (or the gate widened for this
  reason).

---

## 5. Parser / importer — DECIDED (conservative, corpus-safe)

**Detection (`js/doc-parser.js`).** Add a pure `docDetectEitherOr(text)` run
**after** the existing field scans, firing `requirementLogic:'any'` (confidence
`high`) **only** on a high-confidence disjunction that names **both** a DD term
**and** a spend/debit term inside one connective clause. Patterns (all required to
co-occur):
- an explicit connective: `either`, `\bor\b` bridging the two, or
  `one of the following` / `any of the following` heading a list; **and**
- a DD signal (`direct deposit`) **and** a spend/debit signal
  (`spend`, `debit`, `purchase`) within the same clause/list window.

**Corpus-safety (the hard rail).** The detector is **purely additive**: it emits
the new `requirementLogic` field and does **not** overwrite any existing scored
field (`ddRequired`, `debitCount`, `spendAmount`, `requiredFundingAmount`, …).
Concretely it only sets `requirementLogic:'any'` when the disjunction is present
**and** the normal detectors already produced both a DD signal and a debit/spend
signal. Therefore **no scored field value changes on any corpus post** →
`score.js` field accuracy is byte-identical (a new, gold-silent field counts at
most as `extra(unverified)`, never `wrong`/`missed`). The 20 regression pins and
17 dd-matrix cases are unaffected (none exercises disjunction). Re-run the corpus
harness and report the number; if posts can't be re-hydrated, the additive-only
construction is the byte-identity argument.

**Importer (`js/doc-import-templates.js`).** When the parse carries
`requirementLogic:'any'`, `renderDocPreview` shows a **path picker** modeled on
the tier picker (`_docRenderTierGroup` `:339-408`, `docTierSelect` `:515-523`):
radios **Direct deposit / Card spend / Decide later**, default **Decide later**
(null — never auto-pick, P2-3). `docImportApply` writes
`offer.requirementLogic='any'` + `offer.plannedPath = picked|null`, and ensures
**both** requirement blocks are populated on the form (DD via the existing
`_docWireDdModel`, debit via the existing `debitCount` apply). The user picks the
path in review exactly like the tier picker.

---

## 6. Engine, apply/undo, pins — DECIDED

- **Validator** honors `pathState`: DD cadence only when `ddActive`; debit only
  when `debitActive`; `needs-path` binding + review row when `needsPath`. Add
  `'needs-path'` to `VALIDATOR_REVIEW_KINDS` (`optimizer-engine.js:576-578`) so
  the row surfaces, and to `OPT_REVIEW_REASON_COPY` + `optReviewFocusField`
  (`render-main-views.js:64-77,105-117`) with the path-selector element id.
- **Candidate build:** an `'any'`+`needsPath` offer is **excluded** from the
  candidate pool and surfaced as a `needs-date`/`needs-path` review row (mirrors
  the missing-churn-anchor idiom, `:445`).
- **Churn synth (`:140-218`):** copy `requirementLogic` (a term) onto the
  synthesized candidate; **do not** copy `plannedPath` (personal) → a re-run
  starts unchosen and re-prompts. Materialize DDs only when the (chosen) path is
  DD.
- **Apply (`applyOptimizerPlan`) / template round-trip:** carry
  `requirementLogic` + `plannedPath` faithfully (update path writes both; the
  template round-trip carries `requirementLogic` via TEMPLATE_TERMS_KEYS,
  `plannedPath` resets to null by construction). Undo deep-clone already captures
  whole offers → both fields restore for free.
- **New pins (optimizer harness, `_pinOffer` seeds `requirementLogic:'all'`,
  `plannedPath:null` so existing pins are unchanged):**
  1. `'any'`+`plannedPath='dd'` → DDs modeled + validated (capital legs present,
     included when feasible).
  2. `'any'`+`plannedPath='debit'` → **no DD capital events** (curve identical to
     the DD-less baseline), debit deadline honored.
  3. `'any'`+`plannedPath=null` → excluded with a `reason:'needs-path'` review row.
  4. determinism across runs for an either/or plan.
  Plus a **feasibility pin** (projection-optimizer) that a `plannedPath='debit'`
  offer contributes zero tied-up capital vs the same offer on `'dd'`.

---

## 7. Release

Full battery green (fidelity 67, parser 20 + corpus ≥84.9%/byte-identity, p2b,
dd-matrix, feasibility 5→6, optimizer 61→65) + preview E2E (manual Brex-style
either/or offer → choose each path → optimize; import-flow path prompt) + 380px;
`APP_VERSION` → `2026.07.11b` in the 3 coupled places + stray sweep; HANDOFF R87;
push; rev-list 0. Owner-owned dirty paths (`.claude/settings.json`, `AGENTS.md`,
`CLAUDE.md`, deleted `.codex/hooks.json`) untouched — explicit-path `git add`.

---

## 8. Risk register

| Risk | Mitigation |
|---|---|
| A raw `offerType` test missed → path not honored somewhere | The §2.1 table enumerates every site; helper is the single gate; pins cover DD/debit/null. |
| Existing offers behavior drift | `logic='all'` reduces the helper to today's exact conditions; full battery unchanged proves it. |
| Parser regression below 84.9% | Additive-only detection; no scored field changes; re-run + report. |
| `isOfferComplete` blocks a debit-path offer with no DDs | Require DDs only when `ddActive`; pin the debit-path complete case. |
| Needs-path chip hidden on committed offers by the hypothetical gate | Check needs-path before the `HYPOTHETICAL_OFFER_STATUSES` early-return. |
| Held-and-dd + `'any'` ambiguity | Out of scope: `'any'` is offered only for the DD-vs-debit binary; a held lump always applies. Documented. |

---

## 9. Codex critique fold (RUNG 1 — `gpt-5.5`, ran clean)

The design was critiqued by Codex (`codex exec --sandbox read-only -m gpt-5.5`,
default profile, ran clean — RUNG 1). Verdict: **needs-revision, 6 P1 / 5 P2 /
3 P3**; every finding is folded above as a binding amendment. Dispositions:

**P1 (all adopted):**
1. **`pathState` not defensive** → §2 pseudocode now `ddActive = path==='dd' &&
   hasDdPath`, `debitActive = path==='debit' && hasDebitPath`.
2. **`withdrawalEligibleDate`/`lockStartDate` (and `ddCapitalTime`) read
   `directDeposits` raw** → §2/§2.1 now gate their DD branch on `ddActive`
   (no-op for `'all'`); prevents a phantom DD hold on a debit-path offer.
3. **`isOfferComplete` hard-requires `requiredFundingAmount>0`** → §2.1 gates that
   requirement so a pure debit-path DD offer with no held lump can complete.
4. **Card-spend path may not exist as `debitRequirement`** → §1.2/§2 pin the
   debit path to the `debitRequirement` block and make the **importer set
   `debitRequirement.required=true`** for a detected card-spend either/or (dollar
   rides a `spend` user row). A first-class spend-dollar path is a documented
   future enhancement.
5. **`deriveRequirementsFromLegacy` shows both paths** → §2.1 gates derived
   DD/debit rows by the active path (inline, no import cycle).
6. **Optimizer horizon/schedule/canonical ignore path** → §2.1 adds
   `horizonDatesForOffer`, `scheduleForOffer`, `canonicalPlanVector` to the
   `ddActive`/`debitActive` gate list.

**P2 (all adopted):**
- Schema wording → clarified: existing **v2** offers are absent-safe (not
  rewritten); pre-v2 offers may be seeded `'all'`/`null` during the one-time v2
  migration, which is **semantically a no-op**. Fields added to `templateToOffer`
  intentionally (`requirementLogic` carried; `plannedPath` reset to null).
- Parser "byte-identical" softened → **existing scored field values** are
  byte-identical (verified against `score.js`'s field set); the new
  `requirementLogic` key is not in the scored set.
- **Fee-waiver false positive** → the either/or detector requires a
  qualification/bonus context (`qualify|earn|receive|bonus|requirement`) AND
  rejects fee-waiver context (`waive|avoid|monthly fee`); a negative pin guards
  "avoid the fee with a DD or debit purchases" prose.
- **Churn/template inconsistency** → resolved: `requirementLogic` copied (term),
  `plannedPath` reset (personal). §2.1 table corrected.
- **Two `TEMPLATE_TERMS_KEYS`** → §2.1 adds `requirementLogic` to **both**
  (`requirements-templates.js:327` + `optimizer-engine.js:34`).

**P3 (adopted / noted):**
- `ddWindowEndDate` (`dd-core.js`) stays import-free; gated at its consumers
  (reminders DD block + optimizer horizon) — already covered by the DD gates.
- **Modal flow made deterministic:** the "either way" toggle is always visible;
  checking it sets `requirementLogic='any'`, reveals the `plannedPath` selector,
  and shows both blocks active; unchecking → `'all'`. Read/write pinned by the
  form round-trip.
- **Review-row status:** reuse `status:'needs-date'` (the existing row-class +
  tap-through-focus bucket) with the specific `reason:'needs-path'` driving the
  copy + the path-selector focus target — avoids touching the render row filter.
- Pin counts (feasibility 5→6, optimizer 61→65) are **targets**, confirmed after
  the tests land.
