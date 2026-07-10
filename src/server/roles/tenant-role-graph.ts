import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { and, arrayContains, count, eq, inArray, ne, sql } from 'drizzle-orm';
import { Effect } from 'effect';

import { type DatabaseClient } from '../../db';
import {
  eventInstances,
  eventRegistrationOptions,
  eventTemplates,
  roles,
  rolesToTenantUsers,
  templateRegistrationOptions,
} from '../../db/schema';

type TenantRoleGraphDatabase = Pick<DatabaseClient, 'select'>;

export const uniqueTenantRoleIds = (roleIds: readonly string[]): string[] =>
  [...new Set(roleIds)].toSorted();

export const lockTenantRoleGraph = Effect.fn(
  'TenantRoleGraph.lockTenantRoleGraph',
)(function* (database: Pick<DatabaseClient, 'execute'>, tenantId: string) {
  yield* database
    .execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`evorto:tenant-role-graph:${tenantId}`}, 0))`,
    )
    .pipe(Effect.asVoid);
});

export const tenantRoleIdsExist = Effect.fn(
  'TenantRoleGraph.tenantRoleIdsExist',
)(function* (
  database: Pick<DatabaseClient, 'select'>,
  tenantId: string,
  roleIds: readonly string[],
) {
  const uniqueRoleIds = uniqueTenantRoleIds(roleIds);
  if (uniqueRoleIds.length === 0) {
    return true;
  }

  const matchingRoles = yield* database
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), inArray(roles.id, uniqueRoleIds)));

  return matchingRoles.length === uniqueRoleIds.length;
});

export const ensureTenantRetainsAnotherDefaultUserRole = Effect.fn(
  'TenantRoleGraph.ensureTenantRetainsAnotherDefaultUserRole',
)(function* (
  database: Pick<DatabaseClient, 'select'>,
  tenantId: string,
  excludedRoleId: string,
) {
  const otherDefaults = yield* database
    .select({ total: count() })
    .from(roles)
    .where(
      and(
        eq(roles.tenantId, tenantId),
        eq(roles.defaultUserRole, true),
        ne(roles.id, excludedRoleId),
      ),
    );
  if ((otherDefaults[0]?.total ?? 0) === 0) {
    return yield* new RpcBadRequestError({
      message: 'The tenant must keep at least one default user role',
      reason: 'lastDefaultUserRole',
    });
  }
});

export const ensureTenantRoleIsUnreferenced = Effect.fn(
  'TenantRoleGraph.ensureTenantRoleIsUnreferenced',
)(function* (
  database: TenantRoleGraphDatabase,
  tenantId: string,
  roleId: string,
) {
  const roleAssignments = yield* database
    .select({ roleId: rolesToTenantUsers.roleId })
    .from(rolesToTenantUsers)
    .where(
      and(
        eq(rolesToTenantUsers.roleId, roleId),
        eq(rolesToTenantUsers.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (roleAssignments.length > 0) {
    return yield* new RpcBadRequestError({
      message: 'Role cannot be deleted while it is assigned to tenant users',
      reason: 'roleInUseByUserAssignments',
    });
  }

  const eventOptions = yield* database
    .select({ id: eventRegistrationOptions.id })
    .from(eventRegistrationOptions)
    .innerJoin(
      eventInstances,
      eq(eventInstances.id, eventRegistrationOptions.eventId),
    )
    .where(
      and(
        eq(eventInstances.tenantId, tenantId),
        arrayContains(eventRegistrationOptions.roleIds, [roleId]),
      ),
    )
    .limit(1);
  if (eventOptions.length > 0) {
    return yield* new RpcBadRequestError({
      message:
        'Role cannot be deleted while an event registration option uses it',
      reason: 'roleInUseByEventOption',
    });
  }

  const templateOptions = yield* database
    .select({ id: templateRegistrationOptions.id })
    .from(templateRegistrationOptions)
    .innerJoin(
      eventTemplates,
      eq(eventTemplates.id, templateRegistrationOptions.templateId),
    )
    .where(
      and(
        eq(eventTemplates.tenantId, tenantId),
        arrayContains(templateRegistrationOptions.roleIds, [roleId]),
      ),
    )
    .limit(1);
  if (templateOptions.length > 0) {
    return yield* new RpcBadRequestError({
      message:
        'Role cannot be deleted while a template registration option uses it',
      reason: 'roleInUseByTemplateOption',
    });
  }
});
