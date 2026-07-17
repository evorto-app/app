#!/usr/bin/env bash

set -euo pipefail

readonly environment="${1:?Pass staging or production}"
readonly platform_output_file="${2:?Pass the environment Terraform output JSON file}"
readonly database_output_file="${3:?Pass the database Terraform output JSON file}"
readonly protected_values_file="${4:?Pass the protected secret-value JSON file}"
readonly scw_cli="${SCW_CLI:-scw}"

: "${SCHEMA_DATABASE_PASSWORD:?SCHEMA_DATABASE_PASSWORD is required}"
: "${RUNTIME_DATABASE_PASSWORD:?RUNTIME_DATABASE_PASSWORD is required}"

if [[ "${environment}" != 'staging' && "${environment}" != 'production' ]]; then
  echo "Secret synchronization supports only staging or production" >&2
  exit 1
fi

for file in \
  "${platform_output_file}" \
  "${database_output_file}" \
  "${protected_values_file}"; do
  if [[ ! -s "${file}" ]]; then
    echo "Required secret synchronization input is empty: ${file}" >&2
    exit 1
  fi
done

if ! jq --exit-status \
  'type == "object" and all(.[]; type == "string" and length > 0)' \
  "${protected_values_file}" \
  >/dev/null; then
  echo "Protected secret values must be a flat JSON object of non-empty strings" >&2
  exit 1
fi

database_host="$(jq --exit-status --raw-output '.host' "${database_output_file}")"
database_port="$(jq --exit-status --raw-output '.port' "${database_output_file}")"
database_name="$(jq --exit-status --raw-output '.database_name' "${database_output_file}")"
runtime_user="$(jq --exit-status --raw-output '.runtime_user' "${database_output_file}")"
schema_user="$(jq --exit-status --raw-output '.schema_user' "${database_output_file}")"
database_certificate="$(jq --exit-status --raw-output '.certificate' "${database_output_file}")"

if [[ -z "${database_host}" || -z "${database_certificate}" ]]; then
  echo "Terraform did not return the verified private database endpoint and certificate" >&2
  exit 1
fi

runtime_password_encoded="$(
  jq --null-input --raw-output \
    --arg value "${RUNTIME_DATABASE_PASSWORD}" \
    '$value | @uri'
)"
schema_password_encoded="$(
  jq --null-input --raw-output \
    --arg value "${SCHEMA_DATABASE_PASSWORD}" \
    '$value | @uri'
)"
runtime_user_encoded="$(
  jq --null-input --raw-output --arg value "${runtime_user}" '$value | @uri'
)"
schema_user_encoded="$(
  jq --null-input --raw-output --arg value "${schema_user}" '$value | @uri'
)"
database_name_encoded="$(
  jq --null-input --raw-output --arg value "${database_name}" '$value | @uri'
)"

runtime_database_url="postgresql://${runtime_user_encoded}:${runtime_password_encoded}@${database_host}:${database_port}/${database_name_encoded}"
schema_database_url="postgresql://${schema_user_encoded}:${schema_password_encoded}@${database_host}:${database_port}/${database_name_encoded}"

temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT
chmod 700 "${temporary_directory}"
readonly reconciled_values_file="${temporary_directory}/reconciled-values.json"

jq \
  --arg certificate "${database_certificate}" \
  --arg runtime_database_url "${runtime_database_url}" \
  --arg schema_database_url "${schema_database_url}" \
  '. + {
    "web/DATABASE_TLS_CA_CERTIFICATE": $certificate,
    "web/DATABASE_URL": $runtime_database_url,
    "worker/DATABASE_TLS_CA_CERTIFICATE": $certificate,
    "worker/DATABASE_URL": $runtime_database_url,
    "ops/DATABASE_TLS_CA_CERTIFICATE": $certificate,
    "ops/DATABASE_URL": $schema_database_url
  }' \
  "${protected_values_file}" \
  >"${reconciled_values_file}"

if ! jq --exit-status \
  --slurpfile values "${reconciled_values_file}" \
  '(.role_secret_ids | keys | sort) == ($values[0] | keys | sort)' \
  "${platform_output_file}" \
  >/dev/null; then
  echo "Protected secret keys do not exactly match the Terraform role-secret contract" >&2
  diff \
    <(jq --raw-output '.role_secret_ids | keys[]' "${platform_output_file}" | sort) \
    <(jq --raw-output 'keys[]' "${reconciled_values_file}" | sort) \
    >&2 || true
  exit 1
fi

if [[ "${environment}" == 'staging' ]]; then
  if ! jq --exit-status \
    '.["web/STRIPE_API_KEY"] | startswith("sk_test_")' \
    "${reconciled_values_file}" \
    >/dev/null; then
    echo "Staging must use a Stripe test-mode API key" >&2
    exit 1
  fi
  if ! jq --exit-status \
    '.["worker/STRIPE_API_KEY"] | startswith("sk_test_")' \
    "${reconciled_values_file}" \
    >/dev/null; then
    echo "The staging worker must use a Stripe test-mode API key" >&2
    exit 1
  fi
fi

mask_value() {
  local value="$1"
  if [[ "${GITHUB_ACTIONS:-false}" == 'true' ]]; then
    value="${value//'%'/'%25'}"
    value="${value//$'\r'/'%0D'}"
    value="${value//$'\n'/'%0A'}"
    echo "::add-mask::${value}"
  fi
}

while IFS=$'\t' read -r contract_key encoded_value; do
  secret_id="$(
    jq --exit-status --raw-output \
      --arg key "${contract_key}" \
      '.role_secret_ids[$key]' \
      "${platform_output_file}"
  )"
  value_file="${temporary_directory}/value"
  current_value_file="${temporary_directory}/current"
  printf '%s' "${encoded_value}" | base64 --decode >"${value_file}"
  chmod 600 "${value_file}"
  mask_value "$(<"${value_file}")"

  if "${scw_cli}" secret version access \
    "${secret_id}" \
    revision=latest \
    raw=true \
    >"${current_value_file}" 2>/dev/null \
    && cmp --silent "${value_file}" "${current_value_file}"; then
    continue
  fi

  "${scw_cli}" secret version create \
    "${secret_id}" \
    "data=@${value_file}" \
    disable-previous=true \
    description="GitHub deployment reconciliation" \
    >/dev/null
done < <(
  jq --raw-output \
    'to_entries[] | [.key, (.value | @base64)] | @tsv' \
    "${reconciled_values_file}"
)

echo "Reconciled ${environment} role-scoped Secret Manager values"
