# Yield Vector Sync — Verified Shortcuts Build Guide

Every action name in this guide is the **exact name as it appears in the iOS Shortcuts app**, verified against Apple's Shortcuts User Guide and Matthew Cassinelli's action directory (source URLs in Part 3). No invented or approximately-named actions. Supersedes SHORTCUT_SETUP.md.

> **Compatibility note (read first):** build this guide **as written** against **feed contract v2** — `schema: 2` shipped in app **v2026.07.07** and is what the app emits today (docs/assessments/2026-07-05/step6-reminders-redesign.md). **Section F (tombstone deletes) is now live**: the feed carries a real `removed[]` array, so the delete/mark-complete loop has actual ids to act on — do NOT skip it and do NOT improvise delete-by-absence. The **only** field still absent from the payload is **`risk`** (computed risk is a later phase). Until it ships, skip **Step 23** (reading `risk`) and **Step 25** (the ⚠️ risk-title prefix): set `DisplayTitle` = `ItemTitle` directly. When `risk` later lands, add those two steps back — no rebuild. Everything else in this guide matches the live feed exactly.

---

# Part 1 — Capability findings & forced design adjustments

### Finding 1 — "Edit Reminder" EXISTS. In-place update is possible.
Stock Shortcuts has a first-class **"Edit Reminder"** action that sets a specific field of the reminder passed into it: **Title, Notes, Due Date, Priority, Is Completed, Is Flagged, List, URL, Images, Subtasks, Parent Reminder**. Setting only Title + Due Date leaves Notes, Alarms, Completion, and List untouched — so the promised merge semantics ("planner owns title + due date; you own notes/alarms/completion") are genuinely achievable. No lossy find→remove→re-add fallback needed. (Confirm the leave-unset-fields-alone behavior once on-device with a test reminder.)

### Finding 2 — The reminder URL field IS settable and readable. The merge-key strategy holds.
**"Add New Reminder"** exposes **URL** and **Notes** under **Show More**; **"Get Details of Reminders"** can read **URL** back; **"Edit Reminder"** can set it. Writing `https://yieldvector.local/id/<id>` into each reminder's URL field and matching on it is fully supported.

### Finding 3 — "Find Reminders" CANNOT filter on URL. Match by List + iterate + compare.
The action is named **"Find Reminders"** (not "Find Reminders Where"). Verified filter fields: **List, Title/Name, Is Completed, Due Date** — URL is not among them. Matching strategy: filter by **List is Yield Vector**, then loop the results, read each reminder's URL via **"Get Details of Reminders"**, compare with **"If"**. O(items × reminders) — fine at personal scale.

### Finding 4 — "Add New Reminder" has NO "Due Date" parameter.
Its settable parameters: title, **List, Alert, Priority, Flag, URL, Images, Notes**. The due date/time is established via the **Alert** parameter set to a **time** — feed it a **"Format Date"** value at `MM/dd/yyyy 09:00`. That single timed alert IS the due date and the 9 AM notification. (On update, **"Edit Reminder"** has a real **Due Date** field — use it directly.)

### Finding 5 — "Remove Reminders" always prompts for confirmation.
Documented as destructive with a mandatory confirm. In an unattended 6 AM automation the dialog can't be answered, so a true **delete** loop reliably completes only on manual/foreground runs. **Resolution (see Section F):** retire tombstoned reminders by **marking them complete** via "Edit Reminder" (Is Completed = true) — that has **no prompt** and runs unattended, and a completed reminder drops out of the default list. Actual deletion is demoted to the optional manual **F′** cleanup. This is safe by design: tombstoned items are never lost, and the purge just applies late. (Some iOS versions may allow pre-authorizing destructive Reminders actions — check on-device; do not assume.)

### Finding 6 — HTTP heartbeat fully supported.
**"Get Contents of URL"**: Method GET/POST/PUT/PATCH/DELETE, custom **Headers**, **Request Body** (JSON or file) under **Show More**. Gist heartbeat: `PATCH https://api.github.com/gists/<gist-id>` with body `{"files":{"consumer-shortcut.json":{"content":"<stringified json>"}}}`, PAT with **`gist`** scope. The heartbeat lives in its own file so it never races the app's writes to capital-planner.json.

### Finding 7 — Verified building blocks
**"Get Dictionary from Input"** (JSON text → dictionary), **"Get Dictionary Value"**, **"Dictionary"**, **"Repeat with Each"** (Repeat Item / Repeat Index), **"If"** (text: is / is not / contains; number: is / greater than / less than / between), **"Count"** (Items), **"Show Notification"**, **"Stop This Shortcut"** vs **"Stop and Output"**, **"Text"**, **"Set Variable"**, **"Format Date"**, **"Get Current Date"**, **"Run Shortcut"**. The generic "has any value" condition could NOT be verified — the guards below use **Count → If** instead.

### Finding 8 — Two daily Personal Automations, unattended
**Time of Day** trigger, **Daily**, **Run Immediately** ON, **Notify When Run** OFF. One trigger holds one time — create **two automations** pointing at the same shortcut (06:00 and 14:00).

### Corrections vs the legacy SHORTCUT_SETUP.md
| Legacy claim | Verified reality |
|---|---|
| "Filter Reminders where URL is ExpectedURL" | URL is not a filter field — filter by List, iterate, compare |
| Create branch sets a "Due Date" field + separate Alert | No Due Date field on Add New Reminder — timed **Alert** sets both |
| Deletes run silently in background | **Remove Reminders always prompts** — retire items unattended by marking them **complete** (Edit Reminder → Is Completed), demote real deletion to manual F′ |
| Update path uncertain / may require remove+re-add | **"Edit Reminder" exists** — clean in-place update |

### Finding 9 — Four new `kind` values (v2026.07.08) — no Shortcut changes needed

As of app **v2026.07.08**, the feed's `items[]` can carry four additional `kind`
values. **The envelope is still `schema: 2` and every item is still the same
shape — `{ id, kind, title, dueDate, notes }`.** Nothing about how this guide
reads an item changed: the upsert loop (Section E) pulls `id`, `title`,
`dueDate`, `notes` by name and never branches on `kind`, so these flow through
the existing generic handling and land in Reminders exactly like the older kinds.
**If your Shortcut is already built to this guide, you do NOT need to touch it** —
new kinds simply appear as new reminders, and each retires via the same
`removed[]` tombstone loop (Section F) when its condition lapses.

The new kinds, their id patterns, and when each emits:

| `kind` | `id` pattern | Emitted when |
|---|---|---|
| `requirement-deadline` | `yv-offer-<offerId>-req-<rowId>` | A **user-added** requirement row (e-statements, promo code, extra spend, …) on a pursued offer has a computable deadline and isn't done yet. Derived rows (funding/DD/debit) do **not** emit this — they already emit `deposit-deadline`/`dd-initiate`/`debit-deadline`, so there's no double-booking. |
| `expected-bonus-window` | `yv-offer-<offerId>-bonuswindow` | The offer is in the **Waiting** stage (`subStatus` = met-waiting): requirements are met and you're waiting for the bonus to post. `dueDate` is the **late edge** of the expected window, so a reminder fires if the bonus hasn't shown up by then. |
| `safe-to-close` | `yv-offer-<offerId>-safeclose` | The account is still **open** and at/past requirements-met (earned or met-waiting), and a safe-to-close date is computable (funds released, bonus posted/expected, ETF window + any unmet deadlines cleared). `dueDate` is the earliest date it's safe to close. |
| `churn-eligible` | `yv-offer-<offerId>-churn` | The offer is marked **churnable**, has a cooling-off period + its anchor date, and its re-eligibility date is within the look-ahead window. `dueDate` is the date you can earn it again. `churn-eligible` is suppressed while the offer's churn is snoozed (it re-emits — and resurrects via the normal `removed[]` tombstone loop — once the snooze is cleared or a timed snooze lapses). |

**Optional kind-specific filtering (only if you want it):** all four are
informational except `requirement-deadline`, which is an action item. If you'd
rather route them — e.g. drop the informational ones into a separate "Yield
Vector — FYI" list, or skip them entirely — add an **"If" → `kind` is
`<value>`** check at the top of the upsert loop and branch there. This is purely
a personal preference; the default all-kinds-in-one-list behavior is correct and
needs no edit.

---

# Part 2 — The build guide (one action per step)

## Prerequisites (one time, ~5 min)
- **P1** — Reminders app → **Add List** → name it exactly **`Yield Vector`**. This list is pipeline-owned; don't hand-add reminders to it.
- **P2** — Open your Gist → **Raw** on `capital-planner.json` → copy URL → **delete the per-revision hash** so it ends `…/raw/capital-planner.json`. This is the always-latest feed URL.
- **P3** — Note your **Gist ID** (hash in the Gist page URL). Heartbeat target: `https://api.github.com/gists/<gist-id>`, file `consumer-shortcut.json`.
- **P4** — GitHub PAT with **`gist`** scope (Settings → Developer settings → Personal access tokens).

## Build the shortcut "Yield Vector Sync"
Open **Shortcuts** → **+** → name it **Yield Vector Sync**. Add actions in order (search by the exact name).

### A. Fetch and parse
1. **"Text"** → your P2 raw feed URL. Rename output `FeedURL`.
2. **"Get Contents of URL"** → URL: `FeedURL` → **Show More** → Method **GET** → Headers: `Authorization` = `token <YOUR_PAT>` (skip if the Gist is public).
3. **"Get Dictionary from Input"** → input: the Contents of URL output.
4. **"Get Dictionary Value"** → Value for `schema` → rename `Schema`.
5. **"Get Dictionary Value"** → Value for `items` → rename `FeedItems`.
6. **"Get Dictionary Value"** → Value for `removed` → rename `RemovedItems`.

### B. Guard: unknown schema
7. **"If"** → `Schema` **is not** `2` *(the live feed is schema 2 — see Compatibility note)*.
8. — inside — **"Show Notification"** → Title `Yield Vector`, body `Feed schema unrecognized — update the Yield Vector shortcut.`
9. — inside — **"Stop This Shortcut"**.
10. End If.

### C. Guard: empty feed → never mass-act
11. **"Count"** → Items in `FeedItems` → rename `ItemCount`.
12. **"Count"** → Items in `RemovedItems` → rename `RemovedCount`.
13. **"If"** → `ItemCount` **is** `0`; nested **"If"** → `RemovedCount` **is** `0`.
14. — inside both — **"Show Notification"** → Title `Yield Vector`, body `Feed is empty — skipping to avoid a bad sync.`
15. — inside both — **"Stop This Shortcut"**.
16. End both Ifs.

### D. Snapshot managed reminders
17. **"Find Reminders"** → filter: **List is Yield Vector** → rename output `Managed`.

### E. Upsert loop
18. **"Repeat with Each"** → input `FeedItems`. Steps 19–34 go inside; **Repeat Item** = current feed item.
19. **"Get Dictionary Value"** → `id` of Repeat Item → rename `ItemID`.
20. **"Get Dictionary Value"** → `title` → rename `ItemTitle`.
21. **"Get Dictionary Value"** → `dueDate` → rename `ItemDueRaw`.
22. **"Get Dictionary Value"** → `notes` → rename `ItemNotes`.
23. **"Get Dictionary Value"** → `risk` → rename `ItemRisk`. *(SKIP for now — `risk` is not yet in the feed; add 23 & 25 when it ships.)*
24. **"Text"** → `https://yieldvector.local/id/` immediately followed by the `ItemID` variable → rename `ExpectedURL`.
25. **"If"** → `ItemRisk` **is** `at-risk` → inside: **"Text"** `⚠️ ` + `ItemTitle`, then **"Set Variable"** `DisplayTitle` = that Text. **Otherwise** → nested **"If"** `ItemRisk` **is** `overdue` → same ⚠️ Text + Set Variable; **Otherwise** → **"Set Variable"** `DisplayTitle` = `ItemTitle`. End both Ifs.
26. **"Format Date"** → Date: `ItemDueRaw` → Format **Custom**: `MM/dd/yyyy 09:00` → rename `DueAt9`.
27. **"Set Variable"** → `MatchFound` = `0` (use a **"Text"** action containing `0` as the value if needed).
28. **"Repeat with Each"** → input `Managed`. Steps 29–32 inside; Repeat Item = a reminder.
29. **"Get Details of Reminders"** → **URL** of Repeat Item → rename `ThisURL`.
30. **"If"** → `ThisURL` **is** `ExpectedURL`.
31. — inside — **"Edit Reminder"** → Reminder: Repeat Item → set **Title** = `DisplayTitle`; set **Due Date** = `DueAt9`. *(Do NOT set Notes/List/completion — unset fields are preserved.)*
32. — inside — **"Set Variable"** → `MatchFound` = `1`.
33. End inner If + inner Repeat.
34. **"If"** → `MatchFound` **is** `0` → inside: **"Add New Reminder"** → title `DisplayTitle`; **List** `Yield Vector`; **Alert** → Time = `DueAt9`; **Show More** → **URL** = `ExpectedURL`, **Notes** = `ItemNotes`. End If.
35. End the outer Repeat (from 18).

### F. Retire tombstoned reminders (RECOMMENDED: mark complete, not delete)
> **Why mark-complete instead of delete.** Per Finding 5, **"Remove Reminders" always prompts for confirmation**, so a true delete can't run unattended at 6 AM — the dialog blocks the loop. **"Edit Reminder" setting Is Completed = true has NO confirmation prompt** (it's an ordinary field edit — see Finding 1's field list, which includes **Is Completed**), so it runs fully unattended. A completed reminder drops out of the Reminders default view (it moves to "Completed"), so marking-complete gives the same "it's gone from my list" result as a delete, but reliably and automatically. Actual deletion is demoted to the optional manual cleanup in **F′** below. The feed's tombstone TTL (90 days) is comfortably long enough that a late manual purge never loses an id.
36. **"Repeat with Each"** → input `RemovedItems`. Steps 37–42 inside.
37. **"Get Dictionary Value"** → `id` of Repeat Item → rename `RemID`.
38. **"Text"** → `https://yieldvector.local/id/` + `RemID` → rename `RemURL`.
39. **"Repeat with Each"** → input `Managed`. Steps 40–42 inside.
40. **"Get Details of Reminders"** → **URL** of Repeat Item → rename `DelCheckURL`.
41. **"If"** → `DelCheckURL` **is** `RemURL`.
42. — inside — **"Edit Reminder"** → Reminder: Repeat Item → set **Is Completed** = `true`. *(No confirmation prompt; runs unattended. Do NOT set any other field — title/notes/alarms are preserved.)*
43. End inner If + both Repeats.

### F′. Optional manual cleanup — actually delete completed tombstones (foreground only)
> Run this occasionally BY HAND to purge the completed reminders F left behind. It uses **"Remove Reminders"**, which prompts for confirmation (Finding 5) — fine when you're watching, unusable in the 6 AM automation, which is exactly why it's separated out. Skipping it forever is harmless: completed items are already out of your default view.
44. **"Repeat with Each"** → input `RemovedItems`. Steps 45–50 inside.
45. **"Get Dictionary Value"** → `id` of Repeat Item → rename `PurgeID`.
46. **"Text"** → `https://yieldvector.local/id/` + `PurgeID` → rename `PurgeURL`.
47. **"Repeat with Each"** → input `Managed`. Steps 48–50 inside.
48. **"Get Details of Reminders"** → **URL** of Repeat Item → rename `PurgeCheckURL`.
49. **"If"** → `PurgeCheckURL` **is** `PurgeURL`.
50. — inside — **"Remove Reminders"** → Reminders: Repeat Item. *(This prompts for confirmation — expected on a manual run.)*
51. End inner If + both Repeats.

### G. Heartbeat PATCH
52. **"Get Current Date"** → rename `Now`.
53. **"Get Dictionary Value"** → `manifestVersion` from the Step-3 Dictionary → rename `ManifestVersion`.
54. **"Text"** → exactly:
    `{"files":{"consumer-shortcut.json":{"content":"{\"lastRunAt\":\"[Now]\",\"itemsApplied\":[ItemCount],\"manifestVersion\":[ManifestVersion]}"}}}`
    inserting the `Now`, `ItemCount`, `ManifestVersion` variables at the bracketed spots → rename `HeartbeatBody`.
55. **"Get Contents of URL"** → URL `https://api.github.com/gists/<your-gist-id>` → **Show More** → Method **PATCH** → Headers: `Authorization` = `token <YOUR_PAT>`, `Accept` = `application/vnd.github+json` → **Request Body: File** → `HeartbeatBody`. *(Alternative: build the body with nested **"Dictionary"** actions and Request Body: JSON — more steps, no escaping; note GitHub requires `content` to be a string, so the inner object must be stringified.)*

### H. Failure-only notification
56. **"Get Dictionary from Input"** on Step 55's output → **"Get Dictionary Value"** for `id` → **"Count"** Items → **"If"** count **is** `0` → inside: **"Show Notification"** → Title `Yield Vector`, body `Heartbeat PATCH failed — check PAT/Gist.` End If.
57. **Done.**

### First manual run
Run it once by hand. Grant when prompted: Reminders access; network access to `gist.githubusercontent.com` and `api.github.com`. Confirm reminders appear in the Yield Vector list. Section F now marks retired items **complete** (no prompt); a delete-confirmation prompt appears only if you run the optional **F′** manual cleanup.

## The two Personal Automations
1. Shortcuts → **Automation** → **+** → **Create Personal Automation** → **Time of Day** → **6:00 AM**, Repeat **Daily** → Next → action **"Run Shortcut"** → **Yield Vector Sync** → Next → **Run Immediately: ON**, **Notify When Run: OFF** → Done.
2. Repeat for **2:00 PM**.

---

# Part 3 — Source footnotes (action → verification URL)
- "Get Contents of URL" (methods/headers/body): https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios · https://matthewcassinelli.com/actions/get-contents-of-url/
- "Get Dictionary from Input": https://matthewcassinelli.com/actions/get-dictionary-from-input/ · https://support.apple.com/guide/shortcuts/parsing-json-apdde2dfe749/ios
- "Get Dictionary Value": https://support.apple.com/guide/shortcuts/get-dictionary-value-action-apdf01294032/ios
- "Dictionary": https://support.apple.com/guide/shortcuts/dictionaries-apd43b69f337/ios
- "Find Reminders" (filter fields; URL not filterable): https://matthewcassinelli.com/actions/find-reminders/ · https://support.apple.com/guide/shortcuts/add-filter-parameters-apdbdab3433f/ios
- "Get Details of Reminders" (reads URL): https://matthewcassinelli.com/actions/get-details-of-reminders/
- "Add New Reminder" (List/Alert/URL/Notes; no Due Date field): https://matthewcassinelli.com/actions/add-new-reminder/ · https://support.apple.com/guide/shortcuts/add-a-shortcut-to-reminders-using-siri-apdacfdf1802/ios
- "Edit Reminder" (in-place Title/Due Date/URL/etc.): https://matthewcassinelli.com/actions/edit-reminder/
- "Remove Reminders" (always confirms): https://matthewcassinelli.com/actions/remove-reminders/
- Due date via Format Date → Alert=Time: https://talk.automators.fm/t/reminders-app-set-alert-date-time-and-location-help/7295
- "Format Date"/"Date": https://support.apple.com/guide/shortcuts/adjust-variables-apda36b9018b/ios
- "Repeat with Each": https://matthewcassinelli.com/actions/repeat-with-each/ · https://support.apple.com/guide/shortcuts/use-repeat-actions-apdc11deb2c1/ios
- "If" conditions: https://support.apple.com/guide/shortcuts/use-if-actions-apd83dcd1b51/ios
- "Count": https://matthewcassinelli.com/actions/count/
- "Show Notification": https://support.apple.com/guide/shortcuts/use-the-show-notification-action-apd2175adcab/ios
- "Stop This Shortcut" / "Stop and Output": https://support.apple.com/guide/shortcuts/control-the-flow-of-actions-apd25a01237e/ios
- "Text"/"Set Variable": https://support.apple.com/guide/shortcuts/use-variables-apdd02c2780c/ios
- Personal Automations (Time of Day / Run Immediately): https://support.apple.com/guide/shortcuts/create-a-new-personal-automation-apdfbdbd7123/ios

## On-device checks to run once (not web-verifiable)
1. Whether your iOS version lets you pre-authorize "Remove Reminders" (unattended deletes) — otherwise deletes are foreground-only.
2. "Edit Reminder" leaving unset fields (notes/alarms/completion) untouched — test with a reminder carrying all three.
3. "Format Date" parsing the feed's `YYYY-MM-DD` string directly — may need a "Date" action round-trip.
4. Whether "Get Contents of URL" surfaces an HTTP status code on your build — Step 56's `id`-presence check is the fallback.
