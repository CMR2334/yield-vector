# Reminders sync — Apple Shortcut setup

This doc walks you through building a single Apple Shortcut + a Personal
Automation that keeps a "Yield Vector" Reminders list in sync with the
planner's feed. The Shortcut is the **merge** version: it preserves notes,
alarms, and completion status you add manually; the planner only owns the
title and due date.

You build this once on your iPhone (~15 minutes). After that, it runs in
the background daily and your Mac picks up the synced reminders via
iCloud.

---

## Prerequisites

1. **Cloud sync configured in Yield Vector.** Settings → Cloud sync →
   ensure a Gist ID + GitHub PAT (scope: `gist`) are saved. Confirm by
   tapping "Push now" — should toast "Pushed to cloud."
2. **Your Gist's raw URL.** From any browser:
   - Go to `https://gist.github.com/<you>/<gist-id>`
   - Click the **Raw** button on the file `capital-planner.json`
   - Copy that URL — it looks like
     `https://gist.githubusercontent.com/<you>/<gist-id>/raw/.../capital-planner.json`
   - The `/raw/.../` part includes a per-revision hash. **Drop the hash**
     — keep the URL up through `/raw/capital-planner.json`. That gives you
     the always-latest raw URL.
   - Final shape: `https://gist.githubusercontent.com/<you>/<gist-id>/raw/capital-planner.json`
3. **A Reminders list named "Yield Vector"** — create it in Reminders.app
   if it doesn't exist (any color). The Shortcut reads/writes only this
   list; it never touches your other reminders.
4. **The PAT, again.** If your Gist is private, the Shortcut needs the
   same PAT the app uses to read it. You'll paste it once into the
   Shortcut. If your Gist is public, skip this — the raw URL works
   without auth.

---

## The Shortcut: "Yield Vector Sync"

Open the **Shortcuts** app → tap **+** in the top-right → name it
**Yield Vector Sync**. The actions below go in this order. For each one,
tap the **+ Add Action** button at the bottom and search for the action
name in italics.

> Throughout: tap a variable bubble to rename it. The variable names below
> match what the next action expects.

### 1. Fetch the Gist content

- *Get Contents of URL*
  - **URL**: paste the raw URL from prerequisite 2.
  - Tap **Show More**:
    - **Method**: GET
    - **Headers**: add one header
      - Key: `Authorization`
      - Value: `token YOUR_GITHUB_PAT_HERE`
      - *(skip this header if your Gist is public)*

### 2. Parse the JSON and pull the feed array

- *Get Dictionary from Input*
  - Input is the previous "Contents of URL"
  - Renames to: `State`
- *Get Dictionary Value*
  - Get **Value** for **`_feed`** in `State`
  - Renames to: `Feed`
- *Get Dictionary Value*
  - Get **Value** for **`items`** in `Feed`
  - Renames to: `FeedItems`

### 3. Snapshot existing reminders for matching

- *Find Reminders where*
  - **List** is **Yield Vector**
  - **All** of the conditions are satisfied: leave empty (matches everything in list)
  - Renames to: `ExistingReminders`
- *Repeat with Each* `ExistingReminders`
  - Inside the loop:
    - *Get Details of Reminders* → **URL** of *Repeat Item* → name it `ExistingURL`
    - *If* `ExistingURL` **contains** `https://yieldvector.local/id/`
      - *Add to Variable* `ExistingByURL` → value is the *Repeat Item*
      - (this gives you a list of all planner-managed reminders)

The pattern: each reminder this Shortcut creates writes
`https://yieldvector.local/id/<feed-id>` into the reminder's URL field.
That URL is invisible in the standard Reminders UI but is what the
Shortcut uses to identify "this reminder corresponds to that feed item."

### 4. For each item in the feed, upsert a reminder

- *Repeat with Each* `FeedItems`
  - Inside the loop:
    - *Get Dictionary Value* → **id** in *Repeat Item* → `ItemID`
    - *Get Dictionary Value* → **title** in *Repeat Item* → `ItemTitle`
    - *Get Dictionary Value* → **dueDate** in *Repeat Item* → `ItemDueRaw`
    - *Get Dictionary Value* → **notes** in *Repeat Item* → `ItemNotes`
    - *Get Dictionary Value* → **kind** in *Repeat Item* → `ItemKind`
    - *Format Date* (or *Date* action with format ISO) on `ItemDueRaw` → `ItemDue`
    - *Text*: build expected URL → `https://yieldvector.local/id/[ItemID]` → `ExpectedURL`
    - *Filter Files* (or *Filter Reminders*) — filter `ExistingReminders` where
      **URL** is `ExpectedURL` → `Match`
    - *If* `Match` has **any** items
      - **Update** the matched reminder:
        - *Edit Reminder* (or use the Reminders app actions in iOS 17+)
        - Set Title → `ItemTitle`
        - Set Due Date → `ItemDue`
        - **Do NOT** touch Notes, Alarms, Completion, List
    - *Otherwise*
      - **Create** a new reminder:
        - *Add New Reminder*
          - **List**: Yield Vector
          - **Title**: `ItemTitle`
          - **Notes**: `ItemNotes` (only on first create — never overwritten later)
          - **Due Date**: `ItemDue`
          - **URL**: `ExpectedURL`
          - **Alert**: 9:00 AM on the due date (default behavior of date+time on iOS)

### 5. Delete reminders for items that left the feed

- *Repeat with Each* `ExistingByURL`
  - Inside the loop:
    - *Get Details of Reminders* → URL → `ExistingURL`
    - *Replace Text* in `ExistingURL`: replace `https://yieldvector.local/id/`
      with empty → `ExistingID`
    - Build a list of all `ItemID` from the feed (do this *before* the
      delete loop, in step 4): keep a parallel variable `FeedIDs`.
    - *If* `FeedIDs` **does not contain** `ExistingID`
      - *Remove Reminder* (the *Repeat Item*)
      - This deletes a reminder whose feed entry was removed (offer
        deleted, status changed to completed/skipped, etc.)

### 6. Save and test

Tap **Done** in the top-right. Run the Shortcut once manually:
- Tap the Shortcut tile → first run prompts for permissions:
  - "Allow Yield Vector Sync to access reminders" → Allow
  - "Allow Yield Vector Sync to access example.com" (the Gist host) → Allow
- Open Reminders.app → "Yield Vector" list should now have one reminder
  per upcoming action.

---

## The Personal Automation: daily 6:00 AM

Same Shortcuts app → bottom tab **Automation** → **+** → **Create
Personal Automation** →

1. Trigger: **Time of Day**
   - Time of Day: 6:00 AM
   - Repeat: Daily
   - Tap **Next**
2. Add Action: **Run Shortcut**
   - Shortcut: `Yield Vector Sync`
   - Tap **Next**
3. **Run Immediately**: ON
   - **Notify When Run**: OFF (you don't need a notification each morning)
   - Tap **Done**

That's it. iOS will run the Shortcut every morning at 6, your iPhone
silently re-syncs the Reminders list, and via iCloud it appears on every
device signed into the same Apple ID.

---

## Behavior reference

| Field on a Reminder | Source | What happens on next sync |
|---|---|---|
| Title | Planner | Overwritten with current planner title |
| Due date | Planner | Overwritten if changed in planner |
| URL | Shortcut | Used as the merge key; not user-editable |
| Notes | You | **Preserved** — never overwritten after creation |
| Alarms | You | **Preserved** |
| Completed checkbox | You | **Preserved** — Shortcut does not un-check |
| List assignment | Shortcut creates in "Yield Vector"; you can move | Preserved if moved |

If a reminder corresponds to an offer that was **deleted from the
planner** (or marked completed/skipped), the Shortcut deletes it on the
next run — your edits to that reminder go away with it. That matches
"the planner is the source of truth for *which* reminders exist; you own
the content of each one."

---

## Common variations / tweaks

**Stop deletes from happening.** If you'd rather keep stale reminders
around (e.g., for record-keeping), remove step 5 entirely. Reminders that
no longer correspond to a feed entry will simply not be updated.

**Filter to a subset.** Want only deposit deadlines, not every action
type? Add a check at the top of step 4's loop:
- *If* `ItemKind` **is** `deposit-deadline` — and only proceed inside.

**Different alarm time.** Edit step 4's "Due Date" — instead of `ItemDue`
(which is 9:00 AM), build a new date that's same day but a different time.

**Multiple lists.** Route `kind` to different lists:
- offer-expires → "Bonus Offers"
- deposit-deadline → "Funding Deadlines"
- withdrawal → "Money Available"
- etc.
Just add an *If* before each *Add New Reminder* and set the **List** based
on `ItemKind`.

---

## Troubleshooting

**"My Shortcut runs but no reminders appear."** First run: did you grant
Reminders permission? Settings → Privacy → Reminders → Shortcuts: ON.

**"Authentication failed fetching the URL."** Your PAT either expired or
doesn't have `gist` scope. Generate a new one at github.com/settings/tokens
and update the Authorization header in step 1.

**"Reminders are appearing in the wrong list."** The "Add New Reminder"
action defaults to your default Reminders list if you don't explicitly
set the **List** field. Re-open step 4's *Add New Reminder* and ensure
**List** is set to **Yield Vector**.

**"It's adding duplicates each run."** The merge key is the URL field.
Open one of the duplicates → check whether it has
`https://yieldvector.local/id/...` set as its URL. If not, step 4's
*Update* branch isn't matching because the URL field wasn't written on
creation. Re-check that the create branch sets the URL.

**"The Personal Automation never runs."** iOS Personal Automations need
the device unlocked at the trigger time (post-iOS-17, this is now
optional — turn ON "Run Immediately" to bypass the confirmation). If you
toggled it OFF, you'll get a notification that you have to tap to confirm.

---

## What's in `_feed` (for reference)

Every push to the Gist now includes an `_feed` block at the top level of
the state JSON. Schema:

```json
{
  "schema": 1,
  "generatedAt": "2026-04-28T03:45:00.000Z",
  "horizonDays": 180,
  "items": [
    {
      "id": "yv-offer-abc123-deposit",
      "title": "Citi — Priority Checking — fund $50K",
      "dueDate": "2026-05-30T09:00:00",
      "kind": "deposit-deadline",
      "notes": "Deposit by this date to qualify for the $1.5K bonus."
    }
  ]
}
```

`id` is the merge key. `kind` enum: `offer-expires`, `deposit-deadline`,
`withdrawal`, `commitment-end`, `inflow`, `outflow`. Time component is
always `T09:00:00` local — change the Shortcut's Format Date action if
you want a different time.
