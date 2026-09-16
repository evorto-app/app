#!/usr/bin/env bash
set -euo pipefail

wall_clock_timeout_script="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
)/run-with-wall-clock-timeout.ts"
readonly wall_clock_timeout_script
readonly docker_command_timeout_seconds=10
readonly timeout_termination_grace_seconds=2
readonly compose_project_name="${COMPOSE_PROJECT_NAME:-}"

if [[ -z "${compose_project_name}" ]]; then
  printf '%s\n' 'COMPOSE_PROJECT_NAME is required to resume a local Docker stack.' >&2
  exit 2
fi

runtime_services=(db minio mailpit stripe worker evorto)
completed_setup_services=(db-setup minio-init)
db_container_id=''
mailpit_container_id=''
minio_container_id=''
stripe_container_id=''
worker_container_id=''
evorto_container_id=''

print_compose_state() {
  printf '%s\n' 'Current Docker Compose state:' >&2
  if ! bun "${wall_clock_timeout_script}" \
    "${docker_command_timeout_seconds}" \
    "${timeout_termination_grace_seconds}" \
    docker compose ps --all >&2; then
    printf '%s\n' 'Unable to inspect the current Docker Compose state.' >&2
  fi
}

run_docker_command() {
  local description="$1"
  shift

  local status
  if bun "${wall_clock_timeout_script}" \
    "${docker_command_timeout_seconds}" \
    "${timeout_termination_grace_seconds}" \
    docker "$@"; then
    return 0
  else
    status="$?"
  fi

  if [[ "${status}" -eq 124 ]]; then
    printf 'Docker %s exceeded its %s-second wall-clock limit.\n' \
      "${description}" "${docker_command_timeout_seconds}" >&2
  else
    printf 'Docker %s failed with status %s.\n' \
      "${description}" "${status}" >&2
  fi
  print_compose_state
  return "${status}"
}

require_existing_container() {
  local service="$1"
  local container_id
  if container_id="$(
    run_docker_command \
      "inspection for existing ${service} container" \
      compose ps --all -q "${service}"
  )"; then
    :
  else
    return "$?"
  fi
  container_id="${container_id//[[:space:]]/}"

  if [[ -z "${container_id}" ]]; then
    printf '%s\n' \
      "Refusing to resume because this Compose project has no existing ${service} container. Start a fresh stack with bun run docker:start." \
      >&2
    exit 1
  fi

  printf '%s' "${container_id}"
}

for service in "${runtime_services[@]}"; do
  container_id="$(require_existing_container "${service}")"
  case "${service}" in
    db) db_container_id="${container_id}" ;;
    mailpit) mailpit_container_id="${container_id}" ;;
    minio) minio_container_id="${container_id}" ;;
    stripe) stripe_container_id="${container_id}" ;;
    worker) worker_container_id="${container_id}" ;;
    evorto) evorto_container_id="${container_id}" ;;
  esac
done

for service in "${completed_setup_services[@]}"; do
  container_id="$(require_existing_container "${service}")"
  if completion_state="$(
    run_docker_command \
      "inspection for ${service} completion" \
      inspect --format '{{.State.Status}} {{.State.ExitCode}}' "${container_id}"
  )"; then
    :
  else
    exit "$?"
  fi
  completion_state="$(
    printf '%s' "${completion_state}" | tr -s '[:space:]' ' '
  )"
  completion_state="${completion_state# }"
  completion_state="${completion_state% }"

  if [[ "${completion_state}" != 'exited 0' ]]; then
    printf '%s\n' \
      "Refusing to resume because the existing ${service} container did not complete successfully (state: ${completion_state:-unknown}). Start a fresh stack with bun run docker:start." \
      >&2
    exit 1
  fi
done

run_docker_command \
  'startup for database, object storage, and email services' \
  start "${db_container_id}" "${minio_container_id}" "${mailpit_container_id}" \
  >/dev/null

wait_for_healthy_container() {
  local service="$1"
  local container_id="$2"
  local require_healthcheck="${3:-false}"
  local inspect_format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}'
  local state=''

  if [[ "${require_healthcheck}" == 'true' ]]; then
    inspect_format='{{if .State.Health}}{{.State.Health.Status}}{{else}}missing-healthcheck{{end}}'
  fi

  for _ in $(seq 1 120); do
    if state="$(
      run_docker_command \
        "health inspection for ${service}" \
        inspect \
        --format "${inspect_format}" \
        "${container_id}"
    )"; then
      :
    else
      return "$?"
    fi
    case "${state}" in
      healthy | running) return 0 ;;
      missing-healthcheck)
        printf '%s\n' \
          "Refusing to continue the resume because the existing ${service} container has no healthcheck. Start a fresh stack with bun run docker:start." \
          >&2
        return 1
        ;;
      dead | exited | unhealthy)
        printf '%s\n' \
          "Refusing to continue the resume because ${service} entered state ${state}. Inspect the existing container and use bun run docker:start for a fresh stack." \
          >&2
        return 1
        ;;
    esac
    sleep 1
  done

  printf '%s\n' \
    "Timed out waiting for the existing ${service} container to become healthy (last state: ${state:-unknown})." \
    >&2
  return 1
}

wait_for_healthy_container db "${db_container_id}"
wait_for_healthy_container minio "${minio_container_id}"
wait_for_healthy_container mailpit "${mailpit_container_id}"

run_docker_command \
  'startup for Stripe listener' \
  start "${stripe_container_id}" >/dev/null
wait_for_healthy_container stripe "${stripe_container_id}" true

run_docker_command \
  'startup for background worker' \
  start "${worker_container_id}" >/dev/null

run_docker_command 'startup for web application' start "${evorto_container_id}"
