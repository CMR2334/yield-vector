# Verification log — DoC parser calibration

**Purpose.** The owner asked, fairly, whether the accuracy statistics reported
for the DoC import parser are real or fabricated. They are real, and this file is
the receipt: the **verbatim, reproducible machine output** of the scoring harness
run against the actual committed parser, plus the pre-calibration baseline for
comparison. Nothing below is hand-typed results — every number is copied from
stdout of the commands shown.

- Corpus + labels + harness: this directory (`docs/fixtures/doc-corpus/`). See
  [`README.md`](README.md) for the full story and re-hydration steps.
- Parser under test: `parseDocPost` (and its pure helpers) in `index.html`.
- Captured: 2026-07-07, against committed HEAD (the calibration run's final state).

## What the harness does

The parser lives inside a single static `index.html` and normally runs in the
browser. To score it under Node, `harness/parser-loader.js` slices the pure
parser functions out of the `<script>` block by brace-matching and evaluates them
in a `vm` sandbox whose only DOM is a **real WHATWG DOM from jsdom** (the same
implementation a browser uses for `new DOMParser().parseFromString(...)`). It does
**not** execute the whole app (which needs `window`/`App`).

Because a hand-rolled DOM shim's faithfulness would itself be in question, the
trust anchor is `fidelity-check.js`: it runs the app's **own** embedded
`DOC_TEST_EXPECT` fixtures (the exact assertions `testDocParser()` runs
in-browser) through the Node loader and requires identical results. If those pass,
the loader hasn't altered parser behavior versus the browser.

- `score.js` — runs the parser over each post's `.entry-content` HTML (what a
  select-all-copy paste carries) and diffs field-by-field against the gold
  labels. Emits per-field correct/wrong/missed counts, a confidence-calibration
  table, and the **high-confidence-wrong** list (the dangerous class — a wrong
  value the parser is *sure* about).
- `parity-check.js` — parses 5 posts as HTML vs as text-only (the Cloudflare
  Worker path returns article text), confirming the paste and Worker paths agree.
- `taxonomy.js` — categorizes the remaining misses (reads `score-results.json`).
- `regressions-check.js`, `p2b-segmentation-pin.js`, `dd-matrix.js` — pinned unit
  checks for the specific bugs fixed during calibration.

## Where the gold labels came from

Three independent labelers hand-labeled disjoint thirds of the corpus **from the
post content only** (no parser output — prevents anchoring). 6 posts were
double-labeled: **raw inter-rater agreement 79.2%** on the scalar-field set
(81.1% excluding one pure convention item; worst post 50%). All disagreements +
9 flagged messy posts were adjudicated into one gold label per post. Full method,
per-field rulings, and conventions: [`labels/gold/_adjudication.md`](labels/gold/_adjudication.md).

## How to re-run (exact commands)

The harness scripts also ship in this repo at `docs/fixtures/doc-corpus/harness/`
(committed as part of this run). jsdom is a **verify-time** tool, not a repo
dependency (Yield Vector ships zero runtime deps), so install it just for the run:

```bash
cd docs/fixtures/doc-corpus/harness
npm i --no-save jsdom          # one-time; does NOT touch package.json

# Checks needing no post bodies:
node fidelity-check.js         # -> PASS 63 FAIL 0
node regressions-check.js      # -> PASS 12 FAIL 0
node dd-matrix.js              # -> DD MATRIX ALL PASS
node p2b-segmentation-pin.js   # -> P2B-SEG PIN: PASS

# Full corpus score (re-hydrate the posts first — bodies aren't committed):
node fetch-posts.js            # re-download posts into ../posts/ (or set $DOC_CORPUS_POSTS)
node score.js                  # the accuracy table below
node parity-check.js           # HTML-vs-text parity
```

> The captures below were produced from the exact scratchpad harness the run
> used; the committed `harness/` scripts are byte-equivalent except for
> repo-relative path handling (parser read from `../../../../index.html`; posts
> read from an optional local dir), and were re-verified to reproduce the
> identical numbers from the repo location.

> **stderr note:** jsdom prints `Could not parse CSS stylesheet` to **stderr**
> (124 lines) while parsing each saved page's `<style>`/ad CSS. It is pure noise,
> does not touch parser logic or any number below, and is filtered here with
> `2>/dev/null`. Run without the filter to see it.

---

## FINAL — current committed parser

### `node fidelity-check.js`
```
===== FIDELITY (jsdom loader vs app DOC_TEST_EXPECT) =====
PASS 63  FAIL 0
```

### `node regressions-check.js`
```
testDocParserRegressions: PASS 12  FAIL 0
```

### `node score.js`
```
===== BASELINE SCORE (real parseDocPost, entry-content HTML input) =====
Posts scored: 31
VALUE fields: correct 186  wrong 33  missed 44  spurious 0  extra(unverif) 39
  accuracy on fields the parser filled vs known gold (C/(C+W)): 84.9%
  recall of known-gold values (C/(C+W+M)): 70.7%
PRESENCE fields: correct 32  missed 12  extra 0
Calibration acc — high 96.7% (59/61)  med 87.1% (101/116)  low 61.9% (26/42)
*** HIGH-CONFIDENCE WRONG: 2 ***
   [05] monthly_fee: got 0 want 5
   [10] offerExpirationDate: got "2026-06-30" want "2026-12-29"

Per-field matrix (C=correct W=wrong M=missed S=spurious[vs explicit gold] X=extra[gold silent]):
  signupBonusAmount                      C 20 W 9 M 0 S 0 X 0
  offerExpirationDate                    C 20 W 3 M 0 S 0 X 6
  ddRequired                             C 30 W 0 M 1 S 0 X 0
  requiredFundingAmount                  C 9 W 5 M 7 S 0 X 2
  daysAfterSignupAllowedBeforeDeposit    C 16 W 3 M 4 S 0 X 0
  daysFundsMustRemain                    C 7 W 2 M 6 S 0 X 2
  debitCount                             C 2 W 0 M 2 S 0 X 0
  debitWithinDays                        C 1 W 0 M 1 S 0 X 0
  monthly_fee                            C 27 W 3 M 1 S 0 X 0
  early_termination_fee                  C 2 W 0 M 0 S 0 X 20
  etf_window_days                        C 3 W 0 M 2 S 0 X 0
  promo_code                             C 6 W 0 M 0 S 0 X 0
  bonus_post_min_days                    C 1 W 0 M 5 S 0 X 0
  bonus_post_max_days                    C 5 W 2 M 4 S 0 X 0
  churnable                              C 14 W 0 M 3 S 0 X 2
  churn_wait_months                      C 13 W 1 M 3 S 0 X 1
  churn_anchor                           C 7 W 5 M 5 S 0 X 3
  spendAmount                            C 0 W 0 M 0 S 0 X 3
  transactionsCount                      C 3 W 0 M 0 S 0 X 0
  --- presence ---
  fee_waiver_condition                   C 6 M 11 X 0
  churn_notes                            C 25 M 0 X 0
  bonusPointsNote                        C 1 M 1 X 0
```

### `node parity-check.js`
```
===== HTML-vs-TEXT parity (5 posts) =====
Fields present in either form: 55  agree: 55  = 100.0%
No divergences — text paste parses identically.
```

---

## BASELINE — pre-calibration parser (before this run's fixes)

`git stash` was unavailable (the tree carried unrelated pre-existing files), so
the baseline parser was extracted straight from git history — the last commit
**before** the calibration run touched the parser — and scored with the *same*
harness, gold labels, and posts:

```bash
# 6b101bd = "Churn: 60-day window + snooze" (R67, v2026.07.08b), the pre-run parser.
git show 6b101bd:index.html > /tmp/baseline-6b101bd-index.html
```

**Harness adaptation (documented, minimal):** the loader normally reads the
repo's live `index.html`. For the baseline it was pointed at the extracted file
by overriding one constant — `REPO` → the extracted file's directory and the
read target → `baseline-6b101bd-index.html`. Nothing else changed: same
`score.js`, same `normalize-gold.js`, same gold set, same 31 posts. The loader
already marks the calibration-run helpers (`docScanTiers`, `docDateSegments`,
`docIsCardFundingLabel`, `docReconcileScalar`, `docChurnAnchor`) **optional**, so
it loads the older parser cleanly (those functions simply don't exist at
6b101bd — confirmed by grep).

### `node score.js` (against 6b101bd parser)
```
===== BASELINE SCORE (real parseDocPost, entry-content HTML input) =====
Posts scored: 31
VALUE fields: correct 152  wrong 55  missed 56  spurious 0  extra(unverif) 55
  accuracy on fields the parser filled vs known gold (C/(C+W)): 73.4%
  recall of known-gold values (C/(C+W+M)): 57.8%
PRESENCE fields: correct 31  missed 13  extra 0
Calibration acc — high 75.7% (81/107)  med 78.4% (69/88)  low 16.7% (2/12)
*** HIGH-CONFIDENCE WRONG: 26 ***
   [01] requiredFundingAmount: got 300 want 5000
   [01] monthly_fee: got 0 want 16
   [02] requiredFundingAmount: got 250 want 25
   [03] requiredFundingAmount: got 3000 want 5000
   [03] monthly_fee: got 0 want 30
   [04] requiredFundingAmount: got 500 want 4000
   [05] ddRequired: got false want true
   [05] monthly_fee: got 0 want 5
   [08] requiredFundingAmount: got 250 want 5
   [10] signupBonusAmount: got 900 want 1400  (glance headline=900)
   [10] offerExpirationDate: got "2026-06-30" want "2026-12-29"
   [13] requiredFundingAmount: got 500 want 5
   [14] signupBonusAmount: got 300 want 250  (glance headline=300)
   [16] signupBonusAmount: got 200 want 600  (glance headline=200)
   [16] offerExpirationDate: got "2023-02-07" want "2026-09-30"
   [17] offerExpirationDate: got "2019-09-30" want "2026-06-12"
   [18] requiredFundingAmount: got 3000 want 1000
   [21] offerExpirationDate: got "2024-07-08" want "2026-10-26"
   [21] requiredFundingAmount: got 1000 want 30000
   [23] signupBonusAmount: got 350 want 500  (glance headline=350)
   [23] monthly_fee: got 0 want 15
   [26] signupBonusAmount: got 2000 want 1500  (glance headline=750)
   [26] requiredFundingAmount: got 500 want 2000
   [27] signupBonusAmount: got 415 want 815  (glance headline=300)
   [30] requiredFundingAmount: got 300 want 2500
   [31] requiredFundingAmount: got 1200 want 15000

Per-field matrix (C=correct W=wrong M=missed S=spurious[vs explicit gold] X=extra[gold silent]):
  signupBonusAmount                      C 18 W 11 M 0 S 0 X 0
  offerExpirationDate                    C 16 W 7 M 0 S 0 X 6
  ddRequired                             C 29 W 1 M 1 S 0 X 0
  requiredFundingAmount                  C 0 W 11 M 10 S 0 X 5
  daysAfterSignupAllowedBeforeDeposit    C 15 W 4 M 4 S 0 X 2
  daysFundsMustRemain                    C 7 W 2 M 6 S 0 X 2
  debitCount                             C 2 W 0 M 2 S 0 X 5
  debitWithinDays                        C 1 W 0 M 1 S 0 X 0
  monthly_fee                            C 26 W 4 M 1 S 0 X 0
  early_termination_fee                  C 2 W 0 M 0 S 0 X 20
  etf_window_days                        C 3 W 0 M 2 S 0 X 0
  promo_code                             C 5 W 1 M 0 S 0 X 0
  bonus_post_min_days                    C 0 W 0 M 6 S 0 X 0
  bonus_post_max_days                    C 3 W 4 M 4 S 0 X 0
  churnable                              C 12 W 1 M 4 S 0 X 6
  churn_wait_months                      C 11 W 1 M 5 S 0 X 2
  churn_anchor                           C 2 W 8 M 7 S 0 X 4
  spendAmount                            C 0 W 0 M 0 S 0 X 3
  transactionsCount                      C 0 W 0 M 3 S 0 X 0
  --- presence ---
  fee_waiver_condition                   C 6 M 11 X 0
  churn_notes                            C 24 M 1 X 0
  bonusPointsNote                        C 1 M 1 X 0
```

---

## Before → after (read straight off the two runs above)

| Metric (verbatim source) | Baseline `6b101bd` | Final (committed) |
|---|---|---|
| Field accuracy — C/(C+W) | **73.4%** (152/207) | **84.9%** (186/219) |
| Recall of known gold — C/(C+W+M) | **57.8%** | **70.7%** |
| High-confidence-wrong (dangerous class) | **26** | **2** |
| Calibration: high-confidence bucket | 75.7% (81/107) | 96.7% (59/61) |
| Calibration: medium bucket | 78.4% (69/88) | 87.1% (101/116) |
| Calibration ordering | **inverted** (high 75.7% < med 78.4%) | **corrected** (high 96.7% > med 87.1%) |
| HTML-vs-Worker-text parity (5 posts) | — | 100% (55/55) |
| Loader fidelity to app fixtures | — | 63/63 |
| In-app regression pins | — | 12/12 |

The two **surviving** high-confidence-wrong cells are known and were accepted on
the record during the run, because the alternative fixes over-fit this corpus and
broke other posts:

- `[05] monthly_fee: got 0 want 5` — the glance box says "Monthly fees: None"
  unconditionally; the $5 fee is stated only in body prose. Promoting body fee
  over an explicit "None" glance row would regress posts where the glance row is
  the correct current value.
- `[10] offerExpirationDate: got 2026-06-30 want 2026-12-29` — a stale glance
  expiration vs an application-window date in the body. Naïve body-date promotion
  broke fixtures 06/28, so the conservative read was kept.

Both are documented as intentional residuals under the run's "over-fit guard".
Note the final field-accuracy figure is **84.9%**, slightly under the run's
initial 85.4% mid-point: three later same-segment / negation / segmentation fixes
(caught by an adversarial review) corrected genuinely-wrong behavior that two
posts had been passing *by accident of a bug*; recovering those two cells would
mean reverting the correct fix. Correctness was chosen over the round number.
This is the honest −1-cell story, surfaced rather than smoothed.

## Honest limits

"Accuracy" above is **agreement with the adjudicated gold labels on these 31
posts** — not ground truth. The labels are careful human reads of messy,
contradiction-laden living documents (stale glance boxes, promo-code chains,
availability drift, targeted-tier exclusions) and are themselves fallible; the
**79.2% raw inter-rater agreement** is a real ceiling on label certainty, and the
adjudication resolved conventions (e.g. "the tiered max a careful churner
reaches") that a reasonable person could set differently. The corpus is a single
2026-07-07 snapshot of one slice (BofA + recent bank-account-bonus posts,
nationwide- or WI-eligible only); the numbers will move on other posts or as these
posts change. What this log *does* establish: a **reproducible, independently
re-checkable** before/after comparison against a fixed set of **real public posts
anyone can re-read** — the opposite of fabricated. Every figure here regenerates
from the commands shown.
