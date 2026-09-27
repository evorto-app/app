#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "${fixture}"' EXIT
mkdir -p "${fixture}/context" "${fixture}/output"
cp "${repository_root}/.dockerignore" "${fixture}/context/.dockerignore"

# Only synthetic files enter this build; no repository secrets are copied.
readonly excluded_paths=(
  .git/HEAD .angular/fixture.ts node_modules/fixture.js e2e/fixture.ts
  playwright.config.ts old/fixture dist/fixture
  .env .env.dev .env.dev.local .env.production .env.production.local
  .env.local .env.runtime .env.ci
  infrastructure/scaleway/staging/.terraform/provider
  infrastructure/scaleway/staging/terraform.tfstate
  infrastructure/scaleway/staging/terraform.tfstate.backup
  infrastructure/scaleway/staging/release.tfplan
  infrastructure/scaleway/staging/backend.hcl
  infrastructure/scaleway/staging/terraform.tfvars
  infrastructure/scaleway/staging/local.auto.tfvars
  tests/fixture.ts .e2e-runtime.json .playwright-cli/session
  coverage/report playwright-report/report test-results/report repos/example/source
)
readonly included_paths=(helpers/fixture.ts ops/fixture.ts public/fixture.txt src/fixture.ts)
for relative_path in "${excluded_paths[@]}" "${included_paths[@]}"; do
  mkdir -p "$(dirname "${fixture}/context/${relative_path}")"
  printf 'synthetic build-context fixture\n' >"${fixture}/context/${relative_path}"
done

docker build --network none --file - --output "type=local,dest=${fixture}/output" "${fixture}/context" <<'DOCKERFILE'
FROM scratch
COPY . /
DOCKERFILE

for relative_path in "${excluded_paths[@]}"; do
  if [[ -e "${fixture}/output/${relative_path}" ]]; then
    echo "Docker build context exposed excluded fixture: ${relative_path}" >&2
    exit 1
  fi
done
for relative_path in "${included_paths[@]}"; do
  if [[ ! -f "${fixture}/output/${relative_path}" ]] ||
    ! cmp -s "${fixture}/context/${relative_path}" "${fixture}/output/${relative_path}"; then
    echo "Docker build context lost required input: ${relative_path}" >&2
    exit 1
  fi
done

echo 'Docker build context excludes sensitive files and retains application inputs.'
