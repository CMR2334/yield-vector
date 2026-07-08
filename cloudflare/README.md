# DoC import Worker (optional, Phase 7 v2)

This directory holds `doc-import-worker.js` — a single-file Cloudflare Worker
that powers the **optional** "paste a URL" mode of Yield Vector's Doctor of
Credit import. It is a **gated scaffold**: the app behaves identically to the
paste-only importer until you deploy this Worker and paste its URL into
Settings. Nothing here runs, costs money, or sends network traffic unless you
opt in.

## Why it exists

`doctorofcredit.com` sends no CORS headers, so the browser can't fetch a post
directly. This Worker fetches the page **server-side**, does a light readability
pass to pull the article body, and — only for the ~5 genuinely ambiguous prose
fields (fee-waiver conditions, churn/eligibility nuances, safe-close and
bonus-posting language) — asks the Anthropic API to extract them. Every
LLM-extracted field must come back with a **verbatim quote** from the page; the
Worker (and again the app) reject any field whose quote isn't found on the page,
so a fabricated value is caught before you see it.

The deterministic glance-list parser still does all the high-confidence fields
in the browser. The LLM tier is additive and fails soft: if the key is missing
or Anthropic errors, the Worker returns the fetched article text with
`llm: null` and the app's existing parser proceeds exactly as in paste mode.

## Deploy

You need a (free) Cloudflare account and an Anthropic API key.

### Option A — Dashboard (no CLI)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Create Worker**.
2. Name it (e.g. `yieldvector-doc-import`) and **Deploy** the starter.
3. **Edit code** → replace the entire contents with `doc-import-worker.js` from
   this folder → **Deploy**.
4. Set the variables and secret (see **Configuration** below) under the Worker's
   **Settings → Variables and Secrets**.
5. Copy the Worker URL (e.g. `https://yieldvector-doc-import.<you>.workers.dev`).

### Option B — Wrangler CLI

```sh
cd cloudflare
# one-time: npm i -g wrangler   (or use: npx wrangler ...)
npx wrangler deploy doc-import-worker.js --name yieldvector-doc-import
npx wrangler secret put ANTHROPIC_API_KEY        # paste your key when prompted
npx wrangler secret put WORKER_SECRET            # recommended — see Security notes
# set vars (either in the dashboard, or via a wrangler.toml [vars] block):
#   ALLOWED_ORIGIN = "https://cmr2334.github.io"
#   ANTHROPIC_MODEL = "claude-sonnet-5"   # optional
```

`WORKER_SECRET` is optional but recommended (CORS alone does not stop non-browser
callers — see Security notes). If you set it, paste the same value into
Yield Vector → Settings → **Worker secret** so the app sends it.

There is intentionally no `wrangler.toml` committed here (it would be the place
config lives, but keeping the Worker a single portable file is simpler for a
personal deploy). If you prefer one, add it locally — do **not** put the API key
in it; the key must be a secret, never a plaintext var or a repo file.

> **Deploy-drift gotcha (hit live 2026-07-08):** when a local `wrangler.jsonc`/
> `wrangler.toml` exists, `npx wrangler deploy` treats it as the source of truth
> and **overwrites the Worker's remote config — dashboard-set *variables* are
> dropped** unless mirrored in the local file's `"vars"` block (secrets are NOT
> affected; only vars). Because `ALLOWED_ORIGIN` fails closed, a deploy that
> drops it silently breaks every URL import with 403s. The gitignored
> `wrangler.jsonc` on the deploy machine therefore pins
> `"vars": { "ALLOWED_ORIGIN": "https://cmr2334.github.io" }` — keep it that
> way, and mirror any future dashboard-set var into it before deploying.

## Configuration

| Name | Kind | Required | Value |
|------|------|----------|-------|
| `ANTHROPIC_API_KEY` | **Secret** | for the LLM tier | Your Anthropic API key. Omit and the Worker still fetches pages; it just returns `llm: null`. |
| `ALLOWED_ORIGIN` | Variable | yes | The exact origin allowed to call the Worker. For the live app: `https://cmr2334.github.io`. Requests from any other **browser** origin get **403**. |
| `WORKER_SECRET` | **Secret** | recommended | A random shared secret. When set, every request must carry an `X-YV-Key` header equal to it or it's rejected **403** (checked before any page fetch or LLM call, so a bad/absent key burns no cost). When unset, the Worker is CORS-only (personal-tool default). Paste the same value into the app's **Worker secret** field. |
| `ANTHROPIC_MODEL` | Variable | no | Model id. Defaults to `claude-sonnet-5`. |

After deploy, in Yield Vector: **Settings → Cloud sync → "DoC import Worker
URL"** → paste the Worker URL → the field validates it's `https://` on save.
If you set `WORKER_SECRET`, also paste it into the **Worker secret** field just
below (stored locally per device, never synced, sent as `X-YV-Key`). A new
**Fetch from URL** control then appears inside an offer's *Import from Doctor of
Credit* panel. Leave the URL field empty to keep the app in paste-only mode (no
fetch UI renders at all).

## Security notes

- **The API key lives only in the Worker's environment** (a Cloudflare secret).
  It is never sent to the browser, never in a response body, and never in this
  repo. The app calls the Worker; the Worker calls Anthropic.
- **Origin-locked CORS — but CORS only gates browsers.** The Worker only returns
  an `Access-Control-Allow-Origin` for `ALLOWED_ORIGIN`, handles the `OPTIONS`
  preflight, and 403s any other browser origin; it fails **closed** (unset
  `ALLOWED_ORIGIN` → all browser origins refused). **A non-browser caller (curl,
  a script) sends no `Origin` and is not stopped by CORS at all.** To actually
  lock out non-browser callers — so a leaked Worker URL can't be used to burn
  your Anthropic credit — set **`WORKER_SECRET`**; without it the URL alone is
  the only thing standing between a leak and unbounded LLM cost.
- **DoC-only allowlist, redirects included.** The Worker only fetches
  `https://doctorofcredit.com` or `https://www.doctorofcredit.com` (exact host
  match — no subdomains, no `http`); any other URL is rejected with 400.
  Redirects are followed **manually** and each hop's destination is re-validated
  against the same allowlist (max 3 hops), so an open redirector *on* DoC can't
  bounce the fetch to an arbitrary host. **With this redirect re-validation in
  place**, the Worker can't be used as an open proxy / SSRF pivot. (A `redirect:
  'follow'` without per-hop re-validation would reopen that hole — don't change
  it back.)
- **Bounded + private.** 10s fetch timeout (shared across the redirect chain),
  ~1.5 MB body cap, 20s LLM timeout. No logging of fetched content, no
  persistence, no other endpoints.
- **Rate limiting (optional hardening).** Cloudflare's native
  [Rate Limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
  can cap requests per IP on the Worker route as belt-and-suspenders against
  cost-burn even if the URL and secret both leak; not required for a personal
  deploy, but a cheap add if you want it.
- **Cost.** Roughly **~$0.01 per import** at the default model (a few KB of
  fixed-schema extraction) — under ~$1/month at typical volume. You can drop to
  a cheaper model via `ANTHROPIC_MODEL`.

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Fetch fails in the app; console shows a CORS error | `ALLOWED_ORIGIN` doesn't match the page's origin. It must be the exact scheme+host the app is served from (`https://cmr2334.github.io`), no trailing slash, no path. |
| Worker returns **403 "origin not allowed"** | The request's `Origin` isn't the configured `ALLOWED_ORIGIN`. |
| Worker returns **403 "unauthorized"** | `WORKER_SECRET` is set on the Worker but the app isn't sending a matching `X-YV-Key` — paste the same secret into Settings → **Worker secret** (or clear `WORKER_SECRET` on the Worker to run CORS-only). |
| Worker returns **400 "url host not allowed"** | The URL isn't a Doctor of Credit `https` URL. Only DoC is fetchable by design. |
| Worker returns **400 "redirect off allowlist" / "too many redirects"** | The DoC URL redirected to a non-DoC host (or chained >3 hops). Expected protection — use the post's canonical URL. |
| Fetch works but no AI-suggested fields appear | Either `ANTHROPIC_API_KEY` isn't set (Worker returns `llm: null`, deterministic fields still fill), or every AI field failed the verbatim-quote tripwire (the app shows an "N AI suggestions failed verification" note). Both are safe — paste-parsed fields are unaffected. |
| **502 "source fetch timed out / failed"** | DoC was slow or unreachable from Cloudflare. Retry, or paste the post text instead — the paste path always works. |
| Everything 403s right after deploy | You forgot to set `ALLOWED_ORIGIN`. The Worker fails closed with no origin configured. |

The paste-only importer never depends on this Worker: any Worker failure surfaces
as a muted inline message ("Fetch failed — paste the post text instead") and the
manual paste path is always available.

## Changelog

- **2026.07.08e** — Response now includes a **`title`** field (from `<title>` /
  `og:title` / `<h1>`, stripped of the " - Doctor of Credit" site suffix). The
  post title carries the bank + offer name, which lives OUTSIDE `entry-content`,
  so the article body alone never yielded them. The app uses `title` to fill the
  bank/offer name; **an old deployment (no `title`) still works** — the app falls
  back to a URL-slug pseudo-title at low confidence. **Redeploy this Worker** to
  get the higher-quality title fill (Deploy steps above; the field is additive
  and backward-compatible, so nothing breaks if you don't).
