#!/usr/bin/env bash

set -euo pipefail
umask 077

readonly configuration="${1:?Pass the accepted deployment configuration JSON}"
readonly expected_digest="${2:?Pass its SHA-256 digest}"
readonly output_directory="${3:?Pass the private output directory}"
: "${SCW_DEFAULT_PROJECT_ID:?SCW_DEFAULT_PROJECT_ID is required}"
: "${STRIPE_TEST_ACCOUNT_ID:?STRIPE_TEST_ACCOUNT_ID is required}"

if [[ ! "${expected_digest}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Invalid staging configuration digest" >&2
  exit 1
fi
if [[ ! "${STRIPE_TEST_ACCOUNT_ID}" =~ ^acct_[A-Za-z0-9]+$ ]]; then
  echo "Invalid staging Stripe test account ID" >&2
  exit 1
fi
actual_digest="$(shasum --algorithm 256 "${configuration}" | awk '{print $1}')"
if [[ "${actual_digest}" != "${expected_digest}" ]]; then
  echo "Staging configuration does not match its immutable object key" >&2
  exit 1
fi

if ! jq --exit-status \
  --arg project "${SCW_DEFAULT_PROJECT_ID}" \
  'def uuid: type == "string" and test("^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$");
   def container_id: type == "string" and test("^fr-par/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$");
   def endpoint: type == "string" and test("^https://[a-z0-9-]+\\.functions\\.fnc\\.fr-par\\.scw\\.cloud$");
   def private_ip: type == "string"
     and test("^([0-9]{1,3}\\.){3}[0-9]{1,3}$")
     and (split(".") | map(tonumber)
       | all(.[]; . <= 255)
       and (.[0] == 10 or (.[0] == 172 and .[1] >= 16 and .[1] <= 31)
         or (.[0] == 192 and .[1] == 168)));
   .version == 1
   and .environment == "staging"
   and (.platform.project_id | uuid)
   and .platform.project_id == $project
   and (.platform.containers | keys | sort) == ["ops", "web", "worker"]
   and ([.platform.containers[].id] | unique | length) == 3
   and (.platform.containers | to_entries | all(.[];
     (.value.id | container_id)
     and (.value.endpoint | endpoint)
     and .value.environment_variables.APP_ROLE == .key
     and .value.environment_variables.APP_ENVIRONMENT == "staging"
     and (.value.environment_variables | type == "object"
       and all(.[]; type == "string"))))
   and .platform.containers.web.environment_variables.BASE_URL == "https://staging.evorto.app"
   and (.platform.application_bucket | type == "string" and test("^evorto-staging-application-[a-z0-9-]+$"))
   and (.platform.deployment_metadata_bucket | type == "string" and test("^evorto-staging-deployment-[a-z0-9-]+$"))
   and (.platform.role_secret_ids | type == "object" and length > 0
     and (keys | all(.[]; test("^(ops|web|worker)/[A-Z][A-Z0-9_]*$")))
     and all(.[]; uuid))
   and (.database.host | private_ip)
   and (.database.port | type == "number" and . >= 1 and . <= 65535 and floor == .)
   and .database.database_name == "evorto"
   and .database.runtime_user == "application_runtime"
   and .database.schema_user == "schema_owner"
   and (.database.certificate | type == "string" and startswith("-----BEGIN CERTIFICATE-----"))' \
  "${configuration}" >/dev/null; then
  echo "Invalid staging deployment configuration" >&2
  exit 1
fi

mkdir -p "${output_directory}"
jq --arg account "${STRIPE_TEST_ACCOUNT_ID}" \
  '.platform | .containers.ops.environment_variables.STRIPE_TEST_ACCOUNT_ID = $account' \
  "${configuration}" >"${output_directory}/platform.json"
jq '.database' "${configuration}" >"${output_directory}/database.json"
