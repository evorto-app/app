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

curl \
  --fail-with-body \
  --header 'Content-Type: application/json' \
  --header "X-Auth-Token: ${SCW_SECRET_KEY}" \
  --request POST \
  --retry 3 \
  --silent \
  --show-error \
  --data-binary "${body}" \
  "${endpoint%/}${path}"
