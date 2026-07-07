/**
 * Yield Vector — DoC import Worker (Phase 7 v2, GATED SCAFFOLD)
 * ============================================================
 * A single-file Cloudflare Worker (module syntax). It is the server-side half
 * of the optional "paste a URL" Doctor-of-Credit import. It is INERT for the
 * app until the owner (1) deploys it and (2) pastes its URL into
 * Yield Vector → Settings → "DoC import Worker URL". See ./README.md.
 *
 * Why a Worker exists at all: doctorofcredit.com sends no CORS headers, so a
 * browser can't fetch the post directly. This Worker fetches it server-side,
 * does a light readability pass to pull the article body, and (only for the
 * handful of genuinely ambiguous prose fields) asks the Anthropic API to
 * extract them — with a verbatim-quote "tripwire" contract that lets the client
 * programmatically reject a fabricated value before the user ever sees it.
 *
 * Security posture (enforced below, documented in README):
 *   - POST only; JSON body { url }.
 *   - URL allowlist: https + hostname exactly doctorofcredit.com / www.doctorofcredit.com.
 *   - CORS locked to env.ALLOWED_ORIGIN; other origins get 403.
 *   - Anthropic key lives ONLY in env (Worker secret) — never in a response.
 *   - No logging of fetched content, no persistence, no other endpoints.
 *
 * Env bindings:
 *   ANTHROPIC_API_KEY  (secret, required for the LLM tier; absent → llm:null)
 *   ALLOWED_ORIGIN     (var, e.g. https://cmr2334.github.io)
 *   ANTHROPIC_MODEL    (var, optional; default 'claude-sonnet-5')
 *
 * The pure helpers (validation / extraction / tripwire) are also exported as
 * named exports so they can be unit-tested under plain Node without a fetch
 * runtime. The default export is the Cloudflare entrypoint.
 */

// ---- Constants -------------------------------------------------------------

// Exact-match host allowlist. No subdomain wildcard — an attacker-controlled
// evil.doctorofcredit.com.attacker.tld must NOT pass, and neither should a
// legit-looking subdomain we don't intend to fetch.
export const ALLOWED_HOSTS = ['doctorofcredit.com', 'www.doctorofcredit.com'];

const FETCH_TIMEOUT_MS = 10000;        // server-side page fetch budget
const MAX_BODY_BYTES = 1_500_000;      // ~1.5MB cap on the read page body
const ANTHROPIC_TIMEOUT_MS = 20000;    // LLM call budget (separate from page)
const DEFAULT_MODEL = 'claude-sonnet-5';
const UA = 'YieldVector-DoC-Import/1.0 (personal use)';

// The ONLY fields the LLM is allowed to touch — the low-confidence prose fields
// the deterministic client parser can't reliably read (per Phase 7 design).
// Each must come back as { value, quote } where quote is verbatim from the page.
export const LLM_FIELDS = [
  'fee_waiver_condition',   // e.g. "waived if you keep $1,500" — prose condition
  'churn_notes',            // re-bonus / "once per lifetime" eligibility language
  'eligibility_notes',      // state / targeted / household nuances in prose
  'early_close_notes',      // ETF / keep-open-N-days safe-close language
  'bonus_posting_notes'     // when/how the bonus posts, in prose
];

// ---- URL validation --------------------------------------------------------

/**
 * Validate the requested URL. Returns { ok:true, url } or { ok:false, error }.
 * Rules: parses as a URL, protocol is https, host is in the exact allowlist.
 * Pure + synchronous → unit-testable.
 */
export function validateUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'url is required' };
  }
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'url is not a valid URL' };
  }
  if (u.protocol !== 'https:') {
    return { ok: false, error: 'url must be https' };
  }
  // hostname is already lowercased + punycoded by the URL parser. Exact match
  // against the allowlist — no endsWith, no wildcard.
  if (!ALLOWED_HOSTS.includes(u.hostname)) {
    return { ok: false, error: 'url host not allowed (Doctor of Credit only)' };
  }
  return { ok: true, url: u.toString() };
}

// ---- Readability / article extraction --------------------------------------

/**
 * Strip <script>/<style>/<noscript> (and their content), comments, then reduce
 * a chunk of HTML to readable text: block tags → newlines, tags removed, HTML
 * entities decoded, whitespace collapsed. Kept deliberately simple + robust —
 * this is not a full readability engine, just enough to feed the client's
 * existing glance-list parser and to give the LLM clean prose to quote from.
 * Pure → unit-testable.
 */
export function htmlToText(html) {
  if (typeof html !== 'string') return '';
  let s = html;
  // Remove elements whose *content* must not survive.
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // Block-ish boundaries → newlines so the glance list stays line-oriented.
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|table|ul|ol|br)\s*>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '\n');
  // Drop all remaining tags.
  s = s.replace(/<[^>]+>/g, ' ');
  // Decode the handful of entities that matter for our fields ($ amounts, etc.).
  s = decodeEntities(s);
  // Collapse whitespace but keep line breaks.
  s = s.replace(/[ \t\f\v]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function decodeEntities(s) {
  const named = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    '&apos;': "'", '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—',
    '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“',
    '&rdquo;': '”', '&hellip;': '…', '&trade;': '™', '&reg;': '®',
    '&cent;': '¢', '&pound;': '£', '&euro;': '€'
  };
  return s
    .replace(/&#(\d+);/g, (_, n) => {
      const code = parseInt(n, 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? safeFromCode(code) : _;
    })
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? safeFromCode(code) : _;
    })
    .replace(/&[a-zA-Z]+;/g, m => (Object.prototype.hasOwnProperty.call(named, m) ? named[m] : m));
}
function safeFromCode(code) {
  try { return String.fromCodePoint(code); } catch { return ''; }
}

/**
 * Pull the post's main content out of a full DoC page. Strategy: find the
 * WordPress article body (`entry-content` / `<article>` / `post-content`), and
 * if found, extract just that subtree's HTML before converting to text; else
 * fall back to converting the whole document. Returns readable text either way.
 * Robust to markup drift — a missed container degrades to "text of the page",
 * which the client parser still handles (it hunts for the glance list).
 * Pure → unit-testable.
 */
export function extractArticle(html) {
  if (typeof html !== 'string' || !html) return '';
  const body = sliceFirstContainer(html, [
    /class=["'][^"']*\bentry-content\b[^"']*["']/i,
    /class=["'][^"']*\bpost-content\b[^"']*["']/i,
    /class=["'][^"']*\btd-post-content\b[^"']*["']/i
  ]);
  const chosen = body || sliceTag(html, 'article') || html;
  return htmlToText(chosen);
}

// Find the opening <div ...class="…target…"> and return a best-effort slice of
// that div by walking nested <div> depth. Returns null if no match.
function sliceFirstContainer(html, classPatterns) {
  for (const pat of classPatterns) {
    const m = pat.exec(html);
    if (!m) continue;
    // Walk back to the '<' that opens this tag.
    let start = html.lastIndexOf('<', m.index);
    if (start < 0) continue;
    // Only accept a <div (the class attr could be on non-div elements we don't
    // want to depth-track); if it's not a div, still try — treat generically.
    const openEnd = html.indexOf('>', m.index);
    if (openEnd < 0) continue;
    const sliced = sliceByDivDepth(html, start, openEnd + 1);
    if (sliced) return sliced;
  }
  return null;
}

// Given the index of a container's opening '<' and the index just past its '>',
// return the substring through the matching close by counting <div>/<\/div>.
// Assumes the container is div-like; good enough for WP entry-content.
function sliceByDivDepth(html, openStart, afterOpen) {
  const re = /<div\b|<\/div\s*>/gi;
  re.lastIndex = afterOpen;
  let depth = 1;
  let m;
  let guard = 0;
  while ((m = re.exec(html)) && guard++ < 100000) {
    if (m[0][1] === '/') { // </div>
      depth--;
      if (depth === 0) return html.slice(openStart, re.lastIndex);
    } else {
      depth++;
    }
  }
  // Unbalanced markup: take from open to end (still yields the article body).
  return html.slice(openStart);
}

// Return the inner+outer HTML of the first <tag>…</tag>, or null.
function sliceTag(html, tag) {
  const open = new RegExp('<' + tag + '\\b[^>]*>', 'i').exec(html);
  if (!open) return null;
  const startInner = open.index + open[0].length;
  const close = new RegExp('</' + tag + '\\s*>', 'i');
  close.lastIndex = startInner;
  const c = html.slice(startInner).search(close);
  if (c < 0) return html.slice(open.index);
  return html.slice(open.index, startInner + c);
}

// ---- Tripwire (verbatim-quote grounding) -----------------------------------

/**
 * Normalize text for verbatim comparison: collapse all whitespace to single
 * spaces, trim, lowercase. Both the model's quote and the article text are run
 * through this before substring-checking, so cosmetic whitespace/case
 * differences don't cause false rejections — but a fabricated quote (text that
 * simply isn't on the page) still fails. Pure → unit-testable.
 */
export function normalizeForQuote(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The tripwire: does `quote` appear verbatim (whitespace-normalized) in
 * `articleText`? This is the same check the client runs independently; the
 * Worker runs it too so it never emits an ungrounded field. Empty quote → fail.
 * Pure → unit-testable.
 */
export function quoteIsGrounded(quote, articleText) {
  const q = normalizeForQuote(quote);
  if (!q) return false;
  return normalizeForQuote(articleText).includes(q);
}

/**
 * Filter an LLM field map down to only entries that (a) are allowlisted fields,
 * (b) have a non-empty string value, and (c) whose quote is grounded in the
 * article text. Returns a clean { field: { value, quote } } or null if nothing
 * survives. Pure → unit-testable. (The client re-runs the tripwire too — this
 * is defense in depth, not the sole gate.)
 */
export function groundLlmFields(rawLlm, articleText) {
  if (!rawLlm || typeof rawLlm !== 'object') return null;
  const out = {};
  let kept = 0;
  for (const field of LLM_FIELDS) {
    const entry = rawLlm[field];
    if (!entry || typeof entry !== 'object') continue;
    const value = entry.value;
    const quote = entry.quote;
    if (value == null || String(value).trim() === '') continue;
    if (typeof quote !== 'string' || !quote.trim()) continue;
    if (!quoteIsGrounded(quote, articleText)) continue;
    out[field] = { value: String(value), quote: String(quote) };
    kept++;
  }
  return kept ? out : null;
}

// ---- CORS ------------------------------------------------------------------

function corsHeaders(env, origin) {
  const allowed = (env && env.ALLOWED_ORIGIN) || '';
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // X-YV-Key is the optional shared secret; must be allow-listed here or the
    // browser's preflight blocks the client from sending it.
    'Access-Control-Allow-Headers': 'Content-Type, X-YV-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  // Echo the configured origin (single-origin lock). If the caller's Origin
  // doesn't match, we still set the header to the configured value — the
  // browser will block the mismatched read, and we additionally 403 below.
  if (allowed) h['Access-Control-Allow-Origin'] = allowed;
  return h;
}

function originAllowed(env, origin) {
  const allowed = (env && env.ALLOWED_ORIGIN) || '';
  // If no ALLOWED_ORIGIN configured, refuse everything (fail closed).
  if (!allowed) return false;
  // Same-origin/no-Origin (e.g. curl) has no Origin header; allow those through
  // (they can't be a browser CSRF vector) but a present, mismatched Origin is
  // rejected. NOTE: CORS only gates *browsers* — a non-browser caller (curl,
  // a script) sends no Origin and sails past this check. The optional
  // WORKER_SECRET (below) is what actually locks out non-browser callers.
  if (!origin) return true;
  return origin === allowed;
}

// Length-independent-ish string compare. Not a hardened constant-time primitive
// (JS strings can't fully guarantee that), but it always compares the full
// expected length and avoids the trivial early-return length leak — sufficient
// at this threat level (a leaked personal Worker URL, not a public auth server).
export function safeEqual(a, b) {
  const s = String(a == null ? '' : a);
  const t = String(b == null ? '' : b);
  let diff = s.length ^ t.length;
  const n = Math.max(s.length, t.length);
  for (let i = 0; i < n; i++) {
    diff |= (s.charCodeAt(i) || 0) ^ (t.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Optional shared-secret gate. When env.WORKER_SECRET is set, the request MUST
 * carry an X-YV-Key header equal to it; otherwise access is denied. When
 * WORKER_SECRET is unset, this is a no-op (personal-tool default: CORS-only).
 * Returns true if the request may proceed. Checked BEFORE any page fetch or LLM
 * call so a bad/absent key burns no upstream cost. `getHeader` is a function
 * (name)→value|null so this is unit-testable without a real Request.
 */
export function secretOk(env, getHeader) {
  const expected = (env && env.WORKER_SECRET) || '';
  if (!expected) return true; // secret not configured → no-op.
  const provided = (getHeader && getHeader('x-yv-key')) || '';
  return safeEqual(provided, expected);
}

function json(body, status, env, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8' },
      corsHeaders(env, origin)
    )
  });
}

// ---- Page fetch ------------------------------------------------------------

// Max redirect hops we'll follow. Each hop's destination is re-validated
// against the DoC allowlist so an open redirector ON doctorofcredit.com
// (plugin / oEmbed / feed endpoints that 30x to an arbitrary ?url=) can't be
// used to make the Worker fetch off-allowlist hosts and feed attacker text to
// the paid LLM. (P2 fix — see README SSRF note.)
export const MAX_REDIRECT_HOPS = 3;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Pure redirect-hop decision. Given the current (already-validated) URL, the
 * response status, the raw Location header value, and how many hops we've taken
 * so far, decide what to do next. Returns one of:
 *   { action:'return' }                        → not a redirect; use this body
 *   { action:'follow', url:<validated abs url>} → follow to a re-validated host
 *   { action:'reject', error:<msg> }            → stop (off-allowlist / no loc /
 *                                                  too many hops)
 * Resolves relative Locations against `currentUrl`, then runs the SAME
 * validateUrl allowlist on the absolute result. Pure → unit-testable without a
 * network.
 */
export function decideRedirect(currentUrl, status, location, hopsTaken) {
  if (!REDIRECT_STATUSES.has(status)) return { action: 'return' };
  if (hopsTaken >= MAX_REDIRECT_HOPS) return { action: 'reject', error: 'too many redirects' };
  if (!location || !String(location).trim()) return { action: 'reject', error: 'redirect without location' };
  let abs;
  try {
    // Resolve relative → absolute against the current URL.
    abs = new URL(String(location).trim(), currentUrl).toString();
  } catch {
    return { action: 'reject', error: 'redirect off allowlist' };
  }
  const v = validateUrl(abs);
  if (!v.ok) return { action: 'reject', error: 'redirect off allowlist' };
  return { action: 'follow', url: v.url };
}

/**
 * Fetch the DoC page server-side with a timeout and a hard body-size cap.
 * Returns { ok:true, html } or { ok:false, error }. Redirects are followed
 * MANUALLY: on a 30x we read Location, re-validate it against the allowlist via
 * decideRedirect, and follow at most MAX_REDIRECT_HOPS times — a hop that lands
 * off doctorofcredit.com is refused (defeats redirector-based SSRF). Reads the
 * response as a stream and aborts once MAX_BODY_BYTES is exceeded so a
 * hostile/huge page can't blow memory. Requires a real fetch/ReadableStream
 * runtime (Workers / Node 18+) — this is why it's separated from the pure
 * helpers. One shared timeout budget spans the whole hop chain.
 */
async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = url;
    for (let hops = 0; ; hops++) {
      const resp = await fetch(current, {
        method: 'GET',
        redirect: 'manual', // we re-validate every hop ourselves.
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        signal: controller.signal
      });
      const decision = decideRedirect(current, resp.status, resp.headers.get('location'), hops);
      if (decision.action === 'reject') {
        return { ok: false, error: decision.error };
      }
      if (decision.action === 'follow') {
        current = decision.url;
        continue;
      }
      // Not a redirect → this is the terminal response.
      if (!resp.ok) {
        return { ok: false, error: 'source responded ' + resp.status };
      }
      const html = await readCapped(resp, MAX_BODY_BYTES);
      return { ok: true, html };
    }
  } catch (e) {
    const msg = (e && e.name === 'AbortError') ? 'source fetch timed out' : 'source fetch failed';
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// Read a Response body as text but stop after `cap` bytes (size guard). Falls
// back to resp.text() if the body isn't a stream (older runtimes).
async function readCapped(resp, cap) {
  const body = resp.body;
  if (!body || typeof body.getReader !== 'function') {
    const t = await resp.text();
    return t.length > cap ? t.slice(0, cap) : t;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let out = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (received >= cap) {
      try { await reader.cancel(); } catch {}
      break;
    }
  }
  out += decoder.decode();
  return out;
}

// ---- Anthropic LLM tier ----------------------------------------------------

const LLM_SYSTEM_PROMPT =
  'You extract a fixed set of fields from a Doctor of Credit bank-bonus post. ' +
  'Return ONLY a single JSON object and no other text. ' +
  'The object may contain any of these keys and NO others: ' +
  LLM_FIELDS.join(', ') + '. ' +
  'For each key you include, the value MUST be an object {"value": <string>, "quote": <string>} ' +
  'where "value" is the extracted fact in plain words and "quote" is a VERBATIM substring ' +
  'copied exactly from the provided post text that supports it (same characters, same spelling). ' +
  'Omit any field you cannot support with a verbatim quote from the text. ' +
  'Never invent a quote. Never include a field whose quote is not present in the text. ' +
  'If you cannot support any field, return {}. Output JSON only, no prose, no code fences.';

/**
 * Ask Anthropic to extract ONLY the prose fields. Returns a raw
 * { field: { value, quote } } object (UNvalidated — the caller runs the
 * tripwire). Returns null on any failure (missing key, network, parse) so the
 * import degrades to deterministic-only. Never throws.
 */
async function callAnthropic(env, articleText) {
  const apiKey = env && env.ANTHROPIC_API_KEY;
  if (!apiKey) return null; // LLM tier not configured → deterministic only.
  const model = (env && env.ANTHROPIC_MODEL) || DEFAULT_MODEL;
  // Bound the text we send (also bounds cost). The glance list + prose we care
  // about live near the top; 16k chars is plenty for the ~5 fields.
  const text = articleText.length > 16000 ? articleText.slice(0, 16000) : articleText;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: LLM_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: 'POST TEXT:\n"""\n' + text + '\n"""\n\nReturn the JSON object now.' }
        ]
      }),
      signal: controller.signal
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return parseLlmJson(data);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the JSON object out of an Anthropic /v1/messages response. The content
 * text may be pure JSON, or (defensively) JSON wrapped in prose/fences. Returns
 * a plain object or null. Exported for unit testing without a network call.
 */
export function parseLlmJson(apiResponse) {
  try {
    const content = apiResponse && Array.isArray(apiResponse.content) ? apiResponse.content : null;
    if (!content) return null;
    // Concatenate all text parts (usually one).
    const text = content
      .filter(p => p && p.type === 'text' && typeof p.text === 'string')
      .map(p => p.text)
      .join('\n')
      .trim();
    if (!text) return null;
    const obj = extractJsonObject(text);
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : null;
  } catch {
    return null;
  }
}

// Try JSON.parse directly; if that fails, strip code fences / grab the first
// {...} balanced span and parse that.
function extractJsonObject(text) {
  try { return JSON.parse(text); } catch {}
  let t = text.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(t); } catch {}
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const span = t.slice(start, i + 1);
        try { return JSON.parse(span); } catch { return null; }
      }
    }
  }
  return null;
}

// ---- Cloudflare entrypoint -------------------------------------------------

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight.
    if (request.method === 'OPTIONS') {
      // Preflight from a disallowed origin is refused (no ACAO for it below).
      if (!originAllowed(env, origin)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    }

    // Origin lock for the actual request.
    if (!originAllowed(env, origin)) {
      return json({ ok: false, error: 'origin not allowed' }, 403, env, origin);
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'POST only' }, 405, env, origin);
    }

    // Optional shared-secret gate — checked BEFORE any fetch/LLM work so a
    // bad/absent key never burns upstream cost. No-op when WORKER_SECRET unset.
    if (!secretOk(env, (name) => request.headers.get(name))) {
      return json({ ok: false, error: 'unauthorized' }, 403, env, origin);
    }

    // Parse the JSON body.
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: 'invalid JSON body' }, 400, env, origin);
    }

    // Validate the URL against the DoC allowlist.
    const v = validateUrl(payload && payload.url);
    if (!v.ok) {
      return json({ ok: false, error: v.error }, 400, env, origin);
    }

    // Fetch the page server-side.
    const page = await fetchPage(v.url);
    if (!page.ok) {
      return json({ ok: false, error: page.error }, 502, env, origin);
    }

    // Extract the article body → readable text.
    const articleText = extractArticle(page.html);
    if (!articleText || articleText.trim().length < 40) {
      // Nothing usable — still 200 so the client can tell the user to paste.
      return json({ ok: true, html: articleText || '', llm: null }, 200, env, origin);
    }

    // LLM prose tier (best-effort). Failure → llm:null, deterministic proceeds.
    let llm = null;
    try {
      const rawLlm = await callAnthropic(env, articleText);
      llm = groundLlmFields(rawLlm, articleText); // tripwire before returning.
    } catch {
      llm = null;
    }

    return json({ ok: true, html: articleText, llm }, 200, env, origin);
  }
};
