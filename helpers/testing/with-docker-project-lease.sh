#!/usr/bin/env bash
set -euo pipefail

readonly operation="${1:-}"
if [[ -z "${operation}" || "${2:-}" != '--' || "$#" -lt 3 ]]; then
  printf '%s\n' \
    'Usage: helpers/testing/with-docker-project-lease.sh <operation> -- <command> [arguments...]' \
    >&2
  exit 2
fi
shift 2

readonly compose_project_name="${COMPOSE_PROJECT_NAME:-}"
if [[ -z "${compose_project_name}" ]]; then
  printf '%s\n' \
    'COMPOSE_PROJECT_NAME is required for Docker project lifecycle ownership.' \
    >&2
  exit 2
fi
if [[ ! "${compose_project_name}" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  printf 'Invalid COMPOSE_PROJECT_NAME for Docker project lifecycle ownership: %s\n' \
    "${compose_project_name}" >&2
  exit 2
fi

readonly lease_directory="${TMPDIR:-/tmp}/evorto-docker-project-leases"
readonly lease_path="${lease_directory}/${compose_project_name}.lock"
readonly owner_path="${lease_directory}/${compose_project_name}.owner"

umask 077
mkdir -p "${lease_directory}"
exec 9>>"${lease_path}"

lease_acquired='false'
if command -v flock >/dev/null 2>&1; then
  if flock --nonblock 9; then
    lease_acquired='true'
  fi
elif command -v lockf >/dev/null 2>&1; then
  # macOS lockf supports descriptor mode: lock the already-open FD 9.
  if lockf -s -t 0 9; then
    lease_acquired='true'
  fi
else
  printf '%s\n' \
    'Cannot protect the Docker project lifecycle: neither flock nor lockf is installed.' \
    >&2
  exit 69
fi

if [[ "${lease_acquired}" != 'true' ]]; then
  printf 'Refusing %s: another command is already modifying Docker project %s.\n' \
    "${operation}" "${compose_project_name}" >&2
  if [[ -s "${owner_path}" ]]; then
    printf '%s\n' 'Active command details:' >&2
    sed 's/^/  /' "${owner_path}" >&2
  else
    printf '%s\n' \
      'The active command has not published its details yet.' >&2
  fi
  printf '%s\n' \
    'The lease is released automatically when the active command exits; an old details file cannot keep the project locked.' \
    >&2
  exit 75
fi

rm -f "${owner_path}"
readonly owner_temporary_path="${owner_path}.$$"
{
  printf 'operation=%s\n' "${operation}"
  printf 'pid=%s\n' "$$"
  printf 'working_directory=%s\n' "${PWD}"
  printf 'started_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
} >"${owner_temporary_path}"
mv -f "${owner_temporary_path}" "${owner_path}"

export EVORTO_DOCKER_PROJECT_LEASE_HELD=true
exec "$@"
