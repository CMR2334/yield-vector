import { App } from './app-state.js';
import { TODAY, addDays, dateTapDecision, formatDateDisplay, isBusinessDay, isUsBankHoliday, isoDate, nextBusinessDay, parseDate, parseDateInput, previousBusinessDay } from './date-format-core.js';
import { ddRoundTrip, directDepositEffectiveDate, ddTransferConfig, setDdTransferProvider } from './dd-core.js';
import { render } from './render-shell-overview.js';

// The DD round-trip / effective-date / ddTransfer-config math lives in the pure
// dd-core.js so the optimizer engine can import it without dragging in App or
// render. Register the LIVE ddTransfer resolver here (the impure side) so a bare
// in-app ddRoundTrip(dd) still reads the owner's setting exactly as before —
// byte-identical to the old direct App.state.settings.ddTransfer read.
setDdTransferProvider(() => (App.state && App.state.settings && App.state.settings.ddTransfer) || null);

// Suggested LATEST-safe funding date for an offer: the deposit deadline
// (signup + daysAfterSignupAllowedBeforeDeposit) minus a 1-day buffer,
// then walked BACKWARD to the nearest business day if that lands on a
// weekend/holiday. Keeps you safely before the deadline while funding
// on a day the bank actually processes money. Returns a Date or null
// when there isn't enough info to compute it.
function suggestedFundingDate(signupISO, daysAfterDeposit) {
  const signup = parseDate(signupISO);
  const n = Number(daysAfterDeposit);
  if (!signup || !Number.isFinite(n) || n <= 0) return null;
  const deadline = addDays(signup, n);          // last allowed deposit day
  const buffered = addDays(deadline, -1);        // 1-day safety buffer
  // If the buffered day already precedes signup (tiny windows), clamp
  // to the next business day on/after signup instead.
  if (buffered <= signup) return nextBusinessDay(signup);
  return previousBusinessDay(buffered);
}

/* ============================================================
   CUSTOM DATE PICKER (color-coded popover)
   ============================================================
   Replaces the native <input type="date"> on offer-modal date fields
   with a month grid whose business days are shaded by an optimality
   metric. Two modes (set via data-picker-mode on the input):
     'dd'    — shade business days by the DD round-trip hold (green =
               shortest, red = longest); for picking DD initiation dates.
     'plain' — business days green ("posts same business day"), weekend/
               holiday amber ("will shift to next business day"); for
               funding/signup dates.
   The input stays a readonly text field whose .value is the YYYY-MM-DD
   string (so FormData / readDdRowsFromForm keep working unchanged). The
   popover is appended to <body> with position:fixed so the modal's
   overflow can't clip it.
   ============================================================ */
const DatePicker = {
  el: null, input: null, mode: 'plain', vY: 0, vM: 0,
  // Feature 1 (2026-07-13b): per-field CONSTRAINTS (ISO floor/ceiling) so dates
  // that are no longer possible for THIS field are grayed + unclickable. Read
  // fresh from the input's data-floor / data-ceiling on every open (the form
  // keeps them current from the LIVE field values — see modals-forms
  // applyDateConstraints), and reset to '' for fields that carry no constraint.
  floorISO: '', ceilingISO: '',
  ensure() {
    if (this.el) return;
    const d = document.createElement('div');
    d.className = 'yv-dp';
    d.style.display = 'none';
    document.body.appendChild(d);
    this.el = d;
    d.addEventListener('mousedown', (e) => e.preventDefault()); // keep input focus
    d.addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('mousedown', (e) => {
      if (this.el.style.display === 'none') return;
      if (!this.el.contains(e.target) && e.target !== this.input) this.close();
    });
    window.addEventListener('resize', () => this.close());
  },
  open(input) {
    this.ensure();
    this.input = input;
    this.mode = input.dataset.pickerMode || 'plain';
    // Reset-then-read so a constraint from a previously-opened field can't leak.
    this.floorISO = input.dataset.floor || '';
    this.ceilingISO = input.dataset.ceiling || '';
    // input.value holds the M-D-YYYY display string; parse back to ISO
    // (parseDateInput also tolerates a pasted ISO) before seeding the grid.
    const cur = parseDate(parseDateInput(input.value)) || TODAY;
    this.vY = cur.getFullYear(); this.vM = cur.getMonth();
    this.el.style.display = 'block';
    this.render();
    this.place();   // decide + anchor ONCE per open
  },
  isOpen() { return !!(this.el && this.el.style.display !== 'none'); },
  close() {
    if (this.el) this.el.style.display = 'none';
    // Closing the picker (day picked, outside tap, resize, modal close) ENDS the
    // tap state machine for that field: it goes back to picker-primary and must
    // not stay armed/readonly. A field the user has ALREADY switched to typing
    // keeps its keypad — DateFieldTap.reset skips it.
    const inp = this.input;
    this.input = null;
    if (inp && DateFieldTap.typingInput !== inp) DateFieldTap.reset(inp);
  },
  // Anchor the popover once on open. The above/below decision uses a FIXED
  // height estimate (not the live offsetHeight) so it doesn't change between
  // a 5-row and 6-row month. We anchor by a fixed EDGE (top when below,
  // bottom when above) so adding a 6th row grows the grid in one direction
  // instead of flipping the whole popover across the field.
  place() {
    const r = this.input.getBoundingClientRect();
    const el = this.el;
    el.style.position = 'fixed';
    // Measure the ACTUAL rendered size (responsive width on narrow screens).
    const w = el.offsetWidth || 280;
    const h = el.offsetHeight || 320;
    const vw = window.innerWidth, vh = window.innerHeight;
    // Horizontal: anchor to the field's left, but clamp fully into the
    // viewport with an 8px margin so it can never hang off either edge.
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    el.style.left = left + 'px';
    // Vertical: below if it fits, else above; clamp so it never spills past
    // the top or bottom of the screen either.
    const roomBelow = vh - r.bottom;
    if (roomBelow >= h + 8 || r.top < h + 8) {
      const top = Math.max(8, Math.min(r.bottom + 6, vh - h - 8));
      el.style.top = top + 'px'; el.style.bottom = 'auto';
    } else {
      const bottom = Math.max(8, Math.min(vh - r.top + 6, vh - h - 8));
      el.style.bottom = bottom + 'px'; el.style.top = 'auto';
    }
  },
  // For the visible month, compute per-business-day hold (dd mode) to find
  // the min/max so coloring is relative to what's achievable that month.
  monthStats() {
    if (this.mode !== 'dd') return { min: 0, max: 0, held: {} };
    const y = this.vY, m = this.vM, held = {};
    let min = Infinity, max = -Infinity;
    const dim = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= dim; d++) {
      const date = new Date(y, m, d);
      if (!isBusinessDay(date)) continue;
      const rt = ddRoundTrip({ plannedDate: isoDate(date) });
      if (!rt) continue;
      held[d] = rt.heldDays;
      if (rt.heldDays < min) min = rt.heldDays;
      if (rt.heldDays > max) max = rt.heldDays;
    }
    return { min, max, held };
  },
  render() {
    const y = this.vY, m = this.vM;
    const stats = this.monthStats();
    const monthName = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const selected = parseDate(parseDateInput(this.input && this.input.value));
    const firstPad = new Date(y, m, 1).getDay();
    const dim = new Date(y, m + 1, 0).getDate();
    let cells = '';
    let blockedCount = 0;
    for (let i = 0; i < firstPad; i++) cells += '<span></span>';
    for (let d = 1; d <= dim; d++) {
      const date = new Date(y, m, d);
      const dayISO = isoDate(date);
      // Feature 1: a day outside this field's [floor, ceiling] is IMPOSSIBLE for
      // the task (e.g. a funding date before the entered sign-up date). Render it
      // muted + NON-interactive (no data-day, disabled) so it's visibly and
      // functionally unavailable. Blocking wins over the optimality shading.
      const blocked = (this.floorISO && dayISO < this.floorISO) || (this.ceilingISO && dayISO > this.ceilingISO);
      if (blocked) {
        blockedCount++;
        cells += `<button type="button" class="yv-dp-day blocked" disabled aria-disabled="true"><b>${d}</b></button>`;
        continue;
      }
      const biz = isBusinessDay(date), holi = isUsBankHoliday(date);
      let cls = 'yv-dp-day';
      let badge = '';
      if (this.mode === 'neutral') {
        // 'neutral' — same grid/layout/formatting as the color-coded pickers
        // but WITHOUT the date-optimization colorization (no green/amber/hold
        // shading, no weekend/holiday tint). Only selection + blocked states
        // carry any visual weight. Used where the date has no optimality
        // meaning (e.g. capital-event dates).
      } else if (!biz) {
        cls += this.mode === 'plain' ? ' amber' : ' muted';
      } else if (this.mode === 'dd') {
        const h = stats.held[d];
        if (h != null) {
          if (h <= stats.min) cls += ' good';
          else if (h >= stats.max && stats.max > stats.min) cls += ' bad';
          else cls += ' mid';
          badge = `<i>${h}d</i>`;
        }
      } else {
        cls += ' good';
      }
      if (holi && this.mode !== 'neutral') cls += ' holiday';
      if (selected && selected.getFullYear() === y && selected.getMonth() === m && selected.getDate() === d) cls += ' sel';
      cells += `<button type="button" class="${cls}" data-day="${isoDate(date)}"><b>${d}</b>${badge}</button>`;
    }
    // Pad with trailing empty cells so the grid is ALWAYS 6 rows (42
    // cells) — keeps the popover a constant height across months without
    // relying on min-height stretching (which caused the overflow bug).
    const totalCells = firstPad + dim;
    for (let i = totalCells; i < 42; i++) cells += '<span></span>';
    // Feature 1: show the "unavailable" key only when the month ON SCREEN
    // actually rendered blocked days. Keying it off "this field has a bound"
    // put the legend on every month of a constrained field, including the
    // ones where nothing is grayed and the key explains nothing.
    const blockedLegend = blockedCount ? `<span><i class="s blocked"></i>unavailable</span>` : '';
    const legend = this.mode === 'dd'
      ? `<div class="yv-dp-legend"><span><i class="s good"></i>shortest</span><span><i class="s mid"></i>mid</span><span><i class="s bad"></i>longest</span>${blockedLegend}</div>`
      : this.mode === 'neutral'
        // No optimality legend in neutral mode — only the (rare) blocked key.
        ? (blockedLegend ? `<div class="yv-dp-legend">${blockedLegend}</div>` : '')
        : `<div class="yv-dp-legend"><span><i class="s good"></i>posts same day</span><span><i class="s amber"></i>shifts to next business day</span>${blockedLegend}</div>`;
    this.el.innerHTML =
      `<div class="yv-dp-head"><button type="button" data-nav="-1">‹</button><span>${monthName}</span><button type="button" data-nav="1">›</button></div>`
      + `<div class="yv-dp-dow">${['S','M','T','W','T','F','S'].map(x => `<span>${x}</span>`).join('')}</div>`
      + `<div class="yv-dp-grid">${cells}</div>`
      + legend
      + `<div class="yv-dp-foot"><button type="button" data-today="1">Today</button><button type="button" data-clear="1">Clear</button></div>`;
  },
  onClick(e) {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      this.vM += parseInt(nav.dataset.nav, 10);
      if (this.vM < 0) { this.vM = 11; this.vY--; }
      if (this.vM > 11) { this.vM = 0; this.vY++; }
      // Re-render only — do NOT re-anchor. The popover keeps its fixed
      // edge so a 5↔6 row month change grows the grid in place instead
      // of flipping the whole popover above/below the field.
      this.render();
      return;
    }
    if (e.target.closest('[data-today]')) {
      this.vY = TODAY.getFullYear(); this.vM = TODAY.getMonth();
      this.setValue(isoDate(TODAY)); return;
    }
    if (e.target.closest('[data-clear]')) { this.setValue(''); return; }
    const day = e.target.closest('[data-day]');
    if (day) this.setValue(day.dataset.day);
  },
  setValue(iso) {
    if (!this.input) return;
    // Grid hands us canonical ISO (or '' for Clear); show the owner's
    // M-D-YYYY display format. Every reader parses back via parseDateInput.
    this.input.value = iso ? formatDateDisplay(iso) : '';
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.input.dispatchEvent(new Event('change', { bubbles: true }));
    this.close();
  }
};

/* ============================================================
   DATE-FIELD TAP MODE (picker-primary; owner directive 2026-08-23)
   ============================================================
   The owner's phone screenshot: tapping "Planned funding date" raised the iOS
   keypad + AutoFill bar ON TOP of the picker he actually wanted. So on TOUCH
   devices a .yv-date bubble is now picker-primary:
     • pointerdown ARMS the field BEFORE focus can raise the keyboard
       (readOnly + inputmode="none" — readOnly is what actually suppresses the
       iOS keypad; inputmode="none" is the belt for browsers that honor it),
     • the first tap opens ONLY the picker,
     • a SECOND tap on the ACTIVE field (picker open on it) closes the picker
       and hands the field to manual typed entry with the numeric keypad,
     • state resets on blur, on day selection / picker close (DatePicker.close),
       on switching to another date field, and on modal close (closeModal) —
       and, because every reset runs through blur, on an unparseable typed value.
   Desktop (pointer: fine) keeps the pre-directive behavior untouched: the field
   is never armed, so click = open picker AND type freely.
   The DECISION is the pure dateTapDecision() in date-format-core.js; this object
   is only the DOM half. ============================================================ */
const DateFieldTap = {
  typingInput: null,
  // A re-render (Settings, a rebuilt DD row) can replace the typing field's node
  // without a blur ever firing. Drop a detached reference before any decision so
  // a stale node can never make a live field look "already typing".
  _prune() { if (this.typingInput && this.typingInput.isConnected === false) this.typingInput = null; },
  coarse() {
    try { return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }
    catch { return false; }
  },
  // pointerdown/mousedown — runs BEFORE the browser focuses the field, which is
  // the only moment where the keypad can still be suppressed for this tap.
  arm(input) {
    if (!input || !this.coarse()) return;
    this._prune();
    if (this.typingInput && this.typingInput !== input) this.reset(this.typingInput);  // field switch
    if (this.typingInput === input) return;                                            // already typing here
    input.readOnly = true;
    input.setAttribute('inputmode', 'none');
  },
  // click — decide between opening the picker and switching to typed entry.
  tap(input) {
    if (!input) return;
    this._prune();
    const decision = dateTapDecision({
      coarse: this.coarse(),
      typing: this.typingInput === input,
      pickerOpen: DatePicker.isOpen() && DatePicker.input === input
    });
    if (decision === 'picker+typing' || decision === 'picker-only') { DatePicker.open(input); return; }
    if (decision === 'typing') this.toTyping(input);
    // 'noop' — the field is already in typing mode; leave the caret where the
    // user put it and keep the picker closed.
  },
  // Second tap on the active field: picker away, keypad up.
  toTyping(input) {
    DatePicker.close();
    input.readOnly = false;
    input.setAttribute('inputmode', 'numeric');
    // The field is ALREADY focused (armed + focused by the first tap), and iOS
    // raises the keypad only when focus MOVES inside a user gesture — so bounce
    // focus off and back on. The blur listener's reset is harmless here:
    // typingInput is only claimed after the bounce.
    try { input.blur(); } catch { /* non-fatal */ }
    try { input.focus(); } catch { /* non-fatal */ }
    this.typingInput = input;
    try { const n = (input.value || '').length; input.setSelectionRange(n, n); } catch { /* not all inputs support it */ }
  },
  // Back to picker-primary for `input` (default: whichever field is typing).
  reset(input) {
    const el = input || this.typingInput;
    if (this.typingInput === el) this.typingInput = null;
    if (!el) return;
    el.readOnly = false;
    el.setAttribute('inputmode', 'numeric');
  },
  resetAll() { this.reset(this.typingInput); this.typingInput = null; }
};

/* ============================================================
   DD-METHOD DATAPOINTS (Doctor of Credit)
   ============================================================
   Lazy-loads dd-methods.json (1,150+ destination banks, each with the
   source methods that code as a direct deposit + their DP counts). For a
   given offer bank, ranks methods by DP count and flags which are the
   user's own source banks (settings.sourceBanks). Same-origin fetch —
   the file is committed alongside index.html and served by GitHub Pages,
   so it works offline-after-first-load (browser cache) and survives
   across sessions (it's in the repo, not anyone's context).
   ============================================================ */
const DDMethods = {
  data: null, loading: false, loaded: false, failed: false,
  load() {
    if (this.loading || this.loaded) return;
    this.loading = true;
    fetch('dd-methods.json')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(j => { this.data = j; this.loaded = true; this.loading = false; render(); })
      .catch(() => { this.loading = false; this.failed = true; });
  },
  slug(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); },
  // Find the DoC entry for an offer bank name (exact slug, else fuzzy
  // prefix/contains match — "Chase Bank" ↔ "chase").
  lookup(bankName) {
    if (!this.data || !this.data.banks) return null;
    const sl = this.slug(bankName);
    if (!sl) return null;
    const banks = this.data.banks;
    if (banks[sl]) return banks[sl];
    let best = null, bestLen = 0;
    for (const k in banks) {
      if (sl.length >= 4 && (sl.startsWith(k) || k.startsWith(sl)) && k.length > bestLen) { best = banks[k]; bestLen = k.length; }
    }
    return best;
  },
  // Ranked methods for an offer bank + which are the user's source banks,
  // plus the fallback signals (best-of-mine, none-of-mine).
  forOffer(bankName, sourceBanks) {
    const entry = this.lookup(bankName);
    if (!entry) return null;
    const mine = (sourceBanks || []).map(b => this.slug(b)).filter(Boolean);
    const isMine = (method) => {
      const ms = this.slug(method);
      return mine.some(x => ms === x || (x.length >= 3 && (ms.startsWith(x) || x.startsWith(ms))));
    };
    // Only methods with at least one DoC datapoint are useful evidence —
    // a method listed with dps:0 (e.g. "American Express 0") is noise.
    const works = (entry.works || []).filter(w => w.dps > 0).map(w => ({ ...w, mine: isMine(w.method) }));
    return {
      name: entry.name,
      top3: works.slice(0, 3),
      myBest: works.filter(w => w.mine).sort((a, b) => b.dps - a.dps)[0] || null,
      topHasMine: works.slice(0, 3).some(w => w.mine),
      anyMine: works.some(w => w.mine),
      hasSourceBanks: (sourceBanks || []).length > 0
    };
  }
};

export { ddTransferConfig, ddRoundTrip, suggestedFundingDate, directDepositEffectiveDate, DatePicker, DateFieldTap, DDMethods };
