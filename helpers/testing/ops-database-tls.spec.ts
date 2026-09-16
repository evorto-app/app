import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const configUrl = pathToFileURL(
  path.join(process.cwd(), 'ops/drizzle.config.mjs'),
).href;

describe.each(['true', 'false'])(
  'managed Drizzle TLS identity with DATABASE_TLS_REQUIRED=%s',
  (tlsRequired) => {
    it.each([
      {
        identity: 'the IPv6 connection host',
        servername: '',
        subjectaltname: 'IP Address:0:0:0:0:0:0:0:1',
        tlsServerName: '',
      },
      {
        identity: 'an explicit DNS identity and SNI',
        servername: 'database.example',
        subjectaltname: 'DNS:database.example',
        tlsServerName: 'database.example',
      },
      {
        identity: 'an explicit IPv6 identity without SNI',
        servername: '',
        subjectaltname: 'IP Address:2001:db8:0:0:0:0:0:2',
        tlsServerName: '2001:db8::2',
      },
      {
        identity: 'a whitespace-padded DNS override',
        servername: 'database.example',
        subjectaltname: 'DNS:database.example',
        tlsServerName: ' \tdatabase.example\n ',
      },
      {
        identity: 'a whitespace-padded IPv4 override without SNI',
        servername: '',
        subjectaltname: 'IP Address:127.0.0.2',
        tlsServerName: ' \t127.0.0.2\n ',
      },
      {
        identity: 'a whitespace-padded IPv6 override without SNI',
        servername: '',
        subjectaltname: 'IP Address:2001:db8:0:0:0:0:0:2',
        tlsServerName: ' \t2001:db8::2\n ',
      },
      {
        identity: 'a whitespace-padded bracketed IPv6 override without SNI',
        servername: '',
        subjectaltname: 'IP Address:2001:db8:0:0:0:0:0:2',
        tlsServerName: ' \t[2001:db8::2]\n ',
      },
      {
        identity: 'the connection host for a whitespace-only override',
        servername: '',
        subjectaltname: 'IP Address:0:0:0:0:0:0:0:1',
        tlsServerName: ' \n\t',
      },
      {
        identity: 'a bracketed IPv6 override without SNI',
        servername: '',
        subjectaltname: 'IP Address:2001:db8:0:0:0:0:0:2',
        tlsServerName: '[2001:db8::2]',
      },
    ])(
      'uses an unbracketed connection host and verifies $identity',
      ({ servername, subjectaltname, tlsServerName }) => {
        const result = spawnSync(
          'node',
          [
            '--input-type=module',
            '--eval',
            `import assert from 'node:assert/strict';
import config from ${JSON.stringify(configUrl)};

const credentials = config.dbCredentials;
const ssl = credentials.ssl;
assert.equal(credentials.host, '::1');
assert.equal(ssl.ca, process.env.DATABASE_TLS_CA_CERTIFICATE);
assert.equal(ssl.rejectUnauthorized, true);
assert.equal(ssl.servername, process.env.EXPECTED_SNI || undefined);
assert.equal(ssl.checkServerIdentity('ignored-driver-host.example', {
  subjectaltname: process.env.EXPECTED_CERTIFICATE_SAN,
}), undefined);
assert.ok(ssl.checkServerIdentity('::1', {
  subjectaltname: 'IP Address:2001:db8:0:0:0:0:0:3',
}) instanceof Error);
`,
          ],
          {
            encoding: 'utf8',
            env: {
              DATABASE_TLS_CA_CERTIFICATE:
                '\n-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----\n',
              DATABASE_TLS_REQUIRED: tlsRequired,
              DATABASE_TLS_SERVER_NAME: tlsServerName,
              DATABASE_URL: 'postgresql://fixture:fixture@[::1]:5432/appdb',
              EXPECTED_CERTIFICATE_SAN: subjectaltname,
              EXPECTED_SNI: servername,
              PATH: process.env['PATH'],
            },
            timeout: 5000,
          },
        );

        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status, result.stderr).toBe(0);
      },
    );
  },
);

describe('managed Drizzle effective connection host', () => {
  it.each([
    {
      query: '?host=database.example',
      host: 'database.example',
      san: 'DNS:database.example',
      override: '',
    },
    {
      query: '?host=2001%3Adb8%3A%3A2',
      host: '2001:db8::2',
      san: 'IP Address:2001:db8:0:0:0:0:0:2',
      override: '',
    },
    {
      query: '?host=ignored.example&host=database.example',
      host: 'database.example',
      san: 'DNS:database.example',
      override: '',
    },
    {
      query: '?host=ignored.example&host=',
      host: '::1',
      san: 'IP Address:0:0:0:0:0:0:0:1',
      override: '',
    },
    {
      query: '?host=2001%3Adb8%3A%3A2',
      host: '2001:db8::2',
      san: 'DNS:certificate.example',
      override: 'certificate.example',
    },
  ])(
    'uses pg host precedence and verifies its TLS identity for $query',
    ({ query, host, san, override }) => {
      const result = spawnSync(
        'node',
        [
          '--input-type=module',
          '--eval',
          `
import assert from 'node:assert/strict';
import { Client } from 'pg';
import config from ${JSON.stringify(configUrl)};
const credentials = config.dbCredentials;
const client = new Client(credentials);
assert.equal(credentials.host, process.env.EXPECTED_HOST);
assert.equal(client.host, process.env.EXPECTED_HOST);
assert.equal(credentials.ssl.ca, process.env.DATABASE_TLS_CA_CERTIFICATE);
assert.equal(credentials.ssl.rejectUnauthorized, true);
assert.equal(credentials.ssl.servername, process.env.DATABASE_TLS_SERVER_NAME || undefined);
assert.equal(credentials.ssl.checkServerIdentity('untrusted-driver-name', { subjectaltname: process.env.EXPECTED_SAN }), undefined);
assert.ok(credentials.ssl.checkServerIdentity(process.env.EXPECTED_HOST, { subjectaltname: 'DNS:wrong.example' }) instanceof Error);
`,
        ],
        {
          encoding: 'utf8',
          env: {
            DATABASE_TLS_CA_CERTIFICATE:
              '\n-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----\n',
            DATABASE_TLS_REQUIRED: 'true',
            DATABASE_TLS_SERVER_NAME: override,
            DATABASE_URL: `postgresql://fixture:fixture@[::1]:5432/appdb${query}`,
            EXPECTED_HOST: host,
            EXPECTED_SAN: san,
            PATH: process.env['PATH'],
          },
          timeout: 5000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.stderr).toBe(0);
    },
  );
});

describe('managed Drizzle effective credentials', () => {
  it.each([
    '?port=5433',
    '?port=5434&port=5433',
    '?port=5434&port=',
    '?user=query-user',
    '?user=query%3Auser%2Bvalue',
    '?user=ignored&user=query-user',
    '?user=ignored&user=',
    '?password=query%3Apassword%2Bvalue',
    '?password=%252F',
    '?password=ignored&password=query-password',
    '?password=ignored&password=',
    '?host=database.example&port=5433&user=query-user&password=query-password',
  ])('matches the pinned PostgreSQL client for %s', (query) => {
    const result = spawnSync(
      'node',
      [
        '--input-type=module',
        '--eval',
        `
import assert from 'node:assert/strict';
import { Client } from 'pg';
import config from ${JSON.stringify(configUrl)};
const expected = new Client({ connectionString: process.env.DATABASE_URL });
const actual = new Client(config.dbCredentials);
for (const field of ['host', 'port', 'user', 'password', 'database']) {
  assert.equal(actual[field], expected[field], field);
}
assert.equal(actual.ssl.rejectUnauthorized, true);
assert.equal(actual.ssl.ca, process.env.DATABASE_TLS_CA_CERTIFICATE);
`,
      ],
      {
        encoding: 'utf8',
        env: {
          DATABASE_TLS_CA_CERTIFICATE: 'fixture-ca',
          DATABASE_TLS_REQUIRED: 'true',
          DATABASE_URL: `postgresql://authority-user:authority-password@localhost:5432/appdb${query}`,
          PATH: process.env['PATH'],
        },
        timeout: 5000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(['/app%2Fdb', '/app%3Fdb', '//appdb', '/app%20db'])(
    'matches the pinned database pathname decoding for %s',
    (pathname) => {
      const result = spawnSync(
        'node',
        [
          '--input-type=module',
          '--eval',
          `
import assert from 'node:assert/strict';
import { Client } from 'pg';
import config from ${JSON.stringify(configUrl)};
const expected = new Client({ connectionString: process.env.DATABASE_URL });
assert.equal(config.dbCredentials.database, expected.database);
`,
        ],
        {
          encoding: 'utf8',
          env: {
            DATABASE_TLS_CA_CERTIFICATE: 'fixture-ca',
            DATABASE_TLS_REQUIRED: 'true',
            DATABASE_URL: `postgresql://fixture:fixture@localhost:5432${pathname}`,
            PATH: process.env['PATH'],
          },
          timeout: 5000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.stderr).toBe(0);
    },
  );

  it.each([
    'database',
    'options',
    'application_name',
    'statement_timeout',
    'lock_timeout',
    'replication',
    'unknown',
    'options=&options',
  ])(
    'rejects unsupported managed query option %s instead of dropping it',
    (option) => {
      const result = spawnSync(
        'node',
        [
          '--input-type=module',
          '--eval',
          `
import assert from 'node:assert/strict';
await assert.rejects(import(${JSON.stringify(configUrl)}), {
  message: 'DATABASE_URL only supports host, port, user, and password query options for managed schema operations',
});
`,
        ],
        {
          encoding: 'utf8',
          env: {
            DATABASE_TLS_CA_CERTIFICATE: 'fixture-ca',
            DATABASE_TLS_REQUIRED: 'true',
            DATABASE_URL: `postgresql://fixture:fixture@localhost:5432/appdb?${option}=fixture`,
            PATH: process.env['PATH'],
          },
          timeout: 5000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.stderr).toBe(0);
    },
  );

  it.each(['sslmode', 'sslrootcert', 'uselibpqcompat'])(
    'rejects URL TLS option %s when a CA is supplied',
    (option) => {
      const result = spawnSync(
        'node',
        [
          '--input-type=module',
          '--eval',
          `
import assert from 'node:assert/strict';
await assert.rejects(import(${JSON.stringify(configUrl)}), {
  message: 'DATABASE_URL must not include SSL options when DATABASE_TLS_CA_CERTIFICATE is configured',
});
`,
        ],
        {
          encoding: 'utf8',
          env: {
            DATABASE_TLS_CA_CERTIFICATE: 'fixture-ca',
            DATABASE_TLS_REQUIRED: 'false',
            DATABASE_URL: `postgresql://fixture:fixture@localhost:5432/appdb?${option}=fixture`,
            PATH: process.env['PATH'],
          },
          timeout: 5000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.stderr).toBe(0);
    },
  );

  it.each(['0', '65536', 'abc', '5432suffix', '-1', '1.5'])(
    'rejects invalid effective managed port %s instead of coercing it',
    (port) => {
      const result = spawnSync(
        'node',
        [
          '--input-type=module',
          '--eval',
          `
import assert from 'node:assert/strict';
await assert.rejects(import(${JSON.stringify(configUrl)}), {
  message: 'DATABASE_URL port must be an integer between 1 and 65535 for managed schema operations',
});
`,
        ],
        {
          encoding: 'utf8',
          env: {
            DATABASE_TLS_CA_CERTIFICATE: 'fixture-ca',
            DATABASE_TLS_REQUIRED: 'true',
            DATABASE_URL: `postgresql://fixture:fixture@localhost:5432/appdb?port=${port}`,
            PATH: process.env['PATH'],
          },
          timeout: 5000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.stderr).toBe(0);
    },
  );
});

describe('managed Drizzle explicit configuration boundary', () => {
  it('preserves driver URL settings when no CA is supplied', () => {
    const result = spawnSync(
      'node',
      [
        '--input-type=module',
        '--eval',
        `
import assert from 'node:assert/strict';
import config from ${JSON.stringify(configUrl)};
assert.deepEqual(config.dbCredentials, { url: process.env.DATABASE_URL });
`,
      ],
      {
        encoding: 'utf8',
        env: {
          DATABASE_TLS_REQUIRED: 'false',
          DATABASE_URL:
            'postgresql://fixture:fixture@localhost:5432/appdb?sslmode=disable&application_name=fixture&options=-c%20search_path%3Dfixture',
          PATH: process.env['PATH'],
        },
        timeout: 5000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
  });

  it('uses URL credentials and the explicit default port without ambient PG fallbacks', () => {
    const result = spawnSync(
      'node',
      [
        '--input-type=module',
        '--eval',
        `
import assert from 'node:assert/strict';
import { Client } from 'pg';
import config from ${JSON.stringify(configUrl)};
const client = new Client(config.dbCredentials);
assert.equal(client.host, 'database.example');
assert.equal(client.port, 5432);
assert.equal(client.user, 'fixture');
assert.equal(client.password, 'fixture');
assert.equal(client.database, 'appdb');
assert.equal(client.ssl.checkServerIdentity('ignored', { subjectaltname: 'DNS:database.example' }), undefined);
`,
      ],
      {
        encoding: 'utf8',
        env: {
          DATABASE_TLS_CA_CERTIFICATE: 'fixture-ca',
          DATABASE_TLS_REQUIRED: 'true',
          DATABASE_URL: 'postgresql://fixture:fixture@data%62ase.example/appdb',
          PGHOST: 'unexpected.example',
          PGPORT: '1',
          PGUSER: 'unexpected-user',
          PGPASSWORD: 'unexpected-password',
          PGDATABASE: 'unexpected-database',
          PATH: process.env['PATH'],
        },
        timeout: 5000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    'postgresql://:fixture@localhost:5432/appdb',
    'postgresql://fixture@localhost:5432/appdb',
    'postgresql://fixture:fixture@localhost:5432/',
  ])(
    'rejects missing managed URL credentials without ambient PG fallback for %s',
    (databaseUrl) => {
      const result = spawnSync(
        'node',
        [
          '--input-type=module',
          '--eval',
          `
import assert from 'node:assert/strict';
await assert.rejects(import(${JSON.stringify(configUrl)}), {
  message: 'DATABASE_URL must include host, database, user, and password for managed schema operations',
});
`,
        ],
        {
          encoding: 'utf8',
          env: {
            DATABASE_TLS_CA_CERTIFICATE: 'fixture-ca',
            DATABASE_TLS_REQUIRED: 'true',
            DATABASE_URL: databaseUrl,
            PGUSER: 'unexpected-user',
            PGPASSWORD: 'unexpected-password',
            PGDATABASE: 'unexpected-database',
            PATH: process.env['PATH'],
          },
          timeout: 5000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.stderr).toBe(0);
    },
  );
});

describe('managed TLS identity bracket validation', () => {
  it.each([
    '[db.example.test]',
    'db.example.test]',
    '[db.example.test',
    '[[2001:db8::2]]',
    '  [db.example.test]  ',
    '  db.example.test]  ',
  ])(
    'rejects malformed or non-IP bracketed TLS identity %s before normalization',
    (tlsServerName) => {
      const result = spawnSync(
        'node',
        [
          '--input-type=module',
          '--eval',
          `
import assert from 'node:assert/strict';
await assert.rejects(import(${JSON.stringify(configUrl)}), {
  message: 'Database TLS identity brackets must contain one valid IPv6 address',
});
`,
        ],
        {
          encoding: 'utf8',
          env: {
            DATABASE_TLS_CA_CERTIFICATE: 'fixture-ca',
            DATABASE_TLS_REQUIRED: 'true',
            DATABASE_TLS_SERVER_NAME: tlsServerName,
            DATABASE_URL: 'postgresql://fixture:fixture@localhost:5432/appdb',
            PATH: process.env['PATH'],
          },
          timeout: 5000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.stderr).toBe(0);
    },
  );
});

describe.each(['true', 'false'])(
  'managed PostgreSQL transport with DATABASE_TLS_REQUIRED=%s',
  (tlsRequired) => {
    it.each([
      'postgresql:///appdb?host=database.example&user=fixture&password=fixture',
      'postgresql:///appdb?host=%2Ftmp&host=database.example&user=fixture&password=fixture',
    ])(
      'accepts a final TCP query host without an authority: %s',
      (databaseUrl) => {
        const result = spawnSync(
          'node',
          [
            '--input-type=module',
            '--eval',
            `
import assert from 'node:assert/strict';
import { Client } from 'pg';
import config from ${JSON.stringify(configUrl)};
const expected = new Client({ connectionString: process.env.DATABASE_URL });
const actual = new Client(config.dbCredentials);
for (const field of ['host', 'port', 'user', 'password', 'database']) {
  assert.equal(actual[field], expected[field], field);
}
assert.equal(actual.host, 'database.example');
assert.equal(config.dbCredentials.ssl.rejectUnauthorized, true);
assert.equal(config.dbCredentials.ssl.checkServerIdentity('ignored', { subjectaltname: 'DNS:database.example' }), undefined);
assert.ok(config.dbCredentials.ssl.checkServerIdentity('ignored', { subjectaltname: 'DNS:other.example' }) instanceof Error);
`,
          ],
          {
            encoding: 'utf8',
            env: {
              DATABASE_TLS_CA_CERTIFICATE: 'fixture-ca',
              DATABASE_TLS_REQUIRED: tlsRequired,
              DATABASE_URL: databaseUrl,
              PATH: process.env['PATH'],
            },
            timeout: 5000,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status, result.stderr).toBe(0);
      },
    );

    it.each([
      'postgresql://fixture:fixture@localhost/appdb?host=%2Fvar%2Frun%2Fpostgresql',
      'postgresql:///appdb?host=database.example&host=%2Fvar%2Frun%2Fpostgresql&user=fixture&password=fixture',
      'postgresql://fixture:fixture@%2Fvar%2Frun%2Fpostgresql/appdb',
      'postgresql:///appdb?host=database.example&host=&user=fixture&password=fixture',
    ])(
      'rejects a socket or missing effective host even with a TLS name: %s',
      (databaseUrl) => {
        for (const tlsServerName of ['', 'certificate.example']) {
          const result = spawnSync(
            'node',
            [
              '--input-type=module',
              '--eval',
              `
import assert from 'node:assert/strict';
await assert.rejects(import(${JSON.stringify(configUrl)}), /must identify a TCP PostgreSQL host/);
`,
            ],
            {
              encoding: 'utf8',
              env: {
                DATABASE_TLS_CA_CERTIFICATE: 'fixture-ca',
                DATABASE_TLS_REQUIRED: tlsRequired,
                DATABASE_TLS_SERVER_NAME: tlsServerName,
                DATABASE_URL: databaseUrl,
                PATH: process.env['PATH'],
              },
              timeout: 5000,
            },
          );
          expect(result.error).toBeUndefined();
          expect(result.signal).toBeNull();
          expect(result.status, result.stderr).toBe(0);
        }
      },
    );
  },
);
