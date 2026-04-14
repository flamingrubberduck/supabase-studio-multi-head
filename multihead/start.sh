#!/usr/bin/env bash
# start.sh — Set up and launch Supabase Multi-Head Studio.
#
# Run from the multihead/ directory:
#   bash start.sh
#
# What it does:
#   1. Creates .env from .env.example if missing.
#   2. Detects OS and sets MULTI_HEAD_HOST automatically.
#   3. Creates volumes/studio-data/ for the project registry.
#   4. Runs: docker compose up -d --remove-orphans
#
# Optional overrides (set before running):
#   MULTI_HEAD_IMAGE  — Docker image (default: ghcr.io/flamingrubberduck/supabase-studio-multi-head:latest)
#   STUDIO_DATA_DIR   — Host path for project registry (default: ./volumes/studio-data)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"

info() { echo "[multihead] $*"; }
warn() { echo "[multihead] WARNING: $*" >&2; }

# ── Ensure .env exists ────────────────────────────────────────────────────────

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ENV_EXAMPLE" ]]; then
    info "No .env found — copying from .env.example"
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo ""
    echo "  !! ACTION REQUIRED !!"
    echo "  Edit $ENV_FILE and change the default secrets before continuing."
    echo "  Generate secure values with:  bash utils/generate-keys.sh"
    echo ""
    read -rp "  Press Enter to continue anyway (demo / local use only) ..."
    echo ""
  else
    echo "ERROR: .env.example not found. Run this script from the multihead/ directory." >&2
    exit 1
  fi
fi

# ── Helper: add or update a variable in .env ─────────────────────────────────

set_env_var() {
  local key="$1"
  local value="$2"
  local escaped
  escaped="$(printf '%s\n' "$value" | sed 's/[&/\]/\\&/g')"
  if grep -qE "^[[:space:]]*#?[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i.bak -E "s|^[[:space:]]*#?[[:space:]]*${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    [[ -n "$(tail -c1 "$ENV_FILE")" ]] && echo "" >> "$ENV_FILE"
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

# ── Detect OS → set MULTI_HEAD_HOST ──────────────────────────────────────────

OS="$(uname -s)"

if [[ "$OS" == "Linux" ]]; then
  info "Linux detected — resolving Docker bridge IP"
  BRIDGE_IP=""

  if command -v docker &>/dev/null; then
    BRIDGE_IP="$(docker network inspect bridge \
      --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || true)"
  fi

  if [[ -z "$BRIDGE_IP" ]] && command -v ip &>/dev/null; then
    BRIDGE_IP="$(ip route show default 2>/dev/null \
      | awk '/docker0/ {print $9}' | head -n1 || true)"
  fi

  if [[ -z "$BRIDGE_IP" ]]; then
    BRIDGE_IP="172.17.0.1"
    warn "Could not auto-detect Docker bridge IP — using $BRIDGE_IP"
    warn "If Studio cannot reach other stacks, set MULTI_HEAD_HOST manually in .env"
  fi

  MULTI_HEAD_HOST_VALUE="$BRIDGE_IP"
  info "MULTI_HEAD_HOST = $MULTI_HEAD_HOST_VALUE"
else
  MULTI_HEAD_HOST_VALUE="host.docker.internal"
  info "Mac/Windows detected — MULTI_HEAD_HOST = $MULTI_HEAD_HOST_VALUE"
fi

# ── Apply values to .env ──────────────────────────────────────────────────────

MULTI_HEAD_IMAGE_VALUE="${MULTI_HEAD_IMAGE:-ghcr.io/flamingrubberduck/supabase-studio-multi-head:latest}"
STUDIO_DATA_DIR_VALUE="${STUDIO_DATA_DIR:-./volumes/studio-data}"

info "Updating .env ..."
set_env_var "MULTI_HEAD_IMAGE"  "$MULTI_HEAD_IMAGE_VALUE"
set_env_var "MULTI_HEAD_HOST"   "$MULTI_HEAD_HOST_VALUE"
set_env_var "STUDIO_DATA_DIR"   "$STUDIO_DATA_DIR_VALUE"
rm -f "${ENV_FILE}.bak"

# ── Create data directory ─────────────────────────────────────────────────────

if [[ "$STUDIO_DATA_DIR_VALUE" == ./* ]]; then
  DATA_DIR_ABS="$SCRIPT_DIR/${STUDIO_DATA_DIR_VALUE#./}"
else
  DATA_DIR_ABS="$STUDIO_DATA_DIR_VALUE"
fi
mkdir -p "$DATA_DIR_ABS"
info "Project registry directory: $DATA_DIR_ABS"

# ── Pull the image ────────────────────────────────────────────────────────────

info "Pulling image: $MULTI_HEAD_IMAGE_VALUE"
docker pull "$MULTI_HEAD_IMAGE_VALUE" || {
  warn "Could not pull image — will use local cache if available."
}

# ── Launch ────────────────────────────────────────────────────────────────────

info "Starting Supabase Multi-Head Studio ..."
cd "$SCRIPT_DIR"
docker compose up -d --remove-orphans

KONG_PORT="$(grep -E '^KONG_HTTP_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]')"
KONG_PORT="${KONG_PORT:-8000}"

info ""
info "Done! Studio is starting (may take ~30 s for all services to become healthy)."
info "  Dashboard: http://localhost:${KONG_PORT}"
info ""
info "Useful commands:"
info "  docker compose logs -f studio    # follow Studio logs"
info "  docker compose down              # stop everything"
info "  docker compose down -v           # stop + wipe all data"
