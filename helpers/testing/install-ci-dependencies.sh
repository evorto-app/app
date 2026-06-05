#!/usr/bin/env bash
set -euo pipefail

mode="${CI_DEPENDENCY_INSTALL_MODE:-offline-required}"
bun_cache_dir="${BUN_PACKAGE_CACHE_DIR:-${HOME}/.bun/install/cache}"
package_cache_hit="${BUN_PACKAGE_CACHE_HIT:-false}"
dependency_tree_cache_hit="${BUN_DEPENDENCY_TREE_CACHE_HIT:-false}"
missing_cache_message="${CI_DEPENDENCY_INSTALL_MISSING_CACHE_MESSAGE:-Bun dependency tree cache was not restored after the cache warmer. Refusing a registry install to avoid repeated Font Awesome package downloads.}"
offline_failure_message="${CI_DEPENDENCY_INSTALL_OFFLINE_FAILURE_MESSAGE:-Offline Bun install failed even though the package cache was restored. Refusing a registry install to avoid repeated Font Awesome package downloads.}"

if [ "${mode}" != "warm" ] && [ "${mode}" != "offline-required" ]; then
  echo "::error::Unsupported CI_DEPENDENCY_INSTALL_MODE=${mode}. Expected warm or offline-required."
  exit 1
fi

echo "Bun package cache hit: ${package_cache_hit}"
echo "Bun dependency tree cache hit: ${dependency_tree_cache_hit}"

bun_package_cache_restored="false"
if [ -n "$(find "${bun_cache_dir}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
  bun_package_cache_restored="true"
fi
echo "Bun package cache restored: ${bun_package_cache_restored}"

if [ "${dependency_tree_cache_hit}" = "true" ]; then
  echo "Bun dependency tree cache restored; skipping registry install."
  exit 0
fi

if [ "${bun_package_cache_restored}" = "true" ]; then
  if [ "${mode}" = "warm" ]; then
    echo "Bun dependency tree cache was not restored; installing offline from the warmed package cache before falling back to the serial cache warmer registry install."
  else
    echo "Bun dependency tree cache was not restored; installing offline from the warmed package cache."
  fi

  if bun install --frozen-lockfile --offline --cache-dir "${bun_cache_dir}"; then
    exit 0
  fi

  if [ "${mode}" = "offline-required" ]; then
    echo "::error::${offline_failure_message}"
    exit 1
  fi

  echo "::warning::Offline Bun install failed even though the package cache was restored. Retrying once through the serial cache warmer registry install without clearing the package cache."
fi

if [ "${mode}" = "offline-required" ]; then
  echo "::error::${missing_cache_message}"
  exit 1
fi

if ! bun install --frozen-lockfile --cache-dir "${bun_cache_dir}"; then
  echo "::warning::Bun install failed. Retrying once without clearing the package cache."
  bun install --frozen-lockfile --cache-dir "${bun_cache_dir}"
fi
