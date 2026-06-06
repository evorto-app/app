#!/usr/bin/env bash
set -euo pipefail

metadata_directory="${NEON_LOCAL_METADATA_DIR:-/tmp/neon-local-metadata}"
metadata_path="${metadata_directory}/.branches"
output_directory="${NEON_LOCAL_METADATA_ARTIFACT_DIR:-test-results/neon-local}"
metadata_artifact_path="${output_directory}/branches.json"

mkdir -p "${output_directory}"

if [ ! -f "${metadata_path}" ]; then
  echo "No Neon Local branch metadata found at ${metadata_path}."
  exit 0
fi

cp "${metadata_path}" "${metadata_artifact_path}"

export NEON_LOCAL_METADATA_ARTIFACT_PATH="${metadata_artifact_path}"
export NEON_LOCAL_METADATA_PATH="${metadata_path}"

node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';

const metadataPath = process.env['NEON_LOCAL_METADATA_PATH'] ?? '';
const artifactPath = process.env['NEON_LOCAL_METADATA_ARTIFACT_PATH'] ?? '';

const raw = readFileSync(metadataPath, 'utf8');
const parsed = JSON.parse(raw);
const branchIds = [
  ...new Set(
    Object.values(parsed)
      .map((value) =>
        value &&
        typeof value === 'object' &&
        typeof value.branch_id === 'string'
          ? value.branch_id.trim()
          : '',
      )
      .filter(Boolean),
  ),
];

const summaryLines = [
  '### Neon Local branch metadata',
  '',
  `Metadata artifact: \`${artifactPath}\``,
  `Branch ids: ${branchIds.length === 0 ? '<none>' : branchIds.join(', ')}`,
  '',
];

console.log(summaryLines.join('\n'));

if (process.env['GITHUB_STEP_SUMMARY']) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env['GITHUB_STEP_SUMMARY'], summaryLines.join('\n'));
}
NODE
