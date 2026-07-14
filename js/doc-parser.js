import { _isoFromYMD } from './date-format-core.js';
/* ============================================================
   DoC IMPORT (Phase 6): deterministic "glance" parser
   ============================================================
   parseDocPost(raw) → { fields:{<key>:{value,confidence,snippet}}, unparsed:[…] }
   Pure, offline, network-free. Accepts plain text OR raw HTML (a pasted DoC
   post). HTML is walked on a DETACHED document via DOMParser — never innerHTML'd
   into the live DOM — so untrusted markup can't execute or touch the page.

   Design source: docs/assessments/2026-07-05 Part I + the 8 corpus quirks.
   The machine target is the "Offer at a glance" list — a `Label: value` block at
   the top of every post — plus the leading "Update M/D/YY:" paragraphs (recency
   reconciliation) and a light body scan for churn-eligibility language.

   Every extracted field carries the verbatim source snippet (≤120 chars) it came
   from, so the preview panel can show the user exactly what a value was read off.
   Confidence: 'high' (unambiguous glance value), 'medium' (a reconciled/derived
   value, or a fuzzy label hit), 'low' (a best-guess, e.g. churn anchor). The
   parser NEVER writes app state — it only proposes; the preview panel applies. */

// Normalize a raw paste to plain text + strike-through spans. If it looks like
// HTML (has a tag), walk it on a detached DOMParser document: text is the
// visible text; `struck` is the concatenated text of every <del>/<s>/<strike>
// element so callers can prefer the non-struck (current) value (quirk 4). Plain
// text passes through unchanged with struck:''. Never throws.
function docNormalizeInput(raw) {
  const s = String(raw == null ? '' : raw);
  const looksHtml = /<\w+[\s>/]/.test(s) || /<\/\w+>/.test(s);
  if (!looksHtml) return { text: s, struck: '' };
  try {
    const doc = new DOMParser().parseFromString(s, 'text/html');
    if (!doc || !doc.body) return { text: s.replace(/<[^>]+>/g, ' '), struck: '' };
    // Collect struck text before we flatten, then remove struck nodes from the
    // tree so the "current" text reflects the non-struck value.
    const struckParts = [];
    doc.body.querySelectorAll('del, s, strike').forEach(el => {
      const t = (el.textContent || '').trim();
      if (t) struckParts.push(t);
      el.remove();
    });
    // Insert newlines around block elements so `Label: value` rows don't run
    // together once textContent flattens them.
    doc.body.querySelectorAll('li, p, br, tr, div, h1, h2, h3, h4').forEach(el => {
      el.appendChild(doc.createTextNode('\n'));
    });
    // Flatten, then normalize per-LINE so a paragraph whose SOURCE HTML wrapped
    // across multiple physical lines (literal newlines inside a <p>) collapses
    // back to one logical line — critical for the "Update M/D/YY … extended to
    // DATE." recency paragraphs and multi-line glance rows. Split on runs of
    // newlines, collapse inner whitespace per chunk, drop empties.
    const flat = (doc.body.textContent || '').replace(/\u00a0/g, ' ');
    const text = flat.split(/\n+/).map(function (part) { return part.replace(/[ \t\r]+/g, ' ').trim(); }).filter(Boolean).join('\n');
    return { text, struck: struckParts.join(' \n ') };
  } catch (e) {
    // Degrade to a crude tag-strip rather than fail the import.
    return { text: s.replace(/<[^>]+>/g, ' '), struck: '' };
  }
}

// Trim a source snippet to ≤120 chars, collapsing whitespace, for the preview.
function docSnippet(s) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > 120 ? t.slice(0, 117) + '…' : t;
}

// Cap a string at n chars with an ellipsis (word-boundary-agnostic; used for
// condition values that must not run unbounded into the form).
function docCapText(s, n) {
  const t = String(s == null ? '' : s).trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '').trim() + '…' : t;
}

// A condition clause captured from the body can END AT A COLON when the actual
// terms live in a following bullet list ("… otherwise you must:" + <ul>). The
// list, flattened by the HTML→text step, becomes consecutive lines right after
// the clause. Collect those bullet lines (≥2, so a single trailing sentence
// isn't mistaken for a list), strip bullet markers + trailing ", or"/" and"
// connectors, lowercase each item's first letter (they continue the sentence
// after the colon), and join with "; or ". Returns '' when no real list follows.
// `fromIdx` is the index in `text` immediately after the clause match.
function docBulletsAfterClause(text, fromIdx) {
  const lines = String(text).slice(fromIdx).split(/\r?\n/).map(l => l.trim());
  const bullets = [];
  for (let i = 0; i < lines.length && bullets.length < 6; i++) {
    const l = lines[i];
    if (l === '') { if (bullets.length) break; else continue; }
    // Stop once a list has started and we hit a new glance-style label
    // ("Label: value") or an over-long paragraph (not a list item).
    if (bullets.length && (/^[A-Za-z][A-Za-z /&-]{0,28}:\s/.test(l) || l.length > 180)) break;
    let b = l.replace(/^[\s•·\-\*•●▪‣]+/, '')      // leading bullet glyphs
             .replace(/[,;]?\s*(?:or|and)\s*$/i, '')                  // trailing ", or" / " and"
             .trim();
    if (!b) continue;
    b = b.charAt(0).toLowerCase() + b.slice(1);
    bullets.push(b);
  }
  return bullets.length >= 2 ? bullets.join('; or ') : '';
}

// Fuzzy label match (quirk 6): lowercase, strip non-alphanumerics, test that all
// of the target's significant tokens appear in the candidate label. Tolerates
// "Direct Deposit Required" vs "Direct deposit needed" etc.
function docLabelMatches(label, tokens) {
  const norm = String(label).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return tokens.every(t => norm.indexOf(t) !== -1);
}

// Pull the glance list into an ordered array of {label, value, raw}. A glance
// row is a line of the form `Label: value` where the label side is short (≤6
// words) — this excludes prose sentences that merely contain a colon. Also
// tolerates the WordPress list markup already flattened to "Label value" on its
// own line by splitting on the first colon only.
function docExtractGlanceRows(text) {
  const rows = [];
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.indexOf(':') === -1) continue;
    const ci = l.indexOf(':');
    const label = l.slice(0, ci).trim();
    const value = l.slice(ci + 1).trim();
    if (!label || !value) continue;
    // Label side must be short and not a full sentence (no trailing period-word
    // count blow-up). ≤6 words keeps "Early account termination fee" but drops
    // "Note that the bonus posts within 60 days: see below".
    if (label.split(/\s+/).length > 6) continue;
    // Drop an "Update M/D/YY" pseudo-label — those are handled separately.
    if (/^update\b/i.test(label) && /\d/.test(label)) continue;
    rows.push({ label, value, raw: l });
  }
  return rows;
}

// The value of the FIRST glance row whose label fuzzy-matches any token-set in
// `tokenSets`. Returns {value, raw} or null.
function docGlance(rows, tokenSets) {
  for (const row of rows) {
    for (const tokens of tokenSets) {
      if (docLabelMatches(row.label, tokens)) return { value: row.value, raw: row.raw };
    }
  }
  return null;
}

// Parse every US-format date in a string; return the MAX (latest) as ISO, plus
// its verbatim match (quirk 7 — parse-all-dates-take-max). Accepts M/D/YY,
// M/D/YYYY, M-D-YYYY, and "Month D, YYYY". Returns null if none.
function docLatestDate(str) {
  const s = String(str || '');
  const found = [];
  let m;
  // ISO YYYY-MM-DD ("Extended through 2026-09-30"). Matched FIRST so its own
  // hyphens aren't mis-read by the M/D/Y scanner below.
  let iso4 = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  const isoSpans = [];
  while ((m = iso4.exec(s))) {
    const iso = _isoFromYMD(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) { found.push({ iso, text: m[0] }); isoSpans.push([m.index, m.index + m[0].length]); }
  }
  const inIso = (idx) => isoSpans.some(sp => idx >= sp[0] && idx < sp[1]);
  // Numeric M/D/YY or M/D/YYYY (slash or hyphen).
  let re = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g;
  while ((m = re.exec(s))) {
    if (inIso(m.index)) continue; // already consumed as an ISO date
    let y = Number(m[3]); if (y < 100) y += 2000;
    const iso = _isoFromYMD(y, Number(m[1]), Number(m[2]));
    if (iso) found.push({ iso, text: m[0] });
  }
  // "Month D, YYYY" / "Month D YYYY".
  const MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
  re = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g;
  while ((m = re.exec(s))) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) continue;
    const iso = _isoFromYMD(Number(m[3]), mo, Number(m[2]));
    if (iso) found.push({ iso, text: m[0] });
  }
  if (!found.length) return null;
  found.sort((a, b) => a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0);
  return found[0];
}

// The leading "Update M/D/YY:" paragraphs carry the freshest facts (quirk 5).
// Returns the text of the update paragraph with the LATEST date (so a later
// extension of the expiration/amount wins over the stale glance value), or ''.
function docLatestUpdateBlock(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim());
  let best = null;
  const isNewUpdate = (l) => /^update\s*[:\-]?\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/i.test(l);
  const isGlanceish = (l) => /offer at a glance/i.test(l) || (l.indexOf(':') > 0 && l.slice(0, l.indexOf(':')).split(/\s+/).length <= 6);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(/^update\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (!m) continue;
    const d = docLatestDate(m[1]);
    if (!d) continue;
    // Gather continuation lines: an "Update …" paragraph can wrap across several
    // physical lines (source HTML line breaks inside the <p> survive flattening),
    // so a later "extended to 8/31/2026" clause may sit on the NEXT line. Absorb
    // following lines until the next Update or a glance row / heading boundary.
    let para = l;
    for (let j = i + 1; j < lines.length && j < i + 5; j++) {
      const nxt = lines[j];
      if (!nxt || isNewUpdate(nxt) || isGlanceish(nxt)) break;
      para += ' ' + nxt;
    }
    if (!best || d.iso > best.iso) best = { iso: d.iso, text: para };
  }
  return best ? best.text : '';
}

// Extract a money amount from a string, honoring quirks 1–3:
//  • points-not-dollars (quirk 1): "50,000 membership rewards"/"points"/"miles"
//    → returns {points:N, snippet} with NO dollar value (caller routes to a note).
//  • range (quirk 2): "$50 – $300" → returns the HIGH end as the amount + a
//    rangeLow so the preview can note the spread.
//  • combined dual-bonus (quirk 3): "$560 total for two accounts" → returns the
//    number + combined:true so the preview flags it.
// Returns null if no numeric found. Never assumes a leading `$` (quirk 8).
// Convert a captured dollar numeric (possibly with a `k`/`K` thousands suffix)
// to a Number: "1.5k"→1500, "2k"→2000, "1.25k"→1250, "25,000"→25000,
// "300"→300. Strips commas. Returns null for non-numeric. Centralizes k-
// shorthand so bonus + fee + funding + spend scans all agree (P2-2).
function docDollarToNumber(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/,/g, '').trim();
  const k = /[kK]$/.test(s);
  if (k) s = s.slice(0, -1);
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return k ? n * 1000 : n;
}

// Convert a (number, unit) day/week pair to a day count: weeks ×7 (P3). Used by
// every window scan that could plausibly be phrased in weeks (posting window,
// hold period, DD/deposit timeframe). Returns null for a non-numeric count.
function docDaysFrom(n, unit) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return /week/i.test(String(unit || '')) ? v * 7 : v;
}

function docParseBonusValue(str) {
  const s = String(str || '');
  // Points / miles / membership rewards — no dollar sign in play.
  const ptsRe = /([\d][\d,]*)\s*(membership\s+rewards|reward\s+points|points|miles|mr\b|thankyou\s+points|ultimate\s+rewards)/i;
  const pm = s.match(ptsRe);
  if (pm && !/\$/.test(s.slice(0, pm.index))) {
    const n = Number(pm[1].replace(/,/g, ''));
    if (Number.isFinite(n)) return { points: n, unit: pm[2].replace(/\s+/g, ' ').trim(), snippet: s };
  }
  // Collect dollar amounts. Accepts an optional `k`/`K` thousands suffix
  // ("$1.5k" → 1500) so a shorthand headline isn't read 1000× too small (P2-2).
  const dollarRe = /\$\s?([\d][\d,]*(?:\.\d+)?[kK]?)/g;
  const nums = [];
  let m;
  while ((m = dollarRe.exec(s))) {
    const n = docDollarToNumber(m[1]);
    if (n != null) nums.push(n);
  }
  if (!nums.length) {
    // No `$` at all — try a bare number only if the context clearly says bonus
    // (avoid grabbing an unrelated integer). This stays conservative.
    // P4: never read a 4-digit YEAR (2020–2035) sitting next to date context as a
    // dollar amount — "[30] Extended until July 7, 2026" was read as $2026.
    const bareRe = /\b([\d][\d,]{2,})\b/g;
    let bm;
    while ((bm = bareRe.exec(s))) {
      const raw = bm[1];
      const n = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(n)) continue;
      // Year-in-date guard: a 2020–2035 integer with no thousands separator that
      // is adjacent to a month name or a numeric date fragment is a date, skip.
      if (n >= 2020 && n <= 2035 && !/,/.test(raw)) {
        const near = s.slice(Math.max(0, bm.index - 20), bm.index + raw.length + 4);
        if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d|\d{1,2}[\/\-]\d{1,2}|\d{1,2}(?:st|nd|rd|th)?,/i.test(near)) continue;
      }
      if (/bonus|receive|earn/i.test(s)) return { value: n, lowConfidence: true, snippet: s };
      break;
    }
    return null;
  }
  const isRange = /[-–—]|\bto\b|\bup to\b/i.test(s) && nums.length >= 2;
  const combined = /\btotal\b|\bcombined\b|\bboth\b|\btwo (accounts|bonuses)\b/i.test(s);
  // P1: a "$A–$B … deposit/balance/DD" range is a DEPOSIT THRESHOLD range, not a
  // bonus range — don't take $B as the bonus ([04] grabbed $20,000 from
  // "$400-$800 for $4,000-$20,000 deposit"; [20] similar). When the string pairs
  // a range with deposit/balance/direct-deposit wording, prefer the SMALLER
  // cluster (the bonus figures) by dropping numbers that read as thresholds.
  if (isRange && /\bdeposit\b|\bbalance\b|\bdirect deposit\b|\bDD\b/i.test(s)) {
    // Heuristic: bonus figures are the ones that appear BEFORE the word
    // "deposit"/"balance"; threshold figures appear after "for/of $…". Split on
    // the first "for"/"of"/"when you deposit" and take the max of the left side.
    const splitM = s.split(/\bfor\b|\bof\b|\bwhen you (?:deposit|have|maintain)\b/i);
    if (splitM.length >= 2) {
      const leftNums = [];
      let lm; const lre = /\$\s?([\d][\d,]*(?:\.\d+)?[kK]?)/g;
      while ((lm = lre.exec(splitM[0]))) { const v = docDollarToNumber(lm[1]); if (v != null) leftNums.push(v); }
      if (leftNums.length) {
        const bhi = Math.max.apply(null, leftNums), blo = Math.min.apply(null, leftNums);
        const o = { value: bhi, snippet: s };
        if (bhi !== blo) o.rangeLow = blo;
        if (combined) o.combined = true;
        return o;
      }
    }
  }
  // P1 (Codex 4a): a REDUCTION phrase names the new value THEN the old one in
  // parentheses — "lowered to $250 (was $350)", "reduced to $200 (previously
  // $500)", "now $250, down from $350", "dropped to $X from $Y". Blindly taking
  // Math.max keeps the SUPERSEDED higher figure. When such a verb governs the
  // amounts, the TARGET (the value right after "to/is now") wins over the max.
  // This is scoped to genuine reduction/replacement verbs so it can't fire on a
  // real range ("$200 to $400", handled as isRange below) — a range has no
  // was/previously/from-old-value marker.
  const increaseGov = /\bincreas\w*|\braised?\b|\bup to\b|\bback (?:up )?(?:to|at)\b|\bhigher\b/i.test(s);
  const reduceGov = !increaseGov && /\blowered\b|\breduced\b|\bdecreased?\b|\bdropped\b|\bcut to\b|\bdown to\b|\bdown from\b|\bnow\b/i.test(s);
  const oldMarker = /\bwas\b|\bpreviously\b|\bformerly\b|\bfrom \$|\bdown from\b|\bhad been\b|\bused to be\b/i.test(s);
  if (reduceGov && oldMarker && nums.length >= 2) {
    // The target is the amount tied to "to/now/is" (the reduction result); the
    // old value is tied to "was/previously/from". Capture the value immediately
    // after a reduction/assignment cue; fall back to the FIRST amount (reduction
    // phrasing states the new value first: "lowered to $250 (was $350)").
    let target = null;
    const cueM = s.match(/(?:lowered to|reduced to|decreased to|dropped to|cut to|down to)\s*\$\s?([\d][\d,]*(?:\.\d+)?[kK]?)/i)
      || s.match(/(?:is )?now(?: at)?\s*\$\s?([\d][\d,]*(?:\.\d+)?[kK]?)/i);
    if (cueM) target = docDollarToNumber(cueM[1]);
    if (target == null) target = nums[0];
    if (target != null) {
      const out = { value: target, snippet: s, superseded: nums.filter(n => n !== target) };
      if (combined) out.combined = true;
      return out;
    }
  }
  const hi = Math.max.apply(null, nums);
  const lo = Math.min.apply(null, nums);
  const out = { value: hi, snippet: s };
  if (isRange && hi !== lo) out.rangeLow = lo;
  if (combined) out.combined = true;
  return out;
}

// Pull the first integer that appears near one of the keyword patterns.
function docIntNear(str, re) {
  const m = String(str || '').match(re);
  if (!m) return null;
  for (let i = 1; i < m.length; i++) { if (m[i] != null && m[i] !== '') { const n = Number(String(m[i]).replace(/,/g, '')); if (Number.isFinite(n)) return n; } }
  return null;
}

// The FIRST dollar amount in a string (or null). Used for fee/ETF values, where
// "$10, waived with $500 in DDs" must read the fee ($10), NOT the max ($500)
// that docParseBonusValue would return. Honors `k`/`K` shorthand ($1.5k→1500).
function docFirstDollar(str) {
  const m = String(str || '').match(/\$\s?([\d][\d,]*(?:\.\d+)?[kK]?)/);
  return m ? docDollarToNumber(m[1]) : null;
}

// ---- P0: card-funding label guard -------------------------------------------
// The "Credit card funding" / "Debit card funding" glance rows describe how you
// may FUND the account with a card (and any cap), NOT the deposit a bonus
// requires. The old funding token-set `['funding']` fuzzy-matched them and their
// "$N" cap became requiredFundingAmount (11 high-confidence mis-claims). A label
// that mentions a credit/debit card (or "card funding") is never a deposit
// requirement — route it to cc_funding_note instead.
function docIsCardFundingLabel(label) {
  return /\b(credit|debit)\s+card\b/i.test(String(label)) || /\bcard\s+funding\b/i.test(String(label));
}

// ---- P2: date-segment the post by "Update M/D/YY" markers --------------------
// DoC updates are prepended deltas. We split the flattened text into date-tagged
// segments: everything from one "Update M/D/YY" marker up to the next marker is
// one segment, tagged with that update's ISO date; all content before the first
// marker (the ORIGINAL body + glance box + fine print) is the undated base
// segment (iso:null). Returned newest-first among dated segments, base last, so a
// scalar-reconciliation pass can let the freshest conflicting value win while a
// fact found ONLY in the base keeps normal confidence.
function docDateSegments(text) {
  const lines = String(text).split(/\r?\n/);
  const markerRe = /^update\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i;
  // The "Offer at a glance" heading is a STRUCTURAL boundary that ends any
  // running "Update M/D/YY" delta: the glance box + all body/fine-print AFTER it
  // is stable base content, never part of an update paragraph. Without this, a
  // dated update at the top of a normalized post would swallow the whole glance
  // box + body into that (often OLD) update's segment — so a stale glance value
  // would be mis-attributed to a dated segment and could wrongly win (or lose) a
  // reconciliation. (Codex 4a P2b.) A NEW "Update" marker after the glance still
  // opens its own dated segment (deltas can be appended anywhere).
  const glanceRe = /offer at a glance/i;
  const segs = [];
  let cur = { iso: null, lines: [] }; // base (pre-first-marker)
  let inBody = false;                 // true once we've crossed the glance heading
  for (const raw of lines) {
    const l = raw.trim();
    const m = l.match(markerRe);
    if (m) {
      if (cur.lines.length) segs.push(cur);
      const d = docLatestDate(m[1]);
      cur = { iso: d ? d.iso : null, lines: [l] };
      inBody = false; // a new delta paragraph begins; it runs until glance/next marker
    } else if (!inBody && glanceRe.test(l)) {
      // Close the current (possibly dated) segment and resume BASE from the
      // glance heading onward — the glance box + body is stable content.
      if (cur.lines.length) segs.push(cur);
      cur = { iso: null, lines: [l] };
      inBody = true;
    } else {
      cur.lines.push(l);
    }
  }
  if (cur.lines.length) segs.push(cur);
  // There can now be MULTIPLE undated (iso:null) segments — a pre-update preamble
  // AND the glance-onward body. Merge them all into a single base segment.
  const baseLines = [];
  for (const s of segs) if (s.iso === null) baseLines.push(...s.lines);
  const base = { iso: null, lines: baseLines };
  const dated = segs.filter(s => s.iso !== null).sort((a, b) => a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0);
  const mk = s => ({ iso: s.iso, text: s.lines.join('\n') });
  return { newestFirst: dated.map(mk), base: mk(base), all: [...dated.map(mk), mk(base)] };
}

// P2 core: reconcile a scalar across date segments. `extract(segText)` returns a
// comparable value (or null) from a segment. If the value appears in ≥2 dated
// segments with CONFLICTING values, the newest dated segment's value wins and the
// result is marked reconciled (caller demotes confidence + notes it). A value
// present only in the base (undated fine print) is returned as-is, un-demoted.
// Returns { value, iso, reconciled, supersededFrom } or null.
function docReconcileScalar(segs, extract) {
  const hits = [];
  for (const seg of segs.newestFirst) { const v = extract(seg.text); if (v != null) hits.push({ iso: seg.iso, value: v }); }
  const baseV = extract(segs.base.text);
  if (!hits.length) return baseV != null ? { value: baseV, iso: null, reconciled: false } : null;
  // Newest dated hit (hits is already newest-first).
  const newest = hits[0];
  const conflicting = hits.slice(1).filter(h => JSON.stringify(h.value) !== JSON.stringify(newest.value))
    .concat(baseV != null && JSON.stringify(baseV) !== JSON.stringify(newest.value) ? [{ iso: null, value: baseV }] : []);
  return { value: newest.value, iso: newest.iso, reconciled: conflicting.length > 0,
           supersededFrom: conflicting.length ? conflicting.map(c => c.value) : null };
}

// ---- P1: tier-ladder scanner ------------------------------------------------
// DoC renders deposit/balance/DD tier ladders as bullet lists (no tables in the
// wild we've seen). Grammar varies widely; we recognize a line as a tier when it
// pairs a BONUS dollar amount with a THRESHOLD (a deposit/balance/DD amount or
// range) via one of several phrasings, then dedupe + sort ascending by threshold.
// Returns an array of {threshold_min, threshold_max, threshold_kind, bonus,
// hold_days, deadline_days, snippet}. Only emits when ≥2 distinct tiers found.
function docScanTiers(text) {
  const s = String(text);
  const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const toNum = (v) => docDollarToNumber(v);
  const cand = [];
  const kindFrom = (ctx) => /direct deposit|combined total of your direct|in dd\b|qualifying direct/i.test(ctx) ? 'dd_total'
    : /balance|average daily|maintain/i.test(ctx) ? 'balance' : 'deposit';
  const D = '\\$\\s?([\\d][\\d,]*(?:\\.\\d+)?[kK]?)';   // a dollar figure
  const RD = '\\s*(?:-|–|—|to)\\s*';                    // range dash/"to" (NOT "and")
  const RANGE = D + RD + D;                             // $lo – $hi
  const THRESH = 'deposit|balance|direct deposit|combined total|new money|maintain';
  for (const line of lines) {
    // Reject narrative lines up front: updates, verdict math, "better link for
    // $X", referral. These carry stray $ pairs that would masquerade as tiers.
    if (/^update\b/i.test(line)) continue;
    if (/better link|similar to|not as good|you.?d (?:only )?earn|refer\b|hat tip|savings bonus|referral/i.test(line)) continue;
    if (!/\$/.test(line)) continue;
    let m, min = null, max = null, bonus = null;

    // Form A (bonus-first, RANGE threshold): "Get $50 bonus with direct deposit
    // of $1,000 – $1,999" / "Earn $300 when the combined total of your direct
    // deposits is between $4,000 and $7,999.99" (note: "between $lo and $hi").
    m = line.match(new RegExp(D + '\\s*(?:bonus|sign[- ]?up bonus|credit)?\\b[^$]*?(?:' + THRESH + ')[^$]*?(?:of|is between|between|is)\\s*' + D + '\\s*(?:' + RD + '|\\s+and\\s+)' + D, 'i'));
    if (m) { bonus = toNum(m[1]); min = toNum(m[2]); max = toNum(m[3]); }
    // Form A2 (bonus-first, SINGLE threshold): "$400 bonus when you deposit
    // $5,000" / "$825 bonus when you deposit $25,000 or more" / "$400 sign up
    // bonus when you ... direct deposit of $500+" / "Earn $600 when ... is $8,000+".
    if (min == null) {
      m = line.match(new RegExp(D + '\\s*(?:bonus|sign[- ]?up bonus|credit)?\\b[^$]*?(?:' + THRESH + ')[^$]*?(?:of|is between|between|is|totaling|:)?\\s*' + D + '(?:\\s*(?:\\+|or more|and (?:over|above|up)))?', 'i'));
      if (m) { bonus = toNum(m[1]); min = toNum(m[2]); }
    }
    // Form A3 (bonus "with"/"for" amount then threshold-noun): "$1,500 with
    // $100,000 deposit" / "$750 with $20,000 deposit" / "$400 with $2,000 deposit".
    if (min == null) {
      m = line.match(new RegExp(D + '\\s*(?:bonus)?\\s*(?:with|for)\\s*' + D + '\\s*(?:' + THRESH + ')', 'i'));
      if (m) { bonus = toNum(m[1]); min = toNum(m[2]); }
    }

    // Form B (RANGE-then-bonus, NO threshold noun required): "$25,000 – $49,999.99
    // and earn $350" / "$5,000-$9,999.99 will earn $150".
    if (min == null) {
      m = line.match(new RegExp('(?:^|[^$\\d])' + RANGE + '[^$]*?(?:earn|get|receive|bonus of|to get|:)\\s*' + D, 'i'));
      if (m) { min = toNum(m[1]); max = toNum(m[2]); bonus = toNum(m[3]); }
    }
    // Form B2 (single open-topped threshold then bonus): "$15,000 and over will
    // earn $250" / "$100,000 or more and earn $1,000" / "over $10,000 will earn $600".
    if (min == null) {
      m = line.match(new RegExp('(?:over\\s*)?' + D + '\\s*(?:or more|and over|and above|\\+|or greater)[^$]*?(?:will\\s+)?(?:earn|get|receive|bonus of|to get)\\s*' + D, 'i'));
      if (m) { min = toNum(m[1]); bonus = toNum(m[2]); }
    }
    // Form B3 (zero floor): "Total average daily balances of $4,999.99 and below
    // will earn $0.00".
    if (min == null && /\$0(?:\.0+)?\b/.test(line) && /below|less than|under/i.test(line)) {
      m = line.match(new RegExp(D + '\\s*(?:or less|and below|and under)', 'i'));
      if (m) { min = 0; max = toNum(m[1]); bonus = 0; }
    }
    // Form C (threshold-first "for [the] $bonus bonus"): "$30,000 minimum balance
    // for $500 bonus" / "$3,000 or more for the $325 bonus" / "$6,000+ for $425
    // bonus" / "Direct deposit $3,000 monthly to get $300".
    if (min == null) {
      m = line.match(new RegExp('(?:direct deposit\\s+)?' + D + '\\s*(?:or more|\\+|minimum balance|minimum|monthly)?[^$]{0,40}?(?:for(?: the)?|to get|to earn)\\s*' + D + '\\s*bonus', 'i'));
      if (m) { min = toNum(m[1]); bonus = toNum(m[2]); }
    }

    if (min == null || bonus == null || !Number.isFinite(min) || !Number.isFinite(bonus)) continue;
    // Sanity: a real tier's bonus is a small fraction of its threshold. Drop a
    // "tier" whose bonus ≥ threshold (a stray $ pair, e.g. "$400 … $1,500 bonus"),
    // except the legitimate zero-floor. Also require threshold ≥ $500 for a
    // deposit/balance kind (bonuses of $50–$500 exist but thresholds under $500
    // are almost always a mis-grab — DD thresholds like $1,000 are fine).
    if (bonus > 0 && min > 0 && bonus >= min) continue;
    // hold_days / deadline_days are part of the documented tier shape but are
    // uniform across tiers on this corpus (stated once for the whole offer, not
    // per-tier), so they're captured at the offer level (daysFundsMustRemain /
    // daysAfterSignupAllowedBeforeDeposit). Emit them as null here so 4b's tier
    // picker can rely on the keys existing rather than probing for them.
    cand.push({ threshold_min: min, threshold_max: (max != null && Number.isFinite(max)) ? max : null,
                threshold_kind: kindFrom(line), bonus, hold_days: null, deadline_days: null, snippet: docSnippet(line) });
  }
  // Dedupe on (min,bonus); keep the first (richest) snippet + any max we found.
  const seen = new Map();
  for (const t of cand) {
    const k = t.threshold_min + '|' + t.bonus;
    if (!seen.has(k)) seen.set(k, t);
    else { const e = seen.get(k); if (e.threshold_max == null && t.threshold_max != null) e.threshold_max = t.threshold_max; }
  }
  let tiers = [...seen.values()];
  // Plausibility: a real bonus is ≥ $25; a deposit/balance tier threshold under
  // $500 is almost always a stray $ pair (a bonus/fee figure mis-read as a
  // threshold). Keep the zero-floor; keep DD thresholds (already ≥ $500).
  tiers = tiers.filter(t => (t.bonus === 0 || t.bonus >= 25) && (t.threshold_min === 0 || t.threshold_min >= 500));
  // Collapse to the MAX bonus per distinct threshold (a ladder normally has one
  // bonus per threshold; when two survive, the promoted/higher one is the live
  // value). Same-threshold different-bonus pairs (rare "Ready vs Elite" style)
  // still leave ≥2 distinct thresholds via other tiers.
  const byMin = new Map();
  for (const t of tiers) {
    const e = byMin.get(t.threshold_min);
    if (!e || t.bonus > e.bonus) byMin.set(t.threshold_min, t);
    else if (e && e.threshold_max == null && t.threshold_max != null) e.threshold_max = t.threshold_max;
  }
  tiers = [...byMin.values()].sort((a, b) => a.threshold_min - b.threshold_min);
  // Monotonic-ladder filter, applied PER KIND: a deposit ladder and a DD ladder
  // are separate dimensions (id 10 has a DD-based «$1,500→$400» tier AND a
  // deposit ladder «$25,000→$350 …»); mixing them breaks monotonicity and drops
  // a real deposit tier. Split by kind, keep the longest monotonic run in each,
  // then merge (deposit/balance first, DD after) and re-sort.
  const longestMono = (arr) => {
    let best = [];
    for (let i = 0; i < arr.length; i++) {
      const run = [arr[i]];
      for (let j = i + 1; j < arr.length; j++) if (arr[j].bonus >= run[run.length - 1].bonus) run.push(arr[j]);
      if (run.length > best.length) best = run;
    }
    return best;
  };
  const depKind = tiers.filter(t => t.threshold_kind !== 'dd_total');
  const ddKind = tiers.filter(t => t.threshold_kind === 'dd_total');
  const depMono = longestMono(depKind);
  const ddMono = longestMono(ddKind);
  // Prefer whichever single-kind ladder is longer as the primary; include the
  // other only if it doesn't shrink the primary. Most posts are one kind.
  let primary = depMono.length >= ddMono.length ? depMono : ddMono;
  const secondary = primary === depMono ? ddMono : depMono;
  tiers = (secondary.length >= 2 && primary.length < 2 ? secondary : primary);
  tiers = tiers.slice().sort((a, b) => a.threshold_min - b.threshold_min);
  return tiers.length >= 2 ? tiers : [];
}

// P3: derive the churn anchor from the eligibility LIMIT language, keyed by
// phrase and ordered most-specific-first (so "received a bonus … for opening"
// resolves to bonus_received, not account_opened). Anchors:
//   bonus_received — "received/been paid a … bonus within …"
//   account_closed — "closed a … account within …" / "previously opened or closed"
//   account_opened — "from the last enrollment date" / "per … opening" (no bonus)
function docChurnAnchor(ctx) {
  const c = String(ctx || '');
  // (1) An EXPLICIT "counted from … {closed|opened|enrollment|bonus}" clause is
  // the definitive anchor and outranks everything (fixture 05: «received a bonus
  // … counted from the date your previous account was closed» → account_closed).
  const from = c.match(/(?:counted from|from the date|measured from|starting (?:from|on))[^.]*?\b(clos\w*|open\w*|enroll\w*|paid|received|disburs\w*)/i);
  if (from) {
    const w = from[1].toLowerCase();
    if (/^clos/.test(w)) return 'account_closed';
    if (/^open|^enroll/.test(w)) return 'account_opened';
    return 'bonus_received';
  }
  // (2) Account-tenure limits → account_closed. DoC "new customer" restrictions
  // are anchored to having HAD the account: "closed a … account within",
  // "open or closed", "existing … account", "owner or signer on … account",
  // "cannot have an existing … account". This must precede the bonus_received
  // check so an "existing account" limit isn't shadowed by a stray "bonus".
  if (/\bclos(?:e|ed|ing)\b[^.]*\baccount\b|\baccount\b[^.]*\bclos(?:e|ed|ing)\b|opened or closed|open or close/i.test(c)) return 'account_closed';
  if (/\bexisting\b[^.]*\baccount\b|owner or signer[^.]*\baccount\b|cannot have (?:an )?existing|were an? (?:owner|customer|member)|current or former|existing (?:customer|member)s?\b[^.]*account/i.test(c)) return 'account_closed';
  // (3) "received/been paid a … bonus within" → bonus_received (Wells Fargo
  // «received a bonus for opening … within the past 12 months» resolves here,
  // beating the positional "opening" token that used to win).
  if (/\b(received|been paid|have (?:had|gotten)|got|earned)\b[^.]*\bbonus\b/i.test(c)) return 'bonus_received';
  // (4) enrollment/opening anchor with no bonus/close signal.
  if (/from the last enrollment date|per\b[^.]*\bopening\b|since (?:you )?opened/i.test(c)) return 'account_opened';
  if (/\bopen(?:ed|ing)?\b/i.test(c) && !/\bbonus\b/i.test(c)) return 'account_opened';
  return 'bonus_received';
}

// ---- Churn-eligibility language scan (design Phase 6 "churn hints") ----------
// Maps phrases like "once every 12 months", "one bonus per household every 2
// years", "not eligible if you received a bonus in the last 24 months" into
// churnable/churn_wait_months/churn_anchor(+confidence) + a verbatim churn_notes.
function docScanChurn(text) {
  const s = String(text || '');
  // Split into sentence-ish windows and score EACH for churn language, then keep
  // the richest hit (one that yields a wait window beats a bare "once per house-
  // hold"). Scanning all candidates — not just the first — means an early stray
  // line (e.g. a quoted phrase) can't shadow the real eligibility sentence.
  // A churn window must carry genuine ELIGIBILITY-LIMIT language, not merely a
  // month count (a "None for 12 months" fee line or a "hold for 90 days" line
  // must NOT be mistaken for a re-run window — that was mis-anchoring the churn
  // scan). Require an eligibility/limit token AND exclude fee/hold sentences.
  const ELIG = /\b(?:eligible|not (?:currently )?eligible|one bonus|1 bonus|only one|per household|per customer|per person|per business|new customers? only|existing|previously|previous|owner or signer|cannot have|received .*bonus|been paid .*bonus|limit(?:ed)? (?:one|to one|of one)?|each \d+\s*(?:months?|years?)|every \d+\s*(?:months?|years?)|within the (?:last|past)\s+\d+\s*(?:months?|years?))\b/i;
  const NOT_CHURN = /monthly fee|maintenance fee|no monthly fee|hold (?:the|your|for)|maintain (?:the|a|your)|deposit(?:ed)? (?:the|your)|termination fee|apy\b/i;
  const windows = s.split(/(?<=[.\n])/).map(w => w.trim())
    .filter(w => w && ELIG.test(w) && !(NOT_CHURN.test(w) && !/eligible|per household|one bonus|existing|previously|owner or signer|cannot have/i.test(w)));
  if (!windows.length) return null;
  const deriveMonths = (phrase) => {
    // Tolerate a spelled-then-parenthesized count ("twelve (12) months") by
    // reading the digits in the parens first, then the usual numeric forms.
    let mm = phrase.match(/\((\d+)\)\s*(month|year)s?/i)
      || phrase.match(/every\s+(\d+)\s*(month|year)s?/i)
      || phrase.match(/(?:last|past|within|in the last|within the last|within the past)\s+(\d+)\s*(month|year)s?/i)
      || phrase.match(/\b(\d+)\s*\)?[\-\s]*(month|year)s?\b/i);
    if (mm) return Number(mm[1]) * (/year/i.test(mm[2]) ? 12 : 1);
    return null;
  };
  // Prefer a window that BOTH restricts eligibility AND yields a wait window;
  // else the first eligibility-restrictive window.
  let phrase = windows.find(w => deriveMonths(w) != null && /eligible|existing|previously|owner or signer|cannot have|per household|one bonus|received .*bonus/i.test(w))
    || windows.find(w => deriveMonths(w) != null) || windows[0];
  const months = deriveMonths(phrase);
  const out = { churn_notes: { value: docSnippet(phrase), confidence: 'medium', snippet: docSnippet(phrase) } };
  if (months != null) {
    out.churnable = { value: true, confidence: 'medium', snippet: docSnippet(phrase) };
    out.churn_wait_months = { value: months, confidence: 'medium', snippet: docSnippet(phrase) };
    // Anchor (P3): the positional /clos|open/ scan mislabeled cases where an
    // "opening" token sat near a "received a bonus" limit (e.g. Wells Fargo
    // «received a bonus for opening … within the past 12 months» → account_opened,
    // want bonus_received). Use KEYED phrase detection on the churn context,
    // ordered by specificity. The qualifier often lands in the next clause, so
    // scan ~160 chars after the phrase start.
    const at = s.indexOf(phrase);
    const ctx = at >= 0 ? s.slice(at, at + phrase.length + 160) : phrase;
    out.churn_anchor = { value: docChurnAnchor(ctx), confidence: 'low', snippet: docSnippet(phrase) };
  } else if (/once|one bonus|1 bonus|per household|per customer|per person|new customers only/i.test(phrase)) {
    // A hard household/lifetime limit with no re-run window: not churnable.
    out.churnable = { value: false, confidence: 'low', snippet: docSnippet(phrase) };
  }
  return out;
}

// MAIN. Deterministic glance parse of a pasted DoC post. Returns
// { fields:{key:{value,confidence,snippet,note?}}, unparsed:[strings] }.
// Wrapped by callers in try/catch, but also internally guarded so a malformed
// paste yields an empty fields object rather than throwing.
function parseDocPost(raw) {
  const fields = {};
  const unparsed = [];
  const norm = docNormalizeInput(raw);
  const text = norm.text || '';
  const rows = docExtractGlanceRows(text);
  const put = (key, value, confidence, snippet, extra) => {
    fields[key] = Object.assign({ value, confidence, snippet: docSnippet(snippet) }, extra || {});
  };

  // If there's essentially nothing to parse, bail early (callers show the
  // "couldn't find a glance list" message on empty fields).
  if (!text.trim()) return { fields, unparsed };

  const updateBlock = docLatestUpdateBlock(text);
  // P2: date-segment the post so scalar reconciliation can let the newest dated
  // "Update M/D/YY" segment win over stale glance-box / older-update values.
  const segs = docDateSegments(text);
  // P1: scan the CURRENT content for a tier ladder up front (used to force the
  // headline bonus to low-confidence + flag `tiered` when ≥2 tiers are found).
  const tiers = docScanTiers(text);
  // "Tiered-ish": even when we can't extract a clean ≥2 ladder, a post is tiered
  // (so the headline is unreliable and must go LOW confidence) when the glance
  // "Maximum bonus amount" is a RANGE ("$300 – $750") or slash pair ("$300/$500"),
  // or the requirements state a deposit RANGE with the bonus varying. This keeps
  // the dangerous glance-headline reads on multi-tier posts from landing HIGH.
  const maxBonusRow = docGlance(rows, [['maximum', 'bonus'], ['bonus', 'amount']]);
  const maxBonusRaw = maxBonusRow ? maxBonusRow.value : '';
  const rangeMaxBonus = /\$\s?[\d,]+\s*(?:[-–—]|\/|to)\s*\$?\s?[\d,]+/.test(maxBonusRaw);
  // Also tiered when the body/updates show a bonus RANGE tied to a deposit RANGE
  // ("$400-$800 for $4,000-$20,000 deposit") or a slash-bonus pair in an update
  // ("Bonus increased to $300/$500"), or multiple distinct "$N bonus" figures on
  // separate lines (a per-tier ladder we couldn't fully parse).
  const bonusForDepRange = /\$\s?[\d,]+\s*[-–—]\s*\$?\s?[\d,]+\s+for\s+\$\s?[\d,]+\s*[-–—]\s*\$?\s?[\d,]+/i.test(text);
  const slashBonusUpdate = segs.newestFirst.some(s => /(?:bonus|increased to|now)\b[^.\n]*\$\s?[\d,]+\s*\/\s*\$?\s?[\d,]+/i.test(s.text));
  const distinctBonusLines = (function () {
    const set = new Set();
    for (const l of text.split(/\r?\n/)) { const mm = l.match(/\$\s?([\d,]{2,})\s+bonus\b/i); if (mm) { const n = docDollarToNumber(mm[1]); if (n != null && n >= 100) set.add(n); } }
    return set.size >= 2;
  })();
  const tieredFlag = tiers.length >= 2 || rangeMaxBonus || bonusForDepRange || slashBonusUpdate || distinctBonusLines;

  // ---- Bank / offer name -----------------------------------------------------
  // Prefer an explicit glance row; else a heading-ish line "<Bank> $X…".
  const bankRow = docGlance(rows, [['bank'], ['institution']]);
  if (bankRow) put('bankName', bankRow.value.replace(/\s+(review|bonus)$/i, '').trim(), 'high', bankRow.raw);
  // Title heuristic. Real pastes can carry breadcrumb/nav junk before the title,
  // so don't blindly take line 1: prefer the line right before "Offer at a
  // glance"; else the FIRST line that actually looks like a bonus title (has a
  // "$N" or "N points/miles" token). Falls back to line 1 only if neither hits.
  const allLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const glanceIdx = allLines.findIndex(l => /offer at a glance/i.test(l));
  // A title is a HEADING with a bonus figure — not an "Update M/D/YY:" recency
  // paragraph and not a "Label: value" glance row (both can carry a $ figure).
  const looksTitle = (l) => /(\$[\d,]+|\d[\d,]*\s*(?:points|miles|membership rewards))/i.test(l)
    && /bonus|checking|savings|account|card|review|points|miles/i.test(l)
    && !/^update\s*[:\-]?\s*\d{1,2}[\/\-]\d{1,2}/i.test(l)
    && !(l.indexOf(':') > 0 && l.slice(0, l.indexOf(':')).split(/\s+/).length <= 6);
  let firstLine = '';
  if (glanceIdx > 0) { for (let k = glanceIdx - 1; k >= 0; k--) { if (looksTitle(allLines[k])) { firstLine = allLines[k]; break; } } }
  if (!firstLine) firstLine = allLines.find(looksTitle) || allLines[0] || '';
  if (!fields.bankName && firstLine) {
    const bm = firstLine.match(/^(.+?)\s+(?:\$|\d).*?(?:bonus|checking|savings|account|review)/i);
    if (bm && bm[1].split(/\s+/).length <= 6) put('bankName', bm[1].trim(), 'medium', firstLine);
  }
  if (firstLine) {
    // Offer name = the descriptive tail of the title (e.g. "Premier Checking").
    const om = firstLine.match(/(?:\$[\d,]+|\d[\d,]*\s*(?:points|miles|membership rewards))\s+(.+?)(?:\s+bonus)?$/i);
    if (om && om[1]) {
      // Item 5b: never embed a trailing bonus amount in the proposed offer name
      // — strip a trailing "$N", "$X-$Y" range, or "up to $N" tail so future
      // imports don't carry the amount into offerName (it's captured as the
      // bonus separately). The DISPLAY side (displayOfferName) also guards, but
      // fixing it at import keeps stored data clean going forward.
      const name = om[1]
        .replace(/\bbonus\b/i, '')
        .replace(/\s*[-–—]?\s*(?:up to\s+)?\$[\d,]+(?:\.\d+)?(?:\s*[-–—]\s*\$?[\d,]+(?:\.\d+)?)?$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (name && name.split(/\s+/).length <= 6) put('offerName', name, 'medium', firstLine);
    }
  }

  // ---- Bonus amount (quirks 1–3) + recency reconciliation (quirk 5) ----------
  const bonusRow = docGlance(rows, [['maximum', 'bonus'], ['bonus', 'amount'], ['bonus']]);
  let bonusSnippetSrc = bonusRow ? bonusRow.raw : '';
  let bonusVal = bonusRow ? docParseBonusValue(bonusRow.value) : null;
  let bonusReconciled = false;
  // Recency: if a later Update paragraph names a different amount, prefer it.
  if (updateBlock && /\$|\bbonus\b/i.test(updateBlock)) {
    const upd = docParseBonusValue(updateBlock);
    if (upd && upd.value != null && (!bonusVal || bonusVal.value == null || upd.value !== bonusVal.value)) {
      bonusVal = upd; bonusSnippetSrc = updateBlock; bonusReconciled = true;
    }
  }
  // P2 delta reconcile: if a dated "Update" segment restates the bonus (even to a
  // LOWER figure, e.g. [14] box $300 → update $250), the newest dated segment
  // wins over the glance box. The extractor takes the MAX bonus figure named on a
  // bonus-bearing update line (so "$300/$500" → 500, "increased to $1,200" → 1200,
  // "$1,500 offer still active" → 1500), rejecting figures glued to a deposit
  // threshold ("$2,000 deposit").
  {
    const rec = docReconcileScalar(segs, (segText) => {
      const nums = [];
      // Look at each clause that MENTIONS a bonus/amount verb, collect its $-figs
      // that aren't threshold figures. A `$A–$B` range in an update is almost
      // always a deposit-tier or affiliate spread, not a single headline bonus —
      // skip the whole range (leave those to the tier scanner / stay low-conf).
      const clauses = segText.split(/(?<=[.\n;])/);
      const cap = 3000;
      const acceptable = (n) => n != null && n >= 25 && (n <= cap || (bonusVal && bonusVal.value != null && n <= bonusVal.value));
      for (const cl of clauses) {
        if (!/\bbonus\b|\bnow\b|\boffer\b|increased to|up to|\bget\b|\bearn\b/i.test(cl)) continue;
        // Codex 4a P1: a REDUCTION clause ("Maximum bonus is now $250 (previously
        // $300)", "lowered to $200 (was $500)") names the NEW value then the OLD
        // one — taking Math.max keeps the superseded figure. When a reduction verb
        // + an old-value marker (was/previously/from $Y) govern the clause, push
        // ONLY the target (the amount tied to now/to), never the parenthetical old
        // value. Scoped to reduction phrasing so it can't fire on a genuine range.
        // A genuine DECREASE verb only — NOT an increase ("increased to $300/$500
        // from $250/$350" [23] is an increase to a RANGE; its answer is the high
        // end, handled by the normal scan). Exclude when increase wording is
        // present so the reduction shortcut can't hijack an increase clause.
        const clIncrease = /\bincreas\w*|\braised?\b|\bup to\b|\bback (?:up )?(?:to|at)\b|\ball[- ]time high\b|\bhigher\b/i.test(cl);
        const clReduce = !clIncrease && /\blowered\b|\breduced\b|\bdecreased?\b|\bdropped\b|\bcut to\b|\bdown to\b|\bdown from\b|\bnow\b/i.test(cl);
        const clOld = /\bwas\b|\bpreviously\b|\bformerly\b|\bfrom \$|\bdown from\b|\bhad been\b/i.test(cl);
        if (clReduce && clOld) {
          const cueM = cl.match(/(?:lowered to|reduced to|decreased to|dropped to|cut to|down to)\s*\$\s?([\d][\d,]*(?:\.\d+)?[kK]?)/i)
            || cl.match(/(?:is )?now(?: at)?\s*\$\s?([\d][\d,]*(?:\.\d+)?[kK]?)/i);
          const tgt = cueM ? docDollarToNumber(cueM[1]) : null;
          if (tgt != null && acceptable(tgt)) { nums.push(tgt); continue; }
        }
        // Mask out `$A(-–—/)$B` ranges so their endpoints aren't read as a bonus.
        const masked = cl.replace(/\$\s?[\d][\d,]*(?:\.\d+)?[kK]?\s*(?:[-–—\/]|to)\s*\$?\s?[\d][\d,]*(?:\.\d+)?[kK]?/g, ' ');
        let dm; const dre = /\$\s?([\d][\d,]*(?:\.\d+)?[kK]?)/g;
        while ((dm = dre.exec(masked))) {
          const around = masked.slice(Math.max(0, dm.index - 6), dm.index + dm[0].length + 24);
          if (/\b(deposit|balance|in new money|minimum|for\s+\$)\b/i.test(around)) continue; // a threshold, skip
          const n = docDollarToNumber(dm[1]);
          // Reject an implausibly large "bonus" (a threshold leaked in): cap at
          // $3,000 unless the glance headline itself is that big (real high tier).
          if (acceptable(n)) nums.push(n);
        }
      }
      return nums.length ? Math.max.apply(null, nums) : null;
    });
    if (rec && rec.iso && rec.reconciled && rec.value != null && (!bonusVal || rec.value !== bonusVal.value)) {
      const found = (segs.newestFirst.find(s => s.iso === rec.iso) || {}).text || '';
      bonusVal = { value: rec.value, snippet: found }; bonusSnippetSrc = found; bonusReconciled = true;
    }
  }
  if (bonusVal) {
    if (bonusVal.points != null) {
      // Quirk 1: points, not dollars — route to a note, no $ value.
      put('bonusPointsNote', `${bonusVal.points.toLocaleString()} ${bonusVal.unit}`, 'medium', bonusVal.snippet || bonusSnippetSrc);
    } else if (bonusVal.value != null) {
      const extra = {};
      if (bonusVal.rangeLow != null) extra.note = `Range $${bonusVal.rangeLow.toLocaleString()}–$${bonusVal.value.toLocaleString()} — using the high end`;
      if (bonusVal.combined) extra.note = 'Combined total for two accounts — verify the split';
      // P1: on a tiered post the glance headline is unreliable (it may be a stale
      // or single-tier figure). Force confidence to low (→ default-unchecked
      // downstream) and flag `tiered` so the preview can offer a tier picker (4b).
      let conf = bonusVal.lowConfidence ? 'low' : (bonusVal.rangeLow != null || bonusVal.combined ? 'medium' : 'high');
      if (tieredFlag) { conf = 'low'; extra.note_tiered = true; extra.note = `Tiered offer — ${tiers.length} tiers detected; headline may be a single tier. Pick a tier.`; }
      put('signupBonusAmount', bonusVal.value, conf, bonusVal.snippet || bonusSnippetSrc, extra);
    }
  }

  // ---- Expiration (quirks 4,5,7) + P2 delta reconciliation ------------------
  const expRow = docGlance(rows, [['expiration'], ['expires'], ['expiration', 'date'], ['deadline']]);
  const glanceExp = expRow ? docLatestDate(expRow.value) : null;
  let expDate = glanceExp;
  let expSnippet = expRow ? expRow.raw : '';
  let expReconciled = false;
  // P2: an "Extended (to|through|until) DATE" / "expires DATE" phrase in a DATED
  // update segment supersedes the glance box even when the glance date is LATER
  // in raw value (a stale box can carry a future-looking struck history). Walk
  // segments newest-first; the freshest segment that restates expiration wins.
  const EXT = /\b(?:extended?|expir\w*|ends?|deadline|valid (?:through|until)|good (?:through|until)|back)\b[^.\n]*?((?:[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})|(?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}))/i;
  let extHit = null;
  for (const seg of segs.newestFirst) {
    const m = seg.text.match(EXT);
    if (m) { const d = docLatestDate(m[1]); if (d) { extHit = { iso: d.iso, text: m[0], isoSeg: seg.iso }; break; } }
  }
  // DoC convention: a standalone lead line "Extended through DATE" often sits
  // ABOVE the first "Update M/D/YY" marker (base segment) and is the freshest
  // status ([16] «Extended through 2026-09-30»). Consider a base-segment EXT
  // phrase and prefer whichever (dated-update EXT vs base EXT) is the later date.
  const baseM = segs.base.text.match(EXT);
  const baseExt = baseM ? (function(){ const d = docLatestDate(baseM[1]); return d ? { iso: d.iso, text: baseM[0] } : null; })() : null;
  if (baseExt && (!extHit || baseExt.iso > extHit.iso)) extHit = baseExt;
  if (extHit) {
    // The stated extension is authoritative over the glance box.
    if (!glanceExp || extHit.iso !== glanceExp.iso) { expDate = { iso: extHit.iso }; expSnippet = extHit.text; expReconciled = !!glanceExp; }
    else { expDate = glanceExp; }
  } else if (updateBlock && /(expir|extend|end|deadline|through|until)/i.test(updateBlock)) {
    // Legacy path: latest Update paragraph date (kept for posts without an
    // explicit "extended" verb but a dated deadline restatement).
    const ud = docLatestDate(updateBlock);
    if (ud && (!expDate || ud.iso > expDate.iso)) { expDate = ud; expSnippet = updateBlock; expReconciled = !!glanceExp; }
  }
  if (expDate) {
    put('offerExpirationDate', expDate.iso, expReconciled ? 'medium' : 'high', expSnippet,
      expReconciled ? { note: 'Reconciled from a later "Update" — supersedes the glance date', superseded: glanceExp ? glanceExp.iso : undefined } : null);
  }

  // ---- Direct deposit required ----------------------------------------------
  const ddRow = docGlance(rows, [['direct', 'deposit', 'required'], ['direct', 'deposit', 'needed'], ['direct', 'deposit']]);
  if (ddRow) {
    const v = ddRow.value.toLowerCase();
    // Negation is evaluated FIRST and takes precedence (Codex 4a P2a): a
    // "required"/"needed" token INSIDE a negating phrase ("not required", "none
    // required", "no ... required") must not be read as affirmative. The affirm
    // test therefore excludes a "required"/"needed" that is preceded by
    // not/no/none/n't. P4 still holds: a benign "no minimum" / "no minimum
    // mentioned" qualifier does NOT negate (the "no" there isn't a real
    // not-required — «Yes, no minimum mentioned» stays true).
    const negate = /\bnot\s+required\b|\bnot\s+needed\b|\bno\s+direct deposit\b|\bnone\s+required\b|\bnone\b|^\s*no\b/.test(v)
      || (/\bno\b(?!\s+(?:minimum|min)\b)/.test(v) && !/\byes\b/.test(v));
    // Affirmative only when a genuine yes/required/needed appears that is NOT the
    // token inside a negation ("not/no/none/n't … required").
    const affirm = /\byes\b/.test(v)
      || (/\b(required|needed)\b/.test(v) && !/\b(not|no|none|n't|without|isn't|aren't)\b[^.]*\b(required|needed)\b/.test(v));
    // A "Yes" always wins over an incidental negation qualifier; otherwise a
    // negation wins over a (non-existent) affirmative; else default per affirm.
    const required = /\byes\b/.test(v) ? true : (negate ? false : (affirm ? true : false));
    put('ddRequired', required, 'high', ddRow.raw);
    // DD amount / count / timeframe often live in the same value or nearby body.
    const amt = docParseBonusValue(ddRow.value);
    if (required && amt && amt.value != null) put('ddAmount', amt.value, 'medium', ddRow.raw);
    const cnt = docIntNear(ddRow.value, /(\d+)\s*(?:direct deposits|dds|qualifying)/i);
    if (required && cnt != null) put('ddCount', cnt, 'medium', ddRow.raw);
    // A "for/within N days" window inside the DD row IS the DD-completion window
    // ([09] «…totaling $500 or more for 60 days»). Surface it directly.
    if (required && !fields.daysAfterSignupAllowedBeforeDeposit) {
      const dw = ddRow.value.match(/(?:for|within)\s+(\d+)\s+(days?|weeks?)/i);
      if (dw) { const d = docDaysFrom(dw[1], dw[2]); if (d != null) put('daysAfterSignupAllowedBeforeDeposit', d, 'medium', ddRow.raw); }
    }
  }
  // Body scan for DD count / window when not in the glance row. For a DD offer
  // the "within X days" window IS the deposit-completion window the form stores
  // in daysAfterSignupAllowedBeforeDeposit (that field is labeled "Complete DDs
  // within X days" for DD offers), so surface it under that key directly.
  // NOTE: every body-scan below BOUNDS its `[^.\n]` gaps ({0,160}) so a giant
  // unterminated line can't trigger quadratic backtracking (P2-1). 160 chars is
  // comfortably longer than any real glance-row / sentence clause.
  if (fields.ddRequired && fields.ddRequired.value) {
    if (!fields.ddCount) {
      const cm2 = text.match(/([^.\n]{0,160}?\b(\d+)\s+(?:qualifying\s+)?(?:direct deposits?|dds)\b[^.\n]{0,160})/i);
      if (cm2) put('ddCount', Number(cm2[2]), 'medium', cm2[1]);
    }
    const wm = text.match(/([^.\n]{0,160}\bdirect deposit\b[^.\n]{0,160}?\bwithin\s+(\d+)\s+(days?|weeks?)\b[^.\n]{0,160}|[^.\n]{0,160}\bwithin\s+(\d+)\s+(days?|weeks?)\b[^.\n]{0,160}\bdirect deposit\b[^.\n]{0,160})/i);
    if (wm) {
      const wnum = wm[2] || wm[4], wunit = wm[3] || wm[5];
      const d = docDaysFrom(wnum, wunit);
      if (d != null) put('daysAfterSignupAllowedBeforeDeposit', d, 'medium', wm[1] || wm[0]);
    }
  }

  // ---- Funding amount + window / hold ---------------------------------------
  // P0: the "Credit card funding" / "Debit card funding" glance rows are NOT a
  // deposit requirement — route them to a note and NEVER to requiredFundingAmount.
  // The bare ['funding'] token-set now requires a deposit/minimum/opening
  // companion token so it can't match a card-funding label; a dedicated
  // card-funding lookup captures the cap/allowed note instead.
  const cardFundRow = (function () {
    for (const row of rows) { if (docIsCardFundingLabel(row.label)) return row; }
    return null;
  })();
  if (cardFundRow) {
    const cap = docFirstDollar(cardFundRow.value);
    const allowed = !/\bnone\b|\bnot?\b|\bcannot\b|\bno\b/i.test(cardFundRow.value.split(/[,.;]/)[0]) || cap != null;
    const noteVal = cap != null
      ? `Card funding ${allowed ? 'allowed' : 'noted'} up to $${cap.toLocaleString()}`
      : (/(none|not|cannot|no\b)/i.test(cardFundRow.value) ? 'No credit-card funding' : cardFundRow.value.trim());
    put('cc_funding_note', noteVal, 'medium', cardFundRow.raw, { cc_cap: cap != null ? cap : undefined });
  }
  // Real deposit-requirement glance row (guarded against card labels).
  const fundRow = (function () {
    const r = docGlance(rows, [['minimum', 'deposit'], ['deposit', 'requirement'], ['opening', 'deposit'], ['minimum', 'opening'], ['funding', 'deposit'], ['minimum', 'funding']]);
    if (r && !docIsCardFundingLabel(r.label)) return r;
    // Allow a lone "Funding" / "Funding amount" row ONLY if not a card label.
    for (const row of rows) {
      if (docIsCardFundingLabel(row.label)) continue;
      if (/^funding( amount)?$/i.test(row.label.trim())) return row;
    }
    return null;
  })();
  if (fundRow) {
    const fv = docParseBonusValue(fundRow.value);
    if (fv && fv.value != null) put('requiredFundingAmount', fv.value, 'high', fundRow.raw);
  }
  // P1/P5: no glance funding row on this corpus's tiered/prose posts — derive the
  // funding requirement from the LOWEST detected tier threshold (what you must
  // fund to earn anything), else a prose "deposit $X (within N days)" statement.
  if (!fields.requiredFundingAmount) {
    if (tiers.length >= 2) {
      // Only a DEPOSIT/BALANCE ladder implies a funding lump (what you must fund
      // to earn the lowest tier). A pure DD-total ladder is not a funding lump —
      // gold treats those as unscorable, and so should the parser.
      const depTiers = tiers.filter(t => t.threshold_min > 0 && (t.threshold_kind === 'deposit' || t.threshold_kind === 'balance'));
      const lowest = depTiers.sort((a, b) => a.threshold_min - b.threshold_min)[0];
      if (lowest) put('requiredFundingAmount', lowest.threshold_min, 'medium', lowest.snippet, { note_tiered: true });
    }
    if (!fields.requiredFundingAmount) {
      // "deposit (a total of) $X (in new money) within N days" / "make $X in
      // total deposits" — a body/fine-print funding statement (P5). Bounded gaps.
      const depM = text.match(/(deposit(?:\s+(?:a total of|at least))?\s+\$\s?([\d][\d,]*(?:\.\d+)?[kK]?)[^.\n]{0,80}?(?:in new money|in total deposits|within|to (?:open|your|the)|or more)?|make(?:\s+at least)?\s+\$\s?([\d][\d,]*(?:\.\d+)?[kK]?)[^.\n]{0,40}?(?:in )?total deposits?)/i);
      if (depM) {
        const dv = docDollarToNumber(depM[2] || depM[3]);
        if (dv != null && dv >= 100) put('requiredFundingAmount', dv, 'medium', depM[1] || depM[0]);
      }
    }
  }
  // Hold period + ANCHOR. This is clawback-territory (R70): the hold is the day
  // the bank counts to, and the ANCHOR (account opening vs funded date) decides
  // when the clock starts. Getting the anchor wrong UNDER-holds and can forfeit
  // the bonus, so both are extracted together.
  //
  // (a) A "day-number span" — «days 31 through day 90», «from day 31 to 90»,
  //     «between day 31 and 90». The "day N" numbering is counted from ACCOUNT
  //     OPENING (the enrollment clock), so the funds must remain through day Y
  //     (the END of the span) measured from opening: daysFundsMustRemain = Y and
  //     lockStartsFrom = 'open date'. (The OLD code wrote M−N+1 = 60 with the
  //     default FUNDED anchor — a 30-day under-hold if you fund early; corpus
  //     gold labels this hold as 90/opening, so this also fixes [01][04][18].)
  //     The interposed "day" before Y was the exact miss on the owner's BofA
  //     import — `(?:day\s+)?` now tolerates it. The START day X is NOT wired to
  //     the deposit window here: the explicit "within N days" clause (parsed just
  //     below) stays authoritative and X can conflict with it.
  const spanM = text.match(/\bdays?\s+(\d{1,3})\s*(?:-|–|—|to|through|thru)\s*(?:day\s+)?(\d{1,3})\b/i)
    || text.match(/\bfrom\s+day\s+(\d{1,3})\s+(?:to|through|thru)\s+(?:day\s+)?(\d{1,3})\b/i)
    || text.match(/\bbetween\s+days?\s+(\d{1,3})\s+and\s+(?:day\s+)?(\d{1,3})\b/i);
  if (spanM) {
    const a = Number(spanM[1]), b = Number(spanM[2]);
    // b>a (a real forward span) and a plausible through-day (≥20, ≤366) so a
    // stray "day 1 and day 2"-style phrase can't masquerade as a hold.
    if (Number.isFinite(a) && Number.isFinite(b) && b > a && b >= 20 && b <= 366) {
      put('daysFundsMustRemain', b, 'high', spanM[0]);          // THROUGH day Y
      // ANCHOR confidence (P3-3). A bare "days 31 through day 90" doesn't STATE
      // its anchor — the day-number convention implies opening, but asserting
      // open-date at HIGH on a bare span is clawback-adjacent if wrong. Only an
      // explicit opening cue in the SAME sentence earns the HIGH open-date
      // anchor; a bare span emits it LOW (default-UNCHECKED in the preview) so
      // the user decides. (A bare span left at the form's FUNDED default is SAFE:
      // funded+Y ≥ opening+Y, i.e. it over-holds, never under-holds — the
      // dangerous direction is the OLD 60/funded under-hold, already fixed by
      // count=Y above.)
      const si = spanM.index || 0;
      const sentStart = Math.max(text.lastIndexOf('.', si), text.lastIndexOf('\n', si)) + 1;
      let sentEnd = si + spanM[0].length;
      const pe = text.indexOf('.', sentEnd), ne = text.indexOf('\n', sentEnd);
      sentEnd = Math.min(pe < 0 ? text.length : pe, ne < 0 ? text.length : ne);
      const sentence = text.slice(sentStart, sentEnd);
      const openingCtx = /account opening|\bof opening\b|\bafter opening\b|\bfrom opening\b|opening date|from account open/i.test(sentence);
      put('lockStartsFrom', 'open date', openingCtx ? 'high' : 'low', spanM[0]);
    }
  }
  if (!fields.daysFundsMustRemain) {
    // (b) A DURATION phrase — «maintain the balance for 60 days», «keep funds for
    //     90 days» — is measured from FUNDING (the money movement), so
    //     daysFundsMustRemain = N and the anchor stays the default 'funded date'
    //     (no lockStartsFrom emitted → the form's default funded radio holds).
    const holdM = text.match(/([^.\n]{0,160}\b(?:keep|maintain|hold|remain|leave)\b[^.\n]{0,120}?(?:for\s+)(?:at least\s+)?(\d+)\s+(days?|weeks?)[^.\n]{0,120})/i);
    if (holdM) { const d = docDaysFrom(holdM[2], holdM[3]); if (d != null) put('daysFundsMustRemain', d, 'medium', holdM[1]); }
  }
  if (!fields.daysAfterSignupAllowedBeforeDeposit) {
    // Scan every "within N days" clause; pick the qualifying deposit/enrollment
    // window and SKIP a "to prevent/avoid closure" clause ([02] «$25 within 60
    // days … to prevent closure» is NOT the qualifying window — the real window
    // is «enroll … within 90 days»). Prefer a clause tied to deposit/enroll/
    // direct-deposit/qualifying over one tied to closure.
    let best = null;
    const clauseRe = /([^.\n]{0,120}?\bwithin\s+(\d+)\s+(days?|weeks?)\b[^.\n]{0,120})/gi;
    let cm;
    while ((cm = clauseRe.exec(text))) {
      const clause = cm[1];
      if (/prevent (?:the )?closure|avoid (?:the )?closure|to prevent closure|from closing/i.test(clause)) continue;
      // The deposit/DD window is the target. A "qualifying transactions within N
      // days" clause is a DIFFERENT obligation ([25]) — skip it here (it feeds
      // debitWithinDays elsewhere). Rank: an explicit deposit/DD clause first,
      // then an enroll/fund clause.
      if (/qualifying transactions?|debit (?:card )?purchase/i.test(clause) && !/deposit|direct deposit/i.test(clause)) continue;
      if (!/deposit|funding|enroll|fund /i.test(clause)) continue;
      const d = docDaysFrom(cm[2], cm[3]);
      if (d == null) continue;
      const score = /\bdeposit\b|direct deposit/i.test(clause) ? 3 : /enroll/i.test(clause) ? 2 : 1;
      if (!best || score > best.score) best = { d, clause, score };
    }
    // "deposit … by day N" (a deadline-day form, [30]) when no "within N days"
    // deposit clause was found.
    if (!best) {
      const byDay = text.match(/(deposit[^.\n]{0,80}?by day\s+(\d+))/i);
      if (byDay) { const d = Number(byDay[2]); if (Number.isFinite(d)) best = { d, clause: byDay[1] }; }
    }
    if (best) put('daysAfterSignupAllowedBeforeDeposit', best.d, 'medium', best.clause);
  }

  // ---- Debit transactions ----------------------------------------------------
  // Only a DEBIT/PURCHASE noun ("5 qualifying debit card purchases", "5 debit
  // transactions", "5 debit card transactions") is a debitCount. A bare "N
  // (qualifying) transactions" with no debit/purchase context is a generic
  // transaction requirement → transactionsCount (handled below), NOT debitCount
  // ([03][25][26] «6 qualifying transactions» were mis-routed to debitCount).
  // The COUNT is a small integer NOT preceded by "$" (so a "$500 … purchases"
  // dollar figure isn't read as a count — the lookbehind on the captured number
  // does this), immediately tied to a debit/purchase noun.
  const debitM = text.match(/([^.\n]{0,160}?(?<![$\d])\b(\d{1,2})\s+(?:\w+\s+){0,3}?(?:debit(?:\s+card)?(?:\s+(?:purchases?|transactions?))?|purchases?)\b[^.\n]{0,160})/i);
  if (debitM && /\bdebit|purchase/i.test(debitM[1])) {
    put('debitCount', Number(debitM[2]), 'medium', debitM[1]);
    const dw = debitM[1].match(/within\s+(\d+)\s+days/i);
    if (dw) put('debitWithinDays', Number(dw[1]), 'medium', debitM[1]);
  }

  // ---- Spend / transactions (no legacy field → become user requirement rows) -
  // Spend: "spend $2,000 in the first 3 months". Emit the amount only; the row
  // type (spend) has no legacy equivalent so DocImport routes it to #f-user-reqs.
  const spendM = text.match(/([^.\n]{0,160}\bspend(?:ing)?\b[^.\n]{0,160}?\$\s?([\d][\d,]*(?:\.\d+)?[kK]?)[^.\n]{0,160})/i);
  if (spendM) { const sv = docDollarToNumber(spendM[2]); if (sv != null) put('spendAmount', sv, 'medium', spendM[1]); }
  // Transactions / trades that are NOT debit-card purchases (e.g. "3 qualifying
  // trades", "5 transactions"). Guard on the NOUN PHRASE around the count (not
  // the whole line — a later "debit card" mention elsewhere in the sentence must
  // not veto a genuine "3 trades"). Skip if the count already read as debit.
  // Prefer a "N qualifying transactions/trades" (the usual requirement phrasing,
  // [25] «5 or more qualifying transactions» over a stray «10 transactions»);
  // else the first bare "N transactions/trades". Count must be a plausible txn
  // count (< 100 — a bigger number is a $ figure or a day count, not a count).
  const txM = text.match(/\b(\d+)\s+(?:or more\s+)?(qualifying\s+(?:trades?|transactions?))\b/i)
    || text.match(/\b(\d+)\s+(?:or more\s+)?((?:trades?|transactions?))\b/i);
  if (txM && !/debit|purchase/i.test(txM[2])) {
    const n = Number(txM[1]);
    if (n < 100 && (!fields.debitCount || fields.debitCount.value !== n)) {
      // Snippet: the sentence the count sits in.
      const sent = (text.split(/(?<=[.\n])/).find(w => w.indexOf(txM[0]) !== -1) || txM[0]).trim();
      put('transactionsCount', n, 'medium', sent);
    }
  }

  // ---- Monthly fee + waiver --------------------------------------------------
  const feeRow = docGlance(rows, [['monthly', 'fee'], ['monthly', 'fees'], ['maintenance', 'fee']]);
  if (feeRow) {
    const v = feeRow.value.toLowerCase();
    // A CONDITIONAL/INTRO "None" ("None for 12 months", "None with paperless
    // statements") or a RANGE ("$0-$15") means the standing fee is not flatly $0
    // — it depends on tier/behavior. Emit the read but at MEDIUM (or LOW on a
    // tiered post), so it defaults unchecked rather than asserting a wrong $0
    // (baseline TIER-BLIND: [01][03][05][23] read 0, gold 16/30/5/15).
    const conditionalNone = /(none|no|\$0|free)\b/.test(v) && /\b(for|with|first|when|if|after|unless)\b/.test(v);
    const rangeFee = /\$\s?[\d,]+\s*[-–—]\s*\$?\s?[\d,]+/.test(v);
    if (/\bnone\b|\bno\b|\$0\b|waived|free/.test(v) && !/\$[1-9]/.test(v)) {
      const c = (conditionalNone || tieredFlag) ? (tieredFlag ? 'low' : 'medium') : 'high';
      put('monthly_fee', 0, c, feeRow.raw, (conditionalNone || tieredFlag) ? { note: 'Fee is conditional/tiered — verify the standing monthly fee' } : null);
    } else if (rangeFee) {
      // "$0-$15" — the fee varies by tier; take the HIGH end but low/medium conf.
      const nums = []; let rm; const rre = /\$\s?([\d][\d,]*(?:\.\d+)?)/g;
      while ((rm = rre.exec(feeRow.value))) { const n = docDollarToNumber(rm[1]); if (n != null) nums.push(n); }
      const hi = nums.length ? Math.max.apply(null, nums) : docFirstDollar(feeRow.value);
      if (hi != null) put('monthly_fee', hi, tieredFlag ? 'low' : 'medium', feeRow.raw, { note: 'Fee is a range across tiers — using the high end' });
    } else {
      // The FIRST dollar amount is the fee ("$10, waived with $500 in DDs" → 10),
      // not the max — docParseBonusValue would wrongly grab the waiver figure.
      const fee = docFirstDollar(feeRow.value);
      if (fee != null) put('monthly_fee', fee, tieredFlag ? 'medium' : 'high', feeRow.raw);
    }
    // Waiver condition, if the value spells one out.
    const wv = feeRow.value.match(/waiv\w*\s+(?:with|if|by|for)\s+([^.;]+)/i) || feeRow.value.match(/(?:with|if)\s+([^.;]*direct deposit[^.;]*)/i);
    if (wv) put('fee_waiver_condition', wv[1].trim(), 'medium', feeRow.raw);
  }
  // Body waiver scan when the fee row didn't carry one. Bounded gaps (P2-1).
  if (!fields.fee_waiver_condition) {
    const wvb = text.match(/([^.\n]{0,160}\bfee\b[^.\n]{0,160}\bwaiv\w*[^.\n]{0,160})/i);
    if (wvb) {
      const cond = wvb[1].match(/waiv\w*\s+(?:with|if|by|for|when)\s+([^.;\n]+)/i);
      if (cond) {
        let value = cond[1].trim();
        // COLON + BULLETS (R70): the clause ends at a colon and the real terms
        // live in a following bullet list ("… otherwise you must:" + <ul>). Use
        // the fuller lead-in (wvb[1], which reads "Fee is waived for … you must:")
        // and append the dropped bullets so the condition isn't silently halved.
        if (/:\s*$/.test(value)) {
          const bullets = docBulletsAfterClause(text, wvb.index + wvb[1].length);
          if (bullets) value = wvb[1].replace(/\s*:\s*$/, ': ').trim() + ' ' + bullets;
        }
        // Cap the appended clause (~240; 260 chosen so a typical 3-condition
        // "you must: X; or Y; or Z" list isn't truncated mid-item).
        put('fee_waiver_condition', docCapText(value, 260), 'medium', wvb[1]);
      }
    }
  }

  // ---- Early termination fee + window ---------------------------------------
  const etfRow = docGlance(rows, [['early', 'termination'], ['early', 'account', 'closure'], ['closure', 'fee']]);
  if (etfRow) {
    const v = etfRow.value.toLowerCase();
    if (/\bnone\b|\bno\b|\$0\b/.test(v) && !/\$[1-9]/.test(v)) {
      put('early_termination_fee', 0, 'high', etfRow.raw);
    } else {
      const ev = docFirstDollar(etfRow.value);
      if (ev != null) put('early_termination_fee', ev, 'high', etfRow.raw);
      const win = docIntNear(etfRow.value, /within\s+(\d+)\s+days|(\d+)\s+days/i);
      if (win != null) put('etf_window_days', win, 'medium', etfRow.raw);
    }
  }

  // ---- Promo code ------------------------------------------------------------
  const promoRow = docGlance(rows, [['promo', 'code'], ['promotion', 'code'], ['bonus', 'code'], ['offer', 'code']]);
  if (promoRow) {
    const code = (promoRow.value.match(/\b([A-Z0-9]{3,})\b/) || [])[1];
    if (code) put('promo_code', code, 'high', promoRow.raw);
  } else {
    const pm2 = text.match(/\b(?:promo(?:tion)?|bonus|offer)\s+code[:\s]+([A-Z0-9]{3,})\b/);
    if (pm2) put('promo_code', pm2[1], 'medium', pm2[0]);
  }
  // P2 delta: a newer "Update" that names a promo code supersedes an older one
  // ([03] newest update «code Q3BUS26» beats the 1/15/26 «Q1AFL26»). A code is an
  // uppercase alnum token with ≥1 digit, following "code". The newest dated
  // segment that mentions one wins.
  {
    const rec = docReconcileScalar(segs, (segText) => {
      // "code: X", "code is now X", "promo code X", "with code X" — a code is an
      // uppercase alnum token containing ≥1 digit (so it isn't a plain word).
      const cm = segText.match(/\bcode\b(?:\s+is\s+now|\s*[:=]|\s+)\s*([A-Z0-9]*\d[A-Z0-9]*)\b/);
      return cm ? cm[1] : null;
    });
    if (rec && rec.iso && rec.value && (!fields.promo_code || fields.promo_code.value !== rec.value)) {
      const src = (segs.newestFirst.find(s => s.iso === rec.iso) || {}).text || '';
      put('promo_code', rec.value, rec.reconciled ? 'medium' : 'high', src,
        rec.reconciled ? { note: 'Newest "Update" promo code — supersedes an earlier one' } : null);
    }
  }

  // ---- Bonus posting window (min/max days) ----------------------------------
  // Verb set covers post/pay/paid/credit/deposit ("bonus will be PAID within 20
  // days"). Range form first ("posts within 45 – 60 days" / "6-8 weeks"), then
  // single-bound. UNIT accepts days OR weeks (weeks ×7). Every gap quantifier is
  // BOUNDED ({0,160}) so no pathological line can drive quadratic backtracking
  // (a `bonus` + verb line that never terminates with a period). See docP2 note.
  const POSTVERB = '(?:post|posts|posted|pay|paid|credit|credited|deposit|deposited)';
  const UNIT = '(days?|weeks?)';
  const G = '[^.\\n]{0,160}';
  const postM = text.match(new RegExp('(' + G + 'bonus' + G + POSTVERB + G + '?(\\d+)\\s*(?:-|–|—|to)\\s*(\\d+)\\s+' + UNIT + ')', 'i'));
  if (postM) {
    const unit = postM[4];
    put('bonus_post_min_days', docDaysFrom(postM[2], unit), 'medium', postM[1]);
    put('bonus_post_max_days', docDaysFrom(postM[3], unit), 'medium', postM[1]);
  } else {
    // Prefer a PAYMENT-specific posting phrase over the requirement window: a
    // sentence where the BONUS is the subject being paid ("bonus will be
    // deposited/paid/posted/credited within N days …"), not "receive a bonus when
    // you deposit within N days" (that N is the requirement window). Capture the
    // anchor (account opening vs meeting-the-requirements) for P4 composition.
    const PAY = '(?:bonus|reward)[^.\\n]{0,60}?(?:will be |is |are )?(?:be )?(?:deposited|paid|posted|credited)';
    const payM = text.match(new RegExp('(' + G + PAY + G + '?within\\s+(\\d+)\\s+' + UNIT + '(?:\\s+(?:of|after)\\s+(?:account\\s+)?(opening|meeting|completing|satisf))?)', 'i'));
    // Hold/open-status period, for composition (min = hold, max = hold + tail).
    const holdN = (function () {
      const hm = text.match(/(?:open account status|remain open|kept? open|maintain an open account)[^.\n]{0,50}?(?:for )?(?:at least )?(\d+)\s+(?:calendar )?days/i)
        || text.match(/maintenance period[^.\n]{0,90}?ends?\s+[^.\n]{0,20}?(?:day\s+)?(\d+)/i)
        || (fields.daysFundsMustRemain ? { 1: String(fields.daysFundsMustRemain.value) } : null);
      return hm ? Number(hm[1]) : null;
    })();
    if (payM) {
      const val = docDaysFrom(payM[2], payM[3]);
      const anchor = (payM[4] || '').toLowerCase();
      if ((anchor === 'meeting' || anchor === 'completing' || anchor === 'satisf') && holdN != null && Number.isFinite(val)) {
        put('bonus_post_min_days', holdN, 'medium', payM[1]);
        put('bonus_post_max_days', holdN + val, 'medium', payM[1] + ' (hold ' + holdN + ' + processing ' + val + ')');
      } else {
        put('bonus_post_max_days', val, 'medium', payM[1]);
      }
    } else {
      // Fallback to the older generic scan (requirement-window bonus phrasing).
      const postSingle = text.match(new RegExp('(' + G + 'bonus' + G + POSTVERB + G + '?within\\s+(\\d+)\\s+' + UNIT + '|' + G + 'within\\s+(\\d+)\\s+' + UNIT + G + 'bonus' + G + POSTVERB + G + ')', 'i'));
      if (postSingle) {
        const n = postSingle[2] || postSingle[4];
        const unit = postSingle[3] || postSingle[5];
        put('bonus_post_max_days', docDaysFrom(n, unit), 'medium', postSingle[1]);
      }
    }
  }

  // ---- Churn hints -----------------------------------------------------------
  const churn = docScanChurn(text);
  if (churn) { for (const k in churn) fields[k] = churn[k]; }

  // ---- EITHER/OR qualification paths (2026-07-11) ----------------------------
  // Emit requirementLogic:'any' when the post says the bonus is met by EITHER a
  // direct deposit OR a card spend. PURELY ADDITIVE + CONSERVATIVE: it only sets
  // the new (gold-silent) requirementLogic field — it never touches a scored
  // field — so the gold corpus cannot regress. The importer's path picker turns
  // it into an offer.requirementLogic + populates both requirement blocks.
  docDetectEitherOr(text, put);

  // ---- Leftovers ("Not auto-filled") ----------------------------------------
  // Glance rows whose label we didn't map become manual-reference leftovers, so
  // the user can eyeball state-eligibility, ChexSystems, hard-pull, etc.
  const CLAIMED = /bank|institution|bonus|expir|expires|deadline|direct deposit|minimum deposit|funding|deposit requirement|opening deposit|monthly fee|maintenance fee|termination|closure|promo|promotion code|offer code/i;
  for (const row of rows) {
    if (!CLAIMED.test(row.label)) unparsed.push(docSnippet(row.raw));
  }

  // P1: return the detected tier ladder as a TOP-LEVEL array (NOT inside fields —
  // the preview must not render these as ordinary rows this step; step 4b owns
  // the tier picker). Empty array when <2 tiers were found. Never auto-selected.
  const out = { fields, unparsed };
  if (tiers.length >= 2) out.tiers = tiers;
  return out;
}

// EITHER/OR detector (2026-07-11, generalized 2026-07-14). Fires
// requirementLogic:'any' ONLY on a high-confidence disjunction that bridges
// EITHER a direct-deposit term OR a hold-new-funds/maintain-balance term with
// a spend/debit term, via an "either / or / one of the following" connective,
// in a bonus-QUALIFICATION context and NOT a fee-waiver context. Conservative
// by design: the bridge requires both terms in proximity to the connective,
// so conjunctive SUB prose (the entire gold corpus) never matches. The hold
// bridge exists because a held-type offer's either/or (e.g. Brex: hold new
// funds 1 day OR meet card spend) names no direct deposit at all — the DD
// bridge alone can never fire for it, silently dropping the disjunction. PURE;
// only calls `put('requirementLogic', …)` — no scored field is read or written.
function docDetectEitherOr(text, put) {
  if (!text || typeof put !== 'function') return;
  const T = String(text);
  const bridge = new RegExp(
    'direct\\s+deposit[\\s\\S]{0,120}?(?:\\bor\\b|either|one of the following)[\\s\\S]{0,60}?(?:spend|debit|purchase)'
    + '|(?:spend|debit|purchase)[\\s\\S]{0,120}?(?:\\bor\\b|either|one of the following)[\\s\\S]{0,60}?direct\\s+deposit'
    + '|(?:either|one of the following|any of the following)[\\s\\S]{0,160}?direct\\s+deposit[\\s\\S]{0,160}?(?:spend|debit|purchase)'
    + '|(?:either|one of the following|any of the following)[\\s\\S]{0,160}?(?:spend|debit|purchase)[\\s\\S]{0,160}?direct\\s+deposit',
    'i');
  const HOLD_TERM = '(?:hold(?:ing)?\\s+(?:new\\s+)?funds|maintain(?:ing)?\\s+(?:an?\\s+)?(?:average\\s+)?balance)';
  const holdBridge = new RegExp(
    HOLD_TERM + '[\\s\\S]{0,120}?(?:\\bor\\b|either|one of the following)[\\s\\S]{0,60}?(?:spend|debit|purchase)'
    + '|(?:spend|debit|purchase)[\\s\\S]{0,120}?(?:\\bor\\b|either|one of the following)[\\s\\S]{0,60}?' + HOLD_TERM
    + '|(?:either|one of the following|any of the following)[\\s\\S]{0,160}?' + HOLD_TERM + '[\\s\\S]{0,160}?(?:spend|debit|purchase)'
    + '|(?:either|one of the following|any of the following)[\\s\\S]{0,160}?(?:spend|debit|purchase)[\\s\\S]{0,160}?' + HOLD_TERM,
    'i');
  const m = T.match(bridge) || T.match(holdBridge);
  if (!m) return;
  // Reject fee-waiver prose ("avoid the monthly fee with a DD or debit purchase")
  // — that names a fee-avoidance path, not a bonus qualification path. SCOPED
  // (2026-07-14 fix-up) to the matched disjunction's own sentence/line, not the
  // whole post: nearly every real DoC post carries an unrelated "Monthly fees:
  // $0" glance row elsewhere in the text, and a whole-post guard let that row
  // suppress an otherwise-legitimate hold-vs-spend (or DD-vs-spend) detection.
  // Boundary convention matches the R70 span-anchor sentence window above
  // (line ~1018): '.' or '\n' on either side of the match.
  const mi = m.index || 0;
  const snipStart = Math.max(T.lastIndexOf('.', mi), T.lastIndexOf('\n', mi)) + 1;
  let snipEnd = mi + m[0].length;
  const snipPeriod = T.indexOf('.', snipEnd), snipNewline = T.indexOf('\n', snipEnd);
  snipEnd = Math.min(snipPeriod < 0 ? T.length : snipPeriod, snipNewline < 0 ? T.length : snipNewline);
  const snippet = T.slice(snipStart, snipEnd);
  if (/waiv|avoid[\s\S]{0,40}?fee|monthly (?:maintenance )?fee/i.test(snippet)) return;
  // Require a bonus-qualification context so the disjunction is about EARNING the
  // bonus, not some unrelated "or".
  if (!/qualif|to earn|to receive|to get|\bbonus\b|requirement|meet the/i.test(T)) return;
  put('requirementLogic', 'any', 'high', m[0].slice(0, 160));
}

export { parseDocPost, docNormalizeInput, docExtractGlanceRows, docParseBonusValue, docFirstDollar, docDollarToNumber, docDaysFrom, docLatestDate, docDateSegments, docDetectEitherOr };
