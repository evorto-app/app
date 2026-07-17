#!/usr/bin/env bash
set -euo pipefail

runtime_services=(db minio mailpit stripe worker evorto)
completed_setup_services=(db-setup minio-init)
db_container_id=''
mailpit_container_id=''
minio_container_id=''
stripe_container_id=''
worker_container_id=''
evorto_container_id=''

require_existing_container() {
  local service="$1"
  local container_id
  container_id="$(docker compose ps --all -q "${service}")"
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
  completion_state="$(
    docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' "${container_id}"
  )"
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

docker start "${db_container_id}" "${minio_container_id}" "${mailpit_container_id}" >/dev/null

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
    state="$(
      docker inspect \
        --format "${inspect_format}" \
        "${container_id}"
    )"
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

docker start "${stripe_container_id}" >/dev/null
wait_for_healthy_container stripe "${stripe_container_id}" true

docker start "${worker_container_id}" >/dev/null

exec docker start "${evorto_container_id}"
