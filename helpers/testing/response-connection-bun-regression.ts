import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { Effect, FileSystem, Layer, Path } from 'effect';
import {
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from 'effect/unstable/http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { makeServerResponseMiddleware } from '../../src/server/http/server-response.middleware';

const execFileAsync = promisify(execFile);
const nodeClientSource = String.raw`
import assert from 'node:assert/strict';
import { Agent, request } from 'node:http';

const port = Number(process.argv[1]);
const agent = new Agent({ keepAlive: true });
const sockets = new Set();
let requests = 0;
let responsesClosed = 0;
let reusedSockets = 0;
try {
  for (let round = 0; round < 4; round++) {
    for (const pathname of ['/redirect', '/asset', '/text']) {
      const result = await new Promise((resolve, reject) => {
        const pending = request({
          agent, headers: { connection: 'close' },
          hostname: '127.0.0.1', path: pathname, port,
        });
        pending.once('socket', (socket) => sockets.add(socket));
        pending.once('error', reject);
        pending.setTimeout(2000, () => pending.destroy(new Error('HTTP response timed out')));
        pending.once('response', (response) => {
          const chunks = [];
          let bytes = 0;
          response.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > 1024) pending.destroy(new Error('Unexpected response body size'));
            else chunks.push(chunk);
          });
          response.once('error', reject);
          response.once('aborted', () => reject(new Error('Response aborted')));
          response.once('end', () => resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            connection: response.headers.connection,
            location: response.headers.location,
            reused: pending.reusedSocket,
            status: response.statusCode,
          }));
        });
        pending.end();
      });
      requests += 1;
      responsesClosed += Number(result.connection === 'close');
      reusedSockets += Number(result.reused);
      assert.equal(result.connection, 'close');
      assert.equal(result.status, pathname === '/redirect' ? 302 : 200);
      if (pathname === '/redirect') assert.equal(result.location, '/asset');
      if (pathname === '/asset') assert.equal(result.body, 'export const value = 1;\n');
      if (pathname === '/text') assert.equal(result.body, 'plain response');
    }
  }
  assert.equal(sockets.size, 12);
  assert.equal(reusedSockets, 0);
  process.stdout.write(JSON.stringify({ requests, responsesClosed, reusedSockets, sockets: sockets.size }));
} finally {
  agent.destroy();
}
`;

const result = await Effect.runPromise(
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: 'evorto-response-connection-',
    });
    const fixture = path.join(directory, 'asset.js');
    yield* fileSystem.writeFileString(fixture, 'export const value = 1;\n');

    const responsePolicy = HttpRouter.middleware<{ handles: unknown }>()(
      (effect) => makeServerResponseMiddleware(effect),
      { global: true },
    );
    yield* HttpRouter.serve(
      Layer.mergeAll(
        responsePolicy,
        HttpRouter.add(
          'GET',
          '/redirect',
          Effect.succeed(HttpServerResponse.redirect('/asset')),
        ),
        HttpRouter.add('GET', '/asset', HttpServerResponse.file(fixture)),
        HttpRouter.add(
          'GET',
          '/text',
          Effect.succeed(HttpServerResponse.text('plain response')),
        ),
      ),
      { disableListenLog: true, disableLogger: true },
    ).pipe(Layer.build);
    const { address } = yield* HttpServer.HttpServer;
    if (address._tag !== 'TcpAddress') {
      return yield* Effect.die(new Error('Expected a local TCP test server'));
    }
    const { stderr, stdout } = yield* Effect.tryPromise(() =>
      execFileAsync(
        'node',
        ['--input-type=module', '-e', nodeClientSource, String(address.port)],
        { timeout: 5000 },
      ),
    );
    if (stderr !== '') {
      return yield* Effect.die(
        new Error(`Node transport regression wrote stderr: ${stderr}`),
      );
    }
    return stdout;
  }).pipe(
    Effect.provide(
      BunHttpServer.layer({
        development: false,
        gracefulShutdownTimeout: '2 seconds',
        hostname: '127.0.0.1',
        port: 0,
      }),
    ),
    Effect.scoped,
  ),
);

process.stdout.write(result);
