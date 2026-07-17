#!/usr/bin/env bash

set -euo pipefail

readonly repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly tools_directory="$("${repository_root}/ops/scaleway/install-verification-tools.sh")"
export PATH="${tools_directory}:${PATH}"

temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT

terraform fmt -check -recursive "${repository_root}/infrastructure/scaleway"

for root in infrastructure/scaleway infrastructure/scaleway/bootstrap; do
  root_key="${root//\//-}"
  TF_DATA_DIR="${temporary_directory}/${root_key}" \
    terraform -chdir="${repository_root}/${root}" init \
      -backend=false \
      -input=false \
      >/dev/null
  TF_DATA_DIR="${temporary_directory}/${root_key}" \
    terraform -chdir="${repository_root}/${root}" validate
done

trivy config \
  --exit-code 1 \
  --quiet \
  --severity HIGH,CRITICAL \
  "${repository_root}/infrastructure/scaleway"
