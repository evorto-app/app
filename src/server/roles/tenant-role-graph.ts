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
      message:
        'Keep at least one role that is assigned automatically to new members.',
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
      message:
        'This role is still assigned to organization members. Remove those assignments before deleting the role.',
      reason: 'roleInUseByUserAssignments',
    });
  }

  const eventAnnouncements = yield* database
    .select({ id: eventInstances.id })
    .from(eventInstances)
    .where(
      and(
        eq(eventInstances.tenantId, tenantId),
        arrayContains(eventInstances.announcementRoleIds, [roleId]),
      ),
    )
    .limit(1);
  if (eventAnnouncements.length > 0) {
    return yield* new RpcBadRequestError({
      message:
        'This role is still used to show an announcement. Remove it from the announcement before deleting the role.',
      reason: 'roleInUseByEventAnnouncement',
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
        'This role is still used by an event sign-up choice. Remove it from that choice before deleting the role.',
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
        'This role is still used by a template sign-up choice. Remove it from that choice before deleting the role.',
      reason: 'roleInUseByTemplateOption',
    });
  }
});
