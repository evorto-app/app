#!/usr/bin/env bash
set -euo pipefail

app_pid=''
cleanup_started='false'
minio_container_created='false'
minio_container_id=''
minio_container_started='false'

wait_for_minio() {
  local attempt
  local health_url="http://127.0.0.1:${MINIO_HOST_PORT}/minio/health/live"

  for ((attempt = 1; attempt <= 60; attempt += 1)); do
    if curl --fail --silent --show-error --max-time 2 "${health_url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  printf 'Worktree-local MinIO did not become healthy at %s.\n' "${health_url}" >&2
  return 1
}

restore_minio_state() {
  if [[ -z "${minio_container_id}" ]]; then
    return
  fi

  if [[ "${minio_container_created}" == 'true' ]]; then
    docker rm --force "${minio_container_id}" >/dev/null 2>&1 || true
  elif [[ "${minio_container_started}" == 'true' ]]; then
    docker stop --time 10 "${minio_container_id}" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  local requested_status="${1:-0}"

  if [[ "${cleanup_started}" == 'true' ]]; then
    return
  fi
  cleanup_started='true'
  trap - EXIT HUP INT TERM

  if [[ -n "${app_pid}" ]] && kill -0 "${app_pid}" 2>/dev/null; then
    kill -TERM "${app_pid}" 2>/dev/null || true
    wait "${app_pid}" 2>/dev/null || true
  fi

  restore_minio_state
  exit "${requested_status}"
}

handle_signal() {
  case "$1" in
    HUP) cleanup 129 ;;
    INT) cleanup 130 ;;
    TERM) cleanup 143 ;;
  esac
}

for required_variable in APP_HOST_PORT COMPOSE_PROJECT_NAME MINIO_HOST_PORT; do
  if [[ -z "${!required_variable:-}" ]]; then
    printf '%s is required for the host Playwright web server.\n' \
      "${required_variable}" >&2
    exit 2
  fi
done

trap 'cleanup "$?"' EXIT
trap 'handle_signal HUP' HUP
trap 'handle_signal INT' INT
trap 'handle_signal TERM' TERM

minio_container_id="$(docker compose ps --all --quiet minio)"
if [[ -n "${minio_container_id}" ]]; then
  minio_running="$(
    docker inspect --format '{{.State.Running}}' "${minio_container_id}"
  )"
  if [[ "${minio_running}" != 'true' ]]; then
    docker start "${minio_container_id}" >/dev/null
    minio_container_started='true'
  fi
else
  docker compose up --detach --no-deps minio
  minio_container_id="$(docker compose ps --all --quiet minio)"
  if [[ -z "${minio_container_id}" ]]; then
    printf 'Docker Compose did not create the worktree-local MinIO container.\n' >&2
    exit 1
  fi
  minio_container_created='true'
fi

wait_for_minio
docker compose run --rm --no-deps minio-init

local_s3_endpoint="http://127.0.0.1:${MINIO_HOST_PORT}"
export S3_ACCESS_KEY_ID="${MINIO_ROOT_USER:-minioadmin}"
export S3_BUCKET="${S3_BUCKET:-evorto-testing}"
export S3_ENDPOINT="${local_s3_endpoint}"
export S3_PUBLIC_ENDPOINT="${local_s3_endpoint}"
export S3_REGION="${S3_REGION:-us-east-1}"
export S3_SECRET_ACCESS_KEY="${MINIO_ROOT_PASSWORD:-minioadmin}"

printf 'Starting the host Playwright app with worktree-local object storage.\n'
bun run dev:ng serve --port "${APP_HOST_PORT}" --allowed-hosts &
app_pid="$!"
if wait "${app_pid}"; then
  app_status=0
else
  app_status="$?"
fi
app_pid=''
exit "${app_status}"
