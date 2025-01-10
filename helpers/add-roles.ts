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
        tenantId: tenant.id,
      },
      {
        defaultOrganizerRole: true,
        description: 'Members the section',
        id: getId(),
        name: 'Section member',
        tenantId: tenant.id,
      },
      {
        defaultUserRole: true,
        description: 'Default role for all users',
        id: getId(),
        name: 'Regular user',
        tenantId: tenant.id,
      },
    ])
    .returning();
};
