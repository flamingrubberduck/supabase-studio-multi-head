#!/usr/bin/env bash
# multihead-start.sh — One-shot setup and launch for multi-head Supabase Studio.
#
# Run from the docker/ directory:
#   cd docker && bash multihead-start.sh
#
# What it does:
#   1. Detects the host OS and derives the correct MULTI_HEAD_HOST value.
#   2. Adds/updates MULTI_HEAD_IMAGE, MULTI_HEAD_HOST, STUDIO_DATA_DIR in .env
#      (creates .env from .env.example if it does not exist yet).
#   3. Creates the volumes/studio-data/ directory on the host.
#   4. Runs: docker compose -f docker-compose.yml -f docker-compose.multihead.yml up -d --remove-orphans
#
# Optional env overrides (set before running the script):
#   MULTI_HEAD_IMAGE   — Docker image to use (default: ghcr.io/flamingrubberduck/supabase-studio-multi-head:latest)
#   STUDIO_DATA_DIR    — Host path for the project registry (default: ./volumes/studio-data)

set -euo pipefail

# ── Helpers ──────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"

info()  { echo "[multihead] $*"; }
warn()  { echo "[multihead] WARNING: $*" >&2; }
die()   { echo "[multihead] ERROR: $*" >&2; exit 1; }

# Add or update a KEY=VALUE pair in .env.
# If the key already exists (commented or not), it is replaced.
# Otherwise the value is appended at the end of the file.
set_env_var() {
  local key="$1"
  local value="$2"

  # Escape characters that would confuse sed's replacement string
  local escaped_value
  escaped_value="$(printf '%s\n' "$value" | sed 's/[&/\]/\\&/g')"

  if grep -qE "^[[:space:]]*#?[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null; then
    # Replace the first matching line (commented or not)
    sed -i.bak -E "s|^[[:space:]]*#?[[:space:]]*${key}=.*|${key}=${escaped_value}|" "$ENV_FILE"
  else
    # Append at end (with a newline guard)
    [[ -n "$(tail -c1 "$ENV_FILE")" ]] && echo "" >> "$ENV_FILE"
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

# ── Ensure .env exists ───────────────────────────────────────────────────────

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ENV_EXAMPLE" ]]; then
    info "No .env found — copying from .env.example"
    cp "$ENV_EXAMPLE" "$ENV_FILE"
  else
    info "No .env or .env.example found — creating a minimal .env"
    touch "$ENV_FILE"
  fi
fi

# ── Detect host OS and MULTI_HEAD_HOST ───────────────────────────────────────

OS="$(uname -s)"

if [[ "$OS" == "Linux" ]]; then
  info "Linux detected — resolving Docker bridge IP for MULTI_HEAD_HOST"

  BRIDGE_IP=""

  # Try docker network inspect first (most reliable)
  if command -v docker &>/dev/null; then
    BRIDGE_IP="$(docker network inspect bridge \
      --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || true)"
  fi

  # Fall back to ip route (works on most Linux distros)
  if [[ -z "$BRIDGE_IP" ]] && command -v ip &>/dev/null; then
    BRIDGE_IP="$(ip route show default 2>/dev/null \
      | awk '/docker0/ {print $9}' | head -n1 || true)"
  fi

  # Hard-coded fallback — Docker bridge default
  if [[ -z "$BRIDGE_IP" ]]; then
    BRIDGE_IP="172.17.0.1"
    warn "Could not detect Docker bridge IP automatically; falling back to $BRIDGE_IP"
    warn "If Studio cannot reach other stacks, set MULTI_HEAD_HOST manually in .env"
  fi

  MULTI_HEAD_HOST_VALUE="$BRIDGE_IP"
  info "MULTI_HEAD_HOST will be set to $MULTI_HEAD_HOST_VALUE"
  info "Tip: if you prefer, add --add-host=host.docker.internal:host-gateway"
  info "     to the studio service in docker-compose.multihead.yml and use"
  info "     'host.docker.internal' instead."
else
  # macOS / Windows Docker Desktop — host.docker.internal resolves out of the box
  MULTI_HEAD_HOST_VALUE="host.docker.internal"
  info "Mac/Windows detected — using MULTI_HEAD_HOST=$MULTI_HEAD_HOST_VALUE"
fi

# ── Resolve values ────────────────────────────────────────────────────────────

MULTI_HEAD_IMAGE_VALUE="${MULTI_HEAD_IMAGE:-ghcr.io/flamingrubberduck/supabase-studio-multi-head:latest}"
STUDIO_DATA_DIR_VALUE="${STUDIO_DATA_DIR:-./volumes/studio-data}"

# ── Apply to .env ─────────────────────────────────────────────────────────────

info "Updating .env ..."
set_env_var "MULTI_HEAD_IMAGE"  "$MULTI_HEAD_IMAGE_VALUE"
set_env_var "MULTI_HEAD_HOST"   "$MULTI_HEAD_HOST_VALUE"
set_env_var "STUDIO_DATA_DIR"   "$STUDIO_DATA_DIR_VALUE"

# Clean up sed backup file
rm -f "${ENV_FILE}.bak"

info "  MULTI_HEAD_IMAGE  = $MULTI_HEAD_IMAGE_VALUE"
info "  MULTI_HEAD_HOST   = $MULTI_HEAD_HOST_VALUE"
info "  STUDIO_DATA_DIR   = $STUDIO_DATA_DIR_VALUE"

# ── Create data directory ─────────────────────────────────────────────────────

# Resolve relative path against the docker/ directory
if [[ "$STUDIO_DATA_DIR_VALUE" == ./* ]]; then
  DATA_DIR_ABS="$SCRIPT_DIR/${STUDIO_DATA_DIR_VALUE#./}"
else
  DATA_DIR_ABS="$STUDIO_DATA_DIR_VALUE"
fi

mkdir -p "$DATA_DIR_ABS"
info "Ensured data directory: $DATA_DIR_ABS"

# ── Launch ────────────────────────────────────────────────────────────────────

info "Starting multi-head Supabase Studio ..."
cd "$SCRIPT_DIR"
docker compose \
  -f docker-compose.yml \
  -f docker-compose.multihead.yml \
  up -d --remove-orphans

info ""
info "Done! Studio is starting up."
info "  Dashboard: http://localhost:\${KONG_HTTP_PORT:-8000}"
info ""
info "To follow Studio logs:"
info "  docker compose -f docker-compose.yml -f docker-compose.multihead.yml logs -f studio"
