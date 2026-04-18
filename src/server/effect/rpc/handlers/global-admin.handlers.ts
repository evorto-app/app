import type { Headers } from '@effect/platform';

import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import { type Permission } from '../../../../shared/permissions/permissions';
import { ConfigPermissions } from '../../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.pipe(Effect.flatMap((database) => operation(database).pipe(Effect.orDie)));

const ensureAuthenticated = (
  headers: Headers.Headers,
): Effect.Effect<void, RpcUnauthorizedError> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail(new RpcUnauthorizedError({ message: 'Authentication required' }));

const decodeHeaderJson = <A, I>(
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
) => Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

const ensurePermission = (
  headers: Headers.Headers,
  permission: Permission,
): Effect.Effect<void, RpcForbiddenError | RpcUnauthorizedError> =>
  Effect.gen(function* () {
    yield* ensureAuthenticated(headers);
    const currentPermissions = decodeHeaderJson(
      headers[RPC_CONTEXT_HEADERS.PERMISSIONS],
      ConfigPermissions,
    );

    if (!currentPermissions.includes(permission)) {
      return yield* Effect.fail(new RpcForbiddenError({ message: 'Forbidden' }));
    }
  });

export const globalAdminHandlers = {
    'globalAdmin.tenants.findMany': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'globalAdmin:manageTenants');
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
