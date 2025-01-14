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
          'admin:analytics',
          'admin:billing',
          'admin:roles',
          'admin:settings',
          'events:create',
          'events:delete',
          'events:edit',
          'events:registration',
          'events:view',
          'templates:create',
          'templates:delete',
          'templates:edit',
          'templates:view',
          'users:create',
          'users:delete',
          'users:edit',
          'users:view',
        ],
        tenantId: tenant.id,
      },
      {
        defaultOrganizerRole: true,
        description: 'Members of the section',
        id: getId(),
        name: 'Section member',
        permissions: ['events:create', 'templates:view'],
        tenantId: tenant.id,
      },
      {
        defaultUserRole: true,
        description: 'Default role for all users',
        id: getId(),
        name: 'Regular user',
        permissions: ['events:view'],
        tenantId: tenant.id,
      },
    ])
    .returning();
};
