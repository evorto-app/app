import * as PgClient from '@effect/sql-pg/PgClient';
import { Effect } from 'effect';
import * as SqlClient from 'effect/unstable/sql/SqlClient';

/** Query-construction fixture without a network connection or native pool. */
export const makePgTestClient = Effect.fn(function* (
  options: Pick<
    SqlClient.SqlClient.MakeOptions,
    'acquirer' | 'transactionAcquirer'
  >,
) {
  const sql = yield* SqlClient.make({
    ...options,
    compiler: PgClient.makeCompiler(),
    spanAttributes: [],
  });
  const postgres = {
    config: {},
    json: () => {
      throw new Error('Unexpected PostgreSQL JSON fragment in query fixture');
    },
    listen: () => Effect.die(new Error('Unexpected PostgreSQL listener')),
    notify: () => Effect.die(new Error('Unexpected PostgreSQL notification')),
    [PgClient.TypeId]: PgClient.TypeId,
  } satisfies Omit<PgClient.PgClient, keyof SqlClient.SqlClient>;
  return Object.assign(sql, postgres);
});
