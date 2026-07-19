#!/usr/bin/env bash

set -euo pipefail

readonly platform_output_file="${1:?Pass the environment Terraform output JSON file}"
readonly role="${2:?Pass web, worker, or ops}"
readonly image_reference="${3:?Pass the immutable image reference}"
readonly revision="${4:?Pass the full Git revision}"
readonly image_digest="${5:?Pass the sha256 image digest}"
readonly schema_hash="${6:?Pass the packaged schema sha256}"
readonly scw_cli="${SCW_CLI:-scw}"
readonly region="${SCW_DEFAULT_REGION:-fr-par}"

if [[ "${role}" != 'web' && "${role}" != 'worker' && "${role}" != 'ops' ]]; then
  echo "Unsupported application role: ${role}" >&2
  exit 1
fi
if [[ ! "${revision}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "The role revision must be a full lowercase Git SHA" >&2
  exit 1
fi
if [[ ! "${image_digest}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "The role image digest must be a sha256 digest" >&2
  exit 1
fi
if [[ ! "${schema_hash}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "The packaged schema hash must be a lowercase SHA-256" >&2
  exit 1
fi

container_resource_id="$(
  jq --exit-status --raw-output \
    --arg role "${role}" \
    '.containers[$role].id' \
    "${platform_output_file}"
)"
container_id="${container_resource_id#"${region}/"}"
if [[ ! "${container_id}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "Terraform returned an unexpected ${role} container ID" >&2
  exit 1
fi

temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT
chmod 700 "${temporary_directory}"
readonly environment_file="${temporary_directory}/environment.json"

jq \
  --arg role "${role}" \
  --arg revision "${revision}" \
  --arg image_digest "${image_digest}" \
  --arg schema_hash "${schema_hash}" \
    '.containers[$role].environment_variables
    + {
        APP_BOOTSTRAP: "false",
        APP_REVISION: $revision,
        APP_IMAGE_DIGEST: $image_digest
      }
    + if $role == "ops" then { APP_SCHEMA_HASH: $schema_hash } else {} end' \
  "${platform_output_file}" \
  >"${environment_file}"

update_arguments=("${container_id}" "image=${image_reference}")
while IFS=$'\t' read -r key encoded_value; do
  value="$(printf '%s' "${encoded_value}" | base64 --decode)"
  update_arguments+=("environment-variables.${key}=${value}")
done < <(
  jq --raw-output \
    'to_entries[] | [.key, (.value | @base64)] | @tsv' \
    "${environment_file}"
)

mask_value() {
  local value="$1"
  if [[ "${GITHUB_ACTIONS:-false}" == 'true' ]]; then
    value="${value//'%'/'%25'}"
    value="${value//$'\r'/'%0D'}"
    value="${value//$'\n'/'%0A'}"
    echo "::add-mask::${value}"
  fi
}

while IFS=$'\t' read -r contract_key secret_id; do
  secret_name="${contract_key#*/}"
  value_file="${temporary_directory}/${secret_name}"
  if ! "${scw_cli}" secret version access \
    "${secret_id}" \
    revision=latest \
    raw=true \
    >"${value_file}"; then
    echo "Failed to access Secret Manager value for ${contract_key}" >&2
    exit 1
  fi
  if [[ ! -s "${value_file}" ]]; then
    echo "Secret Manager returned an empty value for ${contract_key}" >&2
    exit 1
  fi
  value="$(<"${value_file}")"
  mask_value "${value}"
  update_arguments+=("secret-environment-variables.${secret_name}=${value}")
done < <(
  jq --exit-status --raw-output \
    --arg prefix "${role}/" \
    '.role_secret_ids
      | to_entries[]
      | select(.key | startswith($prefix))
      | [.key, .value]
      | @tsv' \
    "${platform_output_file}"
)

if ! "${scw_cli}" container container update \
  "${update_arguments[@]}" \
  region="${region}" \
  --wait \
  >/dev/null; then
  echo "Failed to update the ${role} container" >&2
  exit 1
fi

echo "Deployed ${role} at ${revision} (${image_digest})"
