#!/usr/bin/env bash
set -euo pipefail

export E2E_RUNTIME_MODE=playwright

run_docker_preflight() {
  timeout 2m bun run env:run -- docker compose config --quiet
}

pull_compose_images() {
  for attempt in 1 2 3 4; do
    if timeout 3m bun run env:run -- docker compose pull --quiet --ignore-buildable --policy missing; then
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
    timeout 12m bun run env:run -- docker compose build --progress=plain db-setup worker evorto
    build_status=$?
    if [ "${build_status}" = "0" ]; then
      timeout 5m bun run env:run -- docker compose up --no-build -d
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
    timeout 90s bun run env:run -- docker compose down --timeout 60 --remove-orphans || true
  done
  if [ "${start_status}" = "124" ]; then
    echo "::error::Docker Compose build/start timed out before the workflow step timeout"
  fi
  bun run env:run -- docker compose ps || true
  bun run env:run -- docker compose logs --no-color --tail=100 db-setup mailpit minio minio-init worker evorto || true
  return "${start_status}"
}

run_docker_preflight
pull_compose_images
build_and_start_compose
