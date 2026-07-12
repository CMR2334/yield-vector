import { App } from './app-state.js';
import { TODAY, addDays, daysBetween, formatCompactCurrency, formatCurrency, formatDateDisplay, isoDate, nextEventInstance, parseDate, relativeDays } from './date-format-core.js';
import { ddWindowEndDate } from './dd-core.js';
import { CONFIRMED_OFFER_STATUSES, offerColorHex } from './migrations-catalogs.js';
import { CHURN_ANCHOR_LABELS, CHURN_FEED_LOOKAHEAD_DAYS, CHURN_FEED_PAST_GRACE_DAYS, churnEligibleDate, churnSnoozeActive, debitDeadlineISO, depositDeadline, expectedBonusWindow, lifecycleStage, pathState, safeToCloseDate, withdrawalEligibleDate } from './offer-model.js';
import { displayOfferName, requirementDeadlineISO, requirementDisplayLabel, requirementSummary } from './requirements-templates.js';
import { ErrCode, WORKING_SUB_STATUSES, logError } from './runtime-status.js';
import { escapeAttr, escapeHtml } from './ui-utils.js';
const WORK_ITEM_SUB_STATUSES = new Set(['approved', 'on-track']);

// Per-action completion (Upcoming-actions rows). A completed action lingers in
// the LIST greyed/struck with its "Done <date>" for this many days, then drops
// from the list (the FEED already tombstoned it on completion). It never
// resurrects unless the underlying date/fact changes materially — id stability
// guarantees that.
const ACTION_DONE_LINGER_DAYS = 7;
// The action kinds that carry a completion control. requirement-deadline writes
// through to its requirement row's done/done_date; the rest live in
// state.action_done. Pure capital-flow rows (commitment-end / inflow / outflow)
// are intentionally excluded — they are not "actions the owner performs".
const ACTION_COMPLETABLE_KINDS = new Set([
  'requirement-deadline', 'deposit-deadline', 'dd-initiate', 'dd-window-end',
  'debit-deadline', 'withdrawal', 'churn-eligible', 'expected-bonus-window',
  'safe-to-close', 'offer-expires'
]);

// ddWindowEndDate moved to the pure dd-core.js (single source of truth shared
// with the optimizer engine); imported above and used unchanged below.

// THE ONE SHARED ITEM BUILDER. Pure (no state mutation) so the render-time
// list/count callers can invoke it freely; the feed layers tombstones and
// manifestVersion on top.
// Normalize a date value to its YYYY-MM-DD prefix ONLY when it validates as an
// ISO date shape. Regex-only by design (matches the feed's original guard —
// deliberately NOT parseDate, which would accept/normalize looser inputs).
// Returns the 10-char date string, or null when the shape doesn't validate.
function isoDateOnly(v) {
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function buildReminderItems(state) {
  const items = [];
  const nm = (o) => `${o.bankName}${o.offerName ? ' — ' + o.offerName : ''}`;

  for (const o of state.offers || []) {
    if (!o.id) continue;
    // Terminal offers (marked done or dropped, incl. closed-and-done which
    // deriveLegacyStatus maps to 'completed') are out of every surface.
    if (o.status === 'completed' || o.status === 'skipped') continue;
    const name = nm(o);
    const color = offerColorHex(o);
    // Committed = account is being pursued and requirement WORK is still
    // open (approved/on-track). Keyed on the MODERN field, never the legacy
    // shadow. capitalLive additionally includes met-waiting: requirements
    // are done but funds are still locked, so the withdrawal/release date is
    // still worth surfacing (matches the pre-v2 legacy 'funded' behavior for
    // that informational item without re-reading the legacy shadow).
    const committed = WORK_ITEM_SUB_STATUSES.has(o.subStatus);
    const capitalLive = WORKING_SUB_STATUSES.has(o.subStatus);

    // offer-expires — informational and INTENTIONALLY NOT gated on
    // offerIsActiveForProjection: the owner wants a prospect's expiry visible
    // even when it's excluded from the capital scenario (his live BMO offer is
    // prospect + includeInScenario:false and would otherwise vanish). Scenario
    // inclusion governs capital modeling, not expiry visibility. Shows for any
    // non-terminal offer (terminal already skipped above) that isn't confirmed/
    // applied (once confirmed the deadline no longer matters). Work items and
    // withdrawal below keep the stricter committed/capital-live gates.
    if (o.offerExpirationDate && !CONFIRMED_OFFER_STATUSES.has(o.status)) {
      const due = isoDateOnly(o.offerExpirationDate);
      if (due) items.push({
        id: `yv-offer-${o.id}-expires`,
        ownerId: o.id, kind: 'offer-expires', dueDate: due, isWork: false,
        title: `${name} — offer expires`,
        notes: `Bonus ${formatCompactCurrency(o.signupBonusAmount)}; required funding ${formatCompactCurrency(o.requiredFundingAmount)}.`,
        listLabel: 'Offer expires', tag: 'warn', name,
        sub: `${formatCompactCurrency(o.signupBonusAmount)} bonus`,
        color, targetKind: 'offer', targetId: o.id
      });
    }

    // deposit-deadline (WORK) — the lump-sum funding a committed offer still
    // owes. Emits ONLY for committed offers (approved/on-track); prospects
    // and met-waiting do not. This is the step-3 P1 gate fix: keyed on the
    // modern field so it stays visible exactly when the account is open and
    // funding is pending (the legacy status hid it as 'funded'). Restricted to
    // the fund-a-lump types: only a STANDARD direct-deposit offer has NO lump
    // sum — its money movement IS the DDs, already covered by dd-initiate +
    // dd-window-end — so a "fund $X" item there is spurious. Everything else
    // (new-funds-held, held-and-dd, and legacy offers whose offerType is
    // absent/'other' — which the app defaults to new-funds-held) funds a lump,
    // so gate on "not standard direct-deposit" rather than an allow-list that
    // would wrongly drop the undefined-offerType legacy/seed case.
    const fundsLump = o.offerType !== 'direct-deposit';
    const dd = fundsLump ? depositDeadline(o) : null;
    if (dd && committed) {
      const due = isoDateOnly(dd);
      if (due) items.push({
        id: `yv-offer-${o.id}-deposit`,
        ownerId: o.id, kind: 'deposit-deadline', dueDate: due, isWork: true,
        title: `${name} — fund ${formatCompactCurrency(o.requiredFundingAmount)}`,
        notes: `Deposit by this date to qualify for the ${formatCompactCurrency(o.signupBonusAmount)} bonus.`,
        listLabel: 'Deposit deadline', tag: 'danger', name,
        sub: `Fund ${formatCompactCurrency(o.requiredFundingAmount)}`,
        color, targetKind: 'offer', targetId: o.id
      });
    }

    // dd-initiate (WORK) — one per planned DD with a future plannedDate.
    // Uses the persisted per-DD id (dd.id) minted at DD-row creation so
    // completion state stays glued to the right DD across insert/reorder.
    // EITHER/OR: emit DD reminders only when the DD path is active (logic='all'
    // DD-family → ddActive, unchanged; debit-path offer → no DD nag).
    if (committed && pathState(o).ddActive) {
      for (const dep of (o.directDeposits || [])) {
        if (!dep || !dep.id || !dep.plannedDate) continue;
        const due = isoDateOnly(dep.plannedDate);
        if (!due) continue;
        items.push({
          id: `yv-${o.id}-dd-${dep.id}`,
          ownerId: o.id, kind: 'dd-initiate', dueDate: due, isWork: true,
          title: `${name} — initiate DD ${formatCompactCurrency(dep.amount)}`,
          notes: `Start this direct deposit so it posts in time for the ${formatCompactCurrency(o.signupBonusAmount)} bonus.`,
          listLabel: 'Initiate DD', tag: 'danger', name,
          sub: `Initiate ${formatCompactCurrency(dep.amount)}`,
          color, targetKind: 'offer', targetId: o.id
        });
      }
      // dd-window-end — informational: the date all required DDs must be
      // done by (where derivable). Not a separate to-do beyond the DDs
      // themselves, so isWork:false.
      const winEnd = ddWindowEndDate(o);
      if (winEnd) {
        const due = isoDateOnly(winEnd);
        if (due) items.push({
          id: `yv-offer-${o.id}-dd-window`,
          ownerId: o.id, kind: 'dd-window-end', dueDate: due, isWork: false,
          title: `${name} — all DDs complete by`,
          notes: `All qualifying direct deposits must have posted by this date.`,
          listLabel: 'All DDs by', tag: 'warn', name,
          sub: 'All DDs complete', color, targetKind: 'offer', targetId: o.id
        });
      }
    }

    // debit-deadline (WORK) — qualifying debit-card purchases by a date.
    // Counts as debitRequirement.count work items. The deadline is now
    // DERIVED from sign-up + debitRequirement.withinDays (debitDeadlineISO),
    // so it emits nothing until a sign-up date AND a day-count both exist.
    // EITHER/OR: emit the debit reminder only when the debit path is active
    // (logic='all' → debitActive === debitRequirement.required, unchanged).
    const debitDue = (committed && pathState(o).debitActive) ? debitDeadlineISO(o) : '';
    if (debitDue) {
      const due = isoDateOnly(debitDue);
      if (due) {
        const cnt = Number(o.debitRequirement.count) || 0;
        items.push({
          id: `yv-offer-${o.id}-debit`,
          ownerId: o.id, kind: 'debit-deadline', dueDate: due, isWork: true,
          workCount: cnt > 0 ? cnt : 1,
          title: `${name} — ${cnt || 1} debit purchase${cnt === 1 ? '' : 's'}`,
          notes: `Make the required qualifying debit-card purchase${cnt === 1 ? '' : 's'} by this date.`,
          listLabel: 'Debit purchases', tag: 'danger', name,
          sub: `${cnt || 1} debit txn${cnt === 1 ? '' : 's'}`,
          color, targetKind: 'offer', targetId: o.id
        });
      }
    }

    // requirement-deadline (WORK, step 3) — one per USER-added requirement row
    // with a computable deadline. NO-DUPLICATE RULE: source:'derived' rows
    // mirror legacy fields (funding/DD/debit) that the blocks above already
    // emit deposit-deadline / dd-initiate / debit-deadline items for, so
    // deriving feed items from them too would double-book the same obligation.
    // Only source:'user' rows (e-statements, promo code, extra spend, …) have
    // no legacy equivalent and are the sole new emitters. Done rows emit
    // nothing (the obligation is met). Same committed gate as the other work
    // items so a prospect's requirements don't surface before the account is
    // pursued. Id `yv-offer-<offerId>-req-<rowId>` uses the STABLE row id from
    // step 2 (never an array index) so it participates in the _feedEmitted/
    // _feedRemoved tombstone mechanism automatically via computeReminderFeed.
    if (committed && Array.isArray(o.requirements)) {
      for (const r of o.requirements) {
        if (!r || r.source !== 'user' || !r.id) continue;
        // DONE rows are NO LONGER skipped — they emit ANNOTATED (done:true) so
        // the Upcoming-actions list can linger them greyed for a few days. The
        // machine feed still excludes done items (computeReminderFeed filters
        // on `done`), so a completed requirement tombstones exactly as before.
        const dlISO = requirementDeadlineISO(o, r);
        if (!dlISO) continue;
        const due = isoDateOnly(dlISO);
        if (!due) continue;
        const label = requirementDisplayLabel(r);
        const summary = requirementSummary(r);
        items.push({
          id: `yv-offer-${o.id}-req-${r.id}`,
          ownerId: o.id, kind: 'requirement-deadline', dueDate: due, isWork: true,
          // requirement-deadline is the ONE kind whose completion writes through
          // to a domain field (the row's done/done_date) rather than action_done.
          reqId: r.id, done: !!r.done, doneDate: r.done ? (r.done_date || null) : null,
          title: `${name} — ${label}`,
          notes: summary ? `${summary}. Complete by this date to qualify for the ${formatCompactCurrency(o.signupBonusAmount)} bonus.`
                         : `Complete by this date to qualify for the ${formatCompactCurrency(o.signupBonusAmount)} bonus.`,
          listLabel: label, tag: 'danger', name,
          sub: summary || label, color, targetKind: 'offer', targetId: o.id
        });
      }
    }

    // withdrawal / lock-release — informational: funds free up. Keyed on the
    // modern field: any offer whose capital is still live (approved/on-track/
    // met-waiting) and whose hold has a computable release date (prospects
    // have no live account to release from).
    const we = withdrawalEligibleDate(o);
    if (we && capitalLive) {
      const due = isoDateOnly(we);
      if (due) items.push({
        id: `yv-offer-${o.id}-withdraw`,
        ownerId: o.id, kind: 'withdrawal', dueDate: due, isWork: false,
        title: `${name} — withdraw ${formatCompactCurrency(o.requiredFundingAmount)}`,
        notes: `Funds released; bonus ${formatCompactCurrency(o.signupBonusAmount)}.`,
        listLabel: 'Withdrawal', tag: 'success', name,
        sub: `Release ${formatCompactCurrency(o.requiredFundingAmount)}`,
        color, targetKind: 'offer', targetId: o.id
      });
    }

    // expected-bonus-window (F3, informational) — the window in which the
    // sign-up bonus should post, once requirements are met. Emitted ONLY in
    // met-waiting (the "requirements done, watching for the deposit" state);
    // dueDate = window END so a consumer's reminder fires if it hasn't posted
    // by the late edge. lifecycleStage=='waiting' iff subStatus=='met-waiting'.
    if (lifecycleStage(o) === 'waiting') {
      const win = expectedBonusWindow(o);
      if (win && win.endISO) {
        const due = isoDateOnly(win.endISO);
        if (due) items.push({
          id: `yv-offer-${o.id}-bonuswindow`,
          ownerId: o.id, kind: 'expected-bonus-window', dueDate: due, isWork: false,
          title: `${name} — bonus expected by`,
          notes: `Window ${formatDateDisplay(win.startISO)} – ${formatDateDisplay(win.endISO)}`,
          listLabel: 'Bonus expected', tag: 'success', name,
          sub: `${formatCompactCurrency(o.signupBonusAmount)} bonus`,
          color, targetKind: 'offer', targetId: o.id
        });
      }
    }

    // safe-to-close (F3, informational) — the date after which closing the
    // account is safe (funds released, bonus posted/expected, ETF + deadlines
    // cleared). Emitted when computable AND the account is still open AND the
    // offer is at or past requirements-met (earned or met-waiting) — before
    // that, closing isn't yet on the table. earned+open → legacy 'funded'
    // (survives the terminal skip at loop top); earned+closed is already
    // terminal and excluded.
    if (o.accountStatus === 'open' && (o.subStatus === 'earned' || o.subStatus === 'met-waiting')) {
      const stc = safeToCloseDate(o);
      if (stc) {
        const due = isoDateOnly(stc);
        if (due) items.push({
          id: `yv-offer-${o.id}-safeclose`,
          ownerId: o.id, kind: 'safe-to-close', dueDate: due, isWork: false,
          title: `${name} — safe to close`,
          notes: `Account can be closed on/after this date (funds released and bonus posted).`,
          listLabel: 'Safe to close', tag: 'success', name,
          sub: 'Close account', color, targetKind: 'offer', targetId: o.id
        });
      }
    }
  }

  // churn-eligible (F6, informational) — the date a churnable offer can be
  // re-run. Its OWN loop over ALL offers (not the committed-offer loop above)
  // BECAUSE the natural churn case is an account you already closed: that offer
  // is terminal (deriveLegacyStatus → 'completed') and the loop above skips it,
  // yet its re-eligibility is exactly what you want reminded of. Emit only when
  // churnable===true AND churnEligibleDate is computable AND that date is within
  // CHURN_FEED_LOOKAHEAD_DAYS ahead OR at most CHURN_FEED_PAST_GRACE_DAYS behind
  // (so a freshly-eligible offer surfaces, but ancient history isn't resurrected).
  // Binds to the STABLE offer id so the tombstone mechanism retires it when the
  // conditions lapse (churnable unset, anchor cleared, or the window passes).
  for (const o of state.offers || []) {
    if (!o.id) continue;
    if (o.churnable !== true) continue;
    if (churnSnoozeActive(o)) continue;   // suppressed while snoozed — a lapsed
                                          // timed snooze re-emits naturally; the
                                          // disappear/reappear rides the existing
                                          // _feedEmitted/_feedRemoved tombstones.
    const elig = churnEligibleDate(o);
    if (!elig) continue;
    const daysOut = daysBetween(TODAY, parseDate(elig));
    if (daysOut > CHURN_FEED_LOOKAHEAD_DAYS || daysOut < -CHURN_FEED_PAST_GRACE_DAYS) continue;
    const due = isoDateOnly(elig);
    if (!due) continue;
    const name = nm(o);
    const anchorLabel = CHURN_ANCHOR_LABELS[o.churn_anchor] || CHURN_ANCHOR_LABELS.bonus_received;
    const months = Number(o.churn_wait_months);
    const waitTxt = Number.isFinite(months) && months > 0 ? `${months}-month wait` : 'wait';
    items.push({
      id: `yv-offer-${o.id}-churn`,
      ownerId: o.id, kind: 'churn-eligible', dueDate: due, isWork: false,
      title: `${name} — churn eligible`,
      notes: `${waitTxt} from ${anchorLabel}; can be earned again on/after this date.`,
      listLabel: 'Churn eligible', tag: 'success', name,
      sub: 'Re-run offer', color: offerColorHex(o), targetKind: 'offer', targetId: o.id
    });
  }

  for (const c of state.commitments || []) {
    if (!c.id) continue;
    if (c.status === 'cancelled' || c.status === 'completed') continue;
    if (!c.endDate) continue;
    const due = isoDateOnly(c.endDate);
    if (!due) continue;
    items.push({
      id: `yv-cmt-${c.id}-end`,
      ownerId: c.id, kind: 'commitment-end', dueDate: due, isWork: false,
      title: `${c.commitmentName} — release`,
      notes: `${formatCurrency(c.amount)} (${c.type}).`,
      listLabel: 'Commitment release', tag: 'success', name: c.commitmentName,
      sub: formatCompactCurrency(c.amount), color: '', targetKind: 'commitment', targetId: c.id
    });
  }

  // inflow / outflow events — informational. Respect BOTH flags exactly as
  // the list historically did (includeInProjection AND showInUpcoming), and
  // surface only the NEXT instance of a recurring event (from today), so the
  // feed and the list agree on which occurrence they mean. A generous
  // look-ahead finds the next instance even for a distant recurrence; the
  // list re-applies its own 90-day cutoff on the resulting date.
  const FEED_EVENT_HORIZON = addDays(TODAY, 366 * 5);
  for (const e of state.events || []) {
    if (!e.id) continue;
    if (!e.includeInProjection) continue;
    if (e.showInUpcoming === false) continue;
    const next = nextEventInstance(e, TODAY, FEED_EVENT_HORIZON);
    if (!next) continue;
    const amt = Number(next.amount);
    const isRecurring = e.recurrence && e.recurrence.kind && e.recurrence.kind !== 'none';
    const label = e.eventName + (isRecurring ? ` (${e.recurrence.kind === 'custom' ? `every ${e.recurrence.everyDays || 7}d` : e.recurrence.kind})` : '');
    items.push({
      id: `yv-evt-${e.id}`,
      ownerId: e.id, kind: amt >= 0 ? 'inflow' : 'outflow',
      dueDate: isoDate(next.date), isWork: false,
      title: e.eventName,
      notes: `${formatCurrency(amt)}${e.category ? ' (' + e.category + ')' : ''}.`,
      listLabel: amt >= 0 ? 'Inflow' : 'Outflow', tag: amt >= 0 ? 'success' : '',
      name: label, sub: formatCurrency(amt), color: '', targetKind: 'event', targetId: e.id
    });
  }

  // Annotate action-level completion for every NON-requirement kind from the
  // state.action_done map (requirement-deadline was already annotated from its
  // row above). done items are excluded from the machine feed by
  // computeReminderFeed and lingered greyed by computeUpcomingActions; when the
  // map is empty this loop sets done:false on everything and the output is
  // unchanged from before this feature.
  const actionDone = (state.action_done && typeof state.action_done === 'object' && !Array.isArray(state.action_done))
    ? state.action_done : {};
  for (const it of items) {
    if (it.kind === 'requirement-deadline') continue;
    const dd = actionDone[it.id];
    it.done = dd != null;
    it.doneDate = dd != null ? dd : null;
  }

  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return items;
}

/* Reminder feed (contract v2): a stable, machine-readable snapshot emitted
   into App.state._feed on every push so the same JSON the cloud Sync writes
   to the Gist also carries the feed. A consumer (iOS Shortcut / ICS worker)
   reads it and merges into its surface — preserving user-added notes/alarms/
   completion via per-item stable `id`s.

   Contract v2 (see docs/assessments/2026-07-05/step6-reminders-redesign.md):
     schema:2, generatedAt, manifestVersion (monotonic; survives restore-
     from-history via a max(prev+1, minutes-since-epoch) clock component),
     feedStatus ('ok'|'stale'|'error'), lastGoodGeneratedAt,
     items:[{id,kind,title,dueDate,notes}], removed:[{id,tombstonedAt,reason}].
   `risk` is intentionally OMITTED (computed risk is a later phase; the guide
   treats it as optional). Tombstones: when an offer/commitment is deleted or
   a previously-emitted id permanently disappears, its id moves to removed[]
   (retained a fixed 90 days for now; ack-based retention arrives with
   consumer heartbeats later). Previously-emitted ids live in state._feedEmitted
   so a disappearance can be detected on the next compute.

   ITEM KINDS (additive — the ENVELOPE shape above is frozen; only the set of
   `kind` values grows, which the iOS Shortcut tolerates because it matches
   reminders by the id/URL, not by kind): offer-expires, deposit-deadline,
   dd-initiate, dd-window-end, debit-deadline, withdrawal, commitment-end,
   inflow, outflow, and (step 3) `requirement-deadline` — one per USER-added
   requirement row (source:'user') with a computable deadline on a committed
   offer, id `yv-offer-<offerId>-req-<rowId>` off the row's STABLE id. Derived
   requirement rows (source:'derived') deliberately emit NOTHING: they mirror
   the legacy funding/DD/debit fields the deposit-deadline / dd-initiate /
   debit-deadline items already cover, so emitting from them too would
   double-book. Done rows emit nothing (obligation met).

   ACTION COMPLETION (R70, additive — envelope UNCHANGED): a completed action is
   EXCLUDED from items[] and therefore appears in removed[] (reason 'superseded'),
   exactly like a deleted/superseded item — so the consumer's EXISTING tombstone
   loop (Section F) marks the reminder complete. No new field, no envelope change:
   the Shortcut needs no update to honor completions (it already drains removed[]).
   Completion source is the requirement row's done flag for requirement-deadline,
   or state.action_done[id] for every other completable kind. A re-opened action
   re-enters items[] and its tombstone is dropped (resurrection), same as an
   un-deleted offer.

   (step 4, lifecycle — both informational, isWork:false):
     • `expected-bonus-window` (id `yv-offer-<offerId>-bonuswindow`) — the
       expected bonus-posting window. dueDate = window END; notes =
       "Window <start> – <end>". Emitted ONLY while subStatus=='met-waiting'
       (requirements met, watching for the deposit).
     • `safe-to-close` (id `yv-offer-<offerId>-safeclose`) — the date after
       which closing the account is safe. dueDate = safeToCloseDate(). Emitted
       only when that date is computable AND accountStatus=='open' AND subStatus
       in {earned, met-waiting}. Both bind to the STABLE offer id, so they
       participate in the _feedEmitted/_feedRemoved tombstone mechanism (a
       status change out of the emitting state tombstones them automatically).

   (step 5, churnability — informational, isWork:false):
     • `churn-eligible` (id `yv-offer-<offerId>-churn`) — the date a churnable
       offer can be re-run. dueDate = churnEligibleDate() (anchor per
       churn_anchor + churn_wait_months, calendar-month clamped). Emitted from
       its OWN loop over ALL offers (NOT the committed-offer loop) so a
       closed-and-done offer — the typical churn case, terminal per
       deriveLegacyStatus — still surfaces its re-eligibility. Gated to
       churnable===true AND computable AND the eligible date within
       CHURN_FEED_LOOKAHEAD_DAYS (60) ahead OR at most
       CHURN_FEED_PAST_GRACE_DAYS (180) behind (past-
       but-recent stays actionable; ancient history isn't resurrected).
       SUPPRESSED while the offer's churn is snoozed (churn_snoozed_until is
       'forever' or a future ISO — churnSnoozeActive()); a lapsed timed snooze
       re-emits naturally. Binds to the STABLE offer id, so unsetting churnable /
       clearing the anchor / snoozing / the window passing tombstones it
       automatically.

   NOTE: this function MUTATES state (manifestVersion, _feedEmitted,
   _feedRemoved) — call it only on the push/persist path (Sync.push /
   createGist / safeSync), never from a render loop. The item universe comes
   from the shared buildReminderItems() so the feed can never drift from the
   in-app list/count. */
const FEED_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // fixed 90-day retention
// Session high-water mark for manifestVersion (see computeReminderFeed). Seeded
// from the loaded state on init so it survives a reload; can only ever rise.
let _manifestHwm = 0;
function seedManifestHwm(v) { _manifestHwm = v; } // §0b sanctioned setter: cross-module _manifestHwm write from app-state App.init (ES imports are read-only)
function computeReminderFeed(state) {
  const built = buildReminderItems(state);
  // COMPLETED actions are EXCLUDED from the machine feed. Because they leave the
  // live-id set below, the existing tombstone diff retires them into removed[],
  // and the iOS Shortcut marks the matching reminder complete — the same path a
  // done user-requirement always took. When nothing is completed `emitted` ===
  // `built`, so items[]/removed[]/the whole envelope are byte-identical to
  // before this feature (the added per-item `done` field is never serialized).
  const emitted = built.filter(it => !it.done);
  // PRUNE state.action_done (P3-1) so it can't grow without bound. Drop a
  // completion whose item id is NO LONGER produced by the builder (offer/
  // commitment deleted, or the underlying fact changed so the id is gone) AND
  // whose done-date is older than the tombstone TTL (90d). The TTL grace stops
  // flicker-pruning an item that's only momentarily absent; a done item's OWN id
  // is still in `built` (annotated done:true, before the exclusion above), so an
  // active/lingering completion is never pruned. An orphaned-offer key therefore
  // disappears in the first compute where it's both absent AND past the TTL.
  if (state.action_done && typeof state.action_done === 'object' && !Array.isArray(state.action_done)) {
    const builtIds = new Set(built.map(it => it.id));
    const ttlCutoff = Date.now() - FEED_TOMBSTONE_TTL_MS;
    for (const id in state.action_done) {
      if (builtIds.has(id)) continue;                              // item still exists → keep
      const dEpoch = Date.parse(state.action_done[id]);
      if (Number.isFinite(dEpoch) && dEpoch >= ttlCutoff) continue; // within TTL grace → keep
      delete state.action_done[id];
    }
  }
  const generatedAt = new Date().toISOString();
  const stampTime = (d) => d.slice(0, 10) + 'T09:00:00';

  // Monotonic manifestVersion. Three terms guarantee it only ever grows:
  //   • minutes-since-epoch — advances across sessions/devices (a device
  //     that hasn't pushed in a while still lands a higher number).
  //   • prev + 1 — climbs on rapid same-minute pushes.
  //   • session high-water mark + 1 — the RESTORE guard. restoreState()
  //     swaps in an OLD snapshot whose _manifestVersion is small; without
  //     this a same-minute restore could regress below a number already
  //     shipped this session. The HWM (module-scoped, seeded from the loaded
  //     state on init) can never be lowered by a restored snapshot, so a
  //     restore-from-history still produces a strictly-higher version.
  const minutesEpoch = Math.floor(Date.now() / 60000);
  const prevVersion = Number(state._manifestVersion) || 0;
  const manifestVersion = Math.max(prevVersion + 1, minutesEpoch, _manifestHwm + 1);
  _manifestHwm = manifestVersion;
  state._manifestVersion = manifestVersion;

  // Tombstones. Diff the ids we emit now against the ids we emitted last
  // time (state._feedEmitted). Any id that was live and is now gone gets a
  // tombstone, reason inferred from whether its owning record still exists.
  const liveIds = new Set(emitted.map(it => it.id));
  const offerIds = new Set((state.offers || []).map(o => o.id));
  const cmtIds = new Set((state.commitments || []).map(c => c.id));
  const evtIds = new Set((state.events || []).map(e => e.id));
  const prevEmitted = (state._feedEmitted && typeof state._feedEmitted === 'object') ? state._feedEmitted : {};

  let removed = Array.isArray(state._feedRemoved) ? state._feedRemoved.slice() : [];
  const alreadyTombstoned = new Set(removed.map(r => r.id));
  // A tombstoned id that RE-appears (offer un-deleted / status flips back) is
  // resurrected — drop its tombstone so the consumer stops deleting it.
  removed = removed.filter(r => !liveIds.has(r.id));
  const reasonFor = (id, ownerId) => {
    // ownerId was recorded when the id was last emitted; if that record is
    // gone the item was deleted, otherwise it was superseded by a status/
    // date change that made the item no longer apply.
    if (ownerId && !offerIds.has(ownerId) && !cmtIds.has(ownerId) && !evtIds.has(ownerId)) {
      if (id.startsWith('yv-cmt-')) return 'commitment-deleted';
      if (id.startsWith('yv-evt-')) return 'event-deleted';
      return 'offer-deleted';
    }
    return 'superseded';
  };
  for (const id in prevEmitted) {
    if (liveIds.has(id)) continue;
    if (alreadyTombstoned.has(id)) continue;
    removed.push({ id, tombstonedAt: generatedAt, reason: reasonFor(id, prevEmitted[id]) });
  }
  // Retain tombstones for a fixed 90-day TTL (ack-based retention is a later
  // phase once consumer heartbeats exist).
  const cutoff = Date.now() - FEED_TOMBSTONE_TTL_MS;
  removed = removed.filter(r => {
    const t = Date.parse(r.tombstonedAt);
    return !Number.isFinite(t) || t >= cutoff;
  });
  state._feedRemoved = removed;

  // Record what we emitted this round (id → ownerId) for the next diff.
  const emittedNow = {};
  for (const it of emitted) emittedNow[it.id] = it.ownerId || '';
  state._feedEmitted = emittedNow;

  const lastGoodGeneratedAt = generatedAt; // this compute succeeded
  return {
    schema: 2,
    generatedAt,
    manifestVersion,
    feedStatus: 'ok',
    lastGoodGeneratedAt,
    items: emitted.map(it => ({
      id: it.id,
      kind: it.kind,
      title: it.title,
      dueDate: stampTime(it.dueDate),
      notes: it.notes
    })),
    removed
  };
}

// Compute the feed for the push/persist path, but never ship absent or
// silently-stale on failure. On a throw: log via ErrCode.RENDER (no more
// silent try{}catch{}), and REUSE the last good feed marked feedStatus
// 'stale' so a consumer can tell the producer is degraded rather than act
// on nothing. If there is no last-good feed to reuse, return a minimal
// feedStatus:'error' envelope. Returns the feed to store in state._feed.
function computeFeedSafely(state) {
  try {
    return computeReminderFeed(state);
  } catch (e) {
    logError(ErrCode.RENDER, e, 'reminder-feed');
    const lastGood = state && state._feed;
    if (lastGood && lastGood.items) {
      return { ...lastGood, feedStatus: 'stale', generatedAt: new Date().toISOString() };
    }
    return {
      schema: 2,
      generatedAt: new Date().toISOString(),
      manifestVersion: Number(state && state._manifestVersion) || 0,
      feedStatus: 'error',
      lastGoodGeneratedAt: (lastGood && lastGood.lastGoodGeneratedAt) || null,
      items: [],
      removed: (state && Array.isArray(state._feedRemoved)) ? state._feedRemoved : []
    };
  }
}

// The overview "Upcoming actions" LIST: every builder item within the 90-day
// horizon (the horizon filter is by design — the FEED keeps the full future),
// PLUS any recently-completed action still inside its ACTION_DONE_LINGER_DAYS
// window (rendered greyed). (The former companion `computeActionsRequired`
// headline count was removed with the At-a-glance panel — R70; it had no other
// consumer, so its known past-due miscount is fully mooted.)
function computeUpcomingActions(state, limit = 12) {
  const horizonEnd = addDays(TODAY, 90);
  const items = [];
  for (const it of buildReminderItems(state)) {
    const d = parseDate(it.dueDate);
    if (!d) continue;
    if (it.done) {
      // Completed actions linger in the list greyed for ACTION_DONE_LINGER_DAYS
      // after their done date, then drop (the feed already tombstoned them).
      // Gated on the DONE date, not the due date, so a completed-but-past-due
      // item still shows briefly (it would fail the d < TODAY horizon below).
      const dd = it.doneDate ? parseDate(it.doneDate) : null;
      if (!dd) continue;
      const age = daysBetween(dd, TODAY);
      if (age < 0 || age > ACTION_DONE_LINGER_DAYS) continue;
    } else {
      if (d < TODAY || d > horizonEnd) continue;   // existing 90-day horizon
    }
    items.push({
      date: d,
      kind: it.listLabel,
      name: it.name,
      sub: it.sub,
      tag: it.tag,
      color: it.color,
      targetKind: it.targetKind,
      targetId: it.targetId,
      // Completion plumbing threaded through to renderActionRow:
      feedId: it.id,             // stable id → completion control + action_done key
      feedKind: it.kind,         // semantic kind → routes the toggle (req vs map)
      ownerId: it.ownerId,       // offer id, for requirement write-through
      reqId: it.reqId || '',     // requirement row id (requirement-deadline only)
      done: !!it.done,
      doneDate: it.doneDate || null
    });
  }
  // Not-done first (by date), then the lingering-done rows collected at the
  // bottom (also by date) so completed items never push pending work down.
  items.sort((a, b) => (a.done - b.done) || (a.date - b.date));
  return items.slice(0, limit);
}

/* Targeted update for the Upcoming-Actions pager. A full render() would
   rebuild every section on the overview page, which (a) burns work and
   (b) reflows enough surrounding DOM that the document's scroll position
   gets nudged upward when the new page has fewer rows. Swapping just the
   action-list innerHTML keeps the section height pinned (min-height in CSS)
   and the page stays exactly where the user left it. */
function updateUpcomingPage(nextPage) {
  const ACTIONS_PER_PAGE = 6;
  const all = computeUpcomingActions(App.state, 200);
  const pageCount = Math.max(1, Math.ceil(all.length / ACTIONS_PER_PAGE));
  const clamped = Math.max(0, Math.min(pageCount - 1, nextPage));
  if (clamped === App._upcomingPage) return;
  App._upcomingPage = clamped;
  const slice = all.slice(clamped * ACTIONS_PER_PAGE, (clamped + 1) * ACTIONS_PER_PAGE);
  const list = document.querySelector('.action-list');
  if (list) {
    list.innerHTML = slice.map(renderActionRow).join('');
    // Re-trigger the fade-in animation for the new page
    list.classList.remove('upcoming-fade');
    void list.offsetWidth; // force reflow so the animation restarts
    list.classList.add('upcoming-fade');
    list.setAttribute('key', clamped);
  }
  // Update pager controls in place
  const pager = document.querySelector('.upcoming-pager');
  if (pager) {
    const prev = pager.querySelector('[data-action="upcoming-prev"]');
    const next = pager.querySelector('[data-action="upcoming-next"]');
    const label = pager.querySelector('.upcoming-pg-label');
    if (prev) prev.toggleAttribute('disabled', clamped === 0);
    if (next) next.toggleAttribute('disabled', clamped === pageCount - 1);
    if (label) label.textContent = `${clamped + 1} / ${pageCount}`;
  }
}

function renderActionRow(item) {
  const month = item.date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const day = item.date.getDate();
  const done = !!item.done;
  // Display-side name strip (R70): the feed title carries the raw offer name,
  // which may end in a "$amount". Strip it for the LIST only (feed payload is
  // untouched) via the same helper the rest of the UI uses.
  const displayName = displayOfferName(item.name);
  // A quiet completion control on completable kinds (checklist idiom). Its own
  // data-action wins over the row's open-action-target because onClick uses the
  // INNERMOST [data-action] ancestor, so tapping it toggles completion without
  // opening the offer.
  const canComplete = item.feedId && ACTION_COMPLETABLE_KINDS.has(item.feedKind);
  const check = canComplete
    ? `<button type="button" class="action-check${done ? ' checked' : ''}" data-action="toggle-action-done" data-feed-id="${escapeAttr(item.feedId)}" data-feed-kind="${escapeAttr(item.feedKind || '')}" data-owner-id="${escapeAttr(item.ownerId || '')}" data-req-id="${escapeAttr(item.reqId || '')}" aria-pressed="${done ? 'true' : 'false'}" aria-label="${done ? 'Mark not done' : 'Mark done'}" title="${done ? 'Mark not done' : 'Mark done'}">${done ? '✓' : ''}</button>`
    : '';
  const sub = done
    ? `Done ${escapeHtml(formatDateDisplay(item.doneDate))}`
    : `${escapeHtml(item.sub)} · ${escapeHtml(relativeDays(item.date))}`;
  return `
    <div class="action-row${item.color ? ' has-color' : ''}${item.targetKind ? ' clickable' : ''}${done ? ' done' : ''}"${item.color ? ` style="--offer-color:${item.color};"` : ''}${item.targetKind ? ` data-action="open-action-target" data-target-kind="${item.targetKind}" data-target-id="${escapeAttr(item.targetId)}" role="button" tabindex="0"` : ''}>
      <div class="action-day">
        <span class="month">${month}</span>
        <span class="day">${day}</span>
      </div>
      <div class="action-body">
        <div class="action-title">${escapeHtml(displayName)}</div>
        <div class="action-sub">${sub}</div>
      </div>
      <span class="action-tag ${item.tag || ''}">${escapeHtml(item.kind)}</span>
      ${check}
    </div>
  `;
}

export { WORK_ITEM_SUB_STATUSES, ACTION_DONE_LINGER_DAYS, ACTION_COMPLETABLE_KINDS, ddWindowEndDate, buildReminderItems, FEED_TOMBSTONE_TTL_MS, _manifestHwm, computeReminderFeed, computeFeedSafely, computeUpcomingActions, updateUpcomingPage, renderActionRow, seedManifestHwm };
