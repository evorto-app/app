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
    {
      expectedHost: '::1',
      identity: 'authority credentials and port after empty query overrides',
      overrides: 'empty',
      queryHost: '',
      tlsServerName: '',
    },
    {
      expectedHost: '::1',
      identity: 'the last valid port after an invalid earlier override',
      overrides: 'last',
      queryHost: '',
      tlsServerName: '',
    },
  ])(
    'preserves connection semantics for $identity',
    ({ expectedHost, queryHost, tlsServerName, overrides = '' }) => {
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
import { Duplex } from 'node:stream';

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
const { Effect } = await import('effect');
const PgConnection = await import('@effect/sql-pg/PgConnection');
const { createNodePgPoolConfig, createPgClientConfig } = await import(${JSON.stringify(configUrl)});

const username = 'fixture user@tenant';
const password = 'p@ss:/?%word';
const database = 'app data é';
const applicationName = 'TLS fixture / worker';
const options = '-c search_path=public -c statement_timeout=9000';
const query = new URLSearchParams({ application_name: applicationName, options, port: '5544' });
const overrides = process.env.QUERY_OVERRIDES;
const expectedPort = overrides === 'empty' ? 5432 : 5544;
if (overrides === 'empty') {
  for (const name of ['user', 'password', 'port']) {
    query.append(name, 'ignored');
    query.append(name, '');
  }
} else if (overrides === 'last') {
  query.set('port', 'invalid');
  query.append('port', '5544');
}
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
]) {
  const client = new Client(config);
  assert.equal(client.host, process.env.EXPECTED_HOST, adapter);
  assert.equal(client.user, username, adapter);
  assert.equal(client.password, password, adapter);
  assert.equal(client.database, database, adapter);
  assert.equal(client.port, expectedPort, adapter);
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

// Exercise the native driver's connect, SSLRequest, startup and password paths.
const integer = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
};
const message = (tag, body) => Buffer.concat([Buffer.from(tag), integer(body.length + 4), body]);
let startup;
let suppliedPassword;
let connected = false;
let stage = 0;
const stream = new Duplex({
  read() {},
  final(callback) {
    stream.push(null);
    callback();
  },
  write(chunk, _encoding, callback) {
    const bytes = Buffer.from(chunk);
    let reply;
    if (stage === 0) {
      assert.deepEqual(bytes, Buffer.concat([integer(8), integer(80877103)]));
      reply = Buffer.from('S');
    } else if (stage === 1) {
      assert.equal(bytes.readInt32BE(0), bytes.length);
      assert.equal(bytes.readInt32BE(4), 196608);
      const fields = bytes.subarray(8, -1).toString().split('\\0');
      startup = new Map();
      for (let index = 0; index + 1 < fields.length; index += 2) {
        startup.set(fields[index], fields[index + 1]);
      }
      reply = message('R', integer(3));
    } else if (stage === 2) {
      assert.equal(bytes[0], 'p'.charCodeAt(0));
      suppliedPassword = bytes.subarray(5, -1).toString();
      reply = Buffer.concat([
        message('R', integer(0)),
        message('K', Buffer.concat([integer(1234), integer(5678)])),
        message('Z', Buffer.from('I')),
      ]);
    } else {
      assert.equal(bytes[0], 'X'.charCodeAt(0));
    }
    stage += 1;
    if (reply) queueMicrotask(() => stream.push(reply));
    callback();
  },
});
net.connect = (options) => {
  assert.equal(options.host, process.env.EXPECTED_HOST);
  assert.equal(options.port, expectedPort);
  assert.equal(options.path, undefined);
  connected = true;
  queueMicrotask(() => stream.emit('connect'));
  return stream;
};
tls.connect = (options) => {
  capturedTlsOptions = options;
  assert.equal(options.socket, stream);
  queueMicrotask(() => stream.emit('secureConnect'));
  return stream;
};
syncBuiltinESMExports();
capturedTlsOptions = undefined;
await Effect.runPromise(Effect.scoped(PgConnection.make(effectConfig)));
assert.equal(connected, true);
assert.equal(startup.get('user'), username);
assert.equal(startup.get('database'), database);
assert.equal(startup.get('application_name'), applicationName);
assert.equal(startup.get('options'), options);
assert.equal(suppliedPassword, password);
assert.equal(capturedTlsOptions.ca, caCertificate);
assert.equal(capturedTlsOptions.rejectUnauthorized, true);
assert.equal(capturedTlsOptions.servername,
  tlsServerName && net.isIP(tlsServerName) === 0 ? tlsServerName : undefined);
const nativeIdentity = tlsServerName || process.env.EXPECTED_HOST;
const nativeSan = net.isIP(nativeIdentity) ? 'IP Address:' + nativeIdentity : 'DNS:' + nativeIdentity;
assert.equal(capturedTlsOptions.checkServerIdentity('ignored', { subjectaltname: nativeSan }), undefined);
assert.ok(capturedTlsOptions.checkServerIdentity('ignored', { subjectaltname: 'DNS:wrong.example' }) instanceof Error);
assert.equal(networkAttempts, 0);
assert.equal(stream.writableEnded, true);
`,
        ],
        {
          encoding: 'utf8',
          env: {
            DATABASE_TLS_SERVER_NAME: tlsServerName,
            EXPECTED_HOST: expectedHost,
            PATH: process.env['PATH'],
            QUERY_HOST: queryHost,
            QUERY_OVERRIDES: overrides,
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
