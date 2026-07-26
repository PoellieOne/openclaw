#!/usr/bin/env bash
# Build the derived OpenClaw direct-spawn extension image.
# Usage: ./build-derived-image.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MANIFEST="build-context-manifest.json"
DOCKERFILE="Dockerfile.direct-spawn"
SOURCE_MANIFEST="source-manifest.sha256"
IMAGE_TAG="openclaw-sora-direct-spawn:2026.7.1-compatible-54bf5d24"
BUILD_COMMIT="54bf5d24eb64f73af824abb12c2f54b7ffce12da"

echo "=== Build Context Verification ==="

# Verify manifest exists
if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: $MANIFEST not found" >&2
  exit 1
fi

# Verify Dockerfile hash
expected_df=$(jq -r '.dockerfileSha256' "$MANIFEST")
actual_df=$(sha256sum "$DOCKERFILE" | cut -d' ' -f1)
if [ "$actual_df" != "$expected_df" ]; then
  echo "ERROR: Dockerfile.direct-spawn hash mismatch (expected $expected_df, got $actual_df)" >&2
  exit 1
fi
echo "Dockerfile hash: OK ($actual_df)"

# Verify source manifest hash
expected_sm=$(jq -r '.sourceManifestSha256' "$MANIFEST")
actual_sm=$(sha256sum "$SOURCE_MANIFEST" | cut -d' ' -f1)
if [ "$actual_sm" != "$expected_sm" ]; then
  echo "ERROR: source-manifest.sha256 hash mismatch (expected $expected_sm, got $actual_sm)" >&2
  exit 1
fi
echo "Source manifest hash: OK ($actual_sm)"

# Verify lockfile hash
expected_lf=$(jq -r '.lockfileSha256' "$MANIFEST")
actual_lf=$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)
if [ "$actual_lf" != "$expected_lf" ]; then
  echo "ERROR: pnpm-lock.yaml hash mismatch (expected $expected_lf, got $actual_lf)" >&2
  exit 1
fi
echo "Lockfile hash: OK ($actual_lf)"

echo ""
echo "=== Resource Preflight ==="

# Check RAM
total_ram_mb=$(free -m | awk '/^Mem:/ {print $2}')
total_swap_mb=$(free -m | awk '/^Swap:/ {print $2}')
effective_mb=$((total_ram_mb + total_swap_mb))

echo "RAM: ${total_ram_mb} MB"
echo "Swap: ${total_swap_mb} MB"
echo "Effective memory: ${effective_mb} MB"

if [ "$effective_mb" -lt 12288 ]; then
  echo "WARNING: Effective memory (${effective_mb} MB) is below preferred 12288 MB (12 GB)."
  if [ "$effective_mb" -lt 8192 ]; then
    echo "ERROR: Effective memory (${effective_mb} MB) is below minimum 8192 MB (8 GB)." >&2
    echo "Add swap or use a host with more RAM before building." >&2
    exit 1
  fi
  echo "Proceeding with constrained memory (${effective_mb} MB). Build may fail if tsdown exceeds available memory."
fi

# Check free disk
free_disk_mb=$(df -m . | awk 'NR==2 {print $4}')
echo "Free disk: ${free_disk_mb} MB"
if [ "$free_disk_mb" -lt 20480 ]; then
  echo "ERROR: Free disk (${free_disk_mb} MB) is below minimum 20480 MB (20 GB)." >&2
  exit 1
fi
echo "Disk: OK"

# Check CPU
cpu_count=$(nproc)
echo "CPU cores: ${cpu_count}"
if [ "$cpu_count" -lt 2 ]; then
  echo "WARNING: Only ${cpu_count} CPU core(s). Build may be slow."
fi

echo ""
echo "=== Building Derived Image ==="
echo "Image tag: $IMAGE_TAG"
echo "Extension commit: $BUILD_COMMIT"
echo ""

docker build \
  -f "$DOCKERFILE" \
  -t "$IMAGE_TAG" \
  --build-arg "GIT_COMMIT=${BUILD_COMMIT}" \
  --build-arg "OPENCLAW_BASELINE_COMMIT=08987d8f409b848098156230b37916be6e4be5dd" \
  --build-arg "OPENCLAW_EXTENSION_COMMIT=${BUILD_COMMIT}" \
  --build-arg "OPENCLAW_EXTENSION_TREE=40af64cee2fe3cc6445feb242c441cec4ffe0cb9" \
  .

echo ""
echo "=== Build Complete ==="
echo "Image: $IMAGE_TAG"
echo "To verify: docker inspect --format='{{json .Config.Labels}}' $IMAGE_TAG"
echo ""
echo "No container was started. No push was performed."
