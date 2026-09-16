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
