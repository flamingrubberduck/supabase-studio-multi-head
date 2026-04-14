#!/usr/bin/env bash
# integrate.sh — Add multi-head Studio to an EXISTING Supabase self-hosted deployment.
#
# Usage:
#   bash integrate.sh [/path/to/supabase/docker]
#
# If the path is omitted the current directory is used.
#
# What it does:
#   1. Validates the target is an existing Supabase docker-compose directory.
#   2. Copies docker-compose.overlay.yml into the target directory.
#   3. Detects OS and sets MULTI_HEAD_HOST in the existing .env.
#   4. Adds MULTI_HEAD_IMAGE and STUDIO_DATA_DIR to the existing .env.
#   5. Creates volumes/studio-data/ for the project registry.
#   6. Restarts only the Studio service with the multi-head overlay applied.
#
# Rollback:
#   cd <supabase-docker-dir>
#   docker compose up -d studio    # without the overlay — restores original image

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Parse arguments ───────────────────────────────────────────────────────────

TARGET_DIR="${1:-$PWD}"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"   # resolve to absolute path

info()  { echo "[integrate] $*"; }
warn()  { echo "[integrate] WARNING: $*" >&2; }
die()   { echo "[integrate] ERROR: $*" >&2; exit 1; }

# ── Validate target ───────────────────────────────────────────────────────────

info "Target directory: $TARGET_DIR"

[[ -f "$TARGET_DIR/docker-compose.yml" ]] || \
  die "No docker-compose.yml found in $TARGET_DIR. Please point to your Supabase docker/ directory."

[[ -f "$TARGET_DIR/.env" ]] || \
  die "No .env file found in $TARGET_DIR. Supabase self-hosted requires .env alongside docker-compose.yml."

# Verify it looks like a Supabase stack (not just any compose file)
if ! grep -q "supabase\|gotrue\|postgrest\|kong" "$TARGET_DIR/docker-compose.yml" 2>/dev/null; then
  warn "docker-compose.yml does not look like a Supabase stack — proceeding anyway."
fi

# ── Helper: add or update a variable in .env ─────────────────────────────────

ENV_FILE="$TARGET_DIR/.env"

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

# ── Copy overlay file ─────────────────────────────────────────────────────────

OVERLAY_SRC="$SCRIPT_DIR/docker-compose.overlay.yml"
OVERLAY_DEST="$TARGET_DIR/docker-compose.overlay.yml"

if [[ ! -f "$OVERLAY_SRC" ]]; then
  die "docker-compose.overlay.yml not found in $SCRIPT_DIR. Run this script from the multihead/ folder."
fi

if [[ -f "$OVERLAY_DEST" ]]; then
  info "Overlay file already exists — updating."
fi
cp "$OVERLAY_SRC" "$OVERLAY_DEST"
info "Copied docker-compose.overlay.yml → $TARGET_DIR/"

# ── Detect OS → MULTI_HEAD_HOST ───────────────────────────────────────────────

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
    warn "Set MULTI_HEAD_HOST manually in .env if Studio cannot reach other stacks."
  fi

  MULTI_HEAD_HOST_VALUE="$BRIDGE_IP"
  info "MULTI_HEAD_HOST = $MULTI_HEAD_HOST_VALUE"
else
  MULTI_HEAD_HOST_VALUE="host.docker.internal"
  info "Mac/Windows detected — MULTI_HEAD_HOST = $MULTI_HEAD_HOST_VALUE"
fi

# ── Update .env ───────────────────────────────────────────────────────────────

MULTI_HEAD_IMAGE_VALUE="${MULTI_HEAD_IMAGE:-ghcr.io/flamingrubberduck/supabase-studio-multi-head:latest}"
STUDIO_DATA_DIR_VALUE="${STUDIO_DATA_DIR:-./volumes/studio-data}"

info "Updating $ENV_FILE ..."
set_env_var "MULTI_HEAD_IMAGE"  "$MULTI_HEAD_IMAGE_VALUE"
set_env_var "MULTI_HEAD_HOST"   "$MULTI_HEAD_HOST_VALUE"
set_env_var "STUDIO_DATA_DIR"   "$STUDIO_DATA_DIR_VALUE"
rm -f "${ENV_FILE}.bak"

info "  MULTI_HEAD_IMAGE = $MULTI_HEAD_IMAGE_VALUE"
info "  MULTI_HEAD_HOST  = $MULTI_HEAD_HOST_VALUE"
info "  STUDIO_DATA_DIR  = $STUDIO_DATA_DIR_VALUE"

# ── Create data directory ─────────────────────────────────────────────────────

if [[ "$STUDIO_DATA_DIR_VALUE" == ./* ]]; then
  DATA_DIR_ABS="$TARGET_DIR/${STUDIO_DATA_DIR_VALUE#./}"
else
  DATA_DIR_ABS="$STUDIO_DATA_DIR_VALUE"
fi
mkdir -p "$DATA_DIR_ABS"
info "Project registry directory: $DATA_DIR_ABS"

# ── Restart Studio with the overlay ──────────────────────────────────────────

info ""
info "Applying multi-head Studio to your existing stack ..."
info "(Only the Studio container is restarted — all other services keep running)"
info ""

cd "$TARGET_DIR"
docker compose \
  -f docker-compose.yml \
  -f docker-compose.overlay.yml \
  up -d --no-deps studio

# ── Done ──────────────────────────────────────────────────────────────────────

KONG_PORT="$(grep -E '^KONG_HTTP_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]')"
KONG_PORT="${KONG_PORT:-8000}"

info ""
info "Done! Multi-head Studio is starting."
info "  Dashboard: http://localhost:${KONG_PORT}"
info ""
info "Your existing Postgres data, Auth users, and Storage are untouched."
info ""
info "To run going forward, always use the overlay:"
info "  docker compose -f docker-compose.yml -f docker-compose.overlay.yml up -d"
info ""
info "To roll back to standard Studio:"
info "  docker compose up -d studio   # without the overlay"
