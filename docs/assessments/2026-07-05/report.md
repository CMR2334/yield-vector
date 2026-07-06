# Yield Vector Assessment
**DoC URL import feasibility · whole-tool critique · Reminders framework redesign**
Run `2026-07-05-yield-vector-assessment` · Planner: Fable 5 · Executors: Opus 4.8 · Workers: Sonnet 5 · Cross-review: Codex (GPT-5.5) at plan gate, Reminders design, and final report

---

## Executive summary

1. **DoC URL import: feasible-with-caveats, and worth building.** Doctor of Credit posts are fully server-rendered with a highly consistent "Offer at a glance" block (validated on 25 posts — 7 discovered + your 18 real ones). A deterministic parser ships in ~1 day with zero infrastructure and covers the churning-critical fields; an optional LLM tier handles the genuinely ambiguous prose fields. **Use Sonnet 5 for that tier (~$0.013/offer — under $1/month at your volume), with a verbatim-snippet source-grounding tripwire that programmatically catches fabricated sources.** The design, not the model, carries the safety.
2. **The tool is strong at deriving dates but silently drops some of them on the way to you.** Three high-impact gaps: the debit-transaction deadline never reaches the action queue or the reminder feed at all; per-DD initiation dates never reach the feed; and a status-mapping bug hides the funding-deadline item (which also serves, mislabeled, as the DD-window deadline) exactly when an offer is Approved and funding or DDs are pending. "On-Track" is a label you set by hand — the app never computes whether you're actually on track. These are the cheapest, highest-value fixes in this report.
3. **The Reminders pipeline you have is well-designed but was never completed — and it can't tell you it isn't running.** The app ships a reminder feed to your Gist on every save; the iOS Shortcut that would consume it was never built, and the design has no liveness signal, so "not installed," "silently stopped," and "working, nothing due" are indistinguishable. The replacement framework (designed fresh this run, Codex-cross-reviewed): **one brain, three surfaces** — all logic in the app's feed engine; delivery via (a) the in-app queue, (b) a low-maintenance subscribed calendar served by a small Cloudflare Worker, and (c) a deliberately minimal Shortcut for actual checkable Reminders — with heartbeat write-backs and a cross-channel watchdog so failures announce themselves instead of staying silent.

**If you do only three things:** fix the feed coverage gaps (a day), stand up the calendar channel + minimal Shortcut with heartbeats (a weekend), then ship the deterministic DoC parser (a day). Everything else builds on those.

---

## Part I — DoC URL import

### What the evidence says
25 posts examined: 7 sampled across offer categories, then your 18 completed offers as a validation corpus. Every one fetched clean with plain curl — DoC is fully server-rendered, no bot-blocking, no JS hydration. Key structural facts:

- **The "Offer at a glance" list is the machine target.** A labeled `Label: value` list at the top of every post (25/25) with a canonical 11-label set (Maximum bonus amount, Availability, Direct deposit required, … Expiration date). 15 of your 18 conform exactly.
- **Glance values go stale.** In 4/7 sampled posts the glance amount or expiration was outdated versus the "Update M/D/YY:" paragraphs at the top of the post. **Recency reconciliation is mandatory** — the parser must read all updates, take the newest, and show you both ("glance says 9/30/2025, Update says extended to 6/30/2026 — using 6/30/2026").
- **Your corpus surfaced 8 required parser amendments** the discovery sample missed: fintech posts (SoFi, Relay) omit the ChexSystems row; old posts have label variants and *unsorted* update chronologies; Amex's amount is "50,000 membership rewards" (points, no $); SoFi's is a range ("$50 – $300"); BMO reports one combined $560 for two separate account bonuses; 8/18 posts lead with a non-dated status line ("Deal has ended…"); Wintrust carries zero taxonomy tag classes; and `<del>` strikethrough history litters expiration/fee rows. All are handleable — fuzzy label matching, parse-all-dates-take-max, strip-`<del>`, no unconditional `$` regex — but a naive parser would get several of them *silently wrong*, which is exactly your stated fear.

### Field mapping
~9 DoC facts map to existing offer fields — the churning-critical set: bonus amount, expiration, funding amount + window, hold period, DD required (→ offer type), DD count/amount/timeframe, debit requirement, bank name, source URL. ~11 facts have no schema home yet (state eligibility, monthly fee + waiver, ETF/safe-close window, bonus-posting timing, promo code, Chex sensitivity, household limit, targeted-only, in-branch-only, business-vs-personal, hard/soft pull) — for v1 they land in `notes` as a labeled block; two of them (**bonus-posting timing** and **ETF safe-close**) should later graduate to real fields because each generates an actionable reminder (see Part III).

**One rule enforced throughout: parsed DoC facts fill offer *parameters* only.** Your planned signup/funding/DD dates stay yours — the app's existing derivation (suggested funding date, "Generate dates") turns parameters into proposed dates. The importer never writes a planned date.

### The layered design
- **v1 — deterministic, paste-text, zero infra (~1 day).** A "Paste DoC post" textarea in the offer modal → glance-list parser (with the 8 corpus amendments) → recency reconciliation → **preview panel**: every extracted field with a confidence badge and the verbatim source snippet, per-field confirm, never overwriting a non-empty field without an explicit keep/replace choice. Failures route through `logError` and degrade to manual entry — the importer can never block offer creation. Worth shipping alone: it covers the high-confidence fields at zero cost and works offline.
- **v2 — Cloudflare Worker + Sonnet 5 assist (~2–3 days).** Paste just the URL; a ~30-line free-tier Worker fetches the page (solves CORS — DoC sends no CORS headers, so the browser can't fetch it directly) and, for the low-confidence prose fields only (funding/hold windows in word-numbers, dual-bonus splits, points-vs-dollars), calls Sonnet 5 with the Anthropic key held as a Worker secret — never in the browser. The same Worker serves the Reminders calendar channel (Part III): one piece of infra, two features.

### Model choice (your question, answered)
Verified current pricing, worst-case 4k input + 0.5k output per offer:

| Model | Per offer | 50 offers/mo | Verdict |
|---|---|---|---|
| Haiku 4.5 ($1/$5 per MTok) | $0.0065 | $0.33 | Capable, but you asked for accuracy priority |
| **Sonnet 5** ($2/$10 intro to 8/31, then $3/$15) | **$0.013–0.0195** | **$0.65–0.98** | **Recommended** |
| Opus 4.8 ($5/$25) | $0.0325 | $1.63 | Not worth 2.5× Sonnet here |

The cost *difference* between the cheapest and priciest tier is **$0.26/month at 10 offers and $1.30/month at 50** (total spend at most $1.63/month) — cost is not a deciding variable at any tier. The honest accuracy picture: the flashy errors (points written as dollars, ranges, combined totals) are *structurally visible* and the design catches them; where a stronger model genuinely earns its keep is the **plausible-looking prose-number error** — a hold window read as 60 days when the fine print says 90 — which your eyes won't catch in a preview. That class is real in your corpus, so take Sonnet 5. Opus buys nothing demonstrable on 6–13 KB fixed-schema extraction; the ceiling is source ambiguity, not model capability.

**The non-negotiable is the tripwire, not the tier:** every LLM-extracted field must return a verbatim source quote, and the app substring-checks that quote against the fetched page — a fabricated value usually needs a fabricated quote, which won't match, so the field auto-flags before you see it. Honest scope: this is *source-grounding*, not total hallucination-proofing — a model can quote a real "90 days" sentence and still output 60. That residual is why the preview shows the value next to its snippet, and why v2 should add a cheap value-in-quote consistency check (parse numbers out of the quote, compare to the extracted value, flag mismatches). Ranked protections: preview/confirm UX (dominant, model-independent) > deterministic-first layering (LLM only ever touches ~5 ambiguous fields) > model tier (real but third).

---

## Part II — Whole-tool critique

Judged against your goal verbatim: *"managing dates and requirements to be as hands-off as possible in figuring out what I need to do, and then remembering to do it."*

### What's already strong
Deadline *derivation* is genuinely hands-off — deposit deadline, withdrawal-eligible, and lock-start dates all compute from offer parameters, with real ACH business-day/holiday awareness most people can't do in their heads. A two-tier action queue exists (`computeActionsRequired` / `computeUpcomingActions`). The dd-methods dataset (1,158 banks) removes research per offer. Sync has grown real guards (timestamp arbitration, stale-push confirmation, restore-from-history, JSON export). Diagnostics have an error ring buffer and a recovery panel. And the single-file architecture is *fine at your scale* — don't refactor it for its own sake.

### Weaknesses, ranked by what they cost you
1. **[HIGH] Derived deadlines that never reach you.** `debitRequirement.byDate` exists only in a card tooltip (index.html:4930) — it is absent from both the Upcoming-actions queue (:4544) and the reminder feed (:4428). The DD window-end deadline *is* emitted, but only as the generically-labeled deposit/funding item (:4449, :4556) — so it's easy to misread and, worse, it's hidden by the status bug below. Failure mode: "6 debit transactions by Aug 20" → no reminder anywhere, forfeited bonus.
2. **[HIGH] "On-Track" is self-reported, not computed.** No code compares DDs completed/planned vs required vs days remaining. The only risk logic in the app is cash-flow shortfall — capital, not requirement completion. The app has every number needed to tell you you're behind, and doesn't.
3. **[HIGH] The funding reminder disappears exactly when it matters.** The deposit-deadline item is gated on legacy status `applied|selected|prospect` (:4450), but marking an offer **Approved** maps it to legacy `'funded'` (:2236) — so the moment your account is open and funding is *actually pending*, the reminder vanishes from both the queue and the feed.
4. **[MED]** No bonus-received reconciliation ("bonus was due by DATE and you never marked it earned"). **[MED]** Sync still has a two-device race window on the automatic path. **[MED]** localStorage is the only automatic store; no backup-age nag. **[LOW]** Status advancement is fully manual where it could be suggested.

### Additive features, in dependency order
**P1** Surface the missing deadlines + fix the status gate (S — highest value per line in this report) → **P3** per-requirement done-tracking (dd.completed, debit counter) → **P2** computed on-track/at-risk/overdue badge + "At risk" bucket → then **P4** bonus-received reconciliation, **P5** stale-offer guard ("no movement on {bank} in 21 days"), **P7** Today view (a filter over the now-trustworthy queue, not a new engine). **P6** backup-age nag is independent and cheap. All of these feed every reminder surface in Part III automatically.

---

## Part III — Reminders: audit and redesign

### What the audit found
The existing design (app → `_feed` in Gist → daily iOS Shortcut → Reminders) is thoughtful — merge semantics that preserve your notes/alarms/completions, a stable id-in-URL merge key — but:

- **The consumer was never built.** HANDOFF marks the on-device Shortcut as pending; the feed has been shipping into the void.
- **Nothing can tell you it isn't running.** No write-back, no heartbeat, notify-on-run off. Every failure — never installed, iOS quietly disabling the automation, PAT expiry, schema drift — collapses into the same observable: no reminders, indistinguishable from "nothing due." For a tool whose job is *remembering so you don't have to*, silent failure is the worst possible property.
- **A defensive gap:** the Shortcut spec deletes any planner-managed reminder whose id is absent from the feed — an empty or partially-fetched feed would mass-delete every Yield Vector reminder it manages, including your hand-added notes and alarms on those items.
- **Coverage:** the feed inherits all three Part II gaps, plus `safeToCloseDate` is a dead stub (always null), and no bonus-posting-date or monthly-fee fields exist.

### The new framework — "one brain, three surfaces"
Designed from first principles this run and hardened by Codex cross-review. Platform facts verified first: **CalDAV cannot write to modern Apple Reminders** (post-iOS-13 Reminders are siloed; on-device EventKit — i.e., Shortcuts or a native app — is the only write path, so any "server pushes Reminders directly" architecture is fiction), **ICS calendar subscriptions auto-refresh** (~1–3 h), and **Shortcuts can PATCH with headers/body** (heartbeats are possible).

**One brain.** All reminder logic lives in the app's feed engine — upgraded to a v2 contract: complete coverage (adds `dd-initiate` per planned DD, `dd-window-end`, `debit-deadline`; fixes the Approved-status gate; later `safe-to-close` and `bonus-posting-check` when those fields graduate), a computed `risk` state per item (from P2), schema versioning, a monotonic `manifestVersion` that survives restore-from-history, stable per-DD child ids, explicit deletion **tombstones** with ack-based retention (no more delete-by-absence), `feedStatus: ok|stale|error` metadata, and the current silent `try{}catch{}` around feed computation replaced with logged errors + last-good-feed reuse. Consumers compute nothing — they are dumb, disposable executors.

**Three surfaces, graduated latency, redundant by design:**
1. **In-app action queue** (live; source of truth) — the Part II fixes. Zero delivery risk; requires opening the app.
2. **Subscribed calendar** (passive; eventual refresh, typically within hours; **lowest maintenance**) — the shared Cloudflare Worker renders the feed as a calendar subscription: timed events (9:00 AM) with stable UIDs and proper SEQUENCE/DTSTAMP, subscribed once via a long random capability URL (rotatable from Settings; optional redacted-titles mode since the feed names banks and amounts). No automation to maintain and no state to corrupt — but refresh timing isn't an SLA and alert delivery isn't guaranteed; it's the surface with the fewest moving parts, not a guarantee.
3. **Apple Reminders via a deliberately minimal Shortcut** (actionable check-off; 2× daily with a reentrancy lock) — kept because EventKit-on-device is the only Reminders path and checkable to-dos are what you asked for. Substantially simpler than the legacy ~20-step spec (roughly a dozen actions; expect ~30–60 min to build and verify once): fetch manifest → schema check (stop + notify if unknown) → upsert by id (⚠️-prefix at-risk items) → delete *tombstoned ids only*, with a delete-rate guard (refuses to remove >30% of managed reminders unless the same manifest is seen twice) → **PATCH a heartbeat** (its own Gist file, one file per consumer to avoid write races) only after full success → notify only on failure.

**Observable liveness (the core upgrade).** The app renders consumer health in Settings *and* injects a top-of-queue warning when a heartbeat is stale (>36 h) or version-lagged (consumer applied an old manifest — catches the cached-content failure). The **cross-channel watchdog**: when the Worker serves the calendar and sees the Shortcut's heartbeat stale >48 h, it injects a "⚠️ Yield Vector: Reminders sync is down" event with an alarm — the channel with no moving parts becomes the alarm bell for the one that has them. Honest scope (per Codex): this is *observability of the last successful run*, not proof a notification reached your eyes — residual silence remains if you disable calendar alerts, remove the subscription, and never open the app. Accepted: the in-app queue is the backstop, and you open the app.

A **Setup Checklist panel** in Settings live-verifies each stage (PAT valid → Gist reachable → feed fresh → Shortcut heartbeat seen → calendar served) with fix-it hints — "verified live" replaces "hope." Ongoing maintenance is PAT renewal and re-granting permissions after major iOS updates; both surface through the same heartbeats.

**DoC tie-in:** an imported offer flows to every surface with zero extra action — *after* you confirm its dates. Correction from the final Codex pass: that confirmation gate does **not** exist today — new offers default `includeInScenario: true` (:6319), so a prospect emits reminders immediately. Feed v2 therefore adds it explicitly: DoC-imported offers arrive with a needs-confirmation flag (or scenario inclusion off) and emit nothing until you confirm the suggested dates — except, optionally, a single `prospect-expires` warning so an unconfirmed offer can't silently expire.

---

## Unified implementation sequence

| Phase | Work | Effort | Unlocks |
|---|---|---|---|
| 1 | **Feed v2 + queue fixes** (P1 gaps, status-gate fix, tombstones, schema/manifestVersion, stable ids, logged feed errors) | ~1–2 days | Trustworthy queue; everything downstream |
| 2 | **Minimal Shortcut, built once, verified** (v2 spec — don't build the legacy 20-stepper) + heartbeat | ~30–60 min setup | Actual Reminders, observably running |
| 3 | **Setup Checklist panel** + heartbeat/version-lag warnings in-app | ~0.5 day | Failure visibility |
| 4 | **Cloudflare Worker: calendar channel + watchdog** | ~0.5–1 day | Zero-maintenance surface; alarm bell; infra for Phase 7 |
| 5 | **Done-tracking → at-risk computation → Today view** (P3→P2→P7) | ~2–3 days | "Figure out what I need to do," computed |
| 6 | **DoC import v1** — deterministic paste-text parser with the 8 corpus amendments, preview/confirm | ~1 day | Offer creation from a paste |
| 7 | **DoC import v2** — URL auto-fetch + Sonnet 5 + snippet tripwire on the Phase-4 Worker | ~1–2 days | Full paste-URL-and-confirm flow |
| 8 | **Schema graduations** — `expectedBonusPostingDate`, revive `safeToCloseDate` → new reminder kinds; P4 reconciliation, P5 stale guard, P6 backup nag | ~2 days | Collect-the-bonus + safe-close automation |

Total infra cost: $0/month (Cloudflare free tier) + ~$0.65/month extraction at 50 offers. Phases 1–4 alone deliver the core of what you asked for: dates you can trust, delivered redundantly, with failures that announce themselves.

---

## Provenance
Step 1 (worker/Sonnet 5): 7-post evidence pack. Step 2 + addendum (executor/Opus 4.8): feasibility, designs, model comparison — pricing verified against official docs. Step 3 (executor/Opus 4.8): tool critique, all claims at file:line. Step 4 (executor/Opus 4.8): Reminders audit. Step 5 (worker/Sonnet 5): validation against your 18 posts. Step 6 (planner/Fable 5): Reminders redesign, platform facts web-verified, Codex cross-review incorporated (10 amendments). Codex (GPT-5.5, xhigh reasoning) reviewed the plan, the redesign, and this report; its final editorial findings (two factual corrections — the DD-window/deposit-item conflation and the default-on scenario gate — plus tripwire/liveness/effort softening and a cost-wording fix) are incorporated above. Full per-step deliverables and the run checkpoint: `.claude/orchestrator/runs/2026-07-05-yield-vector-assessment.md` in the repo; working files in the session scratchpad. No repo files were modified by this run.
