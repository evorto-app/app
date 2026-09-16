import type { PeerCertificate } from 'node:tls';

import { describe, expect, it } from '@effect/vitest';
import { Redacted } from 'effect';
import { Client } from 'pg';

import {
  createNodePgPoolConfig,
  createPgClientConfig,
} from './pg-connection-config';

const identityCertificate = (subjectaltname: string): PeerCertificate => {
  const distinguishedName = { C: '', CN: '', L: '', O: '', OU: '', ST: '' };
  return {
    ca: false,
    fingerprint: '',
    fingerprint256: '',
    fingerprint512: '',
    issuer: distinguishedName,
    raw: Buffer.alloc(0),
    serialNumber: '01',
    subject: distinguishedName,
    subjectaltname,
    valid_from: 'Jan 1 00:00:00 2026 GMT',
    valid_to: 'Jan 1 00:00:00 2036 GMT',
  };
};

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

  for (const [name, create] of [
    ['node', createNodePgPoolConfig],
    ['effect', createPgClientConfig],
  ] as const) {
    it.each(['', '  ', '\n\t'])(
      `rejects a defined blank CA before constructing ${name} client options: %j`,
      (caCertificate) => {
        expect(() => create({ caCertificate, databaseUrl })).toThrow(
          'DATABASE_TLS_CA_CERTIFICATE must not be blank',
        );
      },
    );
  }

  for (const [name, create] of [
    ['node', createNodePgPoolConfig],
    ['effect', createPgClientConfig],
  ] as const) {
    it.each([
      '[db.example.test]',
      'db.example.test]',
      '[db.example.test',
      '[[2001:db8::2]]',
    ])(
      `rejects malformed or non-IP bracketed TLS identities in ${name}: %s`,
      (tlsServerName) => {
        expect(() =>
          create({ caCertificate: 'fixture-ca', databaseUrl, tlsServerName }),
        ).toThrow(
          'Database TLS identity brackets must contain one valid IPv6 address',
        );
      },
    );
  }

  it('preserves every nonblank CA byte in both shared constructors', () => {
    const caCertificate =
      '\n-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----\n';
    expect(createNodePgPoolConfig({ caCertificate, databaseUrl }).ssl).toEqual(
      expect.objectContaining({ ca: caCertificate }),
    );
    expect(createPgClientConfig({ caCertificate, databaseUrl }).ssl).toEqual(
      expect.objectContaining({ ca: caCertificate }),
    );
  });

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

  it.each([
    {
      identity: 'the IPv6 connection host',
      servername: undefined,
      subjectaltname: 'IP Address:0:0:0:0:0:0:0:1',
      tlsServerName: undefined,
    },
    {
      identity: 'an explicit DNS identity and SNI',
      servername: 'database.example',
      subjectaltname: 'DNS:database.example',
      tlsServerName: 'database.example',
    },
    {
      identity: 'an explicit IPv6 identity without SNI',
      servername: undefined,
      subjectaltname: 'IP Address:2001:db8:0:0:0:0:0:2',
      tlsServerName: '2001:db8::2',
    },
    {
      identity: 'a bracketed IPv6 override without SNI',
      servername: undefined,
      subjectaltname: 'IP Address:2001:db8:0:0:0:0:0:2',
      tlsServerName: '[2001:db8::2]',
    },
  ])(
    'verifies IP-SAN connections against $identity',
    ({ servername, subjectaltname, tlsServerName }) => {
      const caCertificate =
        '\n-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----\n';
      for (const buildConfig of [
        createNodePgPoolConfig,
        createPgClientConfig,
      ]) {
        const ssl = buildConfig({
          caCertificate,
          databaseUrl: 'postgresql://evorto:local@[::1]:5432/appdb',
          tlsServerName,
        }).ssl;
        if (
          typeof ssl !== 'object' ||
          ssl === null ||
          !ssl.checkServerIdentity
        ) {
          throw new Error('Expected PostgreSQL TLS identity verification');
        }

        expect(ssl.ca).toBe(caCertificate);
        expect(ssl.rejectUnauthorized).toBe(true);
        expect(ssl.servername).toBe(servername);
        expect(
          ssl.checkServerIdentity(
            'ignored-driver-host.example',
            identityCertificate(subjectaltname),
          ),
        ).toBeUndefined();
        expect(
          ssl.checkServerIdentity(
            '::1',
            identityCertificate('IP Address:2001:db8:0:0:0:0:0:3'),
          ),
        ).toBeInstanceOf(Error);
      }
    },
  );

  it.each([
    {
      databaseUrl: 'postgresql://fixture:fixture@data%62ase.example:5432/appdb',
      host: 'database.example',
      san: 'DNS:database.example',
    },
    {
      databaseUrl:
        'postgresql://fixture:fixture@localhost:5432/appdb?host=%5B2001%3Adb8%3A%3A2%5D',
      host: '2001:db8::2',
      san: 'IP Address:2001:db8:0:0:0:0:0:2',
    },
  ])(
    'connects and verifies the same normalized host $host in both clients',
    ({ databaseUrl, host, san }) => {
      const node = createNodePgPoolConfig({
        caCertificate: 'fixture-ca',
        databaseUrl,
      });
      const effect = createPgClientConfig({
        caCertificate: 'fixture-ca',
        databaseUrl,
      });
      if (!effect.url) throw new Error('Expected the Effect PostgreSQL URL');
      const clients = [
        { client: new Client(node), ssl: node.ssl },
        {
          client: new Client({
            connectionString: Redacted.value(effect.url),
            ssl: effect.ssl,
          }),
          ssl: effect.ssl,
        },
      ];
      for (const { client, ssl } of clients) {
        expect(client.host).toBe(host);
        expect(client.ssl).toBe(ssl);
        if (
          typeof ssl !== 'object' ||
          ssl === null ||
          !ssl.checkServerIdentity
        ) {
          throw new Error('Expected PostgreSQL TLS identity verification');
        }
        expect(ssl.servername).toBeUndefined();
        expect(
          ssl.checkServerIdentity('ignored', identityCertificate(san)),
        ).toBeUndefined();
        expect(
          ssl.checkServerIdentity(
            host,
            identityCertificate('DNS:wrong.example'),
          ),
        ).toBeInstanceOf(Error);
      }
    },
  );

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
