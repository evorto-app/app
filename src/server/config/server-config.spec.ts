import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect, Option } from 'effect';

import { formatConfigError } from './config-error';
import { serverConfig } from './server-config';

const readServerConfig = (provider: ConfigProvider.ConfigProvider) =>
  serverConfig
    .parse(provider)
    .pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Invalid server configuration:\n${formatConfigError(error)}`,
          ),
      ),
    );

const providerFromEntries = (entries: readonly (readonly [string, string])[]) =>
  ConfigProvider.fromEnv({ env: Object.fromEntries(entries) });

const requiredServerEntries: readonly (readonly [string, string])[] = [
  ['PUBLIC_GOOGLE_MAPS_API_KEY', 'maps-key'],
];

describe('server-config', () => {
  it.effect('only reads PUBLIC_GOOGLE_MAPS_API_KEY', () =>
    Effect.gen(function* () {
      const legacyProvider = providerFromEntries([
        ['GOOGLE_MAPS_API_KEY', 'legacy-key'],
      ]);
      const canonicalProvider = providerFromEntries([
        ...requiredServerEntries,
        ['PUBLIC_GOOGLE_MAPS_API_KEY', 'canonical-key'],
      ]);

      const legacyError = yield* Effect.flip(readServerConfig(legacyProvider));
      expect(legacyError.message).toContain('PUBLIC_GOOGLE_MAPS_API_KEY');
      expect(
        (yield* readServerConfig(canonicalProvider)).PUBLIC_GOOGLE_MAPS_API_KEY,
      ).toBe('canonical-key');
    }),
  );

  it.effect(
    'captures optional runtime-only server fields through the config boundary',
    () =>
      Effect.gen(function* () {
        const provider = providerFromEntries([
          ...requiredServerEntries,
          ['E2E_NOW_ISO', '2026-03-01T12:00:00.000Z'],
          ['npm_package_version', '1.2.3'],
          ['SERVER_LOG_LEVEL', ' warning '],
          ['SSR_RPC_ORIGIN', ' http://127.0.0.1:4000 '],
        ]);

        const config = yield* readServerConfig(provider);

        expect(config.E2E_NOW_ISO).toEqual(
          Option.some('2026-03-01T12:00:00.000Z'),
        );
        expect(config.PACKAGE_VERSION).toEqual(Option.some('1.2.3'));
        expect(config.SERVER_LOG_LEVEL).toEqual(Option.some('Warn'));
        expect(config.SSR_RPC_ORIGIN).toEqual(
          Option.some('http://127.0.0.1:4000'),
        );
      }),
  );

  it.effect(
    'rejects unsupported server log levels at the config boundary',
    () =>
      Effect.gen(function* () {
        const provider = providerFromEntries([
          ...requiredServerEntries,
          ['SERVER_LOG_LEVEL', 'warnng'],
        ]);

        const error = yield* Effect.flip(readServerConfig(provider));
        expect(error.message).toMatch(/Expected SERVER_LOG_LEVEL to be one of/);
      }),
  );

  it.effect('requires the Maps key for web configuration', () =>
    Effect.gen(function* () {
      const missing = yield* Effect.flip(
        readServerConfig(providerFromEntries([])),
      );
      const blank = yield* Effect.flip(
        readServerConfig(
          providerFromEntries([['PUBLIC_GOOGLE_MAPS_API_KEY', ' '.repeat(3)]]),
        ),
      );
      expect(missing.message).toContain('PUBLIC_GOOGLE_MAPS_API_KEY');
      expect(blank.message).toContain(
        'Expected PUBLIC_GOOGLE_MAPS_API_KEY to be non-empty',
      );
    }),
  );
});
