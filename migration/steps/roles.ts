import consola from 'consola';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

import type { ScriptDatabaseClient } from '../../src/db/database-client';
import * as schema from '../../src/db/schema';
import { ALL_PERMISSIONS } from '../../src/shared/permissions/permissions';

export const canonicalMigrationRoleDefinitions = (
  tenantId: string,
): InferInsertModel<typeof schema.roles>[] => [
  {
    collapseMembersInHup: true,
    defaultOrganizerRole: false,
    defaultUserRole: false,
    description: 'Full app admins',
    displayInHub: true,
    name: 'Admin',
    permissions: [...ALL_PERMISSIONS],
    sortOrder: 2_147_483_647,
    tenantId,
  },
  {
    collapseMembersInHup: true,
    defaultOrganizerRole: true,
    defaultUserRole: false,
    description: 'Members of the section',
    displayInHub: false,
    name: 'Section member',
    permissions: [
      'events:create',
      'events:viewPublic',
      'templates:view',
      'internal:viewInternalPages',
    ],
    sortOrder: 2_147_483_647,
    tenantId,
  },
  {
    collapseMembersInHup: true,
    defaultOrganizerRole: true,
    defaultUserRole: false,
    description: 'Trial members of the section',
    displayInHub: false,
    name: 'Trial member',
    permissions: [
      'events:create',
      'events:viewPublic',
      'templates:view',
      'internal:viewInternalPages',
    ],
    sortOrder: 2_147_483_647,
    tenantId,
  },
  {
    collapseMembersInHup: true,
    defaultOrganizerRole: false,
    defaultUserRole: false,
    description: 'Helpers of the section',
    displayInHub: false,
    name: 'Helper',
    permissions: ['events:viewPublic'],
    sortOrder: 2_147_483_647,
    tenantId,
  },
  {
    collapseMembersInHup: true,
    defaultOrganizerRole: false,
    defaultUserRole: false,
    description: 'Sponsors of the section',
    displayInHub: false,
    name: 'Sponsor',
    permissions: [
      'events:create',
      'events:viewPublic',
      'templates:view',
      'internal:viewInternalPages',
    ],
    sortOrder: 2_147_483_647,
    tenantId,
  },
  {
    collapseMembersInHup: true,
    defaultOrganizerRole: false,
    defaultUserRole: false,
    description: 'Alumni of the section',
    displayInHub: false,
    name: 'Alumni',
    permissions: [
      'events:create',
      'events:viewPublic',
      'templates:view',
      'internal:viewInternalPages',
    ],
    sortOrder: 2_147_483_647,
    tenantId,
  },
  {
    collapseMembersInHup: true,
    defaultOrganizerRole: false,
    defaultUserRole: false,
    description: 'Selected membership applicants',
    displayInHub: false,
    name: 'Selected applicant',
    permissions: ['events:viewPublic'],
    sortOrder: 2_147_483_647,
    tenantId,
  },
  {
    collapseMembersInHup: true,
    defaultOrganizerRole: false,
    defaultUserRole: false,
    description: 'Blacklisted users',
    displayInHub: false,
    name: 'Blacklisted',
    permissions: ['events:viewPublic'],
    sortOrder: 2_147_483_647,
    tenantId,
  },
  {
    collapseMembersInHup: true,
    defaultOrganizerRole: false,
    defaultUserRole: true,
    description: 'Default role for all users',
    displayInHub: false,
    name: 'Regular user',
    permissions: ['events:viewPublic'],
    sortOrder: 2_147_483_647,
    tenantId,
  },
];

export const setupDefaultRoles = async (
  database: ScriptDatabaseClient,
  tenant: InferSelectModel<typeof schema.tenants>,
) => {
  consola.info('Setting up default roles');
  return database.transaction(async (transaction) => {
    const roleIdByName = new Map<string, string>();
    for (const definition of canonicalMigrationRoleDefinitions(tenant.id)) {
      const migratedRoles = await transaction
        .insert(schema.roles)
        .values(definition)
        .onConflictDoUpdate({
          set: {
            collapseMembersInHup: definition.collapseMembersInHup,
            defaultOrganizerRole: definition.defaultOrganizerRole,
            defaultUserRole: definition.defaultUserRole,
            description: definition.description,
            displayInHub: definition.displayInHub,
            permissions: definition.permissions,
            sortOrder: definition.sortOrder,
          },
          target: [schema.roles.tenantId, schema.roles.name],
        })
        .returning({ id: schema.roles.id, name: schema.roles.name });
      const migratedRole = migratedRoles[0];
      if (!migratedRole) {
        throw new Error(`Canonical role ${definition.name} was not migrated.`);
      }
      roleIdByName.set(migratedRole.name, migratedRole.id);
    }

    const requiredRoleId = (name: string): string => {
      const roleId = roleIdByName.get(name);
      if (!roleId) throw new Error(`Canonical role ${name} is missing.`);
      return roleId;
    };
    return new Map<string, string>([
      ['ADMIN', requiredRoleId('Admin')],
      ['FULL', requiredRoleId('Section member')],
      ['TRIAL', requiredRoleId('Trial member')],
      ['HELPER', requiredRoleId('Helper')],
      ['SPONSOR', requiredRoleId('Sponsor')],
      ['ALUMNI', requiredRoleId('Alumni')],
      ['SELECTED', requiredRoleId('Selected applicant')],
      ['BLACKLISTED', requiredRoleId('Blacklisted')],
      ['NONE', requiredRoleId('Regular user')],
    ]);
  });
};

export interface LegacyPositionRoleDefinition {
  readonly name: string;
  readonly sortOrder: number;
}

export const legacyPositionRoleDescription = 'Imported legacy board position';

export const collectMigrationOwnedRoleIds = (
  canonicalRoleIds: Iterable<string>,
  tenantRoles: readonly {
    readonly description: null | string;
    readonly id: string;
    readonly name: string;
  }[],
): Set<string> => {
  const roleIds = new Set(canonicalRoleIds);
  for (const role of tenantRoles) {
    if (
      role.description === legacyPositionRoleDescription &&
      role.name.startsWith('Position: ')
    ) {
      roleIds.add(role.id);
    }
  }
  return roleIds;
};

export const legacyPositionRoleDefinition = (
  position: string,
): LegacyPositionRoleDefinition => {
  const numberMatch = position.match(/^(\d+)(.*)$/);
  const parsedSortOrder = numberMatch
    ? Number.parseInt(numberMatch[1], 10)
    : 2_147_483_647;
  const cleanName = (numberMatch ? numberMatch[2] : position)
    .replace(/^[\s\-.]+/, '')
    .trim();
  if (!cleanName) {
    throw new Error(
      `Legacy position ${JSON.stringify(position)} has no role name after normalization.`,
    );
  }
  if (
    !Number.isSafeInteger(parsedSortOrder) ||
    parsedSortOrder > 2_147_483_647
  ) {
    throw new Error(
      `Legacy position ${JSON.stringify(position)} has an invalid sort order.`,
    );
  }
  return {
    name: `Position: ${cleanName}`,
    sortOrder: parsedSortOrder,
  };
};

export const maybeAddPositionRole = async (
  database: ScriptDatabaseClient,
  position: string,
  tenant: InferSelectModel<typeof schema.tenants>,
) => {
  const definition = legacyPositionRoleDefinition(position);

  return database.transaction(async (tx) => {
    const result = await tx
      .insert(schema.roles)
      .values({
        collapseMembersInHup: false,
        defaultOrganizerRole: false,
        defaultUserRole: false,
        description: legacyPositionRoleDescription,
        displayInHub: true,
        name: definition.name,
        permissions: [],
        sortOrder: definition.sortOrder,
        tenantId: tenant.id,
      })
      .onConflictDoUpdate({
        set: {
          collapseMembersInHup: false,
          defaultOrganizerRole: false,
          defaultUserRole: false,
          description: legacyPositionRoleDescription,
          displayInHub: true,
          permissions: [],
          sortOrder: definition.sortOrder,
        },
        target: [schema.roles.name, schema.roles.tenantId],
      })
      .returning({ id: schema.roles.id });

    return result[0].id;
  });
};
