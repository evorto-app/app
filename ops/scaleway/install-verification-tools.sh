#!/usr/bin/env bash

set -euo pipefail

readonly terraform_version='1.15.8'
readonly trivy_version='0.70.0'
readonly syft_version='1.44.0'
readonly destination="${EVORTO_VERIFICATION_TOOLS_DIR:-${XDG_CACHE_HOME:-${HOME}/.cache}/evorto-verification-tools}"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)
    readonly terraform_artifact="terraform_${terraform_version}_darwin_arm64.zip"
    readonly terraform_checksum='f210110c5698b94d803a7a63cdb0251b5455c150841478808e2bbb343f95ed68'
    readonly trivy_artifact="trivy_${trivy_version}_macOS-ARM64.tar.gz"
    readonly trivy_checksum='68e543c51dcc96e1c344053a4fde9660cf602c25565d9f09dc17dd41e13b838a'
    readonly syft_artifact="syft_${syft_version}_darwin_arm64.tar.gz"
    readonly syft_checksum='24e4d34078ae81da7c82539616f0ccac3e226cf4f74a38ce6fb3463619e50a55'
    ;;
  Darwin-x86_64)
    readonly terraform_artifact="terraform_${terraform_version}_darwin_amd64.zip"
    readonly terraform_checksum='e2e812e783771159bf758fd4e55d6dc9bb08f63e2af2c63d212721807a02c5dc'
    readonly trivy_artifact="trivy_${trivy_version}_macOS-64bit.tar.gz"
    readonly trivy_checksum='52d531452b19e7593da29366007d02a810e1e0080d02f9cf6a1afb46c35aaa93'
    readonly syft_artifact="syft_${syft_version}_darwin_amd64.tar.gz"
    readonly syft_checksum='c40ece5407927327f94f35901727dbc604b46857e04f04ec94a310845fb71bde'
    ;;
  Linux-aarch64)
    readonly terraform_artifact="terraform_${terraform_version}_linux_arm64.zip"
    readonly terraform_checksum='8891e9dcedc9e3b8950bc6af9d4d8af1f4cfade3062f53b9dc403a89f6ce8c9c'
    readonly trivy_artifact="trivy_${trivy_version}_Linux-ARM64.tar.gz"
    readonly trivy_checksum='2f6bb988b553a1bbac6bdd1ce890f5e412439564e17522b88a4541b4f364fc8d'
    readonly syft_artifact="syft_${syft_version}_linux_arm64.tar.gz"
    readonly syft_checksum='6f6cdcdc695721d91ce756e3b5bc3e3416599c464101f5e32e9c3f33054ee6d9'
    ;;
  Linux-x86_64)
    readonly terraform_artifact="terraform_${terraform_version}_linux_amd64.zip"
    readonly terraform_checksum='d25ce7b6902013ad905db3d2eab0be4cd905887fe88b81a6171b8d5503c31f3d'
    readonly trivy_artifact="trivy_${trivy_version}_Linux-64bit.tar.gz"
    readonly trivy_checksum='8b4376d5d6befe5c24d503f10ff136d9e0c49f9127a4279fd110b727929a5aa9'
    readonly syft_artifact="syft_${syft_version}_linux_amd64.tar.gz"
    readonly syft_checksum='0e91737aee2b5baf1d255b959630194a302335d848ff97bb07921eb6205b5f5a'
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
