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

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const source = (relativePath: string): string =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const between = (contents: string, start: string, end?: string): string => {
  const startIndex = contents.indexOf(start);
  expect(startIndex, `missing source marker: ${start}`).toBeGreaterThanOrEqual(
    0,
  );
  const endIndex = end ? contents.indexOf(end, startIndex + start.length) : -1;
  return contents.slice(startIndex, endIndex === -1 ? undefined : endIndex);
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

describe('Scaleway hosting source', () => {
  const revision = 'd'.repeat(40);
  const digestHash = 'a'.repeat(64);

  it.each([
    { name: 'current accepted revision', expected: [0, 0] },
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
  ])('checks both production revision snapshots: $name', (scenario) => {
    const context = {
      workflowRef: 'refs/heads/main',
      workflowRevision: revision,
      firstMain: revision,
      secondMain: revision,
      selectedRevision: revision,
      failFirst: false,
      failSecond: false,
      ...scenario,
    };
    const workflow = source('.github/workflows/scaleway-production.yml');
    const firstStep = between(
      workflow,
      '- name: Require the current main production workflow',
      '- name: Fetch and validate the accepted staging manifest',
    );
    const finalStep = between(
      workflow,
      '- name: Recheck current main before production writes',
      '- name: Reconcile production role-scoped Secret Manager values',
    );
    const writeGuard = workflow.indexOf(
      '- name: Recheck current main before production writes',
    );
    expect(writeGuard).toBeGreaterThan(
      workflow.indexOf(
        '- name: Verify production infrastructure has no pending changes',
      ),
    );
    for (const mutation of [
      '- name: Reconcile production role-scoped Secret Manager values',
      '- name: Deploy production ops and apply only a stable safe schema plan',
      '- name: Deploy production worker and web at the accepted digest',
    ])
      expect(writeGuard).toBeLessThan(workflow.indexOf(mutation));
    const runBody = (step: string) => {
      const marker = '        run: |\n';
      const offset = step.indexOf(marker);
      if (offset < 0) throw new Error('Missing actual production guard script');
      return step
        .slice(offset + marker.length)
        .split('\n')
        .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
        .join('\n');
    };
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
            runBody(step) + '\nprintf "guard-passed\\n"',
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
      expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual([
        'api repos/evorto-app/app/commits/main --jq .sha',
        'api repos/evorto-app/app/commits/main --jq .sha',
      ]);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

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
      const reuse = between(
        source('.github/workflows/scaleway-staging.yml'),
        '- name: Reuse an already-built exact-SHA image when available',
        '- name: Build and push the immutable Linux amd64 image once',
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
      const validation = between(
        source('.github/workflows/scaleway-production.yml'),
        '- name: Fetch and validate the accepted staging manifest',
        '- name: Checkout the exact accepted staging revision',
      );
      const predicate = validation.match(
        /'(\.status == "succeeded"[\s\S]*?)' \\/u,
      )?.[1];
      if (!predicate) {
        throw new Error('Missing production manifest validation predicate');
      }
      expect(validation).toContain(
        'FORWARD_REVISION: ${{ steps.forward.outputs.revision }}',
      );
      expect(validation).toContain(
        '--arg forward_revision "${FORWARD_REVISION}"',
      );
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
      const reuse = between(
        source('.github/workflows/scaleway-staging.yml'),
        '- name: Reuse an already-built exact-SHA image when available',
        '- name: Build and push the immutable Linux amd64 image once',
      );
      const runBody = reuse.split('        run: |\n')[1];
      if (!runBody) {
        throw new Error('Missing staging artifact reuse shell body');
      }
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
          [
            '--noprofile',
            '--norc',
            '-eu',
            '-c',
            runBody.replace(/^ {10}/gmu, '').trim(),
          ],
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

  it('retires the legacy Fly deployment surface and hostname', () => {
    const server = source('src/server.ts');
    const seoMetadata = source('src/server/http/seo-metadata.web-handler.ts');

    for (const removedPath of [
      '.github/workflows/fly-deploy.yml',
      'fly.toml',
    ]) {
      expect(existsSync(path.join(repositoryRoot, removedPath))).toBe(false);
    }

    for (const currentSource of [
      source('angular.json'),
      source('src/db/setup-database.ts'),
      seoMetadata,
    ]) {
      expect(currentSource).not.toContain('evorto.fly.dev');
    }
    expect(seoMetadata).not.toContain('alpha.evorto.app');
    expect(server).toMatch(/\bseoMetadataRouteLayer,/u);
    expect(seoMetadata).toContain('export const seoMetadataRouteLayer');
    expect(existsSync(path.join(repositoryRoot, 'public/robots.txt'))).toBe(
      false,
    );
    expect(existsSync(path.join(repositoryRoot, 'public/sitemap.xml'))).toBe(
      false,
    );
  });

  it('isolates every Terraform root behind its own state identity and bucket', () => {
    const bootstrap = source('infrastructure/scaleway/bootstrap/versions.tf');
    const bootstrapIam = source('infrastructure/scaleway/bootstrap/iam.tf');
    const bootstrapMain = source('infrastructure/scaleway/bootstrap/main.tf');
    const bootstrapOutputs = source(
      'infrastructure/scaleway/bootstrap/outputs.tf',
    );
    const bootstrapVariables = source(
      'infrastructure/scaleway/bootstrap/variables.tf',
    );
    const stagingVersions = source(
      'infrastructure/scaleway/staging/versions.tf',
    );
    const productionVersions = source(
      'infrastructure/scaleway/production/versions.tf',
    );
    const stagingMain = source('infrastructure/scaleway/staging/main.tf');
    const productionMain = source('infrastructure/scaleway/production/main.tf');
    const staging = source('.github/workflows/scaleway-staging.yml');
    const stagingReset = source('.github/workflows/scaleway-staging-reset.yml');
    const production = source('.github/workflows/scaleway-production.yml');
    const quality = source('.github/workflows/pr-quality.yml');
    const verification = source('ops/scaleway/verify-terraform.sh');

    for (const removedMixedRoot of [
      'infrastructure/scaleway/main.tf',
      'infrastructure/scaleway/dns.tf',
      'infrastructure/scaleway/variables.tf',
      'infrastructure/scaleway/outputs.tf',
      'infrastructure/scaleway/versions.tf',
    ]) {
      expect(existsSync(path.join(repositoryRoot, removedMixedRoot))).toBe(
        false,
      );
    }

    expect(bootstrap).toContain(
      'key                         = "evorto/bootstrap.tfstate"',
    );
    expect(stagingVersions).toContain(
      'key                         = "evorto/staging.tfstate"',
    );
    expect(productionVersions).toContain(
      'key                         = "evorto/production.tfstate"',
    );
    expect(
      existsSync(
        path.join(
          repositoryRoot,
          'infrastructure/scaleway/backend.hcl.example',
        ),
      ),
    ).toBe(false);
    for (const root of ['bootstrap', 'staging', 'production'] as const) {
      const backendExample = source(
        `infrastructure/scaleway/${root}/backend.hcl.example`,
      );
      expect(backendExample).toContain(
        `evorto-terraform-state-${root}-replace-with-unique-suffix`,
      );
      expect(backendExample).not.toMatch(/^\s*key\s*=/mu);
      expect(bootstrapMain).toMatch(
        new RegExp(`bucket_name\\s+= var\\.state_bucket_names\\.${root}`, 'u'),
      );
      expect(bootstrapOutputs).toContain(
        `scaleway_object_bucket.terraform_state["${root}"].name`,
      );
      expect(bootstrapIam).toContain(
        `resource "scaleway_iam_application" "${root}_terraform_state"`,
      );
      expect(bootstrapIam).toContain(
        `resource "scaleway_iam_policy" "${root}_terraform_state"`,
      );
    }
    expect(bootstrapVariables).toContain(
      'length(toset(values(var.state_bucket_names))) == 3',
    );
    expect(bootstrapMain).toContain(
      'for_each = local.terraform_state_backends',
    );
    expect(bootstrapMain).toContain(
      'SCW = "application_id:${each.value.application_id}"',
    );
    expect(
      between(
        bootstrapIam,
        'resource "scaleway_iam_policy" "bootstrap_terraform_state"',
        'resource "scaleway_iam_policy" "staging_terraform_state"',
      ),
    ).toContain('project_ids          = [var.bootstrap_project_id]');
    expect(
      between(
        bootstrapIam,
        'resource "scaleway_iam_policy" "staging_terraform_state"',
        'resource "scaleway_iam_policy" "production_terraform_state"',
      ),
    ).toContain('project_ids          = [scaleway_account_project.staging.id]');
    expect(
      between(
        bootstrapIam,
        'resource "scaleway_iam_policy" "production_terraform_state"',
        'resource "scaleway_iam_application" "staging_deployer"',
      ),
    ).toContain(
      'project_ids          = [scaleway_account_project.production.id]',
    );
    expect(stagingMain).toMatch(/environment\s+= "staging"/u);
    expect(stagingMain).not.toMatch(/environment\s+= "production"/u);
    expect(stagingMain).not.toContain('alpha.evorto.app');
    expect(productionMain).toMatch(/environment\s+= "production"/u);
    expect(productionMain).toMatch(/hostname\s+= "alpha\.evorto\.app"/u);
    expect(staging).toContain(
      'terraform -chdir=infrastructure/scaleway/staging',
    );
    expect(staging).not.toContain(
      'terraform -chdir=infrastructure/scaleway/production',
    );
    expect(production).toContain(
      'terraform -chdir=infrastructure/scaleway/production',
    );
    expect(production).not.toContain(
      'terraform -chdir=infrastructure/scaleway/staging',
    );
    for (const stagingWorkflow of [staging, stagingReset]) {
      expect(stagingWorkflow).toContain(
        '${{ secrets.STAGING_TERRAFORM_STATE_ACCESS_KEY_ID }}',
      );
      expect(stagingWorkflow).toContain(
        '${{ secrets.STAGING_TERRAFORM_STATE_SECRET_ACCESS_KEY }}',
      );
      expect(stagingWorkflow).toContain(
        '${{ vars.STAGING_TERRAFORM_STATE_BUCKET }}',
      );
      expect(stagingWorkflow).not.toContain(
        '${{ secrets.TERRAFORM_STATE_ACCESS_KEY_ID }}',
      );
      expect(stagingWorkflow).not.toContain(
        '${{ secrets.TERRAFORM_STATE_SECRET_ACCESS_KEY }}',
      );
      expect(stagingWorkflow).not.toContain(
        '${{ vars.TERRAFORM_STATE_BUCKET }}',
      );
      expect(stagingWorkflow).not.toContain(
        'PRODUCTION_TERRAFORM_STATE_ACCESS_KEY_ID',
      );
    }
    expect(production).toContain(
      '${{ secrets.PRODUCTION_TERRAFORM_STATE_ACCESS_KEY_ID }}',
    );
    expect(production).toContain(
      '${{ secrets.PRODUCTION_TERRAFORM_STATE_SECRET_ACCESS_KEY }}',
    );
    expect(production).toContain(
      '${{ vars.PRODUCTION_TERRAFORM_STATE_BUCKET }}',
    );
    expect(production).not.toContain(
      '${{ secrets.TERRAFORM_STATE_ACCESS_KEY_ID }}',
    );
    expect(production).not.toContain(
      '${{ secrets.TERRAFORM_STATE_SECRET_ACCESS_KEY }}',
    );
    expect(production).not.toContain('${{ vars.TERRAFORM_STATE_BUCKET }}');
    expect(production).not.toContain('STAGING_TERRAFORM_STATE_ACCESS_KEY_ID');
    for (const productionRuntimeVariable of [
      'TF_VAR_production_enabled',
      'TF_VAR_production_container_image',
      'TF_VAR_production_runtime_database_password',
      'TF_VAR_production_schema_database_password',
    ]) {
      expect(staging).not.toContain(productionRuntimeVariable);
    }
    expect(production).not.toContain('TF_VAR_staging_');
    expect(production).not.toContain('STAGING_RUNTIME_DATABASE_PASSWORD');
    expect(production).not.toContain('STAGING_SCHEMA_DATABASE_PASSWORD');
    expect(staging).not.toContain('-target=');
    expect(production).not.toContain('-target=');
    for (const root of ['bootstrap', 'staging', 'production']) {
      expect(quality).toContain('for root in bootstrap staging production; do');
      expect(verification).toContain(`infrastructure/scaleway/${root}`);
    }
    for (const root of [bootstrap, stagingVersions, productionVersions]) {
      expect(root).not.toContain('terraform_remote_state');
    }
    for (const root of [stagingMain, productionMain]) {
      expect(root).not.toContain('count =');
      expect(root).not.toContain('coalesce(');
      expect(root).not.toContain('moved {');
    }
    expect(between(production, '  promote:', '    steps:')).not.toContain(
      'PRODUCTION_ENABLED',
    );
    expect(production).toContain('environment: scaleway-production');
    expect(production).toContain('CONFIRMATION: ${{ inputs.confirmation }}');
    expect(production).toContain(
      'if [ "${CONFIRMATION}" != "promote-alpha" ]; then',
    );
    expect(production).not.toContain('pull_request_target:');
  });

  it.each([
    { name: 'true', value: 'true', expectedStatus: 0 },
    { name: 'false', value: 'false', expectedStatus: 1 },
    { name: 'missing', value: undefined, expectedStatus: 1 },
    { name: 'empty', value: '', expectedStatus: 1 },
    { name: 'uppercase true', value: 'TRUE', expectedStatus: 1 },
  ])(
    'validates protected production enablement with $name',
    ({ value, expectedStatus }) => {
      const production = source('.github/workflows/scaleway-production.yml');
      const steps = between(production, '    steps:\n');
      expect(steps).toMatch(
        /^ {4}steps:\n {6}- name: Validate explicit production enablement and protected configuration\n/u,
      );
      const validation = between(
        steps,
        '- name: Validate explicit production enablement and protected configuration',
        '      - name: Require the current main production workflow',
      );
      expect(validation).toContain(
        'PRODUCTION_ENABLED: ${{ vars.PRODUCTION_ENABLED }}',
      );
      const runBody = validation.split('        run: |\n')[1];
      if (!runBody) {
        throw new Error('Missing protected production validation commands');
      }
      const result = spawnSync(
        '/bin/bash',
        [
          '--noprofile',
          '--norc',
          '-eu',
          '-c',
          `aws() { return 99; }
jq() { printf '%s\\n' 'protected-tool-check' >&2; }
${runBody.replace(/^ {10}/gmu, '').trim()}`,
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

  it('provisions private PostgreSQL 17 with separate runtime and schema users', () => {
    const stagingMain = source('infrastructure/scaleway/staging/main.tf');
    const productionMain = source('infrastructure/scaleway/production/main.tf');
    const database = source(
      'infrastructure/scaleway/modules/environment/database.tf',
    );
    const outputs = source(
      'infrastructure/scaleway/modules/environment/outputs.tf',
    );
    const moduleVariables = source(
      'infrastructure/scaleway/modules/environment/variables.tf',
    );
    const stagingVariables = source(
      'infrastructure/scaleway/staging/variables.tf',
    );
    const staging = source('.github/workflows/scaleway-staging.yml');
    const production = source('.github/workflows/scaleway-production.yml');
    const bootstrapIam = source('infrastructure/scaleway/bootstrap/iam.tf');

    expect(database).toContain('engine        = "PostgreSQL-17"');
    expect(database).toContain('encryption_at_rest        = true');
    expect(database).toContain('backup_schedule_frequency = 24');
    expect(database).toContain('private_network {');
    expect(database).not.toContain('load_balancer');
    expect(outputs).toContain(
      'host          = scaleway_rdb_instance.application.private_network[0].ip',
    );
    expect(outputs).not.toContain(
      'scaleway_rdb_instance.application.private_network[0].hostname',
    );
    expect(database).toContain('user_name           = "schema_owner"');
    expect(database).toContain('name                = "application_runtime"');
    expect(database).toContain('is_admin            = false');
    expect(database).toMatch(
      /resource "scaleway_rdb_privilege" "schema" \{[^}]*user_name\s+= scaleway_rdb_instance\.application\.user_name[^}]*permission\s+= "all"/u,
    );
    expect(database).toMatch(
      /resource "scaleway_rdb_privilege" "runtime" \{[^}]*user_name\s+= scaleway_rdb_user\.runtime\.name[^}]*permission\s+= "readwrite"/u,
    );
    expect(database).toContain(
      'password_wo_version = var.schema_database_password_version',
    );
    expect(database).toContain(
      'password_wo_version = var.runtime_database_password_version',
    );
    expect(moduleVariables).toContain(
      'variable "schema_database_password_version"',
    );
    expect(moduleVariables).toContain(
      'variable "runtime_database_password_version"',
    );
    expect(stagingVariables).toContain(
      'variable "schema_database_password_version"',
    );
    expect(stagingVariables).toContain(
      'variable "runtime_database_password_version"',
    );
    expect(stagingMain).toMatch(
      /schema_database_password_version\s+= var\.schema_database_password_version/u,
    );
    expect(stagingMain).toMatch(
      /runtime_database_password_version\s+= var\.runtime_database_password_version/u,
    );
    expect(staging).toContain(
      'TF_VAR_schema_database_password_version: ${{ vars.SCHEMA_DATABASE_PASSWORD_VERSION }}',
    );
    expect(staging).toContain(
      'TF_VAR_runtime_database_password_version: ${{ vars.RUNTIME_DATABASE_PASSWORD_VERSION }}',
    );
    expect(production).toContain(
      'TF_VAR_schema_database_password_version: ${{ vars.PRODUCTION_SCHEMA_DATABASE_PASSWORD_VERSION }}',
    );
    expect(production).toContain(
      'TF_VAR_runtime_database_password_version: ${{ vars.PRODUCTION_RUNTIME_DATABASE_PASSWORD_VERSION }}',
    );
    expect(stagingMain).toMatch(/database_node_type\s+= "DB-DEV-S"/u);
    expect(stagingMain).toMatch(/database_backup_retention_days\s+= 7/u);
    expect(productionMain).toMatch(/database_node_type\s+= "DB-POP2-2C-8G"/u);
    expect(productionMain).toMatch(/database_is_ha\s+= true/u);
    expect(productionMain).toMatch(/database_backup_retention_days\s+= 30/u);
    expect(bootstrapIam).toContain('"IPAMReadOnly"');
    for (const [resource, nextResource] of [
      ['scaleway_rdb_instance', 'scaleway_rdb_database'],
      ['scaleway_rdb_database', 'scaleway_rdb_privilege'],
    ]) {
      expect(
        between(
          database,
          `resource "${resource}" "application" {`,
          `resource "${nextResource}"`,
        ),
      ).toMatch(/lifecycle\s*\{\s*prevent_destroy\s*=\s*true\s*\}/u);
    }
  });

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

    const containers = source(
      'infrastructure/scaleway/modules/environment/containers.tf',
    );
    expect(containers).not.toContain('DATABASE_TLS_SERVER_NAME');
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

  it('requires an explicit TLS choice in every packaged database operation', () => {
    for (const filePath of [
      'src/server/ops/database-prerequisites.ts',
      'src/server/ops/reset-staging-database.ts',
    ]) {
      expect(source(filePath), filePath).toContain(
        'DATABASE_TLS_REQUIRED must be explicitly configured as true or false',
      );
    }
  });

  it('keeps web, worker, and ops isolated in one bounded container shape', () => {
    const containers = source(
      'infrastructure/scaleway/modules/environment/containers.tf',
    );
    const server = source('src/server.ts');
    const roles = source('src/server/config/deployment-config.ts');
    const web = between(
      containers,
      'resource "scaleway_container" "web"',
      'resource "scaleway_container" "worker"',
    );
    const worker = between(
      containers,
      'resource "scaleway_container" "worker"',
      'resource "scaleway_container" "ops"',
    );
    const ops = between(
      containers,
      'resource "scaleway_container" "ops"',
      'locals {\n  worker_triggers',
    );

    expect(roles).toContain("['web', 'worker', 'ops']");
    expect(containers).toContain('APP_BOOTSTRAP                    = "true"');
    expect(containers.match(/cpu_limit\s+= 560/gu)).toHaveLength(3);
    expect(containers).toContain('container_memory_limit_bytes = 1073000000');
    expect(
      containers.match(
        /memory_limit_bytes\s+= local\.container_memory_limit_bytes/gu,
      ),
    ).toHaveLength(3);
    expect(containers.match(/private_network_id\s+=/gu)).toHaveLength(3);
    expect(containers).not.toMatch(/^\s+PORT\s+=/gmu);
    expect(
      containers.match(/startup_probe \{[\s\S]*?interval\s+= "5s"/gu),
    ).toHaveLength(3);
    expect(web).toContain('privacy                = "public"');
    expect(web).toContain('max_scale              = 3');
    expect(containers).toContain(
      'SSR_RPC_ORIGIN        = "http://127.0.0.1:4200"',
    );
    for (const privateRole of [worker, ops]) {
      expect(privateRole).toContain('privacy                = "private"');
      expect(privateRole).toContain('min_scale              = 0');
      expect(privateRole).toContain('max_scale              = 1');
    }
    for (const [role, startupPath] of [
      [web, '/readyz'],
      [worker, '/readyz'],
      [ops, '/healthz'],
    ]) {
      expect(between(role, 'startup_probe {', 'liveness_probe {')).toContain(
        `path = "${startupPath}"`,
      );
      expect(between(role, 'liveness_probe {', '\n}')).toContain(
        'path = "/healthz"',
      );
    }
    expect(source('infrastructure/scaleway/staging/main.tf')).toMatch(
      /web_min_scale\s+= 0/u,
    );
    expect(source('infrastructure/scaleway/production/main.tf')).toMatch(
      /web_min_scale\s+= 1/u,
    );
    expect(server).toContain('const webRoutesLayer = Layer.mergeAll(');
    expect(server).toContain('const workerRoutesLayer = Layer.mergeAll(');
    expect(server).toContain('const opsRoutesLayer = Layer.mergeAll(');
    expect(server).toContain('const bootstrapRoutesLayer = Layer.mergeAll(');
    expect(server).toContain('runtimeRole.bootstrap');
    expect(server).toContain(
      "runtimeRole.bootstrap || runtimeRole.role === 'ops'",
    );
    expect(server).toContain("runtimeRole.role === 'worker'");
    expect(server).toContain("runtimeRole.role === 'ops'");
    expect(server).toMatch(
      /registrationRefundWorkerRuntimeModeConfig\s*\.parse\(requestHandlerRuntimeConfigProvider\)/u,
    );
    expect(server).toContain(
      'launchRegistrationRefundWorker(\n          registrationRefundWorkerMode,',
    );
  });

  it('bounds local database pools while sizing the web role for parallel browser coverage', () => {
    const compose = source('docker-compose.yml');
    const web = between(compose, '  evorto:', '  worker:');
    const worker = between(compose, '  worker:', '  stripe:\n    image:');

    expect(web).toContain('DATABASE_POOL_MAX: "20"');
    expect(worker).toContain('DATABASE_POOL_MAX: "5"');
  });

  it('defines only bounded worker CRON endpoints with explicit JSON bodies', () => {
    const containers = source(
      'infrastructure/scaleway/modules/environment/containers.tf',
    );
    const triggers = between(
      containers,
      'locals {\n  worker_triggers',
      'resource "scaleway_container_trigger" "worker"',
    );

    expect(triggers).toContain('/internal/worker/email-delivery');
    expect(triggers).toContain('/internal/worker/expired-checkout-cleanup');
    expect(triggers).toContain('/internal/worker/receipt-orphan-cleanup');
    expect(triggers).toContain('/internal/worker/stripe-refunds');
    expect(triggers.match(/body\s+= \{ limit = (?:25|50) \}/gu)).toHaveLength(
      4,
    );
    expect(containers).toContain('http_method = "post"');
    expect(containers).toContain('body     = jsonencode(each.value.body)');
  });

  it('keeps application, deployment, and Terraform state storage private and durable', () => {
    const stagingMain = source('infrastructure/scaleway/staging/main.tf');
    const productionMain = source('infrastructure/scaleway/production/main.tf');
    const storage = source(
      'infrastructure/scaleway/modules/environment/storage.tf',
    );
    const bootstrap = source('infrastructure/scaleway/bootstrap/main.tf');
    const bootstrapIam = source('infrastructure/scaleway/bootstrap/iam.tf');
    const versions = source('infrastructure/scaleway/staging/versions.tf');

    expect(storage).toContain('allowed_origins = ["https://${var.hostname}"]');
    expect(storage.match(/versioning \{\n\s+enabled = true/gu)).toHaveLength(2);
    expect(storage.match(/acl\s+= "private"/gu)).toHaveLength(2);
    expect(storage.match(/sse_algorithm = "AES256"/gu)).toHaveLength(2);
    expect(storage).toContain('abort_incomplete_multipart_upload_days = 1');
    expect(storage).toContain('prefix  = "receipt-uploads/"');
    expect(storage).toContain('prefix  = "source-maps/"');
    expect(storage).toContain('days = 90');
    expect(storage).toContain(
      'SCW = "application_id:${var.management_application_id}"',
    );
    expect(storage).toContain('"application_id:${var.web_application_id}"');
    expect(storage).toContain('"application_id:${var.worker_application_id}"');
    expect(storage).not.toContain('resource "scaleway_iam_application"');
    expect(storage).not.toContain('resource "scaleway_iam_policy"');
    expect(storage).toContain('Action = "s3:*"');
    expect(storage).toContain('Sid    = "PromotionReadAccess"');
    expect(storage).toContain(
      'for application_id in var.deployment_metadata_reader_application_ids',
    );
    expect(storage).toContain('"s3:ListBucket"');
    expect(storage).toContain('"s3:GetObject"');
    expect(storage).not.toContain('user_id:');
    expect(storage).toContain('scaleway_object_bucket_acl.application,');
    for (const main of [stagingMain, productionMain]) {
      expect(main).toMatch(
        /management_application_id\s+= var\.deployer_application_id/u,
      );
      expect(main).toMatch(/web_application_id\s+= var\.web_application_id/u);
      expect(main).toMatch(
        /worker_application_id\s+= var\.worker_application_id/u,
      );
    }
    expect(bootstrapIam).not.toContain('IAMManager');
    expect(bootstrapIam).not.toContain('BillingManager');
    expect(bootstrapIam).not.toContain('scaleway_iam_application" "ops');
    for (const permissionSet of [
      'ObjectStorageBucketsRead',
      'ObjectStorageObjectsDelete',
      'ObjectStorageObjectsRead',
      'ObjectStorageObjectsWrite',
    ]) {
      expect(bootstrapIam, permissionSet).toContain(`"${permissionSet}"`);
    }
    expect(bootstrapIam).toContain('"ContainerRegistryReadOnly"');
    expect(bootstrapIam).toContain(
      'project_ids          = [scaleway_account_project.staging.id]',
    );
    for (const workflow of [
      source('.github/workflows/scaleway-staging.yml'),
      source('.github/workflows/scaleway-production.yml'),
    ]) {
      expect(workflow).toContain(
        'TF_VAR_deployer_application_id: ${{ vars.SCW_DEPLOYER_APPLICATION_ID }}',
      );
      expect(workflow).toContain(
        'TF_VAR_web_application_id: ${{ vars.SCW_WEB_APPLICATION_ID }}',
      );
      expect(workflow).toContain(
        'TF_VAR_worker_application_id: ${{ vars.SCW_WORKER_APPLICATION_ID }}',
      );
    }
    expect(source('.github/workflows/scaleway-staging.yml')).toContain(
      'TF_VAR_production_deployer_application_id: ${{ vars.SCW_PRODUCTION_DEPLOYER_APPLICATION_ID }}',
    );
    expect(bootstrap.match(/prevent_destroy = true/gu)).toHaveLength(3);
    expect(bootstrap).toContain('acl        = "private"');
    expect(bootstrap).toContain('sse_algorithm = "AES256"');
    expect(versions).toContain('use_lockfile                = true');
    const moduleOutputs = source(
      'infrastructure/scaleway/modules/environment/outputs.tf',
    );
    expect(moduleOutputs).not.toContain('role_application_ids');
    expect(moduleOutputs).not.toContain('registry_endpoint');
    for (const environment of ['staging', 'production']) {
      const rootOutputs = source(
        `infrastructure/scaleway/${environment}/outputs.tf`,
      );
      expect(rootOutputs).toContain('output "platform"');
      expect(rootOutputs).toContain('output "database"');
    }
  });

  it('reconciles unproxied Scaleway application and email records through Cloudflare', () => {
    const bootstrapDns = source('infrastructure/scaleway/bootstrap/dns.tf');
    const stagingDns = source('infrastructure/scaleway/staging/dns.tf');
    const productionDns = source('infrastructure/scaleway/production/dns.tf');
    const bootstrapOutputs = source(
      'infrastructure/scaleway/bootstrap/outputs.tf',
    );
    const stagingOutputs = source('infrastructure/scaleway/staging/outputs.tf');
    const staging = source('.github/workflows/scaleway-staging.yml');
    const production = source('.github/workflows/scaleway-production.yml');
    const transactionalEmail = source(
      'infrastructure/scaleway/bootstrap/transactional-email.tf',
    );
    const versions = source('infrastructure/scaleway/staging/versions.tf');

    expect(versions).toContain('source  = "cloudflare/cloudflare"');
    expect(versions).toContain('version = "= 5.22.0"');
    expect(stagingDns).toContain('resource "cloudflare_dns_record" "web"');
    expect(productionDns).toContain('resource "cloudflare_dns_record" "web"');
    expect(stagingDns).toContain('resource "scaleway_container_domain" "web"');
    expect(productionDns).toContain(
      'resource "scaleway_container_domain" "web"',
    );
    expect(stagingDns).toContain('depends_on = [cloudflare_dns_record.web]');
    expect(productionDns).toContain('depends_on = [cloudflare_dns_record.web]');
    expect(bootstrapDns).not.toContain('moved {');
    expect(stagingDns).not.toContain('moved {');
    expect(productionDns).not.toContain('moved {');
    expect(bootstrapDns).toContain(
      'resource "cloudflare_dns_record" "transactional_email"',
    );
    expect(
      [bootstrapDns, stagingDns, productionDns]
        .join('\n')
        .match(/proxied\s+= false/gu),
    ).toHaveLength(3);
    expect(bootstrapDns).toContain(
      'scaleway_tem_domain.notifications.spf_value',
    );
    expect(bootstrapDns).not.toContain(
      'scaleway_tem_domain.notifications.spf_config',
    );
    expect(bootstrapDns).toContain(
      'content  = trimsuffix(local.tem_mx_parts[1], ".")',
    );
    expect(bootstrapDns).toContain(
      'priority = tonumber(local.tem_mx_parts[0])',
    );
    expect(bootstrapOutputs).toContain(
      'output "managed_transactional_email_dns_records"',
    );
    expect(bootstrapOutputs).toContain(
      'scaleway_tem_domain.notifications.spf_value',
    );
    expect(stagingOutputs).toContain('output "managed_dns_record"');
    expect(transactionalEmail).toContain(
      'depends_on = [cloudflare_dns_record.transactional_email]',
    );
    for (const workflow of [staging, production]) {
      expect(workflow).toContain(
        'TF_VAR_cloudflare_zone_id: ${{ vars.CLOUDFLARE_ZONE_ID }}',
      );
      expect(workflow).toContain(
        'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
      );
    }
  });

  it('declares role-scoped secret names without putting values in Terraform state', () => {
    const secrets = source(
      'infrastructure/scaleway/modules/environment/secrets.tf',
    );
    const containers = source(
      'infrastructure/scaleway/modules/environment/containers.tf',
    );
    const outputs = source(
      'infrastructure/scaleway/modules/environment/outputs.tf',
    );

    for (const requiredName of [
      'CLIENT_SECRET',
      'COCKPIT_TRACES_TOKEN',
      'DATABASE_TLS_CA_CERTIFICATE',
      'DATABASE_URL',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'TEM_API_TOKEN',
    ]) {
      expect(secrets, requiredName).toContain(`"${requiredName}"`);
    }
    expect(secrets).toContain(
      'var.environment == "staging" ? toset(["STAGING_EMAIL_ALLOWLIST"])',
    );
    const opsSecrets = between(secrets, '    ops = setunion(', '\n  }');
    expect(opsSecrets).toContain(
      'var.environment == "staging" ? toset(["STRIPE_TEST_ACCOUNT_ID"]) : toset([])',
    );
    expect(source('infrastructure/scaleway/README.md')).toContain(
      'ops/STRIPE_TEST_ACCOUNT_ID',
    );
    expect(secrets).toContain('protected   = true');
    expect(secrets).not.toContain('scaleway_secret_version');
    expect(
      containers.match(/secret_environment_variables = \{\}/gu),
    ).toHaveLength(3);
    expect(containers.match(/ignore_changes = \[/gu)).toHaveLength(3);
    expect(containers).not.toMatch(/^\s+SCW_[A-Z0-9_]+\s+=/gmu);
    expect(outputs).toContain('key => trimprefix(secret.id, "${var.region}/")');
    expect(outputs).not.toContain('key => secret.id');
  });

  it('uses native container telemetry, custom traces, all provider alerts, and release-aware logs', () => {
    const containers = source(
      'infrastructure/scaleway/modules/environment/containers.tf',
    );
    const moduleVariables = source(
      'infrastructure/scaleway/modules/environment/variables.tf',
    );
    const observability = source(
      'infrastructure/scaleway/modules/environment/observability.tf',
    );
    const logger = source('src/server/effect/server-logger.layer.ts');
    const bootstrap = source('infrastructure/scaleway/bootstrap/main.tf');

    expect(observability).toContain('type           = "traces"');
    expect(observability).not.toContain('type           = "logs"');
    expect(observability).not.toContain('type           = "metrics"');
    expect(containers).toMatch(/TRACE_SAMPLING_RATIO\s+= "0\.1"/u);
    expect(moduleVariables).toMatch(
      /variable "cockpit_trace_retention_days" \{[\s\S]*?default\s+= 7/u,
    );
    expect(observability).toContain(
      'preconfigured_alert_ids = toset(data.scaleway_cockpit_preconfigured_alert.available.alerts[*].preconfigured_rule_id)',
    );
    expect(observability).toContain('email = var.alert_email');
    expect(bootstrap).toContain(
      'resource "scaleway_billing_budget" "organization"',
    );
    for (const annotation of [
      'environment:',
      'imageDigest:',
      'revision:',
      'role:',
    ]) {
      expect(logger, annotation).toContain(annotation);
    }
  });

  it('smokes rendered event routes and the Effect RPC protocol contract', () => {
    const stagingSmoke = between(
      source('.github/workflows/scaleway-staging.yml'),
      '- name: Verify staging revision, readiness, tenancy, Auth0, RPC, and noindex',
      '- name: Write append-only successful deployment manifest',
    );
    const productionSmoke = between(
      source('.github/workflows/scaleway-production.yml'),
      '- name: Smoke the promoted production release',
      '- name: Write append-only production deployment manifest',
    );

    expect(stagingSmoke).toContain('https://staging.evorto.app/events');
    expect(stagingSmoke).toContain('rpc_body="$(');
    expect(stagingSmoke).toContain('curl "${curl_args[@]}"');
    expect(stagingSmoke).toContain(
      '"tag":"config.isAuthenticated","payload":null',
    );
    expect(stagingSmoke).toContain('.[0]._tag == "Exit"');
    expect(stagingSmoke).toContain('.[0].exit._tag == "Success"');
    expect(stagingSmoke).toContain('.[0].exit.value == false');
    expect(stagingSmoke).not.toContain('._tag == "Defect"');
    expect(stagingSmoke).not.toContain('rpc_status=');
    expect(productionSmoke).toContain('https://alpha.evorto.app/events');
  });

  it('builds once, records immutable evidence, and promotes the exact OCI digest', () => {
    const staging = source('.github/workflows/scaleway-staging.yml');
    const production = source('.github/workflows/scaleway-production.yml');
    const quality = source('.github/workflows/pr-quality.yml');
    const deployRole = source('ops/scaleway/deploy-role.sh');
    const localImageSecurity = source('ops/scaleway/verify-image-security.sh');
    const stagingScan = between(
      staging,
      '- name: Scan exact deployed image digest',
      '- name: Verify staging infrastructure has no pending changes',
    );
    const productionScan = between(
      production,
      '- name: Scan exact promoted image digest',
      '- name: Verify production infrastructure has no pending changes',
    );

    expect(staging).toContain('workflow_run:');
    expect(staging).not.toContain('schedule:');
    expect(staging).not.toContain('cron:');
    expect(staging).toContain('full_trace_debugging:');
    expect(staging).toContain(
      "TRACE_SAMPLING_RATIO_OVERRIDE: ${{ inputs.full_trace_debugging && '1' || '' }}",
    );
    expect(staging).toContain('cancel-in-progress: false');
    expect(staging).toContain('ops/scaleway/require-release-gates.sh');
    expect(staging).toContain('--platform linux/amd64');
    expect(staging).toContain('--provenance=mode=max');
    expect(staging).toContain("--if-none-match '*'");
    expect(staging).toContain('/internal/ops/schema-explain');
    expect(staging).toContain('\'{"mode":"initialize-empty"}\'');
    expect(staging).toContain('-detailed-exitcode');
    expect(staging).not.toContain('terraform apply');
    expect(staging).not.toContain('previous.json');
    expect(staging).not.toContain('rollback');
    expect(staging).not.toContain('steps.ops.outputs.changed');
    expect(staging).not.toContain('steps.traffic.outputs');
    expect(staging).toContain(
      'curl_args=(--connect-timeout 5 --max-time 20 --silent --show-error)',
    );

    expect(production).not.toContain('docker build ');
    expect(production).not.toContain('docker buildx build ');
    expect(production).toContain('docker buildx imagetools create');
    expect(production).toContain('docker buildx imagetools inspect --raw');
    expect(production).toContain(
      'if [ "${target_digest}" != "${SOURCE_DIGEST}" ]; then',
    );
    expect(production).toContain('sourceStagingManifestKey:');
    expect(production).toContain('-detailed-exitcode');
    expect(production).not.toContain('terraform apply');
    expect(production).not.toContain('previous.json');
    expect(production).not.toContain('rollback');
    expect(production).toContain(
      'curl_args=(--connect-timeout 5 --max-time 20 --silent --show-error)',
    );
    expect(deployRole).toContain('APP_BOOTSTRAP: "false"');
    expect(deployRole).toContain('APP_DEPLOYMENT_FINGERPRINT');
    expect(deployRole).toContain('TRACE_SAMPLING_RATIO_OVERRIDE');
    expect(deployRole).toContain(
      'TRACE_SAMPLING_RATIO: $trace_sampling_ratio_override',
    );
    expect(deployRole).toContain(
      'container_id="${container_resource_id#"${region}/"}"',
    );
    expect(deployRole).toContain('container container get');
    expect(deployRole).toContain('region="${region}"');
    expect(deployRole).toContain('Failed to update the ${role} container');
    expect(staging).toContain('workflows: [E2E Baseline]');
    expect(staging).not.toContain('workflows: [PR Quality, E2E Baseline]');
    expect(stagingScan).toContain(
      'image-ref: ${{ steps.image.outputs.reference }}',
    );
    expect(stagingScan).not.toContain('if: steps.reuse.outputs.reuse');
    expect(productionScan).toContain(
      'image-ref: ${{ steps.image.outputs.reference }}',
    );
    expect(production.indexOf('Scan exact promoted image digest')).toBeLessThan(
      production.indexOf(
        'Verify production infrastructure has no pending changes',
      ),
    );
    for (const vulnerabilityGate of [
      stagingScan,
      productionScan,
      quality,
      localImageSecurity,
    ]) {
      expect(
        vulnerabilityGate.replaceAll(/^\s*ignore-unfixed: false\s*$/gmu, ''),
      ).not.toContain('ignore-unfixed');
    }
  });

  it('rescans the copied production digest before infrastructure and role deployment', () => {
    const production = source('.github/workflows/scaleway-production.yml');
    const scan = between(
      production,
      '- name: Scan exact promoted image digest',
      '- name: Verify production infrastructure has no pending changes',
    );

    expect(scan).toContain(
      'uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25',
    );
    expect(scan).toContain('image-ref: ${{ steps.image.outputs.reference }}');
    expect(scan).toContain('version: v0.70.0');
    expect(scan).toContain('cache: false');
    expect(scan).toContain('severity: HIGH,CRITICAL');
    expect(scan).toContain('ignore-unfixed: false');
    expect(scan).toContain('exit-code: "1"');
    expect(scan).not.toContain('${{ secrets.');
    expect(scan).not.toMatch(/\b(?:if|continue-on-error):/u);
    expect(scan).not.toContain('TRIVY_SKIP_DB_UPDATE');

    const requiredSteps = [
      '- name: Login to private Scaleway registry',
      '- name: Copy the accepted digest without rebuilding',
      '- name: Scan exact promoted image digest',
      '- name: Verify production infrastructure has no pending changes',
      '- name: Deploy production ops and apply only a stable safe schema plan',
      '- name: Deploy production worker and web at the accepted digest',
    ];
    let previousIndex = -1;
    for (const step of requiredSteps) {
      const index = production.indexOf(step);
      expect(index, step).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  it('provides worker email delivery at the HTTP request boundary', () => {
    const server = source('src/server.ts');

    expect(server).toContain(
      'HttpLayerRouter.provideRequest(EmailDelivery.Default)',
    );
    expect(server).not.toContain('Layer.provide(EmailDelivery.Default)');
  });

  it('bounds private container calls to reviewed role and operation pairs', () => {
    const invokePrivateContainer = source(
      'ops/scaleway/invoke-private-container.sh',
    );

    expect(invokePrivateContainer).toContain(
      '--connect-timeout "${connect_timeout_seconds}"',
    );
    expect(invokePrivateContainer).toContain(
      '--max-time "${maximum_time_seconds}"',
    );
    expect(invokePrivateContainer).toContain(
      'worker:/internal/worker/payment-setup',
    );
  });

  it('gates ordinary CI and destructive staging reset separately', () => {
    const quality = source('.github/workflows/pr-quality.yml');
    const reset = source('.github/workflows/scaleway-staging-reset.yml');
    const runtimeVerifier = source('ops/scaleway/verify-runtime-image.sh');

    expect(quality).toContain('name: Terraform validation and static scan');
    expect(quality).toContain(
      'name: Linux image, SBOM, vulnerabilities, and size',
    );
    expect(quality).toContain('name: CI/gate');
    expect(quality).toContain('bun run test:integration:postgres');
    expect(reset).toContain(
      'if [ "${CONFIRMATION}" != "reset-and-seed-staging" ]; then',
    );
    expect(reset).toContain('environment: scaleway-staging-reset');
    expect(reset).toContain('/internal/ops/seed-staging');
    expect(reset).toContain(
      'curl_args=(--connect-timeout 5 --max-time 20 --silent --show-error)',
    );
    expect(runtimeVerifier).toContain('maximum_size_bytes=1000000000');
    expect(runtimeVerifier).toContain("'api\\.resend\\.com|cloudflare[_-]r2");
    expect(runtimeVerifier).toContain('|@sentry|@neondatabase|resend)');
  });
});
