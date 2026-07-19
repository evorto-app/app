import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const deployRoleScript = path.join(
  process.cwd(),
  'ops/scaleway/deploy-role.sh',
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

const runDeployRole = (containerResourceId: string): string[] => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-scaleway-deploy-role-'),
  );
  temporaryDirectories.push(directory);

  const platformPath = path.join(directory, 'platform.json');
  const fakeCliPath = path.join(directory, 'scw');
  const commandLogPath = path.join(directory, 'scw.log');
  const containerId = '11111111-2222-3333-4444-555555555555';
  const digest = `sha256:${'a'.repeat(64)}`;

  fs.writeFileSync(
    platformPath,
    JSON.stringify({
      containers: {
        ops: {
          environment_variables: {
            APP_ENVIRONMENT: 'staging',
            APP_ROLE: 'ops',
          },
          id: containerResourceId,
        },
      },
      role_secret_ids: {},
    }),
  );
  fs.writeFileSync(
    fakeCliPath,
    String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "${'$'}{FAKE_SCW_LOG:?}"
`,
  );
  fs.chmodSync(fakeCliPath, 0o700);

  execFileSync(
    deployRoleScript,
    [
      platformPath,
      'ops',
      `rg.fr-par.scw.cloud/evorto-staging/evorto@${digest}`,
      'b'.repeat(40),
      digest,
      'c'.repeat(64),
    ],
    {
      env: {
        ...process.env,
        FAKE_SCW_LOG: commandLogPath,
        SCW_CLI: fakeCliPath,
        SCW_DEFAULT_REGION: 'fr-par',
      },
      stdio: 'pipe',
    },
  );

  const arguments_ = fs
    .readFileSync(commandLogPath, 'utf8')
    .trimEnd()
    .split('\n');
  expect(arguments_).toContain(containerId);
  expect(arguments_).toContain('region=fr-par');
  return arguments_;
};

describe('Scaleway role deployment', () => {
  const containerId = '11111111-2222-3333-4444-555555555555';

  it.each([containerId, `fr-par/${containerId}`])(
    'passes a bare container UUID to the Scaleway CLI for %s',
    (containerResourceId) => {
      const arguments_ = runDeployRole(containerResourceId);

      expect(arguments_).not.toContain(`fr-par/${containerId}`);
    },
  );
});
