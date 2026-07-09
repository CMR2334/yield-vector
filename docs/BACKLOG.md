# Yield Vector — Backlog

Durable, cross-session parking lot. One entry per parked item with a pointer to
its full context. AI sessions: add items here instead of leaving them only in
chat or run checkpoints; remove entries when they ship (note the commit).
Priorities are owner-directed — nothing here self-dispatches.

## Recently resolved
- **`.card-soft` dead CSS rule** — removed in optimizer step 3 rider after owner
  approval. Only the unused class rule was deleted; the `--card-soft` color
  variable and all live uses remain.

## Features
- **Opt-in dark mode** — fresh implementation against the module structure. Idea
  preserved from closed PR #2 (2026-07-02 audit branch; its diff targeted the
  pre-split single-file index.html and is unmergeable — do not resurrect the
  branch, reimplement).
- **Worker "Save & test"** — optional connectivity/auth ping through the DoC
  import Worker on save (parity with the Gist "Save & test"). Offered 2026-07-08.

## UI polish
- **Hero "Today" axis label alignment** — owner (2026-07-08 late): left-align the
  label abutting the chart's left boundary at the lowered axis row (the centered
  placement clips the first letter at the SVG edge). Queued for the first
  post-engine UI batch (v2026.07.09f candidate).
- **Plan-tab stat color-system unification** — Plan's non-shortfall amber mirrors
  Overview via a documented hardcode; unify both tabs on one token if
  `.stat-value.lighten` ever changes. Context: v2026.07.09b batch report.

## Optimizer future enhancements (design doc: docs/assessments/2026-07-09-optimizer-design.md)
- **Fee-netting objective** — v1 objective is GROSS bonus by design (§4).
- **safeToCloseDate / ETF timing in completion tie-break** — excluded v1 (§4).
- **Commitment co-scheduling** — linked manual commitments are user-pinned and
  excluded as candidates v1 (§2.1a).
- **730d horizon ceiling** — documented in-code; revisit only if an instrument
  longer than ~2 years is ever modeled (hotfix 3ed67e8 note).

## Code-health (deliberately deferred — high evidence bar, low payoff)
- **Tier-3 consolidation backlog** — normalizeText modes, CSS mobile/modal
  containment merge, formatCurrencyDecimal removal (owner call),
  summarizeProjection settings param, cycle-breaking setters, always-true
  typeof-Sync guard, restorePreV2Backup relocation, .chip-offer-type-other.
  Full detail: docs/assessments/2026-07-08-module-split-design.md §9 Tier 3.
- **dd-methods.json cold-offline precache** — currently cached opportunistically;
  add to the SW precache if guaranteed cold-offline DD-methods is wanted
  (split-run P3 report).
- **DD round-trip DST edge review** — pinned in the DD matrix; explicit review
  flagged in the optimizer design (§11.4).
