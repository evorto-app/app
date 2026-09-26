#!/usr/bin/env bash
set -euo pipefail

# Database and Stripe CLI logs can contain credentials and are never collected.
options=(--no-color)
for option in "$@"; do
  case "$option" in
    --follow) options+=(--follow) ;;
    --tail=*)
      if [[ ! "${option#--tail=}" =~ ^[0-9]+$ ]]; then
        echo 'Diagnostic log tail must be a nonnegative integer' >&2
        exit 2
      fi
      options+=("$option")
      ;;
    *)
      echo 'Usage: collect-docker-diagnostics.sh [--follow] [--tail=COUNT]' >&2
      exit 2
      ;;
  esac
done

exec docker compose logs "${options[@]}" \
  db-setup mailpit minio minio-init worker evorto
