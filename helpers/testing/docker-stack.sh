#!/usr/bin/env bash
set -uo pipefail

readonly wall_clock_timeout_script="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
)/run-with-wall-clock-timeout.ts"
readonly termination_grace_seconds=2
readonly inspection_timeout_seconds=10
readonly teardown_timeout_seconds=90
readonly build_timeout_seconds=720
readonly startup_timeout_seconds=300
readonly compose_project_name="${COMPOSE_PROJECT_NAME:-}"

if [[ -z "${compose_project_name}" ]]; then
  printf '%s\n' 'COMPOSE_PROJECT_NAME is required for local Docker commands.' >&2
  exit 2
fi

print_compose_state() {
  printf '%s\n' 'Current Docker Compose state:' >&2
  if ! bun "${wall_clock_timeout_script}" \
    "${inspection_timeout_seconds}" \
    "${termination_grace_seconds}" \
    docker compose ps --all >&2; then
    printf '%s\n' 'Unable to inspect the current Docker Compose state.' >&2
  fi

  printf '%s\n' 'Recent Docker Compose logs:' >&2
  if ! bun "${wall_clock_timeout_script}" \
    "${inspection_timeout_seconds}" \
    "${termination_grace_seconds}" \
    docker compose logs --no-color --tail=80 >&2; then
    printf '%s\n' 'Unable to read recent Docker Compose logs.' >&2
  fi
}

run_compose_command() {
  local description="$1"
  local timeout_seconds="$2"
  shift 2

  local status
  if bun "${wall_clock_timeout_script}" \
    "${timeout_seconds}" \
    "${termination_grace_seconds}" \
    docker compose "$@"; then
    return 0
  else
    status="$?"
  fi

  if [[ "${status}" -eq 124 ]]; then
    printf 'Docker Compose %s exceeded its %s-second wall-clock limit.\n' \
      "${description}" "${timeout_seconds}" >&2
  else
    printf 'Docker Compose %s failed with status %s.\n' \
      "${description}" "${status}" >&2
  fi
  print_compose_state
  return "${status}"
}

prepare_stack() {
  run_compose_command \
    teardown \
    "${teardown_timeout_seconds}" \
    down --timeout 60 --remove-orphans || return "$?"
  run_compose_command \
    build \
    "${build_timeout_seconds}" \
    build || return "$?"
}

start_detached_stack() {
  prepare_stack || return "$?"
  run_compose_command \
    startup \
    "${startup_timeout_seconds}" \
    up --no-build --detach
}

show_stack_status() {
  local status
  if bun "${wall_clock_timeout_script}" \
    "${inspection_timeout_seconds}" \
    "${termination_grace_seconds}" \
    docker compose ps --all; then
    return 0
  else
    status="$?"
  fi

  if [[ "${status}" -eq 124 ]]; then
    printf 'Docker Compose status inspection exceeded its %s-second wall-clock limit.\n' \
      "${inspection_timeout_seconds}" >&2
  else
    printf 'Docker Compose status inspection failed with status %s.\n' \
      "${status}" >&2
  fi
  return "${status}"
}

run_foreground_stack() {
  local mode="$1"
  prepare_stack || return "$?"

  case "${mode}" in
    foreground) docker compose up --no-build ;;
    watch) docker compose up --no-build --watch ;;
  esac
  local status="$?"
  if [[ "${status}" -ne 0 ]]; then
    printf 'Docker Compose %s session failed with status %s.\n' \
      "${mode}" "${status}" >&2
    print_compose_state
  fi
  return "${status}"
}

case "${1:-}" in
  start) start_detached_stack ;;
  start-foreground) run_foreground_stack foreground ;;
  start-watch) run_foreground_stack watch ;;
  status) show_stack_status ;;
  stop)
    run_compose_command \
      teardown \
      "${teardown_timeout_seconds}" \
      down --timeout 60 --remove-orphans
    ;;
  *)
    printf '%s\n' \
      'Usage: helpers/testing/docker-stack.sh start|start-foreground|start-watch|status|stop' \
      >&2
    exit 2
    ;;
esac
