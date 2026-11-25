import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect } from 'effect';

import { formatConfigError } from './config-error';
import { registrationRefundWorkerRuntimeModeConfig } from './registration-refund-worker-config';

const providerFromEntries = (entries: readonly (readonly [string, string])[]) =>
  ConfigProvider.fromEnv({ env: Object.fromEntries(entries) });

const readRuntimeMode = (entries: readonly (readonly [string, string])[]) =>
  registrationRefundWorkerRuntimeModeConfig
    .parse(providerFromEntries(entries))
    .pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Invalid registration refund worker configuration:\n${formatConfigError(error)}`,
          ),
      ),
    );

describe('registration-refund-worker-config', () => {
  it.effect('keeps the production/default runtime enabled', () =>
    Effect.gen(function* () {
      expect(yield* readRuntimeMode([])).toBe('enabled');
      expect(
        yield* readRuntimeMode([
          ['NODE_ENV', 'production'],
          ['LOCAL_DATABASE', 'false'],
        ]),
      ).toBe('enabled');
    }),
  );

  it.effect('disables only the validated local Playwright runtime', () =>
    Effect.gen(function* () {
      expect(
        yield* readRuntimeMode([
          ['E2E_NOW_ISO', '2026-07-12T12:00:00.000Z'],
          ['APP_ENVIRONMENT', 'local'],
          ['E2E_RUNTIME_MODE', 'playwright'],
          ['LOCAL_DATABASE', 'true'],
          ['NODE_ENV', 'development'],
        ]),
      ).toBe('disabledForPlaywright');
    }),
  );

  it.effect('ignores Playwright mode outside the local environment', () =>
    Effect.gen(function* () {
      for (const environment of ['staging', 'production']) {
        expect(
          yield* readRuntimeMode([
            ['APP_ENVIRONMENT', environment],
            ['E2E_NOW_ISO', '2026-07-12T12:00:00.000Z'],
            ['E2E_RUNTIME_MODE', 'playwright'],
            ['LOCAL_DATABASE', 'true'],
            ['NODE_ENV', 'development'],
          ]),
        ).toBe('enabled');
      }
      expect(
        yield* readRuntimeMode([
          ['E2E_NOW_ISO', '2026-07-12T12:00:00.000Z'],
          ['E2E_RUNTIME_MODE', 'playwright'],
          ['LOCAL_DATABASE', 'true'],
          ['NODE_ENV', 'development'],
        ]),
      ).toBe('enabled');
    }),
  );

  it.effect('fails closed when Playwright mode lacks any local marker', () =>
    Effect.gen(function* () {
      for (const entries of [
        [
          ['APP_ENVIRONMENT', 'local'],
          ['E2E_RUNTIME_MODE', 'playwright'],
          ['LOCAL_DATABASE', 'true'],
          ['NODE_ENV', 'development'],
        ],
        [
          ['APP_ENVIRONMENT', 'local'],
          ['E2E_NOW_ISO', '2026-07-12T12:00:00.000Z'],
          ['E2E_RUNTIME_MODE', 'playwright'],
          ['NODE_ENV', 'development'],
        ],
        [
          ['APP_ENVIRONMENT', 'local'],
          ['E2E_NOW_ISO', '2026-07-12T12:00:00.000Z'],
          ['E2E_RUNTIME_MODE', 'playwright'],
          ['LOCAL_DATABASE', 'true'],
        ],
      ] satisfies readonly (readonly (readonly [string, string])[])[]) {
        const error = yield* Effect.flip(readRuntimeMode(entries));
        expect(error.message).toContain(
          'E2E_RUNTIME_MODE=playwright may disable the registration refund worker only',
        );
      }
    }),
  );

  it.effect('rejects unknown E2E runtime modes', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        readRuntimeMode([
          ['APP_ENVIRONMENT', 'local'],
          ['E2E_RUNTIME_MODE', 'production'],
        ]),
      );

      expect(error.message).toMatch(/E2E_RUNTIME_MODE/);
      expect(error.message).toMatch(/playwright/);
    }),
  );
});
