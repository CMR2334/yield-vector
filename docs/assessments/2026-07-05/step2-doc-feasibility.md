# DoC URL Parsing — Feasibility & Design (Yield Vector, Step 2 full deliverable)

Grounding confirmed by executor: offer model fields at index.html~6843 (bankName, offerName, offerType, ddRequirement{mode,count,freqEvery,freqPeriods}, debitRequirement{required,count,byDate}, directDeposits[], requiredFundingAmount, signupBonusAmount, offerExpirationDate, plannedSignupDate, daysAfterSignupAllowedBeforeDeposit, daysFundsMustRemain, optionalPlannedFundingDate, lockStartsFrom, docUrl, entityUsed, emailUsed, notes, confidence, subStatus, accountStatus); form/readOfferForm at 6294/6810; ErrCode at ~2091 + logError → ring buffer + console + toast; syncConfig in localStorage holds Gist PAT (secret precedent); DDMethods.slug() fuzzy bank matching; Haiku 4.5 pricing verified $1/$5 per MTok (Sonnet 5 $3/$15, intro $2/$10 through 2026-08-31). Prior HANDOFF_ARCHIVE "DoC URL ingestion" deferred analysis accounted for and superseded.

## (a) Field-Mapping Matrix
Primary machine target: "Offer at a glance" list (identical labeled rows, all 7 posts). Requirement detail lives in "The Offer" bullets and Fine Print prose (sometimes word-numbers). CRITICAL RULE: parsed DoC facts populate offer PARAMETERS only; planned signup/funding/DD dates stay USER-owned (app already derives suggestions via suggestedFundingDate / DD "Generate dates"); importer never writes plannedSignupDate, optionalPlannedFundingDate, or directDeposits[].plannedDate.

| DoC fact | Target | Confidence | Reminder impact |
|---|---|---|---|
| Max bonus amount (glance) | EXISTING signupBonusAmount | high (tiered needs pick; stale vs Update 4/7) | no |
| Expiration date (glance) | EXISTING offerExpirationDate | med (stale 4/7, format-inconsistent; reconcile w/ Update) | YES — expiration reminder |
| Funding amount+window | EXISTING requiredFundingAmount + daysAfterSignupAllowedBeforeDeposit | med (bullets/prose, word-numbers, tiers) | yes (derived funding deadline) |
| Hold window | EXISTING daysFundsMustRemain + lockStartsFrom | med (Fine Print prose) | yes (derived lock-release) |
| DD required (glance + taxonomy tag) | DERIVED → offerType (3-way) | high boolean / med mapping | no |
| DD count/amount/timeframe | EXISTING ddRequirement{...} | low–med (prose; mode choice interpretive) | yes (derived DD schedule) |
| Debit-txn requirement | EXISTING debitRequirement{...} | med | yes (debit-by deadline) |
| Bank name (title/H1) | EXISTING bankName (fuzzy slug) | high | no |
| Offer name/tier | EXISTING offerName | med | no |
| Source URL | EXISTING docUrl | high | no |
| Bonus-posting timing | NEW SCHEMA → notes v1 | med | would generate "bonus should post by" reminder (top graduation candidate) |
| State eligibility (glance + tags) | NEW SCHEMA → notes v1 | high | no |
| In-branch vs online | NEW SCHEMA → notes | med | no |
| Business vs personal | DERIVED hint → entityUsed pre-select | med | no |
| Monthly fee + waiver | NEW SCHEMA → notes | high | no |
| ETF / safe-close window | NEW SCHEMA → notes | med (sometimes blank/del-struck) | yes if formalized (safe-close reminder — top graduation candidate) |
| Household limit | NEW SCHEMA → notes | high | no |
| ChexSystems | NEW SCHEMA → notes | med (can contradict prose) | no |
| CC funding allowed | NEW SCHEMA → notes | high | no |
| Promo code | NEW SCHEMA → notes | low–med (location varies: link URL, Update block, unprinted) | no |
| Targeted-only | NEW SCHEMA flag | med | no |
| Hard/soft pull | NEW SCHEMA → notes | med | no |

~9 facts map to existing fields (the churning-critical ones); ~11 are NEW SCHEMA → notes for v1 (zero schema change, Gist-sync safe), with bonus-posting timing + ETF safe-close flagged as highest-value future dedicated fields (actionable reminders).

## (b) Transport analysis (GitHub Pages origin; DoC sends no CORS headers)
- Public CORS proxy: zero infra, unreliable + privacy concerns — fallback only.
- Self-hosted Cloudflare Worker (free tier): fetch page, return entry-content w/ CORS; ~30 lines; can also hold Anthropic key as Worker secret and do extraction server-side. Reliable, private, modest setup.
- LLM extraction (Haiku 4.5): entry-content 7–13KB ≈ 2–4k input tokens + ~300–500 output. $1/$5 per MTok → ≈$0.0065/offer (worst ~$0.009). Sonnet 5 ≈$0.02 (intro ~$0.016). Cost non-issue; 50 offers/mo ≈ $0.33.
- User key in localStorage: same trust model as existing Gist PAT; Claude API is CORS-callable from browser, but page fetch still needs proxy/paste.
- iOS Shortcut share-sheet fetch: no CORS in Shortcuts; pushes into Gist feed; per-offer manual gesture + moving part.
- Paste-page-text: ZERO transport problem; natural degradation target; slightly more friction.
- Local Node tool (tools/parse-doc.js, precedent build-dd-methods.js): regression corpus + desk bulk imports, not the live path.

## (c) Designs
Shared: parseDocGlance(html|text) deterministic parser (regex labeled rows + "Update M/D/YY:" prefix; anchor taxonomy tags to first <article>), reconcileRecency(glance, updates) (newest Update wins; surface both), previewToForm fills only empty inputs; all errors → logError(..., 'doc-import'), degrade to manual entry.

1. **Deterministic-only paste-text (zero infra)** — textarea in modal → parse in-page → preview → per-field confirm. No secrets; works offline. High reliability for glance fields, low for prose. ~1 day. $0.
2. **Cloudflare Worker fetch + deterministic parse (+ optional Haiku assist)** — URL in docUrl → Import → Worker returns entry-content → parse → preview; optional Worker-side Haiku call (key as Worker secret) for low-confidence prose fields. Import needs network; creation still works offline. ~2–3 days. ~$0.0065/offer when LLM used.
3. **Client-side Haiku, user key in localStorage + paste-text transport** — settings holds anthropicKey (PAT precedent); paste text → browser→Claude API → preview. Highest field coverage; ~2 days; same per-offer cost on user's key.

**Recommendation:** Ship Design 1 first — worth shipping alone (glance list = highest-confidence target, covers churning-critical fields, zero infra/secrets/cost, never blocks creation). Layer Design 2's Worker as v2 (removes paste step; Haiku assist ONLY for low-confidence prose fields: funding, hold days, DD count/timeframe). Prefer Worker-held key over localStorage (better isolation, solves fetch CORS in one hop).

## (d) UX acceptance criteria
1. Paste DoC URL (existing docUrl) or page text; "Import from DoC" button; feature additive, modal fully usable without it.
2. Success → PREVIEW panel (not form): each field shows name, value, confidence badge, verbatim source snippet.
3. Recency reconciliation surfaced: "glance says 9/30/2025, Update says extended to 6/30/2026 — using 6/30/2026" (overridable).
4. Per-field confirm checkboxes or "Apply all"; only confirmed fields write.
5. Never overwrite non-empty fields without explicit per-field confirm (show conflict: keep/replace).
6. Dates stay user-owned: preview never sets planned dates; existing derivation generates suggestions from parameters.
7. NEW-SCHEMA facts shown in preview; on apply, appended to notes as a labeled block, never dropped.
8. Any failure → logError + non-blocking toast + manual form fully functional; never blocks offer creation.
9. Internally-conflicting posts (Navy Fed incomplete edit, Blaze pull-type): affected fields low-confidence and default UNCHECKED.

## (e) Verdict
**Feasible-with-caveats — and worth building.** Deterministic glance parser = 1-day, no-infra win covering churning-critical fields with mandatory recency reconciliation (4/7 posts had stale glance data). Prose-detail fields are where the optional Worker+Haiku tier (~$0.0065/offer) earns its keep. ~Half the interesting facts have no schema home → notes for v1. Layered feature whose first layer stands on its own.

## Step 2 open issues (for implementer)
1. Which 2–3 NEW-SCHEMA facts graduate from notes to dedicated fields with reminders (bonus-posting timing, ETF safe-close, state eligibility).
2. Build regression corpus via tools/parse-doc.js to harden prose regexes (word-numbers, <del> history).
3. Tiered-value UX (which of $400/$800 to pre-select).
4. Confirm Cloudflare Worker acceptable as ongoing infra before committing to v2.
