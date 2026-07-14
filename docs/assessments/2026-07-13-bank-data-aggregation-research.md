# Bank-data aggregation for live balances — research (2026-07-13)

Owner question: free/cheap + secure way to pull bank & CC balances, payment due
dates, and payment amounts into Yield Vector for real-time available capital.
Research by web-verified agent pass, 2026-07-13. Status: PARKED — owner decided
not to implement yet; see BACKLOG.md "Integrations — live bank data".

## Comparison

| | SimpleFIN Bridge ($15/yr) | Teller (free ×100) | Plaid (free Trial) |
|---|---|---|---|
| Balances (bank + CC) | ✅ ~daily refresh | ✅ live | ✅ |
| Transactions | ✅ ~90-day window | ✅ | ✅ |
| CC due date / min payment | ❌ not in protocol | ❌ no liabilities API | ✅ ONLY option (Liabilities) |
| Browser-direct from GitHub Pages | ✅ CORS verified empirically (reflected Origin, preflight 200) | ❌ mTLS mandatory → Worker | ❌ client secret → Worker |
| Security model | one-time token → permanent read-only access URL (Basic Auth); creds go to MX, not SimpleFIN | direct bank connections | OAuth via Link |
| US coverage | ~16k institutions (MX underneath) | ~7k, US-only | broad |
| Churning fit | fine; 24 req/day/token | fine | ⚠️ 10 Production Items LIFETIME on 2026 Trial — deleting does not free a slot |

Key facts:
- SimpleFIN: $1.50/mo or $15/yr; protocol exposes balance/available-balance/
  transactions only — zero liabilities fields. Proven by Actual Budget's
  official bank-sync integration + Home Assistant integration. Access URL is
  the same secret shape as the existing Gist token (localStorage-only) —
  fits zero-infra/zero-secret exactly; NO Worker needed (CORS verified).
- Teller: free 100 live connections, but mTLS client certs are required on
  every real-data call — browsers can't attach client certs, so the Cloudflare
  Worker (outbound mTLS binding) would mediate everything. Still no due dates.
  Strictly worse than SimpleFIN here except on price.
- Plaid: post-2026 free Trial = 10 lifetime Production Items (hostile to churn
  velocity). Pay-as-you-go Liabilities ≈ $0.20/account/mo (≈$1.60/mo for 8
  cards). Liabilities = next due date, minimum payment, statement balance/date,
  APRs, limit — refreshed ~daily; per-institution gaps (NO_LIABILITY_ACCOUNTS
  happens; some fields issuer-specific; OAuth issuers need the scope granted in
  Link). Backend (Worker) mandatory for token exchange.
- Rejected: Lunch Money (Plaid piggyback, no due dates, extra SaaS sub), YNAB
  API (~$109/yr, no due dates), Salt Edge (EU-centric, approval-gated), MX/
  Akoya/Finicity direct (enterprise-gated), consumer FDX/issuer OAuth (no
  individual access), self-hosted OSS (all ride the same aggregators).

## Recommendation (parked)

SimpleFIN Bridge for balances + transactions, browser-direct, token in
localStorage. Due dates/minimum payments: infer from SimpleFIN transaction
history (recurring payment + statement-cycle detection) with manual entry
fallback; layer Plaid Liabilities behind the dormant Cloudflare Worker later
ONLY if inference proves insufficient — mind the 10-item lifetime cap.

Owner prerequisite when picked up: subscribe at bridge.simplefin.org, claim the
access URL, paste it into a new Settings field (never the repo).
