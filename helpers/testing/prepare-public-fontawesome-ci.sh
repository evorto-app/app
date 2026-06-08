#!/usr/bin/env bash
set -euo pipefail

if [ -f .npmrc ]; then
  echo "::error::Repository .npmrc is not supported; keep @fortawesome on the public npm registry through bunfig.toml and this CI user config."
  exit 1
fi

npm_config_userconfig="${RUNNER_TEMP:-/tmp}/npmrc-public-fontawesome"
npm_config_globalconfig="${RUNNER_TEMP:-/tmp}/npmrc-empty-global"
printf '%s\n' '@fortawesome:registry=https://registry.npmjs.org/' > "${npm_config_userconfig}"
: > "${npm_config_globalconfig}"

fontawesome_token_environment_names=(
  FONT_AWESOME_TOKEN
  FONTAWESOME_TOKEN
  FONTAWESOME_NPM_AUTH_TOKEN
  FONTAWESOME_PACKAGE_TOKEN
)

for fontawesome_token_environment_name in "${fontawesome_token_environment_names[@]}"; do
  unset "${fontawesome_token_environment_name}"
done

if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "NPM_CONFIG_USERCONFIG=${npm_config_userconfig}"
    echo "npm_config_userconfig=${npm_config_userconfig}"
    echo "NPM_CONFIG_GLOBALCONFIG=${npm_config_globalconfig}"
    echo "npm_config_globalconfig=${npm_config_globalconfig}"
    for fontawesome_token_environment_name in "${fontawesome_token_environment_names[@]}"; do
      echo "${fontawesome_token_environment_name}="
    done
  } >> "${GITHUB_ENV}"
fi

node --input-type=module <<'NODE'
import { existsSync, readFileSync } from 'node:fs';

const privateRegistry = ['npm', 'fontawesome', 'com'].join('.');
const privatePackage =
  /@fortawesome\/(?:(?:duotone-(?!regular-svg-icons))|pro|sharp)[^"'\s]*/u;
const files = ['package.json', 'bun.lock', 'bunfig.toml', 'Dockerfile'];
let failed = false;

for (const file of files) {
  if (!existsSync(file)) {
    continue;
  }

  const source = readFileSync(file, 'utf8');
  if (source.includes(privateRegistry) || privatePackage.test(source)) {
    console.error(
      `::error file=${file}::Font Awesome must stay on free public npm packages in CI.`,
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
NODE
