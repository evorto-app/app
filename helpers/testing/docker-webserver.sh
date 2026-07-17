#!/usr/bin/env bash
set -uo pipefail

compose_pid=''
cleanup_started='false'
readonly compose_project_name="${COMPOSE_PROJECT_NAME:-}"
readonly teardown_attempts=2
readonly teardown_attempt_timeout_seconds=90
readonly verification_command_timeout_seconds=10
readonly timeout_termination_grace_seconds=2
readonly compose_supervisor_exit_attempts=50
wall_clock_timeout_script="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
)/run-with-wall-clock-timeout.ts"
readonly wall_clock_timeout_script

ensure_disposable_project() {
  local db_container_id
  local project_status

  db_container_id="$(docker compose ps --all -q db)"
  project_status="$?"
  if [[ "${project_status}" -ne 0 ]]; then
    printf 'Unable to inspect the existing Docker Compose project (status %s).\n' \
      "${project_status}" >&2
    return "${project_status}"
  fi
  db_container_id="${db_container_id//[[:space:]]/}"
  if [[ -z "${db_container_id}" ]]; then
    return 0
  fi
  printf '%s\n' \
    'Refusing disposable Playwright ownership because this project already has a PostgreSQL container. Resume it with bun run docker:resume, or intentionally reset it with bun run docker:start.' \
    >&2
  return 3
}

verify_project_removed() {
  local project_filter="label=com.docker.compose.project=${compose_project_name}"
  local remaining_containers
  local remaining_networks
  local remaining_volumes

  remaining_containers="$(
    bun "${wall_clock_timeout_script}" \
      "${verification_command_timeout_seconds}" \
      "${timeout_termination_grace_seconds}" \
      docker ps --all --quiet --filter "${project_filter}"
  )"
  local container_status="$?"
  if [[ "${container_status}" -ne 0 ]]; then
    printf 'Unable to verify Docker Compose container cleanup (status %s).\n' \
      "${container_status}" >&2
    return "${container_status}"
  fi

  remaining_networks="$(
    bun "${wall_clock_timeout_script}" \
      "${verification_command_timeout_seconds}" \
      "${timeout_termination_grace_seconds}" \
      docker network ls --quiet --filter "${project_filter}"
  )"
  local network_status="$?"
  if [[ "${network_status}" -ne 0 ]]; then
    printf 'Unable to verify Docker Compose network cleanup (status %s).\n' \
      "${network_status}" >&2
    return "${network_status}"
  fi

  remaining_volumes="$(
    bun "${wall_clock_timeout_script}" \
      "${verification_command_timeout_seconds}" \
      "${timeout_termination_grace_seconds}" \
      docker volume ls --quiet --filter "${project_filter}"
  )"
  local volume_status="$?"
  if [[ "${volume_status}" -ne 0 ]]; then
    printf 'Unable to verify Docker Compose volume cleanup (status %s).\n' \
      "${volume_status}" >&2
    return "${volume_status}"
  fi

  if [[ -n "${remaining_containers}" || -n "${remaining_networks}" || -n "${remaining_volumes}" ]]; then
    printf 'Docker Compose teardown left project containers, networks, or volumes behind.\n' >&2
    return 1
  fi

  return 0
}

teardown_compose_project() {
  local attempt
  local down_status
  local teardown_status=1

  for ((attempt = 1; attempt <= teardown_attempts; attempt += 1)); do
    bun "${wall_clock_timeout_script}" \
      "${teardown_attempt_timeout_seconds}" \
      "${timeout_termination_grace_seconds}" \
      docker compose down --timeout 60 --remove-orphans --volumes
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

terminate_compose_process() {
  local pid="${compose_pid}"

  compose_pid=''
  if [[ -z "${pid}" ]]; then
    return 0
  fi

  if kill -0 "${pid}" 2>/dev/null; then
    kill -TERM "${pid}" 2>/dev/null

    local attempt
    for ((attempt = 1; attempt <= compose_supervisor_exit_attempts; attempt += 1)); do
      if ! kill -0 "${pid}" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done

    if kill -0 "${pid}" 2>/dev/null; then
      kill -KILL "${pid}" 2>/dev/null
    fi
  fi

  wait "${pid}" 2>/dev/null
  return 0
}

run_compose_command() {
  bun "${wall_clock_timeout_script}" \
    0 \
    "${timeout_termination_grace_seconds}" \
    docker compose "$@" &
  compose_pid="$!"
  wait "${compose_pid}"
  local command_status="$?"
  compose_pid=''
  return "${command_status}"
}

cleanup() {
  local requested_status="${1:-0}"

  if [[ "${cleanup_started}" == 'true' ]]; then
    return
  fi
  cleanup_started='true'
  trap - EXIT HUP INT TERM

  set +e
  terminate_compose_process
  teardown_compose_project
  local teardown_status="$?"

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

ensure_disposable_project
ownership_status="$?"
if [[ "${ownership_status}" -ne 0 ]]; then
  exit "${ownership_status}"
fi

export E2E_RUNTIME_MODE=playwright

trap 'cleanup "$?"' EXIT
trap 'handle_signal HUP' HUP
trap 'handle_signal INT' INT
trap 'handle_signal TERM' TERM

run_compose_command build
build_status="$?"
if [[ "${build_status}" -ne 0 ]]; then
  exit "${build_status}"
fi

run_compose_command up --no-build --abort-on-container-failure
up_status="$?"
exit "${up_status}"
