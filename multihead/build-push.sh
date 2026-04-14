#!/usr/bin/env bash
# build-push.sh — Build the multi-head Studio image and push to GitHub Container Registry.
#
# Usage:
#   bash build-push.sh -o <github-owner> [options]
#
# Options:
#   -o, --owner      <owner>     GitHub username or org (required)
#   -t, --tag        <tag>       Image tag (default: latest)
#   -p, --platforms  <platforms> Comma-separated platforms (default: linux/amd64)
#                                e.g. linux/amd64,linux/arm64
#   -n, --no-push                Build only, do not push
#   -h, --help                   Show this help
#
# Examples:
#   bash build-push.sh -o myusername
#   bash build-push.sh -o myorg -t v1.2.3
#   bash build-push.sh -o myorg -t v1.2.3 -p linux/amd64,linux/arm64
#   bash build-push.sh -o myusername --no-push   # local test build

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────

OWNER=""
TAG="latest"
PLATFORMS="linux/amd64"
PUSH=true
REGISTRY="ghcr.io"

# ── Parse arguments ───────────────────────────────────────────────────────────

usage() {
  sed -n '3,20p' "$0" | sed 's/^# \?//'
  exit 0
}

die() { echo "ERROR: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--owner)     OWNER="${2:?--owner requires a value}"; shift 2 ;;
    -t|--tag)       TAG="${2:?--tag requires a value}"; shift 2 ;;
    -p|--platforms) PLATFORMS="${2:?--platforms requires a value}"; shift 2 ;;
    -n|--no-push)   PUSH=false; shift ;;
    -h|--help)      usage ;;
    *) die "Unknown option: $1 (run with --help for usage)" ;;
  esac
done

[[ -n "$OWNER" ]] || die "GitHub owner is required. Use: -o <owner>"

IMAGE="${REGISTRY}/${OWNER}/supabase-studio-multi-head:${TAG}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Pre-flight checks ─────────────────────────────────────────────────────────

command -v docker &>/dev/null || die "docker is not installed or not in PATH"

# Ensure buildx is available
if ! docker buildx version &>/dev/null; then
  die "docker buildx is not available. Install Docker Desktop or enable BuildKit."
fi

# Multi-platform builds require a non-default builder
if [[ "$PLATFORMS" == *","* ]]; then
  if ! docker buildx ls | grep -q "multi-platform\|qemu"; then
    echo "Setting up QEMU + multi-platform builder ..."
    docker run --rm --privileged tonistiigi/binfmt --install all
    docker buildx create --name multiplatform --use --bootstrap 2>/dev/null || \
      docker buildx use multiplatform
  fi
fi

# ── Login check ───────────────────────────────────────────────────────────────

if $PUSH; then
  echo ""
  echo "You will need to be logged in to ${REGISTRY}."
  echo "If not logged in yet, run:"
  echo "  echo \$GITHUB_TOKEN | docker login ghcr.io -u ${OWNER} --password-stdin"
  echo ""
  read -rp "Continue? [Y/n] " confirm
  [[ "${confirm:-Y}" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

# ── Build ─────────────────────────────────────────────────────────────────────

echo ""
echo "Building: $IMAGE"
echo "  Platforms : $PLATFORMS"
echo "  Context   : $REPO_ROOT"
echo "  Dockerfile: $REPO_ROOT/apps/studio/Dockerfile"
echo ""

BUILD_ARGS=(
  --file   "$REPO_ROOT/apps/studio/Dockerfile"
  --target production
  --platform "$PLATFORMS"
  --tag    "$IMAGE"
  --label  "org.opencontainers.image.source=https://github.com/${OWNER}/supabase-studio-multi-head"
  --label  "org.opencontainers.image.description=Multi-head Supabase Studio"
)

# Also tag as <owner>/supabase-studio-multi-head:<semver> when tag looks like a version
if [[ "$TAG" =~ ^v?[0-9]+\.[0-9]+ ]]; then
  MINOR_TAG="$(echo "$TAG" | sed 's/^\(v\?[0-9]*\.[0-9]*\).*/\1/')"
  BUILD_ARGS+=(--tag "${REGISTRY}/${OWNER}/supabase-studio-multi-head:${MINOR_TAG}")
fi

if $PUSH; then
  BUILD_ARGS+=(--push)
else
  # local load only works for single platform
  BUILD_ARGS+=(--load)
fi

docker buildx build "${BUILD_ARGS[@]}" "$REPO_ROOT"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
if $PUSH; then
  echo "Pushed successfully:"
  echo "  $IMAGE"
  echo ""
  echo "Update your docker/.env:"
  echo "  MULTI_HEAD_IMAGE=${IMAGE}"
  echo ""
  echo "Or pass it directly to the start script:"
  echo "  MULTI_HEAD_IMAGE=${IMAGE} bash docker/multihead-start.sh"
else
  echo "Built locally (not pushed):"
  echo "  $IMAGE"
  echo ""
  echo "Test it with:"
  echo "  docker run --rm -p 3000:3000 $IMAGE"
fi
