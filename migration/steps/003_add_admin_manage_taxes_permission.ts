import consola from 'consola';
import { and, eq, sql } from 'drizzle-orm';

import { database } from '../../src/db';
import * as schema from '../../src/db/schema';

export const addAdminManageTaxesPermission = async (tenantId: string) => {
  consola.info(`Adding admin:manageTaxes permission to admin roles for tenant ${tenantId}`);
  
  try {
    // Find all roles that currently have 'admin:changeSettings' permission
    const adminRoles = await database.query.roles.findMany({
      where: and(
        eq(schema.roles.tenantId, tenantId),
        sql`permissions @> '["admin:changeSettings"]'`
      ),
    });

    for (const role of adminRoles) {
      const currentPermissions = role.permissions || [];
      
      // Add 'admin:manageTaxes' if not already present
      if (!currentPermissions.includes('admin:manageTaxes')) {
        const updatedPermissions = [...currentPermissions, 'admin:manageTaxes'];
        
        await database
          .update(schema.roles)
          .set({ permissions: updatedPermissions })
          .where(eq(schema.roles.id, role.id));

        consola.info(`Added admin:manageTaxes permission to role ${role.name} (${role.id})`);
      } else {
        consola.info(`Role ${role.name} already has admin:manageTaxes permission`);
      }
    }

    consola.success(`Updated ${adminRoles.length} admin roles with manageTaxes permission`);
  } catch (error) {
    consola.error('Failed to add admin:manageTaxes permission:', error);
    throw error;
  }
};