# DoC parser calibration corpus

This directory is the **evidence** behind the accuracy numbers claimed for Yield
Vector's Doctor of Credit (DoC) import parser (`parseDocPost` in `index.html`).
It exists so anyone can independently reproduce those numbers instead of taking
them on faith.

It holds **facts only** — a manifest of real public post URLs, hand-labeled
expected extractions ("gold" labels), the adjudication log, and the scoring
harness. The **raw post bodies are deliberately NOT committed** (see
[Copyright](#copyright)). You re-hydrate them locally to run the full score.

## What's here

| Path | What it is |
|------|------------|
| `manifest.json` | 32 candidate posts: URL, title, posted/updated dates, availability language, eligibility verdict, tiered flag, legacy-corpus flag. (31 scored + id 11, the one body-confirmed exclude, kept for the audit trail.) |
| `excluded.json` | 19 posts excluded at triage because their state list doesn't include WI (or are otherwise ineligible), each with the reason. |
| `labels/gold/NN.json` | 31 gold labels — the adjudicated expected extraction per post, in the fixed label schema (bank, product, availability, bonus/tiers, expiration, requirements, fees, ETF, promo code, DD, bonus-post window, churn, update dates, superseded values). |
| `labels/gold/_adjudication.md` | How the gold set was produced: inter-rater agreement, every double-labeled disagreement + ruling, and the labeling conventions adopted (e.g. "tiered bonus = the max tier a careful churner reaches"). |
| `harness/*.js` | The scoring harness (see below). Zero-dependency except jsdom (a *verify-time* tool, not a repo dependency). |

## How the gold labels were made

Three independent labelers each hand-labeled a disjoint ~⅓ of the corpus **from
the post content only** (no access to parser output — this prevents anchoring the
labels to what the parser happens to emit). 6 posts were double-labeled to
measure agreement: **raw inter-rater agreement was 79.2%** on the scalar-field
set (81.1% excluding one pure labeling-convention item), with the messiest post
(a state-gated Huntington promo) the worst at 50%. Every disagreement, plus 9
flagged messy posts, was then adjudicated against the post text into a single
gold label per post; the reasoning is in `labels/gold/_adjudication.md`. Each
gold file records its provenance in `_gold_provenance`.

## The one-command verification story

**Prerequisite (one-time):** the harness parses `index.html` with a real WHATWG
DOM via [jsdom](https://github.com/jsdom/jsdom). jsdom is intentionally **not** a
repo dependency (Yield Vector ships zero runtime deps and is a single static
`index.html`). Install it just for the verify run, without touching
`package.json`:

```bash
cd docs/fixtures/doc-corpus/harness
npm i --no-save jsdom
```

**Checks that need no post bodies** (run immediately after the install above):

```bash
node fidelity-check.js        # loader reproduces the app's own 7 fixtures  -> PASS 63 FAIL 0
node regressions-check.js     # the app's testDocParserRegressions() pins    -> PASS 12 FAIL 0
node dd-matrix.js             # direct-deposit yes/no phrasing matrix        -> ALL PASS
node p2b-segmentation-pin.js  # "Offer at a glance" lands in the undated base -> P2B-SEG PIN: PASS
```

`fidelity-check.js` is the trust anchor: it runs the app's **own** embedded
`DOC_TEST_EXPECT` fixtures through the Node loader and asserts identical results,
proving the loader didn't change parser behavior versus the browser.

**Full corpus score** (needs the re-hydrated posts — see next section):

```bash
node fetch-posts.js           # re-download the 32 posts into ../posts/ (polite, resumable)
node score.js                 # field accuracy / recall / calibration / high-conf-wrong list
node parity-check.js          # HTML-paste vs Worker-text-paste parity (5 posts)
node taxonomy.js              # categorize remaining misses (reads score-results.json)
```

The exact commands, the current committed parser's **verbatim** output, and the
pre-calibration baseline for comparison are recorded in
[`../verification-log.md`](../verification-log.md).

## How to re-hydrate the posts

The posts aren't committed, so `score.js` / `parity-check.js` look for them in a
local, git-ignored `posts/` directory (or wherever `$DOC_CORPUS_POSTS` points).
Two ways to populate it:

1. **Automated (polite):** `node harness/fetch-posts.js` reads `manifest.json`
   and saves each post's page HTML to `posts/NN-slug.html` — one request at a
   time, real browser UA, a delay between requests, and it skips files already on
   disk. If DoC blocks automated fetches, fall back to:
2. **Manual:** open each `manifest.json` URL in a browser and *Save Page As → Web
   Page, HTML Only* into `posts/`, using the same `NN-slug.html` name (the `NN`
   two-digit id must match the manifest `id`).

`score.js` reads a post's `.entry-content` (what a select-all-copy of the article
carries) and feeds that to the parser — the same input shape the app's paste path
sees. It's fine if a live post has drifted since labeling; the labels are pinned
to the state recorded in `manifest.json` (`updated_dates_seen`), and the corpus is
real public posts anyone can re-read to check a label.

## Copyright

Only **facts and short factual quotes** live here — URLs, dates, dollar amounts,
requirement counts, and brief verbatim eligibility/requirement clauses needed to
justify a label (e.g. a churn "limit language" sentence). The **post bodies
themselves are never committed**; `.gitignore` makes an accidental `git add` of
`posts/` a no-op. Re-download them yourself with the manifest — they are public
pages on doctorofcredit.com.

Note on quote length: a handful of `*_verbatim` label fields (single
eligibility/limit-language clauses) run longer than the ~160-char guideline the
run set for churn snippets — the longest is ~290 chars. These are single factual
sentences retained as the evidentiary basis for an adjudication, not post prose;
they can be trimmed further without affecting any score (the harness never reads
them).

## Honest limits

"Accuracy" here means **agreement with the adjudicated gold labels on these 31
posts** — not ground truth. The labels are careful human reads of messy,
contradiction-laden living documents and are themselves fallible (79.2% raw
inter-rater agreement is a real ceiling on label certainty). The corpus is a
2026-07-07 snapshot of a specific slice (BofA + recent bank-account bonus posts,
nationwide- or WI-eligible only); numbers will differ on other posts or as these
posts change. What the corpus *can* honestly support: a **reproducible
before/after comparison** of the parser against a fixed, independently-labeled,
publicly-re-readable set.
