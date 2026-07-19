import consola from 'consola';
import {
  and,
  count,
  eq,
  gt,
  type InferInsertModel,
  type InferSelectModel,
  inArray,
} from 'drizzle-orm';
import { uniq } from 'es-toolkit';

import * as oldSchema from '../../old/drizzle';
import type { ScriptDatabaseClient } from '../../src/db/database-client';
import * as schema from '../../src/db/schema';
import { transformAuthId } from '../config';
import { legacyAssignmentRoleIds } from '../legacy-assignment-roles';
import { oldDatabase } from '../migrator-database';
import { collectMigrationOwnedRoleIds, maybeAddPositionRole } from './roles';

const migrationStepSize = 1000;
const numberFormat = new Intl.NumberFormat();

export const migrateUserTenantAssignments = async (
  database: ScriptDatabaseClient,
  oldTenant: InferSelectModel<typeof oldSchema.tenant>,
  newTenant: InferSelectModel<typeof schema.tenants>,
  roleMap: Map<string, string>,
) => {
  consola.info(`Migrating user assignments`);
  const requiredRoleId = (legacyRole: string): string => {
    const roleId = roleMap.get(legacyRole);
    if (!roleId) {
      throw new Error(
        `Legacy role ${legacyRole} has no target role mapping; assignment migration is blocked.`,
      );
    }
    return roleId;
  };
  requiredRoleId('NONE');
  requiredRoleId('ADMIN');
  requiredRoleId('FULL');
  requiredRoleId('TRIAL');
  requiredRoleId('HELPER');
  requiredRoleId('SPONSOR');
  requiredRoleId('ALUMNI');
  requiredRoleId('SELECTED');
  requiredRoleId('BLACKLISTED');

  const tenantRoles = await database
    .select({
      description: schema.roles.description,
      id: schema.roles.id,
      name: schema.roles.name,
    })
    .from(schema.roles)
    .where(eq(schema.roles.tenantId, newTenant.id));
  const migrationOwnedRoleIds = collectMigrationOwnedRoleIds(
    roleMap.values(),
    tenantRoles,
  );

  const userAssignmentCountResult = await oldDatabase
    .select({ count: count() })
    .from(oldSchema.usersOfTenants)
    .where(eq(oldSchema.usersOfTenants.tenantId, oldTenant.id));
  const userAssignmentCount = userAssignmentCountResult[0].count;
  consola.info(
    `Found ${numberFormat.format(userAssignmentCount)} user assignments`,
  );

  let lastLegacyUserId: string | undefined;
  let processedAssignmentCount = 0;
  const legacyUserByTransformedAuthId = new Map<string, string>();
  while (true) {
    consola.info(
      `Migrating user assignments ${numberFormat.format(processedAssignmentCount + 1)} to ${numberFormat.format(processedAssignmentCount + migrationStepSize)}`,
    );
    const oldUserAssignments = await oldDatabase
      .select({
        authId: oldSchema.user.authId,
        position: oldSchema.usersOfTenants.position,
        role: oldSchema.usersOfTenants.role,
        status: oldSchema.usersOfTenants.status,
        userId: oldSchema.usersOfTenants.userId,
      })
      .from(oldSchema.usersOfTenants)
      .innerJoin(
        oldSchema.user,
        eq(oldSchema.usersOfTenants.userId, oldSchema.user.id),
      )
      .where(
        and(
          eq(oldSchema.usersOfTenants.tenantId, oldTenant.id),
          lastLegacyUserId === undefined
            ? undefined
            : gt(oldSchema.usersOfTenants.userId, lastLegacyUserId),
        ),
      )
      .orderBy(oldSchema.usersOfTenants.userId)
      .limit(migrationStepSize);
    if (oldUserAssignments.length === 0) break;
    const lastAssignment = oldUserAssignments.at(-1);
    if (!lastAssignment) break;
    lastLegacyUserId = lastAssignment.userId;
    processedAssignmentCount += oldUserAssignments.length;

    const sourceAssignments = oldUserAssignments.map((oldAssignment) => {
      const transformedAuthId = transformAuthId(oldAssignment.authId);
      const previousLegacyUserId =
        legacyUserByTransformedAuthId.get(transformedAuthId);
      if (
        previousLegacyUserId !== undefined &&
        previousLegacyUserId !== oldAssignment.userId
      ) {
        throw new Error(
          `Legacy users ${previousLegacyUserId} and ${oldAssignment.userId} both map to target auth ID ${transformedAuthId}; migration is blocked.`,
        );
      }
      legacyUserByTransformedAuthId.set(
        transformedAuthId,
        oldAssignment.userId,
      );

      const baseRoleIds = legacyAssignmentRoleIds(oldAssignment, roleMap);
      return {
        baseRoleIds: uniq(baseRoleIds),
        oldAssignment,
        transformedAuthId,
      };
    });
    const transformedAuthIds = sourceAssignments.map(
      ({ transformedAuthId }) => transformedAuthId,
    );
    const userRows = await database
      .select({ auth0Id: schema.users.auth0Id, id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.auth0Id, transformedAuthIds));
    const userByAuth0Id = new Map(
      userRows.map((user) => [user.auth0Id, user.id]),
    );
    const assignmentsWithTargetUsers = sourceAssignments.map(
      ({ baseRoleIds, oldAssignment, transformedAuthId }) => {
        const userId = userByAuth0Id.get(transformedAuthId);
        if (!userId) {
          throw new Error(
            `Target user ${transformedAuthId} is missing for a legacy tenant assignment.`,
          );
        }
        return { baseRoleIds, oldAssignment, userId };
      },
    );

    await database
      .insert(schema.usersToTenants)
      .values(
        assignmentsWithTargetUsers.map(({ userId }) => ({
          tenantId: newTenant.id,
          userId,
        })),
      )
      .onConflictDoNothing({
        target: [schema.usersToTenants.userId, schema.usersToTenants.tenantId],
      });

    // Retrieve (existing or newly inserted) assignments for these users to build role relations
    const targetUserIds = assignmentsWithTargetUsers.map(
      ({ userId }) => userId,
    );
    const assignments = await database
      .select({
        id: schema.usersToTenants.id,
        userId: schema.usersToTenants.userId,
      })
      .from(schema.usersToTenants)
      .where(
        and(
          eq(schema.usersToTenants.tenantId, newTenant.id),
          inArray(schema.usersToTenants.userId, targetUserIds),
        ),
      );
    const assignmentByUserId = new Map(
      assignments.map((a) => [a.userId, a.id]),
    );

    const rolesToAddPromises = assignmentsWithTargetUsers.map(
      async ({ baseRoleIds, oldAssignment, userId }) => {
        const assignmentId = assignmentByUserId.get(userId);
        if (!assignmentId) {
          throw new Error(
            `Target tenant assignment is missing for legacy user ${oldAssignment.userId}.`,
          );
        }
        const rolesToAdd = [...baseRoleIds];

        if (oldAssignment.position) {
          consola.info(
            'Migrating position to custom role:',
            oldAssignment.position,
          );
          const positionRole = await maybeAddPositionRole(
            database,
            oldAssignment.position,
            newTenant,
          );
          if (positionRole) {
            migrationOwnedRoleIds.add(positionRole);
            rolesToAdd.push(positionRole);
          } else {
            consola.warn(
              `Could not find position role for ${oldAssignment.position}`,
            );
          }
        }

        return uniq(rolesToAdd).map(
          (role): InferInsertModel<typeof schema.rolesToTenantUsers> => ({
            roleId: role,
            tenantId: newTenant.id,
            userTenantId: assignmentId,
          }),
        );
      },
    );

    const rolesToAdd = (await Promise.all(rolesToAddPromises)).flat();
    const migratedAssignmentIds = assignmentsWithTargetUsers.map(
      ({ userId }) => {
        const assignmentId = assignmentByUserId.get(userId);
        if (!assignmentId) {
          throw new Error(
            `Target tenant assignment is missing for user ${userId}.`,
          );
        }
        return assignmentId;
      },
    );
    await database.transaction(async (transaction) => {
      await transaction
        .delete(schema.rolesToTenantUsers)
        .where(
          and(
            eq(schema.rolesToTenantUsers.tenantId, newTenant.id),
            inArray(
              schema.rolesToTenantUsers.userTenantId,
              migratedAssignmentIds,
            ),
            inArray(schema.rolesToTenantUsers.roleId, [
              ...migrationOwnedRoleIds,
            ]),
          ),
        );
      if (rolesToAdd.length > 0) {
        await transaction.insert(schema.rolesToTenantUsers).values(rolesToAdd);
      }
    });
  }
  if (processedAssignmentCount !== userAssignmentCount) {
    throw new Error(
      `Read ${processedAssignmentCount} of ${userAssignmentCount} legacy tenant assignments; migration is blocked.`,
    );
  }
  const newUserAssignmentCountResult = await database
    .select({ count: count() })
    .from(schema.usersToTenants)
    .where(eq(schema.usersToTenants.tenantId, newTenant.id));
  const newUserAssignmentCount = newUserAssignmentCountResult[0].count;

  consola.success(
    `Migrated ${numberFormat.format(newUserAssignmentCount)}/${numberFormat.format(userAssignmentCount)} user assignments`,
  );
};
