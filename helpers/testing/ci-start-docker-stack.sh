#!/usr/bin/env bash
set -euo pipefail

export E2E_RUNTIME_MODE=playwright

run_docker_preflight() {
  bun run env:runtime
  timeout 2m node_modules/.bin/dotenv -c dev -- docker compose config --quiet
}

pull_compose_images() {
  for attempt in 1 2 3 4; do
    if timeout 3m node_modules/.bin/dotenv -c dev -- docker compose pull --quiet --ignore-buildable --policy missing; then
      return 0
    fi
    if [ "${attempt}" = "4" ]; then
      echo "::warning::Docker Compose image pre-pull failed after ${attempt} attempts. Continuing to Compose startup, which can still pull missing images."
      return 0
    fi
    delay_seconds=$((attempt * 15))
    echo "::warning::Docker Compose image pre-pull failed on attempt ${attempt}. Retrying in ${delay_seconds}s before startup."
    sleep "${delay_seconds}"
  done
}

build_and_start_compose() {
  start_status=1
  for attempt in 1 2; do
    set +e
    timeout 12m node_modules/.bin/dotenv -c dev -- docker compose build --progress=plain db-setup evorto
    build_status=$?
    if [ "${build_status}" = "0" ]; then
      timeout 5m node_modules/.bin/dotenv -c dev -- docker compose up --no-build -d
      start_status=$?
    else
      start_status="${build_status}"
    fi
    set -e
    if [ "${start_status}" = "0" ]; then
      break
    fi
    if [ "${attempt}" = "2" ]; then
      break
    fi
    if [ "${start_status}" = "124" ]; then
      echo "::warning::Docker Compose build/start timed out. Cleaning project-scoped Compose objects and retrying once."
    else
      echo "::warning::Docker Compose build/start failed with status ${start_status}. Cleaning project-scoped Compose objects and retrying once."
    fi
    timeout 90s node_modules/.bin/dotenv -c dev -- docker compose down --timeout 60 --remove-orphans || true
  done
  if [ "${start_status}" = "124" ]; then
    echo "::error::Docker Compose build/start timed out before the workflow step timeout"
  fi
  node_modules/.bin/dotenv -c dev -- docker compose ps || true
  node_modules/.bin/dotenv -c dev -- docker compose logs --no-color --tail=100 db-expiration db-setup minio minio-init evorto || true
  return "${start_status}"
}

run_docker_preflight
pull_compose_images
build_and_start_compose
