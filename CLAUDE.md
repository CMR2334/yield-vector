# Yield Vector — Claude Code Instructions

Claude-specific config only. The canonical technical reference — architecture,
key-function map, offer types, versioning, error handling, **locked design
values**, and the commit & push protocol — is **[AGENTS.md](AGENTS.md)**. Read
it; don't restate it.

## Session start
1. Read [HANDOFF.md](HANDOFF.md): the Current state block + top 2–3 entries.
   Prepend a new entry after each meaningful round — be proactive.

## Permissions
`bypassPermissions` mode via `.claude/settings.json` — all tool calls
auto-approved. Collin additionally pre-approves every action under
`/Users/collinrekowski/Automation/`, `~/Library/LaunchAgents/`, and `/tmp/`.

## Push rules (details in AGENTS.md → Commit & Push Protocol)
- Descriptive imperative commit messages; push after every meaningful change,
  at least every 30 min, and immediately before the user steps away or the
  context window nears its limit.
- `auto-push.js` is unreliable (dies on sleep/terminal close) — never depend
  on it or start it as a substitute.
- From a Claude Code worktree, `cd` to the main repo path first — GitHub
  Pages serves `main` only. Quote the path (it contains a space):
  `cd "/Users/collinrekowski/Automation/Yield Vector"`.
- Live URL: https://CMR2334.github.io/yield-vector/ (rebuilds 30–90 s after push).

## Shared docs
`../docs/USER_PROFILE.md` (owner + working style) · `../docs/PREFERENCES.md`
(code/doc standards) · `../docs/CONTEXT.md` (workspace overview).
