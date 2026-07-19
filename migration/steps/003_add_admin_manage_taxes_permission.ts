import consola from 'consola';
import { and, eq } from 'drizzle-orm';

import type { ScriptDatabaseClient } from '../../src/db/database-client';
import * as schema from '../../src/db/schema';

export const addAdminTaxPermission = async (
  database: ScriptDatabaseClient,
  tenantId: string,
) => {
  consola.info(
    `Adding admin:tax permission to admin roles for tenant ${tenantId}`,
  );

  try {
    // Find all roles that currently have 'admin:changeSettings' permission
    const tenantRoles = await database
      .select({
        id: schema.roles.id,
        name: schema.roles.name,
        permissions: schema.roles.permissions,
      })
      .from(schema.roles)
      .where(eq(schema.roles.tenantId, tenantId));
    const adminRoles = tenantRoles.filter(({ permissions }) =>
      permissions.includes('admin:changeSettings'),
    );

    for (const role of adminRoles) {
      const currentPermissions = role.permissions;

      // Add 'admin:tax' if not already present
      if (!currentPermissions.includes('admin:tax')) {
        const updatedPermissions = currentPermissions.concat('admin:tax');

        await database
          .update(schema.roles)
          .set({ permissions: updatedPermissions })
          .where(
            and(
              eq(schema.roles.id, role.id),
              eq(schema.roles.tenantId, tenantId),
            ),
          );

        consola.info(
          `Added admin:tax permission to role ${role.name} (${role.id})`,
        );
      } else {
        consola.info(`Role ${role.name} already has admin:tax permission`);
      }
    }

    consola.success(
      `Updated ${adminRoles.length} admin roles with tax permission`,
    );
  } catch (error) {
    consola.error('Failed to add admin:tax permission:', error);
    throw error;
  }
};
