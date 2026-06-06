#!/usr/bin/env bash
set -euo pipefail

buildkit_image="${BUILDKIT_IMAGE:-moby/buildkit:buildx-stable-1}"

for attempt in 1 2 3 4; do
  if timeout 3m docker pull "${buildkit_image}"; then
    exit 0
  fi

  if [ "${attempt}" = "4" ]; then
    echo "::warning::Failed to pre-pull ${buildkit_image} after ${attempt} attempts. Continuing so docker/setup-buildx-action can perform the authoritative BuildKit setup."
    exit 0
  fi

  delay_seconds=$((attempt * 15))
  echo "::warning::Failed to pull ${buildkit_image} on attempt ${attempt}. Retrying in ${delay_seconds}s before Docker Buildx setup."
  sleep "${delay_seconds}"
done
