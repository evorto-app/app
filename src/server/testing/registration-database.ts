import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';
import type { SqlError } from 'effect/unstable/sql/SqlError';

import { Database } from '@db/index';
import { relations } from '@db/relations';
import * as PgClient from '@effect/sql-pg/PgClient';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Effect, Layer, Stream } from 'effect';

type TransactionCommand = 'BEGIN' | 'COMMIT' | 'ROLLBACK';

export const createRegistrationDatabaseTestLayer = ({
  executeValues,
  transactionControl = () => Effect.void,
}: {
  readonly executeValues: SqlConnection.Connection['executeValues'];
  readonly transactionControl?: (
    command: TransactionCommand,
  ) => Effect.Effect<void, SqlError>;
}) => {
  const unexpectedOperation = (operation: string) =>
    Effect.die(
      new Error(`Unexpected registration fixture database ${operation}`),
    );
  const connection = {
    execute: () => unexpectedOperation('object-row request'),
    executeRaw: executeValues,
    executeStream: () =>
      Stream.die(new Error('Unexpected registration fixture database stream')),
    executeUnprepared: (statement, parameters) => {
      if (
        parameters.length > 0 ||
        (statement !== 'BEGIN' &&
          statement !== 'COMMIT' &&
          statement !== 'ROLLBACK')
      ) {
        return unexpectedOperation('transaction command');
      }
      return transactionControl(statement).pipe(Effect.as([]));
    },
    executeValues,
    executeValuesUnprepared: () =>
      unexpectedOperation('unprepared row request'),
  } satisfies SqlConnection.Connection;

  return Layer.effect(Database, PgDrizzle.makeWithDefaults({ relations })).pipe(
    Layer.provide(
      PgClient.layerFrom(
        PgClient.makeWith({
          acquirer: Effect.succeed(connection),
          config: {},
          listenAcquirer: unexpectedOperation('listen acquisition'),
          transactionAcquirer: Effect.succeed(connection),
        }),
      ),
    ),
  );
};
