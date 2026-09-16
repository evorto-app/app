import { describe, expect, it } from '@effect/vitest';
import { Config, ConfigProvider, Effect, Option, Redacted } from 'effect';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { DeploymentConfig } from '../config/deployment-config';

import { deploymentConfig as deploymentConfigSchema } from '../config/deployment-config';
import { makeRuntimeConfigProvider } from '../config/provider';
import { type OpsCommandRunner, seedStaging } from '../ops/schema-operations';
import { validateRuntimeRoleConfiguration } from './runtime-role';

const deploymentConfig = (
  overrides: Partial<DeploymentConfig> = {},
): DeploymentConfig => ({
  APP_BOOTSTRAP: false,
  APP_ENVIRONMENT: 'local',
  APP_IMAGE_DIGEST: Option.none(),
  APP_REVISION: Option.none(),
  APP_ROLE: 'web',
  APP_SCHEMA_HASH: Option.none(),
  COCKPIT_TRACES_ENDPOINT: Option.none(),
  COCKPIT_TRACES_TOKEN: Option.none(),
  READINESS_TENANT_HOST: Option.none(),
  TRACE_SAMPLING_RATIO: Option.none(),
  TRUST_PLATFORM_PROXY: false,
  WORKER_TRIGGER_MODE: 'poll',
  ...overrides,
});

describe('runtime role configuration', () => {
  it.effect('allows the web role', () =>
    Effect.gen(function* () {
      const result =
        yield* validateRuntimeRoleConfiguration(deploymentConfig());

      expect(result.role).toBe('web');
    }),
  );

  it.effect(
    'rejects missing or malformed ops runtime roles before a reset operation can run',
    () =>
      Effect.gen(function* () {
        for (const role of [
          undefined,
          '',
          ' ',
          'runtime-role',
          'Runtime_role',
          '1runtime',
          'role;drop',
          'r'.repeat(64),
        ]) {
          const commands: (readonly string[])[] = [];
          const runner: OpsCommandRunner = {
            run: (command) =>
              Effect.sync(() => {
                commands.push(command);
                return {
                  exitCode: 0,
                  stderr: '',
                  stdout: JSON.stringify({
                    dialect: 'postgresql',
                    status: 'ok',
                  }),
                };
              }),
          };
          const config = yield* deploymentConfigSchema.parse(
            ConfigProvider.fromEnv({
              env: {
                APP_ENVIRONMENT: 'local',
                APP_ROLE: 'ops',
                APP_SCHEMA_HASH: 'a'.repeat(64),
                WORKER_TRIGGER_MODE: 'poll',
                ...(role !== undefined && { DATABASE_RUNTIME_ROLE: role }),
              },
            }),
          );
          const error = yield* validateRuntimeRoleConfiguration(config, {
            DATABASE_RUNTIME_ROLE: role,
          }).pipe(
            Effect.flatMap(() => seedStaging('reset-and-seed-staging', runner)),
            Effect.flip,
          );
          expect(error.message).toBe(
            'DATABASE_RUNTIME_ROLE must be an explicit process environment variable containing a safe PostgreSQL role name for the ops role',
          );
          expect(commands).toEqual([]);
        }
      }),
  );

  it.effect(
    'allows a configured ops runtime role through the existing reset command sequence',
    () =>
      Effect.gen(function* () {
        const commands: (readonly string[])[] = [];
        const runner: OpsCommandRunner = {
          run: (command) =>
            Effect.sync(() => {
              commands.push(command);
              return {
                exitCode: 0,
                stderr: '',
                stdout: JSON.stringify({ dialect: 'postgresql', status: 'ok' }),
              };
            }),
        };
        const config = yield* deploymentConfigSchema.parse(
          ConfigProvider.fromEnv({
            env: {
              APP_ENVIRONMENT: 'local',
              APP_ROLE: 'ops',
              APP_SCHEMA_HASH: 'a'.repeat(64),
              DATABASE_RUNTIME_ROLE: 'application_runtime',
              WORKER_TRIGGER_MODE: 'poll',
            },
          }),
        );
        const result = yield* validateRuntimeRoleConfiguration(config, {
          DATABASE_RUNTIME_ROLE: 'application_runtime',
        }).pipe(
          Effect.flatMap(() => seedStaging('reset-and-seed-staging', runner)),
        );
        expect(result).toEqual({ reset: true, seeded: true });
        expect(commands.map((command) => command[1])).toEqual([
          'dist/evorto/ops/seed-staging.mjs',
          'dist/evorto/ops/reset-staging-database.mjs',
          'dist/evorto/ops/database-prerequisites.mjs',
          'ops/drizzle-kit.cjs',
          'dist/evorto/ops/seed-staging.mjs',
        ]);
      }),
  );

  it.effect(
    'rejects a file-only runtime role before reset and accepts the explicit child environment instead',
    () =>
      Effect.gen(function* () {
        const originalRole = process.env['DATABASE_RUNTIME_ROLE'];
        const temporaryDirectory = fs.mkdtempSync(
          path.join(os.tmpdir(), 'evorto-ops-runtime-role-'),
        );
        const commands: (readonly string[])[] = [];
        const runner: OpsCommandRunner = {
          run: (command) =>
            Effect.sync(() => {
              commands.push(command);
              return {
                exitCode: 0,
                stderr: '',
                stdout: JSON.stringify({ dialect: 'postgresql', status: 'ok' }),
              };
            }),
        };
        try {
          fs.writeFileSync(
            path.join(temporaryDirectory, '.env'),
            'DATABASE_RUNTIME_ROLE=file_runtime\n',
          );
          delete process.env['DATABASE_RUNTIME_ROLE'];
          const provider = yield* makeRuntimeConfigProvider({
            cwd: temporaryDirectory,
          });
          expect(
            yield* Config.string('DATABASE_RUNTIME_ROLE').parse(provider),
          ).toBe('file_runtime');
          const config = yield* deploymentConfigSchema.parse(
            ConfigProvider.orElse(
              ConfigProvider.fromEnv({
                env: {
                  APP_ENVIRONMENT: 'local',
                  APP_ROLE: 'ops',
                  APP_SCHEMA_HASH: 'a'.repeat(64),
                  WORKER_TRIGGER_MODE: 'poll',
                },
              }),
              provider,
            ),
          );
          const error = yield* validateRuntimeRoleConfiguration(config).pipe(
            Effect.flatMap(() => seedStaging('reset-and-seed-staging', runner)),
            Effect.flip,
          );
          expect(error.message).toContain(
            'explicit process environment variable',
          );
          expect(commands).toEqual([]);

          process.env['DATABASE_RUNTIME_ROLE'] = 'invalid-child-role';
          yield* validateRuntimeRoleConfiguration(config).pipe(Effect.flip);
          expect(commands).toEqual([]);

          process.env['DATABASE_RUNTIME_ROLE'] = 'application_runtime';
          const result = yield* validateRuntimeRoleConfiguration(config).pipe(
            Effect.flatMap(() => seedStaging('reset-and-seed-staging', runner)),
          );
          expect(result).toEqual({ reset: true, seeded: true });
          expect(commands).toHaveLength(5);
        } finally {
          if (originalRole === undefined) {
            delete process.env['DATABASE_RUNTIME_ROLE'];
          } else {
            process.env['DATABASE_RUNTIME_ROLE'] = originalRole;
          }
          fs.rmSync(temporaryDirectory, { force: true, recursive: true });
        }
      }),
  );

  it.effect(
    'does not require an ops database role for ordinary web or initial bootstrap runtime',
    () =>
      Effect.gen(function* () {
        const web = yield* deploymentConfigSchema.parse(
          ConfigProvider.fromEnv({
            env: {
              APP_ENVIRONMENT: 'local',
              APP_ROLE: 'web',
              DATABASE_RUNTIME_ROLE: 'unused-invalid-role',
              WORKER_TRIGGER_MODE: 'poll',
            },
          }),
        );
        const webRuntime = yield* validateRuntimeRoleConfiguration(web);
        expect(webRuntime.role).toBe('web');
        const bootstrap = yield* deploymentConfigSchema.parse(
          ConfigProvider.fromEnv({
            env: {
              APP_BOOTSTRAP: 'true',
              APP_ENVIRONMENT: 'staging',
              APP_ROLE: 'ops',
              WORKER_TRIGGER_MODE: 'http',
            },
          }),
        );
        const bootstrapRuntime =
          yield* validateRuntimeRoleConfiguration(bootstrap);
        expect(bootstrapRuntime).toMatchObject({
          bootstrap: true,
          role: 'ops',
        });
      }),
  );

  it.effect('allows local polling workers', () =>
    Effect.gen(function* () {
      const result = yield* validateRuntimeRoleConfiguration(
        deploymentConfig({ APP_ROLE: 'worker' }),
      );

      expect(result.triggerMode).toBe('poll');
    }),
  );

  it.effect('requires private HTTP workers outside local development', () =>
    Effect.gen(function* () {
      const error = yield* validateRuntimeRoleConfiguration(
        deploymentConfig({
          APP_ENVIRONMENT: 'staging',
          APP_ROLE: 'worker',
        }),
      ).pipe(Effect.flip);

      expect(error.message).toContain('WORKER_TRIGGER_MODE=http');
    }),
  );

  it.effect('allows only isolated non-local bootstrap containers', () =>
    Effect.gen(function* () {
      const result = yield* validateRuntimeRoleConfiguration(
        deploymentConfig({
          APP_BOOTSTRAP: true,
          APP_ENVIRONMENT: 'staging',
        }),
      );
      const localError = yield* validateRuntimeRoleConfiguration(
        deploymentConfig({ APP_BOOTSTRAP: true }),
      ).pipe(Effect.flip);

      expect(result).toMatchObject({
        bootstrap: true,
        environment: 'staging',
        role: 'web',
      });
      expect(localError.message).toContain('initial platform');
    }),
  );

  it.effect('requires a valid Cockpit endpoint and token on Scaleway', () =>
    Effect.gen(function* () {
      const missingError = yield* validateRuntimeRoleConfiguration(
        deploymentConfig({
          APP_ENVIRONMENT: 'staging',
          APP_ROLE: 'worker',
          WORKER_TRIGGER_MODE: 'http',
        }),
      ).pipe(Effect.flip);
      const endpointError = yield* validateRuntimeRoleConfiguration(
        deploymentConfig({
          COCKPIT_TRACES_ENDPOINT: Option.some(
            new URL('https://example.com/otlp/v1/traces'),
          ),
          COCKPIT_TRACES_TOKEN: Option.some(Redacted.make('t'.repeat(32))),
        }),
      ).pipe(Effect.flip);

      expect(missingError.message).toContain('COCKPIT_TRACES_ENDPOINT');
      expect(endpointError.message).toContain('fr-par HTTPS');
    }),
  );

  it.effect('accepts the locked staging web configuration', () =>
    Effect.gen(function* () {
      const result = yield* validateRuntimeRoleConfiguration(
        deploymentConfig({
          APP_ENVIRONMENT: 'staging',
          APP_IMAGE_DIGEST: Option.some(`sha256:${'d'.repeat(64)}`),
          APP_REVISION: Option.some('a'.repeat(40)),
          COCKPIT_TRACES_ENDPOINT: Option.some(
            new URL(
              'https://00000000-0000-0000-0000-000000000000.traces.cockpit.fr-par.scw.cloud/otlp/v1/traces',
            ),
          ),
          COCKPIT_TRACES_TOKEN: Option.some(Redacted.make('t'.repeat(32))),
          READINESS_TENANT_HOST: Option.some('staging.evorto.app'),
          TRUST_PLATFORM_PROXY: true,
        }),
      );

      expect(result.environment).toBe('staging');
      expect(result.bootstrap).toBe(false);
      expect(result.role).toBe('web');
    }),
  );

  it.effect('rejects incomplete platform release identity and readiness', () =>
    Effect.gen(function* () {
      const basePlatformConfig = {
        APP_ENVIRONMENT: 'staging' as const,
        COCKPIT_TRACES_ENDPOINT: Option.some(
          new URL(
            'https://00000000-0000-0000-0000-000000000000.traces.cockpit.fr-par.scw.cloud/otlp/v1/traces',
          ),
        ),
        COCKPIT_TRACES_TOKEN: Option.some(Redacted.make('t'.repeat(32))),
        TRUST_PLATFORM_PROXY: true,
      };
      const readinessError = yield* validateRuntimeRoleConfiguration(
        deploymentConfig(basePlatformConfig),
      ).pipe(Effect.flip);
      const revisionError = yield* validateRuntimeRoleConfiguration(
        deploymentConfig({
          ...basePlatformConfig,
          READINESS_TENANT_HOST: Option.some('staging.evorto.app'),
        }),
      ).pipe(Effect.flip);
      const digestError = yield* validateRuntimeRoleConfiguration(
        deploymentConfig({
          ...basePlatformConfig,
          APP_REVISION: Option.some('a'.repeat(40)),
          READINESS_TENANT_HOST: Option.some('staging.evorto.app'),
        }),
      ).pipe(Effect.flip);

      expect(readinessError.message).toContain('READINESS_TENANT_HOST');
      expect(revisionError.message).toContain('APP_REVISION');
      expect(digestError.message).toContain('APP_IMAGE_DIGEST');
    }),
  );
});
