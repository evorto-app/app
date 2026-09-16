import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect, Option, Redacted } from 'effect';

import { databaseConfig } from './database-config';

const parseConfig = (values: ReadonlyMap<string, string>) =>
  databaseConfig.parse(
    ConfigProvider.fromEnv({ env: Object.fromEntries(values) }),
  );

describe('database configuration', () => {
  it.effect('rejects a missing or blank TLS choice', () =>
    Effect.gen(function* () {
      for (const tlsEntry of [undefined, ''] as const) {
        const values = new Map([
          ['DATABASE_URL', 'postgresql://localhost/evorto'],
        ]);
        if (tlsEntry !== undefined) {
          values.set('DATABASE_TLS_REQUIRED', tlsEntry);
        }

        const error = yield* parseConfig(values).pipe(Effect.flip);
        expect(String(error)).toContain('DATABASE_TLS_REQUIRED');
      }
    }),
  );

  it.effect('accepts an explicit disabled TLS choice', () =>
    Effect.gen(function* () {
      const config = yield* parseConfig(
        new Map([
          ['DATABASE_TLS_REQUIRED', 'false'],
          ['DATABASE_URL', 'postgresql://localhost/evorto'],
        ]),
      );

      expect(config.DATABASE_TLS_REQUIRED).toBe(false);
    }),
  );

  it.effect('fails closed when verified TLS has no CA certificate', () =>
    Effect.gen(function* () {
      const error = yield* parseConfig(
        new Map([
          ['DATABASE_TLS_REQUIRED', 'true'],
          ['DATABASE_URL', 'postgresql://private/evorto'],
        ]),
      ).pipe(Effect.flip);

      expect(String(error)).toContain('DATABASE_TLS_CA_CERTIFICATE');
    }),
  );

  it.effect(
    'rejects whitespace CA values with a clear configuration error',
    () =>
      Effect.gen(function* () {
        for (const tlsRequired of ['true', 'false']) {
          for (const certificate of ['  ', '\n\t']) {
            const error = yield* parseConfig(
              new Map([
                ['DATABASE_TLS_CA_CERTIFICATE', certificate],
                ['DATABASE_TLS_REQUIRED', tlsRequired],
                ['DATABASE_URL', 'postgresql://private/evorto'],
              ]),
            ).pipe(Effect.flip);

            expect(String(error)).toContain(
              'DATABASE_TLS_CA_CERTIFICATE must not be blank',
            );
          }
        }
      }),
  );

  it.effect(
    'rejects empty CA values when a provider preserves empty strings',
    () =>
      Effect.gen(function* () {
        const error = yield* databaseConfig
          .parse(
            ConfigProvider.fromEnv({
              env: {
                DATABASE_TLS_CA_CERTIFICATE: '',
                DATABASE_TLS_REQUIRED: 'true',
                DATABASE_URL: 'postgresql://private/evorto',
              },
              preserveEmptyStrings: true,
            }),
          )
          .pipe(Effect.flip);
        expect(String(error)).toContain(
          'DATABASE_TLS_CA_CERTIFICATE must not be blank',
        );
      }),
  );

  it.effect('uses the connection host when no TLS server name is set', () =>
    Effect.gen(function* () {
      const config = yield* parseConfig(
        new Map([
          ['DATABASE_TLS_CA_CERTIFICATE', 'managed-ca'],
          ['DATABASE_TLS_REQUIRED', 'true'],
          ['DATABASE_URL', 'postgresql://10.0.0.8/evorto'],
        ]),
      );

      expect(Option.isNone(config.DATABASE_TLS_SERVER_NAME)).toBe(true);
    }),
  );

  it.effect('retains the configured CA and optional server name', () =>
    Effect.gen(function* () {
      const certificate =
        '\n-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----\n';
      const config = yield* parseConfig(
        new Map([
          ['DATABASE_TLS_CA_CERTIFICATE', certificate],
          ['DATABASE_TLS_REQUIRED', 'true'],
          ['DATABASE_TLS_SERVER_NAME', 'rw-database.rdb.fr-par.scw.cloud'],
          ['DATABASE_URL', 'postgresql://private/evorto'],
        ]),
      );

      expect(
        Redacted.value(Option.getOrThrow(config.DATABASE_TLS_CA_CERTIFICATE)),
      ).toBe(certificate);
      expect(config.DATABASE_TLS_REQUIRED).toBe(true);
      expect(Option.getOrThrow(config.DATABASE_TLS_SERVER_NAME)).toBe(
        'rw-database.rdb.fr-par.scw.cloud',
      );
    }),
  );
});
