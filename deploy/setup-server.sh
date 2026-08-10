#!/usr/bin/env bash
# =============================================================================
# ONE-TIME server setup for TradeVision CI/CD (run ON the home server)
#
#   export GH_PAT='<github token with repo access>'
#   bash deploy/setup-server.sh
#
# Does three things, all idempotent:
#   1. Installs Docker + the compose plugin if missing (get.docker.com)
#   2. Installs rsync if missing (the deploy workflow needs it)
#   3. Registers a GitHub Actions SELF-HOSTED RUNNER for the *trading* repo
#      as a systemd service (~/actions-runner-trading). Runners are per-repo,
#      so the existing Vamsha runner on this box cannot be reused.
#
# After this, every push to main deploys automatically (see .github/workflows/deploy.yml).
# =============================================================================
set -euo pipefail

REPO="chaoscoder-rgb/trading"
RUNNER_DIR="$HOME/actions-runner-trading"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    OK: %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m    FAIL: %s\033[0m\n' "$*"; exit 1; }

# --- 1. Docker ----------------------------------------------------------------
say "Checking Docker"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  ok "docker + compose already installed"
else
  say "Installing Docker (get.docker.com)"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  ok "docker installed — you may need to log out/in for group membership to apply"
fi

# --- 2. rsync -----------------------------------------------------------------
command -v rsync >/dev/null || { say "Installing rsync"; sudo apt-get update -qq && sudo apt-get install -y rsync; }
ok "rsync present"

# --- 3. GitHub Actions runner ---------------------------------------------------
say "Setting up the self-hosted runner for $REPO"
if [[ -d "$RUNNER_DIR" && -f "$RUNNER_DIR/.runner" ]]; then
  ok "runner already configured in $RUNNER_DIR — nothing to do"
  exit 0
fi

[[ -n "${GH_PAT:-}" ]] || fail "GH_PAT is not set. Run:  export GH_PAT='<token>'  and re-run."

# Fetch a short-lived registration token using the PAT (PAT itself is not stored)
say "Requesting a runner registration token"
REG_TOKEN=$(curl -sf -X POST \
  -H "Authorization: Bearer $GH_PAT" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/actions/runners/registration-token" \
  | grep -o '"token": *"[^"]*"' | head -1 | sed 's/.*"token": *"\([^"]*\)".*/\1/')
[[ -n "$REG_TOKEN" ]] || fail "could not get a registration token (does the PAT have repo admin access?)"
ok "registration token obtained"

# Download the latest runner release
say "Downloading the runner"
mkdir -p "$RUNNER_DIR" && cd "$RUNNER_DIR"
LATEST=$(curl -sf https://api.github.com/repos/actions/runner/releases/latest \
  | grep -o '"tag_name": *"v[^"]*"' | sed 's/.*"v\([^"]*\)".*/\1/')
[[ -n "$LATEST" ]] || fail "could not determine latest runner version"
ARCH=$(uname -m); case "$ARCH" in x86_64) RARCH=x64;; aarch64) RARCH=arm64;; *) fail "unsupported arch $ARCH";; esac
curl -fLo runner.tar.gz "https://github.com/actions/runner/releases/download/v${LATEST}/actions-runner-linux-${RARCH}-${LATEST}.tar.gz"
tar xzf runner.tar.gz && rm runner.tar.gz
ok "runner v$LATEST downloaded"

# Configure + install as a service
say "Configuring runner (name: trading-runner)"
./config.sh --url "https://github.com/$REPO" --token "$REG_TOKEN" \
  --name "trading-runner" --unattended --replace
sudo ./svc.sh install
sudo ./svc.sh start
ok "runner service installed and started"

cat <<EOF

=============================================================================
 DONE. Verify on GitHub:  https://github.com/$REPO/settings/actions/runners
 (should show 'trading-runner' as Idle)

 Now trigger the first deploy:
   - push anything to main, OR
   - GitHub -> Actions -> Deploy -> Run workflow
=============================================================================
EOF
