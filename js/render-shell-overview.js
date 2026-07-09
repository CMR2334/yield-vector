import { App } from './app-state.js';
import { TODAY, addDays, formatCompactCurrency, formatCurrency, formatDateDisplay, formatDateMedium, parseDate } from './date-format-core.js';
import { bindViewEvents } from './events-actions-data.js';
import { offerColorHex } from './migrations-catalogs.js';
import { CHURN_HORIZON_DAYS, churnEligibleDate, churnSnoozeActive, offerIsActiveForProjection } from './offer-model.js';
import { generateProjection, summarizeProjection } from './projection-optimizer.js';
import { computeUpcomingActions, renderActionRow } from './reminders.js';
import { renderChartsAfterMount, renderOffers, renderPlanner, renderSettings, renderTimeline } from './render-main-views.js';
import { offerDisplayLabel } from './requirements-templates.js';
import { APP_VERSION, ErrCode, logError, normalizeOfferStatus } from './runtime-status.js';
import { renderSyncIndicator } from './sync-pwa.js';
import { escapeAttr, escapeHtml } from './ui-utils.js';
/* ============================================================
   RENDERING — top-level shell
   ============================================================ */
function render() {
  const root = document.getElementById('app');
  try {
    // Idempotent status normalization covers every state path (load, sync
    // pull, inline edits) in one place — guarantees subStatus/accountStatus
    // exist and the legacy shadow status is in sync before anything renders.
    if (App.state && App.state.offers) App.state.offers.forEach(normalizeOfferStatus);
    // Preserve focus + caret on inputs across full re-renders. Without this,
    // typing/backspacing in the search box loses focus on every keystroke
    // because innerHTML destroys the input element.
    const focused = document.activeElement;
    const focusedId = focused && focused.id ? focused.id : null;
    const selStart = focused && focused.selectionStart != null ? focused.selectionStart : null;
    const selEnd = focused && focused.selectionEnd != null ? focused.selectionEnd : null;

    root.innerHTML = renderShell();

    if (focusedId) {
      const el = document.getElementById(focusedId);
      if (el) {
        el.focus({ preventScroll: true });
        try { if (selStart != null && el.setSelectionRange) el.setSelectionRange(selStart, selEnd); } catch {}
      }
    }
    bindViewEvents();
    // Re-render charts that need actual DOM measurements
    renderChartsAfterMount();
  } catch (e) {
    // Never blank the screen on a render bug — log it and show a
    // recoverable error panel instead.
    logError(ErrCode.RENDER, e, 'render:' + (App.view || '?'));
    if (root) root.innerHTML = renderErrorState(e);
  }
}

/* Self-contained recovery UI. Must not depend on renderShell()/state being
   healthy, since it's shown precisely when those threw. Reads the diag log
   straight from localStorage so it works even mid-boot. */
function renderErrorState(err) {
  const msg = (err && err.message) ? err.message : String(err || 'Unknown error');
  return `
    <div class="error-state">
      <h1>Yield Vector hit a snag</h1>
      <p>The view failed to render, but your data is safe in local storage. Try reloading. If it keeps happening, copy the diagnostics below when reporting it.</p>
      <pre class="error-state-msg">${escapeHtml(msg)}</pre>
      <div class="error-state-actions">
        <button class="btn btn-primary" onclick="location.reload()">Reload</button>
        <button class="btn btn-secondary" data-action="copy-diag">Copy diagnostics</button>
      </div>
      <p class="error-state-foot">Build v${escapeHtml(APP_VERSION)}</p>
    </div>`;
}

function renderShell() {
  return `
    ${renderHeader()}
    <main class="app-main">${renderActiveView()}</main>
    ${renderMobileNav()}
    <button class="fab" id="fab-add" data-action="add-offer" aria-label="Add offer"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" pointer-events="none"><line x1="10" y1="3" x2="10" y2="17"/><line x1="3" y1="10" x2="17" y2="10"/></svg></button>
    <div class="modal" id="modal-root"></div>
    <div class="toast" id="toast"></div>
  `;
}

function renderHeader() {
  const NAV_ICONS = {
    overview:  'M3 10L12 2l9 8v11H3V10zM9 21V14h6v7',
    planner:   'M12 2a10 10 0 100 20A10 10 0 0012 2zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z',
    timeline:  'M8 2v4M16 2v4M5 4h14v16H5V4zM5 10h14',
    offers:    'M3 21h18M3 10h18M5 10V21M9 10V21M15 10V21M19 10V21M12 3L3 10h18L12 3z',
    settings:  'M4 6h16M4 12h16M4 18h16M8 4v4M12 10v4M16 16v4'
  };
  const views = [
    ['overview', 'Overview'],
    ['planner', 'Planner'],
    ['timeline', 'Timeline'],
    ['offers', 'Offers'],
    ['settings', 'Settings']
  ];
  return `
    <header class="app-header">
      <div class="brand">
        <!-- Brand mark: rounded-square chip with a navy → light-purple
             diagonal gradient (BL → TR), and a clean white arrow on top.
             The chip's top-right corner is intentionally lighter than
             previous versions for more lift; the arrow is a smooth Bezier
             shaft + chevron arrowhead in pure stroke (no filled triangle)
             so it reads as crisp vector rather than chunky stock clipart. -->
        <svg class="brand-flourish" width="22" height="22" viewBox="0 0 22 22" fill="none"
             shape-rendering="geometricPrecision" aria-hidden="true">
          <defs>
            <!-- Bottom-left = deep navy, top-right = lighter violet/lavender.
                 Gradient runs corner-to-corner along the diagonal of the chip. -->
            <linearGradient id="brand-chip-g" x1="0" y1="22" x2="22" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#1e1b4b"/>
              <stop offset="45%" stop-color="#4338ca"/>
              <stop offset="80%" stop-color="#7c3aed"/>
              <stop offset="100%" stop-color="#b69cff"/>
            </linearGradient>
            <!-- Subtle highlight overlay on the upper-left to give the chip
                 a hint of dimensional gloss without going glossy. -->
            <linearGradient id="brand-chip-shimmer" x1="0" y1="0" x2="14" y2="14" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="rgba(255,255,255,0.18)"/>
              <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="22" height="22" rx="6" fill="url(#brand-chip-g)"/>
          <rect x="0" y="0" width="22" height="22" rx="6" fill="url(#brand-chip-shimmer)"/>
          <!-- White arrow shaft: smooth Bezier uptrend from (5.5, 16.5)
               to the tip at (16, 6.5). Stroke 2.0 — slightly thicker than
               the hairline v5 stroke so the arrow has actual presence. -->
          <path d="M 5.5 16.5 Q 9 12 16 6.5"
                stroke="white" stroke-width="2"
                stroke-linecap="round" fill="none"/>
          <!-- Chevron arrowhead: tip at (16.5, 6); barbs to (10.8, 7.2) and
               (15.3, 12). ~8 px barbs, sharp angle, no filled triangle. -->
          <path d="M 10.8 7.2 L 16.5 6 L 15.3 12"
                stroke="white" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
        <span class="brand-name">Yield Vector</span>
      </div>
      <nav class="primary-nav">
        ${views.map(([k, l]) => `<button class="nav-btn ${App.view === k ? 'active' : ''}" data-view="${k}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${NAV_ICONS[k]}"/></svg>${l}</button>`).join('')}
      </nav>
      <div class="header-trailing">
        ${renderSyncIndicator()}
        <div class="header-actions">
          <button class="btn btn-primary" data-action="add-offer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add offer
          </button>
        </div>
      </div>
    </header>
  `;
}

function renderMobileNav() {
  const items = [
    // Home: house with door
    ['overview', 'Home', 'M3 10L12 2l9 8v11H3V10zM9 21V14h6v7'],
    // Plan: compass
    ['planner', 'Plan', 'M12 2a10 10 0 100 20A10 10 0 0012 2zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z'],
    // Timeline: calendar grid
    ['timeline', 'Timeline', 'M8 2v4M16 2v4M5 4h14v16H5V4zM5 10h14'],
    // Offers: bank building (columns + base)
    ['offers', 'Offers', 'M3 21h18M3 10h18M5 10V21M9 10V21M15 10V21M19 10V21M12 3L3 10h18L12 3z'],
    // Settings: adjustment sliders
    ['settings', 'Settings', 'M4 6h16M4 12h16M4 18h16M8 4v4M12 10v4M16 16v4']
  ];
  return `
    <nav class="mobile-nav">
      ${items.map(([k, l, p]) => `
        <button class="nav-btn ${App.view === k ? 'active' : ''}" data-view="${k}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0;"><path d="${p}"/></svg>
          <span>${l}</span>
        </button>
      `).join('')}
    </nav>
  `;
}

function renderActiveView() {
  switch (App.view) {
    case 'overview': return renderOverview();
    case 'planner': return renderPlanner();
    case 'timeline': return renderTimeline();
    case 'offers': return renderOffers();
    case 'settings': return renderSettings();
    default: return renderOverview();
  }
}

/* ============================================================
   OVERVIEW VIEW
   ============================================================ */
function renderOverview() {
  const proj = generateProjection(App.state);
  const summary = summarizeProjection(proj, App.state.settings);

  const today = summary.today;
  const lowest = summary.lowest;

  const includedOffers = App.state.offers.filter(o => offerIsActiveForProjection(o));
  const expectedBonusTotal = includedOffers.reduce((s, o) => s + (Number(o.signupBonusAmount) || 0), 0);
  const tiedUpToday = today ? today.totalTiedUp : 0;
  const liquidCapital = App.state.settings.currentLiquidCapital;

  const heroAvailable = today ? today.availableCapital : liquidCapital;
  const heroLowest = lowest ? lowest.availableCapital : heroAvailable;
  const buffer = Number(App.state.settings.minimumCashBuffer) || 0;

  // Tone for any "lowest" or "available" dollar value: red if it would go
  // negative, buffer-yellow if it dips into the buffer zone (positive but
  // under the buffer floor), normal text otherwise. Used for both the hero
  // amount and the inline "Lowest $X" line.
  function shortfallTone(v) {
    if (v < 0) return 'var(--danger)';
    if (v < buffer) return '#c88b2c'; // matches .stat-value.warn / Buffer line
    return 'var(--text)';
  }
  const heroAmountTone = shortfallTone(heroAvailable);
  const heroLowestTone = shortfallTone(heroLowest);

  const lowestPill = summary.shortfallDays > 0
    ? `<span class="pill danger">${summary.shortfallDays} shortfall day${summary.shortfallDays === 1 ? '' : 's'}</span>`
    : summary.belowBufferDays > 0
      ? `<span class="pill warn">${summary.belowBufferDays} day${summary.belowBufferDays === 1 ? '' : 's'} below buffer</span>`
      : `<span class="pill">Healthy through horizon</span>`;

  const ACTIONS_PER_PAGE = 6;
  const allUpcomingActions = computeUpcomingActions(App.state, 200);
  const upcomingPageCount = Math.max(1, Math.ceil(allUpcomingActions.length / ACTIONS_PER_PAGE));
  if (typeof App._upcomingPage !== 'number') App._upcomingPage = 0;
  App._upcomingPage = Math.min(App._upcomingPage, upcomingPageCount - 1);
  const upcomingActions = allUpcomingActions.slice(App._upcomingPage * ACTIONS_PER_PAGE, (App._upcomingPage + 1) * ACTIONS_PER_PAGE);

  return `
    <section class="hero">
      <div class="hero-numbers">
        <div class="hero-label">Available capital today</div>
        <div class="hero-amount" style="color:${heroAmountTone};">
          <span class="currency-symbol">${heroAvailable < 0 ? '-$' : '$'}</span>${Math.abs(Math.round(heroAvailable)).toLocaleString('en-US')}
        </div>
        <div class="hero-meta">
          ${lowestPill}
          ${lowest && summary.lowestIdx > 0 ? `<span style="color:var(--text-tertiary);">Lowest <strong style="color:${heroLowestTone};">${formatCurrency(heroLowest)}</strong> on ${formatDateMedium(lowest.date)}</span>` : ''}
        </div>
      </div>
      <div class="chart-wrap" id="hero-chart-wrap">
        <div class="chart-scroll" id="hero-chart-scroll">
          <div class="chart-yaxis" id="hero-chart-yaxis" aria-hidden="true"></div>
          <svg class="chart-svg" id="hero-chart" viewBox="0 0 800 360" preserveAspectRatio="xMidYMid meet"></svg>
        </div>
        <div class="chart-tooltip" id="chart-tooltip"></div>
      </div>
      <div class="chart-legend">
        <span class="chart-legend-item"><span class="legend-swatch" style="background:#10b981;"></span> Withdrawal</span>
        <span class="chart-legend-item"><span class="legend-swatch" style="background:#5b5cf6;"></span> Initial funding</span>
        <span class="chart-legend-item"><span class="legend-swatch" style="background:#2d9cdb;"></span> Direct deposit</span>
        <span class="chart-legend-item"><span class="legend-swatch" style="background:#e87171;"></span> Deposit deadline</span>
        <span class="chart-legend-item"><span class="legend-line" style="background:var(--accent);"></span> Available capital</span>
        <span class="chart-legend-item"><span class="legend-line dashed" style="color:var(--warning);"></span> Buffer (${formatCompactCurrency(App.state.settings.minimumCashBuffer)})</span>
      </div>
    </section>

    <div class="overview-grid">
      ${statCard('Tied up today', formatCurrency(tiedUpToday), `${(today ? Math.round((today.confirmedTiedUp / Math.max(1, today.totalTiedUp)) * 100) : 0)}% confirmed`, 'accent', 'goto-timeline')}
      ${statCard('Selected bonuses', formatCurrency(expectedBonusTotal), `${includedOffers.length} offer${includedOffers.length === 1 ? '' : 's'} included`, 'success', 'goto-offers-included')}
      ${statCard('Lowest projected', formatCurrency(heroLowest), lowest ? formatDateMedium(lowest.date) : '—', summary.shortfallDays > 0 ? 'danger' : (summary.belowBufferDays > 0 ? 'warn' : 'lighten'), lowest ? 'goto-lowest' : null)}

      <section class="card overview-main">
        <div class="card-header">
          <h2>Upcoming actions</h2>
          ${upcomingPageCount > 1 ? `
            <div class="upcoming-pager">
              <button class="upcoming-pg-btn" data-action="upcoming-prev" ${App._upcomingPage === 0 ? 'disabled' : ''} aria-label="Previous">‹</button>
              <span class="upcoming-pg-label">${App._upcomingPage + 1} / ${upcomingPageCount}</span>
              <button class="upcoming-pg-btn" data-action="upcoming-next" ${App._upcomingPage === upcomingPageCount - 1 ? 'disabled' : ''} aria-label="Next">›</button>
            </div>
          ` : ''}
        </div>
        ${upcomingActions.length === 0
          ? `<div style="padding:var(--space-6);text-align:center;color:var(--text-tertiary);font-size:14px;">No upcoming dates yet. Add an offer to get started.</div>`
          : `<div class="action-list upcoming-fade" key="${App._upcomingPage}">${upcomingActions.map(renderActionRow).join('')}</div>`}
      </section>

      ${renderOverviewChurnSection()}
    </div>
  `;
}

// "Upcoming churn dates" (F6) — a bottom-of-Overview section listing offers that
// can be re-run, split into "Eligible now" and "Upcoming" (within
// CHURN_HORIZON_DAYS). Renders NOTHING at all unless at least one offer is
// marked churnable (churnable===true) — no dead chrome for users who never set
// churnability. Each row taps through to that offer's edit modal via the shared
// open-action-target routing (targetKind:'offer').
//
// SNOOZE: each visible row carries a subtle "Snooze" affordance (inline
// expanding action row: 30 days / 90 days / Indefinitely) that writes
// churn_snoozed_until. Snoozed offers drop out of both buckets and collect at
// the section bottom behind a muted "N snoozed — show" reveal, each with an
// Unsnooze button. The section stays mounted when there's ≥1 visible row OR ≥1
// snoozed offer (so a fully-snoozed section is still reachable to unsnooze);
// it's hidden entirely only when neither exists.
function renderOverviewChurnSection() {
  const offers = App.state.offers || [];
  // Gate: only consider offers when churnability is actually in use.
  if (!offers.some(o => o.churnable === true)) return '';

  const horizon = addDays(TODAY, CHURN_HORIZON_DAYS);
  const eligibleNow = [];
  const upcoming = [];
  const snoozed = [];
  for (const o of offers) {
    if (o.churnable !== true) continue;
    // Snoozed churnable offers are pulled out of the buckets entirely and
    // listed behind the reveal — regardless of whether their eligible date is
    // computable (you snoozed it; you can always unsnooze it).
    if (churnSnoozeActive(o)) { snoozed.push({ o }); continue; }
    const elig = churnEligibleDate(o);
    if (!elig) continue;                       // not computable (missing anchor/wait)
    const d = parseDate(elig);
    if (!d) continue;
    if (d.getTime() <= TODAY.getTime()) eligibleNow.push({ o, elig, d });
    else if (d.getTime() <= horizon.getTime()) upcoming.push({ o, elig, d });
    // Beyond the horizon → not shown here.
  }
  // Mount when there's at least one computable date to list (eligible now or
  // within the horizon) OR at least one snoozed offer (the reveal must stay
  // reachable). Churnable offers whose date isn't yet computable — missing
  // anchor or wait period, and not snoozed — surface that gap on their own
  // cards, not as an empty overview card.
  if (!eligibleNow.length && !upcoming.length && !snoozed.length) return '';
  eligibleNow.sort((a, b) => a.d - b.d);       // soonest first (oldest-eligible first)
  upcoming.sort((a, b) => a.d - b.d);
  snoozed.sort((a, b) => (a.o.bankName || '').localeCompare(b.o.bankName || ''));

  const offerName = (o) => offerDisplayLabel(o);

  // A visible (non-snoozed) row: navigation main area + a subtle snooze menu.
  // The clickable nav div and the snooze controls are SIBLINGS inside a wrap so
  // interacting with the snooze menu never triggers the row's open-offer click.
  const row = (r, isNow) => {
    const o = r.o;
    const months = Number(o.churn_wait_months);
    const waitChip = Number.isFinite(months) && months > 0
      ? `<span class="chip chip-muted churn-wait-chip">${months} mo wait</span>` : '';
    const dateText = isNow ? 'Eligible now' : formatDateDisplay(r.elig);
    const idAttr = escapeAttr(o.id);
    const menuId = `churn-snooze-menu-${idAttr}`;
    return `<div class="churn-row-wrap"${offerColorHex(o) ? ` style="--offer-color:${offerColorHex(o)};"` : ''}>
      <div class="churn-row clickable" data-action="open-action-target" data-target-kind="offer" data-target-id="${idAttr}" role="button" tabindex="0">
        <div class="churn-row-main">
          <div class="churn-row-name">${escapeHtml(offerName(o))}</div>
          <div class="churn-row-date ${isNow ? 'success' : ''}">${escapeHtml(dateText)}</div>
        </div>
        ${waitChip}
      </div>
      <div class="churn-snooze">
        <button type="button" class="btn btn-ghost btn-xs churn-run-btn" data-action="churn-run-again" data-id="${idAttr}" title="Start a fresh offer from this one's terms">Run again</button>
        <button type="button" class="btn btn-ghost btn-xs churn-snooze-btn" data-action="churn-snooze-toggle" data-id="${idAttr}" aria-expanded="false" aria-controls="${menuId}" title="Snooze this churn reminder">Snooze</button>
        <div class="churn-snooze-menu" id="${menuId}" hidden>
          <button type="button" class="btn btn-ghost btn-xs" data-action="churn-snooze" data-id="${idAttr}" data-snooze="30">30 days</button>
          <button type="button" class="btn btn-ghost btn-xs" data-action="churn-snooze" data-id="${idAttr}" data-snooze="90">90 days</button>
          <button type="button" class="btn btn-ghost btn-xs" data-action="churn-snooze" data-id="${idAttr}" data-snooze="forever">Indefinitely</button>
        </div>
      </div>
    </div>`;
  };

  // A snoozed row (inside the reveal): shows the until-copy + an Unsnooze button.
  const snoozedRow = (r) => {
    const o = r.o;
    const su = o.churn_snoozed_until;
    const untilText = (su && su !== 'forever' && parseDate(su))
      ? `Snoozed until ${formatDateDisplay(su)}`
      : 'Snoozed indefinitely';
    const idAttr = escapeAttr(o.id);
    return `<div class="churn-row-wrap churn-row-snoozed"${offerColorHex(o) ? ` style="--offer-color:${offerColorHex(o)};"` : ''}>
      <div class="churn-row clickable" data-action="open-action-target" data-target-kind="offer" data-target-id="${idAttr}" role="button" tabindex="0">
        <div class="churn-row-main">
          <div class="churn-row-name">${escapeHtml(offerName(o))}</div>
          <div class="churn-row-date muted">${escapeHtml(untilText)}</div>
        </div>
      </div>
      <div class="churn-snooze">
        <button type="button" class="btn btn-ghost btn-xs churn-unsnooze-btn" data-action="churn-unsnooze" data-id="${idAttr}">Unsnooze</button>
      </div>
    </div>`;
  };

  const bodyParts = [];
  if (eligibleNow.length) {
    bodyParts.push(`<div class="churn-group-label">Eligible now</div>`);
    bodyParts.push(eligibleNow.map(r => row(r, true)).join(''));
  }
  if (upcoming.length) {
    bodyParts.push(`<div class="churn-group-label">Upcoming (next ${CHURN_HORIZON_DAYS} days)</div>`);
    bodyParts.push(upcoming.map(r => row(r, false)).join(''));
  }
  // Snoozed reveal — a muted toggle + a hidden block of snoozed rows. Present
  // only when at least one offer is snoozed.
  if (snoozed.length) {
    const n = snoozed.length;
    bodyParts.push(`<div class="churn-snoozed-reveal-wrap">
      <button type="button" class="btn btn-ghost btn-xs churn-snoozed-toggle" data-action="churn-reveal-toggle" aria-expanded="false" aria-controls="churn-snoozed-list">${n} snoozed — show</button>
      <div class="churn-snoozed-list" id="churn-snoozed-list" hidden>${snoozed.map(snoozedRow).join('')}</div>
    </div>`);
  }
  // Guaranteed non-empty: the section returns early above unless at least one
  // bucket has an entry or an offer is snoozed.
  const body = bodyParts.join('');

  return `
    <section class="card churn-section">
      <div class="card-header">
        <h2>Upcoming churn dates</h2>
      </div>
      <div class="churn-list">${body}</div>
    </section>
  `;
}

function statCard(label, value, meta = '', variant = '', action = null) {
  // When `action` is provided, the card becomes a clickable navigation
  // surface. data-action routes through onClick(); role/tabindex make it
  // keyboard-accessible. CSS in `.stat-card[data-action]` adds the
  // pointer + hover-lift affordance.
  const navAttrs = action
    ? `data-action="${action}" role="button" tabindex="0"`
    : '';
  return `
    <div class="stat-card" ${navAttrs}>
      <div class="stat-label">${label}</div>
      <div class="stat-value ${variant}">${value}</div>
      ${meta ? `<div class="stat-meta">${meta}</div>` : ''}
    </div>
  `;
}

/* ============================================================
   REMINDER / ACTION ITEM MODEL — ONE SHARED BUILDER
   ============================================================
   buildReminderItems(state) is the SINGLE source of every actionable
   date in the planner. Both surfaces consume its output so they can
   never diverge again (step-3 P1; step-6 feed-contract v2):
     • computeReminderFeed     — schema-2 machine feed (Gist → iOS Shortcut
                                 / ICS worker); emits ALL future items, no
                                 horizon; adds tombstones + manifestVersion.
                                 COMPLETED items (see below) are excluded here,
                                 which tombstones them for the consumer.
     • computeUpcomingActions  — the overview "Upcoming actions" LIST; keeps
                                 its 90-day horizon filter (by design), and
                                 lingers recently-completed items greyed.
   (The former third consumer, computeActionsRequired — the At-a-glance headline
   COUNT — was removed with that panel in R70; nothing else read it.)

   COMPLETION (R70): each item carries `done`/`doneDate`. requirement-deadline
   reads them from its requirement row (write-through — the same source of truth
   as the offer-card checklist); every other completable kind reads them from
   state.action_done[id]. A done item is EXCLUDED from computeReminderFeed's
   items[] (→ tombstone) and lingered greyed by the LIST for
   ACTION_DONE_LINGER_DAYS. When nothing is completed, both surfaces are
   byte-identical to their pre-R70 output (the added fields are never serialized
   into the feed and the list simply shows no greyed rows).

   Each built item carries BOTH the feed fields and the list fields:
     id         — stable across syncs (offer/commitment/event id + kind);
                  per-DD items use a persisted per-DD id, never array index.
     kind       — feed semantic tag (offer-expires | deposit-deadline |
                  dd-initiate | dd-window-end | debit-deadline | withdrawal |
                  commitment-end | inflow | outflow).
     dueDate    — ISO YYYY-MM-DD (feed stamps 09:00 local on emit).
     title,notes— Reminder title/body (planner-owned; the consumer must not
                  overwrite a user's added notes — see the build guide).
     isWork     — true for to-dos the user must perform (deposit/DD/debit);
                  false for informational dates (expiry, withdrawal, events).
     listLabel/tag/name/sub/color/targetKind/targetId — LIST-row fields.

   GATE RULES (step-6 [3], step-3 P1) — keyed on the MODERN status fields
   (accountStatus / subStatus), NOT the legacy deriveLegacyStatus shadow
   (the legacy 'approved→funded' mapping used to hide funding deadlines the
   moment an account opened). offer-expires shows for prospects too (owner
   wants prospect expiries visible); WORK items (deposit/dd/debit) emit only
   when the offer is committed (subStatus approved or on-track) — met-waiting
   is excluded because the work is already done. The legacy-status shadow is
   NOT read here at all (it stays elsewhere per R38; deriveLegacyStatus is
   untouched).
*/
// subStatus values for which the account is committed and requirement WORK
// (deposit / DD initiations / debit purchases) is still outstanding.
export { render, renderErrorState, renderShell, renderHeader, renderMobileNav, renderActiveView, renderOverview, renderOverviewChurnSection, statCard };
