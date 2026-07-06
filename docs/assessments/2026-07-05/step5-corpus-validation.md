# Corpus Validation — Collin's 18 Real DoC Posts (Step 5 full deliverable)

All 18 URLs fetched HTTP 200 (entry-content 6.1–23.2KB; Relay shortest at 4.1KB). Files: scratchpad/doc-samples-user/{1-18}.html + _entry.html + _glance.html extracts.

## Compatibility highlights (vs parser assumptions A1–A6)
- A1 (entry-content, server-rendered): HELD 18/18.
- A2 (canonical 11-label glance set, stable order): BROKE 3/18 — #1 Huntington (2016-era): extra "U.S. Citizenship Required" label, "Chexsystems" lowercase-s variant, non-canonical order; #12 SoFi + #14 Relay (fintechs): ChexSystems row MISSING entirely; #14 Relay: extra trailing "Insurance" (FDIC) label. Drift correlates with age/fintech, not random; 15/18 conform exactly.
- A3 (Update paragraphs, newest-first): presence 18/18, but #1's updates are NOT chronologically sorted (5/10/26, 1/26/19, 10/14/18, 10/8/22...); 8/18 posts lead with a NON-dated status line ("Deal has ended...", "Bonus has now ended...", "Available again at...") before/interleaved with dated updates.
- A4 (4 canonical h2s): 17/18; #14 Relay MISSING "The Fine Print"; 5/18 append extra h2s (Bonus History, Referral Bonus, F.A.Q's, Update History) without displacing canonical ones.
- A5 (taxonomy tag classes on article): BROKE on #16 Wintrust — zero tag-* classes (only category-bank-account-bonuses).
- A6 (dollar amount): BROKE on #10 Amex — glance amount is "50,000 membership rewards" (points, no $). #7 Chime surprise: glance row is USD cash equivalent ("$155-$182") despite Swagbucks title — SB figures live only in prose/title. Ranges ("$50 – $300" SoFi) and combined dual-bonus totals (#5 BMO single "$560" for two account bonuses, no per-account glance breakout) also occur.
- <del> struck history common in Expiration/EATF rows (#1 has 10+ struck dates concatenated; #11, #12 too).

## Required design amendments (8, factual)
1. Tolerate missing ChexSystems row (fintechs).
2. Fuzzy/case-insensitive label matching, tolerate unknown extra labels at arbitrary positions — never fixed positional index.
3. Amount row: support points/free-text amounts (no unconditional $ regex; fall back to raw string capture).
4. Amount row: support ranges and combined dual-bonus totals (BMO breakout only in h2 sub-sections, not glance).
5. Update parser: accept non-dated leading status lines; parse ALL dates and take max — never assume sorted or first-is-newest.
6. h2 check: "all 4 occur somewhere" too strict — must be tolerant/optional per-heading (Relay lacks Fine Print).
7. Taxonomy-class extraction must handle zero matches (Wintrust).
8. Strip <del> content (or take last non-del segment) before extracting li text — naive extraction concatenates retired values.

## Step 5 open issues
- Update-block chronology exhaustively verified only on #1/#15/#17.
- "Contents" TOC blocks (#9,10,11,14,18) might interact with a naive "glance = before any h2" boundary rule — flag for implementer.
