#!/usr/bin/env bash
set -uo pipefail

compose_pid=''
cleanup_started='false'
readonly compose_project_name="${COMPOSE_PROJECT_NAME:-}"
readonly teardown_attempts=2

verify_project_removed() {
  local project_filter="label=com.docker.compose.project=${compose_project_name}"
  local remaining_containers
  local remaining_networks

  remaining_containers="$(
    docker ps --all --quiet --filter "${project_filter}"
  )"
  local container_status="$?"
  if [[ "${container_status}" -ne 0 ]]; then
    printf 'Unable to verify Docker Compose container cleanup (status %s).\n' \
      "${container_status}" >&2
    return "${container_status}"
  fi

  remaining_networks="$(
    docker network ls --quiet --filter "${project_filter}"
  )"
  local network_status="$?"
  if [[ "${network_status}" -ne 0 ]]; then
    printf 'Unable to verify Docker Compose network cleanup (status %s).\n' \
      "${network_status}" >&2
    return "${network_status}"
  fi

  if [[ -n "${remaining_containers}" || -n "${remaining_networks}" ]]; then
    printf 'Docker Compose teardown left project containers or networks behind.\n' >&2
    return 1
  fi

  return 0
}

teardown_compose_project() {
  local attempt
  local down_status
  local teardown_status=1

  for ((attempt = 1; attempt <= teardown_attempts; attempt += 1)); do
    docker compose down --timeout 60 --remove-orphans
    down_status="$?"
    if [[ "${down_status}" -ne 0 ]]; then
      teardown_status="${down_status}"
      printf 'Docker Compose teardown attempt %s/%s failed (status %s).\n' \
        "${attempt}" "${teardown_attempts}" "${down_status}" >&2
      continue
    fi

    verify_project_removed
    teardown_status="$?"
    if [[ "${teardown_status}" -eq 0 ]]; then
      return 0
    fi

    printf 'Docker Compose teardown verification attempt %s/%s failed.\n' \
      "${attempt}" "${teardown_attempts}" >&2
  done

  printf 'Docker Compose teardown failed after %s attempts.\n' \
    "${teardown_attempts}" >&2
  return "${teardown_status}"
}

cleanup() {
  local requested_status="${1:-0}"

  if [[ "${cleanup_started}" == 'true' ]]; then
    return
  fi
  cleanup_started='true'
  trap - EXIT HUP INT TERM

  set +e
  teardown_compose_project
  local teardown_status="$?"

  if [[ -n "${compose_pid}" ]] && kill -0 "${compose_pid}" 2>/dev/null; then
    kill -TERM "${compose_pid}" 2>/dev/null
    wait "${compose_pid}" 2>/dev/null
  fi

  if [[ "${teardown_status}" -ne 0 ]]; then
    exit "${teardown_status}"
  fi
  exit "${requested_status}"
}

handle_signal() {
  case "$1" in
    HUP) cleanup 129 ;;
    INT) cleanup 130 ;;
    TERM) cleanup 143 ;;
  esac
}

if [[ -z "${compose_project_name}" ]]; then
  printf 'COMPOSE_PROJECT_NAME is required for verified Docker teardown.\n' >&2
  exit 2
fi

trap 'cleanup "$?"' EXIT
trap 'handle_signal HUP' HUP
trap 'handle_signal INT' INT
trap 'handle_signal TERM' TERM

docker compose up --build &
compose_pid="$!"
wait "${compose_pid}"
up_status="$?"
compose_pid=''
exit "${up_status}"
