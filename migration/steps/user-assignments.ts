import consola from 'consola';
import { and, count, eq, InferSelectModel, inArray, sql } from 'drizzle-orm';
import { uniq } from 'es-toolkit';
import { DateTime } from 'luxon';

import * as oldSchema from '../../old/drizzle';
import { database } from '../../src/db';
import * as schema from '../../src/db/schema';
import { transformAuthId } from '../config';
import { oldDatabase } from '../migrator-database';
import { maybeAddPositionRole } from './roles';

const migrationStepSize = 1000;
const numberFormat = new Intl.NumberFormat();

export const migrateUserTenantAssignments = async (
  oldTenant: InferSelectModel<typeof oldSchema.tenant>,
  newTenant: InferSelectModel<typeof schema.tenants>,
  roleMap: Map<string, string>,
) => {
  consola.info(`Migrating user assignments`);
  const userAssignmentCountResult = await oldDatabase
    .select({ count: count() })
    .from(oldSchema.usersOfTenants)
    .where(eq(oldSchema.usersOfTenants.tenantId, oldTenant.id));
  const userAssignmentCount = userAssignmentCountResult[0].count;
  consola.info(`Found ${numberFormat.format(userAssignmentCount)} user assignments`);

  for (let index = 0; index < userAssignmentCount; index += migrationStepSize) {
    consola.info(
      `Migrating user assignments ${numberFormat.format(index + 1)} to ${numberFormat.format(index + migrationStepSize)}`,
    );
    const oldUserAssignments = await oldDatabase.query.usersOfTenants.findMany({
      limit: migrationStepSize,
      offset: index,
      where: { tenantId: oldTenant.id },
      with: {
        user: {
          columns: {
            authId: true,
          },
        },
      },
    });

    await database
      .insert(schema.usersToTenants)
      .values(
        oldUserAssignments.map((userAssignment) => ({
          tenantId: newTenant.id,
          userId: sql`(select ${schema.users.id} from ${schema.users} where ${schema.users.auth0Id} = ${transformAuthId(userAssignment.user.authId)})`,
        })),
      )
      .onConflictDoNothing({
        target: [schema.usersToTenants.userId, schema.usersToTenants.tenantId],
      });

    // Retrieve (existing or newly inserted) assignments for these users to build role relations
    const transformedAuthIds = oldUserAssignments.map((ua) => transformAuthId(ua.user.authId));
    const userRows = await database
      .select({ id: schema.users.id, auth0Id: schema.users.auth0Id })
      .from(schema.users)
      .where(inArray(schema.users.auth0Id, transformedAuthIds));
    const userIdSet = new Set(userRows.map((u) => u.id));
    const assignments = await database
      .select({ id: schema.usersToTenants.id, userId: schema.usersToTenants.userId })
      .from(schema.usersToTenants)
      .where(
        and(
          eq(schema.usersToTenants.tenantId, newTenant.id),
          inArray(schema.usersToTenants.userId, Array.from(userIdSet)),
        ),
      );
    const assignmentByUserId = new Map(assignments.map((a) => [a.userId, a.id]));

    const rolesToAddPromises = oldUserAssignments.map(async (oldAssignment) => {
      // Resolve user for this assignment
      const transformedId = transformAuthId(oldAssignment.user.authId);
      const userId = userRows.find((u) => u.auth0Id === transformedId)?.id;
      if (!userId) return [] as { roleId: string; userTenantId: string }[];
      const assignmentId = assignmentByUserId.get(userId);
      if (!assignmentId) return [] as { roleId: string; userTenantId: string }[];
      const defaultUserRole = roleMap.get('NONE');
      const rolesToAdd = defaultUserRole ? [defaultUserRole] : [];

      if (oldAssignment.role === 'ADMIN') {
        const adminRole = roleMap.get('ADMIN');
        if (adminRole) {
          rolesToAdd.push(adminRole);
        } else {
          consola.warn('Could not find admin role');
        }
      }
      const statusRole = roleMap.get(oldAssignment.status);
      if (statusRole) {
        rolesToAdd.push(statusRole);
      } else {
        consola.warn(`Could not find status role for ${oldAssignment.status}`);
      }

      if (oldAssignment.position) {
        console.info('Migrating position to custom role:', oldAssignment.position);
        const positionRole = await maybeAddPositionRole(oldAssignment.position, newTenant);
        if (positionRole) {
          rolesToAdd.push(positionRole);
        } else {
          consola.warn(`Could not find position role for ${oldAssignment.position}`);
        }
      }

      return uniq(rolesToAdd).map((role) => ({
        roleId: role,
        userTenantId: assignmentId,
      }));
    });

    const rolesToAdd = (await Promise.all(rolesToAddPromises)).flat();

    if (rolesToAdd.length) {
      await database
        .insert(schema.rolesToTenantUsers)
        .values(rolesToAdd)
        .onConflictDoNothing({
          target: [schema.rolesToTenantUsers.roleId, schema.rolesToTenantUsers.userTenantId],
        });
    }
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
