#!/usr/bin/env bash

set -euo pipefail

readonly terraform_version='1.15.8'
readonly trivy_version='0.74.0'
readonly syft_version='1.52.0'
readonly destination="${EVORTO_VERIFICATION_TOOLS_DIR:-${XDG_CACHE_HOME:-${HOME}/.cache}/evorto-verification-tools}"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)
    readonly terraform_artifact="terraform_${terraform_version}_darwin_arm64.zip"
    readonly terraform_checksum='f210110c5698b94d803a7a63cdb0251b5455c150841478808e2bbb343f95ed68'
    readonly trivy_artifact="trivy_${trivy_version}_macOS-ARM64.tar.gz"
    readonly trivy_checksum='1caada5e0e2091909357c7525d3aa76f4b660b13821bc143b190c7483e31cc11'
    readonly syft_artifact="syft_${syft_version}_darwin_arm64.tar.gz"
    readonly syft_checksum='014d561b6d13059124155f74a6c5a9a99501f5e209313638dd884f39eb418ee6'
    ;;
  Darwin-x86_64)
    readonly terraform_artifact="terraform_${terraform_version}_darwin_amd64.zip"
    readonly terraform_checksum='e2e812e783771159bf758fd4e55d6dc9bb08f63e2af2c63d212721807a02c5dc'
    readonly trivy_artifact="trivy_${trivy_version}_macOS-64bit.tar.gz"
    readonly trivy_checksum='472816f6888dda689d075c30254d4210b4d1035acf365aa72332f584c2f60485'
    readonly syft_artifact="syft_${syft_version}_darwin_amd64.tar.gz"
    readonly syft_checksum='56975f5d7ffa9846a1eaf64330647841b878097bc7e3730cb9325f93add96917'
    ;;
  Linux-aarch64)
    readonly terraform_artifact="terraform_${terraform_version}_linux_arm64.zip"
    readonly terraform_checksum='8891e9dcedc9e3b8950bc6af9d4d8af1f4cfade3062f53b9dc403a89f6ce8c9c'
    readonly trivy_artifact="trivy_${trivy_version}_Linux-ARM64.tar.gz"
    readonly trivy_checksum='b94ce1976bbf3c15b514b605ee88be7c6d94a29be2302847ff01cb794d47aad5'
    readonly syft_artifact="syft_${syft_version}_linux_arm64.tar.gz"
    readonly syft_checksum='c46d5e4c28e12aa4c5becfaa343ef1c7f89045b6b895f2c21d471c62db09c706'
    ;;
  Linux-x86_64)
    readonly terraform_artifact="terraform_${terraform_version}_linux_amd64.zip"
    readonly terraform_checksum='d25ce7b6902013ad905db3d2eab0be4cd905887fe88b81a6171b8d5503c31f3d'
    readonly trivy_artifact="trivy_${trivy_version}_Linux-64bit.tar.gz"
    readonly trivy_checksum='2ae6fe3ee734b7fdf11335663e18c75ea12dccc76062f09f164a3b0f8be4371a'
    readonly syft_artifact="syft_${syft_version}_linux_amd64.tar.gz"
    readonly syft_checksum='caeedb81fb0491615f1ebd1761e4145d41ee86dd2cc7bf80669f9f5ad9d6133d'
    ;;
  *)
    echo "Unsupported verification-tool platform: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

verify_checksum() {
  local checksum="$1"
  local file="$2"
  if [[ "$(uname -s)" == 'Darwin' ]]; then
    printf '%s  %s\n' "${checksum}" "${file}" \
      | shasum --algorithm 256 --check >/dev/null
  else
    printf '%s  %s\n' "${checksum}" "${file}" \
      | sha256sum --check --status
  fi
}

download() {
  local url="$1"
  local output="$2"
  curl \
    --fail \
    --location \
    --retry 3 \
    --silent \
    --show-error \
    "${url}" \
    --output "${output}"
}

mkdir -p "${destination}"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT

if [[ ! -x "${destination}/terraform" ]] \
  || [[ "$("${destination}/terraform" version -json 2>/dev/null | jq --raw-output .terraform_version)" != "${terraform_version}" ]]; then
  terraform_archive="${temporary_directory}/${terraform_artifact}"
  download \
    "https://releases.hashicorp.com/terraform/${terraform_version}/${terraform_artifact}" \
    "${terraform_archive}"
  verify_checksum "${terraform_checksum}" "${terraform_archive}"
  unzip -q "${terraform_archive}" terraform -d "${temporary_directory}/terraform"
  install -m 0755 "${temporary_directory}/terraform/terraform" "${destination}/terraform"
fi

if [[ ! -x "${destination}/trivy" ]] \
  || [[ "$("${destination}/trivy" --version 2>/dev/null | awk 'NR == 1 { print $2 }')" != "${trivy_version}" ]]; then
  trivy_archive="${temporary_directory}/${trivy_artifact}"
  download \
    "https://github.com/aquasecurity/trivy/releases/download/v${trivy_version}/${trivy_artifact}" \
    "${trivy_archive}"
  verify_checksum "${trivy_checksum}" "${trivy_archive}"
  tar -xzf "${trivy_archive}" -C "${temporary_directory}" trivy
  install -m 0755 "${temporary_directory}/trivy" "${destination}/trivy"
fi

if [[ ! -x "${destination}/syft" ]] \
  || [[ "$("${destination}/syft" version -o json 2>/dev/null | jq --raw-output .version)" != "${syft_version}" ]]; then
  syft_archive="${temporary_directory}/${syft_artifact}"
  download \
    "https://github.com/anchore/syft/releases/download/v${syft_version}/${syft_artifact}" \
    "${syft_archive}"
  verify_checksum "${syft_checksum}" "${syft_archive}"
  tar -xzf "${syft_archive}" -C "${temporary_directory}" syft
  install -m 0755 "${temporary_directory}/syft" "${destination}/syft"
fi

printf '%s\n' "${destination}"
