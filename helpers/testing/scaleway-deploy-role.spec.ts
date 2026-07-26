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
const containerId = '11111111-2222-3333-4444-555555555555';
const digest = `sha256:${'a'.repeat(64)}`;
const imageReference = `rg.fr-par.scw.cloud/evorto-staging/evorto@${digest}`;
const revision = 'b'.repeat(40);
const schemaHash = 'c'.repeat(64);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

interface CurrentContainer {
  environment_variables: Record<string, string>;
  image: string;
  secret_environment_variables: Record<string, string>;
  status: string;
}

const runDeployRole = ({
  containerResourceId,
  currentContainer = {
    environment_variables: {},
    image: 'rg.fr-par.scw.cloud/evorto-staging/evorto:old',
    secret_environment_variables: {},
    status: 'ready',
  },
  secretValue = 'test-secret',
  traceSamplingRatioOverride,
}: {
  containerResourceId: string;
  currentContainer?: CurrentContainer;
  secretValue?: null | string;
  traceSamplingRatioOverride?: string;
}) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-scaleway-deploy-role-'),
  );
  temporaryDirectories.push(directory);

  const platformPath = path.join(directory, 'platform.json');
  const fakeCliPath = path.join(directory, 'scw');
  const commandLogPath = path.join(directory, 'scw.log');
  const currentContainerPath = path.join(directory, 'current-container.json');
  const statusPath = path.join(directory, 'status');

  fs.writeFileSync(
    platformPath,
    JSON.stringify({
      containers: {
        ops: {
          environment_variables: {
            APP_ENVIRONMENT: 'staging',
            APP_ROLE: 'ops',
            TRACE_SAMPLING_RATIO: '0.1',
          },
          id: containerResourceId,
        },
      },
      role_secret_ids:
        secretValue === null ? {} : { 'ops/TEST_SECRET': 'secret-1' },
    }),
  );
  fs.writeFileSync(currentContainerPath, JSON.stringify(currentContainer));
  fs.writeFileSync(
    fakeCliPath,
    String.raw`#!/usr/bin/env bash
set -euo pipefail
case "${'$'}1 ${'$'}2 ${'$'}3" in
  "container container get")
    cat "${'$'}{FAKE_CURRENT_CONTAINER:?}"
    ;;
  "container container update")
    printf '%s\n' "${'$'}@" > "${'$'}{FAKE_SCW_LOG:?}"
    ;;
  "secret version access")
    printf '%s' "${'$'}{FAKE_SECRET_VALUE:?}"
    ;;
  *)
    echo "Unexpected fake Scaleway command: ${'$'}*" >&2
    exit 1
    ;;
esac
`,
  );
  fs.chmodSync(fakeCliPath, 0o700);

  const environment = { ...process.env };
  delete environment.TRACE_SAMPLING_RATIO_OVERRIDE;

  const output = execFileSync(
    deployRoleScript,
    [
      platformPath,
      'ops',
      imageReference,
      revision,
      digest,
      schemaHash,
      statusPath,
    ],
    {
      env: {
        ...environment,
        FAKE_CURRENT_CONTAINER: currentContainerPath,
        FAKE_SCW_LOG: commandLogPath,
        FAKE_SECRET_VALUE: secretValue ?? 'unused',
        SCW_CLI: fakeCliPath,
        SCW_DEFAULT_REGION: 'fr-par',
        SCW_SECRET_KEY: 'test-deployment-fingerprint-key',
        ...(traceSamplingRatioOverride === undefined
          ? {}
          : { TRACE_SAMPLING_RATIO_OVERRIDE: traceSamplingRatioOverride }),
      },
      stdio: 'pipe',
    },
  ).toString();

  const arguments_ = fs.existsSync(commandLogPath)
    ? fs.readFileSync(commandLogPath, 'utf8').trimEnd().split('\n')
    : [];
  return {
    arguments_,
    output,
    status: fs.readFileSync(statusPath, 'utf8').trim(),
  };
};

const currentContainerFromArguments = (
  arguments_: string[],
): CurrentContainer => ({
  environment_variables: Object.fromEntries(
    arguments_
      .filter((argument) => argument.startsWith('environment-variables.'))
      .map((argument) => {
        const equalsIndex = argument.indexOf('=');
        return [
          argument.slice('environment-variables.'.length, equalsIndex),
          argument.slice(equalsIndex + 1),
        ];
      }),
  ),
  image: imageReference,
  secret_environment_variables: Object.fromEntries(
    arguments_
      .filter((argument) =>
        argument.startsWith('secret-environment-variables.'),
      )
      .map((argument) => [
        argument.slice(
          'secret-environment-variables.'.length,
          argument.indexOf('='),
        ),
        'redacted',
      ]),
  ),
  status: 'ready',
});

describe('Scaleway role deployment', () => {
  it.each([containerId, `fr-par/${containerId}`])(
    'passes a bare container UUID to the Scaleway CLI for %s',
    (containerResourceId) => {
      const { arguments_, status } = runDeployRole({ containerResourceId });

      expect(status).toBe('true');
      expect(arguments_).toContain(containerId);
      expect(arguments_).toContain('region=fr-par');
      expect(arguments_).not.toContain(`fr-par/${containerId}`);
      expect(arguments_).toContain(
        'environment-variables.TRACE_SAMPLING_RATIO=0.1',
      );
    },
  );

  it('temporarily overrides the Terraform-owned trace sampling ratio', () => {
    const { arguments_ } = runDeployRole({
      containerResourceId: containerId,
      traceSamplingRatioOverride: '1',
    });

    expect(arguments_).toContain(
      'environment-variables.TRACE_SAMPLING_RATIO=1',
    );
    expect(arguments_).not.toContain(
      'environment-variables.TRACE_SAMPLING_RATIO=0.1',
    );
  });

  it('rejects an invalid trace sampling override before deployment', () => {
    expect(() =>
      runDeployRole({
        containerResourceId: containerId,
        traceSamplingRatioOverride: '1.1',
      }),
    ).toThrow();
  });

  it('fails closed when a role has no configured secrets', () => {
    expect(() =>
      runDeployRole({
        containerResourceId: containerId,
        secretValue: null,
      }),
    ).toThrow();
  });

  it('skips an unchanged ready deployment and reports no traffic change', () => {
    const first = runDeployRole({
      containerResourceId: containerId,
      secretValue: 'same-secret',
    });
    const currentContainer = currentContainerFromArguments(first.arguments_);

    const second = runDeployRole({
      containerResourceId: containerId,
      currentContainer,
      secretValue: 'same-secret',
    });

    expect(second.arguments_).toEqual([]);
    expect(second.status).toBe('false');
    expect(second.output).toContain('deployment skipped');
  });

  it('redeploys when a role-scoped secret changes', () => {
    const first = runDeployRole({
      containerResourceId: containerId,
      secretValue: 'old-secret',
    });

    const changed = runDeployRole({
      containerResourceId: containerId,
      currentContainer: currentContainerFromArguments(first.arguments_),
      secretValue: 'new-secret',
    });

    expect(changed.status).toBe('true');
    expect(changed.arguments_).toContain(
      'secret-environment-variables.TEST_SECRET=new-secret',
    );
  });
});
