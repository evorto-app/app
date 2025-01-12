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
        permissionAdminAnalytics: true,
        permissionAdminBilling: true,
        permissionAdminRoles: true,
        permissionAdminSettings: true,
        permissionEventCreate: true,
        permissionEventDelete: true,
        permissionEventEdit: true,
        permissionEventRegistrationManage: true,
        permissionEventView: true,
        permissionTemplateCreate: true,
        permissionTemplateDelete: true,
        permissionTemplateEdit: true,
        permissionTemplateView: true,
        permissionUserCreate: true,
        permissionUserDelete: true,
        permissionUserEdit: true,
        permissionUserView: true,
        tenantId: tenant.id,
      },
      {
        defaultOrganizerRole: true,
        description: 'Members the section',
        id: getId(),
        name: 'Section member',
        permissionEventCreate: true,
        permissionTemplateView: true,
        tenantId: tenant.id,
      },
      {
        defaultUserRole: true,
        description: 'Default role for all users',
        id: getId(),
        name: 'Regular user',
        permissionEventView: true,
        tenantId: tenant.id,
      },
    ])
    .returning();
};
