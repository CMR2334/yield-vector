# Doctor of Credit Bank-Bonus Post — Evidence Pack (Step 1, run 2026-07-05-yield-vector-assessment)

**Sample: 7 posts.** Fetched via curl with a desktop UA. All returned HTTP 200 with full article body text present in raw HTML on the first request — no bot-block, no challenge page, no JS-hydration gate. WebFetch not needed.

| # | Post | HTTP | Bytes |
|---|---|---|---|
| 1 | Old National Bank $400-$800 Business Checking (REQUIRED) | 200 | 237,260 |
| 2 | Bank of America $400-$2,500 Business Checking | 200 | 231,136 |
| 3 | Blaze Credit Union $150 Checking (MN, DD not required) | 200 | 236,415 |
| 4 | Navy Federal $200-$250 New Member Bonus | 200 | 237,044 |
| 5 | Park National Bank $300/$500 Checking (OH/IN/KY/NC/SC) | 200 | 239,374 |
| 6 | Chase $900 Targeted Checking+Savings | 200 | 241,415 |
| 7 | U.S. Bank $400-$1,200 Business Checking | 200 | 227,773 |

**Category coverage:** (a) held-funds-only → #1, #7; (b) DD-only → #4, #6 (checking leg); (c) combined hold+DD → #5 (All-Access tier), #2 (tiered hold); (d) no/soft expiration → #5 (EATF blank/unlisted); (e) business checking → #1, #2, #7; (f) state-limited → #1 (IL/IN/KY/MI/MN/WI in-branch), #5 (OH/IN/KY/NC/SC), #3 (MN); (g) mid-life "Update:" edits → all seven, heaviest #6 and #7.

## Key per-post findings (fact-table highlights)

### Post 1 — Old National Bank Business Checking (the user's example URL)
Tiered $400/$800; glance "Expiration date: 9/30/2025" but Update block says "Extended to 6/30/2026" (STALE-GLANCE EXAMPLE). Funding $4,000 or $20,000 within 30 days; hold days 31-90; "Direct deposit required: No" in glance; availability IL/IN/KY/MI/MN/WI in-branch only, new customers; EATF $25 within 180 days (Fine Print/Avoiding Fees h3); no promo code; bonus-posting timing not stated; ChexSystems Unknown.

### Post 2 — Bank of America Business Checking
Five bonus tiers $400→$2,500 in nested Offer bullets; expiration December 31, 2026 (glance); hold: "Maintenance Period begins thirty-one (31) calendar days...ends ninety (90)" (Fine Print prose — numbers written as words); "Early account termination fee: None" (glance); monthly fee $16 waivable; promo code UA2CIS embedded in the offer LINK URL, not prose; bonus posts within 60 days (Fine Print).

### Post 3 — Blaze Credit Union
Glance says "Maximum bonus amount: $150" but "Update 7/5/26: Increased to $250" (STALE-GLANCE); glance "Expiration date: 3.31.24" (very stale; date format inconsistency "3.31.24"); DD OR Automatic Payment alternative; 6 debit transactions in 60 days; MN only; bonus PRE-FUNDED at opening with clawback if closed <6mo; "Hard/soft pull: Mixed datapoints" in glance vs Verdict prose "It is a hard pull" (CONFLICT EXAMPLE).

### Post 4 — Navy Federal
Glance "$200" stale vs "Update 7/2/26: Bonus now $250"; expiration Nov 30 2025 stale relative to 2026 updates; DD $500+ recurring 3 of 4 months; promo code AM250CHK in Offer bullet; **cross-section conflict: "The Offer"/glance describe the current $250 DD offer but "The Fine Print" still describes an OLDER EasyStart certificate offer — incomplete edit left two offer mechanics on one page.**

### Post 5 — Park National Bank
$300/$500 tiers; glance expiration 3/21/26 vs Update "back until August 29, 2026"; $25,000 within 30 days + maintain remainder of 90 days (All-Access); DD $1,000+ within 90 days; OH/IN/KY/NC/SC; **glance EATF field present but VALUE BLANK**, prose: "I wasn't able to find a fee schedule so unsure if there is any EATF"; promo code required but value not printed ("use promo code on landing page"); bonus within 15 days after 90-day confirmation.

### Post 6 — Chase $900 Targeted
Combo structure $300+$200+$400; **expiration shown as strikethrough history via HTML `<del>` tags inside the glance list** (April 19 2023 → Jan 24 2024 → April 17 2024 → July 16 2025); EATF also `<del>`-struck from "Bonus taken back within six months" to "None"; DD any amount within 90 days (checking leg); $15,000/90-day hold (savings leg); targeted coupon, no printed code; ChexSystems "Doesn't pull"; Verdict flags conflicting reader DD-routing reports ("reports on both sides"); **this post's h2s are bare `<h2>The Offer</h2>` with NO `<span id=...>` anchor wrapper (anchor ids not 100% consistent site-wide).**

### Post 7 — U.S. Bank Business Checking
$400/$1,200 tiers with long amount history; glance expiration January 14 2026 stale vs Update "Valid through 09/27/2026"; $5,000/$25,000 funding, 60-day hold; 6 qualifying transactions; nationwide excl. NY & FL; promo code Q3BUS26 in the TOP UPDATE BLOCK (not glance/offer), history of prior codes; ChexSystems "Mixed data points"; comment-sourced tip embedded in an Update entry; **has a second, older "Post history:" changelog bullet list AFTER the footer links — two changelog conventions coexist.**

## Structural / HTML-shell notes (cross-page)

- **Article body selector:** `article.vce-single` (class list varies slightly) → `div.entry-content` holds all post content. Consistent across all 7.
- **Headings:** "The Offer" / "The Fine Print" / "Avoiding Fees" / "Our Verdict" are `<h2>` in every post; fee subsections `<h3>`/`<h4>`. MOST posts wrap heading text in `<span id="The_Offer">` (TOC anchors) but post #6 doesn't — text-match on h2 innerText is more robust than anchor ids.
- **"Offer at a glance" list:** top of entry-content before any h2; consistent `<strong>Label:</strong> value` pattern with IDENTICAL labels and order across all 7 posts: Maximum bonus amount, Availability, Direct deposit required, Additional requirements, Hard/soft pull, ChexSystems, Credit card funding, Monthly fees, Early account termination fee, Household limit, Expiration date. **The single most machine-friendly block.** Caveats: values sometimes blank (#5 EATF), sometimes stale vs Updates (#3, #4, #5, #7), and #6 embeds `<del>` strikethrough history inline.
- **"Update:" blocks:** plain `<p>` tags at very top of entry-content, before the glance list, newest first, format "Update M/D/YY: <text>". NO distinguishing markup/class — regex on the "Update " prefix required. Older "Post history:" trailing bullet list coexists on some posts (#7).
- **Article-level taxonomy tags:** the `<article class="...">` attribute carries WordPress tags like `tag-direct-deposit-not-required`, `tag-il-bank-bonuses`, `tag-soft-pull`, `tag-nationwide-bank-bonuses` — clean structured signal for state availability and DD requirement, independent of prose. Caveat: related-posts widgets elsewhere on the page also carry tag markup — must anchor to the FIRST/post-own `<article>` element, not page-wide regex.
- **JSON-LD:** generic WordPress/Yoast (`WebSite`+`WebPage`+`BreadcrumbList`); NO offer-specific fields. **OpenGraph:** og:title/og:description/og:image only; no offer fields.
- **Rendering:** fully server-rendered; all target facts present in raw curl HTML, above the comments boundary (wpdiscuz comments load separately but weren't needed).
- **Size:** raw HTML 227-241 KB/page; extracted entry-content 7-13 KB → **~95% boilerplate**.

## Step 1 files
Raw HTML + extracted article chunks saved at:
/private/tmp/claude-501/-Users-collinrekowski/10c2308a-9fe4-4e56-b9fa-b9636d23373b/scratchpad/doc-samples/ (post1_old_national.html … post7_usbank_business.html, category_page.html, plus *_article.html extracts).

## Open issues from Step 1
- Comments (wpdiscuz) not sampled structurally; conflicting-data-point language was thin in this sample (only Blaze pull-type and Chase DD-routing) — comment mining would need a deliberate follow-up if that signal matters.
