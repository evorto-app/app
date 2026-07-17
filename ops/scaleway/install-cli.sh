#!/usr/bin/env bash

set -euo pipefail

readonly version="2.58.3"
readonly destination="${1:-${RUNNER_TEMP:-/tmp}/scw}"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)
    readonly artifact="scaleway-cli_${version}_darwin_arm64"
    readonly checksum="e61197bd2f8fad6fb2cc832ea2ac57c64a14f68fb803b325a4e1bd97f7391666"
    ;;
  Darwin-x86_64)
    readonly artifact="scaleway-cli_${version}_darwin_amd64"
    readonly checksum="c662a7fba5d039edf9fd1ac635b8694b932ca32b2fba3dbb6b01e4e7b10b2b4c"
    ;;
  Linux-aarch64)
    readonly artifact="scaleway-cli_${version}_linux_arm64"
    readonly checksum="15f21c67417b98346a8772aefb71c9b940ee450aaf1539faca0066f924b4c592"
    ;;
  Linux-x86_64)
    readonly artifact="scaleway-cli_${version}_linux_amd64"
    readonly checksum="448e299c59e8336e5a697f364450911621f95698da23468b1da74909f69bfd94"
    ;;
  *)
    echo "Unsupported platform for the pinned Scaleway CLI: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

curl \
  --fail \
  --location \
  --retry 3 \
  --silent \
  --show-error \
  "https://github.com/scaleway/scaleway-cli/releases/download/v${version}/${artifact}" \
  --output "${destination}"

if [[ "$(uname -s)" == 'Darwin' ]]; then
  printf '%s  %s\n' "${checksum}" "${destination}" \
    | shasum --algorithm 256 --check >/dev/null
else
  printf '%s  %s\n' "${checksum}" "${destination}" \
    | sha256sum --check --status
fi

chmod 700 "${destination}"
"${destination}" version
