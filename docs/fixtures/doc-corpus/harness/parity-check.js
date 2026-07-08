// parity-check.js — compare HTML-input vs TEXT-input parses on 5 posts (the
// Cloudflare Worker path returns article TEXT, so we confirm the parser yields
// equivalent fields on a text-only paste). Reports per-field agreement.
//
// Posts are NOT committed (copyright) — re-hydrate first (see README).
const fs = require('fs');
const path = require('path');
const { buildParser, extractEntryContentHTML, extractEntryContentText, postsDir } = require('./parser-loader');
const POSTS = postsDir();
if (!POSTS) {
  console.error('parity-check.js: no post corpus found — re-hydrate posts into ../posts/');
  console.error('or set $DOC_CORPUS_POSTS (see README).');
  process.exit(2);
}
const api = buildParser();
const files = fs.readdirSync(POSTS).filter(f => f.endsWith('.html'));
const SAMPLE = ['01', '04', '16', '21', '27']; // a tiered, a biz, the messy Huntington, Citi, SoFi
const VALUE_KEYS = ['signupBonusAmount','offerExpirationDate','ddRequired','requiredFundingAmount',
  'daysAfterSignupAllowedBeforeDeposit','daysFundsMustRemain','debitCount','debitWithinDays','monthly_fee',
  'early_termination_fee','etf_window_days','promo_code','bonus_post_min_days','bonus_post_max_days',
  'churnable','churn_wait_months','churn_anchor','spendAmount','transactionsCount','bonusPointsNote','fee_waiver_condition','churn_notes'];

let totKeys = 0, agree = 0; const diffs = [];
for (const id of SAMPLE) {
  const f = files.find(x => x.startsWith(id + '-'));
  const html = fs.readFileSync(path.join(POSTS, f), 'utf8');
  const rHtml = api.parseDocPost(extractEntryContentHTML(html)).fields;
  const rText = api.parseDocPost(extractEntryContentText(html)).fields;
  for (const k of VALUE_KEYS) {
    const a = rHtml[k] ? rHtml[k].value : undefined;
    const b = rText[k] ? rText[k].value : undefined;
    if (a === undefined && b === undefined) continue;
    totKeys++;
    if (JSON.stringify(a) === JSON.stringify(b)) agree++;
    else diffs.push({ id, key: k, html: a === undefined ? '(none)' : a, text: b === undefined ? '(none)' : b });
  }
}
console.log('===== HTML-vs-TEXT parity (5 posts) =====');
console.log('Fields present in either form:', totKeys, ' agree:', agree, ' =', (100*agree/totKeys).toFixed(1) + '%');
if (diffs.length) { console.log('Divergences:'); diffs.forEach(d => console.log(`  [${d.id}] ${d.key}: html=${JSON.stringify(d.html)} text=${JSON.stringify(d.text)}`)); }
else console.log('No divergences — text paste parses identically.');
fs.writeFileSync(path.join(__dirname, 'parity-results.json'), JSON.stringify({ totKeys, agree, pct:+(100*agree/totKeys).toFixed(1), diffs }, null, 2));
