# Yield Vector — Backlog

Durable, cross-session parking lot. One entry per parked item with a pointer to
its full context. AI sessions: add items here instead of leaving them only in
chat or run checkpoints; remove entries when they ship (note the commit).
Priorities are owner-directed — nothing here self-dispatches.

## Recently resolved
- **DD posting-date qualification gaps** — shipped v2026.07.09l (R83): DD qualification
  now compares the ACH **post** date (`ddRoundTrip(dd,cfg).post` = initiate + inDays
  business days, using the engine's threaded cfg) against literal cutoffs — closing all
  four audited gaps. (1) count-mode cutoff, (2) frequency-mode bucket/window, and
  (3) the frequency-mode user/expiry cutoffs (built but never enforced) all use post-date
  semantics; a post-after-cutoff emits a distinct `dd-post-late` binding constraint
  ("a direct deposit would post after the deadline — initiate it sooner"). (4)
  `dd-core.js ddWindowEndDate` count mode → max post date (gained an optional `cfg` param
  defaulting to the live provider like `ddRoundTrip`); this DELIBERATELY moves the feed's
  "all DDs complete by" reminder later by the ACH in-days for count-mode DD offers (more
  truthful — matches its own "must have posted" copy). Frequency-mode window formula
  unchanged. Legacy `runOptimizer` (projection-optimizer.js) got a prominent
  cash-feasibility-ONLY guard comment. Enhancement (per-DD earlier-nudge local repair)
  DEFERRED — needs per-DD date freedom through the signup-keyed assignment + apply
  materialization, not a clean drop-in. Pins: optimizer 35→39 (MLK repro + control +
  frequency user-cutoff + post-window; no existing pin asserted the buggy semantics, so
  none were updated). Context: R83 / Codex read-only deadline audit 2026-07-09.
- **Inert "Optimizer max candidates" Settings input** — shipped v2026.07.09j:
  owner chose DELETE. Removed the user-facing knob — the Settings number input +
  hint (`render-main-views.js`), its 1–20 change-handler clamp
  (`events-actions-data.js`), the sample-seed write, and the `app-state.js`
  settings default (`maxOptimizerCandidates: 15`). The live Optimize engine keeps
  its own internal cap (`MAX_OPTIMIZER_CANDIDATES` = 20, untouched); the retired
  `runOptimizer` still tolerates the now-absent field via its `|| 15` fallback,
  and old persisted `settings.maxOptimizerCandidates` values are simply unread
  (no migration). Context: R79 / Codex P2 → owner delete decision.
- **Churn re-check one-click verify UX** — shipped v2026.07.09g: the Optimize
  panel's control is now a one-tap **"Verify value"** that fetches the source
  offer's stored DoC URL through the Worker WITHOUT opening the modal (the tap is
  the prompt gate). A changed optimization input persists through the update path
  and forces a full re-run ("values changed — plan re-optimized"); an unchanged
  one flips the badge to "Verified today". No stored URL, a tiered ladder, or a
  structural DD/requirements change falls back to the modal re-check flow. Reuses
  the shared `docWorkerFetchParse` pipeline (extracted from the modal fetch).
- **Hero "Today" axis label alignment** — shipped v2026.07.09f (`a1babb6`):
  left-aligned at `padL` (`text-anchor=start`) in the lowered axis row so it no
  longer clips the SVG left edge.
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
- **Plan-tab stat color-system unification** — Plan's non-shortfall amber mirrors
  Overview via a documented hardcode; unify both tabs on one token if
  `.stat-value.lighten` ever changes. Context: v2026.07.09b batch report.

## Cleanup (fold into the next app-touching batch)
- **Unreachable legacy `case 'timeline'` route** — `renderActiveView`
  (js/render-shell-overview.js:180); `goto-timeline` now routes via
  `App.setView('planner')` + segment. Pre-existing; re-verify then remove.
- **`localRequirementDeadlineISO` → `requirementDeadlineISO` consolidation**
  [low] — engine re-implements the formula (optimizer-engine.js:92 vs
  requirements-templates.js:90); formula-faithful today, consolidate on next touch.

## Optimizer future enhancements (design doc: docs/assessments/2026-07-09-optimizer-design.md)
- **Fee-netting objective** — v1 objective is GROSS bonus by design (§4).
- **safeToCloseDate / ETF timing in completion tie-break** — excluded v1 (§4).
- **Commitment co-scheduling** — linked manual commitments are user-pinned and
  excluded as candidates v1 (§2.1a).
- **730d horizon ceiling** — documented in-code; revisit only if an instrument
  longer than ~2 years is ever modeled (hotfix 3ed67e8 note).

## Code-health (deliberately deferred — high evidence bar, low payoff)
- **`localRequirementDeadlineISO` → `requirementDeadlineISO` consolidation [low]** —
  two near-identical deadline helpers coexist; consolidate to the canonical
  `requirementDeadlineISO` (requirements-templates.js) once a change touches that
  path. Untouched by the optimizer run (flagged in steps 3–4 reports).
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
