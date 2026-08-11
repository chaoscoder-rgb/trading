#!/usr/bin/env bash
# =============================================================================
# TradeVision one-command server deploy (dina-server, 192.168.1.18)
#
#   cd ~/projects/Trading
#   bash deploy/deploy-server.sh
#
# Runs alongside SplitSmart (3000), Uptime Kuma (3001) and Vamsha (3002):
#   * frontend  -> host port 3003 (nginx, proxies /api to the backend)
#   * backend   -> host port 8000 (FastAPI)
#   * database  -> libsql/sqld, INTERNAL only (no host port)
#
# Idempotent: safe to re-run. Reuses existing backend/.env and database data.
# Overridable: APP_PORT=3003 API_PORT=8000
# (Same blueprint as Vamsha's deploy/deploy-server.sh.)
# =============================================================================
set -euo pipefail

APP_PORT="${APP_PORT:-3003}"
API_PORT="${API_PORT:-8000}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    OK: %s\033[0m\n' "$*"; }
note() { printf '\033[1;33m    NOTE: %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m    FAIL: %s\033[0m\n' "$*"; exit 1; }

cd "$(dirname "$0")/.."   # project root

# --- 1. Preconditions ---------------------------------------------------------
say "Checking prerequisites"
command -v docker >/dev/null || fail "docker not found — run: bash deploy/setup-server.sh"
docker compose version >/dev/null 2>&1 || fail "docker compose plugin not found — run: bash deploy/setup-server.sh"
ok "docker + compose present"

# --- 2. backend/.env ----------------------------------------------------------
# The rsync in the deploy workflow never overwrites this file, so server-side
# keys live only here. All keys are optional — the app falls back to simulated
# data for any missing key.
if [[ ! -f backend/.env ]]; then
  say "Creating backend/.env (first run — fill in real API keys later, then re-run)"
  cat > backend/.env <<'EOF'
# TradeVision server secrets — this file stays on the server, never in git.
# All keys optional; missing keys => simulated data for that source.
#MASSIVE_API_KEY=
#FINNHUB_API_KEY=
#FRED_API_KEY=
#KALSHI_API_KEY=
# Email notifications (optional)
#EMAIL_SENDER=
#EMAIL_PASSWORD=
#SMTP_SERVER=
#SMTP_PORT=587
#EMAIL_FROM=
EOF
  chmod 600 backend/.env
  ok "backend/.env template written (chmod 600)"
else
  say "backend/.env already exists — keeping it"
fi

# --- 3. Build & start the stack -------------------------------------------------
say "Building and starting containers (frontend $APP_PORT, backend $API_PORT) — first build takes a few minutes"
docker compose up -d --build

# --- 4. Health checks -----------------------------------------------------------
say "Waiting for the backend to become healthy"
for i in $(seq 1 60); do
  curl -sf -o /dev/null "http://127.0.0.1:$API_PORT/health" && break
  sleep 2
  [[ $i == 60 ]] && { docker compose logs --tail 30 backend; fail "backend did not become ready"; }
done
ok "backend is responding on port $API_PORT"

say "Waiting for the frontend"
for i in $(seq 1 30); do
  curl -sf -o /dev/null "http://127.0.0.1:$APP_PORT/" && break
  sleep 2
  [[ $i == 30 ]] && { docker compose logs --tail 30 frontend; fail "frontend did not become ready"; }
done
ok "frontend is responding on port $APP_PORT"

# --- 5. Smoke tests --------------------------------------------------------------
say "Running smoke tests"
BASE_URL="http://127.0.0.1:$APP_PORT" API_URL="http://127.0.0.1:$API_PORT" \
  bash deploy/smoke-test.sh

# --- 6. Next steps ----------------------------------------------------------------
cat <<EOF

=============================================================================
 DEPLOYED. Remaining steps (once):

 A. LAN test from your PC:   http://$(hostname -I 2>/dev/null | awk '{print $1}'):$APP_PORT

 B. Real API keys: edit ~/projects/Trading/backend/.env, then
      cd ~/projects/Trading && docker compose restart backend

 C. Optional public access via Nginx + SSL (same pattern as vamsa.duckdns.org):
      sudo cp deploy/nginx-trading.conf /etc/nginx/sites-available/trading
      # edit server_name to your (duckdns) domain first
      sudo ln -sf /etc/nginx/sites-available/trading /etc/nginx/sites-enabled/
      sudo nginx -t && sudo systemctl reload nginx
      sudo certbot --nginx -d <your-domain>

 D. Backups (crontab -e):
      0 0 * * * tar -czf ~/backups/trading_db_\$(date +\%F).tar.gz -C ~/projects/Trading libsql-data

 E. Uptime Kuma: add an HTTP monitor for http://127.0.0.1:$APP_PORT
=============================================================================
EOF
