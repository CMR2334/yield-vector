#!/usr/bin/env python3
"""One-time restructure of the "Bank Account SUB Tracker" Airtable base
(2026-09-26 direction doc §5c). Idempotent: every step checks current state
before acting. Reads AIRTABLE_TOKEN from ~/.config/yield-vector/env.

Stages (run in order; each safe to re-run):
  python3 airtable-migrate-2026-09-26.py rename   # tables + fields
  python3 airtable-migrate-2026-09-26.py fields   # add new fields
  python3 airtable-migrate-2026-09-26.py data     # institutions, links, backfill

The API cannot delete fields or tables — legacy formula fields are renamed with a
"(legacy)" prefix and the Actions table is left for the owner to delete in the UI.
Pre-migration snapshot: ~/.config/yield-vector/snapshots/2026-09-26-pre-migration/.
"""
import json, os, re, sys, time, urllib.request, urllib.parse

BASE = 'appsCN4cxqX0Ojwf4'
ACCOUNTS = 'tblDRVwfi3xWyi82n'      # was "Banks"
INSTITUTIONS = 'tblfgdrZj1fXXozE2'  # was "Info"
ACTIONS = 'tbl4hNd87U6NHHuPk'

ENV = os.path.expanduser('~/.config/yield-vector/env')
for line in open(ENV):
    if '=' in line and not line.startswith('#'):
        k, v = line.strip().split('=', 1); os.environ.setdefault(k, v)
TOK = os.environ['AIRTABLE_TOKEN']

def api(method, path, body=None):
    req = urllib.request.Request(f'https://api.airtable.com/v0/{path}', method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r: out = json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {path} -> {e.code} {e.read().decode()[:400]}')
    time.sleep(0.25)  # schema API is rate-limited to 5 req/s
    return out

def schema():
    return {t['id']: t for t in api('GET', f'meta/bases/{BASE}/tables')['tables']}

def fields_by_name(t): return {f['name']: f for f in t['fields']}

# ---------------------------------------------------------------- rename ----
TABLE_NAMES = {ACCOUNTS: 'Accounts', INSTITUTIONS: 'Institutions'}
RENAMES = {
  ACCOUNTS: {
    'Name': 'Account Name', 'O | C': 'Account Status', 'Open Date': 'Opened',
    'Type': 'Account Type', 'SUB Status': 'Bonus Status', 'Earned': 'Bonus Received Date',
    'SUB': 'Offered Bonus', 'ID?': 'Initial Deposit', 'DD?': 'DD Required',
    'Min Bal?': 'Minimum Balance Required', 'FB Day': 'Funding Deadline (days)',
    'FB Date': '(legacy) Funding Deadline', 'Funded Date': 'Funded', 'MB': 'Minimum Balance',
    'MB Days': 'Hold Days', 'Start - MBD': 'Hold Starts From',
    'WDB Date': '(legacy) Withdraw-Eligible', 'QT?': 'Debit Transactions Required',
    'QT Req': 'Debit Transactions (count)', 'Serv Fee': 'Service Fee',
    'No SF with:': 'Fee Waived By', 'SF Bal': 'Fee Waiver Balance', 'SF DD': 'Fee Waiver DD',
    'Email': '(legacy) Bank Email', 'Phone #': 'Bank Phone', 'Req Days Open': 'Required Days Open',
    'Rec Days Open': 'Recommended Days Open', 'OK to Close': '(legacy) OK to Close',
    'DD #1 Date': '(legacy) DD #1 Date', 'DD #1': '(legacy) DD #1',
    "Add'l Req": 'Requirements & Notes', 'Attachment(s)': 'Attachments',
    'Actions': '(legacy) Actions', 'APR': '(legacy) APR', 'DoC Page': 'DoC URL',
    'Close Account (Automation Trigger)': '(legacy) Close Trigger',
  },
  INSTITUTIONS: {'Days to Keep Open': 'Keep Open (days)', 'Pulls Chex?': 'Pulls Chex',
                 'Banks': '(legacy) Banks'},
}

def stage_rename():
    sch = schema()
    for tid, name in TABLE_NAMES.items():
        if sch[tid]['name'] != name:
            api('PATCH', f'meta/bases/{BASE}/tables/{tid}', {'name': name}); print('table ->', name)
    for tid, m in RENAMES.items():
        fb = fields_by_name(sch[tid])
        for old, new in m.items():
            if old in fb and new not in fb:
                api('PATCH', f'meta/bases/{BASE}/tables/{tid}/fields/{fb[old]["id"]}', {'name': new})
                print(f'  {old!r} -> {new!r}')
    print('rename: done')

# ---------------------------------------------------------------- fields ----
def sel(*names): return {'choices': [{'name': n} for n in names]}
CHURN_ANCHORS = ('Account opened', 'Bonus received', 'Account closed')
NEW_FIELDS = {
  INSTITUTIONS: [
    {'name': 'Churn Lookback (mo)', 'type': 'number', 'options': {'precision': 0},
     'description': 'Months after the anchor before this bank will pay a bonus again. Blank = unknown.'},
    {'name': 'Churn Anchor', 'type': 'singleSelect', 'options': sel(*CHURN_ANCHORS)},
    {'name': 'Once Per Lifetime', 'type': 'checkbox', 'options': {'icon': 'check', 'color': 'redBright'}},
    {'name': 'Churn Scope', 'type': 'singleSelect', 'options': sel('Per entity', 'Per person (SSN)', 'Per household', 'Per address')},
    {'name': 'Hard Pull', 'type': 'singleSelect', 'options': sel('No', 'Yes', 'Unknown')},
    {'name': 'ETF Window (days)', 'type': 'number', 'options': {'precision': 0},
     'description': 'Early-termination fee applies if closed before this many days.'},
    {'name': 'Notes', 'type': 'multilineText'},
  ],
  ACCOUNTS: [
    {'name': 'Institution', 'type': 'multipleRecordLinks',
     'options': {'linkedTableId': INSTITUTIONS}},
    {'name': 'Offer', 'type': 'singleLineText',
     'description': 'Which promotion this row is (e.g. "$450 Smartly Checking, Mar 2026"). Distinguishes repeat runs at the same bank.'},
    {'name': 'Product', 'type': 'singleSelect',
     'options': sel('Personal Checking', 'Business Checking', 'Savings', 'Brokerage', 'Other')},
    {'name': 'Received Bonus', 'type': 'currency', 'options': {'precision': 2, 'symbol': '$'},
     'description': 'What actually posted. Offered Bonus is the advertised amount.'},
    {'name': 'Fees Paid', 'type': 'currency', 'options': {'precision': 2, 'symbol': '$'}},
    {'name': 'Tier Chosen', 'type': 'singleLineText'},
    {'name': 'Path Chosen', 'type': 'singleSelect', 'options': sel('Direct deposit', 'Hold funds', 'Card spend', 'Combination', 'Other')},
    {'name': 'Offer Expiration', 'type': 'date', 'options': {'dateFormat': {'name': 'us'}}},
    {'name': 'YV Offer ID', 'type': 'singleLineText', 'description': 'Join key to the Yield Vector offer record.'},
    {'name': 'Chex Pulled', 'type': 'singleSelect', 'options': sel('No', 'Yes', 'Unknown'),
     'description': 'Per-offer override; Institution holds the default.'},
    {'name': 'Churn Lookback Override (mo)', 'type': 'number', 'options': {'precision': 0},
     'description': 'Only when this offer\'s terms differ from the Institution default.'},
    {'name': 'Churn Anchor Override', 'type': 'singleSelect', 'options': sel(*CHURN_ANCHORS)},
  ],
}
LOOKUPS = [  # (name, source field on Institutions)
  ('Inst Churn Lookback', 'Churn Lookback (mo)'), ('Inst Churn Anchor', 'Churn Anchor'),
  ('Inst Once Per Lifetime', 'Once Per Lifetime'),
]
FORMULAS = [
  ('Net Bonus', 'IF({Received Bonus}, {Received Bonus} - IF({Fees Paid}, {Fees Paid}, 0), BLANK())'),
  ('Next Eligible',
   "IF(ARRAYJOIN({Inst Once Per Lifetime})='1', 'Never', "
   "IF(AND(IF({Churn Lookback Override (mo)}, {Churn Lookback Override (mo)}, VALUE(ARRAYJOIN({Inst Churn Lookback}))), "
   "SWITCH(IF({Churn Anchor Override}, {Churn Anchor Override}, ARRAYJOIN({Inst Churn Anchor})), "
   "'Account closed', {Closed}, 'Bonus received', {Bonus Received Date}, {Opened})), "
   "DATETIME_FORMAT(DATEADD(SWITCH(IF({Churn Anchor Override}, {Churn Anchor Override}, ARRAYJOIN({Inst Churn Anchor})), "
   "'Account closed', {Closed}, 'Bonus received', {Bonus Received Date}, {Opened}), "
   "IF({Churn Lookback Override (mo)}, {Churn Lookback Override (mo)}, VALUE(ARRAYJOIN({Inst Churn Lookback}))), 'months'), 'M/D/YYYY'), BLANK()))"),
]

def stage_fields():
    sch = schema()
    for tid, specs in NEW_FIELDS.items():
        fb = fields_by_name(sch[tid])
        for spec in specs:
            if spec['name'] in fb: continue
            api('POST', f'meta/bases/{BASE}/tables/{tid}/fields', spec); print('  +', spec['name'])
    sch = schema(); acc = fields_by_name(sch[ACCOUNTS]); inst = fields_by_name(sch[INSTITUTIONS])
    for name, src in LOOKUPS:
        if name in acc: continue
        api('POST', f'meta/bases/{BASE}/tables/{ACCOUNTS}/fields', {'name': name, 'type': 'multipleLookupValues',
            'options': {'recordLinkFieldId': acc['Institution']['id'], 'fieldIdInLinkedTable': inst[src]['id']}})
        print('  + lookup', name)
    acc = fields_by_name(schema()[ACCOUNTS])
    for name, formula in FORMULAS:
        if name in acc: continue
        try:
            api('POST', f'meta/bases/{BASE}/tables/{ACCOUNTS}/fields', {'name': name, 'type': 'formula', 'options': {'formula': formula}})
            print('  + formula', name)
        except SystemExit as e:
            print(f'  ! formula {name} not created via API ({str(e)[:160]}); add in UI:\n    {formula}')
    print('fields: done')

# ------------------------------------------------------------------ data ----
def records(tid):
    out, off = [], None
    while True:
        q = {'pageSize': '100'}
        if off: q['offset'] = off
        d = api('GET', f'{BASE}/{tid}?{urllib.parse.urlencode(q)}'); out += d['records']; off = d.get('offset')
        if not off: return out

def patch(tid, recs):
    for i in range(0, len(recs), 10):
        api('PATCH', f'{BASE}/{tid}', {'records': recs[i:i+10], 'typecast': True})

def norm(s): return re.sub(r'[^a-z0-9]', '', (s or '').lower().replace('harris', '').replace('creditunion', ''))

def stage_data():
    accs, insts = records(ACCOUNTS), records(INSTITUTIONS)
    inst_by_norm = {norm(r['fields'].get('Name')): r['id'] for r in insts if r['fields'].get('Name')}
    # 1. one Institution per distinct bank name
    def bank_of(a): return re.split(r'\s+[-–—]\s+|\s+\(', a['fields'].get('Account Name') or '')[0].strip()
    missing = sorted({bank_of(a) for a in accs if bank_of(a) and norm(bank_of(a)) not in inst_by_norm})
    for i in range(0, len(missing), 10):
        d = api('POST', f'{BASE}/{INSTITUTIONS}', {'records': [{'fields': {'Name': n}} for n in missing[i:i+10]]})
        for r in d['records']: inst_by_norm[norm(r['fields']['Name'])] = r['id']
    print('institutions created:', missing)
    # 2. link + backfill
    upd = []
    for a in accs:
        f = a['fields']; new = {}
        iid = inst_by_norm.get(norm(bank_of(a)))
        if iid and not f.get('Institution'): new['Institution'] = [iid]
        if f.get('Account Type') == 'Personal':
            if not f.get('Entity Used'): new['Entity Used'] = 'Collin Rekowski (Ind - SSN)'
            if not f.get('Email Used'): new['Email Used'] = 'cmreko91'
        if f.get('Bonus Status') == 'Earned' and f.get('Offered Bonus') and not f.get('Received Bonus'):
            new['Received Bonus'] = f['Offered Bonus']
        if not f.get('Product'):
            n = (f.get('Account Name') or '').lower()
            new['Product'] = 'Savings' if 'saving' in n else 'Brokerage' if 'broker' in n or 'invest' in n \
                else 'Business Checking' if f.get('Account Type') == 'Business' else 'Personal Checking'
        if new: upd.append({'id': a['id'], 'fields': new})
    patch(ACCOUNTS, upd)
    print(f'accounts updated: {len(upd)}')
    print('data: done')

if __name__ == '__main__':
    {'rename': stage_rename, 'fields': stage_fields, 'data': stage_data}[sys.argv[1]]()
