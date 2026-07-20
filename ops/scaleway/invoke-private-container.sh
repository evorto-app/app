#!/usr/bin/env bash

set -euo pipefail

readonly endpoint="${1:?Pass the private container endpoint}"
readonly path="${2:?Pass the bounded operation path}"
readonly body="${3:?Pass the bounded JSON body}"

: "${SCW_SECRET_KEY:?SCW_SECRET_KEY is required to invoke a private container}"

if [[ "${endpoint}" != https://* || "${path}" != /internal/* ]]; then
  echo "Refusing to call an unexpected private-container target" >&2
  exit 1
fi
if ! jq --exit-status 'type == "object"' <<<"${body}" >/dev/null; then
  echo "Private-container arguments must be a JSON object" >&2
  exit 1
fi

response_file="$(mktemp)"
chmod 600 "${response_file}"
trap 'rm -f "${response_file}"' EXIT

curl_exit=0
http_status="$(
  curl \
  --fail-with-body \
  --header 'Content-Type: application/json' \
  --header "X-Auth-Token: ${SCW_SECRET_KEY}" \
  --output "${response_file}" \
  --request POST \
  --silent \
  --show-error \
  --data-binary "${body}" \
  --write-out '%{http_code}' \
  "${endpoint%/}${path}"
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

cat "${response_file}"
