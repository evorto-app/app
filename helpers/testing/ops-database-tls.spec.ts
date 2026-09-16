import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const configUrl = pathToFileURL(
  path.join(process.cwd(), 'ops/drizzle.config.mjs'),
).href;

describe('managed Drizzle TLS identity', () => {
  it.each([
    {
      identity: 'the IPv6 connection host',
      subjectaltname: 'IP Address:0:0:0:0:0:0:0:1',
      tlsServerName: '',
    },
    {
      identity: 'an explicit DNS identity and SNI',
      subjectaltname: 'DNS:database.example',
      tlsServerName: 'database.example',
    },
    {
      identity: 'an explicit IPv6 identity without SNI',
      subjectaltname: 'IP Address:2001:db8:0:0:0:0:0:2',
      tlsServerName: '2001:db8::2',
    },
  ])(
    'uses an unbracketed connection host and verifies $identity',
    ({ subjectaltname, tlsServerName }) => {
      const result = spawnSync(
        'node',
        [
          '--input-type=module',
          '--eval',
          `import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import config from ${JSON.stringify(configUrl)};

const credentials = config.dbCredentials;
const ssl = credentials.ssl;
const serverName = process.env.DATABASE_TLS_SERVER_NAME;
assert.equal(credentials.host, '::1');
assert.equal(ssl.ca, process.env.DATABASE_TLS_CA_CERTIFICATE);
assert.equal(ssl.rejectUnauthorized, true);
assert.equal(ssl.servername, serverName && isIP(serverName) === 0 ? serverName : undefined);
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
            DATABASE_TLS_REQUIRED: 'true',
            DATABASE_TLS_SERVER_NAME: tlsServerName,
            DATABASE_URL: 'postgresql://fixture:fixture@[::1]:5432/appdb',
            EXPECTED_CERTIFICATE_SAN: subjectaltname,
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
