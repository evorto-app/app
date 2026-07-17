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

  it.effect('retains the configured CA as a redacted value', () =>
    Effect.gen(function* () {
      const certificate =
        '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----';
      const config = yield* parseConfig(
        new Map([
          ['DATABASE_TLS_CA_CERTIFICATE', certificate],
          ['DATABASE_TLS_REQUIRED', 'true'],
          ['DATABASE_URL', 'postgresql://private/evorto'],
        ]),
      );

      expect(
        Redacted.value(Option.getOrThrow(config.DATABASE_TLS_CA_CERTIFICATE)),
      ).toBe(certificate);
    }),
  );
});
