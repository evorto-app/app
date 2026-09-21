import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import * as PgClient from '@effect/sql-pg/PgClient';
import { makePgTestClient } from '@server/testing/pg-test-client';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Effect, Layer, Stream } from 'effect';

import { Database } from '../../db';
import { relations } from '../../db/relations';

/** Real Drizzle query construction with explicitly supplied, connection-free rows. */
export const createDatabaseTestLayer = (
  executeValues: SqlConnection.Connection['executeValues'] = () =>
    Effect.die(new Error('Unexpected database access before input validation')),
) => {
  const unexpectedOperation = Effect.die(
    new Error('Unexpected database operation in read-only fixture'),
  );
  const connection = {
    execute: () => unexpectedOperation,
    executeRaw: () => unexpectedOperation,
    executeStream: () => Stream.die(new Error('Unexpected database stream')),
    executeUnprepared: () => unexpectedOperation,
    executeValues,
    executeValuesUnprepared: () => unexpectedOperation,
  } satisfies SqlConnection.Connection;

  return Layer.effect(Database, PgDrizzle.makeWithDefaults({ relations })).pipe(
    Layer.provide(
      PgClient.layerFrom(
        makePgTestClient({
          acquirer: Effect.succeed(connection),
          transactionAcquirer: unexpectedOperation,
        }),
      ),
    ),
  );
};
