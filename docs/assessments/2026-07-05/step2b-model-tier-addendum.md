# Step 2 ADDENDUM — Extraction-Tier Model Choice (Haiku 4.5 vs Sonnet 5 vs Opus 4.8)

Pricing reconfirmed from official docs this pass: Haiku 4.5 $1/$5 per MTok; Sonnet 5 $2/$10 intro (through 2026-08-31) → $3/$15 standard; Opus 4.8 $5/$25.

## 1. Cost table (worst case 4k in + 0.5k out per offer)
| Model | Per-offer | 10/mo | 50/mo |
|---|---|---|---|
| Haiku 4.5 | $0.0065 | $0.065 | $0.33 |
| Sonnet 5 (intro) | $0.013 | $0.13 | $0.65 |
| Sonnet 5 (standard) | $0.0195 | $0.195 | $0.98 |
| Opus 4.8 | $0.0325 | $0.325 | $1.63 |
Differentials: Haiku→Sonnet intro +$0.0065/offer (+$0.32/mo at 50); Haiku→Opus +$0.026/offer (+$1.30/mo at 50). Entire spread $0.26–$1.30/mo at realistic volume — cost is NOT the deciding variable at any tier.

## 2. Value gained — where tier matters
Does NOT matter (deterministic already nails): canonical labeled glance rows (15/18 conform), bank name, URL. Plausibly matters (corpus-drift fields): prose funding/hold windows w/ word-numbers; semantic mapping of Updates→fields; BMO dual-bonus disambiguation; points-vs-dollars (Amex "50,000 membership rewards" written as $50,000 would be the exact catastrophic silent error feared); internally contradictory posts. HONEST SPLIT: highest-stakes failures (points, ranges, combined totals) are structurally-visible errors the design catches; the real case for above-Haiku is the PLAUSIBLE-LOOKING prose-number error (hold misread 60 vs 90 days) that eyes don't catch.

## 3. Safety ranking
(a) Preview/confirm UX with verbatim source snippets — DOMINANT, model-independent. (b) Deterministic-first layering — LARGE (shrinks LLM blast radius to ~5 ambiguous fields). (c) Model tier — SMALLEST marginal safety. THE TRIPWIRE: require per-field verbatim source quote, programmatically substring-checked against page text; unmatched quote → auto-flag. Model-independent hallucination catch; residual risk after tripwire = model quotes real snippet but misreads number/maps to wrong field — rare, and the one place stronger models help.

## 4. Recommendation
**Sonnet 5 for the extraction tier, with mandatory per-field verbatim-snippet verification — the design, not the model, carries the safety.** Not Haiku: differential is trivial and accuracy is prioritized on financially-actionable data. Not Opus 4.8: 2.5× Sonnet with no demonstrable marginal accuracy on 6-13KB fixed-schema extraction (ceiling set by source ambiguity, not model capability). Ship the tripwire regardless of tier.

## Open issues
- Snippet-match tolerance (exact vs whitespace/case-normalized) to avoid false rejects on <del>-cleaned text.
- Measure Haiku-vs-Sonnet residual on Collin's 18-post corpus before committing (cheap eval).
- If shipping after 2026-08-31, re-run costs at Sonnet standard $3/$15 (~$0.98/mo at 50 — still trivial).
