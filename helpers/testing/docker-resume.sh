#!/usr/bin/env bash
set -euo pipefail

runtime_services=(db minio stripe evorto)
completed_setup_services=(db-expiration db-setup minio-init)
db_container_id=''
minio_container_id=''
stripe_container_id=''
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
    minio) minio_container_id="${container_id}" ;;
    stripe) stripe_container_id="${container_id}" ;;
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

container_environment="$(
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${db_container_id}"
)"
container_branch_id="$(
  printf '%s\n' "${container_environment}" | sed -n 's/^BRANCH_ID=//p'
)"
container_branch_id="${container_branch_id//[[:space:]]/}"
container_delete_branch="$(
  printf '%s\n' "${container_environment}" |
    sed -n 's/^DELETE_BRANCH=//p' |
    tr '[:upper:]' '[:lower:]' |
    tr -d '[:space:]'
)"

if [[ -z "${container_branch_id}" && "${container_delete_branch:-true}" != "false" ]]; then
  printf '%s\n' \
    'Refusing to resume an ephemeral Neon Local stack. The existing database container was created without BRANCH_ID and with DELETE_BRANCH=true, so its branch is deleted when the container stops. Start a fresh stack with bun run docker:start. To make a future stack resumable, set BRANCH_ID to an existing branch or DELETE_BRANCH=false before creating it.' \
    >&2
  exit 1
fi

docker start "${db_container_id}" "${minio_container_id}" >/dev/null

wait_for_healthy_container() {
  local service="$1"
  local container_id="$2"
  local state=''

  for _ in $(seq 1 120); do
    state="$(
      docker inspect \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "${container_id}"
    )"
    case "${state}" in
      healthy | running) return 0 ;;
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

exec docker start "${stripe_container_id}" "${evorto_container_id}"
