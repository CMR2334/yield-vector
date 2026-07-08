// fetch-posts.js — POLITELY re-hydrate the DoC post corpus for full re-scoring.
//
// The raw post BODIES are deliberately NOT committed to this repo (copyright —
// only labels/facts/URLs are). To reproduce the accuracy numbers in
// ../verification-log.md you must re-download the posts locally first. This
// script reads ../manifest.json and saves each post's page HTML to ../posts/
// as `NN-slug.html` (the filename shape score.js/parity-check.js expect).
//
// It is intentionally gentle: one request at a time, a real browser UA, a short
// delay between requests, and it SKIPS files already on disk (resumable). If DoC
// blocks automated fetches, save the pages by hand instead ("Save Page As →
// Web Page, HTML only") into ../posts/ using the same NN-slug.html names.
//
//   node fetch-posts.js            # fetch all missing posts into ../posts/
//   DOC_CORPUS_POSTS=/some/dir node fetch-posts.js   # fetch into another dir
//
// Zero dependencies — uses Node's built-in fetch (Node 18+).

const fs = require('fs');
const path = require('path');

const CORPUS = path.resolve(__dirname, '..');
const MANIFEST = path.join(CORPUS, 'manifest.json');
const OUT = process.env.DOC_CORPUS_POSTS || path.join(CORPUS, 'posts');
const DELAY_MS = Number(process.env.FETCH_DELAY_MS || 4000); // be polite
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// slug from a DoC url: last non-empty path segment.
function slugOf(url) {
  const parts = url.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || 'post';
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function main() {
  if (typeof fetch !== 'function') {
    console.error('fetch-posts: this Node has no global fetch (need Node 18+). ' +
      'Upgrade Node, or save the pages by hand into ' + OUT + '.');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });

  let fetched = 0, skipped = 0, failed = 0;
  for (const row of manifest) {
    const id = String(row.id).padStart(2, '0');
    const dest = path.join(OUT, `${id}-${slugOf(row.url)}.html`);
    if (fs.existsSync(dest)) { skipped++; continue; }
    process.stdout.write(`[${id}] ${row.url} … `);
    try {
      const res = await fetch(row.url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
      if (!res.ok) { console.log('HTTP ' + res.status); failed++; }
      else {
        const html = await res.text();
        fs.writeFileSync(dest, html);
        console.log('saved (' + html.length + ' bytes)');
        fetched++;
      }
    } catch (e) { console.log('ERROR ' + e.message); failed++; }
    await sleep(DELAY_MS);
  }
  console.log(`\nDone. fetched=${fetched} skipped(existing)=${skipped} failed=${failed}`);
  console.log('Posts dir:', OUT);
  if (failed) console.log('Any failures: save those pages manually (Save Page As → HTML only) with the NN-slug.html name.');
})();
