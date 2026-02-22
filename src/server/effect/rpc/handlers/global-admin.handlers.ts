 

import type { Headers } from '@effect/platform';

import { Effect } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import {
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.pipe(Effect.flatMap((database) => operation(database).pipe(Effect.orDie)));

const ensureAuthenticated = (
  headers: Headers.Headers,
): Effect.Effect<void, 'UNAUTHORIZED'> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail('UNAUTHORIZED' as const);

export const globalAdminHandlers = {
    'globalAdmin.tenants.findMany': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const allTenants = yield* databaseEffect((database) =>
          database.query.tenants.findMany({
            columns: {
              domain: true,
              id: true,
              name: true,
            },
            orderBy: (table, { asc }) => [asc(table.name)],
          }),
        );

        return allTenants;
      }),
} satisfies Partial<AppRpcHandlers>;
