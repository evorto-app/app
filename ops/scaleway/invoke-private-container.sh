#!/usr/bin/env bash

set -euo pipefail

if (($# != 3)); then
  echo "Pass the platform output, role, and operation path; send the JSON body through standard input" >&2
  exit 1
fi

readonly platform_output="${1:?Pass the reviewed Terraform platform output file}"
readonly role="${2:?Pass the private container role}"
readonly operation_path="${3:?Pass the bounded operation path}"
readonly connect_timeout_seconds=10
readonly maximum_time_seconds=300

: "${SCW_DEFAULT_PROJECT_ID:?SCW_DEFAULT_PROJECT_ID is required to verify the private container}"
declare scw_secret_key="${SCW_SECRET_KEY:?SCW_SECRET_KEY is required to invoke a private container}"
export -n scw_secret_key
unset \
  ALL_PROXY \
  all_proxy \
  AWS_ACCESS_KEY_ID \
  AWS_SECRET_ACCESS_KEY \
  AWS_SESSION_TOKEN \
  HTTP_PROXY \
  http_proxy \
  HTTPS_PROXY \
  https_proxy \
  SCW_ACCESS_KEY \
  SCW_SECRET_KEY

if [[ "${scw_secret_key}" == *$'\n'* || "${scw_secret_key}" == *$'\r'* ]]; then
  echo "SCW_SECRET_KEY contains invalid header characters" >&2
  exit 1
fi

if [[ ! -f "${platform_output}" ]]; then
  echo "Refusing to call a private container without reviewed Terraform output" >&2
  exit 1
fi

case "${role}:${operation_path}" in
  ops:/internal/ops/schema-explain | \
    ops:/internal/ops/schema-apply | \
    ops:/internal/ops/seed-staging | \
    worker:/internal/worker/payment-setup) ;;
  *)
    echo "Refusing to call an unexpected private-container operation" >&2
    exit 1
    ;;
esac

endpoint="$({
  jq \
    --exit-status \
    --raw-output \
    --arg project_id "${SCW_DEFAULT_PROJECT_ID}" \
    --arg role "${role}" \
    '
      if type == "object"
        and .project_id == $project_id
        and (.containers | type == "object")
        and (.containers[$role] | type == "object")
        and (.containers[$role].endpoint | type == "string")
      then .containers[$role].endpoint
      else empty
      end
    ' \
    "${platform_output}"
} 2>/dev/null)" || {
  echo "Refusing to call a private container from unverified Terraform output" >&2
  exit 1
}

if [[ ! "${endpoint}" =~ ^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?\.functions\.fnc\.fr-par\.scw\.cloud$ ]]; then
  echo "Refusing to send credentials to an untrusted private-container endpoint" >&2
  exit 1
fi

request_body_file=''
request_headers_file=''
response_file="$(mktemp)"
cleanup() {
  local temporary_file
  for temporary_file in \
    "${request_body_file}" \
    "${request_headers_file}" \
    "${response_file}"; do
    if [[ -n "${temporary_file}" ]]; then
      rm -f -- "${temporary_file}"
    fi
  done
}
trap cleanup EXIT

request_body_file="$(mktemp)"
request_headers_file="$(mktemp)"
chmod 600 "${request_body_file}" "${request_headers_file}" "${response_file}"
cat >"${request_body_file}"

if ! jq --exit-status 'type == "object"' "${request_body_file}" >/dev/null; then
  echo "Private-container input must be a JSON object" >&2
  exit 1
fi

printf '%s\n' \
  'Content-Type: application/json' \
  "X-Auth-Token: ${scw_secret_key}" \
  >"${request_headers_file}"
unset scw_secret_key

curl_exit=0
http_status="$(
  curl \
    --disable \
    --connect-timeout "${connect_timeout_seconds}" \
    --fail-with-body \
    --header "@${request_headers_file}" \
    --max-redirs 0 \
    --max-time "${maximum_time_seconds}" \
    --noproxy '*' \
    --output "${response_file}" \
    --proto '=https' \
    --request POST \
    --silent \
    --show-error \
    --data-binary "@${request_body_file}" \
    --write-out '%{http_code}' \
    "${endpoint}${operation_path}"
)" || curl_exit=$?

if ((curl_exit != 0)); then
  if jq --exit-status '
    . as $response
    | type == "object"
      and (keys == ["detail", "error"])
      and .error == "ops-command-failed"
      and ([
        "bounded-command-failed",
        "command-failed",
        "database-authentication-failed",
        "database-configuration-invalid",
        "database-host-resolution-failed",
        "database-not-found",
        "database-permission-denied",
        "database-tls-ca-untrusted",
        "database-tls-certificate-expired",
        "database-tls-certificate-not-yet-valid",
        "database-tls-hostname-mismatch",
        "database-tls-verification-failed",
        "database-unreachable",
        "drizzle-application-unconfirmed",
        "drizzle-cli-incompatible",
        "drizzle-invalid-json",
        "runtime-artifact-missing",
        "staging-schema-unconfirmed"
      ] | index($response.detail)) != null
  ' "${response_file}" >/dev/null 2>&1; then
    diagnostic="$(jq --raw-output '.detail' "${response_file}")"
    echo "Private-container ops request failed: ${diagnostic}" >&2
  else
    echo "Private-container request failed with HTTP ${http_status:-unknown}" >&2
  fi
  exit "${curl_exit}"
fi

if [[ ! "${http_status}" =~ ^2[0-9]{2}$ ]]; then
  echo "Private-container request failed with HTTP ${http_status:-unknown}" >&2
  exit 1
fi

cat "${response_file}"
