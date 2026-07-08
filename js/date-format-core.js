const TODAY = startOfDay(new Date());
/* ============================================================
   DATE UTILITIES
   ============================================================ */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/* ============================================================
   RECURRING CAPITAL EVENTS
   ============================================================
   Capital events may carry a `recurrence` object describing how often
   they repeat:
     { kind: 'none' | 'weekly' | 'biweekly' | 'monthly' | 'custom',
       everyDays: number,    // only used when kind === 'custom'
       endDate:  'YYYY-MM-DD' (optional — empty means "through horizon")
     }
   expandEventInstances() materializes all instances within a window so
   the projection engine and chart marker code can treat each one as
   an independent event without knowing it came from a recurring rule.
*/
function expandEventInstances(e, horizonStartDate, horizonEndDate) {
  const startDate = parseDate(e.date);
  if (!startDate) return [];
  const amount = Number(e.amount);
  if (!Number.isFinite(amount) || amount === 0) return [];
  const rec = e.recurrence || {};
  const kind = rec.kind || 'none';
  const startMs = horizonStartDate ? horizonStartDate.getTime() : -Infinity;
  const endMs = horizonEndDate ? horizonEndDate.getTime() : Infinity;
  if (kind === 'none') {
    const t = startDate.getTime();
    if (t < startMs || t > endMs) return [];
    return [{ date: startDate, amount }];
  }
  // Recurrence end: either user-set or projection horizon end
  const recEnd = rec.endDate ? parseDate(rec.endDate) : null;
  const stopMs = recEnd ? Math.min(recEnd.getTime(), endMs) : endMs;
  let stepDays = 0, monthly = false;
  if (kind === 'weekly') stepDays = 7;
  else if (kind === 'biweekly') stepDays = 14;
  else if (kind === 'monthly') monthly = true;
  else if (kind === 'custom') stepDays = Math.max(1, Math.min(365, Number(rec.everyDays) || 7));
  else return [{ date: startDate, amount }];

  const instances = [];
  let cur = new Date(startDate);
  // Hard upper bound — even daily for 5 years is 1825 iterations
  for (let n = 0; n < 2000; n++) {
    const t = cur.getTime();
    if (t > stopMs) break;
    if (t >= startMs) instances.push({ date: new Date(cur), amount });
    if (monthly) cur = new Date(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
    else cur = new Date(cur.getTime() + stepDays * 86400000);
  }
  return instances;
}

// Convenience for "Upcoming Actions": just the next instance from now.
function nextEventInstance(e, fromDate, horizonEndDate) {
  const instances = expandEventInstances(e, fromDate, horizonEndDate);
  return instances.length > 0 ? instances[0] : null;
}

function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) return startOfDay(s);
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d) ? null : d;
}

/* ============================================================
   US FEDERAL BANK HOLIDAYS (computed per year, cached)
   ============================================================
   The 11 Federal Reserve / ACH holidays. Computed dynamically so
   the business-day math stays correct indefinitely. Fixed-date
   holidays follow the "observed" rule: if the date falls on Sat,
   the observance is Fri; if on Sun, the observance is Mon. (This
   matches the official OPM and Fed observance rules.) Floating
   holidays (MLK, Presidents, Memorial, Labor, Columbus, Thanksgiving)
   compute their nth-weekday and need no observed shift since they
   always fall on a weekday.
*/
function _nthWeekdayOfMonth(year, month, weekday, n) {
  // month: 0-11, weekday: 0=Sun..6=Sat, n: 1-based
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}
function _lastWeekdayOfMonth(year, month, weekday) {
  const last = new Date(year, month + 1, 0); // last day of month
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - offset);
}
function _observed(d) {
  // Sat → Fri; Sun → Mon. Weekdays unchanged.
  const day = d.getDay();
  if (day === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  if (day === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  return d;
}
const _holidayCache = {};
function usFederalHolidays(year) {
  if (_holidayCache[year]) return _holidayCache[year];
  const dates = [
    _observed(new Date(year, 0, 1)),                  // New Year's Day
    _nthWeekdayOfMonth(year, 0, 1, 3),                // MLK Day — 3rd Mon Jan
    _nthWeekdayOfMonth(year, 1, 1, 3),                // Presidents Day — 3rd Mon Feb
    _lastWeekdayOfMonth(year, 4, 1),                  // Memorial Day — last Mon May
    _observed(new Date(year, 5, 19)),                 // Juneteenth (federal since 2021)
    _observed(new Date(year, 6, 4)),                  // Independence Day
    _nthWeekdayOfMonth(year, 8, 1, 1),                // Labor Day — 1st Mon Sep
    _nthWeekdayOfMonth(year, 9, 1, 2),                // Columbus Day — 2nd Mon Oct
    _observed(new Date(year, 10, 11)),                // Veterans Day
    _nthWeekdayOfMonth(year, 10, 4, 4),               // Thanksgiving — 4th Thu Nov
    _observed(new Date(year, 11, 25))                 // Christmas
  ];
  const set = new Set(dates.map(d => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }));
  _holidayCache[year] = set;
  return set;
}
function isUsBankHoliday(d) {
  const dt = d instanceof Date ? d : parseDate(d);
  if (!dt) return false;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return usFederalHolidays(y).has(`${y}-${m}-${dd}`);
}
function isBusinessDay(d) {
  const dt = d instanceof Date ? d : parseDate(d);
  if (!dt) return false;
  const day = dt.getDay();
  if (day === 0 || day === 6) return false; // weekend
  return !isUsBankHoliday(dt);
}
function nextBusinessDay(d) {
  let x = d instanceof Date ? new Date(d) : parseDate(d);
  if (!x) return null;
  while (!isBusinessDay(x)) x.setDate(x.getDate() + 1);
  return x;
}
function previousBusinessDay(d) {
  let x = d instanceof Date ? new Date(d) : parseDate(d);
  if (!x) return null;
  while (!isBusinessDay(x)) x.setDate(x.getDate() - 1);
  return x;
}
// Advance n BUSINESS days from d (each step skips weekends/holidays).
// addBusinessDays(Fri, 1) === Mon. n=0 returns d unchanged.
function addBusinessDays(d, n) {
  let x = d instanceof Date ? new Date(d) : parseDate(d);
  if (!x) return null;
  let added = 0;
  while (added < n) {
    x.setDate(x.getDate() + 1);
    if (isBusinessDay(x)) added++;
  }
  return x;
}

// Global DD transfer model (Settings → "DD transfer timing"). The
// round-trip for one direct deposit is: initiate → posts as a DD after
// `inDays` business days → seasons `seasonDays` business days in the
// account → sent back → returns to origin after `backDays` business
// days. Default 1/1/1 ("season 1 business day") so a Monday-initiated
// DD round-trips in ~3 days and a Friday-initiated one in ~5 (the
// weekend extends it). Weekends/holidays at any leg push the next leg
// out, which is the whole point of business-day awareness.
function isoDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : parseDate(d);
  if (!dt) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function addDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

// Add `n` calendar months to a Date, CLAMPING the day to the target month's
// last day rather than rolling over (Jan 31 + 1mo → Feb 28/29, never Mar 3).
// Uses the same local-midnight constructor idiom as parseDate (no UTC/string
// parsing), so it composes with isoDate() safely. `n` may be negative.
function addMonthsClamped(d, n) {
  const dt = d instanceof Date ? d : parseDate(d);
  if (!dt) return null;
  const y = dt.getFullYear();
  const m = dt.getMonth() + n;      // may be <0 or >11; Date normalizes the year
  const day = dt.getDate();
  // Last day of the target month: day 0 of the *following* month.
  const lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day, lastDay));
}

function daysBetween(a, b) {
  const ms = startOfDay(b) - startOfDay(a);
  return Math.round(ms / 86400000);
}

function formatDateShort(d) {
  const dt = d instanceof Date ? d : parseDate(d);
  if (!dt) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateMedium(d) {
  const dt = d instanceof Date ? d : parseDate(d);
  if (!dt) return '—';
  const sameYear = dt.getFullYear() === TODAY.getFullYear();
  return dt.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateLong(d) {
  const dt = d instanceof Date ? d : parseDate(d);
  if (!dt) return '—';
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function relativeDays(d) {
  const dt = parseDate(d);
  if (!dt) return '';
  const n = daysBetween(TODAY, dt);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 0) return `in ${n} days`;
  return `${-n} days ago`;
}

/* ============================================================
   CURRENCY FORMATTING
   ============================================================ */
function formatCurrency(n, opts = {}) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return sign + '$' + Math.round(abs).toLocaleString('en-US');
}

function formatCurrencyDecimal(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCompactCurrency(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}K`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function formatPercent(n, digits = 1) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return (n * 100).toFixed(digits) + '%';
}

/* ============================================================
   DISPLAY <-> STORAGE BOUNDARY HELPERS (R62)
   ============================================================
   Storage/sync formats NEVER change: dates stay ISO `YYYY-MM-DD`
   strings in state/localStorage/Gist and in every internal
   comparison; money stays a plain Number in state. These four
   helpers are the SINGLE conversion point at the render/read
   boundary — the display value (M-D-YYYY dates, comma-grouped
   money) exists only inside input/render code, and is parsed
   straight back to canonical ISO / Number before it ever reaches
   state. Do not scatter ad-hoc toLocaleString/replace conversions;
   route through these so a missed site can't corrupt an offer. */

// ISO `YYYY-MM-DD` -> owner's display format `M-D-YYYY` (no leading
// zeros). Empty -> ''. Anything not ISO-shaped is returned unchanged
// so a stray already-humanized string never gets mangled.
function formatDateDisplay(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso);
  return `${Number(m[2])}-${Number(m[3])}-${m[1]}`;
}

// Accepts the display format `M-D-YYYY` (owner's), tolerates
// `M/D/YYYY` and a pasted ISO `YYYY-MM-DD`, and returns canonical
// ISO `YYYY-MM-DD` — or null if it can't be understood. This is the
// ONLY thing that reads a yv-date field's typed/displayed value back
// into state, so it must never hand a non-ISO string downstream.
function parseDateInput(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  // Pasted / stored ISO first (YYYY-MM-DD or YYYY/MM/DD).
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return _isoFromYMD(+m[1], +m[2], +m[3]);
  // Owner's M-D-YYYY (hyphen) or tolerated M/D/YYYY (slash).
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return _isoFromYMD(+m[3], +m[1], +m[2]);
  return null;
}
// Build an ISO date only if the Y/M/D make a real calendar date;
// reject overflow (e.g. 13-40-2026, 2-30-2026) so bad input becomes
// null rather than a silently rolled-over date.
function _isoFromYMD(y, mo, d) {
  if (!(y >= 1000 && y <= 9999 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Number or numeric string -> thousands-grouped display string,
// e.g. 25000 -> "25,000", -1234.5 -> "-1,234.5". Preserves a
// trailing "." and in-progress decimals while typing, and a leading
// "-". Non-numeric characters ($, spaces, stray commas) are stripped
// first so it's safe to re-run on its own output.
function formatMoneyInput(val) {
  if (val === '' || val == null) return '';
  let s = String(val).replace(/[^0-9.\-]/g, '');
  if (s === '' || s === '-' || s === '.' || s === '-.') return s;
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  // Keep only the first '.'; fold any extras into the fractional part.
  const dot = s.indexOf('.');
  let intPart, fracPart = null;
  if (dot === -1) { intPart = s; }
  else { intPart = s.slice(0, dot); fracPart = s.slice(dot + 1).replace(/\./g, ''); }
  intPart = intPart.replace(/^0+(?=\d)/, ''); // drop leading zeros but keep a lone 0
  if (intPart === '') intPart = fracPart === null && dot === -1 ? '' : '0';
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let out = (neg ? '-' : '') + grouped;
  if (dot !== -1) out += '.' + fracPart;
  return out;
}

// Comma-grouped / $-prefixed money display string -> plain Number.
// Strips $, spaces, commas. Returns null for empty (matching the
// existing readOfferForm `num('')===null` contract); returns NaN for
// genuinely non-numeric text so callers using `Number.isFinite`/`||`
// behave exactly as they did with the old bare `Number(value)`.
function parseMoneyInput(str) {
  if (str === '' || str == null) return null;
  const cleaned = String(str).replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  return Number(cleaned);
}

/* ============================================================
   ID GENERATOR
   ============================================================ */
function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export { TODAY, startOfDay, expandEventInstances, nextEventInstance, parseDate, isUsBankHoliday, isBusinessDay, nextBusinessDay, previousBusinessDay, addBusinessDays, isoDate, addDays, addMonthsClamped, daysBetween, formatDateShort, formatDateMedium, formatDateLong, relativeDays, formatCurrency, formatCompactCurrency, formatPercent, formatDateDisplay, parseDateInput, _isoFromYMD, formatMoneyInput, parseMoneyInput, uid };
