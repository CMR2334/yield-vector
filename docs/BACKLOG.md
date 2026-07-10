# Yield Vector — Backlog

Durable, cross-session parking lot. One entry per parked item with a pointer to
its full context. AI sessions: add items here instead of leaving them only in
chat or run checkpoints; remove entries when they ship (note the commit).
Priorities are owner-directed — nothing here self-dispatches.

## Recently resolved
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

## Bugs — QUEUED FIX (v2026.07.09l candidate, dispatch after the champions batch lands)
- **DD posting-date qualification gaps** (Codex read-only audit 2026-07-09, owner-prompted;
  full table in the audit log — key rows preserved here). The engine's DD qualification
  compares `directDepositEffectiveDate` (weekend/holiday shift ONLY) against literal
  cutoffs, ignoring ACH transit (`ddRoundTrip(dd,cfg).post` = initiate + inDays business
  days). CONFIRMED by live probe: DD planned Fri 2026-01-16, user deadline Mon 2026-01-19
  (MLK) → plan returns valid:true while the modeled post is Tue 2026-01-20. Four gaps:
  (1) count-mode cutoff check, optimizer-engine.js:507 — use ACH post date;
  (2) frequency-mode bucket/window check, :490 — same;
  (3) frequency mode builds but NEVER APPLIES user/expiry cutoffs, :482;
  (4) dd-core.js ddWindowEndDate count mode uses effective not post — DECISION NEEDED:
  fixing it also changes reminders/feed deadlines (more conservative = more truthful,
  but an intentional feed change — flag, don't sneak); alternatively fix engine-side
  only and leave the display helper. Also: legacy runOptimizer (projection-optimizer.js:339)
  has no qualification layer — unused by UI, document or guard. Fix must add pins for the
  MLK repro + a frequency-cutoff fixture; note enhancement: local repair could pull an
  individual DD's initiation earlier instead of rejecting the date wholesale (P1-3 group
  shift doesn't move DDs independently today). SAFE side confirmed by the same audit:
  deposit deadline (bizDay-effective vs literal, :524), suggestedFundingDate backward
  walk, expiry, withdrawal/completion, horizon.

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
