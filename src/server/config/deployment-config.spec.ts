import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect, Option } from 'effect';

import { formatConfigError } from './config-error';
import { deploymentConfig } from './deployment-config';

const readDeploymentConfig = (entries: Record<string, string>) =>
  deploymentConfig
    .parse(ConfigProvider.fromEnv({ env: entries }))
    .pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Invalid deployment configuration:\n${formatConfigError(error)}`,
          ),
      ),
    );

describe('deployment-config', () => {
  it.effect('leaves trace sampling unconfigured by default', () =>
    Effect.gen(function* () {
      const config = yield* readDeploymentConfig({});

      expect(config.TRACE_SAMPLING_RATIO).toEqual(Option.none());
    }),
  );

  it.effect('accepts bounded trace sampling overrides', () =>
    Effect.gen(function* () {
      for (const ratio of ['0', '0.1', '1']) {
        const config = yield* readDeploymentConfig({
          TRACE_SAMPLING_RATIO: ratio,
        });

        expect(config.TRACE_SAMPLING_RATIO).toEqual(Option.some(Number(ratio)));
      }
    }),
  );

  it.effect('rejects trace sampling overrides outside zero and one', () =>
    Effect.gen(function* () {
      for (const ratio of ['-0.01', '1.01']) {
        const error = yield* Effect.flip(
          readDeploymentConfig({ TRACE_SAMPLING_RATIO: ratio }),
        );

        expect(error.message).toContain(
          'Expected TRACE_SAMPLING_RATIO to be between 0 and 1',
        );
      }
    }),
  );

  it.effect(
    'rejects E2E authorization overrides in hosted startup config',
    () =>
      Effect.gen(function* () {
        const error = yield* readDeploymentConfig({
          APP_ENVIRONMENT: 'staging',
          E2E_GLOBAL_ADMIN_AUTH0_IDS: 'auth0|global-admin',
        }).pipe(Effect.flip);

        expect(error.message).toContain('E2E_GLOBAL_ADMIN_AUTH0_IDS');
        expect(error.message).toContain('hosted environments');
      }),
  );

  it.effect('allows E2E authorization overrides only in local config', () =>
    Effect.gen(function* () {
      const config = yield* readDeploymentConfig({
        APP_ENVIRONMENT: 'local',
        E2E_GLOBAL_ADMIN_AUTH0_IDS: 'auth0|global-admin',
      });

      expect(config).not.toHaveProperty('E2E_GLOBAL_ADMIN_AUTH0_IDS');
    }),
  );
});
