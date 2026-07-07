# Schema v2 data layer + migration — design

**Date:** 2026-07-07
**Scope:** Additive schema-v2 data layer for offers in `index.html` (single-file PWA).
Design-first document for orchestrated implementation step 2. Five later feature
steps (3–7) build on this layer; this step ships the **data layer + migration +
restore path only** — zero new visible form inputs (except the Settings restore
button), zero feed-code changes.

**Guiding principle:** *legacy fields stay canonical for every existing consumer.*
The new `requirements[]` rows are layered **over** the legacy fields as a
richer, forward-looking representation. Existing readers keep reading legacy
fields untouched; only genuinely-new requirement types (e-statements, maintain
balance, promo code, etc.) live exclusively as rows. Nothing in this step changes
what any current consumer computes.

---

## A. Consumer inventory (grep-verified)

Every reader/writer of each legacy offer field that a schema change could affect.
Line numbers are from `index.html` at the time of writing (APP_VERSION
`2026.07.07b`). "Canonical rep" = which representation is authoritative for that
consumer after v2.

### Migration / lifecycle plumbing (writers on load)
| Function | Line | Role |
|---|---|---|
| `normalizeOfferStatus` | 2581 | writes `subStatus`/`accountStatus`/`status` |
| `migrateDdIds` | 2598 | mints stable `directDeposits[].id` |
| `migrateDebitRequirement` | 2618 | `debitRequirement.byDate` → `withinDays`, stashes `byDateLegacy` |
| `reconcileDebitWithinDays` | 2639 | lazily derives `withinDays` once a sign-up date exists |
| `App.init` migration loop | 4207-4210 | calls the four above per offer |
| **`migrateOffersToSchemaV2` (NEW)** | *added after 4210* | adds v2 fields + runs derivation |

### Field-by-field

**`ddRequirement` {mode,count,freqEvery,freqPeriods}**
- WRITE: `readOfferForm` :8079-8084 (constructs from form).
- READ: DD-requirement / reminder / projection code (see agent inventory
  addendum for exhaustive list — `renderOfferCard` :5984, `showOfferModal`
  :7455, DD-method / round-trip logic ~:8007). Feed keys `yv-<offerId>-dd-<ddId>`.
- **Canonical rep:** LEGACY. Derived rows `req-dd-<ddId>` mirror it read-only.

**`debitRequirement` {required,count,withinDays,byDate,byDateLegacy}**
- WRITE: `readOfferForm` :8095-8101; `migrateDebitRequirement` :2618;
  `reconcileDebitWithinDays` :2639.
- READ: reminder feed (`buildReminderItems` :5371), card/table/modal renders.
- **Canonical rep:** LEGACY. Derived row `req-debit` mirrors it read-only.

**`directDeposits[]`** (rows: {id,plannedDate,amount,…})
- WRITE: `readOfferForm` :8111 via `readDdRowsFromForm`; ids minted by
  `migrateDdIds` :2598.
- READ: `directDepositEffectiveDate` :3752, feed items, projection, card render.
- **Canonical rep:** LEGACY. Derived rows `req-dd-<ddId>` (direct_deposit_amt /
  direct_deposit_count) mirror per-DD identity read-only.

**`requiredFundingAmount`**
- WRITE: `readOfferForm` :8113 (via `parseMoneyInput`).
- READ: `simpleReturn` :4441, projection/ROI, card/table/modal, optimizer.
- **Canonical rep:** LEGACY. Derived row `req-funding` (type `deposit`) mirrors it.

**`signupBonusAmount`** — WRITE `readOfferForm` :8114; READ `simpleReturn` :4442,
ROI, card/table, events seed. **Canonical rep:** LEGACY (no derived row; bonus is
not a "requirement", it's the reward). Step 4 lifecycle reads it for the
expected-bonus-window feed item.

**`daysAfterSignupAllowedBeforeDeposit`** — WRITE `readOfferForm` :8117; READ
funding-window / DD scheduling. Used by derivation to compute the funding
deposit row's `deadline_days`. **Canonical rep:** LEGACY.

**`daysFundsMustRemain`** — WRITE `readOfferForm` :8118; READ hold/lock math,
`withdrawalEligibleDate`, `safeToCloseDate` :4433. Used by derivation for the
funding row's `hold_days`. **Canonical rep:** LEGACY.

**`optionalPlannedFundingDate`** — WRITE `readOfferForm` :8119; READ funding
projection, timeline. **Canonical rep:** LEGACY.

**`plannedSignupDate`** — WRITE `readOfferForm` :8116; READ everywhere a deadline
is anchored (`migrateDebitRequirement`, `reconcileDebitWithinDays`, funding
window, lock start, timeline). **Canonical rep:** LEGACY. Derived-row deadlines
are computed relative to it but the rows store day-counts, not absolute dates, so
a sign-up-date edit re-derives correctly.

**`offerExpirationDate`** — WRITE `readOfferForm` :8115; READ reminder feed,
card/table urgency, timeline. **Canonical rep:** LEGACY. Step 4 lifecycle reads
it; no derived row.

> **Agent inventory addendum** (exhaustive read/write line list produced by the
> parallel consumer-inventory pass) is appended at the end of this doc under
> §G for completeness. The canonical-rep decisions above are unaffected by it:
> **every** current consumer keeps reading legacy fields. One implementation-
> relevant note surfaced by it: `showOfferModal` (:7489-7491) already back-fills
> default `directDeposits`/`ddRequirement`/`debitRequirement` on loaded offers —
> the existing "ensure legacy shape on modal open" idiom. The v2 layer follows
> the same spirit but seeds `requirements` in migration/sync, not in the modal.

---

## B. Layering strategy + sync rules

### Representation contract
- **Legacy fields** = canonical for all pre-v2 consumers (renders, feed,
  projection, ROI, optimizer, lock/hold math). Unchanged by this step.
- **`requirements[]`** = additive richer layer. Two provenances:
  - `source:'derived'` — a projection of a legacy field. Regenerated from legacy
    on every load + save. **Never** hand-edited authoritatively (a later UI step
    that edits a derived row must write through to the legacy field, out of scope
    here).
  - `source:'user'` — a requirement with no legacy equivalent (e-statements,
    online banking, maintain balance, promo code, activate debit, custom, extra
    spend/transactions). Authoritative in its own right; **never** touched by
    the derivation layer.
- **New scalar fields** (churnability, fees, promo, bonus-post window,
  last_edited) — plain offer properties, canonical as themselves.

### Derived-row identity (stable ids — never array index)
Mirrors the `migrateDdIds` persisted-id philosophy: a derived row's id is tied to
its legacy **source**, so refreshing in place is a keyed upsert, and feed items a
later step keys off a row bind to identity, not position.

| Legacy source | Derived row id | Row type | Notes |
|---|---|---|---|
| each `directDeposits[i]` (has `.id`) | `req-dd-<ddId>` | `direct_deposit_amt` | one row per DD; amount = dd.amount, deadline from dd.plannedDate offset |
| `ddRequirement` (count/frequency spec) | `req-ddreq` | `direct_deposit_count` | the *count/frequency* obligation (distinct from the individual scheduled DDs) |
| `debitRequirement` (required) | `req-debit` | `debit_txns` | count = debitRequirement.count, deadline_days = withinDays |
| `requiredFundingAmount` (+window) | `req-funding` | `deposit` | amount, deadline_days = daysAfterSignupAllowedBeforeDeposit, hold_days = daysFundsMustRemain |

`req-dd-<ddId>` reuses the DD's own persisted id (minted by `migrateDdIds`), so
the id is stable across reorders/edits exactly like the feed keys already are.

### `syncRequirementsWithLegacy(offer)` rules (called on load + save)
For each derived-row spec above:
1. **Compute** the desired derived row from current legacy values.
2. **If a row with that id already exists** → refresh its *derived* fields
   (type,label,amount,count,deadline_days,frequency,hold_days) **in place**, and
   **preserve** `done`, `done_date`, and `notes` (user progress/annotations
   survive re-derivation). This is the key rule: derived ≠ ephemeral for the
   user's completion state.
3. **If it does not exist** → append it (`source:'derived'`).
4. **Remove** any `source:'derived'` row whose legacy source is now gone (e.g. a
   DD row was deleted, or `debitRequirement.required` flipped to false, or
   funding amount cleared to null). Removal keys off the id set produced in step
   1 — a derived row whose id isn't in the freshly-computed set is dropped.
5. **`source:'user'` rows are never inspected or modified.**

Idempotent by construction: running twice with unchanged legacy values produces
byte-identical `requirements` (same ids, same order — derived rows are kept in a
deterministic order: funding, ddreq, per-DD in array order, debit).

### `deriveRequirementsFromLegacy(offer)` (pure)
Returns the array of freshly-computed derived rows (used by both the migration
and `syncRequirementsWithLegacy`). Pure: reads only `offer`, allocates new row
objects with `source:'derived'` and the stable ids above, `done:false`,
`done_date:null`, `notes:''` defaults. It does **not** merge — merging/preserving
is `syncRequirementsWithLegacy`'s job. Missing legacy fields (the demo seed has no
`ddRequirement`/`debitRequirement`/`directDeposits`) yield no row for that source
— every access is guarded.

### Edge cases (documented)
- **Seed offers with no DD/debit/ddRequirement objects** → derivation emits only
  `req-funding` (they all have `requiredFundingAmount`). No crash on missing
  legacy sub-objects.
- **`debitRequirement.required === false`** → no `req-debit` row; if one existed
  (user later unset it), rule 4 removes it, preserving nothing (correct — the
  obligation is gone).
- **DD row deleted between saves** → its `req-dd-<ddId>` derived row is removed
  (rule 4); a user-added row that happened to reference the same DD is `source:
  'user'` and is left alone.
- **User marks a derived row done, then edits the legacy field** → row stays,
  `done`/`done_date` preserved, other fields refreshed (rule 2). Intended: "I
  did the deposit" survives changing the deposit amount.
- **`requiredFundingAmount` cleared to null** → `req-funding` removed (rule 4).
- **Sign-up date changes** → derived deadlines are stored as day-counts
  (`deadline_days`), not absolute dates, so nothing needs re-deriving beyond the
  normal load/save sync; absolute due dates are always computed downstream from
  `plannedSignupDate + deadline_days`.
- **Duplicate legacy sources** can't produce duplicate rows because ids are
  deterministic and the upsert is keyed — re-running only refreshes.

---

## C. Migration plan + rollback

### `migrateOffersToSchemaV2(state)` — placement + behavior
Runs in `App.init` **after** the existing per-offer migration loop (:4207-4210),
i.e. after `normalizeOfferStatus`/`migrateDdIds`/`migrateDebitRequirement`/
`reconcileDebitWithinDays` have already normalized legacy fields (derivation reads
the *migrated* legacy values, e.g. `debitRequirement.withinDays`).

Per offer lacking v2 markers:
1. Add new scalar fields with safe defaults (all null/`''`/`false` — see §D).
2. `offer.requirements = []` then run `syncRequirementsWithLegacy(offer)` (which
   appends derived rows).
3. `offer.last_edited = null` (unknown history — we don't fabricate a timestamp
   for pre-existing offers).

**Idempotency marker: presence of `offer.requirements` array on the offer.**
Chosen over a state-level `_schemaV2` flag because:
- It's **per-offer**, matching the existing migration idioms (`migrateDdIds`
  etc. are all per-offer, marker = presence of the field). A state flag would
  wrongly skip an offer synced in from an *older* device after this device
  migrated (cross-device Gist sync means offers can arrive post-migration).
- `syncRequirementsWithLegacy` runs on every load regardless, so even an offer
  that somehow slipped through gets its derived rows on the next load — the
  marker just gates the one-time *scalar-field seeding + last_edited:null*.
- Second run: `requirements` already present → skip scalar seeding; the
  always-on sync refreshes derived rows idempotently. Net = no-op.

### One-time full-state backup (before first mutation)
Before the migration loop mutates anything, write a single full-state snapshot to
localStorage key **`yv-backup-pre-v2`**, guarded:
- Only if the key does **not** already exist (never overwrite an older, more
  original backup — the first migration wins).
- Only if there's actually pre-v2 data to back up (skip on a fresh seed where
  offers were just created this session — but simplest correct rule: back up the
  loaded state as-is; a freshly-seeded state is still a valid restore target).
- Wrapped in try/catch; a quota failure logs via `logError(ErrCode.STORAGE, e,
  'migrateOffersToSchemaV2: backup')` and **does not block the app** (migration
  proceeds — losing the backup is degraded, not fatal).
- Snapshot = `JSON.stringify` of the state **as loaded**, taken *before* the v2
  loop runs, so restore returns the exact pre-v2 shape.

### Rollback / restore path
- Settings → Data section gets a **"Restore pre-v2 backup"** button, rendered
  **only when `yv-backup-pre-v2` exists** (checked at render time).
- Click → existing `confirm(...)` dialog → parse the backup JSON → replace
  `App.state` → persist → `location.reload()` (same recovery idiom as the boot
  error panel's Reload button, :5040). On reload, `migrateOffersToSchemaV2` runs
  again and re-migrates the restored pre-v2 state — a clean round-trip.
- Restore uses `App.save()`? **No** — to avoid a sync push of the rolled-back
  state mid-restore we set `App.state` and `localStorage.setItem(STORAGE_KEY,…)`
  directly, then reload (matches how the migration path itself avoids
  save/schedulePush). *(See §E — sync safety.)*

### Idempotency test (verification gate c)
1. Inject a legacy-shape offer into `capital-planner-v1`, reload.
2. Assert: offer has `requirements` with correct derived rows; `yv-backup-pre-v2`
   exists; UI renders.
3. Reload again. Assert: no duplicate rows, `requirements` unchanged
   (deep-equal), backup key unchanged (not overwritten).

---

## D. New field defaults (schema reference)

Added per offer in `migrateOffersToSchemaV2` (and as literals in `readOfferForm`'s
prior-spread for new saves):

```
requirements: []            // array of rows (see row schema below)
churnable: null             // true | false | null(unknown)
churn_wait_months: null     // Number | null
churn_anchor: 'bonus_received'  // 'bonus_received' | 'account_closed' | 'account_opened'
churn_notes: ''
bonus_received_date: null   // ISO | null  (anchor date; NEW — no legacy equivalent, grep-confirmed)
closed_date: null           // ISO | null  (anchor date; NEW — grep-confirmed no dup)
monthly_fee: null           // Number | null
fee_waiver_condition: ''
promo_code: ''
early_termination_fee: null // Number | null
etf_window_days: null       // Number | null
bonus_post_min_days: null   // Number | null
bonus_post_max_days: null   // Number | null
last_edited: null           // ISO timestamp; set to now() on form save, null for migrated history
```

**Requirement row schema:**
```
{
  id,                 // stable string: 'req-<source>' for derived, uid('req') for user
  type,               // 'spend'|'deposit'|'direct_deposit_amt'|'direct_deposit_count'|
                      //   'transactions'|'debit_txns'|'activate_debit'|'estatements'|
                      //   'online_banking'|'maintain_balance'|'promo_code'|'custom'
  label,              // display string
  amount,             // Number | null
  count,              // Number | null
  deadline_days,      // Number | null (days after plannedSignupDate)
  frequency,          // 'total'|'monthly'|'per_statement'
  hold_days,          // Number | null
  done,               // bool
  done_date,          // ISO | null
  source,             // 'derived' | 'user'
  notes               // string
}
```

**Anchor-date fields (`bonus_received_date`, `closed_date`) — grep check:** a
full-file grep for `churn|bonus_received|closed_date|monthly_fee|early_termination|
etf|promo_code|fee_waiver|bonus_post|maintain_balance|estatement` found **no
pre-existing equivalents** (only the word "churn" in comments/seed banner and
unrelated `getFullYear()` matches). These are genuinely new fields; nothing to
reuse. (Existing lifecycle uses `plannedSignupDate`/`optionalPlannedFundingDate`
for *funding* dates, but there is no stored "bonus received" or "account closed"
date — those are the new anchors churn logic in step 5 needs.)

---

## E. Sync safety (must not introduce push-on-load)

- The migration path **must not** call `App.save()` or `Sync.schedulePush()` —
  `save()` (:4301) calls `schedulePush()` (:4319) and stamps `_dirtySince`,
  which would mark every device dirty on first v2 load and could trigger a CAS
  conflict/push of migrated data. Migration mutates `App.state` in place and
  leaves persistence to the *next genuine user save* (same as the existing
  migrations, which also don't save — they run in `init` before `render()` and
  rely on the fact that a load that seeds/normalizes doesn't itself persist
  unless it was a fresh-seed `this.save({system:true})` at :4202).
- Consequence: after a v2 migration with no user edit, localStorage still holds
  the *pre-v2* JSON until the user next saves — which is fine; the in-memory
  state is v2 and every consumer works. The `yv-backup-pre-v2` key is the
  durable pre-v2 copy.
- No sync is configured in the test environment, but the code path is verified to
  contain no save/schedulePush call reachable from `migrateOffersToSchemaV2`.
- **Restore** likewise writes `localStorage` directly + reloads rather than
  `App.save()`, so it doesn't schedule a push of the rolled-back state; the
  reload's fresh `init` handles everything.

---

## F. Feed-impact table for later steps (DESIGN ONLY — no feed code here)

The reminder-feed contract stays **`{schema:2, items:[{id,kind,title,dueDate,
notes}], removed,…}`** (an iOS Shortcut depends on it — untouched this step).
Future steps add new `kind`s / item ids sourced from the v2 layer:

| Step | Feature | New feed kind(s) | Item id pattern | Source field(s) |
|---|---|---|---|---|
| 3 | Requirement rows → per-row deadlines | `requirement` (or per-type) | `yv-<offerId>-req-<rowId>` | `requirements[].deadline_days` + `plannedSignupDate`; skip `done` rows |
| 4 | Lifecycle: expected-bonus-window | `bonus-window` | `yv-<offerId>-bonuswin` | `bonus_post_min_days`/`bonus_post_max_days` + funding date |
| 4 | Lifecycle: safe-to-close | `safe-to-close` | `yv-<offerId>-safeclose` | `safeToCloseDate` :4433 (currently stub→null; step 4 implements) + `daysFundsMustRemain`/`closed_date` |
| 5 | Churn: eligible-again | `churn-eligible` | `yv-<offerId>-churnagain` | `churnable` + `churn_wait_months` + `churn_anchor`→(`bonus_received_date`/`closed_date`/`plannedSignupDate`) |

Row id `rowId` in step 3 is the stable requirement id from §B (e.g.
`req-funding`, `req-dd-<ddId>`, or `uid('req')`-minted user rows), so feed items
bind to requirement identity and never churn on reorder — the same guarantee
`migrateDdIds` gives DD feed items today.

**This step adds none of the above feed code.** It only makes the *fields* those
kinds will read exist and stay in sync. `buildReminderItems` (:5371),
`computeReminderFeed` (:5589), `computeFeedSafely` (:5678), and the feed contract
(:5293) are **not touched**.

---

## G. Appendix — exhaustive consumer read/write sites

Produced by a dedicated grep pass over `index.html`. Line numbers are point-in-time
(APP_VERSION `2026.07.07b`). Confirms §A's canonical-rep calls: **no consumer reads
any v2 field; every consumer keeps reading legacy fields.** `showOfferModal`
back-fills legacy sub-object defaults at :7489-7491.

**ddRequirement** — WRITE: readOfferForm :8079-8084; showOfferModal init :7468, back-compat :7490. READ: showOfferModal render :7566-7587; `ddWindowEndDate` :5348-5357.

**debitRequirement** — WRITE: readOfferForm :8095-8101; migrateDebitRequirement :2631-2632; showOfferModal :7468/:7491. READ: migrate/reconcile :2619-2643; readOfferForm prior :8094; showOfferModal :7599-7620; `debitDeadlineISO` :4375-4378; buildReminderItems :5478,:5482.

**directDeposits** — WRITE: readOfferForm :8111 / readDdRowsFromForm :8022-8041; migrateDdIds :2601; showOfferModal :7467/:7489. READ: migrateDdIds :2599-2600; `withdrawalEligibleDate` :4390; `ddCapitalTime` :4452; `isOfferComplete` :4541-4543; `offerIssues` :4566-4568; renderOfferCard :6045-6057; timeline :6960-6961; showOfferModal :7490,:7592; generateProjection :4733-4758; ddWindowEndDate :5361-5365; buildReminderItems :5443; ddRoundTrip :3721.

**requiredFundingAmount** — WRITE: readOfferForm :8113; showOfferModal init :7469. READ: simpleReturn :4442; ddCapitalTime :4468; isOfferComplete :4534; offerIssues :4559; buildReminderItems :5405-5507; renderOfferCard :6017-6042; renderOfferCardWithActions :6119; renderOffersTable :6208,:6340-6342; chart :6977-6992; generateProjection :4752,:4766; showOfferModal :7636.

**signupBonusAmount** — WRITE: readOfferForm :8114; showOfferModal :7470. READ: simpleReturn :4442; annualizedReturn :4489-4504; offerIssues :4560; buildReminderItems :5405-5509; summary :5820,:5179; renderOfferCard :5941,:6021; renderOffersTable :6341; chart :6982-6992; generateProjection :4921; showOfferModal :7547.

**daysAfterSignupAllowedBeforeDeposit** — WRITE: readOfferForm :8117; showOfferModal :7473. READ: depositDeadline :4365-4366; showOfferModal :7656,:7676.

**daysFundsMustRemain** — WRITE: readOfferForm :8087(null-out),:8118; showOfferModal :7474. READ: withdrawalEligibleDate :4407-4408; :4515; isOfferComplete :4537; offerIssues :4564; ddCapitalTime :4470; renderOfferCard :6032,:6042; renderOffersTable :6342; showOfferModal :7665.

**optionalPlannedFundingDate** — WRITE: readOfferForm :8119; showOfferModal :7475. READ: isOfferComplete :4549; offerIssues :4573; effectiveFundingDate :4347; withdrawalEligibleDate :4406; showOfferModal :7673.

**plannedSignupDate** — WRITE: readOfferForm :8116; showOfferModal :7472. READ: migrateDebitRequirement :2624; reconcileDebitWithinDays :2644; isOfferComplete :4531; offerIssues :4563; depositDeadline :4365-4366; debitDeadlineISO :4379-4381; withdrawalEligibleDate :4405; ddWindowEndDate :5350; showOfferModal :7649.

**offerExpirationDate** — WRITE: readOfferForm :8115; showOfferModal :7471. READ: buildReminderItems :5399-5400; renderOfferCard :6043; showOfferModal :7643.

**Key derived-read helpers** (read multiple legacy fields internally; later steps
should reuse these rather than re-deriving): `depositDeadline` :4362, `debitDeadlineISO`
:4374, `withdrawalEligibleDate` :4384, `effectiveFundingDate` :4347, `ddWindowEndDate`
:5346, `safeToCloseDate` :4433 (stub → null; step 4 target), `directDepositEffectiveDate`
:3752, `simpleReturn` :4441, `annualizedReturn` :4489.
