import type { GlobalAdminTenantRecord } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import type { Headers } from 'effect/unstable/http';

import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import {
  includesPermission,
  type Permission,
} from '../../../../shared/permissions/permissions';
import { ConfigPermissions } from '../../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

const ensureAuthenticated = (
  headers: Headers.Headers,
): Effect.Effect<void, RpcUnauthorizedError> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail(
        new RpcUnauthorizedError({ message: 'Authentication required' }),
      );

const decodeHeaderJson = <A>(
  value: string | undefined,
  schema: Schema.Decoder<A>,
): A => Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

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

    if (!includesPermission(permission, currentPermissions)) {
      return yield* Effect.fail(
        new RpcForbiddenError({ message: 'Forbidden', permission }),
      );
    }
  });

const toGlobalAdminTenantRecord = (tenant: {
  currency: string;
  domain: string;
  id: string;
  locale: string;
  name: string;
  stripeAccountId: null | string;
  theme: string;
  timezone: string;
}): GlobalAdminTenantRecord => {
  const { stripeAccountId, ...record } = tenant;

  return {
    ...record,
    stripeConnected: !!stripeAccountId,
  };
};

const globalAdminTenantColumns = {
  currency: true,
  domain: true,
  id: true,
  locale: true,
  name: true,
  stripeAccountId: true,
  theme: true,
  timezone: true,
} as const;

export const globalAdminHandlers = {
  'globalAdmin.tenants.findMany': (_payload, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'globalAdmin:manageTenants');
      const allTenants = yield* databaseEffect((database) =>
        database.query.tenants.findMany({
          columns: globalAdminTenantColumns,
          orderBy: (table, { asc }) => [asc(table.name)],
        }),
      );

      return allTenants.map((tenant) => toGlobalAdminTenantRecord(tenant));
    }),
  'globalAdmin.tenants.findOne': (input, options) =>
    Effect.gen(function* () {
      yield* ensurePermission(options.headers, 'globalAdmin:manageTenants');
      const tenant = yield* databaseEffect((database) =>
        database.query.tenants.findFirst({
          columns: globalAdminTenantColumns,
          where: {
            id: input.id,
          },
        }),
      );

      return tenant ? toGlobalAdminTenantRecord(tenant) : null;
    }),
} satisfies Partial<AppRpcHandlers>;
