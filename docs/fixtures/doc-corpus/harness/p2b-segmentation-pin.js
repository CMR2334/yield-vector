// PINNED unit assertion: the "Offer at a glance" block must land in the UNDATED
// base segment, never inside a preceding update's dated segment. Guards the P2b
// segmentation fix (glance headings resume the undated base). Asserts on (a) a
// synthetic updates-at-top post (always runs) and (b) the real BofA id-01 post
// when a re-hydrated corpus is available (copyright: posts are not committed).
const fs=require('fs'),path=require('path');
const {buildParser,extractEntryContentHTML,postsDir}=require('./parser-loader');
// Since the P1 module split, docNormalizeInput + docDateSegments are sourced from
// the parser module via buildParser (was: brace-matched out of index.html).
const api=buildParser();
const docNormalizeInput=api.docNormalizeInput, docDateSegments=api.docDateSegments;
const glanceRe=/offer at a glance|maximum bonus amount/i;
let fail=0;
function assertGlanceInBase(label, text){
  const segs=docDateSegments(text);
  const inBase=glanceRe.test(segs.base.text);
  const inDated=segs.newestFirst.some(s=>glanceRe.test(s.text));
  const ok=inBase && !inDated;
  console.log(`  [${ok?'PASS':'FAIL'}] ${label}: glanceInBase=${inBase} glanceInDated=${inDated}`);
  if(!ok)fail++;
}
// (a) synthetic: two updates then glance then body (always runs)
const syn=`Update 5/20/2026: bonus lowered to $250 (was $350).
Update 2/2/2026: extended until 7/7/2026.
Offer at a glance
Maximum bonus amount: $350
Expiration date: 12/31/2026
Open an account and receive your bonus within 60 days.`;
assertGlanceInBase('synthetic updates-then-glance', syn);
// (b) real BofA id-01 — only if a re-hydrated corpus is present
const POSTS=postsDir();
if(POSTS){
  const bofa=fs.readdirSync(POSTS).find(f=>f.startsWith('01-'));
  if(bofa) assertGlanceInBase('BofA id-01 (updates-at-top, real)', docNormalizeInput(extractEntryContentHTML(fs.readFileSync(path.join(POSTS,bofa),'utf8'))).text);
  else console.log('  [skip] BofA id-01 post not found in corpus dir');
} else {
  console.log('  [skip] real BofA id-01 (posts not committed — re-hydrate to include; see README)');
}
console.log(fail?'P2B-SEG PIN: FAIL':'P2B-SEG PIN: PASS');
process.exit(fail?1:0);
