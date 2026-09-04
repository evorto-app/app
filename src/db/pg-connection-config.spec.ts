import { describe, expect, it } from '@effect/vitest';
import { Redacted } from 'effect';
import { Client } from 'pg';

import {
  createNodePgPoolConfig,
  createPgClientConfig,
} from './pg-connection-config';

const expectVerifiedTlsOptions = (
  ssl: unknown,
  expectedServerName?: string,
) => {
  expect(ssl).toEqual(
    expect.objectContaining({
      ca: '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----',
      checkServerIdentity: expect.any(Function),
      rejectUnauthorized: true,
    }),
  );
  if (typeof ssl !== 'object' || ssl === null) {
    throw new Error('Expected PostgreSQL TLS options');
  }
  expect(Reflect.get(ssl, 'servername')).toBe(expectedServerName);
};

describe('pg-connection-config', () => {
  const databaseUrl =
    'postgresql://evorto:local@localhost:55432/appdb?application_name=evorto';

  it('uses the URL SSL mode and bounded pool settings for both clients', () => {
    const databaseUrl =
      'postgresql://evorto:local@localhost:55432/appdb?sslmode=disable';
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

    expectVerifiedTlsOptions(
      createNodePgPoolConfig({ caCertificate, databaseUrl }).ssl,
    );
    expectVerifiedTlsOptions(
      createPgClientConfig({ caCertificate, databaseUrl }).ssl,
    );
  });

  it('supports an explicit TLS server-name override', () => {
    const caCertificate =
      '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----';
    const tlsServerName = 'rw-database.rdb.fr-par.scw.cloud';

    expectVerifiedTlsOptions(
      createNodePgPoolConfig({
        caCertificate,
        databaseUrl,
        tlsServerName,
      }).ssl,
      tlsServerName,
    );
    expectVerifiedTlsOptions(
      createPgClientConfig({
        caCertificate,
        databaseUrl,
        tlsServerName,
      }).ssl,
      tlsServerName,
    );
  });

  it('verifies IP endpoints without sending an IP server name', () => {
    const caCertificate =
      '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----';
    const ipDatabaseUrl = 'postgresql://evorto:local@172.16.4.2:5432/appdb';

    expectVerifiedTlsOptions(
      createNodePgPoolConfig({
        caCertificate,
        databaseUrl: ipDatabaseUrl,
      }).ssl,
    );
    expectVerifiedTlsOptions(
      createPgClientConfig({
        caCertificate,
        databaseUrl: ipDatabaseUrl,
      }).ssl,
    );
  });

  it('rejects URL SSL settings that can override an explicit CA configuration', () => {
    const caCertificate =
      '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----';
    for (const parameter of [
      'ssl',
      'sslmode',
      'sslcert',
      'sslkey',
      'sslrootcert',
      'sslnegotiation',
      'uselibpqcompat',
    ]) {
      for (const buildConfig of [
        createNodePgPoolConfig,
        createPgClientConfig,
      ]) {
        expect(() =>
          buildConfig({
            caCertificate,
            databaseUrl: `${databaseUrl}&${parameter}=configured`,
          }),
        ).toThrowError(
          'DATABASE_URL must not include SSL options when DATABASE_TLS_CA_CERTIFICATE is configured',
        );
      }
    }
  });

  it('retains verified TLS after the PostgreSQL driver parses each client configuration', () => {
    const caCertificate =
      '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----';
    const tlsServerName = 'rw-database.rdb.fr-par.scw.cloud';
    const nodeConfig = createNodePgPoolConfig({
      caCertificate,
      databaseUrl,
      tlsServerName,
    });
    const effectConfig = createPgClientConfig({
      caCertificate,
      databaseUrl,
      tlsServerName,
    });
    if (!effectConfig.url)
      throw new Error('Expected the Effect PostgreSQL URL');

    // Construction parses the final configuration without opening a connection.
    const nodeClient = new Client(nodeConfig);
    const effectClient = new Client({
      connectionString: Redacted.value(effectConfig.url),
      ssl: effectConfig.ssl,
    });
    expectVerifiedTlsOptions(nodeClient.ssl, tlsServerName);
    expectVerifiedTlsOptions(effectClient.ssl, tlsServerName);
    expect(nodeConfig.connectionString).toBe(databaseUrl);
    expect(Redacted.value(effectConfig.url)).toBe(databaseUrl);
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
