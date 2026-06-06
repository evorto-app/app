#!/usr/bin/env bash
set -euo pipefail

compose() {
  if [ -x node_modules/.bin/dotenv ]; then
    node_modules/.bin/dotenv -c dev -- docker compose "$@"
  else
    docker compose "$@"
  fi
}

with_timeout() {
  duration="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    timeout "${duration}" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "${duration}" "$@"
  else
    "$@"
  fi
}

compose_timeout() {
  if [ -x node_modules/.bin/dotenv ]; then
    with_timeout 90s node_modules/.bin/dotenv -c dev -- docker compose "$@"
  else
    with_timeout 90s docker compose "$@"
  fi
}

remove_compose_project_containers() {
  compose_project_name="${COMPOSE_PROJECT_NAME:-evorto-ci}"
  compose_container_ids="$(with_timeout 30s docker ps -aq --filter "label=com.docker.compose.project=${compose_project_name}" || true)"
  if [ -n "${compose_container_ids}" ]; then
    for compose_container_id in ${compose_container_ids}; do
      with_timeout 45s docker rm -f -v "${compose_container_id}" || true
    done
  fi
}

compose_timeout stop --timeout 60 db || true
compose_timeout down --timeout 60 --remove-orphans || true
compose_timeout kill db || true
compose_timeout kill || true
compose_timeout rm --force --stop -v || true
remove_compose_project_containers
with_timeout 5m bash helpers/testing/ci-prune-neon-local-branches.sh || true
