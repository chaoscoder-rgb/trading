#!/usr/bin/env bash
# Automated smoke tests for a running TradeVision instance.
#   BASE_URL=http://127.0.0.1:3003 API_URL=http://127.0.0.1:8000 bash deploy/smoke-test.sh
# (Same blueprint as Vamsha's deploy/smoke-test.sh.)
set -u
BASE_URL="${BASE_URL:-http://127.0.0.1:3003}"
API_URL="${API_URL:-http://127.0.0.1:8000}"
PASS=0; FAILED=0

check() { # name, expected, actual
  if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); printf '    PASS  %s\n' "$1";
  else FAILED=$((FAILED+1)); printf '    FAIL  %s (expected %s, got %s)\n' "$1" "$2" "$3"; fi
}

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 90 "$@"; }

# Backend directly
check "backend health"              200 "$(code "$API_URL/health")"
check "backend root"                200 "$(code "$API_URL/")"
check "holdings API"                200 "$(code "$API_URL/api/holdings")"
check "trade history API"           200 "$(code "$API_URL/api/history")"
# Slow: fans out to all external market/news APIs (falls back to simulation)
check "commodities API"             200 "$(code "$API_URL/api/commodities")"
check "price history API"           200 "$(code "$API_URL/api/commodities/GC/history?days=7")"

# Stop-loss system
check "stop-loss settings API"      200 "$(code "$API_URL/api/settings/stop-loss")"
check "alerts API"                  200 "$(code "$API_URL/api/alerts")"
check "stop-loss history API"       200 "$(code "$API_URL/api/stop-loss/history")"
check "manual stop-loss check"      200 "$(code -X POST "$API_URL/api/stop-loss/check-now")"

# Through the frontend nginx (what the browser actually uses)
check "frontend loads"              200 "$(code "$BASE_URL/")"
check "frontend /api proxy works"   200 "$(code "$BASE_URL/api/holdings")"

# Data sanity: commodities payload contains a recommendation block
BODY=$(curl -s --max-time 90 "$API_URL/api/commodities")
if echo "$BODY" | grep -q '"recommendation"'; then
  PASS=$((PASS+1)); printf '    PASS  commodities payload has recommendations\n'
else
  FAILED=$((FAILED+1)); printf '    FAIL  commodities payload has recommendations\n'
fi

echo
if [[ $FAILED -eq 0 ]]; then echo "SMOKE TESTS: all $PASS passed."; exit 0;
else echo "SMOKE TESTS: $FAILED failed, $PASS passed."; exit 1; fi
