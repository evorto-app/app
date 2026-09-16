import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const configUrl = pathToFileURL(
  path.join(process.cwd(), 'src/db/pg-connection-config.ts'),
).href;

describe('PostgreSQL IPv6 transport and TLS options', () => {
  it.each([
    {
      expectedHost: '::1',
      identity: 'the IPv6 URL host without SNI',
      queryHost: '',
      tlsServerName: '',
    },
    {
      expectedHost: '::1',
      identity: 'an explicit DNS identity with SNI',
      queryHost: '',
      tlsServerName: 'database.example',
    },
    {
      expectedHost: '::1',
      identity: 'an explicit IPv6 identity without SNI',
      queryHost: '',
      tlsServerName: '2001:db8::2',
    },
    {
      expectedHost: '2001:db8::5',
      identity: 'an explicit URL query host without SNI',
      queryHost: '2001:db8::5',
      tlsServerName: '',
    },
    {
      expectedHost: '2001:db8::5',
      identity: 'the last explicit URL query host without SNI',
      queryHost: '2001:db8::4,2001:db8::5',
      tlsServerName: '',
    },
    {
      expectedHost: '::1',
      identity: 'the URL host when the last query host is empty',
      queryHost: '2001:db8::5,',
      tlsServerName: '',
    },
  ])(
    'preserves connection semantics for $identity',
    ({ expectedHost, queryHost, tlsServerName }) => {
      const result = spawnSync(
        'node',
        [
          '--experimental-strip-types',
          '--input-type=module',
          '--eval',
          `import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

let networkAttempts = 0;
const denyConnection = () => {
  networkAttempts += 1;
  throw new Error('Unexpected network connection in IPv6 transport test');
};
net.Socket.prototype.connect = denyConnection;
net.connect = denyConnection;
net.createConnection = denyConnection;
globalThis.fetch = denyConnection;

const tlsGuard = new Error('TLS options captured without opening a socket');
let capturedTlsOptions;
tls.connect = (options) => {
  capturedTlsOptions = options;
  throw tlsGuard;
};
syncBuiltinESMExports();

const { Client } = await import('pg');
const { Redacted } = await import('effect');
const { createNodePgPoolConfig, createPgClientConfig } = await import(${JSON.stringify(configUrl)});

const username = 'fixture user@tenant';
const password = 'p@ss:/?%word';
const database = 'app data é';
const applicationName = 'TLS fixture / worker';
const options = '-c search_path=public -c statement_timeout=9000';
const query = new URLSearchParams({ application_name: applicationName, options, port: '5544' });
const queryHost = process.env.QUERY_HOST;
const hasEffectiveQueryHost = Boolean(queryHost?.split(',').at(-1));
if (queryHost) {
  for (const host of queryHost.split(',')) query.append('host', host);
}
const databaseUrl = 'postgresql://' + encodeURIComponent(username) + ':' + encodeURIComponent(password)
  + '@[::1]:5432/' + encodeURIComponent(database) + '?' + query;
const caCertificate = '\\n-----BEGIN CERTIFICATE-----\\nfixture\\n-----END CERTIFICATE-----\\n';
const tlsServerName = process.env.DATABASE_TLS_SERVER_NAME || undefined;
const input = { caCertificate, databaseUrl, tlsServerName };
const nodeConfig = createNodePgPoolConfig(input);
const effectConfig = createPgClientConfig(input);

for (const [adapter, config] of [
  ['node', nodeConfig],
  ['effect', { connectionString: Redacted.value(effectConfig.url), ssl: effectConfig.ssl }],
]) {
  const client = new Client(config);
  assert.equal(client.host, process.env.EXPECTED_HOST, adapter);
  assert.equal(client.user, username, adapter);
  assert.equal(client.password, password, adapter);
  assert.equal(client.database, database, adapter);
  assert.equal(client.port, 5544, adapter);
  assert.equal(client.connectionParameters.application_name, applicationName, adapter);
  assert.equal(client.connectionParameters.options, options, adapter);
  if (hasEffectiveQueryHost) assert.equal(config.connectionString, databaseUrl, adapter);

  const preservedUrl = new URL(config.connectionString);
  assert.equal(preservedUrl.username, encodeURIComponent(username), adapter);
  assert.equal(preservedUrl.password, encodeURIComponent(password), adapter);
  assert.equal(preservedUrl.pathname, '/' + encodeURIComponent(database), adapter);
  for (const name of new Set(query.keys())) {
    if (name === 'host' && !hasEffectiveQueryHost) continue;
    assert.deepEqual(preservedUrl.searchParams.getAll(name), query.getAll(name), adapter + ':' + name);
  }

  capturedTlsOptions = undefined;
  let tlsError;
  client.connection.once('error', (error) => { tlsError = error; });
  client.connection.upgradeToSSL(client.host, denyConnection);
  assert.equal(tlsError, tlsGuard, adapter);
  assert.ok(capturedTlsOptions, adapter);
  assert.equal(capturedTlsOptions.ca, caCertificate, adapter);
  assert.equal(capturedTlsOptions.rejectUnauthorized, true, adapter);
  assert.equal(capturedTlsOptions.servername,
    tlsServerName && net.isIP(tlsServerName) === 0 ? tlsServerName : undefined, adapter);
  assert.equal(typeof capturedTlsOptions.checkServerIdentity, 'function', adapter);
  const expectedIdentity = tlsServerName || client.host;
  const expectedSan = net.isIP(expectedIdentity) ? 'IP Address:' + expectedIdentity : 'DNS:' + expectedIdentity;
  assert.equal(capturedTlsOptions.checkServerIdentity(client.host, {
    subjectaltname: expectedSan,
  }), undefined, adapter);
  assert.ok(capturedTlsOptions.checkServerIdentity(client.host, {
    subjectaltname: 'IP Address:2001:db8::99',
  }) instanceof Error, adapter);
  if (!tlsServerName && client.host !== '::1') {
    assert.ok(capturedTlsOptions.checkServerIdentity(client.host, {
      subjectaltname: 'IP Address:::1',
    }) instanceof Error, adapter);
  }
  assert.equal(networkAttempts, 0, adapter);
  client.connection.stream.destroy();
}
`,
        ],
        {
          encoding: 'utf8',
          env: {
            DATABASE_TLS_SERVER_NAME: tlsServerName,
            EXPECTED_HOST: expectedHost,
            PATH: process.env['PATH'],
            QUERY_HOST: queryHost,
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
