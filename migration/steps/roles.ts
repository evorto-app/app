import consola from 'consola';
import { InferSelectModel } from 'drizzle-orm';

import { database } from '../../src/db';
import * as schema from '../../src/db/schema';

export const setupDefaultRoles = async (
  tenant: InferSelectModel<typeof schema.tenants>,
) => {
  consola.info('Setting up default roles');
  const newRoles = await database
    .insert(schema.roles)
    .values([
      {
        description: 'Full app admins',
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
        defaultOrganizerRole: true,
        description: 'Trial members of the section',
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
        name: 'Regular user',
        permissions: ['events:viewPublic'],
        tenantId: tenant.id,
      },
    ])
    .returning();
  const roleMap = new Map<string, string>();
  roleMap.set('ADMIN', newRoles[0].id);
  roleMap.set('FULL', newRoles[1].id);
  roleMap.set('TRIAL', newRoles[2].id);
  roleMap.set('HELPER', newRoles[3].id);
  roleMap.set('NONE', newRoles[4].id);
  return roleMap;
};
