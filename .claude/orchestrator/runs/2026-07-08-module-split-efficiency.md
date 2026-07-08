---
run: 2026-07-08-module-split-efficiency
task: "the overnight work to be done with significant calling upon Codex to offload token burden is to both plan the migration into multiple files, and in the process audit the entire codebase and look for places to be more efficient, but with a relentless emphasis/focus on not compromising quality, features, formatting, etc. from it's current state via erroneous deletion. [Owner approved sequence; proceed thoughtfully; auto-resume on usage-window reset without manual nudge.]"
status: planned
created: 2026-07-08T01:40:00-05:00
config_snapshot: { planner: fable, executor: opus, worker: sonnet, codex: { planner: review-before-approval, executor: review-after, worker: review-after } }
plan_approved: pre-authorized (owner, verbatim above; codex plan critique still runs and folds in before execution)
current_step: 0
---
## Context
Split Yield Vector's single-file `index.html` (~14.5k lines, hit the agreed 15k structural trigger) into native ES modules — same repo, same GitHub Pages URL, zero build step — and run a full-codebase efficiency audit/consolidation in the process. OWNER'S PRIME DIRECTIVE: nothing lost — no feature, behavior, formatting, or aesthetic regression; "erroneous deletion" is the named fear. Codex does the heavy reading/analysis (token offload, owner-directed). Starts ONLY after the action-tracking release (v2026.07.08e) ships. Safety net: full existing verification stack — testDocParser 63/63 + 13 regression pins, corpus score ≥84.9% via docs/fixtures/doc-corpus/harness, feed byte-identity on fixed seed, preview E2E, 380px pass — ALL must stay green at every phase boundary.

## Key decisions
- Overnight autonomy: pre-authorized by owner incl. auto-resume after usage-window resets (hourly cron `yv-overnight-resume` checks for a stalled in-progress run and resumes; planner deletes the cron at run completion).
- Codex offload: audit analyses run via `codex exec --sandbox read-only` (boundaries/dead-code/duplicates/CSS) — findings are INPUTS, never applied without Claude executor verification + gates.
- Deletion ratchet (anti-erroneous-deletion): code may be removed ONLY when (1) Codex flags it dead AND (2) a Claude executor independently confirms zero references (call-graph + dynamic dispatch check: onclick strings, data-action names, DOC_FIELD_MAP keys, CSS selectors vs DOM classes) AND (3) all gates stay green after removal. Anything failing any leg stays. Every removal listed in the checkpoint with its double-confirmation evidence.
- MOVE-ONLY vs CHANGE commits strictly separated: split phases relocate code byte-preserving (only export/import statements added); consolidation commits come after the split is fully green, one consolidation class per commit, each independently revertable.
- Rollback: tag `checkpoint-2026-07-08-pre-modules` at the pre-split HEAD, pushed immediately. Push policy: local commits per phase; push at each fully-green phase boundary (split-complete, then per consolidation batch) — NOT per intermediate move.
- PWA/service-worker: cache manifest must enumerate new module files; preview verification includes offline-reload check + a hard-refresh cache-bust story (bump cache version per existing convention if one exists — investigate).
- AGENTS.md is still dirty with owner's uncommitted R62-R64 edits — MUST NOT be touched; the new architecture map goes in HANDOFF + a new docs/ARCHITECTURE.md (flag to owner: fold into AGENTS.md after he commits his pending changes).
- The corpus harness's parser-loader extracts from index.html — the split WILL break its extraction path; step 3 must update the loader (repo `docs/fixtures/doc-corpus/harness/parser-loader.js`) to import the new module directly (this is an IMPROVEMENT the split enables) and re-verify 84.9% unchanged.

## Prerequisite (08e release, before this run starts)
The in-flight action-tracking step's release MUST also include SIX owner items (dispatch to agent a0b0591cd4ec6b42f before its commit; if that agent is dead, fresh executor): (1) chart legends back to STACKED but tighter — 2-column grid: overview chart 2×3, timeline 2×2 (owner correction of the flex-wrap change); (2) tier-picker rows gain an annualized-return chip: rate = tier.bonus / tier.threshold_min, annualized ×(365 / lockDays) where lockDays = tier.hold_days || offer-level daysFundsMustRemain — when NO lock duration known, plain ROI% labeled "(no hold data)"; chip "≈N%/yr", muted; verify BofA contrast (small tiers ≫ $250k rung). (3) Tier radio bubbles vertically CENTERED against the row body (owner; was the 4b noted nit). (4) Waiver-truncation bug (owner's live BofA URL import): fee_waiver_condition captured "…otherwise you must:" and DROPPED the following bullet list — when a captured condition ends with a colon and bullets follow in the same segment, append the bullets joined as "; or " clauses (cap ~240 chars, ellipsis beyond); add fixture coverage (colon+bullets waiver pattern). (5) Capitalize-first-letter rule: text values applied into form boxes via _docSetInput get capFirst — EXCLUDING promo_code (case-sensitive!) and URL fields; verify "smaller companies…"→"Smaller companies…". (6) Worker-path bank/offer-name gap (owner: URL import filled neither): page TITLE lives outside entry-content so the Worker never returns it → parser title heuristic finds nothing. Fix BOTH sides: cloudflare/doc-import-worker.js additionally returns {title: <page <title>/og:title/h1>} (backward-compat field); client prepends title as first line of the text fed to parseDocPost when bank/offerName would otherwise be absent, with a slug-derived fallback (URL path → words, LOW confidence) when title also absent. NOTE FOR OWNER: Worker fix requires his one-command redeploy (npx wrangler deploy) — morning task, client is backward-compatible either way. (7, DANGEROUS-class from owner's live BofA import) Hold anchor bug: parser wrote daysFundsMustRemain=60 anchored "(from funded date)" for "deposit within 30 days of account opening and maintain the balance from days 31 through day 90" — correct is 90 anchored FROM ACCOUNT OPENING (lockStartsFrom opening/'signup' enum). 60-from-funded under-holds by up to 29 days → bonus-clawback risk (app would say withdrawable day 61 when the real requirement is day 90). Pattern family "days X through (day) Y" in opening-anchored context → count=Y AND lockStartsFrom=opening; "maintain for N days after funding" → funded anchor, count=N. Locate + subordinate whatever path produced the 60. Regression pins BOTH anchor directions; fixture 06 expectations → 90/opening. ALSO: verify whether any import path writes plannedSignupDate (owner saw 7-15-2026 appear) — if import fills it, remove (personal planning data never imported); if it's a form default, report-not-change. Addendum delivered live to agent a0b0591cd4ec6b42f mid-round. (8, owner 03:5x) DoC "↗" card link moves BELOW the "Updated today" stamp text in the card foot (stacked, not side-by-side). RESUME NOTE: final-round agent died at session limit 02:08 mid-item-4 (_docSlugTitle); worker title changes landed, client helpers partial; resumed ~03:51 after window reset via heartbeat protocol w/ verify-then-complete instructions.

## Follow-on (conditional, owner-directed)
If this run completes fully green + pushed and the usage window allows: planner drafts the OPTIMIZER run checkpoint (constraint-based sequencing: slide sign-up dates, simulate capital curve incl. deposits/holds/withdrawals, hard min-cash-buffer floor, maximize return; churn-ready offers auto-considered as candidates BADGED "stored value from <date> — unverified" with prompt-gated Worker re-check to firm them up — agreed hybrid design), runs the codex plan critique, folds findings, and BEGINS execution (design/scaffold steps first) under the same overnight autonomy + gates. The optimizer builds on the NEW module structure.

## Steps
### 1. Codex audit fan-out + synthesis → design doc  [tier: executor, codex-heavy] [status: pending]
Intent: Four `codex exec --sandbox read-only` analyses over index.html: (a) module-boundary proposal (domain map w/ line ranges, dependency edges, suggested file list ~12-18 modules incl. load order); (b) dead-code candidates (unreferenced fns/vars w/ line refs — noting the dynamic-dispatch caveat); (c) duplicate/near-duplicate logic clusters (esp. legacy-vs-v2 date/requirement paths, name/money formatting); (d) CSS dedup/orphan-selector candidates. Executor verifies each finding class on a sample, then synthesizes `docs/assessments/2026-07-08-module-split-design.md`: final module map, migration order (pure-logic domains first → state/sync → render → shell), consolidation backlog RANKED by risk (with the double-confirmation evidence requirements), harness/PWA impact plan, rollback plan.
Expected files: docs/assessments/2026-07-08-module-split-design.md
Outcome:
Files:
Commit:

### 2. Plan gate on the design doc  [tier: planner + codex] [status: pending]
Intent: `codex exec` critique of the design doc; planner folds findings; pre-authorized proceed (no user question — owner asleep, directive verbatim in frontmatter). Record critique + dispositions here.
Expected files: none (checkpoint updates)
Outcome:
Files:
Commit:

### 3. Mechanical split, phased MOVE-ONLY  [tier: executor ×phases, sequential] [status: pending]
Intent: Tag + push `checkpoint-2026-07-08-pre-modules`. Then per design-doc order, phase-by-phase: extract domain(s) to /js modules (byte-preserving moves + export/import wiring only), slim index.html progressively, update service-worker/PWA cache list, update corpus-harness parser-loader to module imports when the parser moves. FULL GATE BATTERY at every phase boundary (63/63 + 13 pins + corpus ≥84.9 + feed byte-identity + preview E2E incl. offline reload + 380px). A phase that can't get green gets reverted, not forced. Local commit per phase; push at split-complete green.
Expected files: index.html, js/*.js, sw/cache manifest, docs/fixtures/doc-corpus/harness/parser-loader.js
Outcome:
Files:
Commit:

### 4. Efficiency consolidations (ratcheted)  [tier: executor; codex review-after each batch] [status: pending]
Intent: Work the ranked backlog from step 1: one consolidation class per commit (e.g. formatting-helper unification, CSS dedup, confirmed-dead removals) under the deletion ratchet (Codex + Claude double-confirmation + gates). Codex `codex-companion.mjs review --scope working-tree` after each batch. Stop-loss: any gate regression → revert that batch, log, continue with next class. Push per green batch.
Expected files: js/*.js, index.html (shell), possibly CSS
Outcome:
Files:
Commit:

### 5. Full verification + docs + wrap  [tier: executor + planner] [status: pending]
Intent: End-to-end battery on the final tree (all gates + full feature smoke incl. DoC import E2E on fixtures, tier picker, churn flows, templates, action tracking, sync-config surfaces); docs/ARCHITECTURE.md (module map + load order + conventions for future sessions); HANDOFF R71+ + CHANGELOG + APP_VERSION → 2026.07.09a; line-count + size before/after report incl. every deletion's evidence table; final push; planner deletes cron `yv-overnight-resume`; morning report.
Expected files: index.html, js/*, docs/ARCHITECTURE.md, HANDOFF.md, CHANGELOG.md
Outcome:
Files:
Commit:
