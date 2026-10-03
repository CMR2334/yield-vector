# Strategic direction review — 2026-09-19

Session log + decision record. Written so a future session (any assistant) can
resume without the owner re-narrating. **No code changed in this session.**
Repo is PUBLIC — this file deliberately carries no balances, emails, or entity names.

Resume prompt for the next session is at the bottom.

---

## 1. The goal, restated (owner's words, condensed)

A tool that, from **just a Doctor of Credit URL**, will:

1. Parse the bonus **accurately** (emphasis on accuracy) — reading the DoC post
   *and* other current sources (the bank's own offer/terms page, DoC updates,
   comment data points), not one page in isolation.
2. Identify **tiers** and every **path** to the bonus, and compare paths within
   the global context: cash flow, the cash-reserve floor, and other in-flight bonuses.
3. Optimize **order of pursuit and holding-time efficiency**, including
   **churnability**: can the SUB be earned again, by the same or a different
   entity, after how long, anchored to open / SUB-received / close date.
4. Create **Apple Reminders** with specific, accurate dates for every required
   action. *Essential* — without recorded reminders the owner loses track.
5. Store **history** (which entity got which bank's SUB, when) to gate future
   eligibility and to run KPIs (rate of return etc.).
6. Minimize owner input and total management time. Prefer running on the
   Claude **subscription login** over metered API.

Question asked: keep refining Yield Vector (YV), or build a Claude + MCP based
system (with or without a side interface), judged on cost, parse accuracy,
Reminders integration, ease of use, and time saved.

---

## 2. Findings (what the review of the folder established)

**YV's engine is the valuable part, and it is already portable.**
~22k lines across 19 ES modules. The pure modules (`optimizer-engine.js`,
`offer-model.js`, `projection-optimizer.js`, `dd-core.js`,
`date-format-core.js`, `requirements-templates.js`) import in Node with no DOM.
They cover: ACH business-day/holiday math, hold-release + transfer-lag landing
dates, buffer-floor feasibility as a hard gate, a budgeted deterministic
sequencer (exact → beam → coarse), requirement paths incl. either/or, the churn
model (`churnable`, `churn_anchor` = opened | bonus_received | closed,
`churn_wait_months`, synthesized re-run candidates), and an 11-kind reminder
feed (feed contract v2: stable ids, tombstones, manifestVersion). Guarded by
~108 optimizer + 21 feasibility + 24 parser + 67 fidelity pins. An LLM in a
chat window cannot replace this; date math and sequencing must stay deterministic.

**The three things the owner calls most important are YV's three weakest points.**

| Need | State today |
|---|---|
| Accurate parsing | Deterministic parser scores **84.9%** vs gold labels (82.4% after DoC post drift). LLM tier (Cloudflare Worker, API key) is allowed to touch only 3–5 prose *notes* fields. Reads **only the DoC post** — never the bank's terms. Tiered offers are "badged, never auto-picked". |
| Apple Reminders | Feed has shipped to the Gist since 2026-07-07; **no consumer exists**. Verified 2026-09-19: no "Yield Vector" list in Reminders. Owner confirmed he deliberately held off building the Shortcut and hand-enters all SUB reminders into his existing list **"Credit Cards \| Banks \| Travel"**. |
| History / KPIs | Not built. Backlog has the right design (realization fields, churn lineage `series_id`/`parent_offer_id`/`run_number`, archive view, CSV). A one-way daily Airtable mirror exists (`scripts/airtable-sync.mjs` + GitHub Action) but carries no realized amounts, fees, or lineage. |

**Root cause is architectural, not a lack of polish.** YV is a static PWA with
no backend. A browser page cannot fetch DoC (CORS → needs the Worker), cannot
read a bank's terms page, cannot run a multi-source research loop, cannot use a
Claude subscription (needs an API key), and cannot write to Reminders (→ needs a
hand-built iOS Shortcut with real limits: no due-date param, no URL filter,
deletes always prompt). Every item on the owner's wish list hits that wall.

**Where the effort has gone.** 95 handoff rounds / 288 commits. The last several
releases were date-picker tap behaviour, hit areas, breakpoints, select
chevrons, typography — real quality, but on the *manual-entry* surface, which is
exactly the surface the goal says should shrink. HANDOFF.md is 222 KB against
its own "keep 3–4 entries live" rule.

**An accuracy ceiling worth knowing.** Three independent human labelers agreed
with each other only **79.2%** on these DoC posts. DoC posts are living,
contradiction-laden documents. No parser of the DoC page alone — regex or LLM —
gets to "accurate". Accuracy comes from **cross-checking the bank's own terms**
and showing the owner only the disagreements.

**Assets that make the next step cheap.**
- 31-post hand-adjudicated **gold corpus + scoring harness** → any new extractor
  can be *measured* before it is trusted.
- `tools/create-reminders.swift` already proves EventKit writes from this Mac.
- The reverse-completion channel (`yv-completions.json`) already exists app-side.
- The owner already runs launchd daemons here (task-watcher, keepalives, backup).
- Claude Code on the Max login = $0 marginal cost for research/extraction.

**Environment notes.** The cloud Airtable/ClickUp/etc. connectors visible in
this Claude session belong to a *different* account and returned 403 on the YV
base — do not use them for YV. Use the token-based script path instead.
AppleScript against Reminders is very slow (a 12-item read exceeded 60 s);
use EventKit (Swift), not AppleScript.

---

## 3. Options compared

**A. Keep refining the PWA as the whole product** (Worker LLM tier + iOS Shortcut).
**B. Pure Claude + MCP** (Claude project/desktop with Reminders MCP + Airtable MCP; Claude does the reasoning and the math in chat).
**C. Hybrid — Claude Code as the front door, YV engine as the calculator, PWA as the phone dashboard.** *(Recommended.)*

| Criterion | A. PWA only | B. Claude + MCP only | C. Hybrid |
|---|---|---|---|
| Operating cost | ~$1/mo API + Cloudflare free. Needs API key (not subscription). | $0 marginal on subscription. | $0 marginal on subscription; Cloudflare/Airtable free tiers; Worker becomes optional. |
| Parse accuracy | Capped: single source, 84.9% deterministic, LLM limited to notes. | Good extraction, multi-source. But dates, sequencing, buffer checks done by an LLM in chat = unrepeatable, untested, drifts between sessions. | Best: multi-source LLM extraction with verbatim quotes + deterministic parser as an independent vote + all math in the pinned engine. Measurable against the gold corpus. |
| Apple Reminders | Hand-built Shortcut, ~dozen actions, no silent delete, iOS updates can kill it silently. Blocked on owner since July. | Reminders MCP works on the Mac, but every write is an LLM tool call — dates can be mis-typed, no idempotent sync, no tombstones. | Small Swift/EventKit sync run by launchd: real due dates + alarms, idempotent upsert by URL key, silent retire, reads completions back. Writes into the owner's existing list; touches only its own keyed items. iCloud carries it to the phone. |
| Ease of use | Phone-first, but intake is a form to review field by field. | Conversational, but no persistent visual plan; state lives in chat + a table. | Paste URL in terminal → answer only flagged conflicts + pick tier → done. Phone keeps the chart/timeline and Reminders. |
| Owner time | High: form review + hand-made reminders (today's reality). | Medium: re-explaining context, verifying LLM math. | Lowest: one URL in, reminders appear, history accrues. |
| Build risk | Keeps fighting the no-backend wall. | Throws away ~22k lines of tested engine. | Reuses the engine as-is; new code is thin glue. |

**Alternatives to Apple Reminders** (owner is open): none is clearly better. The
ICS calendar channel from the July design is a good *passive backstop*, not a
replacement — calendars have no check-off. Things/Todoist/TickTick have cleaner
APIs but cost a migration out of a tool the owner is embedded in, for no gain
now that EventKit removes the Shortcut pain. **Stay on Apple Reminders.**

**History store — REVISED 2026-09-25.** Owner clarified: **Airtable predates YV
and is nearly complete**; YV holds only a few test offers. So **Airtable is the
history source of truth**, not YV state. Division of labour: Airtable = ledger
(every past SUB per bank per entity, dates, realized amounts, fees) + KPI views;
YV = live plan (active/prospective offers, projection, reminder feed). The
eligibility gate reads Airtable. The intake skill writes a confirmed offer to
both; completion writes the realized outcome to Airtable. The existing one-way
YV→Airtable mirror (`scripts/airtable-sync.mjs`) is re-scoped or retired once
the skill owns the write. Two-way *automatic* sync into YV state stays rejected
(CAS model). No backfill needed. Blocker: no Airtable token on this Mac (only in
GitHub Actions secrets) — owner to create a PAT with read/write on the base and
export `AIRTABLE_TOKEN`, or share the schema, before the ledger phase is designed.

---

## 4. Recommendation

**Do not abandon Yield Vector, and do not keep polishing it as it is. Invert it.**

- **Freeze PWA UI work.** The PWA becomes the read-mostly phone dashboard
  (chart, timeline, offer status). No more manual-entry polish.
- **Do not build the iOS Shortcut.** Replace that whole channel with a Mac
  EventKit consumer of the feed that already exists.
- **Move intake out of the browser** into a Claude Code skill that runs on the
  subscription login and calls the YV pure modules for every number and date.
- **Stop expanding the Worker LLM tier.** Keep the Worker only as the PWA's
  optional URL fetcher.
- **Rule that carries through everything:** the LLM *reads and extracts*; the
  engine *computes*. The LLM never produces a date, a deadline, or a sequence.

### Target flow

`/bonus <DoC URL>` →
1. Fetch the DoC post (body, dated updates, relevant comment data points).
   Follow its link to the bank's offer page + terms; fetch those.
2. Extract into the YV offer schema. Every field carries a verbatim quote + the
   source URL. Run `parseDocPost` as an independent vote.
3. Reconcile: bank terms win on requirements/dates/amounts; DoC wins on folk
   knowledge (what counts as DD, Chex, churn data points). Agreement → accept
   silently. Disagreement or missing → ask the owner. That is the only input.
4. Eligibility gate against the ledger: per entity, has this bank paid a SUB,
   when, and does the offer's lookback language (anchor + months) clear.
5. For each tier × path, build a candidate and run `optimizePlanner` against
   live state. Present a comparison: bonus, capital tied, days, annualized
   return, lowest cash vs the reserve floor, collisions with in-flight bonuses,
   next churn-eligible date.
6. Owner picks. Offer is written to state; feed regenerates; the EventKit sync
   puts dated reminders in "Credit Cards | Banks | Travel".
7. On completion, realization fields (actual bonus, fees, dates, entity) close
   the loop into the ledger → Airtable KPIs.

### Build order (each phase is useful on its own)

1. **Reminders bridge (highest value, smallest build).** Swift EventKit CLI +
   launchd: pull Gist `_feed` → upsert by URL key into the existing list →
   retire tombstoned ids → write heartbeat + completions files. Dry-run mode
   first. Ends the hand-entry of reminders immediately, for offers already in YV.
2. **Extractor + measurement.** Build the skill's extraction step; score it on
   the 31-post gold corpus. Gate: **zero high-confidence-wrong** fields, and
   beat 84.9%. Do not wire it to state until it passes.
3. **Headless engine CLI.** `node` entry that loads state, accepts candidate
   offers, runs `optimizePlanner`, prints the tier/path comparison.
4. **State write path.** See open question 1.
5. **Ledger.** Airtable is the ledger (see §3 revision). Map its existing
   schema to the offer model, add any missing fields (entity, anchor dates,
   realized bonus, fees), wire the eligibility gate + completion write-back.
6. Optional: ICS backstop calendar; phone capture via the existing Apple Notes
   → task-watcher route.

---

## 5. Open questions (resolve before/while building)

1. **How does a CLI write state safely?** Sync uses lineage/marker-based CAS
   (`js/sync-pwa.js`), and `computeReminderFeed` mutates state and imports `App`
   (`js/reminders.js` is MIXED, not pure). Preferred: make the CLI a proper sync
   peer (pull → modify → CAS push) and extract a pure feed builder. Fallback:
   CLI emits an offer JSON the PWA imports in one tap. Needs a short design pass.
2. **Reminder ownership inside a shared list.** Proposal: the sync touches only
   reminders whose URL field carries `yieldvector.local/id/<id>`; everything
   else in the list is invisible to it. Confirm the owner is comfortable, or
   use a dedicated list.
3. **Mac availability.** The bridge runs when the Mac is awake. Deadlines are
   day-granular and reminders are created weeks ahead, so a daily run suffices;
   the heartbeat + in-app staleness warning covers a long outage.
4. **Bank pages that block fetches** (bot walls, PDFs, geo-gated promos).
   Fallback: owner pastes the terms text; the skill treats it as a source.
5. **Entity model.** Eligibility is per entity (personal, sole prop, other
   business entities). Catalog exists in Settings; the ledger needs entity on
   every historical row.
6. **Privacy.** Repo is public. Ledger data, entity names, and any personal
   config must live in synced state or outside the repo — never in source.

---

## 5b. Owner Q&A — 2026-09-25 (owner approved the hybrid direction)

- **EventKit** = Apple's native framework behind Reminders/Calendar; full
  read/write from a Mac program after a one-time permission grant.
  `tools/create-reminders.swift` already proves it here. The "Reminders
  automation is limited" reputation belongs to CalDAV (removed iOS 13),
  Shortcuts (clumsy actions), and AppleScript (slow) — not EventKit.
- **Bidirectional: yes.** Bridge writes/updates/retires its own keyed
  reminders AND reads completions back → `yv-completions.json` (receiver
  already exists in `js/sync-pwa.js` `applyRemoteCompletions`) → offer/
  requirement status advances. Completion is the only signal a reminder
  carries; amounts/facts come from the extractor or the owner.
- **Extractor runtime** = Claude Code on the owner's subscription (no API
  key, $0 marginal). Plain fetch for DoC + most bank pages; Playwright only as
  a fallback fetcher for JS-rendered/bot-walled bank pages; paste as last
  resort. The Cloudflare Worker becomes optional (phone-only URL fetch).

## 5c. Airtable ledger audit — 2026-09-25 (proposal, awaiting owner approval)

Base "Bank Account SUB Tracker" `appsCN4cxqX0Ojwf4` (NOT the base the July
mirror script targets — that was a separate base; the mirror script is
obsolete). Token: `~/.config/yield-vector/env` → `AIRTABLE_TOKEN` (600 perms,
outside the repo). Read via `curl`/`urllib` with Bearer auth; the claude.ai
Airtable connector is not used.

State: Banks 22 rows (8 open / 10 closed / 4 planned; 13 earned), Actions 2
rows (Shortcut-sync scaffolding, unused), Info 11 rows (bank profile, mostly
empty, referenced by text not link). Gaps for the eligibility gate: Entity
blank on 10/22, Email blank on 9, 2 closed rows lack Closed date, 4 banks
appear twice with no offer label/lineage, single `SUB` amount (no offered vs
received, no fees), no churn rules stored anywhere. Six formula fields
re-derive deadlines (funding-by, withdraw-by, OK-to-close, DD#1, APR, close
trigger) — duplicate the YV engine; drop under the hybrid.

Proposal: **Institutions** (from Info; link target; adds churn rule = lookback
months + anchor + once-per-lifetime + scope, Chex, hard pull, keep-open days,
ETF window) · **Accounts** (from Banks; adds Institution link, Offer label,
Product, Received Bonus, Fees Paid, Tier/Path chosen, Offer expiration, YV
Offer ID join key, Next Eligible formula; renames abbreviations to full names;
keeps offer-term parameters as facts) · **Actions** deleted (reminders come
from the YV feed). Migration: snapshot JSON first → add fields → copy →
verify → remove old. Needs `schema.bases:write` scope if done via API.

## 5d. EXECUTION STATUS — last updated 2026-10-03

Where the build actually stands. Phases refer to §4 "Build order".

### Config (all outside the repo — repo is public)
`~/.config/yield-vector/env`, mode 600, holds `AIRTABLE_TOKEN` (PAT
`yield-vector-mac`, scopes: records r/w + schema r/w, base-limited),
`GITHUB_TOKEN` (classic, `gist` scope only), `GIST_ID`
(`aa598916393a061a4b4f9067fc857d93` — the live sync gist, secret, holds
`capital-planner.json`; two older gists with the same filename are stale and
must not be used), `REMINDERS_LIST` (`Credit Cards | Banks | Travel`, iCloud —
the owner's existing list; verified the only Reminders account is iCloud, so
Mac writes reach the iPhone through iCloud). Bridge's own memory:
`~/.config/yield-vector/bridge-state.json`. Pre-migration Airtable snapshot:
`~/.config/yield-vector/snapshots/2026-09-26-pre-migration/`.

### Phase 1 — Mac EventKit reminders bridge: BUILT, DRY-RUN VERIFIED, NOT YET LIVE
`tools/yv-reminders-bridge.swift` (commit `283bb3b`; binary gitignored, build
with `swiftc -O -swift-version 5 -o tools/yv-reminders-bridge
tools/yv-reminders-bridge.swift`). Launchd plist `tools/com.collin.yv-reminders-bridge.plist`
(900 s interval + RunAtLoad, logs to `~/Library/Logs/yv-reminders-bridge.log`)
is written but **not installed** — copy to `~/Library/LaunchAgents/` and
`launchctl load` when the owner approves going live.

Design decisions worth keeping: owns ONLY reminders whose URL field is
`https://yieldvector.local/id/<feed item id>`, so the other ~190 reminders in
that shared list are invisible to it; refuses to act on `schema != 2`,
`feedStatus != ok`, or an empty manifest (no items AND no tombstones);
delete-rate guard at 30% of owned items unless `--force-delete`;
`bridge-state.json` records last-written title/due/notes per id so an owner's
manual edit survives until the FEED changes that field; completions found on
owned reminders append to `yv-completions.json` and a heartbeat lands in
`consumer-mac-bridge.json` (both in the same gist). Flags: `--dry-run`,
`--force-delete`, `--skip-past-days N`.

**Dry run 2026-09-26 against the live feed** (manifest 29827705, schema 2, 18
items, 13 tombstones; list had 191 reminders, 0 owned): would create 18, update
0, delete 0. 10 of the 18 are overdue (May 20 → Sep 21) because no consumer has
ever existed to mark them done — Huntington withdraw + bonus-window +
safe-close, Wings ×3 dd-initiate + dd-window-end + withdraw, BMO expiry,
Associated withdraw. **OPEN DECISION, blocking the first real run:** create all
18 (recommended — checking the stale ones off is the reconciliation the app has
never had) vs `--skip-past-days 30` (drops 8). Owner also flagged two possibly
stale offers to check first: U.S. Bank Platinum Business (expired Sep 27) and
BofA Advantage Plus (Sep 30).

### Phase 5 — Airtable ledger: RESTRUCTURE EXECUTED 2026-09-26
Script `scripts/airtable-migrate-2026-09-26.py` (commit `a9d2daa`), three
idempotent stages (`rename`, `fields`, `data`), all three run successfully.
Base `appsCN4cxqX0Ojwf4` "Bank Account SUB Tracker".

- **Renamed:** tables Banks→**Accounts**, Info→**Institutions**; ~40 abbreviated
  fields to full names (`O | C`→Account Status, `FB Day`→Funding Deadline
  (days), `MB`/`MB Days`→Minimum Balance/Hold Days, `QT`→Debit Transactions,
  `SF`→Fee Waiver…, `SUB`→Offered Bonus, `Earned`→Bonus Received Date, etc.).
- **Added to Institutions:** Churn Lookback (mo), Churn Anchor, Once Per
  Lifetime, Churn Scope, Hard Pull, ETF Window (days), Notes.
- **Added to Accounts:** Institution (link), Offer, Product, Received Bonus,
  Fees Paid, Tier Chosen, Path Chosen, Offer Expiration, YV Offer ID, Chex
  Pulled, Churn Lookback/Anchor Override, 3 institution lookups, and formulas
  **Net Bonus** + **Next Eligible** (override-aware, anchor-switching).
- **Data pass:** 8 institutions created (19 total), all 22 accounts linked,
  Product inferred on all 22, personal rows auto-filled Entity=SSN +
  Email=cmreko91 per the owner's rule (Entity blank 10→1, Email 9→0), Received
  Bonus seeded from Offered Bonus on the 13 earned rows. Formula fields healthy
  (no error values).
- **Per-offer vs per-bank:** the owner's concern that one bank's offers may
  differ (Chex, churn rules, keep-open days) is handled by Institution defaults
  + per-row overrides on Accounts; `Next Eligible` prefers the override.
- **Owner-only remainders (API cannot delete fields/tables):** delete the
  `(legacy) …` prefixed fields in both tables, delete the now-unused **Actions**
  table (2 rows, Shortcut scaffolding), fill Institutions churn columns for
  banks expected to repeat, label `Offer` on repeat-bank rows (U.S. Bank ×2,
  Chime ×2, BMO ×2, Wells ×2), add Closed date to the 2 closed rows missing it,
  Entity/Email on the 1 remaining business row. A reminder carrying this list
  was created in the owner's bank list on 2026-09-26 (9:00, via EventKit).

### Not started
Phase 2 (extractor + gold-corpus measurement), Phase 3 (headless engine CLI),
Phase 4 (state write path — see open question 1), Phase 6 (ICS backstop).
Also still true: the July `scripts/airtable-sync.mjs` mirror targets a
DIFFERENT, older base and is obsolete under this direction — retire it (and its
`.github/workflows/airtable-sync.yml`) when the skill owns the Airtable write.

## 6. Progress

- Done this session: full-folder review; status verification (Reminders list
  absent, Airtable connector mismatch, repo public, feed present in Gist
  contract, pure-module portability); options analysis; this record.
- Not done: no code, no schema change, no reminders written.
- Supersedes: `docs/SHORTCUT_BUILD_GUIDE.md` and the BACKLOG "Apple Shortcut v2
  executor build" owner-action (do not build). The July "one brain, three
  surfaces" design still holds — only the Reminders *executor* changes
  (Mac EventKit instead of iOS Shortcut).

---

## 7. Resume prompt (paste into the next session)

> Read `docs/assessments/2026-09-19-strategic-direction.md`. We agreed on the
> hybrid direction: PWA UI frozen, no iOS Shortcut, Claude Code skill as intake,
> YV pure modules compute everything. Start Phase 1: design and build the Mac
> EventKit reminders bridge that consumes the Gist `_feed` (contract v2 in
> `js/reminders.js`) and upserts into my existing Reminders list
> "Credit Cards | Banks | Travel", keyed by the URL field, touching only its own
> items, with a dry-run mode, heartbeat file, and completions write-back
> (`yv-completions.json`, see `js/sync-pwa.js`). Show me the dry-run output
> before anything is written to Reminders. Then resolve open question 1.
