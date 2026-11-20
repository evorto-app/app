import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect } from 'effect';

import { findIgnoredTestOnlySettings } from './test-only-settings-guard';

const find = (entries: readonly (readonly [string, string])[]) =>
  findIgnoredTestOnlySettings(
    ConfigProvider.fromEnv({ env: Object.fromEntries(entries) }),
  );

const testEntries = [
  ['E2E_NOW_ISO', '2026-03-01T12:00:00.000Z'],
  ['E2E_RUNTIME_MODE', 'playwright'],
  ['TENANT_DOMAIN', 'localhost'],
] as const;

describe('test-only-settings-guard', () => {
  it.effect('reports every test-only setting outside local', () =>
    Effect.gen(function* () {
      for (const environment of ['staging', 'production']) {
        expect(
          yield* find([['APP_ENVIRONMENT', environment], ...testEntries]),
        ).toEqual(['E2E_NOW_ISO', 'E2E_RUNTIME_MODE', 'TENANT_DOMAIN']);
      }
      expect(yield* find([...testEntries])).toHaveLength(3);
    }),
  );

  it.effect('reports nothing locally or when no test setting is set', () =>
    Effect.gen(function* () {
      expect(
        yield* find([['APP_ENVIRONMENT', 'local'], ...testEntries]),
      ).toEqual([]);
      expect(
        yield* find([
          ['APP_ENVIRONMENT', 'production'],
          ['E2E_NOW_ISO', '  '],
        ]),
      ).toEqual([]);
    }),
  );
});
