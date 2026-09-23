import { drizzle } from 'drizzle-orm/node-postgres';
import { Socket } from 'node:net';
import { Client } from 'pg';

import { createNodePgPoolConfig } from '../../../src/db/pg-connection-config';
import { relations } from '../../../src/db/relations';

// Three other workers can each spend 120 seconds in a journey and 60 seconds
// in teardown before this account becomes available. UI deadlines stay intact.
export const discountCardFixtureLeaseTimeoutMs = 600_000;

export const createDiscountCardFixtureLease = ({
  databaseUrl,
  userId,
  acquisitionTimeoutMs = discountCardFixtureLeaseTimeoutMs,
  operationTimeoutMs = 10_000,
  signal,
}: {
  databaseUrl: string;
  userId: string;
  acquisitionTimeoutMs?: number;
  operationTimeoutMs?: number;
  signal?: AbortSignal;
}) => {
  for (const timeout of [acquisitionTimeoutMs, operationTimeoutMs]) {
    if (!Number.isSafeInteger(timeout) || timeout <= 0) {
      throw new Error('Fixture lease deadlines must be positive milliseconds');
    }
  }

  const socket = new Socket();
  const physicalClose = Promise.withResolvers<void>();
  const termination = Promise.withResolvers<Error>();
  let failure: Error | undefined;
  const fail = (error: Error) => {
    failure ??= error;
    termination.resolve(failure);
  };
  const stop = (error: Error) => {
    fail(error);
    socket.destroy();
  };
  const onSocketClose = () => {
    fail(new Error('The discount-card fixture connection closed'));
    physicalClose.resolve();
  };
  const onConnectionError = () => {
    stop(new Error('The discount-card fixture connection failed'));
  };
  socket.once('close', onSocketClose);
  socket.on('error', onConnectionError);

  const client = new Client({
    ...createNodePgPoolConfig({ databaseUrl }),
    application_name: 'evorto-discount-card-fixture',
    connectionTimeoutMillis: Math.min(10_000, acquisitionTimeoutMs),
    lock_timeout: acquisitionTimeoutMs,
    pipeline: false,
    statement_timeout: acquisitionTimeoutMs,
    stream: () => socket,
  });
  client.on('error', onConnectionError);
  const onAbort = () => {
    stop(new Error('The discount-card fixture lease was cancelled'));
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();

  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      stop(new Error('The discount-card fixture lease was closed'));
      try {
        await client.end();
      } finally {
        // A destroyed socket may still be closing. Native connect can remain
        // pending after intentional pre-authentication closure; do not await it.
        await physicalClose.promise;
        signal?.removeEventListener('abort', onAbort);
        client.removeListener('error', onConnectionError);
        socket.removeListener('error', onConnectionError);
      }
    })();
    return closing;
  };
  const waitForOwnedConnection = <T>(operation: Promise<T>) =>
    Promise.race([
      operation,
      termination.promise.then((error) => {
        throw error;
      }),
    ]);

  const acquireOnce = async () => {
    const deadline = setTimeout(() => {
      stop(new Error('Timed out acquiring the discount-card fixture lease'));
    }, acquisitionTimeoutMs);
    try {
      if (failure) throw failure;
      await waitForOwnedConnection(client.connect());
      // This session lock belongs only to test fixtures. Product readers and
      // writers use the separate evorto:user-discount-cards transaction key.
      await waitForOwnedConnection(
        client.query('select pg_advisory_lock(hashtextextended($1, 0))', [
          `evorto:test:discount-card-account:${userId}`,
        ]),
      );
      await waitForOwnedConnection(
        client.query(
          "select set_config('statement_timeout', $1, false), set_config('lock_timeout', $1, false)",
          [String(operationTimeoutMs)],
        ),
      );
      if (failure) throw failure;
      return drizzle({ client, relations });
    } catch (error) {
      await close().catch((cleanupError: unknown) => {
        throw new AggregateError(
          [error, cleanupError],
          'Fixture lease acquisition and cleanup failed',
        );
      });
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  };
  let acquisition: ReturnType<typeof acquireOnce> | undefined;

  // Construction performs no connection attempt. Register close with the
  // database fixture before calling acquire or doing any account mutation.
  return {
    acquire: () => {
      if (failure) return Promise.reject(failure);
      acquisition ??= acquireOnce();
      return acquisition;
    },
    close,
  };
};
