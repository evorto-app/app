#!/usr/bin/env bash
set -euo pipefail

compose() {
  if [ -x node_modules/.bin/dotenv ]; then
    node_modules/.bin/dotenv -c dev -- docker compose "$@"
  else
    docker compose "$@"
  fi
}

compose_timeout() {
  if [ -x node_modules/.bin/dotenv ]; then
    timeout 90s node_modules/.bin/dotenv -c dev -- docker compose "$@"
  else
    timeout 90s docker compose "$@"
  fi
}

remove_compose_project_containers() {
  compose_project_name="${COMPOSE_PROJECT_NAME:-evorto-ci}"
  compose_container_ids="$(timeout 30s docker ps -aq --filter "label=com.docker.compose.project=${compose_project_name}" || true)"
  if [ -n "${compose_container_ids}" ]; then
    for compose_container_id in ${compose_container_ids}; do
      timeout 45s docker rm -f -v "${compose_container_id}" || true
    done
  fi
}

compose_timeout stop --timeout 60 db || true
compose_timeout down --timeout 60 --remove-orphans || true
compose_timeout kill db || true
compose_timeout kill || true
compose_timeout rm --force --stop -v || true
remove_compose_project_containers
timeout 5m bash helpers/testing/ci-prune-neon-local-branches.sh || true
