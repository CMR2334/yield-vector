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

## Current state (as of 2026-07-05, Round 56)

- `index.html` ≈ 8,000 lines, single-file PWA. `APP_VERSION` = `2026.07.05`
  (shown in Settings → About & diagnostics; bump + tag `stable-YYYY-MM-DD` +
  CHANGELOG entry on each confirmed-good release). R56 is NOT yet tagged
  (Codex review pending; the fix is only bilateral once both devices refresh).
- **Offer types:** `new-funds-held`, `direct-deposit`, `held-and-dd` ("Other"
  removed, R37). Held+DD models the held lump sum AND the DDs (R53); planned
  funding date is *required* for Held+DD, optional for new-funds-held.
- **Status model:** `accountStatus` (open/closed) + 9-value `subStatus`;
  legacy `offer.status` survives as a derived shadow — don't remove (R38).
- **Cloud sync:** GitHub Gist; restore-from-history modal + a compare-and-swap
  `Sync.push` (lineage field `_baseRevision` = last-synced `history[0].version`;
  R56) protect against last-writer-wins overwrites — the auto-push path now
  declines + adopts when the cloud is genuinely newer. `guardedManualPush`
  keeps its confirm dialog but routes through the same `{force}` push (R47/R56).
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

### 2026-07-05 — Session K (claude-opus-4-8, /orchestrate executor)
**Round 56 — Sync compare-and-swap: stop stale-device data loss**
- ROOT CAUSE: `App.save` and `Sync.push` stamped `_lastModified = Date.now()`
  unconditionally, so a device on STALE data forged newness; the auto-push
  path (`App.save`→`schedulePush`→`Sync.push`, and safeSync's local-newer
  branch) had NO cloud check — only `guardedManualPush` peeked first. A stale
  desktop auto-push clobbered 2 offers added on mobile; mobile then pulled the
  loss (night of 2026-07-05).
- FIX: new lineage field `_baseRevision` on the state = the Gist
  `history[0].version` the local state was last pulled-from / pushed-as
  (persisted to localStorage + Gist payload). `Sync.push` is now ONE unified
  compare-and-swap with a `{force}` option: unless forced it GETs the gist
  first and, if the cloud head moved off `_baseRevision` OR our lineage is
  UNKNOWN while a real cloud state exists, it treats that as a CONFLICT —
  **timestamps get no vote** (a stale device that ran `App.save` has already
  re-stamped `_lastModified` newer, so a timestamp gate would wave the clobber
  through). Only a truly empty/fresh gist lets an unknown-base push proceed
  (R56 round 5 — the first-run stale-overwrite window: an old payload with no
  `_baseRevision` that auto-saved before startup sync seeded lineage). On a
  successful PATCH it reads the response's new `history[0].version` into
  `_baseRevision`. The precheck FAILS CLOSED: a failed cloud GET DEFERS (status
  'pending', dirty marker kept, `logError(E_SYNC_PUSH, 'cas-precheck-failed')`,
  next cycle retries) rather than falling back to an unguarded PATCH — a
  fail-open would bypass the guard exactly when the network is flaky (R56
  round 5, reversing the earlier fall-back-to-plain-push behavior).
- Conflict resolution keys off a `Sync.localDirty` flag, PERSISTED with the
  state as `_dirtySince` (ISO string, set in `App.save`; nulled by
  `Sync.markClean()` on every pull-adopt + successful PATCH; `localDirty`
  re-inits from `_dirtySince != null` in `App.init`, so unsynced edits survive
  a reload — a volatile-only flag would reset to false on reopen and the CAS
  would then silently adopt over saved-but-unpushed edits). `_dirtySince` rides
  in the payload but does NOT affect `_lastModified`/"who's newer"; a device
  adopting a cloud state nulls it for ITSELF in `markClean`. `App.save` takes a
  `{system:true}` option that stamps + schedules the push but does NOT mark
  dirty — used by the purely-automatic saves (`rollProjectionStartIfStale`, the
  fresh-device sample-data seed; R56 round 5). Without it a stale-but-CLEAN
  device whose date auto-rolled would look dirty on the KNOWN-lineage CAS and
  trip the conflict dialog. User/import/reset (non-system) saves keep the
  default dirty-marking. Conflict handling is factored into ONE shared resolver
  `Sync.resolveDirtyConflict(remote, side, {unknownLineage})` that BOTH the
  push-side CAS and the pull-side (safeSync) call, so the dialog text/semantics
  can never drift: NOT dirty → merely stale → adopt the other side silently +
  toast; dirty (both sides changed) → `confirm` (OK = adopt cloud / discard
  local edits = safe default; Cancel = keep local & overwrite cloud); can't
  ask — background (`document.hidden`) → DEFER: status 'pending', stays dirty,
  next foreground sync asks. The resolver returns `defer|adopt|keep-local`;
  each caller does its own mechanics (push falls through to PATCH on keep-local;
  pull calls `Sync.push({force:true})` on keep-local so the single shared dialog
  isn't shown twice). Deferred logs are side-specific:
  `E_SYNC_PUSH/'cas-conflict-deferred'` vs `E_SYNC_PULL/'pull-conflict-deferred'`.
  Never silently picks a side.
- UNIFIED FIRST-SYNC RULE (R56 round 8; supersedes the R6/R7 per-direction
  timestamp inferences — `_userModified` DELETED; `Sync.loadedModified` re-added
  in R9 for a narrower use, below). `Sync.resolveFirstSync({remote,cloudHead,
  side})` is called by BOTH `safeSync` and `push` BEFORE their normal
  (known-lineage) logic. While lineage is unknown (`!_baseRevision`), it
  silently adopts + seeds lineage when nothing can be lost — equal live
  `_lastModified`, OR (R9) `!localDirty && remoteMod === Sync.loadedModified`
  (the state we LOADED matched the cloud and only system stamps have bumped
  local since — e.g. the startup projection date-roll), OR a trivial local
  state (0 offers AND 0 commitments). An EXISTING DIVERGENT cloud → prompt ONCE
  via `resolveDirtyConflict(..., {unknownLineage:true})` which recommends Adopt
  ("First sync on this device's new version…"). Timestamps carry NO signal in
  this window — a divergent cloud is resolved by one prompt regardless of which
  side's stamp is newer (that's why the pull-side twin of the R6 hole existed:
  an old-payload device with local stamp OLDER than cloud would blind-adopt on
  the pull path). After any resolution (adopt seeds lineage; keep-local
  force-pushes and the PATCH seeds it) `!_baseRevision` becomes false and the
  rule never fires again. Explicit adopt actions (manual `Sync.pull` with its
  dirty warning, "Save & test", `restoreState`) bypass the rule and seed
  lineage directly. EXPECTED UX: at most ONE dialog per device on its first
  divergent sync after upgrading — none if the device was in sync when it
  upgraded (equal live OR loaded-equal timestamps) or had a trivial state.
- BOTH sync directions are now guarded. Push side: a stale/dirty device can't
  clobber a diverged cloud (R56 round 2–3). Pull side (R56 round 4): safeSync's
  remote-newer branch no longer BLIND-adopts when this device is dirty — it was
  the mirror hole, silently discarding the very unsynced edits `_dirtySince`
  exists to protect (e.g. a reload with edits, or a failed/deferred push). It
  now routes dirty conflicts through the same shared resolver.
- Helpers `revisionOf(gistData)` / `parseGistState(gistData)` added (module
  scope, above `ghGet`) and reused. All pull-adopt paths — `safeSync` (all
  branches, reusing its existing GET; the equal-timestamp `else` also seeds
  `_baseRevision` from that GET so the guard isn't silently disabled on the
  first run of this build), manual `Sync.pull`, `saveSyncConfigFromForm`
  ("Save & test") — set `_baseRevision` + `markClean()`. `Sync.createGist`
  seeds `_baseRevision` from the POST response (a new Gist starts with known
  lineage). Manual `Sync.pull` and "Save & test" are EXPLICIT adopt-the-cloud
  actions so they adopt unconditionally (like restore); manual pull now first
  WARNS via `confirm` if the device is dirty (don't silently discard). The
  fresh-device seed (`localModified === 0`) can't be dirty → left as-is.
  `restoreState` clears lineage then force-pushes so the restored state becomes
  the legit head (a stale device's later auto-push is then blocked).
  `force:true` is reachable ONLY after an explicit user overwrite/make-truth
  choice: (1) the push-side CAS overwrite fall-through, (2) the pull-side
  resolver's `keep-local` branch, (3) `restoreState`. `guardedManualPush` now
  just calls `Sync.push()` UNFORCED so the CAS decides (it previously did its
  own timestamp check + `force:true`, which a re-stamped stale device sailed
  straight through).
- Missing `_baseRevision` (old payloads / a device still on an old build) =
  unknown lineage → the UNIFIED FIRST-SYNC RULE above governs (silent adopt for
  same-state/trivial, one recommend-Adopt prompt for a divergent existing
  cloud, unguarded seed only against a truly empty/fresh gist). Never crashes.
  `APP_VERSION` → `2026.07.05`; CHANGELOG entry added.
- ACCEPTED RESIDUAL (do not chase): an upgraded device with a non-trivial
  divergent state may see exactly ONE recommend-Adopt prompt on its first sync
  (there is no reliable way to tell a merely-stale device from one with genuine
  unpushed pre-upgrade edits — the old build wrote no lineage/marker — so we ask
  once). Never a silent overwrite. After that first resolution lineage seeds and
  the rule never fires again.
- CAVEAT: the guard is only BILATERAL once BOTH devices refresh to
  v2026.07.05 (verify in Settings → About). Per-offer merge DEFERRED — needs
  per-offer timestamps (a whole-state CAS can't merge two devices' disjoint
  edits, only pick a winner). `node --check` on the extracted inline script
  passed. Codex reviewed in 9 rounds: R2 fixed blind-PATCH-on-re-stamp +
  equal-timestamp lineage seeding; R3 fixed `guardedManualPush` forcing past
  the CAS, `localDirty` not surviving reload (→ persisted `_dirtySince`), and
  `createGist` not seeding lineage; R4 fixed the mirror hole on the PULL side
  (safeSync blind-adopting over a dirty device) and factored conflict handling
  into the shared `resolveDirtyConflict`; R5 closed the unknown-lineage
  first-run overwrite window, made the precheck FAIL CLOSED on GET failure, and
  exempted automatic system saves (`{system:true}`) from dirty-marking; R6/R7
  attempted a per-direction legacy-timestamp inference for the upgrade window
  (with `_userModified`/`loadedModified`) — SUPERSEDED by R8, which replaced
  both with the single UNIFIED FIRST-SYNC RULE (`resolveFirstSync`, shared by
  safeSync + push) after finding the pull-side twin: an old-payload device with
  local stamp OLDER than cloud would blind-adopt on the pull path (timestamps
  carry no signal when lineage is unknown, so per-direction heuristics were
  removed entirely); R9 (SHIPPING) — three polish fixes: (a) re-added the
  `Sync.loadedModified` load-time snapshot and widened the first-sync equal-state
  exemption to `!localDirty && remoteMod === loadedModified` so a device that
  was in sync at load but system-date-rolled before its first sync silently
  seeds instead of getting a needless prompt; (b) the fail-closed precheck now
  distinguishes PERMANENT failures (HTTP 401/403/404 — expired/revoked PAT,
  deleted/wrong gist) → status 'error' + a "Push failed: HTTP <code>" toast on
  the manual path, from transient failures → keep 'pending' defer-and-retry
  (`ghGet`/`ghFetch` now attach `err.status`); (c) every equal-timestamp seed
  path also `markClean()`s (a PATCH that landed but lost its response left the
  device falsely dirty → bogus later prompts); R10 (SHIPPED) — two final fixes:
  (a) `_trivialLocalState()` now counts ALL user collections (offers +
  commitments + events + `settings.sourceBanks`) and returns false whenever
  `localDirty`, so a device holding only events/banks or a pending edit is
  never silently overwritten; (b) `Sync.push` scrubs `_dirtySince` from a
  shallow-copy WIRE payload (`{ ...App.state, _dirtySince: null }`) so an
  old-build device can't pull a foreign dirty marker and later offer to
  clobber newer cloud data — the LOCAL marker still clears only on PATCH
  success. All fixed above; shipping (no further review round).

### 2026-07-05 — Session J (claude-fable-5, /orchestrate multi-tier run)
**Round 55 — Full assessment archived to docs/assessments/2026-07-05/ (no app code changes)**
- Ran a 7-step orchestrated assessment (worker=Sonnet 5, executor=Opus 4.8, Codex cross-review at plan/design/report): DoC URL import feasibility, whole-tool critique, Reminders pipeline audit + from-first-principles redesign. Deliverables in `docs/assessments/2026-07-05/` (report.md = synthesis; step files = full analyses); run checkpoint in `.claude/orchestrator/runs/`.
- Verdicts to know: DoC import feasible (deterministic glance parser v1 → Cloudflare Worker + Sonnet 5 + snippet tripwire v2, validated on 25 posts incl. Collin's 18); three HIGH bugs in reminder surfacing — `debitRequirement.byDate` reaches neither `computeUpcomingActions` nor `computeReminderFeed`; per-DD dates never enter the feed; deposit-deadline item gated on legacy `applied|selected|prospect` while `deriveLegacyStatus` maps Approved→'funded' (reminder vanishes when funding is pending). `safeToCloseDate` (~:3560) is a dead stub. Reminders redesign ("one brain, three surfaces": feed contract v2 w/ tombstones + heartbeats + ICS calendar channel + minimal Shortcut) supersedes SHORTCUT_SETUP.md's single-channel vision — see step6 doc before building the legacy 20-stepper.
- Dead ends / do-not-redo: CalDAV push into modern Apple Reminders is impossible (post-iOS-13 silo — verified); JSON-LD/OpenGraph on DoC posts carry no offer fields; glance-list positional parsing breaks on real corpus (fuzzy label matching required — 8 amendments in step5 doc).
- In flight at entry-write time: sync data-loss incident diagnosis (2 offers added on mobile clobbered by stale desktop push, 2026-07-05 night) and a verified-action-name Shortcuts build guide.
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
