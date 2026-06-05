#!/usr/bin/env bash
set -euo pipefail

mode="${1:-e2e}"

require_env_message() {
  local name="$1"
  local message="$2"

  if [ -z "${!name:-}" ]; then
    echo "::error::${message}"
    exit 1
  fi
}

reject_env_value() {
  local name="$1"
  local rejected_value="$2"
  local message="$3"

  if [ "${!name:-}" = "${rejected_value}" ]; then
    echo "::error::${message}"
    exit 1
  fi
}

require_secret() {
  require_env_message "$1" "Missing required secret: $1"
}

require_repository_variable() {
  require_env_message "$1" "Missing required repository variable: $1"
}

require_neon_cleanup_env() {
  require_secret "NEON_API_KEY"
  require_repository_variable "NEON_PROJECT_ID"
}

case "${mode}" in
  e2e)
    require_neon_cleanup_env

    if [ -z "${PARENT_BRANCH_ID:-}" ]; then
      echo "::notice::PARENT_BRANCH_ID is not configured; Neon Local will create ephemeral E2E branches from the project default branch."
    fi

    require_env_message "STRIPE_TEST_ACCOUNT_ID" "Missing required Stripe connected account id. Set STRIPE_TEST_ACCOUNT_ID as a secret or repository variable."
    require_secret "CLIENT_SECRET"
    require_env_message "ISSUER_BASE_URL" "Missing required Auth0 issuer URL. Set ISSUER_BASE_URL as a secret or repository variable."
    reject_env_value "ISSUER_BASE_URL" "https://tumi-dev.eu.auth0.com" "ISSUER_BASE_URL is using fallback; set ISSUER_BASE_URL via GitHub secrets/vars."
    require_secret "SECRET"
    reject_env_value "SECRET" "ci-localtestingsecret" "SECRET is using fallback; set SECRET via GitHub secrets/vars."
    require_secret "STRIPE_API_KEY"
    ;;
  neon-cleanup)
    require_neon_cleanup_env
    ;;
  *)
    echo "::error::Unsupported CI runtime validation mode: ${mode}"
    exit 1
    ;;
esac
