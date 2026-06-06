#!/usr/bin/env bash
set -euo pipefail

if [ -z "${NEON_API_KEY:-}" ] || [ -z "${NEON_PROJECT_ID:-}" ]; then
  echo "::notice::Skipping Neon cleanup because NEON_API_KEY or NEON_PROJECT_ID is not configured."
  exit 0
fi

DELETE_BRANCH="${DELETE_BRANCH:-true}" \
  NEON_API_KEY="${NEON_API_KEY:-}" \
  NEON_LOCAL_BRANCH_TTL_HOURS="${NEON_LOCAL_BRANCH_TTL_HOURS:-2}" \
  NEON_LOCAL_METADATA_DIR="${NEON_LOCAL_METADATA_DIR:-/tmp/neon-local-metadata}" \
  NEON_PROJECT_ID="${NEON_PROJECT_ID:-}" \
  bun helpers/testing/delete-neon-local-branches.ts
