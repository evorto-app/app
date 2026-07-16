#!/usr/bin/env bash

set -euo pipefail

readonly knope_version='0.23.0'
readonly release_tag="knope/v${knope_version}"

case "$(uname -s):$(uname -m)" in
  Darwin:arm64)
    readonly target='aarch64-apple-darwin'
    readonly archive_sha256='a6e231cc7f02032c5b49ad14149c7d11fd48f0e244f9fb48d5c4c47ffb0e3863'
    ;;
  Darwin:x86_64)
    readonly target='x86_64-apple-darwin'
    readonly archive_sha256='e403b5be532fb77238b9489555bc61ccb36ea4b4c7efc0dde1f5e5290067babe'
    ;;
  Linux:aarch64 | Linux:arm64)
    readonly target='aarch64-unknown-linux-musl'
    readonly archive_sha256='c68758b1c3b007367ea40c22b1b1b052720557215935af09677d1561039698b4'
    ;;
  Linux:x86_64)
    readonly target='x86_64-unknown-linux-musl'
    readonly archive_sha256='76a970a5e237344abc14be3de37ed50c021b659a9b66b3f54afc77e6d48ac501'
    ;;
  *)
    echo "Unsupported Knope validation platform: $(uname -s) $(uname -m)" >&2
    exit 1
    ;;
esac

readonly cache_root="${XDG_CACHE_HOME:-${HOME}/.cache}/evorto-tools/knope/${knope_version}"
readonly knope_binary="${cache_root}/knope"
readonly archive_name="knope-${target}.tgz"
readonly download_url="https://github.com/knope-dev/knope/releases/download/${release_tag}/${archive_name}"

if [ ! -x "${knope_binary}" ] || [ "$("${knope_binary}" --version 2>/dev/null || true)" != "knope ${knope_version}" ]; then
  rm -rf "${cache_root}"
  mkdir -p "${cache_root}"
  temporary_directory="$(mktemp -d "${cache_root}/download.XXXXXX")"
  trap 'rm -rf "${temporary_directory}"' EXIT
  archive_path="${temporary_directory}/${archive_name}"

  curl --fail --location --proto '=https' --tlsv1.2 \
    "${download_url}" \
    --output "${archive_path}"
  if command -v sha256sum >/dev/null 2>&1; then
    actual_archive_sha256="$(sha256sum "${archive_path}" | awk '{print $1}')"
  else
    actual_archive_sha256="$(shasum --algorithm 256 "${archive_path}" | awk '{print $1}')"
  fi
  if [ "${actual_archive_sha256}" != "${archive_sha256}" ]; then
    echo "Knope archive checksum mismatch for ${archive_name}." >&2
    exit 1
  fi

  tar -xzf "${archive_path}" -C "${temporary_directory}"
  install -m 0755 \
    "${temporary_directory}/knope-${target}/knope" \
    "${knope_binary}"
  rm -rf "${temporary_directory}"
  trap - EXIT
fi

if [ "$("${knope_binary}" --version)" != "knope ${knope_version}" ]; then
  echo "Cached Knope executable does not match ${knope_version}." >&2
  exit 1
fi

exec "${knope_binary}" --validate
