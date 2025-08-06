import consola from 'consola';
import { count, eq, InferSelectModel, sql } from 'drizzle-orm';
import { uniq } from 'es-toolkit';
import { DateTime } from 'luxon';

import * as oldSchema from '../../old/drizzle';
import { database } from '../../src/db';
import * as schema from '../../src/db/schema';
import { transformAuthId } from '../config';
import { oldDatabase } from '../migrator-database';

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
  consola.info(
    `Found ${numberFormat.format(userAssignmentCount)} user assignments`,
  );

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

    const newAssignments = await database
      .insert(schema.usersToTenants)
      .values(
        oldUserAssignments.map((userAssignment) => {
          return {
            tenantId: newTenant.id,
            userId: sql`(select ${schema.users.id} from ${schema.users} where ${schema.users.auth0Id} = ${transformAuthId(userAssignment.user.authId)})`,
          };
        }),
      )
      .returning();

    const rolesToAdd = oldUserAssignments.flatMap((oldAssignment, index) => {
      const assignment = newAssignments[index];
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

      return uniq(rolesToAdd).map((role) => ({
        roleId: role,
        userTenantId: assignment.id,
      }));
    });

    await database.insert(schema.rolesToTenantUsers).values(rolesToAdd);
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
