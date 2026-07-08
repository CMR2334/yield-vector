# DoC import fixtures — synthetic sample posts

These **seven** files are **synthesized** test inputs for the deterministic
"glance parser" (`parseDocPost` in `index.html`). They exercise the parser's
glance-list extraction, recency reconciliation, churn-hint detection, and all
eight corpus quirks identified in the assessment
(`docs/assessments/2026-07-05/report.md`, Part I). Files `06`–`07` were added in
the step-4a parser-calibration run to cover the two failure classes a real
31-post corpus surfaced: **tier ladders** (P1) and **delta-update staleness**
(P2). Their expectations are asserted in-app by `testDocParser` (keys `'06'`,
`'07'`) alongside `01`–`05`.

## Provenance

- **Structure** is modeled on the "Offer at a glance" `Label: value` lists that
  Doctor of Credit (doctorofcredit.com) places at the top of every bank-bonus
  post, plus the leading `Update M/D/YY:` paragraphs those posts use to amend
  stale glance values.
- **Content is entirely invented.** Every bank, dollar amount, date, promo code,
  and requirement is fictional (banks like "Meridian Trust Bank", "Cascade
  Commerce Bank", "Granite Peak Bank", "Relayline Business Banking", "Summit
  Brokerage"). **No text is copied from any real Doctor of Credit post.** These
  exist only to give the parser a deterministic, self-contained target — they are
  not a redistribution of DoC content.
- A leading HTML comment (`.html`) or plain-text preamble (`.txt`) documents each
  file's purpose; the parser tolerates such preamble (it locates the title by the
  line preceding "Offer at a glance", not by taking line 1 blindly).

## Format coverage

| File | Format | Primary focus |
|------|--------|---------------|
| `01-basic-checking.html` | HTML | Baseline high-confidence glance list; DD required; fee waived; promo code; ETF window |
| `02-points-and-range.html` | HTML | **Quirk 1** points-not-dollars; **quirk 2** bonus range; annual fee; churn "once every 12 months" |
| `03-dual-bonus-updates.html` | HTML | **Quirk 3** combined dual-bonus total; **quirk 4** `<del>` strikethrough; **quirk 5+7** unsorted `Update` paragraphs (latest date wins), extended expiration |
| `04-business-debit-promo.html` | HTML | **Quirk 6** fuzzy labels ("Direct deposit needed", "Bonus code"); **quirk 8** fintech post omits ChexSystems + leads with a non-dated status line; debit txns; fee waiver |
| `05-brokerage-tiers-churn.txt` | plain text | Text (non-HTML) path; churn re-run window + account-closed anchor; spend + transactions → user rows; funding + hold; **`$50k` thousands shorthand** and a **weeks** bonus-posting window (×7) |
| `06-tiered-ladder.html` | HTML | **P1** deposit-tier ladder (4 bullet tiers → top-level `tiers[]`; ≥2 tiers force `signupBonusAmount` to **low** confidence + `note_tiered`); **P0** "Credit card funding" row → `cc_funding_note`, never `requiredFundingAmount`; tier-derived funding = lowest deposit tier |
| `07-delta-updates.html` | HTML | **P2** date-segmented delta reconciliation (newest `Update 5/20/26` **lowers** the bonus 350→250, **extends** expiration to 9/30/26, and changes the promo code to SUMMER250 — each supersedes the stale glance box **and** an older 2/2/26 update); **P4** "Yes, no minimum mentioned" ⇒ `ddRequired: true`; **P4** "through July 7, 2026" not read as a `$2026` bonus |

### The eight quirks → where each is exercised

1. **Points, not dollars** — `02` ("50,000 membership rewards" → note, no `$`).
2. **Bonus ranges** — `02` ("$50 – $300" → high end + range note).
3. **Combined dual-bonus totals** — `03` ("$560 total for both accounts").
4. **`<del>` strikethrough history** — `03` (struck `$400`/`$12`/`3/31/2026`; the
   non-struck current values win).
5. **`Update M/D/YY` recency reconciliation** — `03` (a 3/15 Update extends the
   expiration to 8/31/2026, superseding the 6/30 glance value).
6. **Fuzzy label matching** — `04` ("Direct deposit needed", "Bonus code").
7. **Parse-all-dates-take-max** — `03` (unsorted Updates: 3/15 > 1/10; latest wins).
8. **No unconditional `$` regex / status lines** — `04` (leads with "Deal has
   ended…"; points/counts parsed without assuming a leading `$`).

Churn-language variants: `02` ("once every 12 months"), `03` ("once every 24
months per household"), `05` ("not eligible if you received a bonus in the last
24 months, counted from … closed" → wait 24 mo, anchor account_closed).

## Expected parsed values

Field keys are `parseDocPost` output keys. Confidence: **H**igh / **M**edium /
**L**ow. "→ note" = routed to the Notes textarea, not a scalar field. "→ user
row" = added to `#f-user-reqs` (no legacy field). Blank = not asserted / absent.

### 01-basic-checking.html
| Key | Value | Conf |
|-----|-------|------|
| bankName | Meridian Trust Bank | M (title-derived) |
| signupBonusAmount | 300 | H |
| offerExpirationDate | 2026-09-30 | H |
| ddRequired | true | H |
| monthly_fee | 0 | H |
| fee_waiver_condition | (one direct deposit per statement cycle) | M |
| early_termination_fee | 25 | H |
| etf_window_days | 90 | M |
| promo_code | PREMIER300 | H |
| daysAfterSignupAllowedBeforeDeposit | 60 | M |
| bonus_post_max_days | 30 | M |

### 02-points-and-range.html
| Key | Value | Conf |
|-----|-------|------|
| bonusPointsNote | "50,000 membership rewards" (→ note) | M |
| signupBonusAmount | *(absent — points, not $)* | — |
| offerExpirationDate | 2026-12-31 | H |
| ddRequired | false | H |
| monthly_fee | 95 | H |
| early_termination_fee | 0 | H |
| churn_wait_months | 12 | M |
| churnable | true | M |

Range note: the savings "$50 – $300" appears in prose; when the parser reads a
range it keeps the high end and attaches a "Range …" note.

### 03-dual-bonus-updates.html
| Key | Value | Conf |
|-----|-------|------|
| signupBonusAmount | 560 (+ "Combined total…" note) | M |
| offerExpirationDate | 2026-08-31 (reconciled from the 3/15 Update, beats struck 3/31 + glance 6/30) | H |
| ddRequired | true | H |
| churn_wait_months | 24 | M |
| bonus_post_min_days | 45 | M |
| bonus_post_max_days | 60 | M |

### 04-business-debit-promo.html
| Key | Value | Conf |
|-----|-------|------|
| signupBonusAmount | 400 | H |
| ddRequired | true | H |
| monthly_fee | 10 (first `$`, not the $500 waiver figure) | H |
| fee_waiver_condition | ($500 in monthly direct deposits) | M |
| early_termination_fee | 50 | H |
| etf_window_days | 120 | M |
| promo_code | RELAY400 | H |
| debitCount | 5 | M |
| debitWithinDays | 60 | M |
| bonus_post_max_days | 20 | M |
| offerExpirationDate | 2026-10-15 | H |

### 05-brokerage-tiers-churn.txt
| Key | Value | Conf |
|-----|-------|------|
| bankName | Summit Brokerage | M (title-derived) |
| signupBonusAmount | 1000 | H |
| requiredFundingAmount | 50000 (from `$50k` shorthand) | H |
| ddRequired | false | H |
| offerExpirationDate | 2026-11-30 | H |
| daysFundsMustRemain | 90 | M |
| churnable | true | M |
| churn_wait_months | 24 | M |
| churn_anchor | account_closed | L (best-guess) |
| bonus_post_min_days | 42 (from "6 to 8 weeks", ×7) | M |
| bonus_post_max_days | 56 (from "6 to 8 weeks", ×7) | M |
| spendAmount | 2000 (→ user row, type `spend`) | M |
| transactionsCount | 3 (→ user row, type `transactions`) | M |

### 06-tiered-ladder.html  *(step-4a P1 — tier ladder)*
Deposit ladder: `$500 @ $10k · $900 @ $25k · $1,500 @ $75k · $3,000 @ $250k`.
| Key | Value | Conf |
|-----|-------|------|
| signupBonusAmount | 3000 (glance "up to $3,000" headline) | **L** (forced low — tiered) |
| _tiers *(meta: `res.tiers.length`)* | 4 | — |
| requiredFundingAmount | 10000 (lowest deposit tier) | M |
| ddRequired | false | H |
| offerExpirationDate | 2026-12-31 | H |
| early_termination_fee | 0 | H |
| cc_funding_note | "Card funding … up to $500" (→ note, **not** funding) | M |

The top-level `tiers[]` array is returned **alongside** `fields` (never inside
it) and is **not** rendered as preview rows this step — step 4b owns the tier
picker. `signupBonusAmount` is forced to low confidence (default-unchecked) so a
tiered headline is never auto-applied.

### 07-delta-updates.html  *(step-4a P2 — delta staleness)*
Two prepended updates (unsorted); the newest (5/20/26) supersedes the stale
glance box **and** the older 2/2/26 update on three fields.
| Key | Value | Conf |
|-----|-------|------|
| signupBonusAmount | 250 (newest update lowered it from 350) | — (reconciled) |
| offerExpirationDate | 2026-09-30 (newest update; beats glance 1/31/26 + older 7/7/26 update) | M (reconciled) |
| promo_code | SUMMER250 (newest update; supersedes WINTER350) | M (reconciled) |
| ddRequired | true (P4: "Yes, no minimum mentioned" not flipped to false) | H |
| monthly_fee | 12 (first `$`, not the $1,000 card-funding cap) | H |
| early_termination_fee | 30 | H |
| etf_window_days | 180 | M |
| daysAfterSignupAllowedBeforeDeposit | 90 | M |
| cc_funding_note | "Card funding … up to $1,000" (→ note) | M |
| churnable | true | M |
| churn_wait_months | 12 | M |

P4 year-as-money guard: the older update's "Extended until July 7, 2026" is a
date, so `2026` is **never** read as a `$2,026` bonus.

## Regression testing

A dev-only console hook `testDocParser(rawText, fixtureKey)` lives in
`index.html`. Paste a fixture's text and call e.g. `testDocParser(<text>, '03')`
— it asserts the extracted fields against a compact embedded expected map and
prints pass/fail counts. `fixtureKey` is the leading number of the filename
(`'01'`…`'07'`). It performs no network or file IO. Keys prefixed with `_` in the
expected map (e.g. `_tiers`, `_signupBonusConfidence`) are **meta-assertions** on
the result *shape* (`res.tiers.length`, the headline bonus's forced confidence),
not `fields.<key>` lookups.
