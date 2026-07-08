// fidelity-check.js
// Proves the jsdom-backed extraction reproduces the app's parser behavior by
// running the app's OWN 5 fixtures (docs/fixtures/doc-samples/) against the app's
// OWN embedded DOC_TEST_EXPECT map — the exact assertions testDocParser() runs
// in-browser. If all pass, the loader did not change behavior vs the real app.
const fs = require('fs');
const path = require('path');
const { buildParser, REPO } = require('./parser-loader');

const api = buildParser();
const parseDocPost = api.parseDocPost;

// The DOC_TEST_EXPECT map, copied verbatim from index.html (the ground truth the
// app asserts against). Kept in-sync manually; a drift check below re-reads the
// literal from index.html and compares key sets so this can't silently rot.
const DOC_TEST_EXPECT = {
  '01': { bankName: 'Meridian Trust Bank', signupBonusAmount: 300, offerExpirationDate: '2026-09-30', ddRequired: true, monthly_fee: 0, early_termination_fee: 25, etf_window_days: 90, promo_code: 'PREMIER300', daysAfterSignupAllowedBeforeDeposit: 60, bonus_post_max_days: 30 },
  '02': { bonusPointsNote: '@present', signupBonusAmount: '@absent', offerExpirationDate: '2026-12-31', ddRequired: false, monthly_fee: 95, early_termination_fee: 0, churn_wait_months: 12 },
  '03': { signupBonusAmount: 560, offerExpirationDate: '2026-08-31', ddRequired: true, churn_wait_months: 24, bonus_post_min_days: 45, bonus_post_max_days: 60 },
  '04': { signupBonusAmount: 400, ddRequired: true, monthly_fee: 10, early_termination_fee: 50, etf_window_days: 120, promo_code: 'RELAY400', debitCount: 5, debitWithinDays: 60, bonus_post_max_days: 20, offerExpirationDate: '2026-10-15' },
  '05': { bankName: 'Summit Brokerage', signupBonusAmount: 1000, requiredFundingAmount: 50000, ddRequired: false, offerExpirationDate: '2026-11-30', daysFundsMustRemain: 90, churnable: true, churn_wait_months: 24, churn_anchor: 'account_closed', bonus_post_min_days: 42, bonus_post_max_days: 56 },
  // step-4a fixtures. `_tiers` / `_signupBonusConfidence` are META-assertions on
  // the RESULT SHAPE (res.tiers.length, forced-low headline confidence) — mirror
  // testDocParser's underscore-key handling below.
  '06': { signupBonusAmount: 3000, ddRequired: false, requiredFundingAmount: 10000, offerExpirationDate: '2026-12-31', early_termination_fee: 0, cc_funding_note: '@present', _tiers: 4, _signupBonusConfidence: 'low', daysFundsMustRemain: 90, lockStartsFrom: 'open date', daysAfterSignupAllowedBeforeDeposit: 30, fee_waiver_condition: '@present' },
  '07': { signupBonusAmount: 250, offerExpirationDate: '2026-09-30', promo_code: 'SUMMER250', ddRequired: true, monthly_fee: 12, early_termination_fee: 30, etf_window_days: 180, daysAfterSignupAllowedBeforeDeposit: 90, cc_funding_note: '@present', churnable: true, churn_wait_months: 12 },
};
const FILES = {
  '01': '01-basic-checking.html', '02': '02-points-and-range.html',
  '03': '03-dual-bonus-updates.html', '04': '04-business-debit-promo.html',
  '05': '05-brokerage-tiers-churn.txt',
  '06': '06-tiered-ladder.html', '07': '07-delta-updates.html',
};
const DIR = path.join(REPO, 'docs/fixtures/doc-samples');

// Drift guard: confirm the literal in index.html still has the same fixture keys.
(function driftGuard() {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = html.match(/const DOC_TEST_EXPECT = \{([\s\S]*?)\n\};/);
  if (!m) { console.warn('WARN: could not locate DOC_TEST_EXPECT literal for drift guard'); return; }
  const keysInFile = [...m[1].matchAll(/^\s*'(\d\d)':/gm)].map(x => x[1]);
  const mine = Object.keys(DOC_TEST_EXPECT);
  const missing = keysInFile.filter(k => !mine.includes(k));
  if (missing.length) throw new Error('DOC_TEST_EXPECT drift: index.html has fixtures ' + missing.join(',') + ' not in fidelity-check');
})();

let pass = 0, fail = 0; const failures = [];
for (const key of Object.keys(DOC_TEST_EXPECT)) {
  const raw = fs.readFileSync(path.join(DIR, FILES[key]), 'utf8');
  let res;
  try { res = parseDocPost(raw); } catch (e) { fail++; failures.push(`[${key}] THREW ${e.message}`); continue; }
  const exp = DOC_TEST_EXPECT[key];
  for (const k of Object.keys(exp)) {
    const want = exp[k]; const got = res.fields[k];
    // Meta-assertions on result shape (mirror testDocParser): _tiers →
    // res.tiers.length; _signupBonusConfidence → the headline bonus confidence.
    if (k[0] === '_') {
      let actual;
      if (k === '_tiers') actual = Array.isArray(res.tiers) ? res.tiers.length : 0;
      else if (k === '_signupBonusConfidence') actual = res.fields.signupBonusAmount ? res.fields.signupBonusAmount.confidence : undefined;
      else { fail++; failures.push(`[${key}] unknown meta ${k}`); continue; }
      if (actual === want) pass++; else { fail++; failures.push(`[${key}] ${k}=${JSON.stringify(actual)} want ${JSON.stringify(want)}`); }
      continue;
    }
    if (want === '@present') { if (got && got.value != null && got.value !== '') pass++; else { fail++; failures.push(`[${key}] ${k} expected present`); } continue; }
    if (want === '@absent') { if (!got) pass++; else { fail++; failures.push(`[${key}] ${k} expected absent, got ${JSON.stringify(got.value)}`); } continue; }
    if (!got) { fail++; failures.push(`[${key}] ${k} MISSING want ${JSON.stringify(want)}`); continue; }
    if (got.value !== want) { fail++; failures.push(`[${key}] ${k}=${JSON.stringify(got.value)} want ${JSON.stringify(want)}`); continue; }
    pass++;
  }
}
console.log('===== FIDELITY (jsdom loader vs app DOC_TEST_EXPECT) =====');
if (failures.length) { failures.forEach(f => console.log('  X ' + f)); }
console.log(`PASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
