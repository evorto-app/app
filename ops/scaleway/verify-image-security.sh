#!/usr/bin/env bash

set -euo pipefail

readonly repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly tools_directory="$("${repository_root}/ops/scaleway/install-verification-tools.sh")"
export PATH="${tools_directory}:${PATH}"

: "${FONT_AWESOME_TOKEN:?FONT_AWESOME_TOKEN is required for the verified image build}"
command -v docker >/dev/null

readonly revision="$(git -C "${repository_root}" rev-parse HEAD)"
readonly image="evorto-local-security:${revision}"
temporary_directory="$(mktemp -d)"
trap 'docker image rm --force "${image}" >/dev/null 2>&1 || true; rm -rf "${temporary_directory}"' EXIT

docker build \
  --platform linux/amd64 \
  --secret id=FONT_AWESOME_TOKEN,env=FONT_AWESOME_TOKEN \
  --tag "${image}" \
  "${repository_root}"

"${repository_root}/ops/scaleway/verify-runtime-image.sh" "${image}"

docker build \
  --platform linux/amd64 \
  --secret id=FONT_AWESOME_TOKEN,env=FONT_AWESOME_TOKEN \
  --target source-maps \
  --output "type=local,dest=${temporary_directory}/source-maps" \
  "${repository_root}"
test -s "${temporary_directory}/source-maps/source-maps.tar.gz"

syft "${image}" \
  --output "spdx-json=${temporary_directory}/sbom.spdx.json" \
  --quiet
test -s "${temporary_directory}/sbom.spdx.json"

trivy image \
  --exit-code 1 \
  --ignore-unfixed \
  --quiet \
  --severity HIGH,CRITICAL \
  "${image}"
