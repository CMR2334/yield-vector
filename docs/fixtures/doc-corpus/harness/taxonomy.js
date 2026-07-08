// taxonomy.js — classify every wrong/missed value-field into the step-C buckets.
// Categories: TIER-BLIND, STALE, SYNONYM/LABEL-GAP, UNIT/FORMAT, STRUCTURE, OTHER.
// Rules are conservative and driven by the parser snippet + gold/headline compare.
const fs = require('fs');
const R = require('./score-results.json');

const CATS = ['TIER-BLIND','STALE','SYNONYM/LABEL-GAP','UNIT/FORMAT','STRUCTURE','OTHER'];
const buckets = {}; for (const c of CATS) buckets[c] = [];

const snip = s => (s||'').replace(/\s+/g,' ').trim().slice(0,120);

for (const [id, p] of Object.entries(R.perPost)) {
  if (!p.detail) continue;
  const meta = p.meta || {};
  for (const [key, d] of Object.entries(p.detail)) {
    if (d.status !== 'wrong' && d.status !== 'missed') continue;
    const rec = { id, key, status: d.status, got: d.got, gold: d.gold, conf: d.conf, snippet: snip(d.snippet), note: d.note };
    let cat = 'OTHER';

    if (key === 'signupBonusAmount') {
      const hb = meta.glance_headline_bonus;
      const hbNum = (hb && typeof hb === 'object') ? null : hb;
      if (d.got === hbNum && d.got !== d.gold) cat = 'STALE';               // took the (now-stale) glance headline
      else if (meta.tiered && (d.got === 20000 || d.got > d.gold*3)) cat = 'TIER-BLIND'; // grabbed a threshold/among-tiers number
      else if (typeof d.got === 'number' && d.got > 1900 && d.got < 2100) cat = 'UNIT/FORMAT'; // grabbed a YEAR as $
      else if (d.note && /range|combined/i.test(d.note)) cat = 'TIER-BLIND'; // range/combined high-end = a threshold, not the bonus
      else cat = 'STALE';                                                    // otherwise a superseded-value read from prose
    } else if (key === 'requiredFundingAmount') {
      if (/credit card funding/i.test(d.snippet||'')) cat = 'SYNONYM/LABEL-GAP'; // "Credit card funding" row mis-claimed by ['funding']
      else if (d.status === 'missed') cat = 'STRUCTURE';                     // no glance funding row; body req not surfaced
      else cat = 'STRUCTURE';
    } else if (key === 'offerExpirationDate') {
      cat = 'STALE';                                                        // parser took a struck/old date; update supersedes
    } else if (key === 'monthly_fee') {
      cat = (d.got === 0 && d.gold > 0) ? 'TIER-BLIND' : 'STALE';           // read base/"None-for-12mo" fee, gold = tier fee
    } else if (key === 'bonus_post_min_days' || key === 'bonus_post_max_days') {
      if (d.status === 'missed') cat = 'STRUCTURE';                          // window phrased in prose the scan didn't catch
      else cat = 'UNIT/FORMAT';                                             // hold+processing composition / weeks
    } else if (key === 'churn_anchor') {
      cat = 'SYNONYM/LABEL-GAP';                                            // heuristic anchor guess vs the limit language
    } else if (key === 'daysAfterSignupAllowedBeforeDeposit' || key === 'daysFundsMustRemain') {
      cat = d.status === 'missed' ? 'STRUCTURE' : 'UNIT/FORMAT';
    } else if (key === 'debitCount' || key === 'debitWithinDays' || key === 'transactionsCount') {
      cat = 'STRUCTURE';                                                    // count lives in prose the scan missed
    } else if (key === 'churn_wait_months' || key === 'churnable') {
      cat = d.status === 'missed' ? 'STRUCTURE' : 'SYNONYM/LABEL-GAP';
    } else if (key === 'promo_code') {
      cat = 'STALE';
    } else if (key === 'ddRequired') {
      // A glance row that SAYS "Yes" but parses false = a negation-guard bug
      // ("no minimum" trips !/\bno\b/); a missing row = STRUCTURE.
      if (d.status === 'wrong' && /required:\s*yes/i.test(d.snippet||'')) cat = 'SYNONYM/LABEL-GAP';
      else cat = 'STRUCTURE';
    }
    buckets[cat].push(rec);
  }
}

const summary = {};
for (const c of CATS) summary[c] = buckets[c].length;
const total = Object.values(summary).reduce((a,b)=>a+b,0);
console.log('===== MISS TAXONOMY =====  (total wrong+missed value cells:', total, ')');
for (const c of CATS) {
  console.log(`\n${c}: ${buckets[c].length}`);
  for (const r of buckets[c]) console.log(`  [${r.id}] ${r.key} (${r.status}, ${r.conf}): got ${JSON.stringify(r.got)} want ${JSON.stringify(r.gold)}  «${r.snippet}»`);
}
fs.writeFileSync(__dirname + '/taxonomy-results.json', JSON.stringify({ summary, total, buckets }, null, 2));
