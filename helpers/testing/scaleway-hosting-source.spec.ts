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
      const digest = `sha256:${digestHash}`;
      const result = spawnSync('jq', ['--exit-status', predicate], {
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
      });
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

  it('keeps production defined but disabled until an explicit protected promotion', () => {
    const main = source('infrastructure/scaleway/main.tf');
    const variables = source('infrastructure/scaleway/variables.tf');
    const staging = source('.github/workflows/scaleway-staging.yml');
    const production = source('.github/workflows/scaleway-production.yml');

    expect(variables).toContain('variable "production_enabled"');
    expect(variables).toMatch(
      /variable "production_enabled" \{[\s\S]*?default\s+= false/u,
    );
    expect(main).toContain('count = var.production_enabled ? 1 : 0');
    expect(main).toMatch(/hostname\s+= "alpha\.evorto\.app"/u);
    expect(staging).toContain('TF_VAR_production_enabled: "false"');
    expect(production).toContain("if: vars.PRODUCTION_ENABLED == 'true'");
    expect(production).toContain('CONFIRMATION: ${{ inputs.confirmation }}');
    expect(production).toContain(
      'if [ "${CONFIRMATION}" != "promote-alpha" ]; then',
    );
    expect(production).not.toContain('pull_request_target:');
  });

  it('provisions private PostgreSQL 17 with separate runtime and schema users', () => {
    const main = source('infrastructure/scaleway/main.tf');
    const database = source(
      'infrastructure/scaleway/modules/environment/database.tf',
    );
    const outputs = source(
      'infrastructure/scaleway/modules/environment/outputs.tf',
    );
    const moduleVariables = source(
      'infrastructure/scaleway/modules/environment/variables.tf',
    );
    const rootVariables = source('infrastructure/scaleway/variables.tf');
    const staging = source('.github/workflows/scaleway-staging.yml');
    const production = source('.github/workflows/scaleway-production.yml');

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
    expect(rootVariables).toContain(
      'variable "staging_schema_database_password_version"',
    );
    expect(rootVariables).toContain(
      'variable "staging_runtime_database_password_version"',
    );
    expect(main).toContain(
      'schema_database_password_version    = var.staging_schema_database_password_version',
    );
    expect(main).toContain(
      'runtime_database_password_version   = var.staging_runtime_database_password_version',
    );
    expect(staging).toContain(
      'TF_VAR_staging_schema_database_password_version: ${{ vars.SCHEMA_DATABASE_PASSWORD_VERSION }}',
    );
    expect(staging).toContain(
      'TF_VAR_staging_runtime_database_password_version: ${{ vars.RUNTIME_DATABASE_PASSWORD_VERSION }}',
    );
    expect(production).toContain(
      'TF_VAR_production_schema_database_password_version: ${{ vars.PRODUCTION_SCHEMA_DATABASE_PASSWORD_VERSION }}',
    );
    expect(production).toContain(
      'TF_VAR_production_runtime_database_password_version: ${{ vars.PRODUCTION_RUNTIME_DATABASE_PASSWORD_VERSION }}',
    );
    expect(main).toMatch(/database_node_type\s+= "DB-DEV-S"/u);
    expect(main).toMatch(/database_backup_retention_days\s+= 7/u);
    expect(main).toMatch(/database_node_type\s+= "DB-POP2-2C-8G"/u);
    expect(main).toMatch(/database_is_ha\s+= true/u);
    expect(main).toMatch(/database_backup_retention_days\s+= 30/u);
    expect(main).toContain('"IPAMReadOnly"');
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
    expect(web.match(/path = "\/readyz"/gu)).toHaveLength(1);
    expect(web.match(/path = "\/healthz"/gu)).toHaveLength(1);
    expect(containers).toContain(
      'SSR_RPC_ORIGIN        = "http://127.0.0.1:4200"',
    );
    for (const privateRole of [worker, ops]) {
      expect(privateRole).toContain('privacy                = "private"');
      expect(privateRole).toContain('min_scale              = 0');
      expect(privateRole).toContain('max_scale              = 1');
      expect(privateRole.match(/path = "\/healthz"/gu)).toHaveLength(2);
    }
    expect(mainMinScale(source('infrastructure/scaleway/main.tf'))).toEqual({
      production: 1,
      staging: 0,
    });
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
    const main = source('infrastructure/scaleway/main.tf');
    const storage = source(
      'infrastructure/scaleway/modules/environment/storage.tf',
    );
    const bootstrap = source('infrastructure/scaleway/bootstrap/main.tf');
    const versions = source('infrastructure/scaleway/versions.tf');

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
    expect(storage).toContain('Action = "s3:*"');
    expect(storage).toContain('Sid    = "ConsoleBucketReadAccess"');
    expect(storage).toContain('Sid    = "ConsoleObjectReadAccess"');
    expect(storage).toContain('"user_id:${user_id}"');
    expect(storage).toContain('"s3:ListBucket"');
    expect(storage).toContain('"s3:GetObject"');
    expect(storage).not.toMatch(
      /Console(?:Bucket|Object)ReadAccess[\s\S]*?"s3:(?:Put|Delete)/u,
    );
    expect(storage).toContain('scaleway_object_bucket_acl.application,');
    expect(
      main.match(
        /management_application_id\s+= scaleway_iam_application\.deployer\.id/gu,
      ),
    ).toHaveLength(2);
    for (const workflow of [
      source('.github/workflows/scaleway-staging.yml'),
      source('.github/workflows/scaleway-production.yml'),
    ]) {
      expect(workflow).toContain(
        'TF_VAR_application_bucket_console_user_ids: ${{ vars.APPLICATION_BUCKET_CONSOLE_USER_IDS }}',
      );
    }
    expect(bootstrap).toContain('prevent_destroy = true');
    expect(bootstrap).toContain('acl        = "private"');
    expect(bootstrap).toContain('sse_algorithm = "AES256"');
    expect(versions).toContain('use_lockfile                = true');
  });

  it('reconciles unproxied Scaleway application and email records through Cloudflare', () => {
    const dns = source('infrastructure/scaleway/dns.tf');
    const outputs = source('infrastructure/scaleway/outputs.tf');
    const staging = source('.github/workflows/scaleway-staging.yml');
    const production = source('.github/workflows/scaleway-production.yml');
    const transactionalEmail = source(
      'infrastructure/scaleway/transactional-email.tf',
    );
    const versions = source('infrastructure/scaleway/versions.tf');

    expect(versions).toContain('source  = "cloudflare/cloudflare"');
    expect(versions).toContain('version = "= 5.22.0"');
    expect(dns).toContain('resource "cloudflare_dns_record" "staging"');
    expect(dns).toContain('resource "cloudflare_dns_record" "production"');
    expect(dns).toContain('resource "scaleway_container_domain" "staging_web"');
    expect(dns).toContain(
      'resource "scaleway_container_domain" "production_web"',
    );
    expect(dns).toContain('depends_on = [cloudflare_dns_record.staging]');
    expect(dns).toContain('depends_on = [cloudflare_dns_record.production]');
    expect(dns).toContain(
      'from = module.staging.scaleway_container_domain.web',
    );
    expect(dns).toContain(
      'resource "cloudflare_dns_record" "transactional_email"',
    );
    expect(dns.match(/proxied\s+= false/gu)).toHaveLength(3);
    expect(dns).toContain('scaleway_tem_domain.notifications.spf_value');
    expect(dns).not.toContain('scaleway_tem_domain.notifications.spf_config');
    expect(dns).toContain('content  = trimsuffix(local.tem_mx_parts[1], ".")');
    expect(dns).toContain('priority = tonumber(local.tem_mx_parts[0])');
    expect(outputs).toContain('output "managed_dns_records"');
    expect(outputs).toContain('scaleway_tem_domain.notifications.spf_value');
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
    const main = source('infrastructure/scaleway/main.tf');

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
    expect(main).toContain('resource "scaleway_billing_budget" "organization"');
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
    expect(stagingSmoke).toContain('rpc_body="$(curl');
    expect(stagingSmoke).toContain('.[0]._tag == "Defect"');
    expect(stagingSmoke).not.toContain('rpc_status=');
    expect(productionSmoke).toContain('https://alpha.evorto.app/events');
  });

  it('builds once, records immutable evidence, and promotes the exact OCI digest', () => {
    const staging = source('.github/workflows/scaleway-staging.yml');
    const production = source('.github/workflows/scaleway-production.yml');
    const deployRole = source('ops/scaleway/deploy-role.sh');

    expect(staging).toContain('workflow_run:');
    expect(staging).toContain('cron: "*/30 * * * *"');
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
    expect(staging.indexOf('\'{"mode":"initialize-empty"}\'')).toBeLessThan(
      staging.indexOf('touch deployment/traffic-changed'),
    );
    expect(staging).toContain('OPS_CHANGED: ${{ steps.ops.outputs.changed }}');
    expect(staging).toContain('[ "${OPS_CHANGED}" = "true" ]');
    expect(staging).toContain('Roll back traffic roles to the previous digest');
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
    expect(production).toContain(
      'Roll back production traffic roles on failure',
    );
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
    expect(staging).toContain(
      'Ops already matches the desired release; skipping schema reconciliation.',
    );
    expect(staging).toContain("github.event_name != 'schedule'");
  });

  it('rescans the copied production digest before infrastructure and role deployment', () => {
    const production = source('.github/workflows/scaleway-production.yml');
    const scan = between(
      production,
      '- name: Scan promoted image vulnerabilities',
      '- name: Reconcile complete production infrastructure',
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
      '- name: Scan promoted image vulnerabilities',
      '- name: Reconcile complete production infrastructure',
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

const mainMinScale = (main: string) => {
  const staging = between(main, 'module "staging"', 'module "production"');
  const production = between(
    main,
    'module "production"',
    'resource "scaleway_iam_application" "deployer"',
  );
  const scale = (block: string): number => {
    const match = block.match(/web_min_scale\s+= (\d+)/u);
    expect(match).not.toBeNull();
    return Number(match?.[1]);
  };
  return { production: scale(production), staging: scale(staging) };
};
