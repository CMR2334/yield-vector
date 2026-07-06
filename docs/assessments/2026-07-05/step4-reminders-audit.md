# Apple Reminders Integration — Full Assessment (Step 4 full deliverable)

Framing CONFIRMED: FEED SHIPPED, CONSUMER UNCONFIRMED. App writes _feed into Gist on every push (index.html:2556, :2575); SHORTCUT_SETUP.md fully specifies the consumer; HANDOFF.md:39 lists the on-device Shortcut build as Pending and HANDOFF_ARCHIVE.md:1059 says "Shortcut not built."

## (a) Pipeline as designed (5 hops)
1. App: on Sync.push()/createGist(), _feed = computeReminderFeed(state) (:2556, :2575) embedded INSIDE the state JSON pushed to Gist. SILENT-FAIL: the computeReminderFeed call is wrapped in try{}catch{} with EMPTY body (:2556) — a throw ships a stale/absent feed, unlogged. Feed freshness = last save; no scheduled push.
2. Gist stores; Shortcut reads raw URL sans revision hash (SHORTCUT_SETUP.md:24-28). raw.githubusercontent ~5min cache — low impact at daily cadence.
3. Shortcut fetch+parse (:49-70). Merge key: reminder URL field holds https://yieldvector.local/id/<feed-id> (:85-88). On match overwrite Title+DueDate only, user owns Notes/Alarms/Completion (:104-108, :168-176). On no match, create with notes + 9AM alert.
4. Deletion (:119-131): deletes planner-managed reminders whose id not in FeedIDs — an EMPTY/partial feed means MASS-DELETE of all YV reminders (incl. user's notes/alarms). No min-item guard in spec.
5. Reminders → iCloud → Mac.
BACK-SIGNAL: NONE — the critical finding. No write-back, no "last synced" marker, Notify-When-Run OFF (:156-158). If the Shortcut never runs (the state TODAY): nothing observable anywhere. 100% silent by design.

## (b) Coverage audit (feed kinds at :4428-4511: offer-expires :4441, deposit-deadline :4453, withdrawal :4465, commitment-end :4483, inflow/outflow :4498)
- Offer expiration: YES (:4438) gated non-confirmed.
- Deposit/funding deadline: PARTIAL-BROKEN — gate on legacy applied|selected|prospect (:4449-4459); deriveLegacyStatus maps approved/on-track/met-waiting/earned → 'funded' (:2236-2238) → item vanishes when Approved + funding pending. (Step-3 gap #3 confirmed.)
- Withdrawal/lock-release: YES (:4461) — legacy asymmetry does NOT affect it.
- Each planned DD initiation: NO — plannedDates only in computeActionsRequired (:4529), never in feed. (gap #2 confirmed)
- DD window-end: NO. (confirmed)
- Debit byDate: NO — tooltip only (:4930). (gap #1 confirmed)
- Safe-to-close/ETF: NO — safeToCloseDate (:3560-3566) is a DEAD STUB, always returns null.
- Expected-bonus-posting: NO — no posting-date field exists.
- Monthly-fee actions: NO — no monthlyFee field at all (grep zero).
- Commitments, inflow/outflow: YES.
NEW gaps: (g4) feed doesn't filter by horizonDays (metadata only, :4508); (g6) offerIsActiveForProjection gate (:4435→:3702) requires includeInScenario for non-confirmed offers — un-toggled prospects emit NOTHING, even expiration (flag for hands-off goal; also the natural DoC confirmation gesture).

## (c) Failure modes — dominant risk: the ENTIRE CLASS is undetectable (no liveness signal; every failure = "silently no reminders")
- Shortcut never installed: CERTAIN today × High. Design detects: NO.
- Shortcut silently stops (automation off, signed out, iOS update): Med × High. NO.
- Empty/partial feed → mass-delete (wipes user notes/alarms): Low-Med × High. NO guard.
- Gist PAT expiry: Med × High — app side toasts push-fail (:2568); Shortcut side silent; neither tells the other.
- Schema drift: Med × Med — Shortcut hardcodes fields (:94-98), doesn't check _feed.schema.
- Duplicate reminders: Low × Med — URL merge key OK while ids (yv-offer-<id>-<kind>) stable.

## (d) Path forward
Comparison: (1) Harden Gist+Shortcut — ~30min one-time, near-zero ongoing, self-detects IF write-back added → RECOMMENDED. (2) Mac EventKit CLI + launchd (create-reminders.swift proves possible) — 1-2hr, Mac-awake/TCC/signing fragility → fallback only. (3) reminders://x-callback deep links — manual per-reminder, violates hands-off → rejected. (4) PWA push — not real Reminders, iOS-fragile → rejected.

Recommended hardening, concretely:
- App: fix 3 coverage gaps in computeReminderFeed (:4428): deposit gate → funding-pending check surviving legacy mapping (gate on accountStatus/subStatus directly, not o.status); per-DD 'dd-initiate' items from directDeposits[].plannedDate; 'debit-deadline' from debitRequirement.byDate.
- App: CONSUMER HEARTBEAT — Shortcut PATCHes _feedConsumer {lastSyncedAt, itemCount} back to the Gist as final step; app displays "Reminders last synced by Shortcut: <time>" in Settings→About and toasts if >48h stale. SINGLE HIGHEST-VALUE CHANGE — converts the whole failure class from silent to visible.
- Shortcut: min-item guard before delete loop (skip if 0 items — prevents mass-wipe); Notify-on-failure; write-back PATCH; check _feed.schema and no-op+notify if unknown.
- Setup checklist: confirm Gist+PAT, create list, build Shortcut per doc, one manual run, 6AM automation, confirm heartbeat line populates.
- Maintenance: PAT re-issue on expiry; re-grant Reminders permission after major iOS updates (heartbeat surfaces both).
THE ONE NEXT ACTION: build + verify the Shortcut on-device per SHORTCUT_SETUP.md BEFORE any new engineering; the unverified consumer is the whole risk.

## (e) DoC tie-in
DoC-imported offers flow through computeReminderFeed like manual ones, but only after user confirms plan dates — structurally enforced already: the includeInScenario gate means a freshly-parsed offer emits nothing until toggled into the scenario (natural confirmation gesture). Two new kinds from step-2's NEW-SCHEMA facts: bonus-posting-check (new expectedBonusPostingDate field) and safe-to-close (revive the :3560 dead stub with the DoC ETF window). Both additive to the kind enum; safe if Shortcut ignores unknown kinds.

## Step 4 open issues
- Consumer half asserted from spec, not observed (Shortcut confirmed unbuilt).
- raw.githubusercontent 6AM cache-delay untested (low impact).
- Exact replacement gate for :4450 is a recommendation, not implemented/tested.
