// score.js — score the REAL parseDocPost against the gold set over 31 posts.
// Input form: each post's .entry-content HTML (what select-all-copy carries).
// Emits per-field {correct,wrong,missed,spurious}, a confidence-calibration
// table, the HIGH-CONFIDENCE-WRONG list (the dangerous class), and a per-post
// per-field detail dump consumed by the taxonomy step. Writes score-results.json.
//
// Posts are NOT committed (copyright). Re-hydrate them first — see README
// ("How to re-hydrate the posts") — then run this from anywhere:
//   npm i --no-save jsdom          # one-time; jsdom is not a repo dependency
//   node score.js                  # reads posts from ../posts or $DOC_CORPUS_POSTS
const fs = require('fs');
const path = require('path');
const { buildParser, extractEntryContentHTML, extractEntryContentText,
        postsDir, goldDir } = require('./parser-loader');
const { normalizeGold } = require('./normalize-gold');

const POSTS = postsDir();
const GOLD = goldDir();
if (!POSTS) {
  console.error('score.js: no post corpus found. The raw DoC post bodies are not');
  console.error('committed (copyright). Re-hydrate them into ../posts/ or set');
  console.error('$DOC_CORPUS_POSTS to a folder of saved NN-slug.html pages — see README.');
  process.exit(2);
}
const api = buildParser();

const files = fs.readdirSync(POSTS).filter(f => f.endsWith('.html'));
const ids = files.map(f => f.slice(0, 2)).filter(id => id !== '11').sort();

// Pull the glance-box "Maximum bonus amount: $X" value from a post's text — this
// is what the parser SHOULD read as the headline (used to classify TIER-BLIND vs
// STALE vs correct). Returns a number or null.
function glanceHeadlineBonus(text) {
  const m = text.match(/maximum bonus amount:\s*([^\n]+)/i);
  if (!m) return null;
  // reuse the app's own bonus parser via a tiny inline call
  const v = api.docParseBonusValue(m[1]);
  return v && v.value != null ? v.value : (v && v.points != null ? { points: v.points } : null);
}

const EQ = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Which parser keys we treat as "scoreable value fields" for the matrix.
const VALUE_KEYS = ['signupBonusAmount','offerExpirationDate','ddRequired','requiredFundingAmount',
  'daysAfterSignupAllowedBeforeDeposit','daysFundsMustRemain','debitCount','debitWithinDays',
  'monthly_fee','early_termination_fee','etf_window_days','promo_code','bonus_post_min_days',
  'bonus_post_max_days','churnable','churn_wait_months','churn_anchor','spendAmount','transactionsCount'];
const PRESENCE_KEYS = ['fee_waiver_condition','churn_notes','bonusPointsNote'];

// Aggregates
const perField = {}; // key -> {correct,wrong,missed,spurious,extra}
// spurious = parser emitted a value where gold had a DIFFERENT explicit value/presence (real error)
// extra    = parser emitted a value where gold was SILENT (unscorable/null) — unverifiable, often benign
for (const k of [...VALUE_KEYS, ...PRESENCE_KEYS]) perField[k] = { correct:0, wrong:0, missed:0, spurious:0, extra:0 };
const calib = { high:{correct:0,wrong:0}, medium:{correct:0,wrong:0}, low:{correct:0,wrong:0} };
const highConfWrong = [];
const perPost = {};

for (const id of ids) {
  const f = files.find(x => x.startsWith(id + '-'));
  const html = fs.readFileSync(path.join(POSTS, f), 'utf8');
  const entryHtml = extractEntryContentHTML(html);
  const text = extractEntryContentText(html);
  const gold = JSON.parse(fs.readFileSync(path.join(GOLD, `${id}.json`), 'utf8'));
  const norm = normalizeGold(gold);
  const headline = glanceHeadlineBonus(text);
  norm.meta.glance_headline_bonus = headline;

  let res;
  try { res = api.parseDocPost(entryHtml); } catch (e) { perPost[id] = { error: e.message }; continue; }
  const fields = res.fields || {};

  const detail = {}; // key -> {status, gold, got, conf, note, snippet}
  // Union of keys to consider: everything gold expects + everything parser produced (value keys).
  const goldKeys = new Set([...Object.keys(norm.expected), ...Object.keys(norm.presence)]);
  const gotKeys = new Set(Object.keys(fields));
  const consider = new Set([...VALUE_KEYS, ...PRESENCE_KEYS].filter(k => goldKeys.has(k) || gotKeys.has(k)));

  for (const key of consider) {
    const parserF = fields[key];
    const got = parserF ? parserF.value : undefined;
    const conf = parserF ? parserF.confidence : null;
    const snip = parserF ? parserF.snippet : '';
    const isPresence = PRESENCE_KEYS.includes(key);
    const goldHasValue = key in norm.expected;
    const goldPresence = key in norm.presence;
    const goldUnscorable = norm.unscorable.includes(key) && !goldHasValue && !goldPresence;

    let status;
    if (isPresence || goldPresence) {
      // presence scoring
      if (goldPresence) { status = parserF ? 'correct' : 'missed'; }
      else { status = parserF ? 'spurious' : 'na'; } // parser produced a presence field gold didn't ask for
    } else if (goldHasValue) {
      if (!parserF) status = 'missed';
      else if (EQ(got, norm.expected[key])) status = 'correct';
      else status = 'wrong';
    } else {
      // gold has no value here (unscorable/null). Parser producing one = EXTRA
      // (unverifiable) — e.g. ETF/fee 0 read off a "None" box the labeler left null.
      status = parserF ? 'extra' : 'na';
    }

    if (status !== 'na') perField[key][status]++;
    // calibration only on value fields with a definite correct/wrong
    if (!isPresence && !goldPresence && goldHasValue && parserF) {
      const bucket = conf === 'high' ? 'high' : conf === 'medium' ? 'medium' : 'low';
      calib[bucket][status === 'correct' ? 'correct' : 'wrong']++;
      if (status === 'wrong' && bucket === 'high') {
        highConfWrong.push({ id, key, gold: norm.expected[key], got, snippet: snip,
          headline_bonus: (key==='signupBonusAmount'? headline : undefined) });
      }
    }

    detail[key] = { status, gold: goldHasValue ? norm.expected[key] : (goldPresence ? '@present' : (goldUnscorable ? '@unscorable' : null)),
                    got: got === undefined ? null : got, conf, note: parserF && parserF.note ? parserF.note : undefined,
                    snippet: snip };
  }
  perPost[id] = { file: f, meta: norm.meta, unscorable: norm.unscorable, detail,
                  unparsed: res.unparsed || [] };
}

// Totals
let C=0,W=0,M=0,S=0,X=0;
for (const k of VALUE_KEYS) { C+=perField[k].correct; W+=perField[k].wrong; M+=perField[k].missed; S+=perField[k].spurious; X+=perField[k].extra; }
let pC=0,pM=0,pS=0,pX=0;
for (const k of PRESENCE_KEYS) { pC+=perField[k].correct; pM+=perField[k].missed; pS+=perField[k].spurious; pX+=perField[k].extra; }

const out = {
  posts_scored: ids.length,
  value_field_totals: { correct:C, wrong:W, missed:M, spurious:S, extra:X,
    scored_present: C+W, field_accuracy_present: +(100*C/(C+W)||0).toFixed(1),
    recall_of_known: +(100*C/(C+W+M)||0).toFixed(1) },
  presence_totals: { correct:pC, missed:pM, spurious:pS, extra:pX },
  calibration: {
    high:   { ...calib.high,   acc: +(100*calib.high.correct/((calib.high.correct+calib.high.wrong)||1)).toFixed(1) },
    medium: { ...calib.medium, acc: +(100*calib.medium.correct/((calib.medium.correct+calib.medium.wrong)||1)).toFixed(1) },
    low:    { ...calib.low,    acc: +(100*calib.low.correct/((calib.low.correct+calib.low.wrong)||1)).toFixed(1) },
  },
  high_conf_wrong_count: highConfWrong.length,
  high_conf_wrong: highConfWrong,
  perField, perPost,
};
fs.writeFileSync(path.join(__dirname, 'score-results.json'), JSON.stringify(out, null, 2));

// Console summary
console.log('===== SCORE (real parseDocPost, entry-content HTML input) =====');
console.log('Posts scored:', ids.length);
console.log('VALUE fields: correct', C, ' wrong', W, ' missed', M, ' spurious', S, ' extra(unverif)', X);
console.log('  accuracy on fields the parser filled vs known gold (C/(C+W)):', out.value_field_totals.field_accuracy_present + '%');
console.log('  recall of known-gold values (C/(C+W+M)):', out.value_field_totals.recall_of_known + '%');
console.log('PRESENCE fields: correct', pC, ' missed', pM, ' extra', pX);
console.log('Calibration acc — high', out.calibration.high.acc+'% ('+out.calibration.high.correct+'/'+(out.calibration.high.correct+out.calibration.high.wrong)+')',
            ' med', out.calibration.medium.acc+'% ('+out.calibration.medium.correct+'/'+(out.calibration.medium.correct+out.calibration.medium.wrong)+')',
            ' low', out.calibration.low.acc+'% ('+out.calibration.low.correct+'/'+(out.calibration.low.correct+out.calibration.low.wrong)+')');
console.log('*** HIGH-CONFIDENCE WRONG:', highConfWrong.length, '***');
for (const h of highConfWrong) console.log('   ['+h.id+'] '+h.key+': got '+JSON.stringify(h.got)+' want '+JSON.stringify(h.gold)+ (h.headline_bonus!=null?'  (glance headline='+JSON.stringify(h.headline_bonus)+')':''));
console.log('\nPer-field matrix (C=correct W=wrong M=missed S=spurious[vs explicit gold] X=extra[gold silent]):');
for (const k of VALUE_KEYS) { const p=perField[k]; if(p.correct+p.wrong+p.missed+p.spurious+p.extra>0) console.log('  '+k.padEnd(38), 'C',p.correct,'W',p.wrong,'M',p.missed,'S',p.spurious,'X',p.extra); }
console.log('  --- presence ---');
for (const k of PRESENCE_KEYS) { const p=perField[k]; if(p.correct+p.missed+p.extra>0) console.log('  '+k.padEnd(38), 'C',p.correct,'M',p.missed,'X',p.extra); }
