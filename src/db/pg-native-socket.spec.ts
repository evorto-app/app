import * as PgConnection from '@effect/sql-pg/PgConnection';
import { Effect } from 'effect';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPgClientConfig } from './pg-connection-config';

const integer = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
};
const backendMessage = (tag: string, body: Buffer) =>
  Buffer.concat([Buffer.from(tag), integer(body.length + 4), body]);

const startupReply = Buffer.concat([
  backendMessage('R', integer(0)),
  backendMessage('K', Buffer.concat([integer(1234), integer(5678)])),
  backendMessage('Z', Buffer.from('I')),
]);

describe('native PostgreSQL Unix socket transport', () => {
  it.each([
    { database: undefined, syntax: 'raw' },
    { database: 'socket-database-é', syntax: 'raw' },
    { database: 'app data é', syntax: 'url' },
  ])(
    'connects through $syntax socket syntax with database $database',
    async ({ database, syntax }) => {
      // macOS Unix socket paths have a small limit; its normal tmpdir is too long.
      const directory = await mkdtemp('/tmp/evorto-pg-');
      const sockets = new Set<Socket>();
      let parameters: Map<string, string> | undefined;
      let transportError: Error | undefined;
      const server = createServer((socket) => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
        socket.on('error', (error) => {
          transportError = error;
        });
        let buffered = Buffer.alloc(0);
        const receiveStartup = (chunk: Buffer) => {
          buffered = Buffer.concat([buffered, chunk]);
          if (buffered.length < 4) return;
          const size = buffered.readInt32BE(0);
          if (size < 8 || size > 4096) {
            socket.destroy(new Error('Invalid PostgreSQL startup size'));
            return;
          }
          if (buffered.length < size) return;
          socket.off('data', receiveStartup);
          if (buffered.readInt32BE(4) !== 196_608) {
            socket.destroy(new Error('Expected PostgreSQL protocol 3 startup'));
            return;
          }
          const fields = buffered
            .subarray(8, size - 1)
            .toString()
            .split('\0');
          parameters = new Map();
          for (let index = 0; index + 1 < fields.length; index += 2) {
            parameters.set(fields[index], fields[index + 1]);
          }
          socket.write(startupReply);
        };
        socket.on('data', receiveStartup);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(path.join(directory, '.s.PGSQL.5432'), () => {
            server.off('error', reject);
            resolve();
          });
        });
        const databaseUrl =
          syntax === 'raw'
            ? `${directory}${database ? ` ${database}` : ''}`
            : `postgresql:///${encodeURIComponent(database ?? '')}?host=${encodeURIComponent(directory)}`;
        await Effect.runPromise(
          Effect.scoped(
            PgConnection.make({
              ...createPgClientConfig({ databaseUrl }),
              connectTimeout: 1000,
              username: 'fixture-user',
            }),
          ),
        );
        expect(transportError).toBeUndefined();
        expect(parameters?.get('user')).toBe('fixture-user');
        // PostgreSQL defaults an omitted database to the startup user.
        expect(parameters?.get('database') ?? parameters?.get('user')).toBe(
          database ?? 'fixture-user',
        );
      } finally {
        for (const socket of sockets) socket.destroy();
        try {
          if (server.listening) {
            await new Promise<void>((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()));
            });
          }
        } finally {
          await rm(directory, { force: true, recursive: true });
        }
      }
    },
  );
});
