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

## Current state (as of 2026-07-08, Round 70)

- **R70 (working-tree, uncommitted):** removed the Overview "At a glance" panel and added
  per-action completion on the Upcoming-actions list — a quiet done control per row,
  `state.action_done` map (+ requirement-row write-through), completed items linger greyed
  7 days then drop, feed excludes+tombstones completed actions (Shortcut auto-completes the
  reminder), and an app-side reverse channel that consumes an optional `yv-completions.json`
  Gist file (phone→app). Same round also: chart legends → tight 2-col grid; tier-picker ROI
  chips; and a **DoC URL-importer live-test batch** (Worker `title` fill + client slug fallback,
  clawback-critical hold-anchor fix "days X through day Y"→Y/opening, waiver colon+bullets append,
  capFirst-except-promo, tier-radio centering, card-foot link stacked below the Updated stamp).
  `APP_VERSION` → `2026.07.08e`. See the R70 log entry. **Owner action:** redeploy the Cloudflare
  Worker to unlock the higher-quality title fill (old worker still works via the slug fallback).
- `index.html` ≈ 13,000 lines, single-file PWA. `APP_VERSION` = `2026.07.08e`
  (shown in Settings → About & diagnostics; bump + tag `stable-YYYY-MM-DD` +
  CHANGELOG entry on each confirmed-good release). R56–R61 are all committed
  and deployed (R56 sync fix passed a 10-round Codex review before shipping;
  the per-round "DO NOT COMMIT" notes meant "coordinator commits after
  verification," not that work stays uncommitted). R62/R63/R64 are working-tree
  changes pending review before commit. No stable- tag yet — owner hasn't
  confirmed-good. Sync guard is bilateral once both devices run ≥ 2026.07.05
  (confirmed on the owner's phone via diagnostics).
- **Bonusflow run (R66, 2026-07-07):** the overnight orchestrated run (steps
  2–11 of run `2026-07-07-bonusflow`) shipped schema v2 + migration/backup,
  the requirements engine, the derived lifecycle pipeline, churnability, the
  DoC paste-import parser (+ gated v2 URL-import Worker scaffold), offer
  templates, freshness/sort UI, and an aesthetics sweep — all committed locally
  (`46c0c49`→`f336a2e`; baseline tag `checkpoint-2026-07-07-pre-bonusflow`).
  Step 11 (this entry) ran the end-to-end verification battery + docs + version
  bump; the one issue verification surfaced (inline card status-change didn't
  stamp `closed_date`) was fixed pre-push via a shared `reconcileClosedDate`
  helper. See the R66 log entry for the full feature list. **R67** then shortened
  the Overview churn "Upcoming" window to 60 days and added per-offer churn snooze
  (`churn_snoozed_until`, timed or indefinite) across the Overview section, the
  card line, and the feed (suppressed while snoozed) — owner requests; both R66
  and R67 are working-tree changes pending the planner's review/commit.
- **Parser-calibration run (R68, 2026-07-07):** calibrated R66's DoC
  `parseDocPost` against a real, independently-labeled **31-post gold corpus**
  (`docs/fixtures/doc-corpus/`) after the owner challenged whether the accuracy
  stats were fabricated. Shipped tier-aware parsing (`docScanTiers` → `tiers[]` +
  preview "select your tier" picker) and delta-aware stale-value demotion; field
  accuracy **73.4→84.9%**, high-confidence-wrong **26→2**, calibration
  un-inverted — all in `docs/fixtures/doc-corpus/verification-log.md` as **verbatim
  machine output** (reproducible; `testDocParserRegressions()` = 12 in-app pins).
  Steps 4a/4b are committed (`eedb027`, `0126e2a`); step 5 (this entry: corpus
  artifacts + docs + `APP_VERSION` 2026.07.08c) is working-tree pending the
  planner's review/commit.
- **Field-box vertical rhythm (R61):** `.field-box` `gap` 6px (was 2px),
  vertical padding 10px (was 12px) — box height is unchanged for single-line
  fields, but the label now visibly separates from its value instead of
  nearly touching it. Also fixed a real bug found during verification:
  `#offer-form .field label`'s `min-height:30px` bottom-pin rule (meant for
  labels OUTSIDE a box) was also winning inside `.field-box` in the offer/
  commitment/event modals, force-stretching every single-line in-box label
  there to 30px and inflating those boxes ~15px taller than Settings'
  otherwise-identical fields. Reset via `#offer-form .field-box label {
  min-height:0; display:block; align-items:normal; }` (~line 1672, right
  after the `#offer-form .field > .field-box { margin-top:auto; }`
  box-pinning rule). Don't reintroduce a `min-height`/`align-items:flex-end`
  on `.field-box label` without re-checking this interaction.
- **Display ↔ storage boundary (R62):** dates and money now have a
  DISPLAY form (dates `M-D-YYYY` no-leading-zero e.g. `7-6-2026`; money
  comma-grouped e.g. `25,000`) that exists ONLY in input `value`s and
  rendered strings. Storage/sync is unchanged — dates stay ISO
  `YYYY-MM-DD`, money stays a plain Number, in state/localStorage/Gist
  and every internal comparison. Four helpers (~line 4025) are the single
  conversion point: `formatDateDisplay`/`parseDateInput` and
  `formatMoneyInput`/`parseMoneyInput`. Every money read-site parses via
  `parseMoneyInput` and every `yv-date` read-site via `parseDateInput` —
  do NOT add a bare `Number(el.value)`/`parseFloat`/`dateEl.value` on a
  `data-money` or `.yv-date` field (a `"5,000"`→NaN or `"8-1-2026"`→state
  path is data corruption). Native `<input type="date">` fields
  (commitment start/end) are already ISO and are left browser-formatted.
- **Button-row layout (R60):** standalone multi-button action rows (Settings
  sync-actions row, Data row) use a new `.btn-grid` class
  (`grid-template-columns:repeat(auto-fit, minmax(140px,1fr))`) instead of
  `flex-wrap`, for equal-width buttons at every viewport — same pattern as
  `.dd-timing-row` (R58). New `.btn-outline-danger` class (transparent bg,
  `--danger` border+text) replaces the `.btn-ghost.btn-danger` combo on
  "Disconnect" so it gets a visible pill outline like its siblings. Modal
  footers and 2-button rows (diagnostics, error-state) were swept and
  intentionally left on flex — see R60 log entry for why.
- **Form styling (R57 + R58 + R61 tuning):** every text/number/date/select/
  textarea field uses the `.field-box` label-inside-container pattern;
  radio-groups, checkbox rows, and the color-picker are intentionally NOT
  boxed. DD entry rows (`renderDdRow`) use a slimmed bordered-input variant
  instead of the full box (own `padding:8px 10px`, does not share
  `.field-box`'s gap/padding rules). R58 tuned the typography hierarchy
  (group/box labels lighter + lighter weight via `--text-tertiary`; values
  regular-weight via new `--text-strong` token), fixed segmented-control
  vertical centering (`#offer-form .field .radio-group label` override), and
  gave the DD transfer-timing row a real equal-width grid (`.dd-timing-row`).
  R61 tuned the label/value gap + container padding and fixed the modal
  label-height bug above. See AGENTS.md-adjacent reasoning in the R57/R58/R61
  HANDOFF entries before changing input/label CSS again.
- **Offer types:** `new-funds-held`, `direct-deposit`, `held-and-dd` ("Other"
  removed, R37). Held+DD models the held lump sum AND the DDs (R53); planned
  funding date is *required* for Held+DD, optional for new-funds-held.
- **Sign-up date (R64):** `plannedSignupDate` is REQUIRED only when
  `accountStatus === 'open'` (`isOfferComplete`/`offerIssues`). A prospect/
  applied (closed) offer saves as a full non-draft offer WITHOUT a date — it
  emits no dated work items and ties up no projected capital (all date
  consumers are null-safe; no "Invalid Date"/"NaN"), but its expiry still
  shows. Don't re-add an unconditional signup-date requirement.
- **Status model:** `accountStatus` (open/closed) + 9-value `subStatus`;
  legacy `offer.status` survives as a derived shadow — don't remove (R38).
  User-facing label is **"Offer status"** (R64; identifiers stay `subStatus`).
  subStatus auto-drives accountStatus BOTH ways via `defaultAccountForSub`
  (R64): approved/on-track/met-waiting/earned/didnt-track → open;
  prospect/applied/denied/archived → closed. Wired in the modal `change`
  handler AND the inline change-status handler.
- **Debit requirement (R64):** `debitRequirement` = `{ required, count,
  withinDays, byDate, byDateLegacy }`. The deadline is a day-count from sign-up
  (`withinDays`), NOT an absolute date; derive via `debitDeadlineISO(offer)` =
  sign-up + withinDays (emits nothing when underivable). `byDate` is retired
  (kept `''` for payload shape); legacy absolute deadlines migrate on load
  (`migrateDebitRequirement`/`reconcileDebitWithinDays`) to `withinDays`,
  preserving the original in `byDateLegacy`. Feed/list/card all derive via
  `debitDeadlineISO`.
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
- **Reminder feed = contract v2 (R63):** ONE shared `buildReminderItems(state)`
  (~line 5293) is the sole source of every actionable date; `computeReminderFeed`
  (schema-2 machine feed), `computeUpcomingActions` (overview list, 90-day
  horizon, but past-due dropped) all consume it — they reconcile by
  construction: count = the isWork items due TODAY-or-later; list = builder
  items within [today, today+90]; BOTH drop past-due dates, so a committed
  offer past its funding date reads count 0 / list 0 (never 1 / 0). `_feed`
  is now `{schema:2, generatedAt, manifestVersion, feedStatus,
  lastGoodGeneratedAt, items, removed}`; `risk` deliberately omitted (later
  phase). Gates key on the MODERN `subStatus` fields, never the legacy
  `deriveLegacyStatus` shadow (which is why funding deadlines used to vanish
  on Approved — legacy maps approved→'funded'): offer-expires shows for ALL
  non-terminal offers INCLUDING scenario-excluded prospects (it bypasses
  `offerIsActiveForProjection` on purpose — scenario inclusion is capital
  modeling, not expiry visibility; the owner's live BMO is a prospect w/
  `includeInScenario:false` and must still surface its expiry); work items
  (deposit/dd/debit) only for committed (approved/on-track, met-waiting
  excluded); withdrawal while capital is live (approved/on-track/met-waiting).
  deposit-deadline emits for the fund-a-lump types only — NOT standard
  `direct-deposit` (its money movement IS the DDs) — gated as "not
  direct-deposit" so a legacy/seed offer with absent `offerType` (app-default
  new-funds-held) still emits it. Per-DD items are keyed `yv-<offerId>-dd-<ddId>`
  off a persisted per-DD `id` (minted at row creation, back-filled on load by
  `migrateDdIds`) — never array index; id stability assumes all devices run ≥
  this build (an OLD build editing DDs re-mints ids — accepted: both owner
  devices are current and no Shortcut consumer exists yet). Deletions/
  disappearances tombstone into `removed[]` (90-day fixed TTL;
  `state._feedEmitted` tracks prior ids). Feed computation on the push path
  routes through `computeFeedSafely` (logError + last-good reuse marked
  `feedStatus:'stale'`) — never a silent `try{}catch{}`. `deriveLegacyStatus`
  is UNCHANGED (R38 shadow stays). Don't re-introduce a legacy-status read in
  these functions or a bare feed try/catch.
- **Chart/tooltip colors are LOCKED** — see AGENTS.md → "Locked design
  values" before touching any chart, legend, or tooltip hex.
- **Pending:** iOS Reminders Shortcut on-device build (SHORTCUT_SETUP.md);
  DoC URL ingestion (needs backend or client-side LLM); per-link DD
  success/recency (deferred — requires following thousands of DoC comment links).

---

## Log (newest first)

### 2026-07-08 — Session (opus-4-8[1m], /orchestrate executor — action tracking)
**Round 70 — Remove "At a glance"; add per-action completion + feed/reverse-channel wiring; chart-legend 2-col grid; tier ROI chips; DoC URL-importer live-test fixes (title fill, hold anchor, waiver bullets, capFirst, tier-radio, card-foot); v2026.07.08e**
(Owner: the At-a-glance panel "doesn't seem fully necessary" — he wants to TRACK actions performed/pending, tick them done, ideally reactive to iOS Reminders completions, with completed items showing status instead of lingering as if unactioned. Single working-tree release; DO NOT COMMIT — pending the planner's review.)
- **[Investigation — At-a-glance consumers]** `computeActionsRequired` had EXACTLY ONE
  consumer: the At-a-glance "Actions required" cell (grep-confirmed — every other hit is
  its def or a doc comment). The other snap cells were inline `.filter().length` reads of
  `offers/commitments/events`, no shared helper. So removing the panel orphaned only
  `computeActionsRequired`; I removed it too and updated the builder's RECONCILIATION-
  INVARIANT comment. The prior **[P1] "past-dated work items inflate Actions required"**
  miscount is therefore **fully mooted** — nothing else counts work items (the current
  `it.dueDate < todayISO` guard had already fixed it in-place; now the surface is gone).
  Shared constants `WORKING_SUB_STATUSES`/`CONFIRMED_OFFER_STATUSES` are used elsewhere
  (buildReminderItems) and were left intact; `expectedBonusTotal` still feeds the
  "Selected bonuses" stat card, so its computation stayed.
- **[1] Removed the At-a-glance `<aside>`** + its entire `.snapshot-*`/`.snap*` CSS block
  (no orphan CSS) + the `.overview-aside` media rules. `.overview-main` (Upcoming actions)
  now spans the full 3-col grid — the owner's action surface gets the whole width.
- **[2] Per-action completion.** New root key `state.action_done = { [feedItemId]: doneISO }`
  (defaulted in `defaultState`; tolerant guard in `migrateOffersToSchemaV2`, templates-style).
  Each Upcoming-actions row on a **completable** kind (`ACTION_COMPLETABLE_KINDS`) gets a
  quiet circle control (`.action-check`, checklist idiom). **Semantics by kind:**
  `requirement-deadline` **writes through** to the requirement row's `done`/`done_date`
  (two-way — same source of truth as the offer-card checklist; reuses `toggleRequirementDone`),
  so it is NOT stored in `action_done`. Every other completable kind
  (deposit/dd-initiate/dd-window-end/debit/withdrawal/churn-eligible/expected-bonus-window/
  safe-to-close/offer-expires) toggles `action_done[id]`. Pure capital-flow rows
  (commitment-end/inflow/outflow) get **no** control (not "actions the owner performs").
  `ACTION_DONE_LINGER_DAYS = 7`: completed rows stay greyed/struck with "Done M-D-YYYY",
  sorted to the list bottom, then drop; id stability prevents resurrection.
- **[3] Feed integration (envelope FROZEN).** `buildReminderItems` now annotates every item
  with `done`/`doneDate` (requirement rows read their own flag — done rows are no longer
  skipped, they emit annotated; other kinds read `action_done`). `computeReminderFeed`
  filters `built → emitted = built.filter(!done)` for `items[]`, `liveIds`, and `_feedEmitted`,
  so a completed action leaves the live set and the **existing tombstone diff** retires it
  into `removed[]` — the iOS Shortcut's existing Section-F mark-complete loop then completes
  the reminder. Mirrors the requirement-done precedent exactly. **Byte-frozen when nothing is
  completed** (verified: fresh-seed feed item-id set unchanged; complete→tombstone→
  un-complete→resurrect cycle verified in-browser).
- **[4] Reverse channel — app side FULLY implemented (auth reality: the Shortcut ALREADY has
  write auth).** The build guide's P4 PAT (`gist` scope) + Section-G heartbeat PATCH prove the
  Shortcut can write the Gist; and the app's own Sync pull already fetches the whole Gist file
  list (`ghGet .../gists/<id>` → `data.files`), holding the same gist-id+PAT. So consuming a
  sibling `yv-completions.json` costs no new fetch and no new credential. New async
  `applyRemoteCompletions(state, files)` reads that file on pull (hooked at the tail of
  `Sync.safeSync`), applies `{id, completedAt}` entries newer than a high-water timestamp
  `state._completionsHwm` (idempotent; app never writes/prunes the file), routes req-ids to
  write-through and others to `action_done`, ignores unknown ids, and is a **no-op when the
  file is absent** (app behaves identically). On apply it `save()`s + pushes so the item
  tombstones. Guide gains an **optional Section I** (phone→app) with the file contract, the
  PAT reuse, and a security note; Section F notes app-side completions arrive as tombstones.
- **[5] Display-name strip (deferred item).** `renderActionRow` wraps the title in
  `displayOfferName(item.name)` (display-side only; feed payload untouched) so "…$600"
  suffixes drop from the list (verified: "BMO — Premier Checking", not "…$600").
- **[6] Chart legends → tight 2-column grid (owner correction of R69 Item D — "back to
  stacked but tighter").** `.chart-legend` (shared hero + timeline) goes from the R69
  flex-wrap row to a content-sized 2-col grid (`grid-template-columns: max-content
  max-content; justify-content: start`) so the columns sit adjacent (col 2 at ~131px), NOT
  the pre-R69 `1fr 1fr` half-card spread: hero 6 items → 2×3, timeline 4 items → 2×2.
  `column-gap 18px`/`row-gap 6px`; a `≤340px` media query collapses to 1 col as a pure
  ultra-narrow safety net (2 cols total ~250px, so they stay 2-up at 380px, verified both
  desktop 1280px and 380px, no overflow).
- **[7] Tier-picker annualized-return chips.** `_docRenderTierGroup` adds a muted
  `.doc-tier-roi` chip after each tier's bonus: `rate = bonus/threshold_min`, annualized by
  `365/lockDays`, `lockDays = tier.hold_days ?? offer-level daysFundsMustRemain` → "≈N%/yr";
  no hold anywhere → plain "N% ROI (no hold data)". Guarded (`threshold_min>0`,`lockDays>0`);
  compact `_docFmtPct` (int ≥10, one decimal below); render-only (parser untouched). Sanity
  on the BofA-modeled `06-tiered-ladder.html`: as-parsed it has no captured hold → chips read
  5% / 3.6% / 2% / 1.2% ROID; with the offer hold present (60d ≈ its days-31–90 window) they
  annualize to ≈30 / ≈22 / ≈12 / ≈7.3 %/yr — small tier ~4× the top, as expected. (The real
  BofA corpus post body isn't committed — copyright — so the synthetic fixture was the check.)
- **Gates:** `node --check` (extracted script) PASS; in-browser E2E on the owner's real
  state (deep-copied / snapshot-restored, sync unconfigured so local-only) — complete→feed
  excl+tombstone, un-complete→resurrect, byte-frozen baseline, linger today vs drop @8d,
  requirement write-through excludes from feed, reverse-channel apply+idempotent+absent-noop+
  req-routing+unknown-ignored, real delegated click persists `action_done`, greyed/struck
  render (opacity .6, line-through, green check), reload-survival, mobile 380px (grid
  `48px 190px 22px`, no h-overflow, control present on completable / absent on inflow),
  churn untouched, no console errors, At-a-glance fully gone. **[6]** legends computed
  `display:grid`, hero `113/111px` 2×3, timeline `78/88px` 2×2, col 2 at 131px at both 1280px
  and 380px, no overflow. **[7]** tier chips render the values above with no row overflow at
  380px; `testDocParserRegressions` 13/13; feed byte-identical (11 items / 0 removed / keys
  `id,kind,title,dueDate,notes`). Owner state restored to original 9811 bytes (`action_done`
  absent) after testing. `APP_VERSION` → 2026.07.08e.
- **DoC URL-importer live-test batch (still v2026.07.08e; owner deployed the Worker and hit
  real bugs).** Six items + a clawback-critical hold-anchor addendum. **[i1]** tier radio
  `align-items: center` (vertically centered vs the multi-line row body; verified centerOffset 0).
  **[i2]** waiver colon+bullets: `docBulletsAfterClause`/`docCapText` append a dropped bullet
  list ("… you must:" + `<ul>`) joined "; or ", cap ~260 — the owner's exact BofA waiver now
  captures all 3 conditions. **[i3]** `_docSetInput` capFirst on applied prose (`_docCapFirst`),
  EXCLUDING promo/URL/`<select>`-enum/machine tokens (promo `q3bus26` passes through). **[i4]**
  Worker gains additive `title` (`extractTitle`: og:title→`<title>`→`<h1>`, "- Doctor of Credit"
  stripped); client `docImportFetch` prepends `title` (or `_docSlugTitle(url)` at LOW conf for an
  OLD worker) when the body yields no bank/offer name, then adopts only the name fields. README
  changelog notes the redeploy. **[i5 + ADDENDUM — clawback]** the hold parser missed "days 31
  through **day** 90" and computed 60/funded (a ~30-day under-hold); now a day-span → `daysFundsMustRemain
  = Y` (through-day) + `lockStartsFrom='open date'`, matching corpus GOLD (`01.json` hold_days=90 =
  "total days from opening"). New `lockStartsFrom` `DOC_FIELD_MAP` entry; the tier ROI chip
  subtracts the deposit window for opening-anchored holds (90−30=60 → ≈30%/yr top). `plannedSignupDate`
  checked: it is the new-offer modal DEFAULT (`isoDate(addDays(TODAY,7))` → 7-15-2026), NOT written
  by the importer (absent from `DOC_FIELD_MAP`) — reported, not changed. **[i6]** "DoC ↗" link
  STACKS below the "Updated" stamp (`.offer-card-foot` column + `flex-end`; order `${stamp}${doc}`).
  Fixture 06 + `DOC_TEST_EXPECT['06']` (+harness copy) updated; `parser-loader` NEEDED list gained
  the 2 helpers.
- **Gates (importer batch):** `node --check` app + Worker PASS; Worker `extractTitle` unit 5/5;
  in-app `testDocParser` **67/67** (fixture 06 P12/F0) + `testDocParserRegressions` **18/18** (13+5);
  node harness (jsdom `--no-save`, not committed) fidelity **67/67** + regressions **18/18**; corpus
  score ≥84.9 **not runnable offline** (post bodies uncommitted, copyright) — but the change ALIGNS
  with gold (90/opening), so `daysFundsMustRemain` can only improve; capFirst/title/slug are outside
  `parseDocPost` (zero corpus effect). Preview E2E: [i1] radio center offset 0 (multi-line), [i2]
  waiver full 3-condition string, [i3] capFirst incl. promo passthrough, [i4] mock round-trip with
  title→bank+offer, without→slug bank at low-conf/unchecked, [i5] chips ≈30/22/12/7.3%/yr, [i6] foot
  column/flex-end/stamp-above-link. Feed byte-identical (11/0). 380px no overflow. git status scoped
  (index.html, cloudflare/{doc-import-worker.js,README.md}, docs/fixtures/{doc-samples/06,doc-corpus/harness/{fidelity-check,parser-loader}}.js, HANDOFF, CHANGELOG, SHORTCUT guide + 4 pre-existing + runs file).
- **Release-review fixes (1 P2 + 3 P3, all in the R70 new code; still v2026.07.08e).**
  **[P2]** `applyRemoteCompletions` dedup was a **lexicographic string compare** on
  `completedAt` — a malformed/far-future/offset value could lift the HWM above all real
  Z-timestamps and silently kill the channel, and backdated/offline-queued completions were
  dropped. Replaced the single HWM with a **bounded per-event ledger** (`_completionsApplied`,
  `id@epochMillis`, last 200): `Date.parse` epoch compare, NaN entries skipped + counted (a
  `console.warn` diag note, not an app error), each event applied once regardless of order,
  legacy `_completionsHwm` dropped on read; domain presence checks resist re-applying a locally
  un-done completion. **[P3-1]** `action_done` growth bounded — `computeReminderFeed` prunes keys
  not in the freshly BUILT id set (pre-exclusion, so done items' own ids stay) AND older than the
  90-day tombstone TTL (grace stops flicker-prune); orphaned-offer keys drop within one compute
  past TTL. **[P3-2]** reverse channel gates the `action_done` write on `ACTION_COMPLETABLE_KINDS`
  (kind from the built items by id) — a phone-completed commitment-end/inflow/outflow (or unknown)
  id is log-skipped, never suppressing its feed item. **[P3-3]** a BARE "days X through Y" (no
  opening-context in the sentence) no longer asserts `lockStartsFrom='open date'` at HIGH — opening
  cue → count=Y + open HIGH; bare span → count=Y HIGH but anchor LOW/default-unchecked (a bare span
  at the funded default over-holds, never under-holds). `testDocParserRegressions` gained a
  `wantConf` assertion + 2 bare-span pins (→ 20 pins). **Gates:** `node --check` app + Worker;
  harness fidelity 67/67 + regressions 20/20; reverse-channel unit passes hostile `completedAt`
  (malformed/far-future/offset/backdated) + non-completable + idempotency + un-do-resist +
  migration; P3-1 prune + P3-3 confidence verified; feed byte-identical (11/0); owner state
  untouched (9811 bytes). SHORTCUT guide Section I wording updated (per-event ledger, parseable
  `completedAt`, completability log-skip). git status still scoped (same file set).

### 2026-07-07 — Session (claude-opus-4-8, /orchestrate executor — owner UX batch)
**Round 69 — 13 owner UX items across the offer card, modal, overview & charts; v2026.07.08d**
(Two folded batches — items 1-6 below, then A-G. Single uncommitted release; version stays 2026.07.08d.)
- **[1] De-dupe requirement dates vs the legacy "Fund date."** `renderRequirementChecklist`
  now builds a `shownDates` set from the dates the card already prints ABOVE it —
  `lockStartDate` (Fund date), `withdrawalEligibleDate` (Withdrawal date), and each
  `directDepositEffectiveDate` (the `.offer-dds` block) — and a **derived** row whose
  computed deadline equals one of those drops its date suffix (row + done state still
  render). The legacy `.offer-dates` block keeps owner-preferred placement/format; the
  MODAL editing surface is untouched (keeps every "Due <date>"). Verified: BMO card shows
  the fund date exactly once; a synthetic offer with `daysAfter…Deposit=0` (deposit
  deadline == fund date) suppresses the checklist date, while a 30-day window still shows it.
- **[2] Clickable DoC link on the card.** New `offerDocLink(o)` renders a quiet "DoC ↗"
  (`--text-tertiary`, hover `--accent`) only when `offer.docUrl` is set — `target="_blank"
  rel="noopener"`, escapeAttr'd href, inline `stopPropagation`. Sits in a new
  `.offer-card-foot` shared right-aligned with the Updated stamp (wrapper omitted when both
  empty). Verified: click opens no modal, no bubble; absent when docUrl empty.
- **[3] More offer colors.** Appended 4 well-separated hues to `OFFER_COLOR_PALETTE`
  (12→16, order preserved): `green #16a34a`, `purple #9333ea`, `fuchsia #c026d3`,
  `magenta #ec4899` (label "Pink" — the `pink` key was already Cobalt). No brown, no
  near-duplicates; picker is data-driven so no other change needed.
- **[4] Tighten the "$"-to-digit gap (repeat request — finally landed).** `.field-box`/
  `.dd-row` prefix `margin-right` 4px→2px; base `.input-group .input` `padding-left`
  28px→24px. Measured (BMO modal): f-funding/f-bonus **4px→2px**, req-row amount **7.33px→3.33px**.
  No clipping/caret issues at desktop or 380px.
- **[5] Strip SUB amounts from displayed offer names.** New `displayOfferName()` strips a
  trailing `$N` (display-only) across **every user-visible name surface** — card subtitle,
  offers table, combo picker, Overview churn rows (`renderOverviewChurnSection`), hero-chart
  offer labels (`renderHeroChart`'s `displayName`), and the template picker row + delete/replace
  confirms. Stored `offerName` untouched, and **feed titles are left raw**: the shared
  `buildReminderItems` name builder (`nm`) stays raw so Shortcut matching / feed byte-identity
  hold — that is the one same-pattern helper deliberately NOT stripped (it feeds the feed, not a
  display; my first pass mislabeled it a churn helper and stripped it, then reverted). Import
  side: the DoC parser's offerName extraction strips trailing `$N` / `$X-$Y` / "up to $N" tails,
  with a new `testDocParserRegressions` pin (now 13/13). Verified: BMO stored
  `"Premier Checking $600"` → card/table/combo/churn/chart/template all render
  `"Premier Checking"`; feed still carries `"…$600"`.
- **[6] Requirements-row box alignment.** The modal's `.modal .input[type=number|date] {height:44px!important}`
  tap-target rule hit the req-row number inputs (no `.field-box` reset there), so the deadline "d"
  and count "×" boxes rendered 44px vs the 34px money box. Added a `.modal .req-row .input[type=…]`
  reset (34px, 6px vertical padding). Measured: deadline box **44px→34px**; every req-row control now 34px.
- **[A] Conditional "Closed date" field.** New `.yv-date` field by the status selects in the offer
  modal, shown iff `accountStatus==='closed' && !PRE_ACCOUNT_SUB_STATUSES.has(subStatus)` — the EXACT
  `reconcileClosedDate` stamp guard mirrored, so what's visible is what anchors churn. `refreshClosedDateField()`
  live-toggles it on status change (defaults today on a fresh flip-to-closed, still backdatable; clears the
  input when hidden so a stale date can't submit). `readOfferForm` reads `closed_date` BEFORE
  `reconcileClosedDate` runs, so a user value always wins (reconcile only fills a blank). Verified: backdate
  `2026-01-01` kept, blank→today stamped, `churnEligibleDate` computes `2026-07-01` from the backdate
  (null → needs-date state).
- **[B] Chart tooltip bank-only (repeat).** The hero "Available capital today" tooltip's per-offer rows now show
  BANK NAME ONLY — added `bankName: o.bankName` to the 4 offer markers and the tooltip renders
  `m.bankName || m.name || m.label` (events keep their name). Timeline tooltips were already bank-only
  (`r.label = o.bankName` on the row label + bar `title`). Verified: ambiguous-bank marker → tooltip "BMO".
- **[C] "Run again" on churn rows.** A quiet "Run again" button (sibling to Snooze) on eligible-now + upcoming
  rows → `churnRunAgain(id)` builds a seed via the exact template-Use pipeline
  (`templateToOffer(offerToTemplate(o))`) → `showOfferModal(null, seed)` with a `Re-run of <bank> — <stripped
  name>` notes line. Prior offer untouched; sibling structure means no row-nav bubble. Verified.
- **[D] Tighten chart-label gaps.** `.chart-legend` (shared by the hero AND timeline legends) went from a 2-col
  `1fr 1fr` grid (huge inter-column gap) to a `flex-wrap` row, `gap: 6px 14px` — comfortable adjacency,
  both charts consistent.
- **[E] Unified overview headers.** Removed the churn description line; the churn header now uses `.card-header`
  markup (like Upcoming actions), and `.overview-grid .card-header h2` is restyled to EXACTLY match the hero
  `.hero-label` (14px/600/uppercase/0.02em/`--text-tertiary`; 13px at mobile). Verified all three identical.
- **[F] Churn card = Upcoming-actions width.** Moved `renderOverviewChurnSection()` INTO `.overview-grid` with
  `grid-column: span 2` (matching `.overview-main`) so the two cards are same-width siblings (806px desktop,
  full-width ≤720/≤480). **Gotcha fixed:** the base `.churn-section{grid-column:span 2}` was declared AFTER the
  responsive `@media` overrides, so span-2 leaked into the mobile 1-col grid and spawned a phantom column
  (380px overflow); moved the base rule ABOVE the media queries so the overrides win in source order.
- **[G] Checklist checkbox alignment.** `.offer-req-item` `align-items: baseline → center` + dropped the
  `.offer-req-check` `margin-top:1px` — the checkbox now centers on its text line (measured offset 0).
- **Review fixes (1×P1 + 2×P2, index.html only):**
  - **[P1] Closed-date flap wiped backdates.** `refreshClosedDateField` used to CLEAR the input on hide and
    re-stamp today on re-show, so a Closed→Open→Closed toggle silently replaced a historical `closed_date`
    with today. Fixed by hiding via **`disabled` instead of clearing** — a disabled input is absent from
    FormData (stale date can't submit) but KEEPS its value, so the flap restores the backdate. Prefill
    precedence on an empty field: (1) the input's preserved value, (2) the offer's stored `closed_date`
    (`data-stored` attr), (3) today. Reopen→SAVE still clears: the disabled field is absent from FormData →
    `readOfferForm` sets `closed_date: dateIso(undefined) || null` → **null** (overrides the prior-offer spread,
    since `parseDateInput(undefined)===null`), and `reconcileClosedDate`'s close→open branch confirms the null.
    The `.yv-date` picker is delegation-based (`closest('.yv-date')`), so it still works once the field is
    re-enabled. Verified repro matrix: flap keeps `1-1-2026` (save→`2026-01-01`, churn→`2026-07-01`); fresh
    flip-to-closed still prefills today; reopen→save clears to null.
  - **[P2-1] docUrl scheme gate (XSS).** `offerDocLink` rendered any `docUrl` as an href and `escapeAttr`
    doesn't restrict schemes, so an imported `javascript:`/`data:` docUrl became a working XSS link. Now the
    link renders ONLY when `docUrl` matches `/^https?:\/\//i` (else nothing); a commented security invariant
    marks the guard. Verified: `javascript:`/`data:`/mixed-case → no link; http/https → link.
  - **[P2-2] Name-strip gaps.** `displayOfferName()` now also applied at: (a) `convertOfferToCommitment`
    `commitmentName` (build-side), (b) `renderCommitmentsTable` name cell (render-side, covers legacy stored
    names), (c) the capital-event "Linked offer" `<option>` labels — the Name autofill reads the option's
    `textContent`, so that one edit covers both the dropdown and the auto-filled event Name. Feed stays raw.
    Verified BMO: convert→commitment `"BMO — Premier Checking"`, all dropdown labels + autofill amount-free.
- **Gates (both batches):** `node --check` (extracted inline JS) clean; preview E2E each item + console clean;
  feed code path untouched (no diff hunk in `computeReminderFeed`/`buildReminderItems`) and, after removing
  the in-memory test-churnable offer, the feed returns to baseline (no `churn-eligible` delta); 380px full pass,
  no horizontal scroll. Test offers were in-memory only (never `App.update`d), so storage/feed are pristine.
- **Pending:** working-tree changes for the planner to review/commit (do not self-commit).

### 2026-07-07 — Session (claude-opus-4-8, /orchestrate — parser-calibration run)
**Round 68 — DoC parser calibrated against a real 31-post corpus; tier-aware parsing + tier picker; v2026.07.08c**

The overnight orchestrated run `2026-07-07-doc-parser-calibration` (planner fable,
executor opus, worker sonnet). R66's `parseDocPost` had shipped validated against
only 5 synthetic fixtures; the owner flagged two real failure classes — tiered
offers (BofA "up to $2,500" where the true ladder is in the body) and stale
values in living posts — and explicitly challenged whether our accuracy stats were
fabricated. This run built the evidence to answer that.

- **Corpus (do not re-harvest).** 31 real DoC posts (BofA tiered post + recent
  bank-account-bonus posts, nationwide- or WI-eligible only) live as **facts** in
  `docs/fixtures/doc-corpus/`: `manifest.json` (32 rows incl. the 1 body-confirmed
  exclude), `excluded.json`, `labels/gold/NN.json` (31 gold labels) +
  `_adjudication.md`, and `harness/` (the scoring scripts). **Post bodies are NOT
  committed (copyright)** — re-hydrate with `harness/fetch-posts.js` (reads the
  manifest) or Save-Page-As. A `.gitignore` makes an accidental `git add posts/` a
  no-op.
- **Gold labels = 3 independent labelers + adjudication.** 79.2% raw inter-rater
  agreement on 6 double-labeled posts (worst post 16 @ 50%); conventions resolved
  in `_adjudication.md` (tiered bonus = the max tier a careful churner reaches;
  stacked/affiliate totals unified; availability drift honored, e.g. Wings/BMO now
  nationwide despite stale title tags). Labels are fallible human reads — the
  honest-limits note is in the verification-log + corpus README.
- **Parser fixes (4a, commit `eedb027`).** `docScanTiers` (top-level `tiers[]` on
  10 posts, BofA ladder complete, glance "up to" forced low + `tiered` flag);
  `docDateSegments`+`docReconcileScalar` (newest-dated-segment-wins per FIELD,
  undated fine print keeps confidence); `docIsCardFundingLabel` (kills the #1 bug —
  "Credit card funding" glance row mis-read as funding, 11/11→0); keyed-phrase
  `docChurnAnchor`; year-in-date guard (kills "2026→$825"). Loader helper names
  are listed in `harness/parser-loader.js` `NEEDED[]` — **add new parser helpers
  there or the brace-match extraction misses them.**
- **Preview tier picker (4b, commit `0126e2a`).** ≥2 tiers → a radio "Select your
  tier" group (none pre-selected, nothing auto-applies); `_docEffectiveFields`
  resolves render+Apply; balance kind forces funding=threshold + keeps
  maintain-balance row; `dd_total` kind wires the legacy DD model via
  `_docWireDdModel`; user checkbox choices survive tier switches
  (`_docUserChecks`/`resolveChecked`). Non-tiered pastes render byte-identical.
- **Verbatim numbers (do-not-redo the residuals).** `verification-log.md` has the
  machine output: accuracy **73.4→84.9%**, recall **57.8→70.7%**, high-conf-wrong
  **26→2**, calibration un-inverted (high 96.7% > med 87.1%), fidelity 63/63,
  regressions 12/12, parity 55/55. The final is **84.9% not 85.4%**: three later
  same-segment/negation/segmentation fixes (from an adversarial Codex review)
  corrected behavior that posts **[06]/[16] had been passing by ACCIDENT of a bug**
  — recovering those 2 cells means reverting the correct fix, so the planner
  accepted 84.9% (correctness over the ≥85 vanity threshold; every dangerous metric
  held). **The two surviving high-conf-wrongs are intentional** and must not be
  "fixed" naively: **[05]** glance "Monthly fees: None" (unconditional) vs a body $5
  fee, and **[10]** a stale glance expiration vs a body app-window date — promoting
  body over glance here over-fits and breaks fixtures 06/28 (the over-fit guard).
- **Three Codex adjudications this run**, all reproduced + fixed: (1) reduction-verb
  bonus ("lowered to $250") must beat the `Math.max` extractor — fixture 07 had
  masked it via a different path; (2) DD negation-before-affirm ("Not required"); (3)
  glance heading = a segment boundary resuming the undated base (BofA glance was
  being swallowed into the oldest dated segment). Net −1 cell, on the record.
- **Future sessions:** the gold corpus + `verification-log.md` + `harness/` are the
  regression bed for any future `parseDocPost` change; `testDocParserRegressions()`
  (12 pins, in-app) is the fast in-browser check. jsdom is a **verify-time** tool
  (`npm i --no-save jsdom`), deliberately NOT a repo dependency.
- **This step (5):** persisted the artifacts + docs + `APP_VERSION`→`2026.07.08c`;
  backfilled the two stale CHANGELOG `_pending_` commit fields (churn→`6b101bd`,
  bonusflow→`46c0c49..c2aa49d` pushed as `7c06e5f..c2aa49d`). Planner commits/pushes
  after review — 4a/4b already committed; this step's files are working-tree.

### 2026-07-07 — Session (claude-opus-4-8, /orchestrate executor — churn tweaks)
**Round 67 — Churn window shortened + churnability snooze**

Two owner-requested changes on top of R66's churnability feature.
- **Churn window 90 → 60.** `CHURN_HORIZON_DAYS` (index.html ~line 5674) is now
  60 (owner: "Make the churnability window 60 days"). This governs ONLY the
  Overview "Upcoming" bucket; the feed's `CHURN_FEED_LOOKAHEAD_DAYS` was already
  60 and the 180-day past-grace constant is untouched.
- **Churn snooze** (owner: "snooze option … with option for snooze to be
  indefinite"). New per-offer `churn_snoozed_until: ISO | 'forever' | null`
  (default null) in `schemaV2Defaults()`. Snoozed = `'forever'` OR an ISO strictly
  after today (a lapsed timed snooze reads as unsnoozed — the comparison handles
  expiry, no cleanup migration). New pure `churnSnoozeActive(offer)` is the single
  reader for all three surfaces. **Deliberately NOT in `TEMPLATE_TERMS_KEYS`** —
  personal state must never travel into a template; the whitelist excludes it by
  construction (the harness asserts a real `offerToTemplate` strip omits it).
  - *Overview section:* snoozed offers drop out of both buckets; each visible row
    gets a subtle "Snooze" affordance (inline expanding menu, no modal: **30 days
    / 90 days / Indefinitely** → today+N ISO or `'forever'`); a bottom muted
    "N snoozed — show" reveal lists snoozed rows ("Snoozed until <M-D-YYYY>" /
    "Snoozed indefinitely") each with **Unsnooze**. Render gate is now ≥1 visible
    row OR ≥1 snoozed (reveal stays reachable); hidden only when neither.
  - *Card churn line:* while snoozed appends a muted one-line suffix — "eligible
    now — snoozed" / "eligible <date> — snoozed until <date>".
  - *Feed:* `churn-eligible` is suppressed while snoozed (disappear/reappear
    rides the existing `_feedEmitted`/`_feedRemoved` tombstones — snooze →
    `removed[]`, unsnooze/lapse → resurrects). Feed-contract comment +
    `docs/SHORTCUT_BUILD_GUIDE.md` Finding 9 note the suppression.
- Persistence rides the existing `App.update` save path (debounced Gist push).
  New onClick handlers: `churn-snooze-toggle`/`churn-reveal-toggle` (local DOM,
  no re-render, mirror `toggleTemplatePicker`) and `churn-snooze`/`churn-unsnooze`
  (App.update). `APP_VERSION` `2026.07.08a` → `2026.07.08b`.
- **Verification:** `node --check` clean; a 42/42 Node VM harness (snooze-state
  null/lapsed/future/'forever' × eligible-now/upcoming/none, template whitelist
  exclusion, horizon-60 boundary 59d shown/61d not); Preview scenarios all green.
  DO NOT COMMIT — planner reviews then commits.

### 2026-07-07 — Session (claude-opus-4-8, /orchestrate step 11 — verification + docs)
**Round 66 — Bonusflow run verification, documentation & version bump**

Final step of the overnight `2026-07-07-bonusflow` run (steps 2–10 shipped the
features locally, `46c0c49`→`f336a2e`; baseline tag
`checkpoint-2026-07-07-pre-bonusflow`). This step ran the full verification
battery, wrote the four doc updates, and bumped `APP_VERSION`
`2026.07.07b` → `2026.07.08a`. No feature code changed here; the only
`index.html` edit is the version constant (~line 2764).

- **What the run shipped** (verified this step): schema v2 + one-time migration
  (`migrateOffersToSchemaV2`, derives `requirements[]` from legacy fields,
  seeds v2 scalars, snapshots `yv-backup-pre-v2`, idempotent) + Settings restore
  button; the requirements engine (modal rows with per-type money/count inputs,
  forward+reverse write-through, card checklist with done-toggle + strikethrough
  + resort, `requirement-deadline` feed kind); the derived 4-stage lifecycle
  pipeline (`meeting→waiting→earned→closed`) with expected-bonus window +
  `safeToCloseDate` + `expected-bonus-window`/`safe-to-close` feed kinds and the
  "mark waiting" auto-suggest; churnability (`churnEligibleDate`, 3 anchors,
  clamp-safe month math, overview "Upcoming churn dates" section, `churn-eligible`
  feed kind); DoC paste import v1 (glance parser + preview/confirm, 5 fixtures);
  gated v2 URL-import Worker scaffold (`cloudflare/`, Settings-gated); offer
  templates (whitelist strip, searchable picker); freshness chips + 4-mode sort
  + updated stamp + monthly-fee detail; aesthetics sweep.
- **Verification results:** `node --check` on the extracted inline JS + on
  `cloudflare/doc-import-worker.js` both clean. Preview (`yield-vector-static`,
  4173): console clean on load + across all 5 views. Migration: legacy-shaped
  state → offers migrated, backup created, second reload byte-identical
  (double-migrate diff = 0), restore round-trips + re-migrates. Feed contract:
  envelope EXACTLY `{schema:2, generatedAt, manifestVersion, feedStatus,
  lastGoodGeneratedAt, items, removed}`, every item EXACTLY `{id,kind,title,
  dueDate,notes}`, manifestVersion strictly monotonic across 3 computes, kinds ⊆
  the 9 pre-run + 4 new, each new kind emits only under its documented condition,
  tombstones appear in `removed` (reason `superseded`) on trigger-removal and
  clear on re-trigger. `testDocParser` 44/44 across all 5 fixtures; E2E paste
  fixture 03 → preview → apply → save verified; garbage graceful; >200KB
  truncation notice present. Churn: 3 anchors + Jan-31/leap/Aug-31 month-end
  clamp all correct. Templates: both save entry points, dedupe confirm-replace,
  picker search (incl. no-match), Use→prospect→save, delete→affordance-hides,
  DoC-checkbox path; saved-template JSON carries ZERO personal keys. Cross-cutting:
  localStorage keys unchanged except the documented `yv-backup-pre-v2` (docWorker
  URL/secret ride inside the existing sync-config key, device-local); ZERO
  external network on load (only same-origin `dd-methods.json`); mobile 380px —
  every view + the offer modal, no horizontal scroll.
- **Fixed during verification (do-not-redo context):** the INLINE offer-card
  "Offer status" dropdown handler (`onChange` `change-status`, ~line 12359)
  originally set `subStatus` + `accountStatus` + `normalizeOfferStatus` but did
  NOT stamp/clear `closed_date` the way the modal save path does — so a
  card-dropdown close left `closed_date` null (undated "Account closed."
  caption; an `account_closed`-anchored churnable offer couldn't compute
  eligibility until re-saved via the modal). Fix shipped in this run: the
  stamp/clear logic was extracted into a shared `reconcileClosedDate(offer,
  priorAccountStatus)` helper (~line 5529) called by BOTH the modal save path
  (`readOfferForm`) and the inline handler — do not reintroduce per-path copies;
  any new status-mutation path must call the same helper. Verified live:
  dropdown close stamps today, dropdown reopen clears, modal path unchanged.

### 2026-07-06 — Session J continued (claude-fable-5, planner direct fix)
**Round 65 — Uppercase-label letterspacing normalized app-wide (owner re-report)**
- R62's tightening only hit `.hero-label` + `.timeline-row-label.axis`; the owner still saw wide labels because the rest of the uppercase micro-label family (`.stat-label`, `.offer-stat-label`, `.snapshot-title`, `.card-title`, optimizer/about/DD labels — 15 rules at 0.04–0.06em) kept their old spacing. All letter-spacing 0.04/0.05/0.06em → 0.02em (18 rules now uniform; negative heading spacings and `.diag-code` untouched; chart text is SVG-internal, unaffected). Verified at desktop width on Overview + Timeline. `APP_VERSION` → `2026.07.07b`.

### 2026-07-07 — Session (claude-opus-4-8, /orchestrate executor)
**Round 64 — Status-model & form changes: sign-up-date-when-open, subStatus auto-revert, "Offer status" rename, debit day-count, "sign up" wording (Phase 1b)**

Owner batch of five app changes + a docs refresh, kept coherent with Phase 1a
(shared `buildReminderItems`, feed v2, subStatus-keyed gates). Scope: `index.html`
+ `docs/SHORTCUT_BUILD_GUIDE.md`. No chart/tooltip/legend changes; Gist payload
additive. `APP_VERSION` 2026.07.07 → 2026.07.07a.

- **[1] Sign-up date required only when account is OPEN.** `isOfferComplete`/
  `offerIssues` (~line 4457/4485) now require `plannedSignupDate` iff
  `accountStatus === 'open'`. A prospect/applied (closed) offer is a full
  non-draft offer WITHOUT a date — it emits no dated work items and ties up no
  projected capital (projection loop already `continue`s on empty
  `lockStartDate`; swept every date consumer — projection, suggested-funding,
  chart markers, timeline, table, ROI, feed builder, upcoming list — all
  null-safe → no "Invalid Date"/"NaN"), but its expiry still surfaces. Other
  missing required fields still draft the offer.
- **[2] accountStatus auto-reverts to Closed** (mirror of the existing
  auto-open). Both the modal `change` handler (~line 7757) and the inline
  change-status handler (~line 8700) now set `accountStatus` via the shared
  `defaultAccountForSub(subStatus)` — open for the 5 in `SUBSTATUS_FLIPS_OPEN`
  (approved/on-track/met-waiting/earned/didnt-track), closed for the other 4
  (prospect/applied/denied/archived). Modal hint describes both directions.
- **[3] "Sub status" → "Offer status"** (modal label + hint, offers-table
  header, inline-select `title`). Identifiers (`subStatus`, ids) unchanged. The
  commitments-table "Status" column is a DIFFERENT field — left alone.
- **[4] Debit "Complete by" date → day-count.** `debitRequirement.byDate` date
  picker replaced by "Complete debits within X days of sign up"
  (`name="debitWithinDays"`, id `f-debit-within`), with a derived-deadline hint
  (`f-debit-deadline`) beneath once a sign-up date exists. New `debitDeadlineISO`
  (~line 4321, after `depositDeadline`) = sign-up + `withinDays`, literal
  calendar date. Migration on load: `migrateDebitRequirement` +
  `reconcileDebitWithinDays` (~line 2606, called next to `migrateDdIds` in
  `App.init` ~line 4162) convert legacy `byDate` → `withinDays =
  max(1, round(byDate − signup))`, stashing the original in `byDateLegacy`
  (never lost); no signup date → preserve `byDateLegacy`, derive `withinDays`
  lazily when a date appears. Feed/list/card debit-deadline derivation switched
  to `debitDeadlineISO` (emits nothing when underivable). `readOfferForm` reads
  `withinDays`, carries `byDateLegacy` forward on edit, retires `byDate` to `''`.
  US-Bank-style (count, no byDate) → new field empty, no deadline until filled.
- **[5] "signup" → "sign up"** in user-facing text ("Planned sign up date *",
  "Sign up date *", "Days after sign up to deposit", "Complete DDs within X days
  of sign up", "Complete debits within X days of sign up", "Sign up date
  required"). Code identifiers (`plannedSignupDate`, `f-signup`, etc.) unchanged.
  Comments left with prose "sign-up" (not user-facing).
- **[6] Docs — `docs/SHORTCUT_BUILD_GUIDE.md`.** Compatibility note rewritten:
  schema 2 is the LIVE feed (v2026.07.07), Section F tombstone deletes are live,
  only `risk` remains absent (skip steps 23/25 until it ships). Section F
  reworked: RECOMMENDED unattended path marks tombstoned reminders COMPLETE
  ("Edit Reminder" → Is Completed = true, no prompt, completed items leave the
  default view); actual "Remove Reminders" deletion demoted to optional manual
  **F′** cleanup (steps renumbered 44→57; Finding 5 + corrections table updated).
- **Follow-up fix + display-value sweep (coordinator-requested).** Fixed a
  latent R62 bug: `refreshFundingSuggest` (~line 7893) passed `#f-signup`'s
  M-D-YYYY DISPLAY value straight to `suggestedFundingDate` (expects ISO), so
  the "Latest safe funding" hint silently stopped live-updating after R62 added
  display formatting — now wrapped in `parseDateInput(...)`, null-safe, exactly
  like `refreshDebitDeadline`. SWEPT every `.value` read in the file for the
  same class (yv-date display → ISO-expecting fn, or money display → Number-
  expecting fn without `parseDateInput`/`parseMoneyInput`): line 7893 was the
  ONLY remaining offender. All other live/handler read sites already route
  correctly — `generateDdDatesFromRequirement` (`parseDate(parseDateInput(...))`
  + `parseMoneyInput`), `readDdRowsFromForm`, settings `onChange` (money →
  `parseMoneyInput`, else `type=number`), the event-modal live sign-flip
  (`parseMoneyInput`), the blur normalizer, and `reformatMoneyFieldLive` (pure
  display) — plus the two inline `onchange`s just set static label text. The
  `#f-days-deposit`/`#f-debit-within` fields are `type=number`, so their raw
  `.value` is correctly consumed as a number. [3] The `DatePicker.setValue`
  commit path (~line 3917) ALREADY dispatches `input`+`change` on the input, so
  picker selection drives both hints with no code change — verified live rather
  than assumed.
- **Verified:** `node --check` passes; locked hex counts identical to HEAD
  (9/4/9/9/1/4/1/1/1). Node VM harness on the real extracted functions: 36/36
  (9-value classification; undated-prospect complete-but-dateless vs undated-open
  incomplete; undated offer emits expiry-only, no malformed dates;
  `debitDeadlineISO` 7-13-2026 + 45 → 8-27-2026; feed debit-deadline 2026-08-27;
  byDate→withinDays migration incl. min-1 floor + idempotency + US-Bank empty).
  Live (Preview `yield-vector-static`, port 4173): "Offer status" label + both-
  directions hint; modal subStatus drives accountStatus live BOTH ways with the
  sign-up label following; debit day-count field present (old date field gone),
  derived hint "Complete by: Aug 27"; real create→save persists a dateless
  prospect as a full non-draft card (expiry shows, no NaN) contributing 0 to
  "Actions required" but present in the Upcoming list; edit→Approved + 8-1-2026
  stores ISO. Follow-up-fix re-verify: with signup TYPED as 7-13-2026 + 30 days
  the funding hint now shows "Latest safe funding: Aug 11" (was silently blank
  pre-fix); selecting 7-13-2026 via the DATE PICKER refreshes BOTH the funding
  ("Aug 11") and debit ("Complete by: Aug 27") hints. Zero console errors; owner
  state (7 offers, original `_lastModified`/`_dirtySince`) restored byte-for-byte.

### 2026-07-07 — Session (claude-opus-4-8, /orchestrate executor)
**Round 63 — Reminder-feed contract v2: one shared item-builder, coverage + gate fixes, tombstones (Phase 1a)**

Phase 1a of the reminders redesign (feed contract v2 + step-3 P1). Scope was
`index.html` plus doc updates; no chart/tooltip/legend changes; Gist payload
kept additively compatible (new fields on offers/DDs only).

- **One shared builder.** New `buildReminderItems(state)` (~line 5293) is the
  SOLE source of every actionable date. `computeReminderFeed`,
  `computeUpcomingActions`, and `computeActionsRequired` were all rewritten to
  consume it, so the machine feed, the overview list, and the headline count
  can never drift apart again. Reconciliation invariant (stated inline):
  count = the builder's `isWork` items regardless of horizon; list = every
  builder item within the 90-day horizon (the list keeps its horizon by
  design; the feed emits all future items, no horizon).
- **Feed contract v2.** `_feed` is now `{ schema:2, generatedAt,
  manifestVersion, feedStatus:'ok'|'stale'|'error', lastGoodGeneratedAt,
  items:[{id,kind,title,dueDate,notes}], removed:[{id,tombstonedAt,reason}] }`.
  `risk` deliberately OMITTED (later phase). `manifestVersion` is monotonic:
  `max(prev+1, minutes-since-epoch, sessionHWM+1)` where the session
  high-water mark (`_manifestHwm`, seeded on load from `_manifestVersion`)
  guarantees no regression even when restore-from-history swaps in an old
  snapshot — this was a real edge case the plain `max(prev+1, epochMin)`
  formula missed within a single minute; the HWM term fixes it.
- **Stable per-DD ids.** DD rows carry a persisted `id` minted at row
  creation (`readDdRowsFromForm`/`addDdRow`/`generateDdDatesFromRequirement`
  now thread it via a `data-dd-id` attribute) and back-filled on load by new
  `migrateDdIds` (called next to `normalizeOfferStatus` in `App.init`).
  Per-DD feed items key `yv-<offerId>-dd-<ddId>` — never array index.
- **Coverage** now emitted consistently by both feed and list: offer-expires,
  deposit-deadline (fund-a-lump types only — NOT standard `direct-deposit`),
  dd-initiate (one per future planned DD), dd-window-end (frequency mode →
  signup + periods×period incl. `2weeks`; count mode → last DD effective
  date), debit-deadline (from `debitRequirement.byDate`), withdrawal/
  lock-release, commitment-end, inflow/outflow (respecting `showInUpcoming`;
  recurring events surface their next instance).
- **Gate fix (step-3 P1).** Both surfaces key on the MODERN `subStatus`
  fields, not the legacy `deriveLegacyStatus` shadow. The legacy map sends
  approved→'funded', which hid funding deadlines the instant an account
  opened. New rule: offer-expires shows for ALL non-terminal offers,
  INCLUDING scenario-excluded prospects (see review fix 4 below); work items
  (deposit/dd/debit) emit only for committed offers (approved/on-track),
  met-waiting excluded (work done); withdrawal shows while capital is live
  (approved/on-track/met-waiting, so a met-waiting offer keeps its release
  date). Legacy-status reads are gone from these functions;
  `deriveLegacyStatus` itself is UNTOUCHED (R38 shadow stays elsewhere).
- **Count semantics (owner decision).** `computeActionsRequired` counts work
  items only for committed offers, and only those due TODAY-or-later (past-due
  drops — see review fix 1); prospects/applied contribute ZERO (their
  expiries still show in the list).
- **Tombstones.** Deleting an offer/commitment (or an item that permanently
  disappears) moves its id to `removed[]` with a `reason`
  (`offer-deleted`/`commitment-deleted`/`event-deleted`/`superseded`),
  retained a fixed 90-day TTL. `state._feedEmitted` (id→ownerId) tracks
  previously-emitted ids to detect disappearances; a tombstoned id that
  re-appears is resurrected (tombstone dropped). Ack-based retention is a
  later phase.
- **No silent feed failure.** The `try{}catch{}` around feed computation in
  `Sync.push` and `createGist` is replaced by `computeFeedSafely`, which logs
  via `ErrCode.RENDER` (ctx `'reminder-feed'`) and reuses the last good feed
  marked `feedStatus:'stale'` (or a minimal `'error'` envelope when there is
  no last-good) rather than shipping absent/stale silently.
- **Docs.** `SHORTCUT_SETUP.md` gets a deprecation banner pointing to the v2
  build guide; `APP_VERSION` 2026.07.06e → 2026.07.07.
- **Review fixes (independent adversarial pass, all applied + re-verified).**
  (1) `computeActionsRequired` dropped past-due work items — a committed offer
  past its funding date was count 1 / list 0; now 0 / 0. (2) deposit-deadline
  was spuriously emitted for standard `direct-deposit` offers (no lump sum);
  now gated to "not `direct-deposit`" — NB gated as NOT-direct-deposit, not an
  allow-list, because the seed/legacy offers carry an ABSENT `offerType` that
  the app treats as new-funds-held, and an allow-list wrongly dropped US
  Bank's deposit-deadline (caught by re-running the seed reconciliation). (3)
  `ddWindowEndDate` fell through to the month branch for the UI's `2weeks`
  option (signup 7-10 → wrong 10-10); added the biweekly branch → 8-21. (4)
  offer-expires now bypasses the `offerIsActiveForProjection` gate so a
  scenario-excluded prospect's expiry still shows (the owner's BMO is exactly
  this: prospect + `includeInScenario:false` + a near expiry that would
  otherwise vanish). This raised the sample-seed list from 6 → 10 rows.
- **Verified** via `node --check` (extracted script), a Node VM harness running
  the real functions against the sample seed + synthetic offers (14/14 fix
  assertions pass), and the live app (Preview MCP, port 4173): sample seed
  (TODAY 2026-07-06) renders Actions-required **1** vs Upcoming **10 rows**
  (2 pages of 6), reconciling (US Bank's deposit-deadline 2026-07-11 —
  formerly hidden by the legacy gate — is the one work item, present in both;
  the list now also shows the four previously-hidden excluded-prospect
  expiries PNC/Chase/BMO/HSBC + Citi's, Charles Schwab's 11-03 beyond the 90d
  horizon); `_feed` is schema 2 with correct kinds/ids and no `risk`; deleting
  US Bank tombstones its 2 ids as `offer-deleted`; a synthetic committed
  standard-DD offer emits DD items only (no deposit-deadline, count 2), a
  held-and-dd keeps its lump deposit-deadline, a biweekly window-end computes
  8-21, and prospect/met-waiting variants gate to expiry-only / withdrawal-only.
  Locked hex counts identical to HEAD.

### 2026-07-06 — Session (claude-opus-4-8, /orchestrate executor)
**Round 62 — Display formats for dates & money (M-D-YYYY + live thousands commas), tighter `$` prefix, un-abbreviated K in two spots, tightened uppercase-label letterspacing**

Owner batch of five display/UX items. HARD CONSTRAINT throughout: storage/sync
formats do NOT change — dates stay ISO `YYYY-MM-DD` and money stays a plain
Number in state/localStorage/Gist and every internal comparison; this is
display/input-UX only, funneled through shared helper pairs so a missed site
can't corrupt an offer.

- **New boundary helpers (~line 4025):** `formatDateDisplay(iso)` → `M-D-YYYY`
  no-leading-zero (`2026-07-06`→`7-6-2026`); `parseDateInput(str)` accepts
  `M-D-YYYY`, tolerates `M/D/YYYY` and a pasted ISO, and returns canonical ISO
  or `null` (rejects overflow dates like `13-40-2026` via a real-calendar-date
  check in `_isoFromYMD`); `formatMoneyInput(val)` → thousands-grouped display
  preserving in-progress decimals/trailing dot/leading `-` and safe to re-run
  on its own output; `parseMoneyInput(str)` strips `$`/commas/spaces → plain
  Number (empty → `null`, matching the existing `num('')===null` contract).
- **[1] Dates → `M-D-YYYY` everywhere a raw ISO was shown.** `yv-date` inputs
  (offer modal `#f-debit-by`/`#f-expires`/`#f-signup`/`#f-funded`, DD-row
  `plannedDate`) render via `formatDateDisplay`, placeholder `YYYY-MM-DD`→
  `M-D-YYYY`; fields are no longer `readonly` (`inputmode="numeric"`) so the
  picker still opens on tap AND typing/paste works. Added a capture-phase
  `blur` handler in `bindGlobalEvents` that re-parses a typed/pasted value and
  rewrites it in canonical `M-D-YYYY` (so `8/1/2026` or a pasted ISO become
  `8-1-2026`); unparseable input is left visible and every reader re-parses so
  state stays clean. `DatePicker.setValue`/`open`/`render` convert through the
  helpers. Already-humanized renders (card/timeline "Aug 11", axis "Jul 6 →
  Oct 11") and native `<input type="date">` are untouched; chart-internal date
  rendering untouched.
- **[2] Live thousands commas in ALL money inputs.** Every money field is now
  `type="text" inputmode="decimal" data-money` and renders stored values via
  `formatMoneyInput`. A single `onInput` branch (`reformatMoneyFieldLive`)
  reformats on each keystroke and restores the caret by counting significant
  digits (comma-insertion-stable). Swept EVERY read path to `parseMoneyInput`:
  `readOfferForm` (`money()`), settings `onChange` (currentLiquidCapital/
  minimumCashBuffer), `readDdRowsFromForm`, `generateDdDatesFromRequirement`
  (the funding-split divisor), `readCommitmentForm` (amount + expectedBonus),
  `readEventForm` (`applyCategorySign`), and the event-modal live sign-flip.
  Verified sweep: the only remaining `Number(el.value)` is the non-money
  branch of settings `onChange` (projectionHorizonDays / maxOptimizerCandidates,
  still `type=number`) — correct, not a money site.
- **[3] `$` prefix tie-to-value.** `.field-box .input-group .input-prefix` and
  the `.dd-row` slimmed variant: color `--text-tertiary`→`--text-strong`
  (`#374151`), gap kept snug at `margin-right:4px` (low end of the 4-6px
  target) so the symbol reads as part of the amount, not the label.
- **[4] Un-abbreviated K in exactly two spots.** Overview hero sub-line
  "Lowest" (`formatCompactCurrency`→`formatCurrency`, now `$125,000`) and the
  at-a-glance BONUS POOL card value (same swap). Card is NOT resized: a
  render-time length check adds `.snap-v-sm` (19px→16px) when the formatted
  string is ≥8 glyphs (6-digit dollar amounts and up) so a large value fits.
  Chart axis labels (`ylab` 200K), offer-card stat abbreviations ($25K
  FUNDING), timeline bar labels, and "Lowest projected" stat cards stay
  ABBREVIATED (all still `formatCompactCurrency`).
- **[5] Tightened uppercase-label letterspacing.** `.hero-label` ("AVAILABLE
  CAPITAL TODAY") 0.06em→0.02em (mobile override 0.04em→0.02em) and the
  Timeline `.timeline-row-label.axis` date-range row 0.05em→0.02em, so the
  spaced-out uppercase labels read cohesively. No chart-internal text changed.
- **Verified (Preview MCP `yield-vector-static`, port 4173, 375px + full
  create→save→reopen cycle):** typing `5000` in offer funding shows `5,000`
  live with correct caret; a full offer save stores `plannedSignupDate:
  "2026-08-01"` / `requiredFundingAmount: 5000` (plain Number, no comma) and
  reopens showing `8-1-2026` / `5,000`; typed `8/1/2026` and a pasted ISO both
  normalize to `M-D-YYYY` on blur; settings + DD-row money round-trip to plain
  Numbers; hero "Lowest $125,000 on Jul 13" and BONUS POOL full value fit at
  375px; hero + Timeline letterspacing measure 0.0200em. Zero console errors
  and zero diagnostics-ring entries across the whole cycle; test data cleaned
  up (owner state restored: 7 offers, liquid 200000, buffer 20000). `node
  --check` on the extracted inline script passes; locked chart/legend/tooltip
  hex counts (AGENTS.md) unchanged vs HEAD. 24 isolated helper unit tests pass.
  Also ran 24 standalone assertions on the four helpers (round-trips + overflow
  rejection). `APP_VERSION` → `2026.07.06e`.

### 2026-07-06 — Session O (claude-sonnet-5, /orchestrate worker)
**Round 61 — Field-box vertical rhythm: label/value gap + padding + a real modal label-height bug (owner-reported)**
- Owner feedback on the R57–R60 `.field-box` boxes: "It just looks awkward now
  with the box heights. They may be a bit big/tall but also think it's just
  that the label text is a bit too close to input vertically." Diagnosis
  (given in the task brief, confirmed correct by measurement): generous outer
  padding + tight label-to-value gap made the pair read cramped inside an
  oversized box.
- **Gap + padding (both ends of the diagnosis):** `.field-box` `gap` 2px → 6px;
  vertical padding 12px → 10px (horizontal 18px untouched). Net effect for
  single-line-label fields: box height is **unchanged** (the 4px padding cut
  exactly offsets the 4px gap gain — e.g. Settings "Current liquid capital"
  measured 68.59px both before and after) but the internal split moves from
  lopsided (13px above the label / 2px gap / 13.9px below the value — 6-7x
  more space around the pair than between its two halves) to balanced (11px /
  6px / 11.9px — ~1.8-2x, matching the requested ratio).
- **Found during verification — a real, separate bug, not just "nothing to
  fix":** measuring the Add-offer modal surfaced that its single-line-label
  boxes (Bank name, Bonus amount, Offer expires, etc.) were rendering at
  79-83px — well outside the 64-72px target — even after the gap/padding fix,
  while Settings' otherwise-identical single-line fields sat at 64-69px. Root
  cause: `#offer-form .field label` (R57, ~line 1504; `min-height:30px;
  display:flex; align-items:flex-end`) was written for the group-level label
  bottom-pin pattern (labels sitting OUTSIDE a box), but its selector also
  matches every label nested INSIDE a `.field-box` in that modal, and wins
  the cascade there (`#offer-form .field label` is ID+class+tag,
  `.field-box label` is only class+class) — so every single-line in-box
  label was being force-stretched to 30px instead of its natural ~15.6px,
  inflating the whole box by the difference. This is exactly the "verify
  nothing similar still forces extra height" check the task asked for; it
  surfaced a real hit, not a clean bill of health. Fixed with
  `#offer-form .field-box label { min-height:0; display:block;
  align-items:normal; }` placed directly after the existing
  `#offer-form .field > .field-box { margin-top:auto; }` box-pinning rule
  (~line 1671) — same file region, same "give .field-box its own reset"
  pattern already used for the analogous `.modal .field-box .input[type=
  "date"]` 44px override (~line 1817, itself an R57 fix). Two-line labels
  (e.g. "Funds must remain deposited through day * (from funded date)")
  were never affected by the 30px cap (their natural height already exceeds
  it) and still grow to fit their wrapped text without crowding the value.
- **Confirmed out of scope, left alone:** `.dd-row`'s slimmed input variant
  has its own `padding:8px 10px` and doesn't inherit `.field-box`'s `gap`/
  `padding`, so it wasn't touched. The native `<select>` uses `appearance:
  auto` (browser-drawn chevron, no custom `background-position` to
  recalculate), so it's structurally unaffected by the padding/gap change.
  Whole-box click-to-focus is unaffected by either change — every
  `.field-box` label keeps its native `<label for="...">` / `<input id=
  "...">` pairing, which neither edit touches; confirmed the pairing is
  still intact post-fix (e.g. `for="f-expires"` / `id="f-expires"`).
- **A note on repo state during this session:** partway through, `CLAUDE.md`
  changed on disk mid-task (external edit, not mine) — turned out to be part
  of a broader, coherent removal of the `agent-session.js` claim/release
  session-coordination protocol across `AGENTS.md`/`CLAUDE.md`/
  `.claude/settings.json`/`.codex/hooks.json` (the `docs/AI_COORDINATION.md`
  reference and the numbered claim/release steps are gone from both docs).
  Not something this round touched or reverted — out of scope for a
  CSS-spacing task — left as-is; `index.html`'s diff contains only the two
  rules above (confirmed via `git diff index.html` showing exactly the
  `gap`/`padding` change plus the one new label-reset rule, nothing else).
- `APP_VERSION` → `2026.07.06d`. Verified: `node --check` on the extracted
  inline script passes; locked chart/legend/tooltip hex count (AGENTS.md)
  unchanged (33, before and after). Visually verified via Preview MCP
  (`yield-vector-static`, port 4173) at 375px — Settings (Capital &
  projection fields) and the Add-offer modal (Bank name focused + unfocused,
  Bonus amount with a typed value, the two-line "Funds must remain..." field
  under Held+DD, a select, a date field) — and at desktop (1280px), both
  clean. Full before/after measurement table in the CHANGELOG entry.
  **DO NOT COMMIT per explicit task instruction** — working tree only, same
  as R57-R60.

### 2026-07-06 — Session N (claude-sonnet-5, /orchestrate worker)
**Round 60 — Button-row grid uniformity + offer-card height verification (owner-reported, mobile screenshots)**
- **[1] Button-row uniformity:** Settings sync-actions row (6 buttons: Save & test / Create new Gist / Pull now / Push now / Restore from history / Disconnect) and the Data row (4 buttons: Export JSON / Import JSON / Reset to sample data / Clear all data) used `display:flex; flex-wrap:wrap`, which let each button keep its own label-driven width and wrap into ragged, mismatched-width rows on phones. Both converted to a new shared `.btn-grid` class (`display:grid; grid-template-columns:repeat(auto-fit, minmax(140px,1fr))`) — the same auto-fit/minmax approach R58 already used for `.dd-timing-row` — giving equal-width, equal-height buttons at any viewport with no hardcoded breakpoint. "Disconnect" also swapped `.btn-ghost.btn-danger` (no border — sat visually misaligned beside its bordered `.btn-secondary` siblings, the owner's specific complaint) for a new `.btn-outline-danger` class (transparent bg, `--danger`-colored border + text) so it now participates as an outlined danger pill instead of a borderless link, without becoming solid red. Swept `.diag-actions` (Copy diagnostics/Clear log) and `.error-state-actions` (Reload/Copy diagnostics) — both are 2-button rows that fit comfortably side-by-side at 375px (verified by injecting a fake diag-log entry and screenshotting), so left unchanged. Modal footers (Delete | Cancel | Save changes, 3 instances) left unchanged per explicit owner sign-off in the task brief. `#sync-buttons`'s only JS dependency is `updateSyncButtonsLive()`'s `querySelectorAll('#sync-buttons [data-action=...]')` id-scoping — confirmed it doesn't touch the `style`/class attributes, so safe to convert.
- **[2] Offer-card height verification — verdict: card did NOT change.** Owner asked whether offer cards had picked up new blank space above the label during the R57/R58 form-restyle rounds. Extracted the pre-restyle build (`git show 0ae5ee3:index.html`) and diffed `.offer-card`, `.offer-card-header`, `.offer-name` CSS rule bodies byte-for-byte against the current build — **identical in all three**. Rendered both builds side-by-side at 375px (two `python3 -m http.server` instances, separate origins so localStorage sample-data seeding didn't cross-contaminate) on the Offers tab and the Planner tab (same `renderOfferCard()` function, confirmed only one render call site exists — `renderOfferCardWithActions()` is defined but dead/unused, out of scope) — pixel-identical layout, identical `.offer-card-header` height (41.5px) and `.offer-name` top-position (flush with the header's own top, zero internal gap) in both builds. The R58 suspects named in the task brief (`.field label`/`.field-label`, `#offer-form .field label`) don't apply — `renderOfferCard()`'s template uses none of those classes; grepped the full CSS diff between builds for anything touching `.offer-stat-label`/`.offer-stats`/`.offer-card*` and found zero matches. The only "space above the label" is the card's `padding-top: var(--space-5)` (20px) — the same shared token used by the hero card, stat cards, and every other card type in the app (6+ other rules reference it), not something oversized or leaked specifically onto offer cards. Per the task's own branch-e instructions, did not compact this: it's systemic/intentional card padding shared app-wide, not an isolated low-risk artifact, and touching it would ripple across every card's visual language — outside this task's spacing/alignment-only, non-restructuring scope. No code change for this half of the round; diagnosis + this note stand in for a fix.
- `APP_VERSION` → `2026.07.06c`. Verified: `node --check` on extracted script passes; locked chart/legend/tooltip hex counts (AGENTS.md) unchanged before/after; both button grids confirmed equal-width via computed `grid-template-columns` at 375px and 1280px (desktop screenshots were unreliable this session — a viewport/capture-timing glitch in the Preview tool unrelated to the HTML/CSS changes — cross-verified desktop via `preview_inspect` computed-style reads instead, e.g. 6×190.664px columns on the sync row at 1280px). **DO NOT COMMIT per explicit task instruction** — working tree only, same as R57–R59.

### 2026-07-06 — Session J continued (claude-fable-5, planner direct fix)
**Round 59 — About-grid version overflow on mobile (owner-reported)**
- `.about-grid` used `minmax(0, 1fr)` — all three cells forced onto one row at any width, shrinking below content width, so `v2026.07.06a` overflowed its box on phones. Fixed: `minmax(140px, 1fr)` (cells wrap to rows on narrow screens) + `min-width:0; overflow-wrap:anywhere` on `.about-value` as a guard for long values. Full version format kept (owner offered 2-digit year; layout fix chosen instead — version string is load-bearing for build verification). Verified at 375px. `APP_VERSION` → `2026.07.06b`.

### 2026-07-06 — Session M (claude-sonnet-5, /orchestrate worker)
**Round 58 — Typography hierarchy tuning, segmented-control centering, DD-timing uniformity (owner-requested)**
- Three refinements to R57's form styling, all owner-requested with item 1's
  exact tuning delegated to my judgment ("lightening slightly and ever so
  slightly less bold"). `APP_VERSION` → `2026.07.06a`.
- **Typography:** group labels + box labels both now `--text-tertiary`
  (were split between `--text-secondary`/`--text-tertiary` levels, box
  labels darker than group labels) at weight 500 (group labels were 600).
  Values (`.field-box` inputs + `.dd-row` slimmed variant) now weight 400
  (was 500) and a new `--text-strong` token (`#374151`, ~line 28) — no
  existing token sat between `--text` (#2a2e3d) and `--text-secondary`
  (#5b6374), so minted one rather than reusing `--text` (which stays the
  card-title/modal-title/stat-value heading tone, untouched).
- **Segmented-control centering:** root cause was `#offer-form .field label`
  (the R57 bottom-pin rule meant for the group-level label like "Offer
  type *") also matching every individual `.radio-group` segment label,
  its `align-items:flex-end` beating `.radio-group label`'s own
  `align-items:center` on specificity. Added `#offer-form .field
  .radio-group label { align-items:center; justify-content:center;
  min-height:40px; }` — fixes ALL segmented controls in the offer modal
  (Offer type, DD-requirement mode, Funded/Open date, Debit requirement),
  confirmed at 390px where "HELD + DD" (1-line) was visibly bottom-anchored
  against "NEW FUNDS HELD" (2-line) before the fix.
- **DD-timing row:** new `.dd-timing-row` class (~line 1206, near `.dd-row`)
  replaces the old per-item inline `max-width:130/150/140px` guesses with
  a real `grid-template-columns: repeat(auto-fit, minmax(132px, 1fr))` —
  identical widths by construction, collapses to fewer columns on narrow
  viewports instead of wrapping unevenly. 132px floor (not a rounder
  number) is deliberate: the base `.input-group.with-suffix .input`
  padding (28px left + 60px right) clips a 3-digit value below that;
  verified by forcing "999" into all three inputs at 320px width.
- **Scope respected:** did not touch the "inline DD-requirement count/
  frequency mini-controls" (`ddreq-count-n` etc.) — R57 deliberately left
  these unboxed/unlabeled, and they're neither `.field-box` nor `.dd-row`
  nor the DD-timing row, so they're out of item 1's stated scope and still
  read `--text`/inherited weight. Not a defect, a scope boundary.
- **Verification:** `node --check` on extracted inline script passes.
  Locked-hex counts (AGENTS.md) diffed before/after against HEAD — all 9
  unchanged. Visually verified via Preview MCP (global `yield-vector-static`
  launch config, port 4173 — this one resolves correctly against the repo
  root, unlike R57's session-local `yield-vector`/8765 config) at desktop
  (1280px) and mobile (390px, 320px): Settings (group labels/values,
  DD-timing row) and the Add/Edit Offer modal (box labels/values,
  offer-type + DD-req-mode + Funded/Open-date segmented controls) at both
  widths. Did not commit or push per explicit instruction.

### 2026-07-06 — Session L (claude-sonnet-5, /orchestrate worker)
**Round 57 — Input restyle: label-inside-container pattern**
- Restyled every text/number/date/select/textarea field to a fintech-style
  bordered container with the label moved INSIDE it (owner-provided
  reference). New `.field-box` wrapper class (`.field label`/`.field-hint`
  CSS block, ~line 1377) holds `label` + the control; uses the app's own
  `--card-soft`/`--border-soft`/`--radius-lg` tokens for the box and
  `--accent`/`--accent-soft` for `:focus-within` — NOT the reference's
  purple. Touched: Settings `#capital-grid` + Cloud sync fields
  (`renderSettings`/`renderSyncSection`), and every qualifying field in
  `showOfferModal`, `showCommitmentModal`, `showEventModal` (~line 6813+),
  including the advanced fields (DoC URL, Entity, Email, Notes).
- **Deliberately left unboxed** (per the design brief — "checkbox/radio/
  color-picker stays as-is"): all `.radio-group` fields (Offer type, Debit
  requirement, Lock-from, DD-req mode), the checkbox-row fields (Include in
  projection/scenario, Display on chart, etc.), the offer color-picker, the
  inline DD-requirement count/frequency mini-controls (no `<label for>`,
  just adjacent text like "Once per"/"for" — boxing would need invented
  labels), the DD-transfer-timing 3-input row (no per-control label), and
  `source-bank-input` (no label at all, just a placeholder).
- `renderDdRow`'s DD entry-table inputs got a SLIMMED variant instead
  (`.dd-row .input` CSS, ~line 1145) — compact rounded border, no
  label-in-box, since there's no per-row label to move (the group label
  "Planned direct deposits *" sits once above the whole list; boxing each
  row would repeat it N times).
- Modal blast-radius date/number height rule (`.modal .input[type=date]`
  etc., fixed 44px + 10px padding) fought the new borderless-inside-box
  look at equal CSS specificity — added a later, box-scoped override
  (`.modal .field-box .input[type=date]` etc.) right after it so the
  cascade resolves correctly; noted inline so a future edit to one doesn't
  silently desync from the other.
- **Verification:** extracted the inline `<script>` and ran `node --check`
  — passes; diffed the extracted script against a pre-edit copy and
  confirmed every changed line is inside an HTML template-literal (no
  `id`/`name`/`for` attributes changed, no JS logic touched). Locked
  chart/legend/tooltip hexes (AGENTS.md) untouched — grepped to confirm.
  **Could NOT complete the visual screenshot pass myself**: this session's
  Preview MCP (`preview_start`) resolves `.claude/launch.json` against the
  agent's home directory, not the repo root, so it couldn't find the
  project's existing `.claude/launch.json` (config name `yield-vector`,
  port 8765) — writing a new one at `~/.claude/` would be a persistent,
  out-of-scope change to the user's global config, so declined to do that
  unilaterally. Worked around by serving the repo directly via
  `python3 -m http.server 4173` and confirming via `curl` that the served
  HTML contains the expected `.field-box` markup/CSS.
- **Coordinator visual re-verify found ONE defect, now fixed:** the `$`
  prefix in `.input-group` fields overlapped the value's first digit once
  a value existed (Settings liquid capital/buffer, offer Bonus
  amount/Required funding, DD-row amount, commitment Amount/Expected
  bonus, event Amount). Root cause: the base `.input-group` mechanism
  absolutely-positions `.input-prefix` and relies on a padding-left guess
  on the input to clear it (original: 12px prefix inset + 28px padding =
  16px clearance); my R57 override shrank that to 16px padding while ALSO
  bumping the prefix font-size to 16px, leaving ~0px clearance. Fixed by
  making `.field-box .input-group` (and the `.dd-row` slimmed equivalent)
  a real flex row instead: prefix as a static in-flow item, input
  `flex:1` with no padding hack — overlap isn't possible by construction.
  Suffix fields (`with-suffix`, "days" etc.) were confirmed already
  correct and deliberately left on the original absolute-right mechanism
  — not touched. Also caught and fixed a second, related bug while in
  this code: the DD-row amount input sat inside `.input-group`, which
  already carried a border/background from the shared `.dd-row .input,
  .dd-row .input-group` rule, so the input needed its own
  `border:none;background:transparent` to avoid a doubled border (this
  one wasn't reported — an R57-introduced bug I found doing the sweep).
  Re-verified with a live preview server (serverId
  `979ac45d-f665-4509-8af4-247327fcc2f9`, port 4173): typed real values
  into all 8 prefix sites and screenshotted each — `$ 200000`, `$ 1500`,
  `$ 50000`, `$ 75000`, `$ 2500`, `$ 12345` all render with clean
  prefix/value separation, focus ring still uses `--accent`, suffix
  "days" fields still right-aligned correctly. Re-ran `node --check` and
  the locked-hex count check — both still clean.
- `APP_VERSION` bumped 2026.07.05 → 2026.07.06. NOT committed (working-tree
  only, per instruction) and NOT tagged — do that after final sign-off.

---

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
