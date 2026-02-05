import { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { createId } from '../db/create-id';
import { relations } from '../db/relations';
import * as schema from '../db/schema';
import { ALL_PERMISSIONS } from '../shared/permissions/permissions';

export type Database = NeonDatabase<Record<string, never>, typeof relations>;

export async function addRoles(
  database: Database,
  tenant: { id: string },
) {
  return database
    .insert(schema.roles)
    .values([
      {
        description: 'Full app admins',
        id: createId(),
        name: 'Admin',
        permissions: ALL_PERMISSIONS,
        tenantId: tenant.id,
      },
      {
        defaultOrganizerRole: true,
        description: 'Members of the section',
        id: createId(),
        name: 'Section member',
        permissions: [
          'events:create',
          'events:edit',
          'events:seeDrafts',
          'events:viewPublic',
          'templates:view',
          'internal:viewInternalPages',
        ],
        tenantId: tenant.id,
      },
      {
        defaultOrganizerRole: true,
        description: 'Trial members of the section',
        id: createId(),
        name: 'Trial member',
        permissions: [
          'events:create',
          'events:viewPublic',
          'templates:view',
          'internal:viewInternalPages',
        ],
        tenantId: tenant.id,
      },
      {
        description: 'Helpers of the section',
        id: createId(),
        name: 'Helper',
        permissions: [
          'events:viewPublic',
          'templates:view',
          'internal:viewInternalPages',
        ],
        tenantId: tenant.id,
      },
      {
        defaultUserRole: true,
        description: 'Default role for all users',
        id: createId(),
        name: 'Regular user',
        permissions: ['events:viewPublic'],
        tenantId: tenant.id,
      },
    ])
    .returning();
}
