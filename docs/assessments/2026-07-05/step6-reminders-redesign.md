# Reminders Framework Redesign — "One Brain, Three Surfaces, Provable Liveness"
Step 6, run 2026-07-05-yield-vector-assessment. Designed from first principles by the planner (Fable 5), for Codex cross-review. Supersedes the SHORTCUT_SETUP.md single-channel vision.

## Verified constraints (design must respect these)
- C1. **No server-side write path into Apple Reminders exists.** iOS 13+ "upgraded" Reminders live in a private silo; CalDAV third-party access was removed (BusyCal/2Do/Nextcloud all document this). On-device EventKit — reachable in practice via Shortcuts or a native app — is the only sanctioned write path. Any architecture promising "the cloud pushes Reminders directly" is fiction.
- C2. **ICS calendar subscriptions auto-refresh on iOS** on app-open plus ~1–3 h background cadence (configurable). Subscribed events can carry alarms (iOS exposes a per-subscription "Remove Alarms" toggle, i.e., alarms are honored unless stripped). Day-granularity deadlines tolerate hour-scale latency.
- C3. **Shortcuts can make arbitrary HTTP calls** — "Get Contents of URL" supports PATCH/POST with custom headers and JSON body. A Shortcut can therefore write state back to the Gist (heartbeat) using the same PAT the app already stores.
- C4. From the step-4 audit: the legacy design's root defect is **zero liveness signal** — every failure collapses to "silently no reminders." Secondary defects: delete-by-absence (empty feed ⇒ mass-wipe), coverage gaps (debit byDate, per-DD, DD window-end, deposit-gate legacy-status bug), silent try/catch around feed computation, no schema check in the consumer.
- C5. App reality: static PWA on GitHub Pages, no backend, localStorage + Gist(PAT) sync already accepted infra. A Cloudflare Worker is already the recommended v2 transport for DoC import (step 2) — reusing it here adds no NEW infra class.
- C6. Collin's goal: hands-off "figure out + remember." Both iPhone and Mac in play. He acts on these dates financially — a missed reminder has real cost, so **failure visibility outranks failure prevention**.

## The framework

**One brain.** All reminder truth lives in ONE place: the app's feed engine (`computeReminderFeed`, upgraded to contract v2 below). No consumer computes dates, filters, or decides anything. Consumers are dumb, disposable executors of a precomputed manifest. Rationale: every piece of logic in a consumer (especially a hand-built 20-step Shortcut) is logic that silently rots; logic in the app is versioned in git, testable, and visible in diagnostics.

**Three surfaces, graduated latency, redundant by design:**
1. **In-app action queue** (live; source of truth) — the step-3 P1/P2/P7 work: complete coverage, computed at-risk states, Today view. Zero delivery risk, but requires opening the app. This surface must be fixed FIRST; both other surfaces render its output.
2. **Subscribed calendar via ICS** (passive; hours-scale; zero-maintenance) — a Cloudflare Worker endpoint renders the Gist feed as `text/calendar` VEVENTs (all-day events with VALARM alerts at 9am, matching the Shortcut's alert convention). iOS/macOS subscribe once via an unguessable capability URL; they auto-refresh forever. No consumer to maintain, no automation to break, stateless (computed per request). This is the reliability floor: even if everything else fails, deadlines appear on the calendar.
3. **Apple Reminders via a minimal Shortcut** (actionable check-off; daily) — kept, because C1 makes on-device EventKit the only Reminders path and Reminders is what Collin asked for (checkable to-dos with completion semantics that the app can eventually read back... it can't — one-way; completion stays user-side, as in the legacy design). But redesigned to be a **dumb executor**, roughly half the steps of the legacy spec.

**Provable liveness (the core novelty vs legacy).** Every consumer must prove it ran; the system must alarm when one doesn't:
- The Shortcut's final action PATCHes `_consumers.shortcut = {lastRunAt, itemsApplied, manifestVersion}` into a dedicated Gist file (`consumers.json`, separate file in the SAME Gist — avoids racing the app's state pushes on capital-planner.json).
- The Worker stamps `_consumers.ics = {lastServedAt}` the same way (or infers from CF analytics; explicit stamp preferred, throttled to ≤1 write/hour).
- The app, on every sync pull, renders consumer health in Settings AND in the action queue itself: heartbeat older than 36 h ⇒ a top-of-queue warning item "Reminders sync hasn't run since <date> — open checklist."
- **Cross-channel watchdog:** the Worker, when serving the ICS, checks `_consumers.shortcut.lastRunAt`; if stale >48 h it INJECTS a calendar event titled "⚠️ Yield Vector: Reminders sync is down" dated today with an alarm. The passive channel that never breaks becomes the alarm bell for the channel that can. No failure mode is silent anymore: app shows it, calendar shouts it.

**Never-wipe deletion (tombstones).** Feed contract v2 replaces delete-by-absence with explicit tombstones: `removed: [ids...]` retained for 30 days. The Shortcut deletes ONLY tombstoned ids and additionally refuses to act at all if `items.length == 0 && removed.length == 0` on a manifest whose previous version had items (belt and suspenders: the min-item guard survives even if tombstones regress). Mass-wipe becomes structurally impossible rather than guarded-against.

## Feed contract v2 (the app-side spec)
```json
{ "schema": 2,
  "generatedAt": "ISO",
  "manifestVersion": 41,            // monotonic; consumers echo it in heartbeat
  "items": [{ "id": "yv-<offerId>-<kind>[-<n>]",
              "kind": "offer-expires|deposit-deadline|dd-initiate|dd-window-end|debit-deadline|withdrawal|safe-to-close|bonus-posting-check|commitment-end|inflow|outflow",
              "title": "...", "dueDate": "YYYY-MM-DD",
              "risk": "on-track|at-risk|overdue",   // from step-3 P2; consumers may prefix ⚠️
              "notes": "..." }],
  "removed": [{ "id": "...", "tombstonedAt": "ISO" }] }
```
Coverage additions vs v1: `dd-initiate` (per planned DD), `dd-window-end`, `debit-deadline`, plus `safe-to-close` and `bonus-posting-check` once their fields graduate (step 2). The deposit-deadline legacy-status gate bug is fixed here (gate on funding-pending reality, not `deriveLegacyStatus`). The silent `try{}catch{}` at index.html:2556 becomes `catch(e){ logError(ErrCode.E_RENDER, e, 'reminder-feed') }` and, on failure, REUSES the last good feed rather than shipping absent/stale silently.

## The minimal Shortcut (consumer spec, ~10 actions)
1. GET consumers.json raw → parse (for its own last manifestVersion). 2. GET capital-planner.json raw → extract `_feed`. 3. If `schema` > known → notify "update the YV shortcut" and STOP (never guess). 4. If items+removed both empty and last manifest had items → notify and STOP. 5. Upsert loop: match by URL-field key (unchanged from legacy — it works); write Title/Due/notes-on-create only; prefix "⚠️ " to Title when `risk == "at-risk"|"overdue"`. 6. Delete loop over `removed[]` only. 7. PATCH heartbeat with manifestVersion. 8. Notify ONLY on failure (any error branch) — silence means success.
Personal Automation: daily 6:00, Run Immediately + a second daily trigger at 14:00 (two chances/day; heartbeat dedupes). Setup remains ~20 min once; the app gains a **Setup Checklist panel** (Settings) that live-checks each stage: PAT valid → Gist reachable → feed fresh → shortcut heartbeat seen → ICS lastServed seen, each with a fix-it hint. "Verified live" replaces "hope."

## Cloudflare Worker (shared with DoC import, one deployment)
Routes: `GET /ics/<capability-token>` → fetch Gist raw, render VEVENTs (+watchdog injection), `Cache-Control: max-age=900`; `POST /doc-extract` → the step-2 DoC fetch/extract endpoint (Sonnet 5 + snippet tripwire per addendum); `POST /heartbeat` optional proxy if PAT-in-Shortcut is ever revoked. Secrets: Gist read token + Anthropic key as Worker secrets. Free tier covers this by orders of magnitude. One piece of infra, two features — and the ICS channel works even with the Worker cold-started.

## Failure-mode table vs legacy
| Failure | Legacy outcome | Redesign outcome |
|---|---|---|
| Shortcut never built/stops | Silent forever | App warns at 36 h; calendar shouts at 48 h |
| Empty/partial feed | Mass-wipe of reminders | Structurally impossible (tombstones + guard) |
| Feed computation throws | Silent stale feed | logError + last-good-feed reuse + diagnostics |
| PAT expiry | Two sides fail separately, silently | Checklist panel red + both heartbeats stale → visible twice |
| Schema drift | Shortcut breaks or ignores silently | Versioned; consumer self-reports and stops |
| iOS update kills automation | Silent | Watchdog event on calendar within 48 h |
| Worker down | n/a | ICS stale (iOS shows last copy); Reminders path unaffected; app checklist shows lastServed stale |

## Sequencing (dependency-honest)
1. Feed v2 in-app (fix gaps + tombstones + schema + logError) — prerequisite for everything; also completes step-3 P1.
2. Build + verify the minimal Shortcut (the ONE next action from step 4 stands — but build the v2 spec, not the legacy 20-stepper).
3. Setup Checklist panel + heartbeat rendering.
4. Worker: ICS channel + watchdog (can precede or follow 2; independent).
5. Risk states (step-3 P2/P3) enrich all three surfaces; DoC import lands last and inherits everything (imported offer → confirmed dates → feed v2 → all surfaces, zero extra action).

## What Codex should attack
- Is the tombstone contract sufficient, or does id-stability across offer edits break upsert/delete matching?
- Gist as heartbeat store: race conditions between app pushes and Shortcut PATCHes (separate file mitigates — enough?).
- ICS VALARM behavior on subscribed calendars across iOS versions; capability-URL privacy (feed contains bank names + amounts).
- Is the two-trigger daily automation actually more reliable, or does it double the failure surface?
- Anything the three-surface redundancy still leaves silent.

---
# v1.1 — Codex cross-review amendments (INCORPORATED; these override the body above where they conflict)

1. **Claim downgraded:** "provable liveness" → **"observable last successful producer run."** Heartbeats prove the process reached its final PATCH — not that Reminders exist on-device, alarms fired, or the user saw anything. The design's honest guarantee: no producer/consumer failure goes unobserved by the app + calendar watchdog. Residual silence (documented, accepted): calendar alerts toggled off, subscription removed, Focus suppression, Reminders permission revoked mid-run, iCloud sync breakage, app never opened. The in-app queue remains the backstop — acceptable because Collin opens the app routinely; if he stops, the calendar watchdog is the remaining net.
2. **One heartbeat file per consumer** (`consumer-shortcut.json`, `consumer-ics.json`) — two writers on one file is a read-modify-write race; last writer could erase the other's key. (Alternative if file sprawl bothers: a Worker merge endpoint as sole writer.)
3. **Tombstone retention is ack-based, not 30-day:** keep a tombstone until every registered consumer has heartbeated a `manifestVersion` ≥ the tombstone's version, with a 90-day fallback TTL. A Shortcut broken for 5 weeks still gets its deletes.
4. **Mass-wipe demoted from "structurally impossible" to "multiply-guarded":** a feed bug could still emit items:[] + tombstone-everything. Add: delete-rate guard (consumer refuses to delete >30% of managed reminders in one run unless the same manifest is seen twice consecutively), `feedStatus: ok|stale|error` + `lastGoodGeneratedAt` metadata in the feed, tombstone `reason` field.
5. **Stable child IDs:** DD items get `yv-<offerId>-dd-<ddId>` with a persisted per-DD id minted at creation — never array index (insert/reorder/delete would migrate completion state onto the wrong DD).
6. **List ownership defined:** the "Yield Vector" Reminders list is OWNED by the pipeline; user moves out of it are not preserved (documented). Avoids the search-scope duplication bug.
7. **manifestVersion regenerated on every push** (monotonic clock component, e.g. max(prev+1, epoch-minutes)) so restore-from-history can't roll it backwards; consumers reject manifests older than their last-seen version.
8. **Version-lag alerting:** the app warns not only on stale `lastRunAt` but when `consumer.manifestVersion < currentFeed.manifestVersion - K` (K=2) — catches the "runs happily against cached stale content" mode (raw.githubusercontent caching).
9. **ICS hygiene:** timed events (09:00 local, matching the Reminders alert convention) with stable `UID`, incrementing `SEQUENCE`, correct `DTSTAMP`/`LAST-MODIFIED`; do NOT rely on VALARM-on-all-day behavior. Capability URL is a bearer credential to financial data: generate long random path, support rotation from the app's Settings, and offer a redacted-titles mode ("Bank deadline" vs "Chase $900 — fund $15k").
10. **Two daily triggers kept** but with a reentrancy lock (skip if a run's heartbeat is <2 h old) and heartbeat written only after FULL success — covers transient misses only; it is not a fix for systemic failures (that's the watchdog's job).
