# HANDOFF — Yield Vector

Cross-session AI changelog. Sessions run across multiple Claude logins and
models; each entry records what the *previous* session shipped so *this*
session picks up without the user re-narrating.

**Session start:** read the Current state block below plus the top 2–3 log
entries, then proceed. **After each meaningful round of changes:** prepend a
new log entry (template at the bottom). Keep entries factual and short — file
paths, function names, the *why* behind non-obvious choices, and any "do not
redo" dead ends. Be proactive; the user won't remind you.

Durable facts (architecture, protocols, locked design values) belong in
[AGENTS.md](AGENTS.md), not here — log entries eventually get archived to
[HANDOFF_ARCHIVE.md](HANDOFF_ARCHIVE.md). Archive older rounds when this file
grows past ~8 entries, keeping the newest 3–4 live.

---

## Current state (as of 2026-07-02, Round 54)

- `index.html` ≈ 8,000 lines, single-file PWA. `APP_VERSION` = `2026.06.15`
  (shown in Settings → About & diagnostics; bump + tag `stable-YYYY-MM-DD` +
  CHANGELOG entry on each confirmed-good release).
- **Offer types:** `new-funds-held`, `direct-deposit`, `held-and-dd` ("Other"
  removed, R37). Held+DD models the held lump sum AND the DDs (R53); planned
  funding date is *required* for Held+DD, optional for new-funds-held.
- **Status model:** `accountStatus` (open/closed) + 9-value `subStatus`;
  legacy `offer.status` survives as a derived shadow — don't remove (R38).
- **Cloud sync:** GitHub Gist; restore-from-history modal + stale-push guard
  (`guardedManualPush`) protect against last-writer-wins overwrites (R47).
- **DD tooling:** custom `yv-date` picker on offer-modal date fields; DoC
  DD-method ranking from baked `dd-methods.json` (R39); global DD transfer
  timing model + dollar-days-weighted ROI (R37).
- **Diagnostics:** `logError`/`ErrCode` ring buffer, global error handlers,
  recovery panel — exists since R51; don't rebuild.
- **Chart/tooltip colors are LOCKED** — see AGENTS.md → "Locked design
  values" before touching any chart, legend, or tooltip hex.
- **Pending:** iOS Reminders Shortcut on-device build (SHORTCUT_SETUP.md);
  DoC URL ingestion (needs backend or client-side LLM); per-link DD
  success/recency (deferred — requires following thousands of DoC comment links).

---

## Log (newest first)

### 2026-07-02 — Session I (claude-fable-5)
**Round 54 — Docs restructure for token efficiency (no app code changes)**
- HANDOFF.md: condensed preamble, added the "Current state" block above,
  archived Rounds 50→35 to HANDOFF_ARCHIVE.md (file was 34 KB; sessions were
  re-reading long-superseded UI-fix rounds every start).
- R36's LOCKED tooltip/marker color recipe moved to AGENTS.md → "Locked
  design values" so it survives archiving; push-cadence rules (30-min flush,
  step-away flush) folded into AGENTS.md → Commit & Push Protocol.
- CLAUDE.md slimmed to Claude-specific config + pointers (it duplicated
  AGENTS.md's architecture, file map, and push protocol nearly verbatim).
- Keep the Current state block updated when a round changes anything it lists.

### 2026-06-23 — Session H (claude-opus-4-8)
**Round 53 — Held+DD: model the held lump sum (was only modeling the DDs)**
- BUG: a Held+DD offer's `requiredFundingAmount` (the held lump sum) never
  appeared on the hero chart / projection — `generateProjection` only tied
  up the DD amounts. The hold was also wrongly anchored to the DD date, and
  ROI ignored the lump sum (e.g. 476% on a $10K/$600 offer).
- Reframed Held+DD = "new-funds-held" held portion + qualifying DDs on top:
  - `lockStartDate(held-and-dd)` → reflected funding date (was last DD date);
    `withdrawalEligibleDate(held-and-dd)` → open/funded anchor + daysFunds-
    MustRemain (same as new-funds-held; was DD-date + days). Both achieved by
    removing the held-and-dd special-cases so they fall through to the held
    logic.
  - `generateProjection` held-and-dd: now applies the held lump sum
    (requiredFundingAmount, funding date → withdrawal) AND each DD (landing →
    withdrawal). Verified: $0 → $505 (after DD) → $10,505 (after lump sum) →
    $0 (after withdrawal).
  - `ddCapitalTime(held-and-dd)`: includes the lump sum's dollar-days, so
    "Days tied up" + "Annualized" are realistic (32.6% vs 476.6%).
  - Hero chart: emits the indigo "Initial funding" marker for held-and-dd
    (the lump sum) in addition to the teal DD markers.
- Planned funding date is now REQUIRED for Held+DD (label flips to "*" via
  `syncDdSectionUI`; `isOfferComplete`/`offerIssues` enforce it) — it drives
  the held deposit. Optional still for new-funds-held (falls back to signup).
- Reverted R52's card special-case (lockStartDate already returns the
  funding date for held-and-dd now, so the card shows it via plain `start`).

### 2026-06-23 — Session H (claude-opus-4-8)
**Round 52 — Held+DD card "Fund date" = funding date (not DD date)**
- On a Held+DD offer card, "Fund date" used `lockStartDate(o)`, which for
  `held-and-dd` anchors on the DD landing date — so it just duplicated the
  "DD 1" row. Per user: it should reflect the planned funding date (the held
  LUMP SUM deposit), which is distinct.
- Fix in `renderOfferCard` (the `.offer-dates` block); display-only.
  Superseded by R53, which made `lockStartDate` itself return the funding
  date for held-and-dd.

### 2026-06-15 — Session G (claude-opus-4-8)
**Round 51 — File-manager pass: versioning, error handling, doc realignment, repo hygiene**
- **Repo hygiene.** Pruned 6 orphaned git worktrees + 7 stale `claude/*`
  branches; `main` is the only branch.
- **In-app version stamp.** `APP_VERSION` (top of the `<script>` in
  `index.html`), shown in Settings → About & diagnostics. `package.json`
  bumped independently (semver dev-metadata, nothing consumes it).
- **Error handling + diagnostics.** Global `error`/`unhandledrejection`
  handlers + `logError`/`ErrCode` taxonomy + 25-entry localStorage ring
  buffer (`yv-diag-log-v1`); `render()`/`init()` wrapped →
  `renderErrorState()` recovery panel; Copy-diagnostics in Settings. Commit
  `9dc560f`; every path verified in preview.
- **Doc realignment.** De-duplicated the key-function table into AGENTS.md
  (single canonical source); revived CHANGELOG.md with milestone entries.
- **Do not redo.** Versioning/diagnostics/error-handling exist — to ship a
  good state, just bump `APP_VERSION` + tag `stable-YYYY-MM-DD` + add a
  CHANGELOG line.

---

> **Older rounds (50 → 1) are archived** in [HANDOFF_ARCHIVE.md](HANDOFF_ARCHIVE.md)
> to keep this log readable. Notable archived rounds: R36 locked tooltip colors
> (now in AGENTS.md), R38 status-model migration map, R39 date picker + DoC
> ranking, R47 sync restore-from-history.

---

## Entry template

```markdown
### YYYY-MM-DD — Session [letter] (model id)
**Round N — short title**
- Bullet 1: what changed, with file path or function name.
- Bullet 2: any non-obvious *why* (a constraint the user gave, a dead end
  to avoid).
- Bullet 3: pending follow-ups or open questions.
```

Keep entries under ~25 lines each. If a round is huge, summarize and link
to a commit hash. Update the Current state block if the round changes
anything it lists.
