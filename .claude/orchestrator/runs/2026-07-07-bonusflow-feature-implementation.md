---
run: 2026-07-07-bonusflow-feature-implementation
task: "all 5 features carefully, thoughtfully, & strategically to provide a well-designed, improved version of what BonusFlow provides. Ensure there is no break down of aesthetics/formatting in implementation of new features, rather, take this as an opportunity to sharpen the aesthetics/formatting as it seems appropriate to do so. Carry forward through the night without asking for permissions as I'm going to bed. If something needs reversion: I assume it can be accomplished through github state recovery at the very least. Also implement a way for offers to record churnability/i.e. when they can be ran again, and have upcoming Churn dates show in the overview toward the bottom somewhere."
status: in-progress
created: 2026-07-07T00:05:00-05:00
config_snapshot: { planner: fable, executor: opus, worker: sonnet, codex: { planner: review-before-approval, executor: review-after, worker: review-after } }
plan_approved: codex-findings-noted (user pre-authorized overnight autonomy — no approval questions)
current_step: 2
---
## Context
Implement into Yield Vector (`/Users/collinrekowski/Automation/Yield Vector`, single-file vanilla-JS PWA `index.html` ~9.3k lines, localStorage + private Gist sync, GitHub Pages deploy from main, APP_VERSION `2026.07.07b` @ ~:2401) the 5 features recommended by run `~/.claude/orchestrator/runs/2026-07-06-bonusflow-yv-feature-review.md`, plus churnability tracking. Source designs: BonusFlow evidence (that run's step 3) + YV's `docs/assessments/2026-07-05/report.md` (Phase 6/7 DoC import design). Collin is asleep: FULL AUTONOMY authorized — no permission questions; GitHub state is the agreed recovery mechanism. Constraints: zero-infra/zero-secret/offline-capable; no personal/financial data in public repo; reminders `_feed` consumed by an iOS Shortcut (guide: `docs/SHORTCUT_BUILD_GUIDE.md`) — changes must be additive AND guide-updated; pending UNRELATED working-tree changes (`.claude/settings.json` M, `.codex/hooks.json` D, `AGENTS.md` M, `CLAUDE.md` M = Collin's R62-R64) must NEVER be committed, reverted, or modified; AGENTS.md must NOT be edited this run (dirty) — durable facts go in the HANDOFF entry instead.

## Key decisions
- Overnight autonomy (Collin, verbatim): Codex plan gate ran, findings incorporated (below), NO user approval question. Step failures: retry once same tier w/ failure context → escalate one tier / planner-narrowed retry → if still failing mark failed, skip hard-dependents, continue independents. All recorded here.
- Runs dir: repo-local `.claude/orchestrator/runs/` (matches assessment-run convention).
- Sequential steps only (single-file monolith); scoped `git add` per step (never R62-R64 files).
- **Push policy (revised per Codex):** commit per step LOCALLY; push to origin ONLY after step 11 verification passes. Rationale: GitHub Pages auto-deploys main and Collin's phone PWA + Gist sync could ingest a half-migrated schema overnight; local commits still survive crashes and preserve per-step history. If verification fails: no push, live site stays on `7c06e5f`, morning report explains. Safety tag `checkpoint-2026-07-07-pre-bonusflow` (NOT `stable-*` — reserved for owner-confirmed builds) at `7c06e5f`, pushed immediately.
- **Layering, not replacement (Codex critical):** legacy fields (`offerType`, `directDeposits`, `ddRequirement`, `debitRequirement`, hold/funding fields) remain canonical for existing consumers (`buildReminderItems` ~:5371, `renderOfferCard` ~:5984, `readOfferForm` ~:8063, projection/ROI/timeline). `requirements[]` layers on top: legacy DD/debit fields are auto-derived INTO requirement rows (and kept in sync) rather than deleted. Step 2 starts with a written consumer-inventory design doc before code.
- **Migration safety (Codex critical):** idempotent, non-destructive, pre-migration localStorage backup key + Settings restore path; unknown keys preserved BOTH in migration and in `readOfferForm` save path (merge-spread prior object — current save constructs a fixed object at ~:8103 and silently drops extras); migrated state NOT auto-pushed to Gist on first load (push only after first user-initiated save, per existing debounced-save semantics); storage-version guard so older app builds don't clobber v2 payloads (extend existing bilateral sync guard pattern).
- **Field promotion trimmed (Codex):** promote only fields with a UI consumer THIS run: monthly_fee + fee_waiver_condition, promo_code, early_termination_fee + etf_window_days, bonus_post_min_days/max_days, expiration date (if not already first-class), last_edited timestamp, churn fields + anchor dates (bonus_received_date, closed_date). state_eligibility + credit_inquiry stay in notes (no consumer yet).
- **Lifecycle = derived view (Codex):** the 4-stage pipeline maps over the EXISTING `accountStatus` + 9-value `subStatus` model (denied/archived/prospect etc. render as badges outside the pipeline), no status-model fork. `safeToCloseDate()` implements the intentional null stub at ~:4433 with `max(withdrawal-eligible, expected-bonus-posted+buffer, ETF window end, all requirements resolved)`.
- **Feed changes are versioned-additive:** stable per-requirement IDs (avoid the solved DD-id tombstone bug class); new feed kinds documented; fixed-seed before/after `_feed` JSON diff required in steps 3-5; `docs/SHORTCUT_BUILD_GUIDE.md` updated in step 11.
- **Per-step gates (Codex):** JS syntax check (extract inline `<script>` → `node --check`), preview console clean, mobile ~380px smoke on UI steps, `git status --short` review before every commit.
- DoC import v2 = gated scaffold (not fully "inert": settings field + hidden-until-configured URL mode): Worker source + deploy docs committed; zero secrets; zero network calls unless Worker URL configured. Deploying = Collin's morning task. Step 7 parser gets checked-in SYNTHESIZED fixtures replicating the 8 DoC quirks (no wholesale copying of DoC content; cite source URLs).
- Retiered per Codex: step 6 worker→executor (sort/filter state doesn't exist yet — new state + UI + schema touch); step 8 worker→executor (Worker security/CORS/prompt-validation/client gating).
- Codex tier suggestion "step 2 needs planner design substep": adopted as design-doc-first REQUIREMENT inside step 2; planner reviews the design doc at transcription before permitting step 3.
- Templates (step 9) must strip ALL personal instance data incl. entityUsed, emailUsed, notes, dates, completion state, churn notes (Codex: original list was incomplete; "last-4" doesn't exist as a field — do not invent it).
- APP_VERSION: bumped ONCE in step 11 (target `2026.07.08a`) + CHANGELOG entry; HANDOFF current-state block is stale (says 2026.07.07a) — step 11 corrects it in the new round entry.

## Steps
### 1. Baseline safety + conventions digest  [tier: worker] [codex: review-after] [status: done]
Intent: Create+push tag `checkpoint-2026-07-07-pre-bonusflow` at `7c06e5f`. Produce a dense conventions digest for injection into all later prompts: verify/expand these anchors — APP_VERSION ~:2401; feed builder + contract ~:5293 & `buildReminderItems` ~:5371; display↔storage helpers ~:4025 (`formatDateDisplay`/`parseDateInput`/`formatMoneyInput`/`parseMoneyInput` — NEVER bare-parse `data-money`/`.yv-date` fields); `.field-box` label rules ~:1672 (R61 min-height interaction — do not reintroduce); `.btn-grid`/`.btn-outline-danger` (R60); `renderOfferCard` ~:5984; `readOfferForm` ~:8063 (fixed-object save); `safeToCloseDate` stub ~:4433; `accountStatus`+`subStatus` enum values; offers search/status-filter state (no sort exists); storage/version/sync-guard mechanism + Gist push semantics; demo seed ~:9209; CSS design tokens (colors/spacing/letterspacing 0.02em convention); HANDOFF round-entry template; how to run preview (`.claude/launch.json` = `yield-vector-static`).
Expected files: none (tag only)
Outcome: Tag `checkpoint-2026-07-07-pre-bonusflow` created at `7c06e5f` and pushed. Digest delivered (planner holds full copy for prompt injection). Load-bearing corrections: APP_VERSION is `2026.07.07b` (:2401; HANDOFF header stale); feed payload = `{schema:2 EXACT, generatedAt, manifestVersion, feedStatus, lastGoodGeneratedAt, items:[{id,kind,title,dueDate,notes}], removed}` w/ tombstones via `_feedEmitted`/`_feedRemoved` (90d TTL) and Shortcut matching by `https://yieldvector.local/id/<id>`; kinds: offer-expires|deposit-deadline|dd-initiate|dd-window-end|debit-deadline|withdrawal|commitment-end|inflow|outflow; NO numeric storage version — migrations are functions in App.init (migrateDdIds/migrateDebitRequirement pattern); sync = `_baseRevision` CAS (no code constant for "2026.07.05"); push = Sync.schedulePush 2.5s debounce, no push-on-load; STORAGE_KEY `capital-planner-v1`; ACCOUNT_STATUSES [open,closed] :2516, SUB_STATUSES 9 (:2518): prospect,applied,approved,denied,on-track,met-waiting,earned,didnt-track,archived; surfaces = card grid (renderOfferCard :5984), advanced table (:6310), edit modal (showOfferModal :7455, Advanced toggle :7728), NO detail route; readOfferForm :8063-8134 fixed-object (drops unknowns), ends normalizeOfferStatus; safeToCloseDate stub :4433-4439; helpers: display/storage boundary :4088-4156, usFederalHolidays :3634, directDepositEffectiveDate :3752; tokens :23-88 (--accent #5b5cf6, --danger #e87171, radii sm8/md12/lg16/xl20/pill999); .btn-grid :1265; .btn-outline-danger :458; letterspacing 0.02em; field-box label fix near :1672; offers controls = search+status filter, NO sort; preview = `yield-vector-static` port 4173; package.json watch script = auto-push.js (unreliable, never rely on it).
Files: read-only (index.html, HANDOFF.md, CHANGELOG.md, docs/SHORTCUT_BUILD_GUIDE.md, .claude/launch.json, package.json; AGENTS.md grep-only)
Commit: none (tag only — no file changes; codex review-after vacuous)

### 2. Schema v2 design doc + data model + migration  [tier: executor] [codex: review-after] [status: in-progress] (agents leave changes uncommitted; planner commits after codex post-review)
Intent: FIRST write `docs/assessments/2026-07-07-schema-v2-design.md`: consumer inventory (every reader/writer of legacy offer fields), layering strategy (legacy⇄requirements[] sync rules, which side is canonical per consumer), migration plan + rollback, feed-impact table. THEN implement: `requirements[]` rows ({id: stable, type: enum(spend|deposit|direct_deposit_amt|direct_deposit_count|transactions|debit_txns|activate_debit|estatements|online_banking|maintain_balance|promo_code|custom), amount, count, deadline_days, frequency(total|monthly|per_statement), hold_days, done, done_date, notes}); churn fields ({churnable: bool|null, churn_wait_months, churn_anchor: enum(bonus_received|account_closed|account_opened), churn_notes}) + anchor date fields (bonus_received_date, closed_date — reuse existing if present); trimmed promoted fields (per Key decisions); last_edited; storage version bump + idempotent migration (legacy DD/debit/funding → derived requirement rows; backup key `yv_backup_<oldVer>`; unknown keys preserved); `readOfferForm` merge-spread fix; Settings restore-from-backup; sync-guard extension; demo seed updated. Verify: preview — seed old-shape data via console, reload, assert converted + backup + idempotency (2nd reload no-op); syntax gate; console clean.
Expected files: docs/assessments/2026-07-07-schema-v2-design.md, index.html
Outcome: Shipped additive schema-v2 layer: `requirements[]` rows layered over canonical legacy fields via pure `deriveRequirementsFromLegacy` + in-place `syncRequirementsWithLegacy` (derived rows keep done/done_date/notes, stable ids `req-funding`/`req-ddreq`/`req-dd-<ddId>`/`req-debit` reusing migrateDdIds ids); 13 new scalar fields (churn quartet + anchor dates, monthly_fee+waiver, promo_code, ETF+window, bonus_post_min/max, last_edited) via `schemaV2Defaults()`; idempotent `migrateOffersToSchemaV2` (marker = presence of offer.requirements; one-time quota-safe `yv-backup-pre-v2` snapshot; NO save/schedulePush — verified `_dirtySince` stays null); `readOfferForm` now spreads prior offer first (unknown-key preservation) + stamps last_edited + syncs rows; Settings restore button (conditional, btn-outline-danger) round-trips. Seeds: US Bank churnable/12mo + PNC promo/fee examples; rest left legacy to exercise migration. All 5 gates passed: node --check, 21/21 logic assertions, console clean ×3 reloads, live-seed migration + byte-identical idempotency, git status scoped. Design doc: docs/assessments/2026-07-07-schema-v2-design.md (377 lines; §B write-through rule, §F feed-impact table for steps 3-5).
Files: index.html (+328/-3, new fns ~:2650, App.init hook, readOfferForm, Settings); docs/assessments/2026-07-07-schema-v2-design.md (new)
Commit: (pending codex post-review)
Codex post-review (working-tree): [P1] erase-all doesn't remove yv-backup-pre-v2 → erased financial data resurrectable via restore button; [P1] cloud pull/adopt path can install pre-v2 Gist payload WITHOUT migration (boot-only hook) + readOfferForm prior-spread doesn't backfill v2 scalars → fix: migrate at every adoption point + spread schemaV2Defaults first; [P2] restore writes old _lastModified → next pull silently re-adopts newer cloud, undoing confirmed restore → stamp per _baseRevision CAS semantics. All three dispatched as fix-up to same executor (agent a59af976c3ce60c03) before commit.
Agent open issues → carried forward: (1) modal open materializes default ddRequirement (existing :7489 idiom) → saved offers gain a derived req-ddreq row — step 3 owns modal defaults; (2) CRITICAL for steps 3-7: edits to derived rows MUST write through to the canonical legacy field or next sync overwrites them (design doc §B).

### 3. Requirements engine UI + computed dates  [tier: executor] [codex: review-after] [status: pending]
Intent: Offer form: dynamic requirement rows (add/remove, 12-type dropdown, amount/count, deadline-days, frequency) with live computed calendar deadline dates from Account Open Date beside each row; legacy DD-specific inputs remain but are visually unified with (and kept in sync with) their derived rows per step 2's design. Card surface (existing expanded-card/modal per step 1 digest — NO invented detail route): requirements checklist w/ strikethrough-on-complete + per-row done toggles feeding `_feed` additively with stable requirement IDs + tombstone semantics matching existing patterns. Fixed-seed feed before/after diff must be additive-only.
Expected files: index.html
Outcome:
Files:
Commit:

### 4. Lifecycle pipeline + Expected-Bonus window + safe-to-close (F3)  [tier: executor] [codex: review-after] [status: pending]
Intent: 4-stage pipeline strip (Meeting Requirements → Waiting for Bonus → Bonus Earned → Closed) as a DERIVED view over existing accountStatus/subStatus (edge statuses = badges, not pipeline stages); auto-suggest transition when all requirements done; Expected-Bonus window = last-requirement-met date + bonus_post_min/max_days; implement `safeToCloseDate()` stub with max-of-constraints formula (Key decisions); surface both on card + additive `_feed` items; feed diff gate.
Expected files: index.html
Outcome:
Files:
Commit:

### 5. Churnability + upcoming-churn overview section (F6)  [tier: executor] [codex: review-after] [status: pending]
Intent: Next-eligible churn date = anchor date (bonus_received_date | closed_date | open_date per churn_anchor) + churn_wait_months; card shows churn status line (eligible now / eligible <date> / not churnable / unknown); NEW "Upcoming churn dates" section near the BOTTOM of the main overview: offers eligible now or within horizon (default 90d), soonest-first, tap→offer, empty-state styled; additive churn feed items; feed diff gate.
Expected files: index.html
Outcome:
Files:
Commit:

### 6. Expiration & freshness surfacing (F4)  [tier: executor (retiered per Codex)] [codex: review-after] [status: pending]
Intent: "Expires <date> (Nd)" chip on offer cards when expiration set (urgency styling ≤14d, expired styling); NEW sort control for Offers list (none exists — add sort state + UI consistent with existing filter/search controls): options incl. expiring-soon, newest, bonus value; "Updated <date>" stamp (last_edited from step 2) on card. Follow chip/label design tokens exactly.
Expected files: index.html
Outcome:
Files:
Commit:

### 7. DoC import v1 — paste-post parser + preview/confirm (F1, Phase 6)  [tier: executor] [codex: review-after] [status: pending]
Intent: Phase 6 per `docs/assessments/2026-07-05/report.md` §Phase 6, against the NEW schema: "Paste DoC post" entry in offer create/edit; deterministic glance-list parser (8 corpus quirks: points-not-dollars, ranges, combined dual-bonus totals, `<del>` strikethrough history, "Update M/D/YY" recency reconciliation, fuzzy label matching, …); maps to requirement rows + promoted fields; preview panel w/ per-field confidence + verbatim source snippet + explicit confirm-before-overwrite; graceful fallback to manual; `logError`-gated. CREATE `docs/fixtures/doc-samples/` with 4-6 SYNTHESIZED sample posts covering the quirks (no wholesale DoC copying; cite structure-source URLs in a fixtures README) + use them to verify parsing in preview.
Expected files: index.html, docs/fixtures/doc-samples/*
Outcome:
Files:
Commit:

### 8. DoC import v2 scaffold — gated (F1, Phase 7)  [tier: executor (retiered per Codex)] [codex: review-after] [status: pending]
Intent: `cloudflare/doc-import-worker.js` (fetch DoC URL server-side w/ allowlist `doctorofcredit.com`, CORS restricted to the Pages origin, calls Anthropic API — model per claude-api skill current ids — for ~5 low-confidence prose fields, returns JSON; API key ONLY in Worker env) + `cloudflare/README.md` (deploy steps, security notes); client: Settings field "DoC import Worker URL" (empty default), URL-import mode visible ONLY when configured; client-side verbatim-quote tripwire before accepting LLM fields; failure = graceful fallback to v1 paste mode. Zero secrets in repo; zero network calls unless configured. NOT deployed tonight — morning task documented.
Expected files: cloudflare/doc-import-worker.js, cloudflare/README.md, index.html
Outcome:
Files:
Commit:

### 9. Offer template cache — personal mini Deal Radar (F5)  [tier: executor] [codex: review-after] [status: pending]
Intent: "Save as template" on any offer — strips ALL personal instance data (dates incl. open/received/closed, entityUsed, emailUsed, notes, churn_notes, done-state, any account identifiers; keep only offer terms); template library UI (browse/search by bank/type, chips: bonus + key requirement; one-tap "Track this" → fresh pre-filled offer); persisted via existing localStorage+Gist channel under its own key; DoC import confirm offers save-as-template. RSS auto-ingest OUT of scope (documented as future option).
Expected files: index.html
Outcome:
Files:
Commit:

### 10. Aesthetic coherence + sharpening pass  [tier: executor] [codex: review-after] [status: pending]
Intent: Sweep ALL new UI from steps 3-9 for design-language consistency (0.02em uppercase-label letterspacing, field-box rhythm per R61, `.btn-grid` patterns per R60, display-format helpers for every date/money render); sharpen overall aesthetics where clearly appropriate (restraint: consistency > novelty); verify mobile ~380px + desktop; no horizontal scroll; console clean.
Expected files: index.html
Outcome:
Files:
Commit:

### 11. Full verification + docs + wrap + single push  [tier: executor] [codex: review-after] [status: pending]
Intent: End-to-end smoke in preview: clean console; migration re-test from pre-run-shaped seed (incl. idempotency + backup restore path); exercise every feature (requirement rows + computed dates + done toggles, lifecycle + windows + safe-to-close, churn overview section, expiring chips + new sort, DoC v1 paste on all fixtures, v2 gating stays hidden unconfigured, template save/instantiate with personal-data-strip verification); fixed-seed feed diff = additive-only vs baseline; update `docs/SHORTCUT_BUILD_GUIDE.md` (new feed kinds), HANDOFF.md round entry (incl. APP_VERSION correction note), CHANGELOG.md, README.md (DoC v1 out of Roadmap; v2 pending Worker deploy); bump APP_VERSION → `2026.07.08a`; final `git status --short` audit (R62-R64 untouched); THEN single `git push` of all step commits; report.
Expected files: index.html, HANDOFF.md, CHANGELOG.md, README.md, docs/SHORTCUT_BUILD_GUIDE.md
Outcome:
Files:
Commit:
