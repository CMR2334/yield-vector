# Yield Vector — Claude Code Instructions

## Pre-Approved Access
Collin pre-approves all Bash, Read, Edit, Write, and computer-use actions for:
- All paths under /Users/collinrekowski/Automation/
- ~/Library/LaunchAgents/
- /tmp/
No need to request confirmation for these locations in any session.
See ../USER_PROFILE.md for full working preferences.



## Read first
**At the start of every session, read [HANDOFF.md](HANDOFF.md).** It is the
cross-session changelog — recent rounds describe what the previous session
(possibly run on a different Claude model: Opus 4.7, Opus 4.6, or Sonnet
4.6) just shipped. Skim the top 3–5 entries before doing any work.

After completing a meaningful round of changes, prepend a new entry to
HANDOFF.md following its template. Be proactive — the user shouldn't have
to remind you.

## Auto-push protocol (apply in every session)
The `auto-push.js` watcher is **not reliable** — it dies on terminal close,
laptop sleep, or logout. Don't depend on it. Instead, treat pushing as
**part of the agent's job**:

1. **Push at the end of every meaningful change.** If you've edited
   `index.html` and verified the JS parses, immediately run:
   ```bash
   cd /Users/collinrekowski/Automation/Churning && \
     git add index.html HANDOFF.md CLAUDE.md SHORTCUT_SETUP.md && \
     git commit -m "auto update" --allow-empty && \
     git push origin main
   ```
   You're working in a worktree branch — `cd` to the main path first so
   the commit lands on `main` (which is what GitHub Pages serves).

2. **Push at least every 30 minutes of active work**, even mid-session,
   so the user can verify changes on their iPhone/laptop without waiting
   for the session to end. If 30 minutes have passed since the last push
   and you've made any committable change, push.

3. **Push when conversation usage is getting close to the context limit**,
   even if 30 minutes haven't elapsed. The user pays for unpushed work
   if the session compacts or ends unexpectedly — flush early. Watch for:
   the system reminder warning about context, your own internal sense
   that the conversation is long, the conversation crossing a natural
   work boundary, or any tool result indicating compression is imminent.
   When in doubt, push.

4. **Push before the user might step away**, especially when the user
   says something like "I have to go," "concluding for the night," or
   asks how to refresh their devices — those are signals to flush all
   pending work to `main` immediately.

5. **Don't try to start `auto-push.js`** as a substitute. It's not
   reliable enough for the user's workflow.

Live URL: `https://CMR2334.github.io/yield-vector/` (rebuilt automatically
by GitHub Pages within 30–90s of every push to `main`).

## Project
Single-file PWA credit card bonus planner. All app code lives in `index.html` (~4500 lines, vanilla JS + CSS, no build step).

## Permissions
This project runs with `bypassPermissions` mode — all tool calls (Bash, Read, Edit, Write, etc.) are auto-approved without prompting. Configured in `.claude/settings.json`.

## Key File Locations
- `index.html` — entire app (HTML + CSS + JS)
- `auto-push.js` — file watcher that auto-commits and pushes to GitHub on save
- `package.json` — only dependency is `chokidar` (for the watcher)
- `.claude/settings.json` — project-level Claude Code config (committed)
- `.claude/settings.local.json` — personal overrides (gitignored)

## Architecture Notes
- `effectiveHorizonDays()` (~line 1961) — auto mode uses withdrawal-eligible dates only, +30 days
- `renderHeroChart()` (~line 3342) — chart with marker tooltips; mobile uses `position:fixed` for tooltip
- `runOptimizer()` (~line 2176) — feasibility requires `shortfallDays === 0 && belowBufferDays === 0`
- `renderTimeline()` (~line 2745) — "Today" label suppressed on data rows via CSS
- `setupPwa()` (~line 1542) — runtime-generated canvas icon, smooth diagonal gradient

## Auto-Push to GitHub Pages
- Repo: https://github.com/CMR2334/yield-vector
- Live URL: https://CMR2334.github.io/yield-vector/

```bash
node auto-push.js   # watches index.html, auto-commits + pushes on save
```
Requires: `gh auth login` done once, remote set to GitHub, GitHub Pages enabled on main/root.

## Shared Documentation
- User profile and preferences: /Users/collinrekowski/Automation/USER_PROFILE.md
- Workflow preferences: /Users/collinrekowski/Automation/PREFERENCES.md
- Automation workspace overview: /Users/collinrekowski/Automation/CONTEXT.md
