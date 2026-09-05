#!/usr/bin/env bash
set -uo pipefail

compose_pid=''
compose_control_directory=''
compose_control_open='false'
compose_starting='false'
pending_signal_status=''
cleanup_started='false'
readonly compose_project_name="${COMPOSE_PROJECT_NAME:-}"
readonly teardown_attempt_timeout_seconds=90
readonly verification_command_timeout_seconds=10
readonly timeout_termination_grace_seconds=2
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
  local down_status

  bun "${wall_clock_timeout_script}" \
    "${teardown_attempt_timeout_seconds}" \
    "${timeout_termination_grace_seconds}" \
    docker compose down --timeout 60 --remove-orphans --volumes
  down_status="$?"
  if [[ "${down_status}" -ne 0 ]]; then
    printf 'Docker Compose teardown failed (status %s).\n' \
      "${down_status}" >&2
    return "${down_status}"
  fi

  verify_project_removed
  local verification_status="$?"
  if [[ "${verification_status}" -ne 0 ]]; then
    printf '%s\n' 'Docker Compose teardown verification failed.' >&2
    return "${verification_status}"
  fi

  return 0
}

release_compose_control() {
  local release_status=0
  if [[ "${compose_control_open}" == 'true' ]]; then
    if ! exec 8>&-; then
      printf 'Could not close the Compose cancellation channel.\n' >&2
      release_status=1
    fi
    compose_control_open='false'
  fi
  if [[ -n "${compose_control_directory}" ]]; then
    if ! rm -rf -- "${compose_control_directory}"; then
      printf 'Could not remove the Compose cancellation directory: %s\n' \
        "${compose_control_directory}" >&2
      release_status=1
    else
      compose_control_directory=''
    fi
  fi
  return "${release_status}"
}

terminate_compose_process() {
  local cancellation_status=0
  if [[ -n "${compose_pid}" ]]; then
    # fd 8 owns this invocation's pipe; fd 9 retains the project lease even if the child has already exited.
    # A numeric PID is used only by wait, never as cancellation authority.
    if ! printf 'TERM\n' >&8; then
      printf 'Could not request Compose cancellation through its owned channel.\n' >&2
      cancellation_status=1
    fi
    # Closing the only writer also requests cancellation on write failure.
    if ! exec 8>&-; then
      printf 'Could not close the Compose cancellation writer.\n' >&2
      cancellation_status=1
    fi
    compose_control_open='false'
    wait "${compose_pid}"
    local command_status="$?"
    compose_pid=''
    if [[ "${command_status}" -ne 0 && "${command_status}" -ne 143 ]]; then
      printf 'Compose command also failed during cancellation (status %s).\n' \
        "${command_status}" >&2
      cancellation_status=1
    fi
  fi
  release_compose_control
  local release_status="$?"
  if [[ "${release_status}" -ne 0 ]]; then cancellation_status=1; fi
  return "${cancellation_status}"
}

finish_compose_acquisition() {
  compose_starting='false'
  if [[ -n "${pending_signal_status}" ]]; then cleanup "${pending_signal_status}"; fi
}

run_compose_command() {
  compose_starting='true'
  compose_control_directory="$(mktemp -d "${TMPDIR:-/tmp}/evorto-compose-control.XXXXXXXX")"
  if [[ "$?" -ne 0 || -z "${compose_control_directory}" ]]; then
    printf 'Could not acquire the Compose cancellation directory.\n' >&2
    finish_compose_acquisition
    return 1
  fi
  if ! mkfifo -m 600 "${compose_control_directory}/control"; then
    printf 'Could not create the Compose cancellation channel.\n' >&2
    release_compose_control
    finish_compose_acquisition
    return 1
  fi
  if ! exec 8<>"${compose_control_directory}/control"; then
    printf 'Could not acquire the Compose cancellation writer.\n' >&2
    release_compose_control
    finish_compose_acquisition
    return 1
  fi
  compose_control_open='true'
  EVORTO_WALL_CLOCK_CONTROL_FD=3 \
    EVORTO_WALL_CLOCK_CONTROL_PATH="${compose_control_directory}/control" \
    bun "${wall_clock_timeout_script}" \
    0 \
    "${timeout_termination_grace_seconds}" \
    docker compose "$@" 3<"${compose_control_directory}/control" 8>&- &
  compose_pid="$!"
  finish_compose_acquisition
  wait "${compose_pid}"
  local command_status="$?"
  compose_pid=''
  release_compose_control
  local release_status="$?"
  if [[ "${release_status}" -ne 0 ]]; then
    printf 'Compose command status %s was followed by cancellation-channel cleanup failure.\n' \
      "${command_status}" >&2
    if [[ "${command_status}" -eq 0 ]]; then return "${release_status}"; fi
  fi
  return "${command_status}"
}

cleanup() {
  local requested_status="${1:-0}"

  if [[ "${cleanup_started}" == 'true' ]]; then
    return
  fi
  cleanup_started='true'
  trap - EXIT
  # Nested launchers can forward the same signal again while teardown runs.
  # Catch it without inheriting ignored signals into cleanup subprocesses.
  trap ':' HUP INT TERM

  set +e
  terminate_compose_process
  local cancellation_status="$?"
  teardown_compose_project
  local teardown_status="$?"

  if [[ "${cancellation_status}" -ne 0 || "${teardown_status}" -ne 0 ]]; then
    printf 'Cleanup followed original status %s (cancellation %s, teardown %s).\n' \
      "${requested_status}" "${cancellation_status}" "${teardown_status}" >&2
  fi
  if [[ "${teardown_status}" -ne 0 ]]; then
    exit "${teardown_status}"
  fi
  if [[ "${requested_status}" -eq 0 && "${cancellation_status}" -ne 0 ]]; then
    exit "${cancellation_status}"
  fi
  exit "${requested_status}"
}

handle_signal() {
  if [[ -z "${pending_signal_status}" ]]; then
    case "$1" in
      HUP) pending_signal_status=129 ;;
      INT) pending_signal_status=130 ;;
      TERM) pending_signal_status=143 ;;
    esac
  fi
  # Do not interrupt acquisition between launching the helper and retaining $!.
  if [[ "${compose_starting}" != 'true' ]]; then cleanup "${pending_signal_status}"; fi
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
