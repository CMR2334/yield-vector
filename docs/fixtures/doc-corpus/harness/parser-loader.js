// parser-loader.js
// Extracts the REAL parseDocPost + its helpers from the app's inline <script>
// and makes them callable under Node with a FAITHFUL DOMParser (jsdom).
//
// Fidelity strategy: rather than hand-roll a DOMParser shim (whose faithfulness
// would itself need auditing), we provide jsdom's real DOMParser — the same
// WHATWG implementation a browser uses for the parser's `new DOMParser()
// .parseFromString(s,'text/html')` call plus querySelectorAll/textContent/
// remove/appendChild/createTextNode. fidelity-check.js proves behavior is
// unchanged by running the app's own 7 DOC_TEST_EXPECT fixtures through it.
//
// We DO NOT execute the whole app script (it references window/document/App and
// would throw). Since the P1 module split, the parser lives in its own ES
// modules (js/doc-parser.js + js/date-format-core.js); we read those module
// files, strip their import/export lines, and eval the remaining declarations in
// a vm context whose only globals are DOMParser (jsdom) + console.
//
// PATHS (repo-relative): this file lives at
//   <repo>/docs/fixtures/doc-corpus/harness/parser-loader.js
// so the app source is four levels up (../../../../index.html). REPO is derived
// from __dirname (no absolute paths) so the harness runs wherever the repo is
// checked out. jsdom is NOT a repo dependency (zero-dep ethos) — install it for
// the duration of a verify run with `npm i --no-save jsdom` (see README).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

// <repo>/docs/fixtures/doc-corpus/harness -> up 4 = repo root.
const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const INDEX = path.join(REPO, 'index.html');
if (!fs.existsSync(INDEX)) {
  throw new Error('parser-loader: could not find index.html at ' + INDEX +
    ' (expected harness to live at <repo>/docs/fixtures/doc-corpus/harness/)');
}

// The functions parseDocPost depends on (transitive closure of pure helpers).
// INFORMATIONAL SINCE THE P1 SPLIT: buildParser now evals the whole js/doc-parser
// + js/date-format-core module bodies, so new parser helpers are picked up
// automatically and need NOT be added here. Kept (and exported) as a documented
// inventory of the parser's helper surface.
const NEEDED = [
  '_isoFromYMD', 'docNormalizeInput', 'docSnippet', 'docLabelMatches',
  'docExtractGlanceRows', 'docGlance', 'docLatestDate', 'docLatestUpdateBlock',
  'docDollarToNumber', 'docDaysFrom', 'docParseBonusValue', 'docIntNear',
  'docFirstDollar', 'docScanChurn', 'parseDocPost',
  // calibration-run additions (funding-label guard, date segmentation, tiers):
  'docIsCardFundingLabel', 'docDateSegments', 'docReconcileScalar', 'docScanTiers',
  'docChurnAnchor',
  // R70 additions (waiver colon+bullets append):
  'docCapText', 'docBulletsAfterClause'
];

// Strip the ESM import/export statements a module carries so its remaining
// function/const declarations can be evaluated as one plain script in a vm
// sandbox (exactly the closure the parser had when it was inline).
function stripModuleSource(src) {
  return src
    .replace(/^import \{[^}]*\} from '[^']+';[ \t]*\n/gm, '')
    .replace(/^export \{[^}]*\};[ \t]*\n?/gm, '');
}

function buildParser() {
  // P1 (module split) moved the parser into js/doc-parser.js, which imports
  // _isoFromYMD from js/date-format-core.js. We read BOTH module files and eval
  // their bodies together in one sandbox — the parser is sourced from the real
  // module files (no more brace-matching index.html, no NEEDED[] upkeep) and is
  // wired exactly as the browser wires it. date-format-core first so its
  // _isoFromYMD + date/format helpers are in scope for the parser.
  const dfc = stripModuleSource(fs.readFileSync(path.join(REPO, 'js', 'date-format-core.js'), 'utf8'));
  const dp = stripModuleSource(fs.readFileSync(path.join(REPO, 'js', 'doc-parser.js'), 'utf8'));

  // A throwaway jsdom document gives us a real, spec-compliant DOMParser.
  const win = new JSDOM('<!doctype html><body></body>').window;

  const sandbox = { DOMParser: win.DOMParser, console };
  sandbox.global = sandbox;
  vm.createContext(sandbox);

  // Same public surface the brace-match loader returned, plus docDateSegments
  // (the p2b segmentation pin sources it here instead of re-extracting).
  const src = dfc + '\n' + dp + '\n' +
    'global.__api = { parseDocPost, docNormalizeInput, docExtractGlanceRows, ' +
    'docParseBonusValue, docFirstDollar, docDollarToNumber, docDaysFrom, docLatestDate, ' +
    'docDateSegments };\n';
  vm.runInContext(src, sandbox);
  return sandbox.__api;
}

// ---- Post-corpus location (OPTIONAL) ----------------------------------------
// The raw DoC post bodies are NOT committed (copyright — see README). Scripts
// that score against real posts read them from a local, un-committed directory.
// Point $DOC_CORPUS_POSTS at a folder of saved `NN-slug.html` pages, or drop
// them in `<doc-corpus>/posts/` (git-ignored). Returns null if absent so callers
// can print a friendly "re-hydrate posts first" message instead of crashing.
const CORPUS = path.resolve(__dirname, '..');            // <repo>/docs/fixtures/doc-corpus
function postsDir() {
  const cand = process.env.DOC_CORPUS_POSTS || path.join(CORPUS, 'posts');
  return fs.existsSync(cand) ? cand : null;
}
function goldDir() { return path.join(CORPUS, 'labels', 'gold'); }
function manifestPath() { return path.join(CORPUS, 'manifest.json'); }

// ---- Extract the entry-content HTML from a raw saved DoC post ---------------
// A user pastes a DoC post by select-all-copy of the article; what that carries
// is the rendered article body — i.e. the WordPress `.entry-content` div. We
// reproduce that here with jsdom: parse the saved page, grab `.entry-content`
// innerHTML, and feed THAT to parseDocPost (the parser re-parses HTML itself).
// This is the faithful "as a user would paste it" input (documented in README).
function extractEntryContentHTML(pageHtml) {
  const doc = new JSDOM(pageHtml).window.document;
  const el = doc.querySelector('.entry-content')
    || doc.querySelector('article .post-content')
    || doc.querySelector('article');
  return el ? el.innerHTML : '';
}

// Text-only (innerText-equivalent) form of the same node — used for the 5-post
// parity spot-check that mimics the Worker path (which returns article text).
function extractEntryContentText(pageHtml) {
  const doc = new JSDOM(pageHtml).window.document;
  const el = doc.querySelector('.entry-content') || doc.querySelector('article');
  if (!el) return '';
  // Approximate innerText: block elements get newlines; <del>/<s> kept (parser
  // strikes them itself when given HTML, but the text path has no markup — so
  // for a fair "text paste" we keep struck text the way rendered innerText would
  // still SHOW it; DoC struck text is visible, matching what a human copying
  // visible text would carry).
  const clone = el.cloneNode(true);
  clone.querySelectorAll('li,p,br,tr,div,h1,h2,h3,h4').forEach(n => n.append('\n'));
  return (clone.textContent || '').replace(/ /g, ' ')
    .split(/\n+/).map(s => s.replace(/[ \t\r]+/g, ' ').trim()).filter(Boolean).join('\n');
}

module.exports = {
  buildParser, extractEntryContentHTML, extractEntryContentText,
  NEEDED, REPO, CORPUS, postsDir, goldDir, manifestPath,
};
