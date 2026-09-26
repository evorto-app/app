import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { readWorkflowRunSteps } from './workflow-step-fixture';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

// Repository workflows are immutable inputs during this suite. Parse each once.
const workflowSteps = {
  production: readWorkflowRunSteps(
    path.join(repositoryRoot, '.github/workflows/scaleway-production.yml'),
    'promote',
    'fixture',
  ),
  staging: readWorkflowRunSteps(
    path.join(repositoryRoot, '.github/workflows/scaleway-staging.yml'),
    'deploy',
    'fixture',
  ),
};
const workflowScript = (
  workflow: keyof typeof workflowSteps,
  stepName: string,
) => {
  const step = workflowSteps[workflow].find((entry) => entry.name === stepName);
  if (!step)
    throw new Error(`Missing executable ${workflow} step: ${stepName}`);
  return step.script;
};

// Each import owns its environment for the lifetime of a bounded child. A
// timed-out Vitest import must not restore process.env during the next test.
const readManagedSchemaConfig = (environment: NodeJS.ProcessEnv) => {
  const configUrl = pathToFileURL(
    path.join(repositoryRoot, 'ops/drizzle.config.mjs'),
  );
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const { default: config } = await import(${JSON.stringify(configUrl.href)});
process.stdout.write(JSON.stringify({
  config,
  checkServerIdentityIsFunction: typeof config.dbCredentials.ssl?.checkServerIdentity === 'function',
}));`,
    ],
    {
      encoding: 'utf8',
      env: environment,
      killSignal: 'SIGKILL',
      timeout: 4000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result;
};

describe('offline Scaleway hosting tools', () => {
  const revision = 'd'.repeat(40);
  const digestHash = 'a'.repeat(64);

  it.each([
    { name: 'current accepted revision', expected: [0, 0, 0] },
    {
      name: 'non-main dispatch',
      workflowRef: 'refs/heads/release',
      expected: [1],
    },
    {
      name: 'old workflow rerun',
      workflowRevision: 'b'.repeat(40),
      expected: [1],
    },
    { name: 'malformed canonical response', firstMain: 'null', expected: [1] },
    { name: 'failed initial main read', failFirst: true, expected: [1] },
    {
      name: 'main advances during promotion',
      secondMain: 'b'.repeat(40),
      expected: [0, 1],
    },
    {
      name: 'selected revision differs from workflow',
      selectedRevision: 'b'.repeat(40),
      expected: [0, 1],
    },
    { name: 'failed final main read', failSecond: true, expected: [0, 1] },
    {
      name: 'main advances during secret synchronization or evidence copy',
      thirdMain: 'b'.repeat(40),
      expected: [0, 0, 1],
    },
    {
      name: 'failed main read immediately before ops deployment',
      failThird: true,
      expected: [0, 0, 1],
    },
  ])(
    'checks production revision snapshots through ops deployment: $name',
    (scenario) => {
      const context = {
        workflowRef: 'refs/heads/main',
        workflowRevision: revision,
        firstMain: revision,
        secondMain: revision,
        thirdMain: revision,
        selectedRevision: revision,
        failFirst: false,
        failSecond: false,
        failThird: false,
        ...scenario,
      };
      const firstStep = workflowScript(
        'production',
        'Require the current main production workflow',
      );
      const finalStep = workflowScript(
        'production',
        'Recheck current main before production writes',
      );
      const opsGuard = workflowScript(
        'production',
        'Deploy production ops and apply only a stable safe schema plan',
      );
      const directory = mkdtempSync(
        path.join(tmpdir(), 'evorto-production-forward-'),
      );
      const output = path.join(directory, 'output');
      const calls = path.join(directory, 'gh-calls');
      try {
        writeFileSync(
          path.join(directory, 'gh'),
          String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_GH_LOG"
if [ "$*" != 'api repos/evorto-app/app/commits/main --jq .sha' ]; then
  echo 'Unexpected fake GitHub request' >&2
  exit 1
fi
if [ "$FAKE_GH_FAILURE" = 'true' ]; then
  echo 'Simulated GitHub read failure' >&2
  exit 1
fi
printf '%s\n' "$FAKE_MAIN_REVISION"
`,
          { mode: 0o700 },
        );
        const invoke = (step: string, currentMain: string, fail: boolean) =>
          spawnSync(
            'bash',
            [
              '--noprofile',
              '--norc',
              '-e',
              '-o',
              'pipefail',
              '-c',
              "ops/scaleway/deploy-role.sh() { printf 'guard-passed\\n'; exit 0; }\n" +
                step +
                '\nprintf "guard-passed\\n"',
            ],
            {
              encoding: 'utf8',
              timeout: 2000,
              env: {
                PATH: `${directory}:${process.env['PATH'] ?? ''}`,
                GH_TOKEN: 'test-token',
                GITHUB_REPOSITORY: 'evorto-app/app',
                GITHUB_REF: context.workflowRef,
                GITHUB_SHA: context.workflowRevision,
                GITHUB_OUTPUT: output,
                REVISION: context.selectedRevision,
                FAKE_MAIN_REVISION: currentMain,
                FAKE_GH_LOG: calls,
                FAKE_GH_FAILURE: String(fail),
              },
            },
          );
        const first = invoke(firstStep, context.firstMain, context.failFirst);
        expect(first.error).toBeUndefined();
        expect(first.signal).toBeNull();
        expect(first.status).toBe(context.expected[0]);
        if (first.status !== 0) {
          expect(first.stdout).not.toContain('guard-passed');
          expect(existsSync(output)).toBe(false);
          if (context.workflowRef !== 'refs/heads/main')
            expect(existsSync(calls)).toBe(false);
          return;
        }
        expect(readFileSync(output, 'utf8')).toBe(`revision=${revision}\n`);
        const final = invoke(finalStep, context.secondMain, context.failSecond);
        expect(final.error).toBeUndefined();
        expect(final.signal).toBeNull();
        expect(final.status).toBe(context.expected[1]);
        if (final.status === 0) expect(final.stdout).toBe('guard-passed\n');
        else expect(final.stdout).not.toContain('guard-passed');
        if (final.status === 0) {
          const ops = invoke(opsGuard, context.thirdMain, context.failThird);
          expect(ops.error).toBeUndefined();
          expect(ops.signal).toBeNull();
          expect(ops.status).toBe(context.expected[2]);
          if (ops.status === 0) expect(ops.stdout).toBe('guard-passed\n');
          else expect(ops.stdout).not.toContain('guard-passed');
        }
        expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual(
          Array.from(
            { length: final.status === 0 ? 3 : 2 },
            () => 'api repos/evorto-app/app/commits/main --jq .sha',
          ),
        );
      } finally {
        rmSync(directory, { force: true, recursive: true });
      }
    },
  );

  it.each([
    {
      name: 'matching image digest and artifact keys',
      overrides: {},
      expectedStatus: 0,
    },
    {
      name: 'different image digest',
      overrides: {
        image: `rg.fr-par.scw.cloud/evorto-staging/evorto@sha256:${'b'.repeat(64)}`,
      },
      expectedStatus: 1,
    },
    {
      name: 'different registry',
      overrides: { image: `registry.example/evorto@sha256:${'a'.repeat(64)}` },
      expectedStatus: 1,
    },
    {
      name: 'invalid digest',
      overrides: { digest: 'sha256:invalid' },
      expectedStatus: 1,
    },
    {
      name: 'invalid schema hash',
      overrides: { schemaHash: 'invalid' },
      expectedStatus: 1,
    },
    {
      name: 'missing source map key',
      overrides: { sourceMapsKey: undefined },
      expectedStatus: 1,
    },
    {
      name: 'malformed source map key',
      overrides: { sourceMapsKey: 'source-maps/invalid.tar.gz' },
      expectedStatus: 1,
    },
    {
      name: 'source map key for a different revision',
      overrides: {
        sourceMapsKey: `source-maps/${'e'.repeat(40)}/${digestHash}.tar.gz`,
      },
      expectedStatus: 1,
    },
    {
      name: 'source map key for a different digest',
      overrides: {
        sourceMapsKey: `source-maps/${revision}/${'b'.repeat(64)}.tar.gz`,
      },
      expectedStatus: 1,
    },
    {
      name: 'missing SBOM key',
      overrides: { sbomKey: undefined },
      expectedStatus: 1,
    },
    {
      name: 'malformed SBOM key',
      overrides: { sbomKey: 'sbom/invalid.spdx.json' },
      expectedStatus: 1,
    },
    {
      name: 'SBOM key for a different revision',
      overrides: {
        sbomKey: `sbom/${'e'.repeat(40)}/${digestHash}.spdx.json`,
      },
      expectedStatus: 1,
    },
    {
      name: 'SBOM key for a different digest',
      overrides: {
        sbomKey: `sbom/${revision}/${'b'.repeat(64)}.spdx.json`,
      },
      expectedStatus: 1,
    },
    {
      name: 'different revision',
      overrides: { revision: 'other' },
      expectedStatus: 1,
    },
    {
      name: 'different environment',
      overrides: { environment: 'production' },
      expectedStatus: 1,
    },
    {
      name: 'unsuccessful deployment',
      overrides: { status: 'failed' },
      expectedStatus: 1,
    },
  ])(
    'validates a reused staging manifest with $name',
    ({ overrides, expectedStatus }) => {
      const reuse = workflowScript(
        'staging',
        'Reuse an already-built exact-SHA image when available',
      );
      const predicate = reuse.match(
        /'(\.status == "succeeded"[\s\S]*?)' \\/u,
      )?.[1];
      if (!predicate) {
        throw new Error('Missing staging manifest reuse predicate');
      }
      const digest = `sha256:${digestHash}`;
      const result = spawnSync(
        'jq',
        ['--exit-status', '--arg', 'revision', revision, predicate],
        {
          encoding: 'utf8',
          input: JSON.stringify({
            digest,
            environment: 'staging',
            image: `rg.fr-par.scw.cloud/evorto-staging/evorto@${digest}`,
            revision,
            sbomKey: `sbom/${revision}/${digestHash}.spdx.json`,
            schemaHash: 'c'.repeat(64),
            sourceMapsKey: `source-maps/${revision}/${digestHash}.tar.gz`,
            status: 'succeeded',
            ...overrides,
          }),
          timeout: 5000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(expectedStatus);
    },
  );

  it.each([
    { name: 'matching artifact keys', overrides: {}, expectedStatus: 0 },
    {
      name: 'successful historical revision with internally matching artifacts',
      overrides: {
        revision: 'e'.repeat(40),
        sourceMapsKey: `source-maps/${'e'.repeat(40)}/${digestHash}.tar.gz`,
        sbomKey: `sbom/${'e'.repeat(40)}/${digestHash}.spdx.json`,
      },
      expectedStatus: 1,
    },
    {
      name: 'image for a different digest',
      overrides: {
        image: `rg.fr-par.scw.cloud/evorto-staging/evorto@sha256:${'b'.repeat(64)}`,
      },
      expectedStatus: 1,
    },
    ...[
      { field: 'sourceMapsKey', prefix: 'source-maps', suffix: '.tar.gz' },
      { field: 'sbomKey', prefix: 'sbom', suffix: '.spdx.json' },
    ].flatMap(({ field, prefix, suffix }) =>
      [
        { name: 'missing', value: undefined },
        { name: 'malformed', value: `${prefix}/invalid${suffix}` },
        {
          name: 'wrong revision',
          value: `${prefix}/${'e'.repeat(40)}/${digestHash}${suffix}`,
        },
        {
          name: 'wrong digest',
          value: `${prefix}/${revision}/${'b'.repeat(64)}${suffix}`,
        },
      ].map(({ name, value }) => ({
        name: `${field} ${name}`,
        overrides: { [field]: value },
        expectedStatus: 1,
      })),
    ),
  ])(
    'validates a production manifest with $name',
    ({ overrides, expectedStatus }) => {
      const validation = workflowScript(
        'production',
        'Fetch and validate the accepted staging manifest',
      );
      const predicate = validation.match(
        /'(\.status == "succeeded"[\s\S]*?)' \\/u,
      )?.[1];
      if (!predicate) {
        throw new Error('Missing production manifest validation predicate');
      }
      const digest = `sha256:${digestHash}`;
      const result = spawnSync(
        'jq',
        ['--exit-status', '--arg', 'forward_revision', revision, predicate],
        {
          encoding: 'utf8',
          input: JSON.stringify({
            digest,
            environment: 'staging',
            image: `rg.fr-par.scw.cloud/evorto-staging/evorto@${digest}`,
            revision,
            sbomKey: `sbom/${revision}/${digestHash}.spdx.json`,
            schemaHash: 'c'.repeat(64),
            sourceMapsKey: `source-maps/${revision}/${digestHash}.tar.gz`,
            status: 'succeeded',
            ...overrides,
          }),
          timeout: 5000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(expectedStatus);
    },
  );

  it.each([
    {
      name: 'reuses only when the manifest and both artifacts exist',
      failAt: 'none',
      awsStatus: 0,
      awsError: '',
      expectedStatus: 0,
      expectedReuse: 'true',
      callCount: 4,
    },
    {
      name: 'rebuilds after a missing source map object',
      failAt: 'source-maps',
      awsStatus: 254,
      awsError:
        'An error occurred (404) when calling the HeadObject operation: Not Found',
      expectedStatus: 0,
      expectedReuse: 'false',
      callCount: 3,
    },
    {
      name: 'rebuilds after a missing SBOM object',
      failAt: 'sbom',
      awsStatus: 254,
      awsError:
        'An error occurred (NoSuchKey) when calling the HeadObject operation: The specified key does not exist',
      expectedStatus: 0,
      expectedReuse: 'false',
      callCount: 4,
    },
    {
      name: 'rebuilds after a missing latest manifest',
      failAt: 'latest',
      awsStatus: 254,
      awsError:
        'An error occurred (NotFound) when calling the HeadObject operation: Not Found',
      expectedStatus: 0,
      expectedReuse: 'false',
      callCount: 1,
    },
    {
      name: 'fails on forbidden source map access',
      failAt: 'source-maps',
      awsStatus: 254,
      awsError:
        'An error occurred (403) when calling the HeadObject operation: Forbidden',
      expectedStatus: 254,
      expectedReuse: '',
      callCount: 3,
    },
    {
      name: 'fails on an SBOM network error',
      failAt: 'sbom',
      awsStatus: 255,
      awsError:
        'Could not connect to the endpoint URL: https://s3.fr-par.scw.cloud',
      expectedStatus: 255,
      expectedReuse: '',
      callCount: 4,
    },
    {
      name: 'fails on an unexpected source map service error',
      failAt: 'source-maps',
      awsStatus: 254,
      awsError:
        'An error occurred (InternalError) when calling the HeadObject operation: Internal Server Error',
      expectedStatus: 254,
      expectedReuse: '',
      callCount: 3,
    },
    {
      name: 'fails on forbidden latest manifest access',
      failAt: 'latest',
      awsStatus: 254,
      awsError:
        'An error occurred (403) when calling the HeadObject operation: Forbidden',
      expectedStatus: 254,
      expectedReuse: '',
      callCount: 1,
    },
    {
      name: 'fails when downloading a manifest that passed HEAD',
      failAt: 'download',
      awsStatus: 1,
      awsError:
        'download failed: An error occurred (NoSuchKey) when calling the GetObject operation: The specified key does not exist',
      expectedStatus: 1,
      expectedReuse: '',
      callCount: 2,
    },
  ])(
    'staging artifact reuse $name',
    ({
      failAt,
      awsStatus,
      awsError,
      expectedStatus,
      expectedReuse,
      callCount,
    }) => {
      const reuse = workflowScript(
        'staging',
        'Reuse an already-built exact-SHA image when available',
      );
      const directory = mkdtempSync(path.join(tmpdir(), 'scaleway-reuse-'));
      try {
        const bin = path.join(directory, 'bin');
        const output = path.join(directory, 'github-output');
        const calls = path.join(directory, 'aws-calls');
        const manifest = path.join(directory, 'manifest.json');
        const existing = path.join(directory, 'deployment/existing.json');
        const bucket = 'evorto-staging-deployment-test';
        const latestKey = 'deployments/staging/latest.json';
        const sourceMapsKey = `source-maps/${revision}/${digestHash}.tar.gz`;
        const sbomKey = `sbom/${revision}/${digestHash}.spdx.json`;
        const digest = `sha256:${digestHash}`;
        mkdirSync(bin);
        mkdirSync(path.dirname(existing));
        writeFileSync(output, '');
        writeFileSync(calls, '');
        writeFileSync(existing, 'stale manifest');
        writeFileSync(
          manifest,
          JSON.stringify({
            digest,
            environment: 'staging',
            image: `rg.fr-par.scw.cloud/evorto-staging/evorto@${digest}`,
            revision,
            sbomKey,
            schemaHash: 'c'.repeat(64),
            sourceMapsKey,
            status: 'succeeded',
          }),
        );
        writeFileSync(
          path.join(bin, 'aws'),
          `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$AWS_CALL_LOG"
if [ "$1 $2" = 's3api head-object' ]; then
  if [ "$6" = "$AWS_FAILED_KEY" ]; then
    printf '%s\\n' "$AWS_FAILURE_MESSAGE" >&2
    exit "$AWS_FAILURE_STATUS"
  fi
elif [ "$1 $2" = 's3 cp' ]; then
  if [ "$AWS_DOWNLOAD_STATUS" != '0' ]; then
    printf '%s\\n' "$AWS_FAILURE_MESSAGE" >&2
    exit "$AWS_DOWNLOAD_STATUS"
  fi
  cp "$AWS_MANIFEST" "$4"
else
  printf 'Unexpected AWS command: %s\\n' "$*" >&2
  exit 99
fi
`,
          { mode: 0o700 },
        );
        const failedKey =
          failAt === 'latest'
            ? latestKey
            : failAt === 'source-maps'
              ? sourceMapsKey
              : failAt === 'sbom'
                ? sbomKey
                : '';
        const result = spawnSync(
          'bash',
          ['--noprofile', '--norc', '-eu', '-c', reuse],
          {
            cwd: directory,
            encoding: 'utf8',
            env: {
              PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
              AWS_CALL_LOG: calls,
              AWS_DOWNLOAD_STATUS:
                failAt === 'download' ? String(awsStatus) : '0',
              AWS_FAILED_KEY: failedKey,
              AWS_FAILURE_MESSAGE: awsError,
              AWS_FAILURE_STATUS: String(awsStatus),
              AWS_MANIFEST: manifest,
              GITHUB_OUTPUT: output,
              METADATA_BUCKET: bucket,
              REVISION: revision,
            },
            timeout: 5000,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(expectedStatus);
        expect(result.stderr).toBe(expectedStatus === 0 ? '' : `${awsError}\n`);
        expect(readFileSync(output, 'utf8')).toBe(
          expectedReuse ? `reuse=${expectedReuse}\n` : '',
        );
        const headCall = (key: string) =>
          `s3api head-object --bucket ${bucket} --key ${key} --endpoint-url https://s3.fr-par.scw.cloud`;
        expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual(
          [
            headCall(latestKey),
            `s3 cp s3://${bucket}/${latestKey} deployment/existing.json --endpoint-url https://s3.fr-par.scw.cloud --only-show-errors`,
            headCall(sourceMapsKey),
            headCall(sbomKey),
          ].slice(0, callCount),
        );
        if (expectedReuse === 'false') {
          expect(existsSync(existing)).toBe(false);
        } else if (expectedReuse === 'true') {
          expect(readFileSync(existing, 'utf8')).toBe(
            readFileSync(manifest, 'utf8'),
          );
        }
      } finally {
        rmSync(directory, { force: true, recursive: true });
      }
    },
  );

  it.each([
    { name: 'true', value: 'true', expectedStatus: 0 },
    { name: 'false', value: 'false', expectedStatus: 1 },
    { name: 'missing', value: undefined, expectedStatus: 1 },
    { name: 'empty', value: '', expectedStatus: 1 },
    { name: 'uppercase true', value: 'TRUE', expectedStatus: 1 },
  ])(
    'validates protected production enablement with $name',
    ({ value, expectedStatus }) => {
      const runBody = workflowScript(
        'production',
        'Validate explicit production enablement and protected configuration',
      );
      const result = spawnSync(
        '/bin/bash',
        [
          '--noprofile',
          '--norc',
          '-eu',
          '-c',
          `aws() { return 99; }
jq() { printf '%s\\n' 'protected-tool-check' >&2; }
${runBody}`,
        ],
        {
          encoding: 'utf8',
          env: {
            AWS_ACCESS_KEY_ID: 'fixture',
            AWS_SECRET_ACCESS_KEY: 'fixture',
            CLOUDFLARE_API_TOKEN: 'fixture',
            CONFIRMATION: 'promote-alpha',
            PRODUCTION_ENABLED: value,
            PRODUCTION_TERRAFORM_STATE_BUCKET: 'fixture',
            PROTECTED_SECRET_VALUES: '{}',
            RUNTIME_DATABASE_PASSWORD: 'fixture',
            SCHEMA_DATABASE_PASSWORD: 'fixture',
            SCW_ACCESS_KEY: 'fixture',
            SCW_DEFAULT_ORGANIZATION_ID: 'fixture',
            SCW_DEFAULT_PROJECT_ID: 'fixture',
            SCW_SECRET_KEY: 'fixture',
            TF_VAR_alert_email: 'fixture',
            TF_VAR_bucket_suffix: 'fixture',
            TF_VAR_cloudflare_zone_id: 'fixture',
            TF_VAR_deployer_application_id: 'fixture',
            TF_VAR_project_id: 'fixture',
            TF_VAR_runtime_database_password_version: 'fixture',
            TF_VAR_schema_database_password_version: 'fixture',
            TF_VAR_tem_project_id: 'fixture',
            TF_VAR_web_application_id: 'fixture',
            TF_VAR_worker_application_id: 'fixture',
          },
          timeout: 5000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(expectedStatus);
      expect(result.stdout).toBe(
        expectedStatus === 0
          ? ''
          : '::error::Production promotion requires PRODUCTION_ENABLED to be exactly true\n',
      );
      expect(result.stderr).toBe(
        expectedStatus === 0 ? 'protected-tool-check\n' : '',
      );
    },
  );

  it('verifies managed Drizzle schema connections against the database identity', () => {
    const caCertificate = [
      '-----BEGIN CERTIFICATE-----',
      'managed-database-ca',
      '-----END CERTIFICATE-----',
    ].join('\n');
    const result = readManagedSchemaConfig({
      DATABASE_TLS_CA_CERTIFICATE: caCertificate,
      DATABASE_TLS_REQUIRED: 'true',
      DATABASE_URL:
        'postgresql://schema_owner:p%40ss%2Fword@10.0.0.8:6432/evorto%20staging',
    });
    expect(result.status, result.stderr).toBe(0);
    const importedConfig: unknown = JSON.parse(result.stdout);
    expect(importedConfig).toMatchObject({
      checkServerIdentityIsFunction: true,
      config: {
        dbCredentials: {
          database: 'evorto staging',
          host: '10.0.0.8',
          password: 'p@ss/word',
          port: 6432,
          ssl: {
            ca: caCertificate,
            rejectUnauthorized: true,
          },
          user: 'schema_owner',
        },
        dialect: 'postgresql',
      },
    });
  });

  it.each([
    ['missing', undefined],
    ['blank', ''],
  ] as const)(
    'rejects a %s managed schema TLS choice',
    (_caseName, tlsChoice) => {
      const result = readManagedSchemaConfig({
        DATABASE_TLS_REQUIRED: tlsChoice,
        DATABASE_URL:
          'postgresql://schema_owner:password@database.example/evorto',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'DATABASE_TLS_REQUIRED must be explicitly configured as true or false',
      );
    },
  );

  it('accepts an explicit disabled managed schema TLS choice', () => {
    const databaseUrl =
      'postgresql://schema_owner:password@database.example/evorto';
    const result = readManagedSchemaConfig({
      DATABASE_TLS_REQUIRED: 'false',
      DATABASE_URL: databaseUrl,
    });
    expect(result.status, result.stderr).toBe(0);
    const importedConfig: unknown = JSON.parse(result.stdout);
    expect(importedConfig).toMatchObject({
      checkServerIdentityIsFunction: false,
      config: {
        dbCredentials: { url: databaseUrl },
        dialect: 'postgresql',
      },
    });
  });
});
