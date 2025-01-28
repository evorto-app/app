import { and, eq } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';

import * as schema from '../src/db/schema';
import { getId } from './get-id';

export const addRoles = (
  database: NeonHttpDatabase<typeof schema>,
  tenant: { id: string },
) => {
  return database
    .insert(schema.roles)
    .values([
      {
        description: 'Full app admins',
        id: getId(),
        name: 'Admin',
        permissions: [
          'admin:manageRoles',
          'admin:settings',
          'events:create',
          'events:viewDrafts',
          'events:viewPublic',
          'events:manageAll',
          'events:changePublication',
          'templates:create',
          'templates:delete',
          'templates:editAll',
          'templates:view',
          'templates:manageCategories',
          'users:viewAll',
          'users:assignRoles',
          'internal:viewInternalPages',
        ],
        tenantId: tenant.id,
      },
      {
        defaultOrganizerRole: true,
        description: 'Members of the section',
        id: getId(),
        name: 'Section member',
        permissions: [
          'events:create',
          'events:viewPublic',
          'templates:view',
          'internal:viewInternalPages',
        ],
        tenantId: tenant.id,
      },
      {
        defaultUserRole: true,
        description: 'Default role for all users',
        id: getId(),
        name: 'Regular user',
        permissions: ['events:viewPublic'],
        tenantId: tenant.id,
      },
    ])
    .returning();
};

export const addUsersToRoles = async (
  database: NeonHttpDatabase<typeof schema>,
  assignments: { roleId: string; userId: string }[],
  tenant: { id: string },
) => {
  for (const assignment of assignments) {
    const userToTenant = await database.query.usersToTenants.findFirst({
      where: and(
        eq(schema.usersToTenants.userId, assignment.userId),
        eq(schema.usersToTenants.tenantId, tenant.id),
      ),
    });
    if (!userToTenant) {
      throw new Error('User not found');
    }

    await database.insert(schema.rolesToTenantUsers).values({
      roleId: assignment.roleId,
      userTenantId: userToTenant.id,
    });
  }
};
