import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  includesPermission,
  type Permission,
} from '@shared/permissions/permissions';
import { RoleLookupNotFoundError } from '@shared/rpc-contracts/app-rpcs/roles.errors';
import { Effect } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import { type RoleLookupRecord } from '../../../../shared/rpc-contracts/app-rpcs/roles.rpcs';
import { RpcAccess } from './shared/rpc-access.service';

const ROLE_LOOKUP_PERMISSIONS = [
  'admin:manageRoles',
  'events:create',
  'events:editAll',
  'events:organizeAll',
  'templates:create',
  'templates:editAll',
] as const satisfies readonly Permission[];

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

const ensureRoleLookupPermission = (): Effect.Effect<
  void,
  RpcForbiddenError | RpcUnauthorizedError,
  RpcAccess
> =>
  Effect.gen(function* () {
    const context = yield* RpcAccess.current();
    if (!context.authenticated) {
      return yield* Effect.fail(
        new RpcUnauthorizedError({ message: 'Authentication required' }),
      );
    }

    const isAllowed = ROLE_LOOKUP_PERMISSIONS.some((permission) =>
      includesPermission(permission, context.permissions),
    );
    if (!isAllowed) {
      return yield* Effect.fail(
        new RpcForbiddenError({
          message: 'Missing required role lookup permission',
        }),
      );
    }
  });

const selectRoleLookupColumns = {
  defaultOrganizerRole: true,
  defaultUserRole: true,
  id: true,
  name: true,
} as const;

const normalizeRoleLookupRecord = (
  role: RoleLookupRecord,
): RoleLookupRecord => ({
  defaultOrganizerRole: role.defaultOrganizerRole,
  defaultUserRole: role.defaultUserRole,
  id: role.id,
  name: role.name,
});

export const roleHandlers = {
  'roles.findMany': (input) =>
    Effect.gen(function* () {
      yield* ensureRoleLookupPermission();
      const context = yield* RpcAccess.current();

      const roles = yield* databaseEffect((database) =>
        database.query.roles.findMany({
          columns: selectRoleLookupColumns,
          ...(input.search !== undefined && { limit: 15 }),
          orderBy: { name: 'asc' },
          where: {
            tenantId: context.tenant.id,
            ...(input.defaultUserRole !== undefined && {
              defaultUserRole: input.defaultUserRole,
            }),
            ...(input.defaultOrganizerRole !== undefined && {
              defaultOrganizerRole: input.defaultOrganizerRole,
            }),
            ...(input.search !== undefined && {
              name: { ilike: `%${input.search}%` },
            }),
          },
        }),
      );

      return roles.map((role) => normalizeRoleLookupRecord(role));
    }),
  'roles.findOne': ({ id }) =>
    Effect.gen(function* () {
      yield* ensureRoleLookupPermission();
      const context = yield* RpcAccess.current();

      const role = yield* databaseEffect((database) =>
        database.query.roles.findFirst({
          columns: selectRoleLookupColumns,
          where: {
            id,
            tenantId: context.tenant.id,
          },
        }),
      );
      if (!role) {
        return yield* Effect.fail(
          new RoleLookupNotFoundError({ id, message: 'Role not found' }),
        );
      }

      return normalizeRoleLookupRecord(role);
    }),
} satisfies Pick<AppRpcHandlers, 'roles.findMany' | 'roles.findOne'>;
