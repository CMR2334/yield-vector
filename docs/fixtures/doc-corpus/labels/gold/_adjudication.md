# Gold-label adjudication log

Adjudicator: parser-calibration step 3. Sources: `labels/{A,B,C}/<NN>.json`, post
HTML in `posts/`. Rulings below drive `labels/gold/<NN>.json` (built by
`harness/build-gold.js`; each gold file carries `_gold_provenance`).

Ground-truth reads were taken from each post's `.entry-content` text
(`harness/dump-posts.js`). "Careful-churner reading" = the value a careful reader
who trusts the most-recent dated Update over stale summary-box/fine-print text
would act on (updates supersede specific facts).

---

## Part A.4 — Inter-rater agreement (BEFORE adjudication)

Scalar field set scored (16 fields/post): bank, availability_verbatim,
bonus_total, expiration, monthly_fee, early_termination_fee, etf_window_days,
promo_code, dd_required, dd_amount, dd_count, dd_timeframe_days,
bonus_post_min_days, bonus_post_max_days, churn.wait_months, churn.anchor.

| Post | Groups | Agree / N | % | tiers | reqs |
|------|--------|-----------|-----|-------|------|
| 01 | A+B | 15/16 | 93.8 | same (5) | same (2) |
| 04 | A+C | 13/16 | 81.3 | same (2) | same (5) |
| 10 | A+C | 14/16 | 87.5 | same (3) | DIFF 3v2 |
| 16 | A+B |  8/16 | 50.0 | same (2) | same (3) |
| 23 | B+C | 12/16 | 75.0 | same (2) | DIFF 3v2 |
| 26 | A+C | 14/16 | 87.5 | same (3) | same (2) |
| **Overall** | | **76/96** | **79.2%** | | |

Read: labels are solid on the easy fields; nearly all disagreement concentrates
in (a) `churn.anchor` (labelers split on whether to record an anchor when the
limit language is a "had an account within N months" clause — a systematic
convention gap, not a factual dispute) and (b) recency-dependent scalars on the
messiest post (16 Huntington), where a tier/fee/window read diverged. Excluding
`churn.anchor` (a pure convention item, resolved uniformly below to
account_closed/opened per the limit language), agreement rises to **73/90 = 81.1%**.

---

## Part A.1 — Double-labeled posts (field-by-field rulings)

Only DISAGREEING fields are listed; agreements passed through from the base label.

### 01 — Bank of America (A+B) · base B
| field | A said | B said | ruling | rationale |
|-------|--------|--------|--------|-----------|
| churn.anchor | null | account_closed | **account_closed** | "owner or signer on a BofA Business Advantage Banking account within the last 12 months" is a held/closed-account anchor, not bonus-received. |

Everything else (5 tiers, $2,500 max, exp 2026-12-31, fee $16, DD false) agreed.

### 04 — Old National Bank (A+C) · base A
| field | A | C | ruling | rationale |
|-------|---|---|--------|-----------|
| availability_verbatim | "…& WI, In Branch Only (also ND …)" | "…& WI, In Branch Only" | **A (keeps ND note)** | 10/29/25 update adds ND (Bremer acquisition); A's fuller string is correct. |
| expiration | 2026-06-30 | none stated | **2026-06-30** | "Extended to 6/30/2026" sits in the current update stack above the 10/29/25 update; it is the only forward date. (Now just lapsed vs today, but it's the stated value.) |
| churn.anchor | null | account_closed | **account_closed** | "closed a business deposit account within the past 36 months / received a promotional bonus within the past 36 months" — closed-account anchor. |

### 10 — Ameriprise (A+C) · base C
| field | A | C | ruling | rationale |
|-------|---|---|--------|-----------|
| bank | "Ameriprise Financial" | "Ameriprise Financial (Ameriprise Bank)" | **C string kept (base)** | cosmetic; either fine. Parser derives bank from title regardless. |
| expiration | 2026-06-30 | 2026-12-29 | **2026-12-29** | Fine Print: accounts open "from July 1, 2026, to December 29, 2026." Box's 6/30/26 is stale (and already lapsed vs today). Careful-churner = the true offer window. |
| requirements | 3 rows | 2 rows | **C's 2 (base)** | both faithful; C folds the savings deposit+maintain into one row. (Not parser-scored.) |

### 16 — Huntington (A+B) · base A  *(worst agreement, 50%)*
| field | A | B | ruling | rationale |
|-------|---|---|--------|-----------|
| availability_verbatim | expanded incl. WI | base+9 online | **A (fuller, incl. WI)** | 5/10/26 update lists the full expanded set incl. WI; A captures it. |
| expiration | 2026-09-30 | none stated | **2026-09-30** | "Extended through 2026-09-30" tops the update stack. |
| monthly_fee | 25 | 10 | **10** | The base bonus account is **Perks Checking ($10 fee)**; the $25 is the Platinum-Perks tier's fee. Fee should track the entry product. |
| dd_required | true | false | **true** | The $400 Perks tier *requires* a $500+ DD ("Direct deposit required: Yes for $400 bonus"). The $600 tier is deposit-based, but the offer as a whole is DD-gated at its base. |
| bonus_post_min_days | 90 | null | **90** | "maintain open account status for at least 90 days before eligible" → hold ends day 90. |
| bonus_post_max_days | 104 | 14 | **104** | 90-day hold + "within 14 days of that the bonus will post" = 104. B's 14 captured only the +14 tail. |
| churn.wait_months | 12 | 6 | **12** | "one account-related gift incentive per rolling 12-month period" is the cooldown; the "closed within the last six months" clause is a separate lockout, not the re-run window. |
| churn.anchor | null | account_closed | **account_closed** | anchored on prior-account closure. |

### 23 — Flagstar (B+C) · base B
| field | B | C | ruling | rationale |
|-------|---|---|--------|-----------|
| expiration | 2026-05-31 | none stated | **2026-05-31** | Update 4/11/26 "Offer has also been extended to May 31, 2026" — explicit dated value. |
| monthly_fee | 15 | 10 | **15** | bonus_total=500 maps to **Elite Checking ($15 fee)**; box says "$0-$15". Fee tracks the tier the headline max belongs to. (Ready base is $10 post-5/1/26 — a defensible alternative; recorded as an ambiguity.) |
| dd_count | 1 | null | **1** | "one or more direct deposits totaling $500 or more" sets a minimum count of 1. |
| churn.anchor | bonus_received | null | **bonus_received** | "If you have been paid a checking cash bonus previously, you are ineligible" — payment-anchored, lifetime. |

### 26 — Chase Business (A+C) · base A
| field | A | C | ruling | rationale |
|-------|---|---|--------|-----------|
| availability_verbatim | "…- online…" (hyphen) | "…– online…" (en-dash) | **hyphen (A)** | cosmetic normalization. |
| churn.anchor | null | account_opened | **account_opened** | "one bonus every two years from the last enrollment date" = opening/enrollment anchor. |

---

## Part A.2 — Flagged-post rulings (specific items from the step brief)

### 03 — U.S. Bank $400–$1,500 business  *(bonus_total convention: tiered + stale box)*
- Glance box max = **$1,200**; structured Offer section = $1,200/$400 tiers (code Q2DIG26); but prose Updates (newest 7/6/26) confirm a **$1,500** tier active with code Q3BUS26, "Valid through 09/27/2026."
- **Ruling (careful-churner):** `bonus_total = 1500`; `expiration = 2026-09-27`; `churn.wait_months = 12` ("churn period is now only 12 months"). The $1,500 tier's exact deposit anchor is never restated post-update (historically $25k) — recorded as a residual ambiguity in the label notes.
- Parser-relevance: the glance box only exposes $1,200 → this is a headline **TIER-BLIND/STALE** test case (parser will read $1,200, gold is $1,500).

### 08 — Navy Federal  *(textual-gap careful-churner reading)*
- Structured Fine Print describes the OLD promo (12-mo EasyStart certificate, no DD, $200, window 11/1–11/30/2025). Updates 5/28/26 + 7/2/26 describe a NEW promo (checking + recurring $500 DD, now **$250**) never folded into the fine print.
- **Ruling:** `bonus_total = 250` (newest update). `dd_required = true`, `dd_amount = 500`. `expiration = 2025-11-30` — KEEP the box date: the only new date ("until 6/30/26") was stated for the interim $200 iteration and was NOT confirmed re-extended at the 7/2/26 $250 bump; do not invent a date. Flagged as a genuine ambiguity (a careful churner reading only the top updates might believe it live past 11/30).

### 09 — Lake Michigan CU  *(possibly-dead offer)*
- Undated top WARNING ("LMCU is approving then restricting… Removing this from the best bank account bonus page") is the newest content but marks the offer effectively dead/high-risk. Dated 7/2/26 update: bonus raised to $250.
- **Ruling:** KEEP in corpus, `eligibility = include`, add `_gold_note: "likely withdrawn"`. `bonus_total = 250`. Expiration stays box's stale 2025-04-04 (predates the increase; true current date unstated) — flagged. Still valid parse material.

### 17 — Royal CU  *(expired banner vs active update)*
- Top "[Expired]"/"Deal has ended" banner vs Update 5/17/26 "Deal is back, now $400 until June 12, 2026. Requires two consecutive DDs of $400+."
- **Ruling:** active update wins for terms. `bonus_total = 400`, `dd_amount = 400`. `expiration = 2026-06-12` (the update's explicit date; **overturns** base-B "none stated" — a date IS stated). Stays `include`.

### 22 / 27 — stacked / undocumented-mechanics `bonus_total` convention  *(pick ONE, normalize both)*
- **Convention chosen:** `bonus_total` = the **highest CURRENT headline figure named in the most-recent Update**; `requirements[]` carry the **best-DOCUMENTED mechanic available in article prose** (which may belong to an older/base sub-offer whose amount is superseded). Rationale: the "current amount" and the "spelled-out mechanic" often live in different sub-offers on these affiliate-driven posts; splitting them keeps both fields truthful rather than forcing a single stale sub-offer.
- **22 Chime:** newest 3/27/26 update = two direct-from-Chime **$350** offers (V2 debit-spend, V3 multi-DD), mechanics linked-out. Only fully-documented mechanic = 2 consecutive $200 DDs (Swagbucks/MyPoints body). → `bonus_total = 350`, requirement = 2×$200 DD. (Confirms label C.)
- **27 SoFi:** title "$400 + $415." Tiers table (only mechanics source) still shows stale $50/$100/**$300** DD tiers. Newest updates: 3/26/26 "SoFi now **$400**"; 4/13/26 "**$415** Swagbucks + **$400** SoFi." Applying the convention (current headline, not stale tier): `bonus_total = 815` (= $400 current SoFi + $415 Swagbucks). **Overturns label C's $715**, which anchored on the stale $300 tier. DD amount 5000 / window 25 kept (top tier).

### 25 — American Express  *(dual targeted variant convention)*
- Base offer = **50,000** MR points (title/headline, broadly described). A targeted **70,000**-point variant exists per Update 4/9/26 but is a separate YMMV mailer ("only available to select businesses solicited directly by American Express"), not a universal upgrade to the 50k base.
- **Ruling:** points bonus → `bonus_total = null` (per rules). Headline points = **50,000** (base). The 70k is NOT the base headline. `expiration = 2026-07-31` (the 4/9/26 update's stated end date — the freshest offer-window date in the post). Requirements from the 50k offer ($5k deposit / maintain 60 days / 5 transactions). (Confirms label C.)

### 20 — BMO Harris  *(confirm/overturn: targeted tiers excluded from tiers[])*
- **Ruling: CONFIRM label B.** Top undated update: "Currently only the public $400 bonus is available; the previous up to $1,000–$2,000 offers don't work as the link contains an expired code." The $600/$800/$1,000 DD tiers (9/10/25 update) and the Platinum MM $100/$200/$300 tiers require a targeted mailer / expired code. → `tiers[] = []`, `bonus_total = 400`, availability = the 14-state restriction from the top update (incl. WI). Excluding them is correct: presenting mailer-gated tiers as standard terms would mislead.

### 19 — Wings CU  *(nationwide box vs newest county-restriction incl. WI)*
- **Ruling:** availability = **county-restricted per the 5/30/26 update** (named counties in MN/WI/MI/FL/GA), UPHELD over the stale "Nationwide with $5 donation" summary box. WI counties explicitly listed (Columbia, Dane, Green Lake, Outagamie, Pierce, St. Croix, Winnebago) → the offer **stays `include`** on current availability. `bonus_total = 500` (top DD tier). (The debit-txn count/min is internally inconsistent post-strikethrough — 10×$5 (Offer) vs 5×$25 (Fine Print); Offer-section figures kept, flagged.)

---

## Residual ambiguities recorded (not blockers)
- **03**: $1,500 tier's exact deposit threshold never restated post-update (assumed ~$25k).
- **08**: current true expiration for the $250 iteration unstated (kept box 11/30/2025).
- **09**: offer likely withdrawn; nominal fields retained for parse material.
- **19**: debit-txn count/dollar-min conflict between Offer section and Fine Print.
- **23**: monthly_fee 15 (Elite/max-tier) vs 10 (Ready base post-5/1/26) — tier-dependent.
- **27**: $400 standalone SoFi vs $815 stack — bonus_total set to the stack per convention.
