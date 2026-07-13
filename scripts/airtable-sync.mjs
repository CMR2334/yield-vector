// Yield Vector -> Airtable one-way mirror.
// Runs daily via .github/workflows/airtable-sync.yml.
// Pulls app state from the sync Gist, keeps Airtable's Offers + Requirements
// tables in step with every offer that is "applied or beyond" (i.e. not a
// bare prospect). Env: AIRTABLE_TOKEN, GIST_TOKEN, GIST_ID.

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const GIST_TOKEN = process.env.GIST_TOKEN;
const GIST_ID = process.env.GIST_ID;
const GIST_FILE = 'capital-planner.json';

const BASE = 'appMLmO9xhrBBUv5A';
const OFFERS_T = 'tblxgdAyj9d8nuTsu';
const REQ_T = 'tbljUyxmrRetcI7tp';

const INCLUDE = new Set(['applied', 'approved', 'denied', 'on-track', 'met-waiting', 'earned', 'didnt-track', 'archived']);
const LEGACY = new Set(['applied', 'funded', 'completed']);

const d10 = v => (v ? String(v).slice(0, 10) : null);

function addMonths(iso, months) {
  if (!iso || !months) return null;
  const dt = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 + Number(months), +iso.slice(8, 10)));
  return isNaN(dt) ? null : dt.toISOString().slice(0, 10);
}

function churnElig(o) {
  const anchor = o.churn_anchor === 'bonus_received' ? o.bonus_received_date
    : o.churn_anchor === 'account_closed' ? o.closed_date
    : o.churn_anchor === 'account_opened' ? o.plannedSignupDate : null;
  return addMonths(d10(anchor), o.churn_wait_months);
}

function clean(obj) {
  const o = {};
  for (const k in obj) { const v = obj[k]; if (v !== undefined && v !== null && v !== '') o[k] = v; }
  return o;
}

async function at(method, path, body) {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    method,
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Airtable ${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function upsert(table, records, mergeOn) {
  for (let i = 0; i < records.length; i += 10) {
    await at('PATCH', `${BASE}/${table}`, {
      performUpsert: { fieldsToMergeOn: mergeOn }, typecast: true, records: records.slice(i, i + 10),
    });
  }
}

async function listAll(table, field) {
  const out = [];
  let offset;
  do {
    const q = new URLSearchParams({ pageSize: '100', 'fields[]': field });
    if (offset) q.set('offset', offset);
    const d = await at('GET', `${BASE}/${table}?${q}`);
    out.push(...d.records);
    offset = d.offset;
  } while (offset);
  return out;
}

async function del(table, ids) {
  for (let i = 0; i < ids.length; i += 10) {
    const q = ids.slice(i, i + 10).map(id => `records[]=${id}`).join('&');
    await at('DELETE', `${BASE}/${table}?${q}`);
  }
}

async function main() {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: { Authorization: `token ${GIST_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub gist fetch -> ${res.status}`);
  const gist = await res.json();
  let content = gist.files[GIST_FILE].content;
  if (gist.files[GIST_FILE].truncated) content = await (await fetch(gist.files[GIST_FILE].raw_url)).text();

  const offers = JSON.parse(content).offers || [];
  const mirror = offers.filter(o => (o.subStatus ? INCLUDE.has(o.subStatus) : LEGACY.has(o.status)));

  // Offers
  const offerRecs = mirror.map(o => ({ fields: clean({
    'Offer ID': o.id, Bank: o.bankName, 'Offer Name': o.offerName, 'Offer Type': o.offerType,
    'Sub Status': o.subStatus, 'Account Status': o.accountStatus,
    'Bonus $': o.signupBonusAmount, 'Required Funding $': o.requiredFundingAmount,
    'Signup Date': d10(o.plannedSignupDate), 'Bonus Received': d10(o.bonus_received_date), 'Closed Date': d10(o.closed_date),
    Churnable: o.churnable == null ? null : !!o.churnable, 'Churn Anchor': o.churn_anchor,
    'Churn Wait (mo)': o.churn_wait_months, 'Churn Eligible Date': churnElig(o),
    Entity: o.entityUsed, Email: o.emailUsed, 'Doc URL': o.docUrl, 'Last Edited': d10(o.last_edited),
    'Direct Deposits JSON': o.directDeposits && o.directDeposits.length ? JSON.stringify(o.directDeposits) : null,
  }) }));
  await upsert(OFFERS_T, offerRecs, ['Offer ID']);

  // Map Offer ID -> record id (for requirement links + pruning)
  const offerRows = await listAll(OFFERS_T, 'Offer ID');
  const recByOfferId = new Map();
  for (const r of offerRows) { const k = r.fields['Offer ID']; if (k) recByOfferId.set(k, r.id); }

  // Requirements
  const reqRecs = [];
  const wantReq = new Set();
  for (const o of mirror) {
    const orid = recByOfferId.get(o.id);
    for (const req of (o.requirements || [])) {
      const key = `${o.id}:${req.id}`;
      wantReq.add(key);
      reqRecs.push({ fields: clean({
        'Req ID': key, Requirement: req.label || req.type, Offer: orid ? [orid] : null,
        Type: req.type, Amount: req.amount, Count: req.count,
        'Deadline (days)': req.deadline_days, 'Hold (days)': req.hold_days,
        Done: req.done == null ? null : !!req.done, 'Done Date': d10(req.done_date), Notes: req.notes,
      }) });
    }
  }
  await upsert(REQ_T, reqRecs, ['Req ID']);

  // Prune anything no longer in the mirror set (offer dropped back to prospect, deleted, etc.)
  const wantOffer = new Set(mirror.map(o => o.id));
  await del(OFFERS_T, offerRows.filter(r => r.fields['Offer ID'] && !wantOffer.has(r.fields['Offer ID'])).map(r => r.id));
  const reqRows = await listAll(REQ_T, 'Req ID');
  await del(REQ_T, reqRows.filter(r => r.fields['Req ID'] && !wantReq.has(r.fields['Req ID'])).map(r => r.id));

  console.log(`Synced ${mirror.length} offers, ${reqRecs.length} requirement rows.`);
}

main().catch(e => { console.error(e); process.exit(1); });
