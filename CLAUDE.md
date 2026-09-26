# Yield Vector — Claude Code Instructions

Read [AGENTS.md](AGENTS.md) first. It holds the project rules, architecture, versioning,
session protocol and commit & push protocol; record durable technical facts there.

Claude-specific:
- Permissions: `.claude/settings.json` sets `defaultMode: "auto"`.
- Preview: `.claude/launch.json` (gitignored) serves the repo with `python3 -m http.server` on port 8765.
