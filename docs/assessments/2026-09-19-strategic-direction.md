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

**History store.** Keep **YV state as the source of truth** (add realization +
lineage fields there), and keep **Airtable as the read-only view/KPI layer** fed
by the existing mirror, extended with the new fields. Two-way Airtable sync
stays rejected (fights the CAS sync model). This honours the owner's
portability rule: the ledger lives in his own JSON, Airtable is replaceable.
A one-time **backfill of pre-YV bonuses** is required — eligibility gating is
only as good as the history.

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
5. **Ledger.** Realization + lineage fields (backlog "Historical tracking"
   1→2), backfill, extend the Airtable mirror, KPI views.
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
