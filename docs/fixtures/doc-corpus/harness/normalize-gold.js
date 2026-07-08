// normalize-gold.js — map a gold label (rich schema) to parser-comparable
// expectations keyed by the parser's flat DOC_FIELD_MAP keys.
//
// normalizeGold(gold) -> {
//   expected: { <parserFieldKey>: expectedValue },   // scored fields (value known)
//   presence: { <parserFieldKey>: true },            // score presence-only (free text)
//   unscorable: [ <parserFieldKey>, ... ],           // gold has no comparable value
//   meta: { tiered, points, gold_headline_bonus, gold_max_tier_bonus, ... }
// }
//
// Every mapping decision is documented inline and summarized in baseline-report.md.

// Parse a US date string in a gold `expiration` that is already ISO, else null.
function goldExp(v) {
  if (!v || typeof v !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return null; // "none stated" and prose -> not a positively-scoreable date
}

// From requirements[], find the first row of a type.
const reqOf = (g, t) => (g.requirements || []).find(r => r && r.type === t) || null;
const reqsOf = (g, t) => (g.requirements || []).filter(r => r && r.type === t);

function normalizeGold(gold) {
  const expected = {};
  const presence = {};
  const unscorable = [];
  const points = gold.bonus_total == null && /point|membership rewards|miles/i.test(JSON.stringify(gold.churn || {}) + (gold.product||'') + (gold._gold_note||'')) ||
                 (gold.bonus_total == null); // bonus_total null in this corpus == points/miles (15,25) — treated as points path
  const tiers = Array.isArray(gold.tiers) ? gold.tiers : [];
  const tiered = tiers.length > 0;

  // ---- signupBonusAmount ----------------------------------------------------
  // Parser has NO tier concept: it reads the glance headline. So we record BOTH:
  //  gold_max_tier_bonus  = the adjudicated maximum (gold.bonus_total)  [step-4 tier target]
  //  gold_headline_bonus  = what the glance box/title advertises the parser SHOULD find today
  // The PRIMARY scored expectation for signupBonusAmount is gold_max_tier_bonus
  // (the correct answer); we separately flag whether the parser hit the headline
  // instead (a TIER-BLIND miss) using gold_headline_bonus in the scorer.
  let gold_headline_bonus = null, gold_max_tier_bonus = null;
  if (gold.bonus_total == null) {
    // points/miles bonus → parser should emit bonusPointsNote, NOT signupBonusAmount
    presence['bonusPointsNote'] = true;
    unscorable.push('signupBonusAmount'); // no dollar value in gold
  } else {
    gold_max_tier_bonus = gold.bonus_total;
    // Headline the parser would see = the max tier bonus if the glance box is fresh,
    // else the (often stale) advertised figure. We approximate the headline as the
    // per-post GLANCE-BOX max where known via _headline_hint; default to bonus_total.
    gold_headline_bonus = (gold._headline_bonus != null) ? gold._headline_bonus : gold.bonus_total;
    expected['signupBonusAmount'] = gold_max_tier_bonus;
  }

  // ---- offerExpirationDate --------------------------------------------------
  const exp = goldExp(gold.expiration);
  if (exp) expected['offerExpirationDate'] = exp;
  else unscorable.push('offerExpirationDate'); // "none stated" — nothing to positively match

  // ---- ddRequired -----------------------------------------------------------
  if (typeof gold.dd_required === 'boolean') expected['ddRequired'] = gold.dd_required;
  else unscorable.push('ddRequired');

  // ---- requiredFundingAmount ------------------------------------------------
  // Parser's #f-funding is "funding amount" (a lump deposit to open/fund). Map to
  // the smallest deposit threshold that gates the LOWEST bonus tier (what a user
  // must fund to earn anything). Prefer tiers[0].threshold_min (deposit/balance
  // kinds); else the first `deposit` requirement amount. DD-only offers have no
  // funding lump → unscorable (the parser also shouldn't emit one).
  let funding = null;
  const depositTier = tiers.find(t => ['deposit','balance'].includes(t.threshold_kind) && t.threshold_min);
  if (depositTier) funding = depositTier.threshold_min;
  else { const dr = reqOf(gold, 'deposit'); if (dr && dr.amount) funding = dr.amount; }
  if (funding != null) expected['requiredFundingAmount'] = funding;
  else unscorable.push('requiredFundingAmount');

  // ---- daysAfterSignupAllowedBeforeDeposit ---------------------------------
  // "Deposit/DD window (days)". For DD offers = dd_timeframe_days. Else the
  // deposit requirement's deadline_days (deposit-by-day-N).
  let depWin = null;
  if (gold.dd_required && gold.dd_timeframe_days != null) depWin = gold.dd_timeframe_days;
  else { const dr = reqOf(gold, 'deposit'); if (dr && dr.deadline_days != null) depWin = dr.deadline_days; }
  if (depWin != null) expected['daysAfterSignupAllowedBeforeDeposit'] = depWin;
  else unscorable.push('daysAfterSignupAllowedBeforeDeposit');

  // ---- daysFundsMustRemain --------------------------------------------------
  // "Hold period (days)". From tiers[].hold_days (uniform), else a maintain_balance
  // row's implied hold. hold_days in gold is the maintenance duration.
  let hold = null;
  const holdTier = tiers.find(t => t.hold_days != null);
  if (holdTier) hold = holdTier.hold_days;
  else { const mb = reqOf(gold, 'maintain_balance'); if (mb && mb.deadline_days != null) hold = mb.deadline_days; }
  if (hold != null) expected['daysFundsMustRemain'] = hold;
  else unscorable.push('daysFundsMustRemain');

  // ---- debitCount / debitWithinDays ----------------------------------------
  const debit = reqOf(gold, 'debit_txns');
  if (debit && debit.count != null) {
    expected['debitCount'] = debit.count;
    if (debit.deadline_days != null) expected['debitWithinDays'] = debit.deadline_days;
    else unscorable.push('debitWithinDays');
  } else { unscorable.push('debitCount'); unscorable.push('debitWithinDays'); }

  // ---- monthly_fee ----------------------------------------------------------
  // Gold `monthly_fee: null` is overloaded: it means "no monthly fee" when the
  // fee_waiver says so (the glance box shows "Monthly fees: None" → parser 0), and
  // "unknown/not-stated" otherwise. Resolve via fee_waiver text: a "no monthly
  // fee(s)"/"free ... no monthly fee" waiver → expected 0 (parser rightly emits 0);
  // a genuinely-unknown fee stays unscorable.
  if (gold.monthly_fee != null) expected['monthly_fee'] = gold.monthly_fee;
  else if (/\bno\b[^.]*monthly fee|free .*no monthly fee|no monthly fees|any monthly fees|has no monthly/i.test(String(gold.fee_waiver||''))) expected['monthly_fee'] = 0;
  else unscorable.push('monthly_fee');

  // ---- fee_waiver_condition (presence only; free text) ----------------------
  if (gold.fee_waiver && String(gold.fee_waiver).trim() && !/^no monthly fee/i.test(gold.fee_waiver)) presence['fee_waiver_condition'] = true;

  // ---- early_termination_fee ------------------------------------------------
  if (gold.early_termination_fee != null) expected['early_termination_fee'] = gold.early_termination_fee;
  else unscorable.push('early_termination_fee');

  // ---- etf_window_days ------------------------------------------------------
  if (gold.etf_window_days != null) expected['etf_window_days'] = gold.etf_window_days;
  else unscorable.push('etf_window_days');

  // ---- promo_code -----------------------------------------------------------
  if (gold.promo_code != null && String(gold.promo_code).trim()) expected['promo_code'] = String(gold.promo_code).toUpperCase();
  else unscorable.push('promo_code');

  // ---- bonus posting window -------------------------------------------------
  if (gold.bonus_post_min_days != null) expected['bonus_post_min_days'] = gold.bonus_post_min_days; else unscorable.push('bonus_post_min_days');
  if (gold.bonus_post_max_days != null) expected['bonus_post_max_days'] = gold.bonus_post_max_days; else unscorable.push('bonus_post_max_days');

  // ---- churn ----------------------------------------------------------------
  const churn = gold.churn || {};
  // churnable: derived — a re-run WAIT window (wait_months) implies churnable=true;
  // a hard "limit 1 / per household / lifetime" with no window implies false. The
  // parser derives churnable only when it finds a wait window, so:
  if (churn.wait_months != null) { expected['churnable'] = true; expected['churn_wait_months'] = churn.wait_months; }
  else { unscorable.push('churn_wait_months'); /* churnable left unscorable unless language is a hard no */ unscorable.push('churnable'); }
  if (churn.anchor != null) expected['churn_anchor'] = churn.anchor; else unscorable.push('churn_anchor');
  if (churn.limit_language_verbatim) presence['churn_notes'] = true;

  // ---- spend / transactions (row-only) --------------------------------------
  const spend = reqOf(gold, 'spend'); // rare
  if (spend && spend.amount != null) expected['spendAmount'] = spend.amount;
  const txn = reqOf(gold, 'transactions');
  if (txn && txn.count != null) expected['transactionsCount'] = txn.count;

  return {
    expected, presence, unscorable,
    meta: { tiered, points, gold_headline_bonus, gold_max_tier_bonus,
            tier_count: tiers.length, availability: gold.availability_verbatim,
            gold_note: gold._gold_note || null }
  };
}

module.exports = { normalizeGold };
