import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect, Option, Redacted } from 'effect';

import { databaseConfig } from './database-config';

const parseConfig = (values: ReadonlyMap<string, string>) =>
  databaseConfig.parse(
    ConfigProvider.fromEnv({ env: Object.fromEntries(values) }),
  );

describe('database configuration', () => {
  it.effect('keeps local TLS optional', () =>
    Effect.gen(function* () {
      const config = yield* parseConfig(
        new Map([['DATABASE_URL', 'postgresql://localhost/evorto']]),
      );

      expect(config.DATABASE_TLS_REQUIRED).toBe(false);
    }),
  );

  it.each([
    [
      'CA certificate',
      'DATABASE_TLS_CA_CERTIFICATE',
      new Map([
        ['DATABASE_TLS_REQUIRED', 'true'],
        ['DATABASE_TLS_SERVER_NAME', 'rw-database.rdb.fr-par.scw.cloud'],
        ['DATABASE_URL', 'postgresql://private/evorto'],
      ]),
    ],
    [
      'certificate server name',
      'DATABASE_TLS_SERVER_NAME',
      new Map([
        ['DATABASE_TLS_CA_CERTIFICATE', 'managed-ca'],
        ['DATABASE_TLS_REQUIRED', 'true'],
        ['DATABASE_URL', 'postgresql://private/evorto'],
      ]),
    ],
  ])('fails closed when verified TLS has no %s', async (_, missing, values) => {
    const error = await Effect.runPromise(
      parseConfig(values).pipe(Effect.flip),
    );

    expect(String(error)).toContain(missing);
  });

  it.effect('retains the configured CA as a redacted value', () =>
    Effect.gen(function* () {
      const certificate =
        '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----';
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
      expect(Option.getOrThrow(config.DATABASE_TLS_SERVER_NAME)).toBe(
        'rw-database.rdb.fr-par.scw.cloud',
      );
    }),
  );
});
