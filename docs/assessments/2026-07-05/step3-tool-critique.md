# Yield Vector — Whole-Tool Critique (Step 3 full deliverable)

Goal judged against (verbatim): "managing dates and requirements to be as hands-off as possible in figuring out what I need to do, and then remembering to do it." Two verbs: FIGURE OUT (derive to-dos) and REMEMBER (surface/nag).

## (a) Strong
- Deadline derivation from parameters: depositDeadline (:3504), withdrawalEligibleDate (:3511), lockStartDate (:3539) — user never hand-maintains dates. Core of "figure out," solid.
- ACH business-day awareness: usFederalHolidays (:2911), nextBusinessDay, directDepositEffectiveDate (:3029); withdrawalEligibleDate wraps in bizDayISO.
- Action queue exists, two-tiered: computeActionsRequired (:4518) headline count; computeUpcomingActions (:4544) dated/sorted/paged list consumed by overview (:4612).
- dd-methods.json baked (1,158 banks) — removes per-offer research.
- Sync no longer naive: safeSync (:2450) timestamp-arbitrated, flushes pending pushes before pull (:2460), fresh-device seed guard (:2494), guardedManualPush (:7667); restore-from-history + Export JSON (:5362, :7790).
- Diagnostics not silent: logError/ErrCode ring buffer (:2091, :2108), global handlers (:2130), recovery panel.

## (b) Weaknesses ranked
1. [HIGH] Two requirement deadlines never reach EITHER reminder surface: debitRequirement.byDate only in card-chip tooltip (:4930), absent from computeUpcomingActions (:4544) AND computeReminderFeed (:4428); DD window-end ("all DDs by") never emitted, only individual plannedDates. Failure: "3 debit purchases by Aug 20" → nothing anywhere → forfeited bonus.
2. [HIGH] No computed ON-TRACK/AT-RISK: subStatus 'on-track' is manual (SUB_STATUSES :2199, dropdown :7496). No code compares DDs done/planned vs required vs days remaining, or debits vs byDate. Only "risk" logic is cash-flow shortfall in projection (:3915, :3946 feasible) — capital, not completion. Failure: needs 3 DDs, 1 scheduled, 10 days left → calm self-set "On-Track" chip.
3. [HIGH] Deposit-deadline reminders gated on legacy status: computeUpcomingActions (:4559) and computeReminderFeed (:4450) emit "fund $X" only for status applied|selected|prospect, but deriveLegacyStatus (:2230) maps approved → 'funded' → the deposit reminder DISAPPEARS the moment an offer is marked Approved (account open, funding pending — exactly when it matters). Withdrawal reminders unaffected.
4. [MED] No bonus-received reconciliation: 'earned' manual; no promised-posting-window record; no "bonus was due by DATE, never marked earned" flag.
5. [MED] Sync single-writer race remains in cooldown/debounce window; timestamp LWW, no per-record merge; guardedManualPush covers only the manual path, not auto focus/visibility (:7309). Residual for 2-device use.
6. [MED] localStorage only automatic store; iOS PWA eviction possible with no event; no periodic auto-export or backup-age nag; Gist token expiry → error status but no escalation.
7. [LOW] subStatus advancement 100% manual (:7496); approved/on-track → met-waiting could be SUGGESTED once all planned dates passed.
8. [LOW] Single-file architecture is FINE at this scale — zero deploy friction, greppable; don't refactor for its own sake.

## (c) Additive proposals ranked (dependency spine: P1 → P3 → P2 → {P4, P5, P7}; P6 independent)
- P1 [S] Surface missing deadlines + fix status gate (weakness 1&3): add debit byDate + DD-window-end items to computeUpcomingActions/computeReminderFeed; broaden deposit-deadline gate to "account open, funding not yet done". Highest value per line; do first.
- P2 [M] Computed on-track/at-risk badge: pure requirementRisk(offer, TODAY) → on-track|at-risk|overdue from DDs-remaining vs window and debits vs byDate; replaces self-reported chip (:4926); "At risk" bucket atop Upcoming actions. Needs P3.
- P3 [M] Per-requirement done-tracking: dd.completed flag + debit-done counter; hooks modal DD rows (:6404) and computeActionsRequired (:4518) to count outstanding only. Foundational.
- P4 [M] Bonus-received reconciliation: expected-posting date → "Confirm $X posted?" queue item; 'earned' becomes confirmed reconciliation. Needs P3.
- P5 [S] Stale-offer guard: outstanding requirements + untouched N days → "No movement on {bank} in 21 days" queue item.
- P6 [S] Periodic auto-export/backup-age nag: reuse exportJson (:7790); independent.
- P7 [S–M] "Today view": filtered slice of computeUpcomingActions (due today/overdue/at-risk); a view, not an engine; do last.
Excluded per scope: DoC import (step 2), Reminders delivery mechanics (step 4 — but P1's feed additions must flow through computeReminderFeed :4428 to reach that pipeline), visual re-tuning (locked Round 36). auto-push.js = dev-only note.

## Step 3 open issues
- Grep-verified (not runtime-verified) that only 3 sites consume debit byDate/DD-window deadlines.
- No partial per-DD "completed" flag found anywhere (grep).
- iOS localStorage eviction asserted from platform knowledge, not tested on-device.
