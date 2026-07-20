import { describe, expect, it } from '@effect/vitest';
import { Redacted } from 'effect';

import {
  createNodePgPoolConfig,
  createPgClientConfig,
} from './pg-connection-config';

describe('pg-connection-config', () => {
  const databaseUrl =
    'postgresql://evorto:local@localhost:55432/appdb?sslmode=disable';

  it('uses the URL SSL mode and bounded pool settings for both clients', () => {
    expect(
      createNodePgPoolConfig({
        databaseUrl,
        pool: {
          connectTimeoutMs: 4000,
          idleTimeoutMs: 20_000,
          max: 4,
          min: 1,
        },
      }),
    ).toMatchObject({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 20_000,
      max: 4,
      min: 1,
    });

    const effectConfig = createPgClientConfig({
      databaseUrl,
      pool: {
        connectTimeoutMs: 4000,
        idleTimeoutMs: 20_000,
        max: 4,
        min: 1,
      },
    });
    if (!effectConfig.url) {
      throw new Error('Expected the Effect PostgreSQL URL to be configured');
    }
    expect(Redacted.value(effectConfig.url)).toBe(databaseUrl);
    expect(effectConfig).toMatchObject({
      connectTimeout: 4000,
      idleTimeout: 20_000,
      maxConnections: 4,
      minConnections: 1,
    });
    expect(effectConfig.ssl).toBeUndefined();
  });

  it('verifies managed database TLS against the connection host by default', () => {
    const caCertificate =
      '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----';

    expect(createNodePgPoolConfig({ caCertificate, databaseUrl }).ssl).toEqual({
      ca: caCertificate,
      rejectUnauthorized: true,
    });
    expect(createPgClientConfig({ caCertificate, databaseUrl }).ssl).toEqual({
      ca: caCertificate,
      rejectUnauthorized: true,
    });
  });

  it('supports an explicit TLS server-name override', () => {
    const caCertificate =
      '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----';
    const tlsServerName = 'rw-database.rdb.fr-par.scw.cloud';

    expect(
      createNodePgPoolConfig({
        caCertificate,
        databaseUrl,
        tlsServerName,
      }).ssl,
    ).toEqual({
      ca: caCertificate,
      rejectUnauthorized: true,
      servername: tlsServerName,
    });
    expect(
      createPgClientConfig({
        caCertificate,
        databaseUrl,
        tlsServerName,
      }).ssl,
    ).toEqual({
      ca: caCertificate,
      rejectUnauthorized: true,
      servername: tlsServerName,
    });
  });

  it('rejects an inverted pool range', () => {
    expect(() =>
      createNodePgPoolConfig({
        databaseUrl,
        pool: {
          connectTimeoutMs: 4000,
          idleTimeoutMs: 20_000,
          max: 2,
          min: 3,
        },
      }),
    ).toThrowError('DATABASE_POOL_MIN cannot exceed DATABASE_POOL_MAX');
  });
});
