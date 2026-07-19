#!/usr/bin/env bash

set -euo pipefail

image_reference="${1:?usage: verify-runtime-image.sh IMAGE_REFERENCE}"
maximum_size_bytes=1000000000
image_size_bytes="$(docker image inspect --format '{{.Size}}' "${image_reference}")"

if ((image_size_bytes >= maximum_size_bytes)); then
  echo "Runtime image is ${image_size_bytes} bytes; it must be below ${maximum_size_bytes} bytes." >&2
  exit 1
fi

container_id="$(docker create "${image_reference}")"
archive_listing="$(mktemp)"
runtime_root="$(mktemp -d)"

cleanup() {
  docker rm "${container_id}" >/dev/null 2>&1 || true
  rm -f "${archive_listing}"
  rm -rf "${runtime_root}"
}
trap cleanup EXIT

docker export "${container_id}" | tee >(tar --list --file=- >"${archive_listing}") | tar --extract --file=- --directory="${runtime_root}"

if grep -Eiq '(^|/)(\.env([^/]*)?|instrument\.mjs|@sentry|@neondatabase|resend)(/|$)|\.map$' "${archive_listing}"; then
  echo 'Runtime image contains a forbidden secret, provider, instrumentation, or source-map path.' >&2
  grep -Ei '(^|/)(\.env([^/]*)?|instrument\.mjs|@sentry|@neondatabase|resend)(/|$)|\.map$' "${archive_listing}" >&2
  exit 1
fi

readonly first_party_runtime_paths=(
  "${runtime_root}/app/dist"
  "${runtime_root}/app/ops/drizzle.config.mjs"
)
if grep --recursive --binary-files=without-match --extended-regexp --ignore-case \
  'api\.resend\.com|cloudflare[_-]r2|CLOUDFLARE_R2_|R2_BUCKET|sentry\.io|@sentry|@neondatabase' \
  "${first_party_runtime_paths[@]}"; then
  echo 'First-party runtime artifacts retain a removed provider dependency.' >&2
  exit 1
fi

echo "Runtime image verification passed (${image_size_bytes} bytes)."
