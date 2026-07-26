#!/usr/bin/env bash

set -euo pipefail

readonly platform_output_file="${1:?Pass the environment Terraform output JSON file}"
readonly role="${2:?Pass web, worker, or ops}"
readonly image_reference="${3:?Pass the immutable image reference}"
readonly revision="${4:?Pass the full Git revision}"
readonly image_digest="${5:?Pass the sha256 image digest}"
readonly schema_hash="${6:?Pass the packaged schema sha256}"
readonly deployment_status_file="${7:-}"
readonly scw_cli="${SCW_CLI:-scw}"
readonly region="${SCW_DEFAULT_REGION:-fr-par}"
readonly trace_sampling_ratio_override="${TRACE_SAMPLING_RATIO_OVERRIDE:-}"

: "${SCW_SECRET_KEY:?SCW_SECRET_KEY is required}"

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
if [[ -n "${trace_sampling_ratio_override}" && ! "${trace_sampling_ratio_override}" =~ ^(0([.][0-9]+)?|1([.]0+)?)$ ]]; then
  echo "TRACE_SAMPLING_RATIO_OVERRIDE must be between 0 and 1" >&2
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
readonly current_container_file="${temporary_directory}/current-container.json"
readonly fingerprint_input_file="${temporary_directory}/fingerprint-input"
readonly secret_keys_file="${temporary_directory}/secret-keys.json"

jq \
  --arg role "${role}" \
  --arg revision "${revision}" \
  --arg image_digest "${image_digest}" \
  --arg schema_hash "${schema_hash}" \
  --arg trace_sampling_ratio_override "${trace_sampling_ratio_override}" \
    '.containers[$role].environment_variables
    + {
        APP_BOOTSTRAP: "false",
        APP_REVISION: $revision,
        APP_IMAGE_DIGEST: $image_digest
      }
    + (if $role == "ops" then { APP_SCHEMA_HASH: $schema_hash } else {} end)
    + (if $trace_sampling_ratio_override == ""
       then {}
       else { TRACE_SAMPLING_RATIO: $trace_sampling_ratio_override }
       end)' \
  "${platform_output_file}" \
  >"${environment_file}"

{
  printf '%s\0%s\0%s\0%s\0' \
    "${role}" \
    "${image_reference}" \
    "${image_digest}" \
    "${schema_hash}"
  jq --compact-output --sort-keys . "${environment_file}"
  printf '\0'
} >"${fingerprint_input_file}"

jq \
  --arg prefix "${role}/" \
  '[.role_secret_ids | keys[] | select(startswith($prefix)) | ltrimstr($prefix)] | sort' \
  "${platform_output_file}" \
  >"${secret_keys_file}"

secret_update_arguments=()

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
  secret_update_arguments+=(
    "secret-environment-variables.${secret_name}=${value}"
  )
  printf '%s\0%s\0' "${contract_key}" "${value}" >>"${fingerprint_input_file}"
done < <(
  jq --exit-status --raw-output \
    --arg prefix "${role}/" \
    '.role_secret_ids
      | to_entries
      | map(select(.key | startswith($prefix)))
      | sort_by(.key)
      | .[]
      | [.key, .value]
      | @tsv' \
    "${platform_output_file}"
)

deployment_fingerprint="$(
  {
    printf '%s\0' "${SCW_SECRET_KEY}"
    cat "${fingerprint_input_file}"
  } | shasum -a 256 | awk '{ print $1 }'
)"
updated_environment_file="${temporary_directory}/environment-with-fingerprint.json"
jq \
  --arg deployment_fingerprint "${deployment_fingerprint}" \
  '. + { APP_DEPLOYMENT_FINGERPRINT: $deployment_fingerprint }' \
  "${environment_file}" \
  >"${updated_environment_file}"
mv "${updated_environment_file}" "${environment_file}"

if ! "${scw_cli}" container container get \
  "${container_id}" \
  region="${region}" \
  -o json \
  >"${current_container_file}"; then
  echo "Failed to inspect the ${role} container before deployment" >&2
  exit 1
fi

if jq --exit-status \
  --arg image_reference "${image_reference}" \
  --slurpfile desired_environment "${environment_file}" \
  --slurpfile desired_secret_keys "${secret_keys_file}" \
  '.status == "ready"
    and (.image // .registry_image) == $image_reference
    and .environment_variables == $desired_environment[0]
    and ([.secret_environment_variables[]?.key] | sort) == $desired_secret_keys[0]' \
  "${current_container_file}" \
  >/dev/null; then
  if [[ -n "${deployment_status_file}" ]]; then
    printf 'false\n' >"${deployment_status_file}"
  fi
  echo "${role} already matches ${revision} (${image_digest}); deployment skipped"
  exit 0
fi

update_arguments=("${container_id}" "image=${image_reference}")
while IFS=$'\t' read -r key encoded_value; do
  value="$(printf '%s' "${encoded_value}" | base64 --decode)"
  update_arguments+=("environment-variables.${key}=${value}")
done < <(
  jq --raw-output \
    'to_entries | sort_by(.key)[] | [.key, (.value | @base64)] | @tsv' \
    "${environment_file}"
)
if (( ${#secret_update_arguments[@]} > 0 )); then
  update_arguments+=("${secret_update_arguments[@]}")
fi

if ! "${scw_cli}" container container update \
  "${update_arguments[@]}" \
  region="${region}" \
  --wait \
  >/dev/null; then
  echo "Failed to update the ${role} container" >&2
  exit 1
fi

if [[ -n "${deployment_status_file}" ]]; then
  printf 'true\n' >"${deployment_status_file}"
fi
echo "Deployed ${role} at ${revision} (${image_digest})"
