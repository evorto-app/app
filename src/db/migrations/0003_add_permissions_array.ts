import { sql } from 'drizzle-orm';
import { pgTable, boolean } from 'drizzle-orm/pg-core';
import { roles } from '../schema/roles';
import { ALL_PERMISSIONS } from '../../shared/permissions/permissions';

const OLD_PERMISSION_COLUMNS = [
  'permissionAdminAnalytics',
  'permissionAdminBilling',
  'permissionAdminRoles',
  'permissionAdminSettings',
  'permissionEventCreate',
  'permissionEventDelete',
  'permissionEventEdit',
  'permissionEventRegistrationManage',
  'permissionEventView',
  'permissionTemplateCreate',
  'permissionTemplateDelete',
  'permissionTemplateEdit',
  'permissionTemplateView',
  'permissionUserCreate',
  'permissionUserDelete',
  'permissionUserEdit',
  'permissionUserView',
];

export async function up(db: any) {
  // Add the new permissions column
  await db.schema.alterTable(roles).addColumn('permissions', 'jsonb', (col) => 
    col.notNull().default('[]')
  );

  // Migrate existing permissions to the new array format
  const allRoles = await db.select().from(roles);
  for (const role of allRoles) {
    const permissions = ALL_PERMISSIONS.filter(
      permission => {
        const columnName = `permission${permission.split(':')[0].charAt(0).toUpperCase() + permission.split(':')[0].slice(1)}${
          permission.split(':')[1].charAt(0).toUpperCase() + permission.split(':')[1].slice(1)
        }`;
        return role[columnName];
      }
    );

    await db
      .update(roles)
      .set({ permissions })
      .where(sql`id = ${role.id}`);
  }

  // Drop the old permission columns
  await db.schema.alterTable(roles).dropColumns(...OLD_PERMISSION_COLUMNS);
}

export async function down(db: any) {
  // Add back the old permission columns
  await db.schema.alterTable(roles).addColumns(
    ...OLD_PERMISSION_COLUMNS.map(col => ({
      name: col,
      type: 'boolean',
      notNull: true,
      default: false,
    }))
  );

  // Migrate permissions back to boolean columns
  const allRoles = await db.select().from(roles);
  for (const role of allRoles) {
    const updates = {};
    for (const permission of role.permissions) {
      const columnName = `permission${permission.split(':')[0].charAt(0).toUpperCase() + permission.split(':')[0].slice(1)}${
        permission.split(':')[1].charAt(0).toUpperCase() + permission.split(':')[1].slice(1)
      }`;
      updates[columnName] = true;
    }

    await db
      .update(roles)
      .set(updates)
      .where(sql`id = ${role.id}`);
  }

  // Drop the new permissions column
  await db.schema.alterTable(roles).dropColumn('permissions');
}
