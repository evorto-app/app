#!/usr/bin/env bash

set -euo pipefail

image_reference="${1:?usage: verify-runtime-image.sh IMAGE_REFERENCE}"
maximum_size_bytes=1000000000
image_size_bytes="$(docker image inspect --format '{{.Size}}' "${image_reference}")"

if ((image_size_bytes >= maximum_size_bytes)); then
  echo "Runtime image is ${image_size_bytes} bytes; it must be below ${maximum_size_bytes} bytes." >&2
  exit 1
fi

verification_directory="$(mktemp -d)"
archive_path="${verification_directory}/image.tar"
archive_listing="${verification_directory}/listing.txt"
runtime_root="${verification_directory}/root"
container_id=''

cleanup() {
  if [[ -n "${container_id}" ]]; then
    docker rm "${container_id}" >/dev/null 2>&1 || true
  fi
  rm -rf "${verification_directory}"
}
trap cleanup EXIT

mkdir "${runtime_root}"
container_id="$(docker create "${image_reference}")"

runtime_user="$(docker inspect --format '{{.Config.User}}' "${container_id}")"
runtime_entrypoint="$(docker inspect --format '{{json .Config.Entrypoint}}' "${container_id}")"
runtime_command="$(docker inspect --format '{{json .Config.Cmd}}' "${container_id}")"
if [[ "${runtime_user}" != '65532:65532' ]]; then
  echo "Runtime image must run as the explicit non-root user 65532:65532; found ${runtime_user:-root}." >&2
  exit 1
fi
if [[ "${runtime_entrypoint}" != '["/usr/local/bin/bun"]' ]]; then
  echo "Runtime image must start Bun directly; found entrypoint ${runtime_entrypoint}." >&2
  exit 1
fi
if [[ "${runtime_command}" != '["dist/evorto/server/server.mjs"]' ]]; then
  echo "Runtime image has an unexpected default command: ${runtime_command}." >&2
  exit 1
fi

docker export "${container_id}" >"${archive_path}"
tar --list --file="${archive_path}" >"${archive_listing}"

reject_matches() {
  local message="${1}"
  shift
  local scan_status=0
  grep "${@}" >&2 || scan_status=$?
  if ((scan_status == 0)); then
    echo "${message}" >&2
    exit 1
  elif ((scan_status != 1)); then
    echo 'Could not inspect the runtime image contents.' >&2
    exit "${scan_status}"
  fi
}

reject_matches 'Runtime image contains a forbidden secret, provider, instrumentation, or source-map path.' \
  --extended-regexp --ignore-case \
  '(^|/)(\.env([^/]*)?|instrument\.mjs|@sentry|@neondatabase|resend)(/|$)|\.map$' "${archive_listing}"

readonly shell_path_pattern='(^|/)(busybox|sh|bash|dash|ash|zsh|ksh|csh|tcsh|fish)$'
reject_matches 'Runtime image contains a shell even though the application starts Bun directly.' \
  --extended-regexp --ignore-case "${shell_path_pattern}" "${archive_listing}"

tar --extract --file="${archive_path}" --directory="${runtime_root}"

readonly required_artifacts=(
  app/dist/evorto/server/server.mjs
  app/dist/evorto/ops/schema.mjs
  app/dist/evorto/ops/database-prerequisites.mjs
  app/dist/evorto/ops/reset-staging-database.mjs
  app/dist/evorto/ops/seed-staging.mjs
  app/ops/drizzle.config.mjs
  app/ops/drizzle-kit.cjs
)
for required_artifact in "${required_artifacts[@]}"; do
  # Check every component before file checks or content scans can follow a link.
  artifact_component="${runtime_root}/${required_artifact}"
  while [[ "${artifact_component}" != "${runtime_root}" ]]; do
    if [[ -L "${artifact_component}" ]]; then
      echo "Runtime image required artifact path contains a symlink: ${artifact_component}." >&2
      exit 1
    fi
    artifact_component="${artifact_component%/*}"
  done
  if [[ ! -f "${runtime_root}/${required_artifact}" ]]; then
    echo "Runtime image is missing a required regular artifact: ${required_artifact}." >&2
    exit 1
  fi
done

readonly first_party_runtime_paths=(
  "${runtime_root}/app/dist"
  "${runtime_root}/app/ops/drizzle.config.mjs"
)
reject_matches 'First-party runtime artifacts retain a removed provider dependency.' \
  --recursive --binary-files=without-match --extended-regexp --ignore-case \
  'api\.resend\.com|cloudflare[_-]r2|CLOUDFLARE_R2_|R2_BUCKET|sentry\.io|@sentry|@neondatabase' \
  "${first_party_runtime_paths[@]}"

image_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "${image_reference}")"
readability_status=0
docker run --rm --pull=never --platform "${image_platform}" --network none --read-only \
  --entrypoint /usr/local/bin/bun "${image_reference}" --eval '
    const fs = require("node:fs");
    for (const artifact of process.argv.slice(1)) {
      const descriptor = fs.openSync(artifact, "r");
      try {
        if (!fs.fstatSync(descriptor).isFile()) {
          throw new Error(`Required artifact is not a regular file: ${artifact}`);
        }
        fs.readSync(descriptor, Buffer.alloc(1), 0, 1, 0);
      } finally {
        fs.closeSync(descriptor);
      }
    }
  ' "${required_artifacts[@]/#//}" || readability_status=$?
if ((readability_status != 0)); then
  echo 'Runtime artifacts must be readable by the configured image user 65532:65532.' >&2
  exit "${readability_status}"
fi

echo "Runtime image verification passed (${image_size_bytes} bytes)."
