# TradeVision — Home Server Deployment Guide (dina-server, 192.168.1.18)

Same blueprint as Vamsha: Docker Compose app, GitHub Actions CI on every push,
and a **self-hosted runner on the server** that auto-deploys every push to
`main` — no ports or router changes needed (the runner polls GitHub outbound).

Runs alongside SplitSmart (3000), Uptime Kuma (3001), Vamsha (3002):

| Piece | Where |
|---|---|
| Frontend (nginx, proxies `/api`) | host port **3003** |
| Backend (FastAPI) | host port **8000** |
| Database (libsql/sqld) | internal only, data in `~/projects/Trading/libsql-data/` |
| App directory on server | `~/projects/Trading` |
| CI (cloud build checks) | `.github/workflows/ci.yml` |
| CD (self-hosted deploy) | `.github/workflows/deploy.yml` |
| Deploy script (idempotent) | `deploy/deploy-server.sh` |
| Smoke tests | `deploy/smoke-test.sh` |
| One-time server setup | `deploy/setup-server.sh` |
| Optional public access | `deploy/nginx-trading.conf` |

## 1. One-time server setup

SSH into the server and run:

```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/chaoscoder-rgb/trading.git Trading
cd Trading
export GH_PAT='<github token with repo access>'   # used once to register the runner; not stored
bash deploy/setup-server.sh
```

This installs Docker + rsync if missing and registers a **second** Actions
runner (`trading-runner`, service in `~/actions-runner-trading`) — runners are
per-repo, so the Vamsha runner can't be reused. Verify it shows **Idle** at
GitHub → trading repo → Settings → Actions → Runners.

## 2. First deploy

Either push anything to `main`, or GitHub → Actions → **Deploy** → *Run
workflow*. The workflow rsyncs the checkout into `~/projects/Trading`
(preserving `.env`, `libsql-data/`) and runs `deploy/deploy-server.sh`, which
builds the three containers, waits for health, and runs the smoke tests.
A red ❌ on the workflow means the deploy or a smoke test failed — logs are in
the workflow run.

You can also always deploy manually on the server:

```bash
cd ~/projects/Trading && bash deploy/deploy-server.sh
```

## 3. API keys (optional but recommended)

First deploy creates a template `backend/.env` on the server. Without keys the
app serves **simulated** data (labeled as such in the UI). Fill in real keys,
then `docker compose restart backend`:

```
TWELVEDATA_API_KEY=...   # prices, RSI/SMA, history
FINNHUB_API_KEY=...      # news, insider/congress data
FRED_API_KEY=...         # macro (DXY, yields, Fed rate)
KALSHI_API_KEY=...       # prediction markets
EMAIL_SENDER=... EMAIL_PASSWORD=... SMTP_SERVER=...   # trade emails
```

`backend/.env` on the server is never touched by deploys (rsync excludes it).

## 4. Verify

1. `http://192.168.1.18:3003` from your PC → dashboard loads with the 5 default
   commodities (CL, GC, SI, HG, NG).
2. Click a commodity → analysis panel; place a BUY → appears under My Holdings.
3. Reload → holding still there (persistence via libsql volume).
4. `curl http://192.168.1.18:8000/health` → `{"status":"healthy"}`.

## 5. Backups & monitoring

```cron
0 0 * * * tar -czf /home/dinakar/backups/trading_db_$(date +\%F).tar.gz -C /home/dinakar/projects/Trading libsql-data
```

Uptime Kuma: add an HTTP monitor for `http://127.0.0.1:3003`.

## 6. Optional: public HTTPS access

Same DuckDNS + Nginx + certbot pattern as vamsa.duckdns.org — see the header
of `deploy/nginx-trading.conf`. Nothing to change on the router (80/443 are
already forwarded; Nginx routes by hostname).

## How a deploy flows

```
push to main
  ├── CI (GitHub cloud): frontend npm build + backend Docker build   [catches breaks]
  └── Deploy (trading-runner on 192.168.1.18):
        rsync checkout → ~/projects/Trading   (keeps .env + database)
        deploy/deploy-server.sh:
          docker compose up -d --build
          wait for /health on 8000 and / on 3003
          deploy/smoke-test.sh  (9 checks, red workflow if any fail)
```

## Security notes

- The GitHub PAT is used only to mint a one-hour runner registration token
  during setup; it is not stored on the server. **Rotate it after setup** —
  it was shared in chat.
- `backend/.env` lives only on the server (chmod 600). ALL API keys
  (Massive, Finnhub, FRED, Kalshi, SMTP) are read from it — the repo contains
  no secrets. `KALSHI_RSA_PRIVATE_KEY` accepts base64 of the PEM file:
  `base64 -w0 kalshi-key.pem`.
- The old keys (Twelve Data, Finnhub, FRED, Kalshi + RSA key, Zoho SMTP
  password) were committed to this public repo's history — treat them all as
  leaked: **rotate each at its provider**, then put the NEW values in the
  server `.env` only. Optionally purge history with `git filter-repo`.
