import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Redacted } from 'effect';

import type { DeploymentConfig } from '../config/deployment-config';

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
