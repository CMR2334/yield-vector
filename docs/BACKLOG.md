# Yield Vector — Backlog

Durable, cross-session parking lot. One entry per parked item with a pointer to
its full context. AI sessions: add items here instead of leaving them only in
chat or run checkpoints; remove entries when they ship (note the commit).
Priorities are owner-directed — nothing here self-dispatches.

## Known defects

- **Modal opened <500ms after boot is wiped by deferred render** (pre-existing, found 2026-08-23 during device QA; low priority — rare in practice). A modal opened very early after app boot (within ~500ms) is occasionally wiped by a deferred render pass. Likely cause: the shell's async render cycle may not await or prioritize modals in the render queue at boot time. Workaround: user can re-tap to open the modal. Mitigation: mark-chapter/defer early modal opens, or ensure the render queue flushes before app-ready fires. Codex review deferred (not device-critical for current feature set).

## Recently resolved
- **Unreachable legacy `case 'timeline'` route** — shipped v2026.07.09m (R84):
  removed from `renderActiveView` (js/render-shell-overview.js) after re-verifying
  unreachability by grep — `App.view` defaults to `'overview'` and is never
  hydrated from storage nor set to `'timeline'` (nav offers only overview/planner/
  offers/settings; `goto-timeline` routes via `App.setView('planner')` + the
  `_planSegment='timeline'` segment). The now-orphaned `renderTimeline` import was
  dropped from the shell (still defined + used inside render-main-views.js's Plan
  segment).
- **Unused `directDepositEffectiveDate` import in `reminders.js`** — shipped
  v2026.07.09m (R84): removed (kept `ddWindowEndDate`). Pre-existing 09l reviewer
  NIT; the symbol had no reference in the module.
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

## Owner directives — 2026-08-23 (approved specs, queued for next build session)
- **Date-input tap behavior (offer + event forms)** — SHIPPED v2026.08.23. FIRST tap on any date
  bubble opens ONLY the custom `yv-date` picker: no iOS keypad (suppress the
  focus keyboard, e.g. `inputmode="none"` until armed). A SECOND tap on the
  already-active bubble switches to manual typed entry (numeric keypad).
  Picker is the primary input mode; typing is opt-in. Owner spec from a
  2026-08-23 phone screenshot where the keypad + AutoFill bar covered the
  open picker on "Planned funding date". Typed-violation hints unchanged.
- **DoC import promotion + single "DoC URL" field** — SHIPPED v2026.08.23. Promote the import out
  of the collapsed Advanced disclosure (today nothing on the modal surface
  hints it exists). MERGE with the existing source-URL bubble into one field
  labeled **"DoC URL"**; the import operates directly from it (URL fetch via
  the deployed Worker; pasted post text stays supported). Remove the
  redundant second input. Owner: "having a 2nd input/url bubble seems
  redundant."
- **Entity/email auto-defaults by offer kind** — SHIPPED v2026.08.23. When an offer (manual entry
  OR DoC import) is detected as a BUSINESS offer, prefill "Entity used" +
  email with the owner's business defaults; PERSONAL offers prefill his
  personal defaults; always manually overridable (owner sometimes uses his
  sole prop for business offers). PRIVACY CONSTRAINT: this repo is public —
  store the default VALUES in Settings (synced app state), never hard-coded
  in source; ship the mechanism with empty defaults + a one-time Settings
  prompt. The owner's actual values are recorded in the assistant's private
  session memory and get entered on his device at build time.
- **Offer-card creation/input performance + card layout improvements** —
  owner has observations queued ("mostly with offer card creation/input, and
  card layout") and will direct these in a future session; do not guess at
  scope before he does.
- **Automated mobile visual review (feasibility assessed 2026-08-23)** —
  owner asked how to stop relying on his eyes for per-release mobile checks
  ("a mobile app plugin or something"). Verdict: a native/TestFlight-style
  review channel is NOT feasible/worth it (YV is a web PWA; no native
  wrapper exists and building one buys nothing). What IS feasible, phased:
  **(P1) commit the QA harness** from run 2026-07-29-ios-simulator-mobile-qa
  (Playwright probes + simulator driver + frozen fixture) as a repo suite so
  every release auto-runs the OBJECTIVE checks — breakpoint-matrix overflow,
  label clipping, tap-target geometry, console/diagnostics, external-request
  guard. That run proved the probes catch real defects (3 P2s + 2
  Codex-flagged regressions) without human eyes.
  **(P2) golden-screenshot diffing** — store approved per-surface/per-width
  goldens; each release pixel-diffs and auto-generates a phone-friendly
  before/after gallery (private artifact) showing ONLY changed regions;
  owner reviews diffs in under a minute instead of sweeping the app.
  **(P3) taste-only residue** — the gallery ends with any eye-call items;
  owner approve/reject from the phone becomes the stable-tag gate.
  Costs, stated honestly: goldens churn on intentional UI changes (needs an
  approval step); simulator rotation still needs the macOS accessibility
  permission; Playwright becomes a dev-only dep in a no-build repo
  (mitigate: live under docs/fixtures/e2e with `npm i --no-save`, jsdom-
  harness style). Recommendation: P1 next app-touching session, P2 after.

## Proposed — 2026-07-09 night review (owner-requested ideation; awaiting owner picks, nothing self-dispatches)
Timeline+chart review and project-wide review both by Codex read-only passes (logs were
/tmp/yv-timeline-review.log, /tmp/yv-project-review.log; key content preserved here).

**Timeline — bugs found (fix-worthy regardless of picks):**
- "Today" label on the Timeline is rendered but SUPPRESSED by CSS (index.html:1873 hides it
  on all .timeline-row-track descendants incl. the axis row).
- Dead empty-shell state: rows.length > 0 but validRows.length === 0 renders a bare axis/table
  shell instead of an empty state.
- Hero chart: code comment promises a quick-tap (<200ms) tooltip but the code never calls
  handleHover() on tap — long-press works, tap does nothing.

**Timeline — option menu (planner-curated from the 12-option review):**
- Tier 1 (recommended first batch, S/M): milestone glyphs on bars (fund-by, DD posts, window
  end, expected bonus window, safe-to-close — locked colors exactly); tappable bars → offer
  modal (tap-vs-pan discrimination); sticky top axis + fixed Today label; offer-identity color
  rail in the label column; distinguished empty/sparse states.
- Tier 2: Month/Quarter/All range controls (display-window only, don't mutate projection
  settings); collapsed vs expanded row modes; long-press scrub/crosshair reusing the hero
  chart's 200ms gesture model.
- Deferred/skip: capital-curve strip above bars (duplicates Home chart, heavy); "optimize from
  here" bridge (implies date-constrained optimization the engine doesn't perform); pinch-zoom
  (iOS scroll conflicts — buttons first).

**Historical tracking — recommended path (1→2→3→5, ledger later):**
1. Realization fields on offers: actual_bonus_amount, fees_paid, closed_reason (M) — realized
   vs projected truth per completed offer.
2. Churn lineage: series_id, parent_offer_id, run_number, source_template_id (S/M; migration
   seeds each existing offer as its own series) — lineage stops living in notes.
3. History/Archive view over closed+completed offers with annual totals, lifetime gross/net,
   realized APY (M).
5. Focused CSV exports: active offers, completed runs, events/P&L (S) — the low-risk bridge
   to any external tool.
- Full append-only offer_ledger[] (L, payload growth + merge semantics) — decide only after
  1–3 prove out. Pre-req if pursued: schema-validation harness + payload-size guardrails.

**External connections (owner seeded Airtable, said don't over-prioritize it):**
- Best architectural fits first: CSV exports (S) → Google Sheets one-way mirror (M) or a
  SANITIZED read-only dashboard page (M; never put the private Gist token in client JS).
- Airtable one-way mirror (M/L): fine if CRM-style database views are wanted; third-party
  privacy exposure + schema drift are the costs. Two-way sync with ANY external tool is
  rejected — it fights the CAS sync model, migrations, and the local-origin guard.
- iOS Shortcuts/widget summary feed (M): a second machine feed with current-active/
  next-release/annual totals; high phone-native value, builds on the existing _feed.

**Other gaps surfaced (not previously tracked):** schema-validation harness for import/
migrations/templates; pre-migration "download state bundle" safety snapshot; a small pure
analytics layer so History/exports/dashboard share one totals implementation.

## Integrations — live bank data (researched 2026-07-13; owner parked, do not self-dispatch)
Full research + comparison: docs/assessments/2026-07-13-bank-data-aggregation-research.md.
Owner prerequisite when picked up: SimpleFIN Bridge subscription ($15/yr) + access
URL pasted into a new Settings field (localStorage-only, like the Gist token).
- **SimpleFIN live balances + auto-reconciliation** (L) — real per-account
  balances replace manual `currentLiquidCapital`; transaction matching
  auto-detects DD postings (check requirement rows), bonus credits (stamp
  `bonus_received_date`), funding transfers, hold releases. Browser-direct
  (CORS verified) — no Worker needed. The highest-impact item: closes the
  plan-vs-reality loop.
- **Obligations layer — CC due dates + payment amounts** (M/L) — SimpleFIN has
  NO due-date data; phase 1 infers statement cycle + payment amount from
  transaction history (manual-entry fallback), feeding recurring capital events
  automatically. Phase 2 (only if inference insufficient): Plaid Liabilities
  behind the dormant Cloudflare Worker (~$0.20/acct/mo; 10-item lifetime cap on
  the free Trial — poor churn fit).
- **Idle-cash yield allocation** (M) — with live balances + the projection's
  forward funding needs, flag slack cash sitting below best-available APY and
  suggest transfers that never break an upcoming commitment.

## Offer model — Requirements-driven qualification (owner direction 2026-07-13; design before build)
- **Offer Type ↔ Requirements dynamic interaction** (L) — direction: Requirements
  becomes the single source of truth for QUALIFICATION; the "How is this bonus
  met?" chooser derives its options dynamically from the requirement rows
  present (each row has a type), with a generalized all / either-or (later
  N-of-M) logic selector across them. Offer Type shrinks to its true job —
  CAPITAL FOOTPRINT (hold / DD round-trip / both / none) — auto-suggested from
  requirements with manual override; a "none" footprint covers off-case bonuses
  (bill-pay-only, trial-deposit) without a 4th ad-hoc enum value. Phasing:
  (A+B) held-vs-spend model gating + requirements-derived chooser + generalized
  all/any — IN FLIGHT in run 2026-07-13-capital-event-picker-chart-bonusmet
  (owner chose to expand that run; design pinned in its Key decisions 1–10);
  (C) — SUPERSEDED 2026-07-14 by the owner-directed **"Custom (from
  requirements)" 4th offer type**: multiple pick-one requirement GROUPS
  (rows always-required or group members; groups AND together), capital
  derived from hold-implying rows, requirements editor surfacing under the
  offer-type banner. WORKSHOP doc (owner wants to iterate — decisions so far
  + open questions): docs/assessments/2026-07-14-custom-offer-type-workshop.md.
  Foundation designs: 2026-07-13-requirements-driven-paths.md +
  2026-07-11-either-or-requirements.md.

## Owner-action pending (blocked on Collin, not code)
- **Apple Shortcut v2 executor build** — build the minimal reminders executor
  per docs/SHORTCUT_BUILD_GUIDE.md (~15 min on iPhone; root SHORTCUT_SETUP.md is
  superseded/historical).
- **Cloudflare Worker deploy** — DoC-import v2 scaffold (`cloudflare/`) still
  needs Collin's deploy + ANTHROPIC_API_KEY/WORKER_SECRET/ALLOWED_ORIGIN. Also a
  prerequisite for the Plaid-Liabilities phase above, if ever picked.
- **SimpleFIN Bridge subscription** — gate for the live-bank-data section.

## Features
- **Opt-in dark mode** — fresh implementation against the module structure. Idea
  preserved from closed PR #2 (2026-07-02 audit branch; its diff targeted the
  pre-split single-file index.html and is unmergeable — do not resurrect the
  branch, reimplement).
- **Worker "Save & test"** — optional connectivity/auth ping through the DoC
  import Worker on save (parity with the Gist "Save & test"). Offered 2026-07-08.

## UI polish
- **Wealthfront-style typography** (M) — PARKED 2026-07-13 (owner choice: stay
  on SF for now). Do NOT re-pitch free lookalikes — owner rejected ALL FIVE:
  General Sans, Hanken Grotesk, Figtree, Schibsted Grotesk, Instrument Sans,
  plus the "SF-but-heavier" metric-only variant. He wants actual **Calibre**
  (confirmed as Wealthfront's UI font by fetching their woff2s; Klim,
  commercial, pay-once ~$50-60/style, Reg 400 + Med 500 = his target weights).
  Current YV font = system stack (`--font-sans`, index.html:121) → SF Pro.
  RESOLUTION PATH when revived: owner buys Calibre Reg+Med web license
  (klim.co.nz/buy/calibre), fonts served from his Cloudflare account (free;
  the pending DoC-Worker deploy account) with CORS to the Pages origin — repo
  stays public and license-clean (committing licensed woff2s to the public
  repo = redistribution, forbidden). Alt: private repo via GitHub Pro $4/mo.
  Owner's target metrics (from WF css): headers 500 / body 400, 18px / 23px
  line-height, ink #161338. Tabular numerals required (money columns). Mind
  AGENTS.md locked design values.
- **Sleeker select/dropdown styling** (S/M) — native-looking selects read cheap;
  restyle to match the app's chip/card language, and fix dropdown-arrow
  placement (Requirements dropdown arrow sits too far toward the right border).
  Requested 2026-07-13.
- **Plan-tab stat color-system unification** — Plan's non-shortfall amber mirrors
  Overview via a documented hardcode; unify both tabs on one token if
  `.stat-value.lighten` ever changes. Context: v2026.07.09b batch report.

## Cleanup (fold into the next app-touching batch)
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
