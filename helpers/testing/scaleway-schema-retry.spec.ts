import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

const workflowStepScript = (workflow: string, stepName: string) => {
  const contents = fs.readFileSync(workflow, 'utf8');
  const marker = `      - name: ${stepName}\n`;
  const start = contents.indexOf(marker);
  expect(start, `missing workflow step: ${stepName}`).toBeGreaterThanOrEqual(0);
  const nextStep = contents.indexOf('      - name:', start + marker.length);
  const step = contents.slice(start, nextStep === -1 ? undefined : nextStep);
  const runMarker = '        run: |\n';
  const scriptStart = step.indexOf(runMarker);
  expect(scriptStart, `missing run script: ${stepName}`).toBeGreaterThanOrEqual(
    0,
  );
  return step.slice(scriptStart + runMarker.length).replaceAll(/^ {10}/gm, '');
};

const makeRetryFixture = (environment: 'production' | 'staging') => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-schema-retry-'),
  );
  temporaryDirectories.push(directory);
  const scriptsDirectory = path.join(directory, 'ops/scaleway');
  fs.mkdirSync(scriptsDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'gh'),
    String.raw`#!/usr/bin/env bash
set -euo pipefail
if [ "$*" != 'api repos/evorto-app/app/commits/main --jq .sha' ]; then
  echo 'Unexpected fake GitHub request' >&2
  exit 90
fi
printf 'main:read\n' >> "$CALL_LOG"
printf '%s\n' "$REVISION"
`,
    { mode: 0o700 },
  );
  const callLog = path.join(directory, 'calls.log');
  fs.writeFileSync(callLog, '');
  fs.writeFileSync(
    path.join(scriptsDirectory, 'deploy-role.sh'),
    String.raw`#!/usr/bin/env bash
set -euo pipefail
printf 'deploy:%s\n' "$2" >> "$CALL_LOG"
if [ "$#" -ge 7 ]; then
  printf 'false\n' > "$7"
fi
`,
    { mode: 0o700 },
  );
  fs.writeFileSync(
    path.join(scriptsDirectory, 'invoke-private-container.sh'),
    String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$3" >> "$CALL_LOG"
case "$3" in
  /internal/ops/schema-explain)
    jq --null-input --arg schema_hash "$SCHEMA_HASH" \
      '{safe: true, schemaHash: $schema_hash, digest: "reviewed-plan"}'
    ;;
  /internal/ops/schema-apply)
    jq --exit-status '.planDigest == "reviewed-plan"' >/dev/null
    jq --null-input --argjson fail "$FAIL_SCHEMA_APPLY" \
      '{applied: ($fail | not), digest: "reviewed-plan"}'
    ;;
  /internal/ops/seed-staging)
    jq --exit-status '.mode == "initialize-empty"' >/dev/null
    printf '%s\n' '{"initialized":true}'
    ;;
  *) exit 90 ;;
esac
`,
    { mode: 0o700 },
  );
  const workflow = path.join(
    process.cwd(),
    `.github/workflows/scaleway-${environment}.yml`,
  );
  const schemaStep =
    environment === 'staging'
      ? 'Deploy ops and apply only a stable safe schema plan'
      : 'Deploy production ops and apply only a stable safe schema plan';
  const runtimeStep =
    environment === 'staging'
      ? 'Deploy worker and web at the same digest'
      : 'Deploy production worker and web at the accepted digest';
  const script = [schemaStep, runtimeStep]
    .map((stepName) => workflowStepScript(workflow, stepName))
    .join('\n');

  return {
    calls: () => fs.readFileSync(callLog, 'utf8').trim().split('\n'),
    run: (failSchemaApply: boolean) =>
      spawnSync(
        'bash',
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
        {
          cwd: directory,
          encoding: 'utf8',
          env: {
            CALL_LOG: callLog,
            DIGEST: `sha256:${'a'.repeat(64)}`,
            FAIL_SCHEMA_APPLY: String(failSchemaApply),
            IMAGE_REFERENCE: `example.invalid/evorto@sha256:${'a'.repeat(64)}`,
            PATH: `${directory}:${process.env.PATH ?? ''}`,
            GITHUB_REPOSITORY: 'evorto-app/app',
            GITHUB_SHA: 'b'.repeat(40),
            REVISION: 'b'.repeat(40),
            RUNNER_TEMP: directory,
            SCHEMA_HASH: 'c'.repeat(64),
          },
          timeout: 10_000,
        },
      ),
  };
};

describe('Scaleway schema reconciliation retries', () => {
  for (const environment of ['staging', 'production'] as const) {
    it(`reconciles ${environment} again after an unchanged ops deployment`, () => {
      const fixture = makeRetryFixture(environment);
      const failed = fixture.run(true);
      expect(failed.status, failed.stderr).not.toBe(0);
      const reconciliationCalls = [
        ...(environment === 'production' ? ['main:read'] : []),
        'deploy:ops',
        '/internal/ops/schema-explain',
        '/internal/ops/schema-apply',
      ];
      expect(fixture.calls()).toEqual(reconciliationCalls);

      const retried = fixture.run(false);
      expect(retried.status, retried.stderr).toBe(0);
      expect(fixture.calls()).toEqual([
        ...reconciliationCalls,
        ...reconciliationCalls,
        ...(environment === 'staging' ? ['/internal/ops/seed-staging'] : []),
        'deploy:worker',
        'deploy:web',
      ]);
    });
  }
});
