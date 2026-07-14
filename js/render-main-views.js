import { App } from './app-state.js';
import { TODAY, addDays, daysBetween, expandEventInstances, formatCompactCurrency, formatCurrency, formatDateDisplay, formatDateLong, formatDateMedium, formatDateShort, formatLocalDateTime, formatMoneyInput, formatDollarInput, formatPercent, isoDate, parseDate, startOfDay } from './date-format-core.js';
import { DDMethods, directDepositEffectiveDate } from './dd-widgets.js';
import { updateSyncButtonsLive } from './events-actions-data.js';
import { CONFIDENCE_LABELS, CONFIRMED_OFFER_STATUSES, HYPOTHETICAL_OFFER_STATUSES, hasPreV2Backup, offerColorHex } from './migrations-catalogs.js';
import { CHURN_ANCHOR_LABELS, LIFECYCLE_STAGES, LIFECYCLE_STAGE_LABELS, annualizedReturn, churnEligibleDate, hasGenuinePriorRun, churnSnoozeActive, ddCapitalTime, debitDeadlineISO, depositDeadline, effectiveOfferForToday, expectedBonusWindow, isOfferComplete, lifecycleCaption, lifecycleStage, lockStartDate, mapEffectiveOffers, offerIsActiveForProjection, offerIssues, pathState, requirementActive, safeToCloseDate, shouldSuggestWaiting, simpleReturn, withdrawalEligibleDate } from './offer-model.js';
import { effectiveHorizonDays, generateProjection, summarizeProjection } from './projection-optimizer.js';
import { displayOfferName, offerDisplayLabel, requirementDeadlineISO, requirementDisplayLabel } from './requirements-templates.js';
import { APP_VERSION, PRE_ACCOUNT_SUB_STATUSES, STATUS_LABELS, SUB_STATUSES, SUB_STATUS_CHIP_CLASS, SUB_STATUS_LABELS, readDiagLog, storageHealth } from './runtime-status.js';
import { Sync } from './sync-pwa.js';
import { escapeAttr, escapeHtml } from './ui-utils.js';
/* ============================================================
   PLAN TAB — Timeline + Optimize segments
   ============================================================
   The owner's 4-tab nav (Home · Plan · Offers · Settings) renders a
   2-way segment switcher, then the active segment: the capital Timeline
   (renderTimeline) or the optimizer proposal (renderOptimizeSegment).
   The old manual-combo Planner segment retired in v2026.07.09h — the
   Optimize engine subsumes it and the Offers tab card view carries the
   include toggle. App._planSegment holds the active segment; Timeline is
   the default landing (monitoring-first, since Home stays chart-first).
   Any stale persisted 'planner' value coerces to 'timeline' here. */
function renderPlanner() {
  const seg = App._planSegment === 'optimize' ? 'optimize' : 'timeline';
  const body = seg === 'optimize' ? renderOptimizeSegment() : renderTimeline();
  return `
    ${renderPlanSegmentControl(seg)}
    <div class="plan-segment-body">${body}</div>
  `;
}

function renderPlanSegmentControl(active) {
  const segs = [
    ['timeline', 'Timeline'],
    ['optimize', 'Optimize']
  ];
  return `
    <div class="plan-segmented" role="tablist" aria-label="Plan views">
      ${segs.map(([k, l]) => `<button class="plan-seg-btn ${active === k ? 'active' : ''}" role="tab" aria-selected="${active === k ? 'true' : 'false'}" data-plan-segment="${k}">${l}</button>`).join('')}
    </div>
  `;
}

/* Optimize segment — the constraint-based sequencer proposal (engine output).
   The plan is TRANSIENT (App.optimizerPlan, never persisted); nothing touches
   state.offers until applyOptimizerPlan (step 4-iii). Renders the winning plan
   + alternatives: sequence view, capital-curve summary, per-offer badges
   (incl. the unverified-churn provenance badge), and binding-constraint hints. */

// Human copy for each binding-constraint kind the engine emits
// (validateOfferQualification / horizon / buffer-floor in optimizer-engine.js).
const BINDING_CONSTRAINT_COPY = {
  'schedule-before-today': 'sign-up date would be in the past',
  'expiry': 'offer expires before it can start',
  'deposit-deadline': 'funding would miss the deposit deadline',
  'debit-deadline': 'debit requirement deadline has passed',
  'requirement-deadline': 'a requirement deadline has passed',
  'dd-window': "direct-deposit cadence/window can't be met",
  'dd-post-late': 'a direct deposit would post after the deadline — initiate it sooner',
  'completeness': 'offer is missing required details',
  'buffer-floor': 'dips into your cash buffer',
  'horizon-exceeded': 'extends past the planning horizon'
};
const OPT_REVIEW_REASON_COPY = {
  'commitment-linked': 'Already tracked as a commitment',
  'churn-snoozed': 'Churn snoozed',
  'missing-churn-anchor': 'Needs a date to re-run',
  'no-valid-date-window': 'No valid sign-up window',
  // Validator-time exclusions (item 2): a candidate the qualifier rejects at
  // every schedulable date while a valid alternative outranks it.
  'dd-post-late': 'A direct deposit would post after the deadline — initiate it sooner',
  'dd-window': "Direct-deposit cadence/window can't be met",
  'deposit-deadline': 'Funding would miss the deposit deadline',
  'debit-deadline': 'Debit requirement deadline has passed',
  'requirement-deadline': 'A requirement deadline has passed',
  'expiry': 'Offer expires before it can start',
  // EITHER/OR: this offer can be met by a direct deposit OR a card spend, but no
  // path is chosen — the optimizer never picks for you (P2-3). Tap to choose.
  'needs-path': 'Choose how to qualify — direct deposit or card spend'
};
const OPT_PLAN_REASON_COPY = {
  'cash-infeasible': 'Dips below your cash buffer.',
  'qualification-failed': "A timing requirement can't be met.",
  'horizon-exceeded': 'Extends past the planning horizon.',
  'too-many-candidates': 'Too many candidates to search.'
};
// ISSUE 2(b) (owner verbatim: "show what's missing … so I'm not searching
// aimlessly"): a missing-churn-anchor row names the EXACT date owed per the
// source's churn_anchor, so the owner knows which field to fill — not a vague
// "needs a date". Keyed on the review row's `anchor` (set by the engine).
const CHURN_ANCHOR_MISSING_COPY = {
  'account_closed': "Needs the prior run's close date (churn timing)",
  'account_opened': "Needs the prior run's sign-up date (churn timing)",
  'bonus_received': 'Needs the prior bonus-received date (churn timing)'
};
// Resolve a review row to its human copy — anchor-specific for missing-churn-
// anchor, the static map otherwise.
function optReviewReasonCopy(r) {
  if (r && r.reason === 'missing-churn-anchor') {
    return CHURN_ANCHOR_MISSING_COPY[r.anchor] || CHURN_ANCHOR_MISSING_COPY.bonus_received;
  }
  return (r && OPT_REVIEW_REASON_COPY[r.reason]) || (r && r.reason) || '';
}
// ISSUE 2(c): the edit-modal field the tap-through should scroll to + highlight
// for a needs-data row — the exact input the owner must fill. Returns an element
// id ('' when the reason has no single fixable field). Churn anchor maps per the
// row's `anchor`; DD timing → the DD entries block; deposit-deadline → funding.
function optReviewFocusField(r) {
  if (!r) return '';
  if (r.reason === 'missing-churn-anchor') {
    const map = { account_closed: 'f-closed', account_opened: 'f-signup', bonus_received: 'f-bonus-received' };
    return map[r.anchor] || 'f-bonus-received';
  }
  switch (r.reason) {
    case 'dd-window':
    case 'dd-post-late': return 'dd-entries';
    case 'deposit-deadline': return 'f-funded';
    case 'needs-path': return 'f-planned-path';   // EITHER/OR path selector
    default: return '';
  }
}

function renderOptimizeSegment() {
  const offers = App.state.offers || [];
  const candidateCount = offers.filter(o => HYPOTHETICAL_OFFER_STATUSES.has(o.status) && isOfferComplete(o)).length;
  const churnCount = offers.filter(o => o.churnable === true).length;
  const plan = App.optimizerPlan;

  const header = `
    <div class="section-header">
      <div>
        <h2>Optimize</h2>
        <p>Slide sign-up dates and pick offers to maximize your <strong>gross</strong> bonus without breaching the buffer.</p>
      </div>
    </div>`;

  const runBar = `
    <div class="optimizer-bar">
      <div class="optimizer-summary">
        <div class="metric"><span class="label">Candidates</span><span class="value">${candidateCount}</span></div>
        <div class="metric"><span class="label">Churn-eligible</span><span class="value">${churnCount}</span></div>
        ${plan && plan.valid && plan.objective ? `<div class="metric"><span class="label">Plan bonus (gross)</span><span class="value" style="color:var(--success);">${formatCurrency(plan.objective.grossBonus)}</span></div>` : ''}
      </div>
      <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap;">
        <button class="btn btn-primary" data-action="run-planner-optimizer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          ${plan ? 'Re-run optimizer' : 'Run optimizer'}
        </button>
        ${plan ? `<button class="btn btn-ghost btn-sm" data-action="clear-planner-optimizer">Clear</button>` : ''}
      </div>
    </div>`;

  let body;
  if (!plan) {
    body = (candidateCount + churnCount) === 0
      ? renderEmptyState('Nothing to optimize yet', 'Add prospect offers (or mark an offer churnable) and the optimizer will sequence them to maximize your bonus.', 'add-offer', 'Add an offer')
      : `<div class="banner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          <div>Run the optimizer to see the proposed sequence, the capital-curve low point, and any offers that can't be scheduled. Bonuses are shown <strong>gross</strong> (monthly fees / ETFs are not netted).</div>
        </div>`;
  } else {
    body = renderOptimizerProposal(plan);
  }
  return header + runBar + renderOptCurrentStateBanner(plan) + body;
}

// Current-state shortfall banner (2026-07-13). The Optimize panel evaluates
// PROPOSALS while Home shows the CURRENT entered dates — two different states. So
// a schedule that already breaches the buffer today (per generateProjection on
// App.state, exactly what Home charts) is surfaced here, telling the owner the
// optimizer will fix it (pre-run) or has (post-run, when a feasible plan exists).
// Muted-danger styling (--danger-deep). Returns '' when the current schedule is
// clean. Wrapped defensively so a projection throw can never blank the panel.
function renderOptCurrentStateBanner(plan) {
  let summary;
  try {
    summary = summarizeProjection(generateProjection(App.state), App.state.settings);
  } catch (_) { return ''; }
  if (!summary || !summary.lowest) return '';
  const shortfall = summary.shortfallDays || 0;
  const below = summary.belowBufferDays || 0;
  if (shortfall === 0 && below === 0) return '';
  const low = summary.lowest.availableCapital;
  const amt = low < 0 ? `−${formatCurrency(Math.abs(low))}` : formatCurrency(low);
  const when = formatDateMedium(summary.lowest.date);
  // Post-run: only claim a fix when a feasible reschedule actually exists.
  let feasible = false;
  if (plan && !plan.tooMany) {
    try { feasible = optimizerProposalModel(plan).list.some(p => p && p.valid && (p.includedIds || []).length); } catch (_) {}
  }
  const tail = !plan
    ? 'run the optimizer to fix it'
    : (feasible
        ? 'this proposal reschedules to stay above your buffer'
        : 'no feasible reschedule was found — free up capital or drop an offer');
  return `
    <div class="banner opt-current-danger" role="status">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <div>Your current schedule dips to <strong>${amt}</strong> on ${when} — ${tail}.</div>
    </div>`;
}

function renderOptimizerProposal(topPlan) {
  if (topPlan.tooMany) {
    return `
      <div class="banner warn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17.01"/></svg>
        <div><strong>Too many candidates to search:</strong> ${topPlan.candidateCount} (limit ${topPlan.max}). Mark some offers as "skipped", convert them to commitments, or snooze churn candidates first.</div>
      </div>`;
  }

  const reviewNotes = renderOptCandidateReview(topPlan.candidateReview || [], topPlan);

  if ((topPlan.candidateCount || 0) === 0) {
    const cc = topPlan.capitalCurveSummary || {};
    return `
      <div class="banner">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        <div>No candidate offers to sequence. Your current schedule's low cash is <strong>${formatCurrency(cc.lowestAvailable)}</strong>.</div>
      </div>
      ${reviewNotes}`;
  }

  // Named champions (per objective axis) come straight from the engine's
  // feasible pool. optimizerProposalModel builds the ordered, selectable list —
  // champion plans first (index 0 = the "Best total return" winner), then the
  // 09i diversity-deduped feasible remainder with champions removed. The Apply
  // action indexes App._optimizerAltIndex into the SAME list, so tap-to-focus +
  // Apply stay in lockstep.
  const { champions, championPlans, others, list } = optimizerProposalModel(topPlan);
  const idx = Math.min(Math.max(0, App._optimizerAltIndex || 0), list.length - 1);
  const focused = list[idx];
  const focusedChampion = champions.find(c => c.plan.canonicalVector === focused.canonicalVector);

  return `
    ${renderOptPlanCard(focused, topPlan, idx, list.length, focusedChampion || null)}
    ${renderOptChampionList(champions, others, championPlans.length, idx)}
    ${reviewNotes}
  `;
}

// Shared builder for the Optimize panel's ordered, selectable plan list. BOTH
// the renderer and the Apply action (events-actions-data.js) index
// App._optimizerAltIndex into the returned `list`, so they must agree byte-for-
// byte. Order: champion plans (the engine's per-axis winners) first, then the
// 09i diversity-deduped feasible remainder with champion vectors removed. With
// no feasible plan at all the remainder is left as-is (may be infeasible) and,
// if even that is empty, the list falls back to [topPlan] so Apply always has a
// target. Pure — derived entirely from topPlan.champions + topPlan.alternatives.
function optimizerProposalModel(topPlan) {
  const champions = (topPlan && topPlan.champions) || [];
  const championPlans = champions.map(c => c.plan);
  const championVectors = new Set(championPlans.map(p => p.canonicalVector));
  const remainder = ((topPlan && topPlan.alternatives) || []).filter(p => !championVectors.has(p.canonicalVector));
  // Hide the 0-offer "do nothing" plan from "Other feasible plans" — a $0 empty
  // card is noise; doing nothing is implicitly always feasible (owner rider,
  // 2026-07-09). Only filtered from the feasible-champions remainder; the
  // no-feasible-plan fallback keeps whatever the engine returned.
  const others = championPlans.length
    ? remainder.filter(p => p.valid && (p.includedIds || []).length > 0)
    : remainder;
  const list = championPlans.concat(others);
  return { champions, championPlans, others, list: list.length ? list : [topPlan] };
}

// Resolve a schedule/constraint offerId to a display name. Churn 'create'
// records synthesize a churn_<sourceId> offer NOT in state.offers, so resolve
// through the candidate record's sourceOfferId back to the real source offer.
function optimizerOfferName(topPlan, offerId) {
  const cand = (topPlan.candidates || []).find(c => c.id === offerId);
  const srcId = cand ? cand.sourceOfferId : offerId;
  const src = (App.state.offers || []).find(o => o.id === srcId);
  const op = cand ? cand.op : ((topPlan.schedule && topPlan.schedule[offerId] && topPlan.schedule[offerId].op) || 'update');
  if (!src) return op === 'create' ? 'Re-run offer' : (offerId || 'offer');
  const base = offerDisplayLabel(src, { separator: ' · ' }) || src.bankName || 'offer';
  return op === 'create' ? `Re-run: ${base}` : base;
}

// Bank name ONLY, for the compact proposed-plan sequence rows (owner-directed
// 2026-07-11): those rows carry the op badge ("New · churn" / "Reschedule") and
// dates, so the full "Bank · Offer name" is redundant there — the modal and
// everywhere else keep the full label via optimizerOfferName. Resolves a churn
// candidate id back to its source offer, same as optimizerOfferName.
function optimizerOfferBankName(topPlan, offerId) {
  const cand = (topPlan.candidates || []).find(c => c.id === offerId);
  const srcId = cand ? cand.sourceOfferId : offerId;
  const src = (App.state.offers || []).find(o => o.id === srcId);
  return src ? (src.bankName || 'offer') : (offerId || 'offer');
}

// Resolve a candidate-review row's offerId to a display name. A review row can
// carry EITHER a real source id (commitment-linked / churn-snoozed / needs-date)
// OR the synthetic churn_<sourceId> id of a candidate whose date window was
// empty. Never print the raw synthetic id: strip/resolve to the source offer's
// "bank · name" and keep the churn/re-run context explicit.
// Resolve a review row to { srcId, isChurn } — the SOURCE offer id behind a
// (possibly synthetic churn_<id>) review row, and whether the row is churn
// context. Shared by optReviewName (display) and the tap-through (which opens
// that source offer's edit modal).
function optReviewResolve(topPlan, r) {
  const offerId = r.offerId;
  const isChurnReason = r.reason === 'churn-snoozed' || r.reason === 'missing-churn-anchor';
  const cand = (topPlan.candidates || []).find(c => c.id === offerId);
  let srcId = offerId;
  let isChurn = isChurnReason;
  if (cand) {
    srcId = cand.sourceOfferId || offerId;
    isChurn = isChurn || cand.op === 'create';
  } else if (String(offerId || '').startsWith('churn_')) {
    srcId = String(offerId).slice('churn_'.length);
    isChurn = true;
  }
  return { srcId, isChurn };
}

function optReviewName(topPlan, r) {
  const { srcId, isChurn } = optReviewResolve(topPlan, r);
  const src = (App.state.offers || []).find(o => o.id === srcId);
  const base = src ? (offerDisplayLabel(src, { separator: ' · ' }) || src.bankName || srcId) : (isChurn ? 'Re-run offer' : (srcId || 'offer'));
  return isChurn && src ? `Re-run: ${base}` : base;
}

function renderOptPlanCard(focused, topPlan, idx, total, champion) {
  const cc = focused.capitalCurveSummary || {};
  const obj = focused.objective || {};
  const included = focused.includedIds || [];
  const championLabels = champion ? champion.labels : null;
  const validBadge = focused.valid
    ? `<span class="opt-valid ok">Feasible</span>`
    : `<span class="opt-valid bad">Not feasible</span>`;
  const rankLabel = championLabels && championLabels.length
    ? `Proposed plan · ${championLabels.map(escapeHtml).join(' · ')}`
    : `Proposed plan${total > 1 ? ` · option ${idx + 1} of ${total}` : ''}`;
  // A focused SECONDARY champion states its trade delta vs the headline plan.
  const tradeLine = champion && champion.trade ? formatChampionTrade(champion.trade, champion.axes) : '';
  return `
    <section class="card opt-plan-card ${focused.valid ? '' : 'invalid'}">
      <div class="opt-plan-head">
        <div>
          <div class="combo-rank">${rankLabel}</div>
          ${tradeLine ? `<div class="opt-plan-trade">${escapeHtml(tradeLine)}</div>` : ''}
          <div class="combo-bonus">${formatCurrency(obj.grossBonus || 0)} <span class="opt-bonus-cap">gross</span></div>
        </div>
        ${validBadge}
      </div>
      <div class="combo-meta">
        <span class="opt-metric">
          <span class="opt-metric-val">${formatCurrency(cc.lowestAvailable)}</span>
          <span class="opt-metric-lbl">low cash${cc.lowestDateISO ? ' · ' + formatDateMedium(parseDate(cc.lowestDateISO)) : ''}</span>
        </span>
        ${obj.blendedAnnReturn != null ? `<span class="opt-metric">
          <span class="opt-metric-val">${formatPercent(obj.blendedAnnReturn)}</span>
          <span class="opt-metric-lbl">blended APY</span>
        </span>` : ''}
        ${obj.latestCompletionISO ? `<span class="opt-metric">
          <span class="opt-metric-val">${formatDateMedium(parseDate(obj.latestCompletionISO))}</span>
          <span class="opt-metric-lbl">capital back</span>
        </span>` : ''}
        <span class="opt-metric">
          <span class="opt-metric-val">${cc.horizonDays}d</span>
          <span class="opt-metric-lbl">horizon</span>
        </span>
        ${cc.belowBufferDays > 0 ? `<span class="opt-meta-warn">${cc.belowBufferDays}d below buffer</span>` : ''}
        ${cc.shortfallDays > 0 ? `<span class="opt-meta-danger">${cc.shortfallDays}d shortfall</span>` : ''}
      </div>
      ${!focused.valid && (focused.reasons || []).length ? `<div class="opt-invalid-note">${focused.reasons.map(r => OPT_PLAN_REASON_COPY[r] || r).join(' ')}</div>` : ''}
      <div class="opt-sequence">
        ${included.length
          ? included.map(id => renderOptSequenceRow(focused, topPlan, id)).join('')
          : `<div class="opt-empty-seq">This plan adds no offers — your current schedule already sits at the buffer limit, or no candidate fits the constraints.</div>`}
      </div>
      ${renderOptBindingHints(focused, topPlan)}
      ${renderOptApplyRow(focused)}
    </section>`;
}

// Apply / Undo affordance (one-shot). While an apply is pending
// (App._optimizerUndo set), Apply is hidden on every alternative and only Undo
// shows — enforcing the one-shot undo. Apply is offered only on a feasible plan
// that actually changes something.
function renderOptApplyRow(focused) {
  if (App._optimizerUndo) {
    return `
      <div class="opt-apply-row">
        <span class="opt-applied">✓ Plan applied</span>
        <button class="btn btn-ghost btn-sm" data-action="undo-optimizer-apply">Undo</button>
      </div>`;
  }
  if (!focused.valid || !(focused.includedIds || []).length) return '';
  return `
    <div class="opt-apply-row">
      <button class="btn btn-primary" data-action="apply-optimizer-plan">Apply this plan</button>
      <span class="opt-apply-note">Writes sign-up dates + inclusion. One-tap undo.</span>
    </div>`;
}

function renderOptSequenceRow(focused, topPlan, id) {
  const s = (focused.schedule && focused.schedule[id]) || {};
  const badges = (focused.badges && focused.badges[id]) || [];
  const isCreate = s.op === 'create';
  // Bank name only on the sequence row (item 2) — the op badge + dates already
  // give the rest; the full "Bank · Offer name" stays in the modal/elsewhere.
  const name = optimizerOfferBankName(topPlan, id);
  const dds = (s.directDeposits || []).filter(d => d && d.plannedDate);
  const derived = s.derived || {};
  // Churn rows carry an unverified stored value — offer a one-tap Worker verify
  // (P2-2) against the source offer's stored DoC URL; a changed input forces a
  // full re-run, an unchanged one flips this row to "verified today".
  const cand = isCreate ? (topPlan.candidates || []).find(c => c.id === id) : null;
  const srcId = cand ? cand.sourceOfferId : '';
  const hasUnverified = badges.some(b => b && b.kind === 'unverified-churn-value');
  // A one-click verify that found no change marks the source verified-today
  // (transient, cleared on the next optimize run): drop the unverified warn
  // badge, show a green "Verified today" pill, and hide the control.
  const verifiedToday = !!(srcId && App._churnVerifiedToday && App._churnVerifiedToday[srcId] === isoDate(TODAY));
  const shownBadges = verifiedToday ? badges.filter(b => !(b && b.kind === 'unverified-churn-value')) : badges;
  return `
    <div class="opt-seq-row">
      <div class="opt-seq-top">
        <span class="opt-seq-name">${escapeHtml(name)}</span>
        <span class="opt-op-badge ${isCreate ? 'create' : ''}">${isCreate ? 'New · churn' : 'Reschedule'}</span>
      </div>
      <div class="opt-seq-dates">
        ${s.plannedSignupDate ? `<span>Sign up <strong>${formatDateMedium(parseDate(s.plannedSignupDate))}</strong></span>` : ''}
        ${s.optionalPlannedFundingDate ? `<span>Fund <strong>${formatDateMedium(parseDate(s.optionalPlannedFundingDate))}</strong></span>` : ''}
        ${dds.length ? `<span>${dds.length} DD${dds.length === 1 ? '' : 's'} from <strong>${formatDateMedium(parseDate(dds[0].plannedDate))}</strong></span>` : ''}
        ${derived.withdrawalEligible ? `<span>Capital back <strong>${formatDateMedium(parseDate(derived.withdrawalEligible))}</strong></span>` : ''}
      </div>
      ${shownBadges.length || (hasUnverified && srcId) || verifiedToday ? `<div class="opt-seq-badges">
        ${shownBadges.map(renderOptBadge).join('')}
        ${verifiedToday
          ? `<span class="opt-badge ok" title="Re-checked against the source today — the stored value is current">Verified today</span>`
          : (hasUnverified && srcId ? `<button class="opt-recheck" data-action="verify-churn-value" data-id="${escapeAttr(srcId)}">Verify value</button>` : '')}
      </div>` : ''}
      ${s.bonus ? `<span class="opt-seq-bonus" title="Sign-up bonus">${formatCurrency(s.bonus)}</span>` : ''}
    </div>`;
}

function renderOptBadge(b) {
  if (!b || !b.copy) return '';
  const cls = b.kind === 'unverified-churn-value' ? 'opt-badge warn' : 'opt-badge';
  const title = b.kind === 'unverified-churn-value' ? ' title="Value taken from your stored record, not re-verified against the source"' : '';
  return `<span class="${cls}"${title}>${escapeHtml(b.copy)}</span>`;
}

function renderOptBindingHints(focused, topPlan) {
  const bcs = focused.bindingConstraints || [];
  if (!bcs.length) return '';
  const seen = new Set();
  const rows = [];
  for (const bc of bcs) {
    const key = (bc.offerId || '') + '|' + bc.kind;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = BINDING_CONSTRAINT_COPY[bc.kind] || bc.kind;
    const who = bc.offerId ? escapeHtml(optimizerOfferName(topPlan, bc.offerId)) : '';
    const when = bc.dateISO ? formatDateMedium(parseDate(bc.dateISO)) : '';
    rows.push(`<div class="opt-hint">${who ? `<strong>${who}</strong> — ` : ''}${label}${when ? ` (${when})` : ''}</div>`);
  }
  return `<div class="opt-hints"><div class="opt-hints-title">What pinned this plan</div>${rows.join('')}</div>`;
}

// Champion cards (one per objective axis, with the axis label as the badge)
// followed by the "Other feasible plans" remainder. Both sections select by the
// card's position in the combined list built in renderOptimizerProposal:
// champion i → index i, other j → index championCount + j.
function renderOptChampionList(champions, others, championCount, idx) {
  if (!champions.length && !others.length) return '';
  const champCards = champions.map((c, i) =>
    renderOptScenarioCard(c.plan, i, i === idx, c.labels, c.trade, c.axes)).join('');
  const otherCards = others.map((p, j) => {
    const li = championCount + j;
    return renderOptScenarioCard(p, li, li === idx, null, null, null);
  }).join('');
  // Header on the remainder is truthful: "feasible" only when champions (all
  // feasible) head the list; otherwise it is the old best-effort "Other options".
  const othersTitle = championCount ? 'Other feasible plans' : 'Other options';
  return `
    <div class="opt-alts">
      ${champions.length ? `<div class="opt-alts-list opt-champ-list">${champCards}</div>` : ''}
      ${others.length ? `<div class="opt-alts-title${champions.length ? ' opt-alts-title-sub' : ''}">${othersTitle}</div>
      <div class="opt-alts-list">${otherCards}</div>` : ''}
    </div>`;
}

// Format a secondary champion's PURE trade delta (from the engine) into an
// explicit "what you give up vs the headline" line. Axis-relevant clauses first
// (rate → APY gain; fastest → days sooner), then the gross cost, e.g.
// "+9.2% APY · -$450 vs best" or "capital back 34 days sooner · -$450 vs best".
// Full comma dollars per the owner formatting rule (never compact K).
function formatChampionTrade(trade, axes) {
  if (!trade) return '';
  const has = k => Array.isArray(axes) && axes.indexOf(k) !== -1;
  const parts = [];
  if (has('rate') && trade.apyDeltaPp != null) {
    parts.push(`+${formatPercent(trade.apyDeltaPp)} APY`);
  }
  if (has('fastest') && trade.daysSooner != null) {
    parts.push(`capital back ${trade.daysSooner} day${trade.daysSooner === 1 ? '' : 's'} sooner`);
  }
  const g = trade.grossDelta;
  if (g < 0) parts.push(`-${formatCurrency(Math.abs(g))} vs best`);
  else if (g > 0) parts.push(`+${formatCurrency(g)} vs best`);
  else parts.push('same gross as best');
  return parts.join(' · ');
}

// Format a surviving alternative's PURE edgeVsHeadline (from the engine's
// dominance filter) into a compact one-line "why it survived next to the best
// plan": the axis(es) on which it beats the headline, with deltas. The 10a
// Pareto filter guarantees a displayed alternative beats the headline on ≥1 of
// these axes, and this reads the SAME comparison, so the label can never
// disagree with the dominance that kept the card. Axis names match the card
// cells (blended APY / low cash / gross / capital back); full comma dollars per
// the owner rule. Order mirrors the owner's example (APY, cushion, …). Empty
// only in the pathological no-edge case (e.g. an invalid headline) → no line.
function formatAltEdge(edge) {
  if (!edge) return '';
  const parts = [];
  if (edge.apyDelta > 0) parts.push(`+${formatPercent(edge.apyDelta)} APY`);
  if (edge.lowCashDelta > 0) parts.push(`+${formatCurrency(edge.lowCashDelta)} low cash`);
  if (edge.grossDelta > 0) parts.push(`+${formatCurrency(edge.grossDelta)} gross`);
  if (edge.daysSooner > 0) parts.push(`capital back ${edge.daysSooner} day${edge.daysSooner === 1 ? '' : 's'} sooner`);
  if (!parts.length) return '';
  return parts.join(' · ') + ' vs best';
}

// One comparison-row scenario card (gross · offers · low cash · APY · capital
// back). When labels are present it renders as a champion: the axis label(s)
// sit in a full-width badge above the metrics row, and a secondary champion's
// trade delta (from the engine) sits just below it.
function renderOptScenarioCard(p, listIdx, active, labels, trade, axes) {
  const n = (p.includedIds || []).length;
  const cc = p.capitalCurveSummary || {};
  const obj = p.objective || {};
  const apy = obj.blendedAnnReturn != null ? formatPercent(obj.blendedAnnReturn) : '—';
  const back = obj.latestCompletionISO ? formatDateMedium(parseDate(obj.latestCompletionISO)) : '—';
  const isChampion = !!(labels && labels.length);
  const badge = isChampion
    ? `<span class="opt-alt-badge">${labels.map(escapeHtml).join(' · ')}</span>`
    : '';
  const tradeLine = formatChampionTrade(trade, axes);
  // Non-champion ("Other feasible plans") cards get the edge annotation (item 4)
  // — why this plan survived next to the best plan. Champions keep their labels.
  const edgeLine = isChampion ? '' : formatAltEdge(p.edgeVsHeadline);
  return `
    <button class="opt-alt${isChampion ? ' champion' : ''}${active ? ' active' : ''}${p.valid ? '' : ' infeasible'}" data-action="select-optimizer-alt" data-alt-index="${listIdx}">
      ${badge}
      ${tradeLine ? `<span class="opt-alt-trade">${escapeHtml(tradeLine)}</span>` : ''}
      ${edgeLine ? `<span class="opt-alt-edge">${escapeHtml(edgeLine)}</span>` : ''}
      <span class="opt-alt-cell opt-alt-bonus">
        <span class="opt-alt-val">${formatCurrency(obj.grossBonus || 0)}</span>
        <span class="opt-alt-lbl">gross${p.valid ? '' : ' · infeasible'}</span>
      </span>
      <span class="opt-alt-cell">
        <span class="opt-alt-val">${n}</span>
        <span class="opt-alt-lbl">offer${n === 1 ? '' : 's'}</span>
      </span>
      <span class="opt-alt-cell">
        <span class="opt-alt-val">${formatCurrency(cc.lowestAvailable || 0)}</span>
        <span class="opt-alt-lbl">low cash</span>
      </span>
      <span class="opt-alt-cell">
        <span class="opt-alt-val">${apy}</span>
        <span class="opt-alt-lbl">blended APY</span>
      </span>
      <span class="opt-alt-cell">
        <span class="opt-alt-val">${back}</span>
        <span class="opt-alt-lbl">capital back</span>
      </span>
    </button>`;
}

function renderOptCandidateReview(review, topPlan) {
  const items = (review || []).filter(r => r && (r.status === 'excluded' || r.status === 'needs-date'));
  if (!items.length) return '';
  return `
    <section class="card opt-review">
      <div class="card-header"><h2 style="font-size:15px;">Not in this plan</h2></div>
      <div class="opt-review-list">
        ${items.map(r => {
          const name = optReviewName(topPlan, r);
          const reason = optReviewReasonCopy(r);
          const cls = r.status === 'needs-date' ? 'needs-date' : 'excluded';
          // Tap-through: open the SOURCE offer's edit modal (for churn re-run
          // candidates the underlying offer, not the synthetic id) so the owner
          // can fix the gap. Only when that offer actually exists in state; the
          // reason stays visible on the row either way.
          const { srcId } = optReviewResolve(topPlan, r);
          const src = srcId && (App.state.offers || []).find(o => o.id === srcId);
          const inner = `<span class="opt-review-name">${escapeHtml(name)}</span><span class="opt-review-reason">${escapeHtml(reason)}</span>`;
          // ISSUE 2(c): carry the exact field to scroll-to + highlight on open.
          const focus = optReviewFocusField(r);
          return src
            ? `<button class="opt-review-row tappable ${cls}" data-action="edit-offer-from-optimize" data-id="${escapeAttr(srcId)}"${focus ? ` data-focus="${escapeAttr(focus)}"` : ''} title="Open this offer to fix — Save & run re-optimizes">${inner}</button>`
            : `<div class="opt-review-row ${cls}">${inner}</div>`;
        }).join('')}
      </div>
    </section>`;
}

// DD-method datapoint panel for an offer card: top 3 source methods (by
// DoC datapoint count) that code as a DD at this offer's bank, with the
// user's own source banks flagged + fallback guidance.
function renderDdMethodPanel(o) {
  if (DDMethods.failed) return '';
  if (!DDMethods.loaded) return `<div class="ddm-panel ddm-loading">Loading DD-method datapoints…</div>`;
  const info = DDMethods.forOffer(o.bankName, App.state.settings.sourceBanks);
  if (!info || info.top3.length === 0) return `<div class="ddm-panel ddm-empty">No DD-method datapoints for ${escapeHtml(o.bankName || 'this bank')} in the DoC list.</div>`;
  // Each "method" is a deposit source (an account type like "Business
  // checking", or a named bank/service like "American Express") that DoC
  // users report posts as a direct deposit at THIS bank. The number is the
  // datapoint count backing it — rendered as a separate "N DP" badge so it
  // never reads as part of the method name ("Business checking 2").
  const rows = info.top3.map(w =>
    `<span class="ddm-pill ${w.mine ? 'mine' : ''}" title="${escapeAttr(w.method)} — ${w.dps} Doctor of Credit datapoint${w.dps === 1 ? '' : 's'} that it posts as a direct deposit here${w.note ? ' · ' + escapeAttr(w.note) : ''}${w.mine ? ' · one of your source banks' : ''}">${w.mine ? '★&nbsp;' : ''}<span class="ddm-method">${escapeHtml(w.method)}</span><span class="ddm-dp">${w.dps} DP</span></span>`
  ).join('');
  let foot = '';
  if (!info.anyMine) {
    foot = info.hasSourceBanks
      ? `<div class="ddm-foot">None of your source banks have datapoints.</div>`
      : `<div class="ddm-foot">Add your source banks in Settings to flag which of yours work.</div>`;
  } else if (!info.topHasMine && info.myBest) {
    foot = `<div class="ddm-foot">Your best option: <strong>★ ${escapeHtml(info.myBest.method)}</strong> (${info.myBest.dps} DP${info.myBest.dps === 1 ? '' : 's'})</div>`;
  }
  return `<div class="ddm-panel">
    <div class="ddm-inner">
      <div class="ddm-left">
        <div class="ddm-title" title="Deposit sources — account types (e.g. 'Business checking') or named banks/services — that Doctor of Credit users report will post as a direct deposit at this bank. 'N DP' is how many datapoints back each; more is stronger evidence.">Top DD methods</div>
      </div>
      <div class="ddm-list">${rows}</div>
    </div>
    ${foot}
  </div>`;
}

// {done, total} requirement counts for an offer — drives the card checklist
// header and the offers-table met/total chip.
function requirementChecklistCounts(o) {
  // QUALIFICATION PATHS: under logic 'any' only the chosen path's rows (+ neutral)
  // count toward the checklist — a non-chosen-family obligation isn't yours to do.
  // Byte-identical for 'all' (every row active).
  const reqs = (Array.isArray(o.requirements) ? o.requirements : []).filter(r => requirementActive(o, r));
  const total = reqs.length;
  const done = reqs.filter(r => r && r.done).length;
  return { done, total };
}

// Compact requirement checklist on the offer card (step 3). Each row shows a
// checkbox, its title, and the computed deadline date; tapping toggles `done`
// (strikethrough + check, sorts below pending). Pending rows first (soonest
// date first, undated last), then done rows. Renders nothing when the offer has
// no requirement rows.
function renderRequirementChecklist(o) {
  // QUALIFICATION PATHS: render only the active path's rows (+ neutral). The
  // non-chosen path's obligations are kept on the offer but not shown as to-dos.
  // Byte-identical for 'all'.
  const reqs = (Array.isArray(o.requirements) ? o.requirements : []).filter(r => requirementActive(o, r));
  if (reqs.length === 0) return '';
  // Item 1: each date renders ONCE on the card. The legacy .offer-dates block
  // (Fund / Withdrawal date) and the .offer-dds block already print these dates
  // ABOVE the checklist and own that placement (owner preference). So a DERIVED
  // checklist row whose computed deadline equals an already-shown date drops its
  // date suffix here — the row + done state still render, just no duplicate date.
  // The modal editing surface is unaffected (it keeps every computed date).
  const shownDates = new Set(
    [lockStartDate(o), withdrawalEligibleDate(o)]
      .concat((Array.isArray(o.directDeposits) ? o.directDeposits : []).map(directDepositEffectiveDate))
      .filter(Boolean)
  );
  const rows = reqs.map(r => ({ row: r, dlISO: requirementDeadlineISO(o, r) }));
  rows.sort((a, b) => {
    // Pending above done.
    if (!!a.row.done !== !!b.row.done) return a.row.done ? 1 : -1;
    // Within a group: dated soonest-first, undated last, then stable by label.
    if (a.dlISO && b.dlISO) return a.dlISO.localeCompare(b.dlISO);
    if (a.dlISO) return -1;
    if (b.dlISO) return 1;
    return requirementDisplayLabel(a.row).localeCompare(requirementDisplayLabel(b.row));
  });
  const { done, total } = requirementChecklistCounts(o);
  const checkSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const items = rows.map(({ row, dlISO }) => `
    <div class="offer-req-item ${row.done ? 'done' : ''}" data-action="toggle-req-done" data-id="${o.id}" data-req-id="${escapeAttr(row.id)}" role="button" tabindex="0" aria-pressed="${row.done ? 'true' : 'false'}" title="${row.done ? 'Mark not done' : 'Mark done'}">
      <span class="offer-req-check">${row.done ? checkSvg : ''}</span>
      <span class="offer-req-label">${escapeHtml(requirementDisplayLabel(row))}</span>
      <span class="offer-req-date">${(dlISO && !(row.source === 'derived' && shownDates.has(dlISO))) ? formatDateMedium(dlISO) : ''}</span>
    </div>`).join('');
  return `
    <div class="offer-req-checklist">
      <div class="offer-req-title">Requirements <span class="offer-req-count">${done}/${total}</span></div>
      ${items}
    </div>`;
}

// Compact 4-stage pipeline strip (F3) — a DERIVED VIEW of the status model
// (lifecycleStage), styled after BonusFlow's filled-progress-segment pattern
// adapted to YV tokens. `slim` is a denser variant for the modal. For an
// 'inactive' subStatus (prospect/denied/etc.) the whole strip renders neutral
// and carries no active fill — the offer's status chip states the specifics.
function renderPipelineStrip(o, opts) {
  const slim = !!(opts && opts.slim);
  const stage = lifecycleStage(o);
  const inactive = stage === 'inactive';
  const activeIdx = inactive ? -1 : LIFECYCLE_STAGES.indexOf(stage);
  const segs = LIFECYCLE_STAGES.map((st, i) => {
    // A stage is "filled" (past/current) when its index <= the active index.
    const state = inactive ? 'idle' : (i < activeIdx ? 'done' : (i === activeIdx ? 'current' : 'idle'));
    return `<div class="yv-pl-seg ${state}">
      <span class="yv-pl-dot"></span>
      <span class="yv-pl-label">${LIFECYCLE_STAGE_LABELS[st]}</span>
    </div>`;
  }).join('');
  const cap = slim ? '' : (() => {
    const c = lifecycleCaption(o);
    return c ? `<div class="yv-pl-caption">${escapeHtml(c)}</div>` : '';
  })();
  return `<div class="yv-pipeline ${slim ? 'slim' : ''} ${inactive ? 'inactive' : ''}" role="img" aria-label="Lifecycle stage: ${inactive ? 'not started' : LIFECYCLE_STAGE_LABELS[stage]}">
    <div class="yv-pl-track">${segs}</div>
    ${cap}
  </div>`;
}

// Expected-bonus window + safe-to-close lines for the card/modal. Shows only
// what's computable for the offer's current lifecycle stage; returns '' when
// neither applies (so no empty box appears for a prospect).
function renderLifecycleInfo(o) {
  const parts = [];
  const stage = lifecycleStage(o);

  // Bonus received (earned + a stored date) OR expected window (waiting/earned).
  if (stage === 'earned' && o.bonus_received_date) {
    parts.push(`<div class="yv-life-line"><span class="yv-life-k">Bonus received</span><span class="yv-life-v success">${escapeHtml(formatDateDisplay(o.bonus_received_date))}</span></div>`);
  } else {
    const win = expectedBonusWindow(o);
    if (win) {
      // Overdue (P3-1): still met-waiting but the window's late edge has passed —
      // a stale future-looking range would mislead, so switch to overdue copy +
      // warning styling. (Feed semantics unchanged — no past-date filter there.)
      const endPast = win.endISO && parseDate(win.endISO) && parseDate(win.endISO).getTime() < TODAY.getTime();
      if (stage === 'waiting' && endPast) {
        parts.push(`<div class="yv-life-line"><span class="yv-life-k">Bonus overdue</span><span class="yv-life-v warn">window ended ${escapeHtml(formatDateDisplay(win.endISO))}</span></div>`);
      } else {
        const flag = win.typical ? ' <span class="yv-life-tag">typical</span>' : (win.estimated ? ' <span class="yv-life-tag">estimated</span>' : '');
        parts.push(`<div class="yv-life-line"><span class="yv-life-k">Expected bonus</span><span class="yv-life-v">${escapeHtml(formatDateDisplay(win.startISO))} ~ ${escapeHtml(formatDateDisplay(win.endISO))}${flag}</span></div>`);
      }
    }
  }

  // Safe-to-close — same gate as the safe-to-close FEED kind so the card and
  // feed agree: account OPEN and at/past requirements-met (earned or met-waiting).
  // Before that, closing isn't on the table, so no line for approved/on-track/
  // denied. Success-styled once the date has passed.
  if (o.accountStatus === 'open' && (o.subStatus === 'earned' || o.subStatus === 'met-waiting')) {
    const stc = safeToCloseDate(o);
    if (stc) {
      const past = parseDate(stc) && parseDate(stc).getTime() <= TODAY.getTime();
      parts.push(`<div class="yv-life-line"><span class="yv-life-k">Safe to close</span><span class="yv-life-v ${past ? 'success' : ''}">${past ? '' : 'after '}${escapeHtml(formatDateDisplay(stc))}</span></div>`);
    }
  }

  // Churnability (F6) — when the offer can be re-run again. Only churnable===true
  // offers get a positive line; churnable===false shows a subtle "Not churnable"
  // (but only alongside other lifecycle context or an explicit note, so a bare
  // prospect never carries a lone negative line); churnable===null stays silent
  // (unknown = no line).
  if (o.churnable === true) {
    const elig = churnEligibleDate(o);
    if (elig) {
      const past = parseDate(elig) && parseDate(elig).getTime() <= TODAY.getTime();
      // While snoozed, append a muted suffix on the SAME line. A timed snooze
      // shows the until-date ("snoozed until 9-1-2026"); a 'forever' snooze (or
      // any active snooze without a resolvable date) shows a bare "snoozed".
      let snoozeSuffix = '';
      if (churnSnoozeActive(o)) {
        const su = o.churn_snoozed_until;
        snoozeSuffix = (su && su !== 'forever' && parseDate(su))
          ? ` <span class="yv-life-snooze">— snoozed until ${escapeHtml(formatDateDisplay(su))}</span>`
          : ` <span class="yv-life-snooze">— snoozed</span>`;
      }
      parts.push(`<div class="yv-life-line"><span class="yv-life-k">Churn</span><span class="yv-life-v ${snoozeSuffix ? '' : (past ? 'success' : '')}">${past ? 'eligible now' : 'eligible ' + escapeHtml(formatDateDisplay(elig))}${snoozeSuffix}</span></div>`);
    } else if (!hasGenuinePriorRun(o)) {
      // ISSUE 2(c) (owner-directed 2026-07-10): a never-run offer (pre-account
      // prospect/applied) has no prior run, so it must NOT demand a close/anchor
      // date — churn timing only starts once this offer actually completes.
      parts.push(`<div class="yv-life-line"><span class="yv-life-k">Churn</span><span class="yv-life-v muted">applies after this offer completes</span></div>`);
    } else if (Number(o.churn_wait_months) > 0) {
      // A genuine prior run whose anchor date isn't recorded yet — name the field.
      const anchorLabel = CHURN_ANCHOR_LABELS[o.churn_anchor] || CHURN_ANCHOR_LABELS.bonus_received;
      parts.push(`<div class="yv-life-line"><span class="yv-life-k">Churn</span><span class="yv-life-v muted">needs ${escapeHtml(anchorLabel)} date</span></div>`);
    } else {
      // Churnable but no cooling-off period recorded → no computable date.
      // Mirror the "needs … date" prompt so the offer surfaces the gap here
      // (the overview section stays absent — nothing computable to list).
      parts.push(`<div class="yv-life-line"><span class="yv-life-k">Churn</span><span class="yv-life-v muted">needs wait period</span></div>`);
    }
  } else if (o.churnable === false && (parts.length > 0 || o.churn_notes)) {
    parts.push(`<div class="yv-life-line"><span class="yv-life-k">Churn</span><span class="yv-life-v muted">not churnable</span></div>`);
  }

  if (parts.length === 0) return '';
  return `<div class="yv-life-info">${parts.join('')}</div>`;
}

// Non-intrusive inline suggestion to advance the lifecycle when all requirements
// are done but the offer is still approved/on-track. One tap sets subStatus=
// 'met-waiting' via the normal save path; a dismiss persists a per-offer flag so
// it never nags again. Renders '' unless shouldSuggestWaiting(o).
function renderLifecycleSuggest(o) {
  if (!shouldSuggestWaiting(o)) return '';
  return `<div class="yv-life-suggest">
    <span class="yv-life-suggest-text">All requirements met — mark as Waiting for Bonus?</span>
    <span class="yv-life-suggest-actions">
      <button class="btn btn-primary btn-xs" data-action="lifecycle-mark-waiting" data-id="${o.id}">Mark waiting</button>
      <button class="btn-icon yv-life-suggest-x" data-action="lifecycle-dismiss-suggest" data-id="${o.id}" aria-label="Dismiss suggestion" title="Dismiss">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </button>
    </span>
  </div>`;
}

// Live "needs info" chip (item 3): a prospect/selected offer missing a
// plan-critical DATE the optimizer needs, so it doesn't sit silently. Derived
// PURELY from the offer itself (never from transient optimizer-run state), so it
// is stable across renders and independent of whether a plan has been run.
// Covers the FIXABLE date gaps the optimizer would exclude on:
//   - a direct-deposit / held-and-dd offer with zero DATED DDs → isOfferComplete
//     drops it from candidates silently ("DD offers with zero dated DDs");
//   - a held-and-dd offer with no funding date (same silent drop);
//   - an OPEN account with no planned sign-up date (isOfferComplete drops it);
//   - a churnable offer whose re-run anchor date isn't set (the optimizer's
//     'missing-churn-anchor' review reason).
// A dateless CLOSED prospect is intentionally NOT flagged: it's a valid
// candidate the optimizer schedules a date for, so it isn't "excluded".
function offerNeedsInfoReason(o) {
  if (!o) return null;
  // EITHER/OR: a "met either way" offer with no chosen path needs one. This is
  // checked BEFORE the hypothetical gate because a needs-path offer can be
  // COMMITTED (open account) too — the owner must still choose how to qualify.
  if (pathState(o).needsPath) return 'needs-path';
  if (!HYPOTHETICAL_OFFER_STATUSES.has(o.status)) return null;
  // EITHER/OR [review-after P2]: only demand DD dates when the DD path is active
  // (a debit-path offer needs no DDs). For logic='all' this is the DD-family test.
  const isDD = pathState(o).ddActive;
  if (isDD) {
    const datedDds = Array.isArray(o.directDeposits) && o.directDeposits.some(dd => dd && dd.plannedDate && parseDate(dd.plannedDate));
    if (!datedDds) return 'needs-dd-date';
    if (o.offerType === 'held-and-dd' && !(o.optionalPlannedFundingDate && parseDate(o.optionalPlannedFundingDate))) return 'needs-fund-date';
  }
  if (o.accountStatus === 'open' && !(o.plannedSignupDate && parseDate(o.plannedSignupDate))) return 'needs-signup-date';
  // Only a GENUINE churn source (a real prior run) can owe a re-run anchor date;
  // a never-run prospect is a normal candidate, not a churn re-run (ISSUE 2a).
  if (o.churnable === true && hasGenuinePriorRun(o) && !churnSnoozeActive(o) && !churnEligibleDate(o)) return 'needs-churn-date';
  return null;
}
const OFFER_NEEDS_INFO_COPY = {
  'needs-dd-date':     { label: 'Needs DD date',   title: 'This direct-deposit offer has no dated direct deposits — the optimizer skips it until at least one DD has a date.' },
  'needs-fund-date':   { label: 'Needs fund date', title: 'This held + DD offer has no funding date — the optimizer skips it until the held lump sum is dated.' },
  'needs-signup-date': { label: 'Needs date',      title: 'This open account has no planned sign-up date — add one so the plan can include it.' },
  'needs-churn-date':  { label: 'Needs re-run date', title: 'Churnable, but its re-run anchor date is not set yet — add it to schedule the next cycle.' },
  'needs-path':        { label: 'Choose path', title: 'This bonus can be met more than one way — choose which qualification path you plan to do so it can be modeled (the optimizer never picks for you).' }
};
function offerNeedsInfoChip(o) {
  const reason = offerNeedsInfoReason(o);
  if (!reason) return '';
  const c = OFFER_NEEDS_INFO_COPY[reason];
  return `<span class="chip chip-warn" title="${escapeAttr(c.title)}">${escapeHtml(c.label)}</span>`;
}

// EITHER/OR: a compact chip stating this bonus is met either way and WHICH path
// the owner chose. Only shown for requirementLogic:'any'; the unchosen state is
// carried by the "Choose path" needs-info chip instead (so no duplicate cue).
function eitherOrChip(o) {
  if (!o || o.requirementLogic !== 'any') return '';
  const ps = pathState(o);
  const meta = {
    dd:    { label: 'via DD',         title: 'Met more than one way — you chose the direct-deposit path.' },
    debit: { label: 'via card spend', title: 'Met more than one way — you chose the card-spend path.' },
    hold:  { label: 'via hold',       title: 'Met more than one way — you chose the hold-funds path.' }
  }[ps.path];
  if (!meta) return '';
  return `<span class="chip chip-muted" title="${meta.title}">Either · ${meta.label}</span>`;
}

// Expiration/freshness chip for an offer card (display only — the offer-expires
// FEED item is computed separately and untouched). An offer's expiration date
// only governs SIGNING UP, so the chip is shown ONLY for pre-confirmation
// subStatuses — prospect/applied (PRE_ACCOUNT_SUB_STATUSES) — which is exactly
// when the offer-expires feed item also fires (the feed gates on
// !CONFIRMED_OFFER_STATUSES.has(status); prospect→'prospect', applied→'selected'
// are the only non-confirmed, non-completed derived statuses). Reusing that
// canonical set instead of a parallel exclusion list keeps chip and feed from
// ever contradicting: once approved/on-track/met-waiting/earned/closed, the
// expiry no longer matters and neither surface shows it.
// Tone: neutral (muted) while > 14 days out; --warning once ≤ 14 days (incl.
// today); --danger once past. N is calendar days until expiry (today = 0).
function offerExpirationChip(o) {
  if (!o || !o.offerExpirationDate) return '';
  if (!PRE_ACCOUNT_SUB_STATUSES.has(o.subStatus)) return '';
  const exp = parseDate(o.offerExpirationDate);
  if (!exp) return '';
  const n = daysBetween(TODAY, exp); // >0 future, 0 today, <0 past
  const disp = formatDateDisplay(isoDate(exp)); // owner's M-D-YYYY
  if (n < 0) {
    return `<span class="chip chip-danger" title="This offer's advertised expiration date has passed.">Expired ${disp}</span>`;
  }
  if (n === 0) {
    return `<span class="chip chip-warn" title="Offer expires today — act now.">Expires today</span>`;
  }
  const tone = n <= 14 ? 'chip-warn' : 'chip-muted';
  const title = n <= 14
    ? `Offer expires in ${n} day${n === 1 ? '' : 's'} — act soon.`
    : `Offer expires in ${n} days.`;
  return `<span class="chip ${tone}" title="${title}">Expires ${disp} (${n}d)</span>`;
}

// Quiet "Updated <date>" freshness stamp from last_edited. Smallest text tier,
// --text-tertiary — never competes with the card's real content. Returns ''
// when the offer has never been edited (last_edited null/absent — migrated
// offers stay blank until their first save).
function offerUpdatedStamp(o) {
  if (!o || !o.last_edited) return '';
  const d = parseDate(String(o.last_edited).slice(0, 10));
  if (!d) return '';
  const label = daysBetween(TODAY, d) === 0 ? 'Updated today' : `Updated ${formatDateDisplay(isoDate(d))}`;
  return `<div class="offer-updated">${label}</div>`;
}

// Item 2: quiet "DoC ↗" source affordance for the card. Rendered only when the
// offer carries a docUrl. Opens the post in a new tab (rel=noopener); the href
// is escapeAttr'd. stopPropagation keeps a tap from ever bubbling into a
// card-open/edit action. Returns '' when there's no source URL.
function offerDocLink(o) {
  if (!o || !o.docUrl) return '';
  const raw = String(o.docUrl).trim();
  // SECURITY INVARIANT (P2-1): docUrl only becomes a live href when it is an
  // http(s) URL. escapeAttr escapes quotes but does NOT restrict the scheme, so
  // an imported/crafted `javascript:` or `data:` docUrl would otherwise render a
  // working XSS link. Anywhere docUrl (or any user/imported string) is turned
  // into an href, apply THIS SAME guard.
  if (!/^https?:\/\//i.test(raw)) return '';
  const href = escapeAttr(raw);
  return `<a class="offer-doc-link" href="${href}" target="_blank" rel="noopener" onclick="event.stopPropagation();" title="Open the source DoC post" aria-label="Open source post (new tab)">DoC <span aria-hidden="true">↗</span></a>`;
}

function renderOfferCard(oRaw) {
  // Feature 2 (2026-07-13b): render a stale PRE-ACCOUNT offer at its EFFECTIVE
  // (treated-as-today) dates so the card agrees with the projection/timeline, and
  // surface a chip + one-tap "Move to today" to persist the shift. Keyed on the
  // same "now" the projection uses (projectionStartDate). windowPassed → the
  // sign-up window has already passed (needs-attention, not advanced).
  const effTodayISO = (App.state.settings && App.state.settings.projectionStartDate) || isoDate(TODAY);
  const effInfo = effectiveOfferForToday(oRaw, effTodayISO);
  const o = effInfo.offer;   // effective dates (same ref when nothing shifts); o.id === oRaw.id
  const complete = isOfferComplete(o);
  const issues = offerIssues(o);
  const start = lockStartDate(o);
  const end = withdrawalEligibleDate(o);
  const ar = annualizedReturn(o);
  const sr = simpleReturn(o);
  const isConfirmed = CONFIRMED_OFFER_STATUSES.has(o.status);
  const checked = isConfirmed || o.includeInScenario;
  const disabled = !complete || isConfirmed;

  return `
    <div class="offer-card ${checked && complete ? 'included' : ''} ${!complete ? 'draft' : ''}" ${offerColorHex(o) ? `style="--offer-color:${offerColorHex(o)};"` : ''}>
      <div class="offer-card-header">
        <input type="checkbox" class="offer-include"
          ${checked ? 'checked' : ''}
          ${disabled ? 'disabled' : ''}
          data-action="toggle-include" data-id="${o.id}"
          aria-label="Include in scenario" />
        <div style="flex:1;min-width:0;">
          <div class="offer-name">${escapeHtml(o.bankName || 'Untitled offer')}</div>
          <div class="offer-bank">${escapeHtml(displayOfferName(o.offerName))}</div>
        </div>
        <button class="btn-icon" data-action="edit-offer" data-id="${o.id}" aria-label="Edit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
      </div>
      ${!complete
        ? `<div class="banner warn" style="font-size:12px;padding:8px 10px;margin-bottom:var(--space-3);">Draft — ${escapeHtml(issues[0])}</div>`
        : ''}
      <div class="offer-stats">
        <div class="offer-stat">
          <span class="offer-stat-label">Funding</span>
          <span class="offer-stat-value">${formatCompactCurrency(o.requiredFundingAmount)}</span>
        </div>
        <div class="offer-stat">
          <span class="offer-stat-label">Bonus</span>
          <span class="offer-stat-value success">${formatCompactCurrency(o.signupBonusAmount)}</span>
          ${(o.monthly_fee != null && o.monthly_fee !== '' && Number(o.monthly_fee) > 0) ? `<span class="offer-monthly-fee" title="Monthly account fee${o.fee_waiver_condition ? ' — ' + escapeAttr(o.fee_waiver_condition) : ''}">${formatDollarInput(o.monthly_fee, { suffix: '/mo' })}</span>` : ''}
        </div>
        <div class="offer-stat">
          <span class="offer-stat-label">Days tied up</span>
          ${(() => {
            const isDD = o.offerType === 'direct-deposit' || o.offerType === 'held-and-dd';
            if (isDD) {
              const ct = ddCapitalTime(o);
              if (ct) return `<span class="offer-stat-value" title="Amount-weighted average days each direct deposit is tied up (Σ amount×days ÷ Σ amount). Each DD's round trip accounts for weekends/holidays.">${Math.round(ct.weightedDays)} <span style="font-weight:500;color:var(--text-tertiary);font-size:12px;">wtd avg</span></span>`;
              return `<span class="offer-stat-value muted">—</span>`;
            }
            return `<span class="offer-stat-value" title="Actual days your cash is unavailable: from funded date to the capital-back (landing) date — the hold-release date plus the return-transfer lag.${o.lockStartsFrom === 'open date' ? ' Bank requires ' + o.daysFundsMustRemain + ' days from account open.' : ''}">${(start && end) ? daysBetween(parseDate(start), parseDate(end)) : (o.daysFundsMustRemain ?? '—')}${o.lockStartsFrom === 'open date' && start && end ? ` <span style="font-weight:500;color:var(--text-tertiary);font-size:12px;">/ ${o.daysFundsMustRemain}</span>` : ''}</span>`;
          })()}
        </div>
        <div class="offer-stat">
          <span class="offer-stat-label">Annualized</span>
          <span class="offer-stat-value ${ar != null ? 'success' : 'muted'}" title="${(o.offerType === 'direct-deposit' || o.offerType === 'held-and-dd') ? 'Dollar-days weighted annualized return = bonus × 365 ÷ Σ(deposit amount × days held). Each DD held-days figure reflects its transfer round trip including weekend/holiday delays.' : 'Annualized return on tied-up capital = (bonus / required funding) × 365 / actual days tied up. Business-day-adjusted lock window.'}">${ar != null ? formatPercent(ar) : '—'}</span>
        </div>
      </div>
      <div class="offer-dates">
        ${start ? `<span><strong>Fund date:</strong> ${formatDateMedium(start)}</span>` : ''}
        ${end ? `<span><strong>Capital back:</strong> ${formatDateMedium(end)}${o.lockStartsFrom === 'open date' ? ` <span style="color:var(--text-tertiary);">(${o.daysFundsMustRemain}d from open)</span>` : ''}</span>` : ''}
      </div>
      ${(o.offerType === 'direct-deposit' || o.offerType === 'held-and-dd') && pathState(o).ddActive && Array.isArray(o.directDeposits) && o.directDeposits.length > 0 ? `
        <div class="offer-dds">
          ${o.directDeposits.map((dd, i) => {
            const planned = dd.plannedDate ? parseDate(dd.plannedDate) : null;
            const effISO = directDepositEffectiveDate(dd);
            const eff = effISO ? parseDate(effISO) : null;
            const adjusted = planned && eff && planned.getTime() !== eff.getTime();
            return `<div class="offer-dd-row">
              <span class="offer-dd-num">DD ${i + 1}</span>
              <span class="offer-dd-amount">${formatCompactCurrency(dd.amount)}</span>
              <span class="offer-dd-date" title="${adjusted ? 'Planned ' + (planned ? formatDateMedium(planned) : '—') + ' shifted to next business day' : ''}">${eff ? formatDateMedium(eff) : '—'}${adjusted ? ' <span class="offer-dd-adj">⇢</span>' : ''}</span>
            </div>`;
          }).join('')}
        </div>
      ` : ''}
      ${(o.offerType === 'direct-deposit' || o.offerType === 'held-and-dd') && pathState(o).ddActive ? renderDdMethodPanel(o) : ''}
      ${renderRequirementChecklist(o)}
      ${renderPipelineStrip(o)}
      ${renderLifecycleSuggest(o)}
      ${renderLifecycleInfo(o)}
      <div class="offer-chips">
        <span class="chip chip-offer-type-${(o.offerType && o.offerType !== 'other') ? o.offerType : 'new-funds-held'}" title="${
          o.offerType === 'direct-deposit' ? 'Direct deposit — no hold; money round-trips through the account' :
          o.offerType === 'held-and-dd'    ? 'Held + direct deposit — lump sum held for N days plus qualifying DDs required' :
          'New funds held — lump-sum deposit kept for N days'
        }">${
          o.offerType === 'direct-deposit' ? 'DD' :
          o.offerType === 'held-and-dd'    ? 'Held+DD' :
          'Held'
        }</span>
        <span class="chip ${SUB_STATUS_CHIP_CLASS[o.subStatus] || 'chip-muted'}">${SUB_STATUS_LABELS[o.subStatus] || o.subStatus || '—'}</span>
        ${eitherOrChip(o)}
        ${offerNeedsInfoChip(o)}
        ${effInfo.shifted ? `<span class="chip chip-warn" title="Planned sign-up was ${escapeAttr(formatDateMedium(effInfo.originalSignupISO))}, in the past. It's modeled as today so it stays possible — tap &quot;Move to today&quot; to make it permanent.">date passed — treated as today</span>` : ''}
        ${effInfo.windowPassed ? `<span class="chip chip-danger" title="This offer expired ${escapeAttr(formatDateMedium(oRaw.offerExpirationDate))}, before today — the sign-up window has passed. Update or archive it.">sign-up window passed</span>` : ''}
        ${offerExpirationChip(o)}
        ${o.accountStatus === 'closed' ? `<span class="chip chip-muted" title="Account closed — excluded from the cash projection">Closed</span>` : ''}
        ${o.confidence ? `<span class="chip chip-muted">${CONFIDENCE_LABELS[o.confidence] || o.confidence}</span>` : ''}
        ${sr != null ? `<span class="chip chip-muted" title="Simple return: bonus ÷ required funding (not annualized). Useful as the raw payout ratio.">${formatPercent(sr)} simple</span>` : ''}
        ${pathState(o).debitActive && o.debitRequirement && o.debitRequirement.count ? (() => { const _dl = debitDeadlineISO(o); return `<span class="chip chip-warn" title="${o.debitRequirement.count} qualifying debit-card purchase${o.debitRequirement.count === 1 ? '' : 's'} required${_dl ? ' by ' + formatDateMedium(_dl) : ''}">${o.debitRequirement.count} debit txns</span>`; })() : ''}
      </div>
      ${effInfo.shifted ? `
        <div class="offer-move-today">
          <span class="offer-move-today-note">Sign-up was ${formatDateMedium(effInfo.originalSignupISO)} — dates shown are shifted to today.</span>
          <button class="btn btn-ghost btn-xs" data-action="move-offer-to-today" data-id="${o.id}" title="Persist the shifted sign-up, funding and DD dates">Move to today</button>
        </div>` : ''}
      ${(() => {
        // R70 [6]: the DoC source link now STACKS BELOW the Updated stamp
        // (stamp on top, link beneath) — both right-aligned in a column footer.
        // Skip the wrapper entirely when neither is present (no empty gap).
        const doc = offerDocLink(o);
        const stamp = offerUpdatedStamp(o);
        return (doc || stamp) ? `<div class="offer-card-foot">${stamp}${doc}</div>` : '';
      })()}
    </div>
  `;
}

/* ============================================================
   TIMELINE VIEW
   ============================================================ */
// Contiguous index ranges of a projection where `pred(day)` holds, as {from, to}
// (to = one-past the last matching index, or the final index for a run still open
// at the horizon end). Unifies the timeline + hero-chart shortfall-band scans
// (identical logic; the two call sites render the ranges differently).
function projectionBands(proj, pred) {
  const bands = [];
  let bandStart = null;
  for (let i = 0; i < proj.length; i++) {
    if (pred(proj[i]) && bandStart === null) bandStart = i;
    if ((!pred(proj[i]) || i === proj.length - 1) && bandStart !== null) {
      bands.push({ from: bandStart, to: pred(proj[i]) ? i + 1 : i });
      bandStart = null;
    }
  }
  return bands;
}

function renderTimeline() {
  const settings = App.state.settings;
  const start = parseDate(settings.projectionStartDate) || TODAY;
  const horizon = effectiveHorizonDays(App.state);
  const end = addDays(start, horizon);

  // Collect "rows" — manual commitments + virtual offer commitments
  const rows = [];
  const offerWithCommitment = new Set();
  for (const c of App.state.commitments) {
    if (c.sourceBonusOfferId) offerWithCommitment.add(c.sourceBonusOfferId);
    if (!App.filters.timelineShowCancelled && c.status === 'cancelled') continue;
    if (!App.filters.timelineShowCompleted && c.status === 'completed') continue;
    rows.push({
      id: c.id,
      label: c.commitmentName.split(/\s*[-–—]/)[0].trim(),
      sub: `${formatCurrency(c.amount)} · ${c.type === 'minimum balance' ? 'Min Bal' : c.type}`,
      start: parseDate(c.startDate),
      end: parseDate(c.endDate),
      status: c.status,
      isVirtual: false
    });
  }
  // Feature 2 (2026-07-13b): bars use EFFECTIVE (treated-as-today) dates for
  // stale pre-account offers so each bar lines up with the same-shifted capital
  // curve below (generateProjection). No-op (same ref) for non-stale sets.
  const tlEffToday = settings.projectionStartDate || isoDate(TODAY);
  for (const o of mapEffectiveOffers(App.state.offers, tlEffToday)) {
    if (offerWithCommitment.has(o.id)) continue;
    if (!isOfferComplete(o)) continue;
    if (!offerIsActiveForProjection(o) && o.status !== 'completed') continue;
    if (o.status === 'completed' && !App.filters.timelineShowCompleted) continue;
    if (o.status === 'skipped') continue;
    const sStart = parseDate(lockStartDate(o));
    const sEnd = parseDate(withdrawalEligibleDate(o));
    if (!sStart || !sEnd) continue;
    rows.push({
      id: o.id,
      label: o.bankName,
      sub: formatCurrency(o.requiredFundingAmount),
      start: sStart,
      end: sEnd,
      status: CONFIRMED_OFFER_STATUSES.has(o.status) ? 'confirmed' : (o.status === 'completed' ? 'completed' : 'hypothetical'),
      isVirtual: true,
      color: offerColorHex(o),
      offerType: o.offerType
    });
  }
  rows.sort((a, b) => (a.start || 0) - (b.start || 0));

  // Compute shortfall bands
  const proj = generateProjection(App.state);
  const shortfallBands = projectionBands(proj, d => d.shortfall);

  // Generate axis ticks (one per month within horizon)
  const ticks = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  if (cursor < start) cursor = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  while (cursor < end) {
    ticks.push({
      pct: ((cursor - start) / (end - start)) * 100,
      label: cursor.toLocaleDateString('en-US', { month: 'short', year: cursor.getFullYear() !== TODAY.getFullYear() ? '2-digit' : undefined })
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  const totalDays = horizon;
  function pctFor(d) {
    if (!d) return null;
    const days = (d - start) / 86400000;
    return Math.max(0, Math.min(100, (days / totalDays) * 100));
  }

  const todayPct = (TODAY >= start && TODAY < end) ? pctFor(TODAY) : null;

  return `
    <div class="section-header">
      <div>
        <h2>Timeline</h2>
        <p>Capital commitments over the next ${horizon} days. Confirmed bars are solid, hypothetical bars are dashed.</p>
      </div>
      <div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;">
        <label class="checkbox-row">
          <input type="checkbox" data-action="toggle-filter" data-filter="timelineShowCompleted" ${App.filters.timelineShowCompleted ? 'checked' : ''} />
          <span style="font-size:13px;color:var(--text-secondary);">Show completed</span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" data-action="toggle-filter" data-filter="timelineShowCancelled" ${App.filters.timelineShowCancelled ? 'checked' : ''} />
          <span style="font-size:13px;color:var(--text-secondary);">Show cancelled</span>
        </label>
      </div>
    </div>

    ${rows.length === 0
      ? renderEmptyState('No commitments to plot', 'When you add offers or capital commitments, they will appear here as horizontal bars across time.')
      : (() => {
          const validRows = rows.filter(r => {
            const sPct = pctFor(r.start);
            const ePct = pctFor(r.end);
            return sPct != null && ePct != null && ePct > sPct;
          });
          const rowsHtml = validRows.map(r => {
            const sPct = pctFor(r.start);
            const ePct = pctFor(r.end);
            const w = ePct - sPct;
            return `
              <div class="timeline-row">
                <div class="timeline-row-label">
                  <span class="tl-row-name">${escapeHtml(r.label)}</span>
                  <span class="sub">${escapeHtml(r.sub)}</span>
                </div>
                <div class="timeline-row-track">
                  ${ticks.map(t => `<div class="tl-grid-line" style="left:${t.pct}%;"></div>`).join('')}
                  ${shortfallBands.map(b => {
                    const left = (b.from / totalDays) * 100;
                    const right = (b.to / totalDays) * 100;
                    return `<div class="tl-shortfall-band" style="left:${left}%;right:${100 - right}%;"></div>`;
                  }).join('')}
                  <div class="tl-bar ${r.status} ${r.color ? 'has-color' : ''}" style="left:${sPct}%;width:${w}%;${r.color ? `--offer-color:${r.color};` : ''}" title="${escapeHtml(r.label)}: ${formatDateMedium(r.start)} → ${formatDateMedium(r.end)}">
                    ${w > 1 ? (r.offerType === 'direct-deposit' ? 'DD' : formatCompactCurrency((function(){ if (r.isVirtual) { const o = App.state.offers.find(x=>x.id===r.id); return o ? o.requiredFundingAmount : 0; } const c = App.state.commitments.find(x=>x.id===r.id); return c ? c.amount : 0; })())) : ''}
                  </div>
                  ${todayPct != null ? `<div class="tl-today" style="left:${todayPct}%;"></div>` : ''}
                </div>
              </div>
            `;
          }).join('');
          return `
            <div class="timeline-wrap">
              <div class="timeline-row axis-row">
                <div class="timeline-row-label axis">${formatDateShort(start)} → ${formatDateShort(end)}</div>
                <div class="timeline-row-track axis">
                  <div class="tl-axis">
                    ${ticks.map(t => `<span class="tl-axis-tick" style="left:${t.pct}%;">${t.label}</span>`).join('')}
                    ${todayPct != null ? `<div class="tl-today" style="left:${todayPct}%;"></div>` : ''}
                  </div>
                </div>
              </div>
              ${rowsHtml}
            </div>

            <div class="chart-legend" style="margin-top:var(--space-4);">
              <span class="chart-legend-item"><span class="legend-swatch" style="background:rgba(91,92,246,0.2);border:1.5px solid var(--accent);"></span> Confirmed</span>
              <span class="chart-legend-item"><span class="legend-swatch" style="background:repeating-linear-gradient(45deg,rgba(91,92,246,0.10),rgba(91,92,246,0.10) 4px,rgba(91,92,246,0.18) 4px,rgba(91,92,246,0.18) 8px);border:1.5px dashed var(--accent);"></span> Hypothetical</span>
              <span class="chart-legend-item"><span class="legend-swatch" style="background:var(--bg);border:1.5px solid var(--border-strong);"></span> Completed</span>
              <span class="chart-legend-item"><span class="legend-swatch" style="background:rgba(232,113,113,0.22);"></span> Shortfall day</span>
            </div>
          `;
        })()
      }
  `;
}

/* ============================================================
   OFFERS VIEW
   ============================================================ */

// Offers-list sort options. 'default' preserves the array's existing order
// (insertion order — the same order the card grid and table showed before
// this control existed). The other three are stable sorts with nulls always
// last: a missing sort key never jumps ahead of a real value, and ties keep
// their original relative order. Applies identically to the card grid and the
// table view (both consume the same sorted array). Display-only — does not
// touch state, the feed, or the projection.
const OFFERS_SORT_OPTIONS = [
  { value: 'default',  label: 'Sort: Default' },
  { value: 'expiring', label: 'Expiring soon' },
  { value: 'newest',   label: 'Newest first' },
  { value: 'bonus',    label: 'Bonus value' }
];
function sortOffersList(list, mode) {
  if (!mode || mode === 'default') return list;
  // Decorate with original index so every comparator can fall back to it for a
  // stable result (Array.prototype.sort isn't guaranteed stable across the key
  // collisions we create by bucketing all nulls together).
  const decorated = list.map((o, i) => ({ o, i }));
  // nulls-last numeric compare: real values ascend/descend among themselves;
  // any null/blank key sorts after all present keys regardless of direction.
  const cmpNullsLast = (av, bv, dir) => {
    const aNull = av == null, bNull = bv == null;
    if (aNull && bNull) return 0;
    if (aNull) return 1;   // a after b
    if (bNull) return -1;  // a before b
    return dir === 'asc' ? (av - bv) : (bv - av);
  };
  let keyFn, cmp;
  if (mode === 'expiring') {
    // Soonest non-null offerExpirationDate first; nulls last. Compare as a
    // day-number so it's a pure numeric ascending compare (ISO parsed once).
    keyFn = (o) => { const d = parseDate(o.offerExpirationDate); return d ? startOfDay(d).getTime() : null; };
    cmp = (a, b) => cmpNullsLast(keyFn(a.o), keyFn(b.o), 'asc') || (a.i - b.i);
  } else if (mode === 'newest') {
    // Most-recently edited first (last_edited desc); offers never edited
    // (last_edited null) sort last.
    keyFn = (o) => { const t = o.last_edited ? Date.parse(o.last_edited) : NaN; return Number.isFinite(t) ? t : null; };
    cmp = (a, b) => cmpNullsLast(keyFn(a.o), keyFn(b.o), 'desc') || (a.i - b.i);
  } else if (mode === 'bonus') {
    // Largest signup bonus first; a MISSING amount (null/undefined/'') sorts
    // last. Must map blank → null BEFORE Number() — Number(null) is 0, which
    // would wrongly bucket a missing bonus with a genuine $0 (killing the
    // nulls-last branch). A real 0 still sorts as 0 (among present values).
    keyFn = (o) => {
      const v = o.signupBonusAmount;
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    cmp = (a, b) => cmpNullsLast(keyFn(a.o), keyFn(b.o), 'desc') || (a.i - b.i);
  } else {
    return list;
  }
  decorated.sort(cmp);
  return decorated.map(d => d.o);
}

function renderOffers() {
  const all = App.state.offers.slice();
  const filtered = all.filter(o => {
    // 'included' is a synthetic status used by the "Selected bonuses" stat-
    // card click-through — it filters to offers that are currently part of
    // the projection (confirmed status OR scenario flag), spanning multiple
    // raw status values. Anything else is a literal status match.
    if (App.filters.offersStatus === 'included') {
      if (!offerIsActiveForProjection(o)) return false;
    } else if (App.filters.offersStatus !== 'all' && o.subStatus !== App.filters.offersStatus) {
      return false;
    }
    if (App.filters.offersSearch) {
      const q = App.filters.offersSearch.toLowerCase();
      if (!(o.bankName + ' ' + (o.offerName || '') + ' ' + (o.notes || '')).toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sorted = sortOffersList(filtered, App.filters.offersSort);
  const advanced = App.filters.offersAdvanced;

  return `
    <div class="section-header">
      <div>
        <h2>Offers</h2>
        <p>${all.length} total · ${all.filter(o => isOfferComplete(o)).length} complete · ${all.filter(o => !isOfferComplete(o)).length} drafts</p>
      </div>
      <div style="display:flex;gap:var(--space-2);">
        <button class="btn btn-secondary" data-action="toggle-advanced">${advanced ? 'Card view' : 'Table view'}</button>
        <button class="btn btn-primary" data-action="add-offer">+ Add offer</button>
      </div>
    </div>

    <div class="toolbar">
      <input id="offers-search-input" type="search" class="input" placeholder="Search offers..." style="max-width:280px;" data-action="offers-search" value="${escapeAttr(App.filters.offersSearch)}" autocomplete="off" />
      <select class="select" style="max-width:200px;" data-action="offers-status">
        <option value="all" ${App.filters.offersStatus === 'all' ? 'selected' : ''}>All statuses</option>
        <option value="included" ${App.filters.offersStatus === 'included' ? 'selected' : ''}>Included in projection</option>
        ${SUB_STATUSES.map(s => `<option value="${s}" ${App.filters.offersStatus === s ? 'selected' : ''}>${SUB_STATUS_LABELS[s]}</option>`).join('')}
      </select>
      <select class="select" style="max-width:180px;" data-action="offers-sort" aria-label="Sort offers">
        ${OFFERS_SORT_OPTIONS.map(s => `<option value="${s.value}" ${App.filters.offersSort === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}
      </select>
    </div>

    ${filtered.length === 0
      ? renderEmptyState(all.length === 0 ? 'No offers yet' : 'No offers match', all.length === 0 ? 'Add your first bank bonus to start planning.' : 'Try changing the filter or search query.', all.length === 0 ? 'add-offer' : null, all.length === 0 ? 'Add an offer' : null)
      : (advanced ? renderOffersTable(sorted) : `<div class="planner-grid">${sorted.map(renderOfferCardWithActions).join('')}</div>`)
    }
  `;
}

function renderOfferCardWithActions(o) {
  const card = renderOfferCard(o);
  const actions = `
    <div class="offer-actions" style="margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--border-soft);">
      <button class="btn btn-ghost btn-sm" data-action="duplicate-offer" data-id="${o.id}">Duplicate</button>
      <button class="btn btn-ghost btn-sm" data-action="convert-offer" data-id="${o.id}" title="Lock this offer in as a commitment on your timeline">Commit</button>
      <button class="btn btn-ghost btn-sm" data-action="save-offer-as-template-card" data-id="${o.id}" title="Save these offer terms as a reusable template (your personal dates, notes and status are not saved)">Template</button>
      <select class="select" style="height:30px;padding:4px 8px;font-size:12px;width:auto;flex:1;min-width:120px;" data-action="change-status" data-id="${o.id}" title="Offer status">
        ${SUB_STATUSES.map(s => `<option value="${s}" ${o.subStatus === s ? 'selected' : ''}>${SUB_STATUS_LABELS[s]}</option>`).join('')}
      </select>
      <button class="btn btn-ghost btn-sm btn-danger" data-action="delete-offer" data-id="${o.id}" aria-label="Delete">Delete</button>
    </div>
  `;
  // Insert actions inside the offer-card, just before its closing tag.
  const lastIdx = card.lastIndexOf('</div>');
  return card.slice(0, lastIdx) + actions + card.slice(lastIdx);
}

function renderOffersTable(offers) {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Bank / Offer</th>
            <th class="num">Funding</th>
            <th class="num">Bonus</th>
            <th class="num">Lock days</th>
            <th>Fund date</th>
            <th>Capital back</th>
            <th class="num">APY</th>
            <th>Offer status</th>
            <th>Entity</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${offers.map(o => {
            const ar = annualizedReturn(o);
            const ls = lockStartDate(o);
            const we = withdrawalEligibleDate(o);
            const actualDays = (ls && we) ? daysBetween(parseDate(ls), parseDate(we)) : null;
            return `
              <tr>
                <td>
                  <div style="font-weight:500;">${escapeHtml(o.bankName)}</div>
                  <div style="font-size:11px;color:var(--text-tertiary);">${escapeHtml(displayOfferName(o.offerName))}</div>
                </td>
                <td class="num">${formatCurrency(o.requiredFundingAmount)}</td>
                <td class="num" style="color:var(--success);font-weight:600;">${formatCurrency(o.signupBonusAmount)}</td>
                <td class="num" title="${o.lockStartsFrom === 'open date' ? 'Bank requires ' + (o.daysFundsMustRemain ?? '—') + ' days from open; actual lock = ' + (actualDays ?? '—') : 'Days funds must remain'}">${actualDays ?? (o.daysFundsMustRemain ?? '—')}${o.lockStartsFrom === 'open date' && actualDays != null ? ` <span style="color:var(--text-tertiary);">/ ${o.daysFundsMustRemain}</span>` : ''}</td>
                <td>${formatDateShort(ls) || '—'}</td>
                <td>${formatDateShort(we) || '—'}</td>
                <td class="num">${ar != null ? formatPercent(ar) : '—'}</td>
                <td><span class="chip ${SUB_STATUS_CHIP_CLASS[o.subStatus] || 'chip-muted'}">${SUB_STATUS_LABELS[o.subStatus] || STATUS_LABELS[o.status]}</span>${o.accountStatus === 'closed' ? ' <span class="chip chip-muted">Closed</span>' : ''}${(() => { const c = requirementChecklistCounts(o); return c.total > 0 ? ` <span class="chip ${c.done >= c.total ? 'chip-success' : 'chip-muted'}" title="Requirements met">${c.done}/${c.total} reqs</span>` : ''; })()}</td>
                <td style="color:var(--text-tertiary);font-size:12px;">${escapeHtml(o.entityUsed || '—')}</td>
                <td>
                  <div class="row-action-buttons">
                    <button class="btn-icon" data-action="edit-offer" data-id="${o.id}" aria-label="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
                    <button class="btn-icon" data-action="duplicate-offer" data-id="${o.id}" aria-label="Duplicate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ============================================================
   SETTINGS VIEW
   ============================================================ */
function renderSettings() {
  const s = App.state.settings;
  return `
    <div class="section-header">
      <div>
        <h2>Settings</h2>
        <p>Configure liquid capital, buffer, projection horizon, and manage data.</p>
      </div>
    </div>

    <section class="form-section">
      <h2>Capital & projection</h2>
      <p class="section-desc">These values drive the daily cash projection on the Overview.</p>
      <div class="form-grid" id="capital-grid">
        <div class="field">
          <div class="field-box">
            <label for="s-liquid">Current liquid capital</label>
            <div class="input-group">
              <span class="input-prefix">$</span>
              <input id="s-liquid" type="text" inputmode="decimal" data-money class="input" value="${formatMoneyInput(s.currentLiquidCapital)}" data-setting="currentLiquidCapital" />
            </div>
          </div>
          <span class="field-hint">Cash available to deploy right now.</span>
        </div>
        <div class="field">
          <div class="field-box">
            <label for="s-buffer">Minimum cash buffer</label>
            <div class="input-group">
              <span class="input-prefix">$</span>
              <input id="s-buffer" type="text" inputmode="decimal" data-money class="input" value="${formatMoneyInput(s.minimumCashBuffer)}" data-setting="minimumCashBuffer" />
            </div>
          </div>
          <span class="field-hint">Days below this threshold are flagged but not breached.</span>
        </div>
        <div class="field">
          <div class="field-box">
            <label for="s-start">Projection start date</label>
            <input id="s-start" type="date" class="input" value="${s.projectionStartDate}" data-setting="projectionStartDate" />
          </div>
          <span class="field-hint">Auto-advances to today each day.</span>
        </div>
        <div class="field">
          <div class="field-box">
            <label for="s-horizon-mode">Projection horizon</label>
            <select id="s-horizon-mode" class="select" data-setting="projectionHorizonMode">
              <option value="auto" ${(s.projectionHorizonMode || 'auto') === 'auto' ? 'selected' : ''}>Auto (1 mo past last bonus)</option>
              <option value="3months" ${s.projectionHorizonMode === '3months' ? 'selected' : ''}>3 months</option>
              <option value="6months" ${s.projectionHorizonMode === '6months' ? 'selected' : ''}>6 months</option>
              <option value="1year" ${s.projectionHorizonMode === '1year' ? 'selected' : ''}>1 year</option>
              <option value="2years" ${s.projectionHorizonMode === '2years' ? 'selected' : ''}>2 years</option>
              <option value="custom" ${s.projectionHorizonMode === 'custom' ? 'selected' : ''}>Custom days…</option>
            </select>
          </div>
          <span class="field-hint">Currently showing <strong>${effectiveHorizonDays(App.state)} days</strong>.</span>
        </div>
        ${(s.projectionHorizonMode === 'custom') ? `
        <div class="field">
          <div class="field-box">
            <label for="s-horizon">Custom horizon (days)</label>
            <input id="s-horizon" type="number" min="30" max="1825" step="1" class="input" value="${s.projectionHorizonDays}" data-setting="projectionHorizonDays" />
          </div>
        </div>` : ''}
        <div class="field">
          <label>Default lock interval start</label>
          <div class="radio-group">
            <input type="radio" id="lock-fund" name="defaultLockStartsFrom" value="funded date" ${s.defaultLockStartsFrom === 'funded date' ? 'checked' : ''} data-setting="defaultLockStartsFrom" />
            <label for="lock-fund">Funded date</label>
            <input type="radio" id="lock-open" name="defaultLockStartsFrom" value="open date" ${s.defaultLockStartsFrom === 'open date' ? 'checked' : ''} data-setting="defaultLockStartsFrom" />
            <label for="lock-open">Open date</label>
          </div>
        </div>
        <div class="field" style="grid-column:1 / -1;">
          <label>Direct-deposit transfer timing (business days)</label>
          <span class="field-hint">Round trip for a DD: initiate → <strong>in</strong> days → posts → <strong>season</strong> days → sent back → <strong>back</strong> days → returns. Weekends/holidays extend each leg. Drives DD held-days and ROI.</span>
          <div class="dd-timing-row">
            <div class="input-group with-suffix">
              <input type="number" min="0" max="10" step="1" class="input" value="${(s.ddTransfer && s.ddTransfer.inDays) ?? 1}" data-setting="ddTransfer.inDays" aria-label="Transfer in days" />
              <span class="input-suffix">in</span>
            </div>
            <div class="input-group with-suffix">
              <input type="number" min="0" max="10" step="1" class="input" value="${(s.ddTransfer && s.ddTransfer.seasonDays) ?? 1}" data-setting="ddTransfer.seasonDays" aria-label="Season days" />
              <span class="input-suffix">season</span>
            </div>
            <div class="input-group with-suffix">
              <input type="number" min="0" max="10" step="1" class="input" value="${(s.ddTransfer && s.ddTransfer.backDays) ?? 1}" data-setting="ddTransfer.backDays" aria-label="Transfer back days" />
              <span class="input-suffix">back</span>
            </div>
          </div>
        </div>
      </div>
      <div class="banner" style="margin-top:var(--space-5);">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16.01"/></svg>
        <div>
          <strong>Interval convention:</strong> A commitment with start <em>A</em> and end <em>B</em> ties up funds on each day <em>d</em> where <em>A ≤ d &lt; B</em>. If money lands March 1 and is withdrawal-eligible May 1, it is tied up March 1 through April 30 (61 days).
        </div>
      </div>
    </section>

    <section class="form-section">
      <h2>My source banks</h2>
      <p class="section-desc">The accounts you can push money <em>from</em> to fund offers / make direct deposits. Used to cross-reference which of your banks have a track record of coding as a direct deposit at a given offer's bank (Doctor of Credit datapoints).</p>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-3);">
        <input id="source-bank-input" class="input" type="text" placeholder="e.g. Chase, Ally, Fidelity…" style="max-width:280px;" data-action="source-bank-keydown" autocomplete="off" />
        <button class="btn btn-secondary" data-action="add-source-bank">+ Add bank</button>
      </div>
      ${(s.sourceBanks && s.sourceBanks.length)
        ? `<div style="display:flex;gap:8px;flex-wrap:wrap;">${s.sourceBanks.map(b => `
            <span class="chip chip-accent" style="display:inline-flex;align-items:center;gap:6px;padding:5px 8px 5px 12px;font-size:13px;text-transform:none;letter-spacing:0;">
              ${escapeHtml(b)}
              <button class="btn-icon" data-action="remove-source-bank" data-bank="${escapeAttr(b)}" aria-label="Remove ${escapeAttr(b)}" style="width:18px;height:18px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
              </button>
            </span>`).join('')}</div>`
        : `<p style="font-size:13px;color:var(--text-tertiary);">No source banks added yet.</p>`}
    </section>

    <section class="form-section">
      <div class="card-header" style="margin-bottom:var(--space-4);">
        <h2>Capital commitments</h2>
        <button class="btn btn-secondary btn-sm" data-action="add-commitment">+ Add commitment</button>
      </div>
      <p class="section-desc">Manual holds (CDs, lockups, etc.). Bonus offers create their own virtual commitments automatically.</p>
      ${App.state.commitments.length === 0
        ? `<div class="empty-state" style="padding:var(--space-8);"><h3 style="font-size:15px;">No manual commitments</h3><p>Most offers do not need this — only add a commitment for non-bonus capital you want to hold out.</p></div>`
        : renderCommitmentsTable()
      }
    </section>

    <section class="form-section">
      <div class="card-header" style="margin-bottom:var(--space-4);">
        <h2>Capital events</h2>
        <button class="btn btn-secondary btn-sm" data-action="add-event">+ Add event</button>
      </div>
      <p class="section-desc">One-time inflows (paychecks, sale proceeds) or outflows (taxes, big expenses) that change your liquid capital on a specific date.</p>
      ${App.state.events.length === 0
        ? `<div class="empty-state" style="padding:var(--space-8);"><h3 style="font-size:15px;">No capital events</h3><p>Add upcoming inflows/outflows to make the projection more accurate.</p></div>`
        : renderEventsTable()
      }
    </section>

    ${renderSyncSection()}

    <section class="form-section">
      <h2>Data</h2>
      <p class="section-desc">Export your data to JSON to back up or transfer between devices. Import to restore.</p>
      <div class="btn-grid">
        <button class="btn btn-secondary" data-action="export-json">Export JSON</button>
        <label class="btn btn-secondary" style="cursor:pointer;">
          Import JSON
          <input type="file" accept="application/json" style="display:none;" data-action="import-json" />
        </label>
        <button class="btn btn-secondary" data-action="reset-sample">Reset to sample data</button>
        <button class="btn btn-secondary btn-danger" data-action="clear-all">Clear all data</button>
        ${hasPreV2Backup() ? `<button class="btn btn-outline-danger" data-action="restore-pre-v2">Restore backup</button>` : ''}
      </div>
    </section>

    <section class="form-section">
      <h2>Daily projection (debug)</h2>
      <p class="section-desc">Raw daily output of the cash projection over your horizon. Useful for verifying the math.</p>
      <details>
        <summary style="cursor:pointer;font-size:13px;color:var(--text-secondary);padding:8px 0;">Show full daily table (${effectiveHorizonDays(App.state)} rows)</summary>
        ${renderProjectionDebugTable()}
      </details>
    </section>

    <section class="form-section">
      <h2>About &amp; diagnostics</h2>
      <p class="section-desc">Build identifier and a log of the most recent errors. If something looks wrong, tap <strong>Copy diagnostics</strong> and include the text when reporting it.</p>
      <div class="about-grid">
        <div class="about-item"><span class="about-label">Version</span><span class="about-value">v${escapeHtml(APP_VERSION)}</span></div>
        <div class="about-item"><span class="about-label">Local storage</span><span class="about-value">${storageHealth()}</span></div>
        <div class="about-item"><span class="about-label">Cloud sync</span><span class="about-value">${Sync.isConfigured() ? 'Configured' : 'Not configured'}</span></div>
      </div>
      ${renderDiagnostics()}
    </section>
  `;
}

function renderDiagnostics() {
  const log = readDiagLog();
  if (!log.length) return `<p class="diag-empty">No errors logged — all clear.</p>`;
  return `
    <div class="diag-actions">
      <button class="btn btn-secondary btn-sm" data-action="copy-diag">Copy diagnostics</button>
      <button class="btn btn-secondary btn-sm btn-danger" data-action="clear-diag">Clear log</button>
    </div>
    <div class="diag-log">
      ${log.map(e => `
        <div class="diag-entry">
          <div class="diag-head"><span class="diag-code">${escapeHtml(e.code)}</span><span class="diag-time">${escapeHtml(formatDiagTime(e.t))}</span></div>
          <div class="diag-msg">${escapeHtml(e.msg || '(no message)')}</div>
          ${e.ctx ? `<div class="diag-ctx">@ ${escapeHtml(e.ctx)}</div>` : ''}
        </div>`).join('')}
    </div>`;
}

function formatDiagTime(iso) {
  return formatLocalDateTime(iso, { guard: false, fallback: iso || '' });
}

/* Plain-text report for the clipboard — version + environment header, then
   every logged error with its stack. */
function diagReportText() {
  const log = readDiagLog();
  const head = [
    'Yield Vector — diagnostics',
    'Version:   v' + APP_VERSION,
    'Generated: ' + new Date().toISOString(),
    'Storage:   ' + storageHealth(),
    'Sync:      ' + (Sync.isConfigured() ? 'configured' : 'not configured'),
    'UA:        ' + (navigator.userAgent || 'n/a'),
    'Errors:    ' + log.length,
  ].join('\n');
  const body = log.map(e =>
    `\n[${e.code}] ${e.t}\n  ${e.msg}${e.ctx ? '\n  @ ' + e.ctx : ''}${e.stack ? '\n  ' + e.stack.replace(/\n/g, '\n  ') : ''}`
  ).join('\n');
  return head + '\n' + (body || '\n(no errors)');
}

function renderCommitmentsTable() {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th style="min-width:140px;">Name</th>
            <th class="num">Amount</th>
            <th style="min-width:90px;">Start</th>
            <th style="min-width:90px;">End</th>
            <th>Type</th>
            <th>Status</th>
            <th>In projection</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${App.state.commitments.map(c => `
            <tr>
              <td>
                <div style="font-weight:500;">${escapeHtml(displayOfferName(c.commitmentName.replace(/(\s*[-–—]\s*|\s+)Bonus\s*$/i, '').trim()))}</div>
                ${c.sourceBonusOfferId ? `<div style="font-size:11px;color:var(--text-tertiary);">Linked to offer</div>` : ''}
              </td>
              <td class="num">${formatCurrency(c.amount)}</td>
              <td>${formatDateShort(c.startDate)}</td>
              <td>${formatDateShort(c.endDate)}</td>
              <td><span class="chip chip-muted">${escapeHtml(c.type)}</span></td>
              <td><span class="chip ${c.status === 'confirmed' ? 'chip-accent' : c.status === 'completed' ? 'chip-success' : c.status === 'cancelled' ? 'chip-danger' : 'chip-muted'}">${escapeHtml(c.status)}</span></td>
              <td>${c.includeInProjection ? '✓' : '—'}</td>
              <td>
                <div class="row-action-buttons">
                  <button class="btn-icon" data-action="edit-commitment" data-id="${c.id}" aria-label="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
                  <button class="btn-icon btn-danger" data-action="delete-commitment" data-id="${c.id}" aria-label="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderEventsTable() {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th style="min-width:140px;">Event</th>
            <th style="min-width:90px;">Date</th>
            <th style="text-align:center;">Amount</th>
            <th>Category</th>
            <th style="text-align:center;">Include</th>
            <th style="text-align:center;">Display</th>
            <th style="text-align:center;">Upcoming</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${App.state.events.map(e => `
            <tr>
              <td><div style="font-weight:500;">${escapeHtml(e.eventName)}</div>${e.notes ? `<div style="font-size:11px;color:var(--text-tertiary);">${escapeHtml(e.notes)}</div>` : ''}</td>
              <td>${formatDateMedium(e.date)}</td>
              <td style="text-align:center;color:${e.amount >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:600;font-feature-settings:'tnum' 1;">${e.amount >= 0 ? '+' : ''}${formatCurrency(e.amount)}</td>
              <td><span class="chip chip-muted">${escapeHtml(e.category)}</span></td>
              <td style="text-align:center;">${e.includeInProjection ? '✓' : '—'}</td>
              <td style="text-align:center;">${e.showOnChart !== false ? '✓' : '—'}</td>
              <td style="text-align:center;">${e.showInUpcoming !== false ? '✓' : '—'}</td>
              <td>
                <div class="row-action-buttons">
                  <button class="btn-icon" data-action="edit-event" data-id="${e.id}" aria-label="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
                  <button class="btn-icon btn-danger" data-action="delete-event" data-id="${e.id}" aria-label="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderSyncSection() {
  const cfg = Sync.getConfig() || {};
  const configured = Sync.isConfigured();
  const lastSyncText = formatLocalDateTime(Sync.lastSyncAt);
  const stateMod = formatLocalDateTime(App.state && App.state._lastModified);
  const statusColor = {
    synced: 'var(--success)',
    syncing: 'var(--warning)',
    pending: 'var(--warning)',
    error: 'var(--danger)',
    unconfigured: 'var(--text-tertiary)'
  }[Sync.status] || 'var(--text-tertiary)';

  return `
    <section class="form-section" id="sync-section">
      <h2>Cloud sync</h2>
      <p class="section-desc">Sync your planner across devices via a private GitHub Gist. Free, end-to-end controlled by you, requires only a "gist"-scoped Personal Access Token.</p>

      <div style="display:flex;align-items:center;gap:10px;font-size:13px;margin-bottom:var(--space-4);">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${statusColor};"></span>
        <span style="color:var(--text-secondary);"><strong style="color:var(--text);">${({synced:'Synced',syncing:'Syncing…',pending:'Push pending',error:'Error',unconfigured:'Not configured'})[Sync.status] || Sync.status}</strong>${Sync.lastError ? ' — ' + escapeHtml(Sync.lastError) : ''}</span>
      </div>

      <div class="form-grid">
        <div class="field">
          <div class="field-box">
            <label for="sync-gist">Gist ID</label>
            <input id="sync-gist" class="input" type="text" placeholder="e.g. a1b2c3d4e5..." value="${escapeAttr(cfg.gistId || '')}" autocomplete="off" spellcheck="false" />
          </div>
          <span class="field-hint">From the Gist URL: <code>gist.github.com/&lt;you&gt;/<strong>this-part</strong></code></span>
        </div>
        <div class="field">
          <div class="field-box">
            <label for="sync-token">Personal Access Token</label>
            <input id="sync-token" class="input" type="password" placeholder="ghp_... or github_pat_..." value="${escapeAttr(cfg.token || '')}" autocomplete="off" spellcheck="false" />
          </div>
          <span class="field-hint">Stored locally per device. Scope: only <strong>gist</strong>.</span>
        </div>
        <div class="field" style="grid-column: 1 / -1;">
          <div class="field-box">
            <label for="sync-doc-worker">DoC import Worker URL</label>
            <input id="sync-doc-worker" class="input" type="url" placeholder="https://…workers.dev" value="${escapeAttr(Sync.getDocWorkerUrl())}" autocomplete="off" spellcheck="false" />
          </div>
          <span class="field-hint">Optional — enables URL import for offers; see <code>cloudflare/README.md</code>. Leave empty to paste posts manually.</span>
        </div>
        <div class="field" style="grid-column: 1 / -1;">
          <div class="field-box">
            <label for="sync-doc-worker-secret">Worker secret (optional)</label>
            <input id="sync-doc-worker-secret" class="input" type="password" placeholder="only if you set WORKER_SECRET" value="${escapeAttr(Sync.getDocWorkerSecret())}" autocomplete="off" spellcheck="false" />
          </div>
          <span class="field-hint">Stored locally per device, never synced. Set this only if the Worker has a <code>WORKER_SECRET</code> — recommended, it locks out non-browser callers.</span>
        </div>
      </div>

      <div class="btn-grid" style="margin-top:var(--space-3);">
        <button class="btn btn-secondary" data-action="doc-worker-save">Save Worker settings</button>
      </div>

      <div id="sync-buttons" class="btn-grid" style="margin-top:var(--space-4);">
        <button class="btn btn-primary" data-action="sync-save">Save &amp; test</button>
        <button class="btn btn-secondary" data-action="sync-create-gist">Create new Gist</button>
        <!-- Pull/Push/Disconnect: enabled whenever credentials are *present*
             — either already saved (Sync.isConfigured()) or just typed into
             the inputs above. updateSyncButtonsLive() re-evaluates on every
             keystroke so the buttons light up as soon as you've entered
             both fields. The click handlers also auto-save first, so the
             user doesn't have to click "Save & test" before pulling. -->
        <button class="btn btn-secondary" data-action="sync-pull" ${configured ? '' : 'disabled'}>Pull now</button>
        <button class="btn btn-secondary" data-action="sync-push" ${configured ? '' : 'disabled'}>Push now</button>
        <button class="btn btn-secondary" data-action="sync-history" ${configured ? '' : 'disabled'} title="Recover an earlier version from the Gist's revision history">Restore from history</button>
        <button class="btn btn-outline-danger" data-action="sync-disconnect" ${configured ? '' : 'disabled'}>Disconnect</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);margin-top:var(--space-4);font-size:12px;color:var(--text-tertiary);">
        <div>Last cloud sync: <span style="color:var(--text-secondary);">${lastSyncText}</span></div>
        <div>Local state modified: <span style="color:var(--text-secondary);">${stateMod}</span></div>
      </div>

      <div class="banner" style="margin-top:var(--space-5);">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16.01"/></svg>
        <div>
          <strong>First-time setup (per account, not per device):</strong>
          <ol style="margin:8px 0 0 18px;font-size:13px;line-height:1.7;">
            <li>Go to <a href="https://github.com/settings/tokens" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline;">github.com/settings/tokens</a> → <em>Generate new token</em> → <em>classic</em> → check <strong>only</strong> the <code>gist</code> scope → set "No expiration" or 1 year. Copy the token (starts with <code>ghp_</code>).</li>
            <li>Paste the token above, leave Gist ID empty, then click <strong>Create new Gist</strong>. The app will create a private Gist and fill in the ID for you.</li>
            <li>On every other device: open the same URL, paste the same token + Gist ID, click <strong>Save &amp; test</strong>. Your data appears.</li>
          </ol>
          <p style="margin-top:8px;font-size:12px;">Pushes are debounced (~2.5s after edits stop). Conflict rule: every push first checks the cloud's revision lineage — a device that's behind adopts the cloud instead of overwriting it, and if both sides changed you're asked which to keep. A device is never silently overwritten by stale data.</p>
        </div>
      </div>
    </section>
  `;
}

function renderProjectionDebugTable() {
  const proj = generateProjection(App.state);
  // Sample to avoid massive DOM: every day for first 60, then weekly
  const rows = [];
  for (let i = 0; i < proj.length; i++) {
    if (i < 60 || i % 7 === 0) rows.push(proj[i]);
  }
  return `
    <div class="table-wrap" style="margin-top:var(--space-3);max-height:480px;overflow-y:auto;">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th class="num">Liquid</th>
            <th class="num">Net Events</th>
            <th class="num">Confirmed Tied</th>
            <th class="num">Hypo Tied</th>
            <th class="num">Available</th>
            <th>Flag</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(d => `
            <tr class="${d.shortfall ? 'row-danger' : (d.belowBuffer ? 'row-warn' : '')}">
              <td>${formatDateShort(d.date)}</td>
              <td class="num">${formatCurrency(d.startingLiquidCapital)}</td>
              <td class="num">${formatCurrency(d.netEventsToDate)}</td>
              <td class="num">${formatCurrency(d.confirmedTiedUp)}</td>
              <td class="num">${formatCurrency(d.hypotheticalTiedUp)}</td>
              <td class="num"><strong>${formatCurrency(d.availableCapital)}</strong></td>
              <td>${d.shortfall ? '🚨 Shortfall' : (d.belowBuffer ? '⚠️ Buffer' : '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ============================================================
   EMPTY STATE
   ============================================================ */
function renderEmptyState(title, body, action = null, actionLabel = null) {
  return `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M12 3v18"/></svg>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
      ${action ? `<button class="btn btn-primary" data-action="${action}">${escapeHtml(actionLabel || '')}</button>` : ''}
    </div>
  `;
}

/* ============================================================
   CHART RENDERING — Available Capital Over Time
   ============================================================ */
function renderChartsAfterMount() {
  const heroChart = document.getElementById('hero-chart');
  if (heroChart) renderHeroChart(heroChart);
  // Defensive sync-input pre-fill: even though renderSyncSection() sets
  // value="..." in the HTML template from Sync.getConfig(), set the
  // .value DOM property directly here too so anything that empties an
  // input between render and paint (browser autocomplete clearing,
  // HTML-attribute quirks, etc.) gets corrected. Read from both the
  // canonical Sync.getConfig() AND App.state.settings as a fallback —
  // covers any case where credentials ended up on App.state instead
  // of in the dedicated localStorage key.
  prefillSyncInputs();
  updateSyncButtonsLive();
}

function prefillSyncInputs() {
  const gistInput = document.getElementById('sync-gist');
  const tokenInput = document.getElementById('sync-token');
  if (!gistInput && !tokenInput) return;
  const cfg = Sync.getConfig() || {};
  const settings = (App.state && App.state.settings) || {};
  // Resolution order: Sync config (canonical) → App.state.settings
  // (legacy fallback for older state files). Key aliases cover both
  // naming conventions that have appeared in past code.
  const gistId = cfg.gistId || settings.gistId || settings.gistID || '';
  const token  = cfg.token  || settings.gistToken || settings.token || '';
  if (gistInput && gistInput.value === '' && gistId) gistInput.value = gistId;
  if (tokenInput && tokenInput.value === '' && token) tokenInput.value = token;
  // If we recovered creds from App.state.settings (legacy path), promote
  // them into the canonical Sync config so subsequent isConfigured()
  // calls succeed and the user doesn't have to re-save.
  if ((gistId && !cfg.gistId) || (token && !cfg.token)) {
    if (gistId && token) Sync.setConfig({ gistId, token });
  }
}

function renderHeroChart(svg) {
  const proj = generateProjection(App.state);
  if (!proj.length) return;

  const wrap = document.getElementById('hero-chart-wrap');
  const tooltip = document.getElementById('chart-tooltip');
  const W = 800, H = 360;
  // padL is small because the $ axis labels now render in the sticky HTML
  // .chart-yaxis sibling (48px) to the left of the SVG, not inside it.
  const padL = 8, padR = 28, padT = 16, padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const buffer = App.state.settings.minimumCashBuffer;
  const liquid = App.state.settings.currentLiquidCapital;

  // Y range: padded
  let minY = Math.min(0, buffer * 0.5);
  let maxY = liquid;
  for (const d of proj) {
    if (d.availableCapital < minY) minY = d.availableCapital;
    if (d.availableCapital > maxY) maxY = d.availableCapital;
  }
  if (buffer < minY) minY = buffer;
  if (buffer > maxY) maxY = buffer;
  const actualMinCapital = proj.reduce((m, d) => Math.min(m, d.availableCapital), Infinity);
  const yPad = (maxY - minY) * 0.12 || 1000;
  minY = minY - yPad * 0.4;
  maxY = maxY + yPad * 0.6;
  if (maxY === minY) { maxY += 1000; minY -= 1000; }

  function xFor(i) { return padL + (i / (proj.length - 1)) * innerW; }
  function yFor(v) { return padT + (1 - (v - minY) / (maxY - minY)) * innerH; }

  // Y-axis ticks
  const yTicks = niceTicks(minY, maxY, 4);

  // X-axis: month labels. Skip the first month tick if it falls within
  // ~12 days of "Today" — otherwise the labels collide.
  const start = parseDate(App.state.settings.projectionStartDate) || TODAY;
  const xTicks = [];
  let cursor = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  let isFirstTick = true;
  while (true) {
    const dayOffset = Math.round((cursor - start) / 86400000);
    if (dayOffset >= proj.length) break;
    const tooCloseToToday = isFirstTick && dayOffset < 4;
    if (dayOffset > 0 && !tooCloseToToday) {
      // Show year too if it crosses into a new year
      // Only show the year on January (when the year actually changes), and
      // use the FULL year ("Jan 2027") to avoid confusion with day-of-month
      // labels like "Jun 25" elsewhere on the chart.
      const showYear = cursor.getMonth() === 0 && cursor.getFullYear() !== start.getFullYear();
      xTicks.push({
        i: dayOffset,
        // Keep the tick's true first-of-month Date so downstream month/year
        // comparisons don't reconstruct it from start+i*86400000 — that ms
        // arithmetic drifts an hour across a DST boundary and can land the
        // date in the previous month (the "Dec Dec 11" horizon-label bug).
        date: new Date(cursor),
        label: cursor.toLocaleDateString('en-US', showYear ? { month: 'short', year: 'numeric' } : { month: 'short' })
      });
    }
    isFirstTick = false;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  // Build path
  let linePath = '';
  let areaPath = '';
  for (let i = 0; i < proj.length; i++) {
    const x = xFor(i);
    const y = yFor(proj[i].availableCapital);
    linePath += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    areaPath += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
  }
  areaPath += `L${xFor(proj.length - 1).toFixed(1)} ${(padT + innerH).toFixed(1)} L${padL} ${(padT + innerH).toFixed(1)} Z`;

  // Shortfall band rects
  const shortfallBands = projectionBands(proj, d => d.shortfall).map(b => {
    const x1 = xFor(b.from);
    const x2 = xFor(b.to);
    return `<rect x="${x1}" y="${padT}" width="${Math.max(2, x2 - x1)}" height="${innerH}" fill="rgba(239, 68, 68, 0.07)" />`;
  }).join('');

  // Markers: funding dates, withdrawal dates, deposit deadlines, events.
  // For direct-deposit offers, emit one fund marker per planned DD
  // (teal-tinted to differentiate from the held-offer indigo fund
  // marker) so each individual deposit shows on the chart.
  //
  // Tooltip naming: prefer bank-only ("Wings CU") to keep the tooltip
  // narrow. Only fall back to bank + offer name ("Chase — Sapphire
  // $1500") when the same bank has 2+ active offers in the projection —
  // i.e. only when bank-alone would be ambiguous.
  const activeOffers = App.state.offers.filter(o => offerIsActiveForProjection(o));
  const bankActiveCount = new Map();
  for (const o of activeOffers) {
    bankActiveCount.set(o.bankName, (bankActiveCount.get(o.bankName) || 0) + 1);
  }
  const displayName = (o) => {
    const ambiguous = (bankActiveCount.get(o.bankName) || 0) > 1;
    return ambiguous ? offerDisplayLabel(o) : o.bankName;
  };
  const markers = [];
  // Feature 2 (2026-07-13b): compute the offer MARKERS (fund/withdraw/DD/deposit-
  // deadline dots) from EFFECTIVE (treated-as-today) dates, keyed on the same
  // projectionStartDate the curve above uses (generateProjection shifts it too),
  // so the dots land on the shifted curve instead of the stale raw dates. No-op
  // (same ref) for non-stale offer sets. [review-after P2 fold]
  const heroEffToday = App.state.settings.projectionStartDate || isoDate(TODAY);
  for (const o of mapEffectiveOffers(App.state.offers, heroEffToday)) {
    if (!offerIsActiveForProjection(o)) continue;
    const name = displayName(o);
    const offerColor = offerColorHex(o);  // '' if none — falls back to white stroke
    const psO = pathState(o);   // EITHER/OR: only the active path's markers render
    const withd = parseDate(withdrawalEligibleDate(o));
    const ddl = parseDate(depositDeadline(o));
    // Per-DD markers (teal) for both DD types — only when the DD path is active
    // (a debit-path offer ties up no capital, so no DD markers) [review-after P2].
    if ((o.offerType === 'direct-deposit' || o.offerType === 'held-and-dd') && psO.ddActive && Array.isArray(o.directDeposits)) {
      o.directDeposits.forEach((dd, idx) => {
        const effISO = directDepositEffectiveDate(dd);
        const eff = effISO ? parseDate(effISO) : null;
        if (!eff) return;
        const i = Math.round((eff - start) / 86400000);
        if (i < 0 || i >= proj.length) return;
        markers.push({ i, type: 'dd-fund', label: `DD ${idx + 1} — ${name}`, name, bankName: o.bankName, color: '#2d9cdb', offerColor, amount: Number(dd.amount) || 0 });
      });
    }
    // Held lump-sum fund marker (indigo) for the held types — new-funds-held
    // AND held-and-dd (its held portion). Standard direct-deposit has no
    // held lump sum, so it's skipped.
    if (o.offerType !== 'direct-deposit') {
      const fund = parseDate(lockStartDate(o));
      if (fund) {
        const i = Math.round((fund - start) / 86400000);
        if (i >= 0 && i < proj.length) markers.push({ i, type: 'fund', label: `Fund ${name}`, name, bankName: o.bankName, color: '#5b5cf6', offerColor, amount: Number(o.requiredFundingAmount) || 0 });
      }
    }
    if (withd) {
      const i = Math.round((withd - start) / 86400000);
      if (i >= 0 && i < proj.length) markers.push({ i, type: 'withdraw', label: `Withdraw ${name}`, name, bankName: o.bankName, color: '#10b981', offerColor, amount: Number(o.requiredFundingAmount) || 0, bonus: Number(o.signupBonusAmount) || 0 });
    }
    // Deposit/DD-completion deadline marker. For DD offers this is the
    // "complete a qualifying DD within X days" deadline; for held offers
    // it's the lump-sum deposit deadline. Shown for all types that have
    // a deadline set, except held-and-dd where the held funding deadline
    // is the same date and would double up.
    // EITHER/OR [review-after P2]: a direct-deposit offer's deadline is a DD-window
    // deadline — suppress it on the debit path (no DD to complete). A new-funds-held
    // funding deadline always applies (not a direct-deposit type).
    if (ddl && o.offerType !== 'held-and-dd' && (o.offerType !== 'direct-deposit' || psO.ddActive)) {
      const i = Math.round((ddl - start) / 86400000);
      const label = o.offerType === 'direct-deposit' ? `DD deadline: ${name}` : `Deposit deadline: ${name}`;
      if (i >= 0 && i < proj.length) markers.push({ i, type: 'deposit-deadline', label, name, bankName: o.bankName, color: '#e87171', offerColor, amount: Number(o.requiredFundingAmount) || 0 });
    }
  }
  // Events on the chart: recurring events produce one marker per
  // instance in the horizon window; one-time events produce a single
  // marker. The bonus-payout naming + linked-offer color resolution
  // happens once per event (not per instance) since recurring bonus
  // payouts share the same linked offer.
  const chartHorizonEnd = proj[proj.length - 1].date;
  for (const e of App.state.events) {
    if (!e.includeInProjection || !e.date) continue;
    // Per-event chart visibility: lets the user keep a paycheck or a
    // recurring bill in the running balance without spawning a marker
    // every payday. showOnChart === false hides the chart bubble but
    // the projection engine still consumes the event normally.
    if (e.showOnChart === false) continue;
    const isBonus = e.category === 'bonus payout';
    // Inflows green, outflows RED (was amber — matched the buffer
    // dashed-line color, which made outflows read as "warning" rather
    // than "money leaving". Red matches the deposit-deadline marker
    // because both represent money required to exit your account.)
    const color = Number(e.amount) >= 0 ? '#10b981' : '#e87171';
    let label = e.eventName || '';
    let evOfferColor = '';
    if (isBonus) {
      label = label.replace(/\s*[—–-]?\s*bonus\s*payout\s*$/i, '').trim() || label;
      let linked = null;
      if (e.sourceBonusOfferId) {
        linked = App.state.offers.find(x => x.id === e.sourceBonusOfferId);
      }
      if (!linked) {
        const norm = s => (s || '').replace(/[.\s]+/g, '').toLowerCase();
        const target = norm(label);
        if (target) {
          const matches = App.state.offers.filter(x =>
            x.status !== 'completed' && x.status !== 'skipped' && norm(x.bankName) === target);
          if (matches.length === 1) linked = matches[0];
        }
      }
      if (linked) evOfferColor = offerColorHex(linked);
    }
    const instances = expandEventInstances(e, start, chartHorizonEnd);
    for (const inst of instances) {
      const i = Math.round((inst.date - start) / 86400000);
      if (i < 0 || i >= proj.length) continue;
      markers.push({
        i,
        type: isBonus ? 'bonus' : (Number(inst.amount) >= 0 ? 'event-inflow' : 'event-outflow'),
        label,
        color,
        offerColor: evOfferColor,
        amount: Number(inst.amount) || 0
      });
    }
  }

  const todayIdx = Math.round((TODAY - start) / 86400000);

  const svgContent = `
    <defs>
      <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5b5cf6" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#5b5cf6" stop-opacity="0.0"/>
      </linearGradient>
    </defs>
    <!-- Shortfall bands -->
    ${shortfallBands}
    <!-- Y grid + labels -->
    ${yTicks.map(t => {
      const y = yFor(t);
      // Gridline only — the $ label is rendered in the sticky .chart-yaxis.
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#eef0f2" stroke-width="1" stroke-dasharray="4 4"/>`;
    }).join('')}
    <!-- Buffer line -->
    <line x1="${padL}" y1="${yFor(buffer).toFixed(1)}" x2="${W - padR}" y2="${yFor(buffer).toFixed(1)}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.7"/>
    <!-- Zero line only when projection actually goes negative -->
    ${actualMinCapital < 0 ? `<line x1="${padL}" y1="${yFor(0).toFixed(1)}" x2="${W - padR}" y2="${yFor(0).toFixed(1)}" stroke="#ef4444" stroke-width="1" stroke-dasharray="4 4"/>` : ''}
    <!-- Area + line -->
    <path d="${areaPath}" fill="url(#area-grad)" />
    <path d="${linePath}" fill="none" stroke="#5b5cf6" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <!-- Today marker — a neutral-gray "you are here" dot on the trendline.
         The standing dashed vertical line was removed (owner request,
         Wealthfront-style): "Today" now reads as a bottom axis-row label. -->
    ${todayIdx >= 0 && todayIdx < proj.length ? `
      <circle cx="${xFor(todayIdx).toFixed(1)}" cy="${yFor(proj[todayIdx].availableCapital).toFixed(1)}" r="5" fill="#6b7280" stroke="white" stroke-width="2.5" pointer-events="none"/>
    ` : ''}
    <!-- Markers grouped by visual proximity. When two or more markers would
         overlap horizontally (≤16 SVG units apart) they stack as a vertical
         column of dots above the lowest one. Each cluster is sorted by the
         marker's original index in the markers[] array — the tooltip
         filter preserves that same order, so the dot at the TOP of the
         stack corresponds to the FIRST line listed in the tooltip and the
         dot on the line is the LAST line listed. Reading top-to-bottom
         maps cleanly between the chart and the tooltip. -->
    ${(() => {
      const sorted = markers.slice().sort((a, b) => a.i - b.i);
      // Only stack dots that would literally overlap (dot diameter = 8px).
      // 9px threshold means centers must be within one dot-width to merge.
      const CLUSTER_PX = 9;
      const groups = [];
      for (const m of sorted) {
        const last = groups[groups.length - 1];
        if (last && Math.abs(xFor(m.i) - xFor(last[last.length - 1].i)) <= CLUSTER_PX) last.push(m);
        else groups.push([m]);
      }
      // Expose groups so the hover handler can use the same clusters.
      svg._markerGroups = groups;
      const STEP = 9; // vertical pixels between stacked dots
      let out = '';
      groups.forEach((g) => {
        g.sort((a, b) => markers.indexOf(a) - markers.indexOf(b));
        const x = xFor(g[0].i);
        const baseY = yFor(proj[g[0].i].availableCapital);
        g.forEach((m, k) => {
          // First in group → top of stack; last in group sits on the line
          // at baseY. With g.length=1 the formula collapses to baseY (no
          // visual change for solo markers).
          const cy = baseY - (g.length - 1 - k) * STEP;
          out += `<circle cx="${x.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${m.color}" stroke="white" stroke-width="2" opacity="0.92" pointer-events="none"></circle>`;
        });
      });
      return out;
    })()}
    <!-- X axis labels (months). "Today" shares this same axis row (rendered
         below), so drop any month label whose text would overlap "Today". -->
    ${(() => {
      const estW = s => String(s).length * 6.8; // ≈ glyph advance at font-size 12
      const showToday = todayIdx >= 0 && todayIdx < proj.length;
      const xToday = showToday ? xFor(todayIdx) : 0;
      // "Today" is left-aligned (text-anchor start) from xToday, so it occupies
      // [xToday, xToday + width]. Drop any month label whose LEFT edge would
      // overlap that span.
      const clashesToday = t => showToday && (xFor(t.i) - estW(t.label) / 2) < (xToday + estW('Today') + 3);
      return xTicks.filter(t => !clashesToday(t)).map(t => {
        const x = xFor(t.i);
        return `<text x="${x.toFixed(1)}" y="${(padT + innerH + 20).toFixed(1)}" fill="#9099a8" font-size="12" text-anchor="middle" font-weight="500">${t.label}</text>`;
      }).join('');
    })()}
    <!-- "Today" — bottom axis-row label (Wealthfront-style): same row / baseline
         / type style as the month labels. LEFT-ALIGNED (text-anchor start) at
         today's x so it abuts the chart's left boundary and never clips at the
         SVG left edge (today sits at padL in the normal hero case). -->
    ${todayIdx >= 0 && todayIdx < proj.length ? `
      <text x="${xFor(todayIdx).toFixed(1)}" y="${(padT + innerH + 20).toFixed(1)}" fill="#9099a8" font-size="12" text-anchor="start" font-weight="500">Today</text>
    ` : ''}
    <!-- Horizon end label: suppress if same month as last tick, or too close -->
    ${(() => {
      if (xTicks.length === 0) return `<text x="${(W - padR).toFixed(1)}" y="${(padT + innerH + 20).toFixed(1)}" fill="#9099a8" font-size="12" text-anchor="end" font-weight="500">${formatDateShort(proj[proj.length - 1].date)}</text>`;
      const lastTick = xTicks[xTicks.length - 1];
      // DST-safe dates: the tick carries its true first-of-month Date, and the
      // horizon comes straight from the last projection day — never from
      // start+i*86400000 arithmetic (see the tick-build note above).
      const lastTickDate = lastTick.date || new Date(start.getTime() + lastTick.i * 86400000);
      const horizonDate = parseDate(proj[proj.length - 1].date) || new Date(start.getTime() + (proj.length - 1) * 86400000);
      const sameMonth = lastTickDate.getFullYear() === horizonDate.getFullYear() && lastTickDate.getMonth() === horizonDate.getMonth();
      const tooClose = xFor(proj.length - 1) - xFor(lastTick.i) <= 32;
      return (sameMonth || tooClose) ? '' : `<text x="${(W - padR).toFixed(1)}" y="${(padT + innerH + 20).toFixed(1)}" fill="#9099a8" font-size="12" text-anchor="end" font-weight="500">${formatDateShort(proj[proj.length - 1].date)}</text>`;
    })()}
    <!-- Hover overlay -->
    <rect x="${padL}" y="${padT}" width="${innerW}" height="${innerH}" fill="transparent" id="chart-hover-area"/>
    <line id="chart-hover-line" x1="0" y1="${padT}" x2="0" y2="${padT + innerH}" stroke="#0d1421" stroke-width="1" opacity="0"/>
    <circle id="chart-hover-dot" cx="0" cy="0" r="5" fill="#6b7280" stroke="white" stroke-width="2" opacity="0"/>
  `;

  svg.innerHTML = svgContent;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Frozen Y-axis: render the dollar labels as HTML in the sticky sibling so
  // they stay pinned while the plot scrolls horizontally. Vertical % is
  // scale-independent — yFor(t)/H maps the viewBox y to the rendered height
  // (the SVG fills its box with no vertical letterboxing at height:auto), so
  // each label lines up with its gridline at any chart width.
  const yaxisEl = document.getElementById('hero-chart-yaxis');
  if (yaxisEl) {
    yaxisEl.innerHTML = yTicks.map(t =>
      `<span class="ylab" style="top:${(yFor(t) / H * 100).toFixed(2)}%;">${formatCompactCurrency(t)}</span>`
    ).join('');
  }

  // Hover interactions
  const hoverLine = svg.querySelector('#chart-hover-line');
  const hoverDot = svg.querySelector('#chart-hover-dot');

  function markerTypeLabel(type) {
    if (type === 'fund') return 'Fund date';
    if (type === 'dd-fund') return 'Direct deposit';
    if (type === 'withdraw') return 'Withdrawal';
    if (type === 'bonus') return 'Bonus payout';
    if (type === 'deposit-deadline') return 'Deposit deadline';
    if (type === 'event-inflow') return 'Inflow';
    if (type === 'event-outflow') return 'Outflow';
    return type;
  }
  // Lighter mid-tone for tooltip text on dark background — readable on dark bg
  function lightenColor(hex) {
    // Very-bright tooltip event-type colors. Pushed to ~86% lightness
    // in HSL while preserving hue — leaves enough saturation that
    // "this is the indigo one" still reads, but the labels themselves
    // pop crisply against the dark tooltip BG.
    const map = {
      '#5b5cf6': '#dadcff',  // fund purple -> very light
      '#2d9cdb': '#cdebfa',  // DD teal -> very light
      '#10b981': '#b2f5d8',  // green -> very light mint
      '#e87171': '#ffd6d6',  // red -> very light pink
      '#ef4444': '#ffd6d6',  // legacy red -> very light pink
      '#f59e0b': '#fff0a8',  // amber -> very light yellow
    };
    return map[hex] || hex;
  }
  // Programmatic lightening for offer-palette colors so they read on
  // the dark tooltip BG. HSL: raise L to ~72%, gentle desaturation so
  // the navy/brown/slate don't blow out to neon. Used for the bank-
  // name and amount columns in marker rows when an offer color is set.
  function lightenHexForDark(hex) {
    if (!hex || hex[0] !== '#') return hex;
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let hh, s, l = (max + min) / 2;
    if (max === min) { hh = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: hh = (g - b) / d + (g < b ? 6 : 0); break;
        case g: hh = (b - r) / d + 2; break;
        case b: hh = (r - g) / d + 4; break;
      }
      hh /= 6;
    }
    l = 0.74;
    s = Math.max(s * 0.85, 0.42);
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return '#' + toHex(hue2rgb(p, q, hh + 1/3)) + toHex(hue2rgb(p, q, hh)) + toHex(hue2rgb(p, q, hh - 1/3));
  }

  function handleHover(evt) {
    const rect = svg.getBoundingClientRect();
    const rawX = (evt.clientX - rect.left) * (W / rect.width);
    const rawY = (evt.clientY - rect.top) * (H / rect.height);
    if (rawX < padL || rawX > W - padR || rawY < padT || rawY > padT + innerH) { clearHover(); return; }
    const i = Math.round(((rawX - padL) / innerW) * (proj.length - 1));
    if (i < 0 || i >= proj.length) return;
    const d = proj[i];
    const cx = xFor(i);
    const cy = yFor(d.availableCapital);
    hoverLine.setAttribute('x1', cx);
    hoverLine.setAttribute('x2', cx);
    hoverLine.setAttribute('opacity', '0.5');
    hoverDot.setAttribute('cx', cx);
    hoverDot.setAttribute('cy', cy);
    hoverDot.setAttribute('opacity', '1');

    // Trigger radius: proportional to the projection length so the
    // event tooltip appears only when the cursor is genuinely near the
    // marker, regardless of how long the horizon is.
    // 1.2 × one-day width, clamped to [6, 10] SVG units.
    const oneDaySvg = innerW / Math.max(1, proj.length - 1);
    const triggerPx = Math.min(10, Math.max(6, oneDaySvg * 1.2));
    const groups = svg._markerGroups || [];
    const nearMarkers = [];
    for (const g of groups) {
      const gx = xFor(g[0].i);
      if (Math.abs(gx - rawX) < triggerPx) { for (const m of g) nearMarkers.push(m); }
    }

    let html = `
      <div class="tt-date">${formatDateLong(d.date)}</div>
      <div class="tt-row"><span class="label">Available</span><span style="color:#8e90ff;"><strong>${formatCurrency(d.availableCapital)}</strong></span></div>
      <div class="tt-row"><span class="label">Tied up</span><span>${formatCurrency(d.totalTiedUp)}</span></div>
      ${d.netEventsToDate !== 0 ? `<div class="tt-row"><span class="label">Net events</span><span>${(d.netEventsToDate >= 0 ? '+' : '') + formatCurrency(d.netEventsToDate)}</span></div>` : ''}
    `;
    if (nearMarkers.length > 0) {
      html += `<div style="border-top:1px solid rgba(255,255,255,0.18);margin-top:6px;padding-top:6px;">`;
      for (const m of nearMarkers) {
        // New tooltip style: drop the bullet. Left label = lightened
        // event-type color (so "Direct deposit" itself is teal). Right
        // side (bank name + amount) = lightened OFFER color when set,
        // else lightened event color. Result: event-type reads at a
        // vertical scan via labels; per-offer identity reads via the
        // right-side text color.
        // Tooltip label color: indigo + sky read slightly muted on the
        // dark BG compared to how they look on the white legend chip BG,
        // so lift only those two a notch. Green/red/amber pop fine at
        // full saturation against dark — leave raw. The result is the
        // tooltip's "Fund date" / "Direct deposit" labels read with the
        // same vibrancy as their swatch in the key below.
        const labelLift = { '#5b5cf6': '#8a8cff', '#2d9cdb': '#5cb4e4', '#10b981': '#6ee7b7' };
        const evColor = labelLift[m.color] || m.color;
        // Right-side identity color: lightened offer color when set
        // (matches offer-card identity dot), otherwise the lifted
        // event color (matches the left label + legend swatch).
        const offerLight = m.offerColor ? lightenHexForDark(m.offerColor) : '';
        const idColor = offerLight || evColor;
        // Left label uses the RAW saturated event color (same hex as
        // the swatch in the chart legend below) so "Direct deposit"
        // / "Deposit deadline" / "Fund date" / etc. read with the
        // same vibrancy as the key chips. Lightened versions looked
        // washed out / dull on the dark BG. Bumped to weight 600 so
        // the contrast against the ~7:1 dark BG is comfortable.
        // Override .label's baseline opacity:0.7 inline.
        html += `<div class="tt-row" style="margin-top:3px;"><span class="label" style="color:${evColor};opacity:1;font-weight:600;">${markerTypeLabel(m.type)}</span><span style="color:${idColor};font-weight:600;">${escapeHtml(m.bankName || m.name || m.label)}</span></div>`;
        if (m.type === 'fund' && m.amount) html += `<div class="tt-row"><span class="label">Deposit</span><span style="color:${idColor};">${formatCurrency(m.amount)}</span></div>`;
        if (m.type === 'dd-fund' && m.amount) html += `<div class="tt-row"><span class="label">DD amount</span><span style="color:${idColor};">${formatCurrency(m.amount)}</span></div>`;
        if (m.type === 'deposit-deadline' && m.amount) html += `<div class="tt-row"><span class="label">Required deposit</span><span style="color:${idColor};">${formatCurrency(m.amount)}</span></div>`;
        if (m.type === 'withdraw') {
          if (m.amount) html += `<div class="tt-row"><span class="label">Released</span><span style="color:${idColor};">${formatCurrency(m.amount)}</span></div>`;
          if (m.bonus) html += `<div class="tt-row"><span class="label">Bonus</span><span style="color:${idColor};">+${formatCurrency(m.bonus)}</span></div>`;
        }
        if (m.type === 'bonus' && m.amount) html += `<div class="tt-row"><span class="label">Payout</span><span style="color:${idColor};">+${formatCurrency(m.amount)}</span></div>`;
        if ((m.type === 'event-inflow' || m.type === 'event-outflow') && m.amount) html += `<div class="tt-row"><span class="label">Amount</span><span style="color:${idColor};">${m.amount >= 0 ? '+' : ''}${formatCurrency(m.amount)}</span></div>`;
      }
      html += `</div>`;
    }
    tooltip.innerHTML = html;
    tooltip.classList.add('visible');

    // Tooltip is appended to <body> (see below) so position:fixed always
    // anchors to the viewport, regardless of any ancestor overflow/scroll
    // container. iOS Safari otherwise treats fixed-as-absolute when
    // -webkit-overflow-scrolling: touch is on an ancestor, which is what
    // was clipping bubble tooltips inside .chart-wrap.
    if (tooltip.parentElement !== document.body) document.body.appendChild(tooltip);
    const svgX = (cx / W) * rect.width + rect.left;
    const svgY = (cy / H) * rect.height + rect.top;
    tooltip.style.position = 'fixed';
    tooltip.style.left = svgX + 'px';
    tooltip.style.top = svgY + 'px';
    tooltip.style.transform = 'translate(-50%, -110%)';
    // Force layout, then clamp inside viewport with a small margin.
    const ttRect = tooltip.getBoundingClientRect();
    const margin = 8;
    const halfW = ttRect.width / 2;
    const minLeft = margin + halfW;
    const maxLeft = window.innerWidth - margin - halfW;
    const clampedLeft = Math.max(minLeft, Math.min(maxLeft, svgX));
    // Flip below the dot if anchoring above would clip the top of the
    // viewport (chart near the top of the page on phones).
    const wantsTop = svgY - ttRect.height - 12;
    const flipDown = wantsTop < margin;
    tooltip.style.left = clampedLeft + 'px';
    if (flipDown) {
      tooltip.style.top = (svgY + 18) + 'px';
      tooltip.style.transform = 'translate(-50%, 0)';
    } else {
      tooltip.style.top = svgY + 'px';
      tooltip.style.transform = 'translate(-50%, -110%)';
    }
  }

  function clearHover() {
    hoverLine.setAttribute('opacity', '0');
    hoverDot.setAttribute('opacity', '0');
    tooltip.classList.remove('visible');
  }

  svg.addEventListener('mousemove', handleHover);
  svg.addEventListener('mouseleave', clearHover);

  // Touch interaction model — coexisting swipe-to-pan + long-press-to-inspect:
  //
  //   - Quick tap (down → up under 200 ms, no movement): show tooltip
  //     briefly at the touched point, then auto-clear on touchend.
  //   - Hold (down, still ≥ 200 ms): enter "inspect mode" — preventDefault
  //     subsequent touchmoves so dragging updates the tooltip instead of
  //     panning the chart-wrap. Releases on touchend.
  //   - Swipe (down, immediate movement > 10 px before timer fires):
  //     cancel inspect-mode timer, do NOT preventDefault, let the parent
  //     `.chart-wrap` handle native horizontal scroll for panning.
  //
  // This is the Robinhood / Wealthfront pattern: a slow press inspects,
  // a fast drag pans. Both gestures coexist on the same element.
  let touchStartX = 0, touchStartY = 0;
  let inspectMode = false;
  let inspectTimer = null;
  const INSPECT_HOLD_MS = 200;
  const PAN_THRESHOLD_PX = 10;
  svg.addEventListener('touchstart', (e) => {
    if (!e.touches[0]) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    inspectMode = false;
    if (inspectTimer) clearTimeout(inspectTimer);
    // After INSPECT_HOLD_MS with the finger still on the chart and not
    // yet panned, lock into inspect mode and reveal the tooltip.
    inspectTimer = setTimeout(() => {
      inspectMode = true;
      handleHover(e.touches[0] || { clientX: touchStartX, clientY: touchStartY });
    }, INSPECT_HOLD_MS);
  }, { passive: true });
  svg.addEventListener('touchmove', (e) => {
    if (!e.touches[0]) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (!inspectMode) {
      // Pre-inspect-mode: if the finger has moved meaningfully, abort
      // the inspect timer and let native horizontal scroll happen.
      if (Math.abs(dx) > PAN_THRESHOLD_PX || Math.abs(dy) > PAN_THRESHOLD_PX) {
        if (inspectTimer) { clearTimeout(inspectTimer); inspectTimer = null; }
      }
      return; // don't preventDefault — pan freely
    }
    // Already in inspect mode — block pan and route the touch through
    // handleHover so dragging the finger updates the tooltip.
    e.preventDefault();
    handleHover(e.touches[0]);
  }, { passive: false });
  svg.addEventListener('touchend', () => {
    if (inspectTimer) { clearTimeout(inspectTimer); inspectTimer = null; }
    // Tooltip lingers ~600 ms after release so the user can read it
    // before it fades. Inspect mode resets immediately so the next
    // touchstart can start fresh.
    inspectMode = false;
    setTimeout(clearHover, 600);
  });
  svg.addEventListener('touchcancel', () => {
    if (inspectTimer) { clearTimeout(inspectTimer); inspectTimer = null; }
    inspectMode = false;
    clearHover();
  });

  // Public method: programmatically surface the tooltip at a given day
  // index. Used by the "Lowest projected" stat-card click-through. We
  // synthesize fake clientX/clientY in the SVG's bounding rect and feed
  // them through the same handleHover() the cursor would, so there is no
  // separate rendering path to keep in sync.
  svg.showAtIndex = function(i) {
    if (i < 0 || i >= proj.length) return;
    const rect = svg.getBoundingClientRect();
    const cx = xFor(i);
    const cy = yFor(proj[i].availableCapital);
    const clientX = (cx / W) * rect.width + rect.left;
    const clientY = (cy / H) * rect.height + rect.top;
    handleHover({ clientX, clientY });
    // Auto-fade so the bubble doesn't stick around forever after a single
    // tap. 5s is enough to read; user can re-tap the stat-card to repeat.
    if (svg._showAtTimer) clearTimeout(svg._showAtTimer);
    svg._showAtTimer = setTimeout(() => clearHover(), 5000);
  };
}

function niceTicks(min, max, count) {
  const range = max - min;
  const step = niceStep(range / count);
  const ticks = [];
  let v = Math.ceil(min / step) * step;
  while (v <= max + step * 0.001) { ticks.push(v); v += step; }
  return ticks;
}
function niceStep(raw) {
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / exp;
  let nf;
  if (f < 1.5) nf = 1;
  else if (f < 3) nf = 2;
  else if (f < 7) nf = 5;
  else nf = 10;
  return nf * exp;
}

export { optimizerProposalModel, renderPlanner, renderDdMethodPanel, requirementChecklistCounts, renderRequirementChecklist, renderPipelineStrip, renderLifecycleInfo, renderLifecycleSuggest, offerExpirationChip, offerUpdatedStamp, offerDocLink, renderOfferCard, renderTimeline, OFFERS_SORT_OPTIONS, sortOffersList, renderOffers, renderOfferCardWithActions, renderOffersTable, renderSettings, renderDiagnostics, formatDiagTime, diagReportText, renderCommitmentsTable, renderEventsTable, renderSyncSection, renderProjectionDebugTable, renderEmptyState, renderChartsAfterMount, prefillSyncInputs, renderHeroChart, niceTicks, niceStep };
