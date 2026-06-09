#!/usr/bin/env node
/* Build dd-methods.json from a saved copy of the DoC
   "List of methods banks count as direct deposits" page.

   Usage:  node tools/build-dd-methods.js <doc.html> <out.json>
   Refresh: curl -sA "Mozilla/5.0" \
     "https://www.doctorofcredit.com/knowledge-base/list-methods-banks-count-direct-deposits/" \
     -o /tmp/doc.html && node tools/build-dd-methods.js /tmp/doc.html dd-methods.json

   Output: { _meta:{source,bankCount}, banks:{ <slug>:{name,works:[{method,dps,note}],fails:[...]} } }
   slug = lowercased name with non-alphanumerics stripped (fuzzy bank match).
*/
const fs = require('fs');
const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('usage: build-dd-methods.js <in.html> <out.json>'); process.exit(1); }
const html = fs.readFileSync(inPath, 'utf8');

const stripTags = s => s.replace(/<[^>]+>/g, '');
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&#039;|&rsquo;|&#8216;/g, "'").replace(/&#8211;|&ndash;|&#8212;/g, '-').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const slug = s => decode(stripTags(s)).toLowerCase().replace(/[^a-z0-9]/g, '');

function mergeMethods(arr) {
  const byKey = new Map();
  for (const e of arr) {
    const k = e.method.toLowerCase();
    if (byKey.has(k)) { const x = byKey.get(k); x.dps += e.dps; if (!x.note && e.note) x.note = e.note; }
    else byKey.set(k, { ...e });
  }
  return [...byKey.values()].sort((a, b) => b.dps - a.dps);
}

function parseSection(seg) {
  // Locate the "don't code/count" marker — items in lists after it are fails.
  const failRe = /(don'?t|doesn'?t|do not|does not|will not|won'?t|not)\b[^<]{0,30}(code|count)/i;
  const fm = seg.match(failRe);
  const failIdx = fm ? seg.indexOf(fm[0]) : -1;
  const works = [], fails = [];
  // Each <li> up to the next <li>, nested <ul>, or </ul>.
  const liRe = /<li[^>]*>([\s\S]*?)(?=<li[ >]|<\/ul>|<ul[ >])/gi;
  let lm;
  while ((lm = liRe.exec(seg))) {
    const li = lm[1];
    const dps = (li.match(/<a\b/gi) || []).length;
    const method = decode(stripTags(li.split(/<a\b/i)[0])).replace(/:\s*\d.*$/, "").replace(/[:\-\s]+$/, "").trim();
    if (!method || method.length > 50) continue;
    const full = decode(stripTags(li));
    const notes = [...full.matchAll(/\(([^)]+)\)/g)].map(x => x[1].trim());
    const entry = { method, dps };
    if (notes.length) entry.note = notes.join('; ');
    if (failIdx >= 0 && lm.index > failIdx) fails.push(entry); else works.push(entry);
  }
  return { works: mergeMethods(works), fails: mergeMethods(fails) };
}

// Split into h3 sections.
const h3re = /<h3[^>]*>(?:<span[^>]*>)?(.*?)(?:<\/span>)?<\/h3>/gis;
const heads = [];
let m;
while ((m = h3re.exec(html))) heads.push({ name: decode(stripTags(m[1])), contentStart: h3re.lastIndex, start: m.index });

const banks = {};
for (let i = 0; i < heads.length; i++) {
  const name = heads[i].name;
  if (!name || name.length > 60) continue;
  const seg = html.slice(heads[i].contentStart, i + 1 < heads.length ? heads[i + 1].start : html.length);
  const { works, fails } = parseSection(seg);
  if (!works.length && !fails.length) continue;
  const sl = slug(name);
  if (!sl) continue;
  banks[sl] = { name, works, fails };
}

fs.writeFileSync(outPath, JSON.stringify({
  _meta: { source: 'https://www.doctorofcredit.com/knowledge-base/list-methods-banks-count-direct-deposits/', bankCount: Object.keys(banks).length },
  banks
}));
console.error('Parsed', Object.keys(banks).length, 'banks →', outPath, '(' + (fs.statSync(outPath).size / 1024).toFixed(0) + ' KB)');
