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
          ['NEON_LOCAL_PROXY', 'false'],
        ]),
      ).toBe('enabled');
    }),
  );

  it.effect('disables only the validated local Playwright runtime', () =>
    Effect.gen(function* () {
      expect(
        yield* readRuntimeMode([
          ['E2E_NOW_ISO', '2026-07-12T12:00:00.000Z'],
          ['E2E_RUNTIME_MODE', 'playwright'],
          ['NEON_LOCAL_PROXY', 'true'],
          ['NODE_ENV', 'development'],
        ]),
      ).toBe('disabledForPlaywright');
    }),
  );

  it.effect('fails closed when production requests Playwright mode', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        readRuntimeMode([
          ['E2E_NOW_ISO', '2026-07-12T12:00:00.000Z'],
          ['E2E_RUNTIME_MODE', 'playwright'],
          ['NEON_LOCAL_PROXY', 'true'],
          ['NODE_ENV', 'production'],
        ]),
      );

      expect(error.message).toContain(
        'E2E_RUNTIME_MODE=playwright may disable the registration refund worker only',
      );
    }),
  );

  it.effect('fails closed when Playwright mode lacks any local marker', () =>
    Effect.gen(function* () {
      for (const entries of [
        [
          ['E2E_RUNTIME_MODE', 'playwright'],
          ['NEON_LOCAL_PROXY', 'true'],
          ['NODE_ENV', 'development'],
        ],
        [
          ['E2E_NOW_ISO', '2026-07-12T12:00:00.000Z'],
          ['E2E_RUNTIME_MODE', 'playwright'],
          ['NODE_ENV', 'development'],
        ],
        [
          ['E2E_NOW_ISO', '2026-07-12T12:00:00.000Z'],
          ['E2E_RUNTIME_MODE', 'playwright'],
          ['NEON_LOCAL_PROXY', 'true'],
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
        readRuntimeMode([['E2E_RUNTIME_MODE', 'production']]),
      );

      expect(error.message).toMatch(/E2E_RUNTIME_MODE/);
      expect(error.message).toMatch(/playwright/);
    }),
  );
});
