import { randEmail, randFirstName, randLastName } from '@ngneat/falso';
import { InferInsertModel, and, eq, inArray } from 'drizzle-orm';
import consola from 'consola';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { ALL_PERMISSIONS } from '../src/shared/permissions/permissions';
import { getId } from './get-id';

export const addRoles = (
  database: NodePgDatabase<typeof relations>,
  tenant: { id: string },
) => {
  return database
    .insert(schema.roles)
    .values([
      {
        description: 'Maintains section settings and member access.',
        displayInHub: true,
        sortOrder: 0,
        id: getId(),
        name: 'Admin',
        permissions: ALL_PERMISSIONS,
        tenantId: tenant.id,
      },
      {
        description: 'Coordinates events and supports organizers.',
        displayInHub: true,
        sortOrder: 1,
        id: getId(),
        name: 'Event manager',
        permissions: [
          'events:create',
          'events:editAll',
          'events:review',
          'events:organizeAll',
          'internal:manageResources',
          'events:seeDrafts',
          'templates:view',
          'internal:viewInternalPages',
        ],
        tenantId: tenant.id,
      },
      {
        description: 'Handles receipts and reimbursements.',
        displayInHub: true,
        sortOrder: 2,
        id: getId(),
        name: 'Treasurer',
        permissions: ['finance:*', 'internal:viewInternalPages'],
        tenantId: tenant.id,
      },
      {
        defaultOrganizerRole: true,
        description: 'Members of the section',
        displayInHub: false,
        sortOrder: 3,
        id: getId(),
        name: 'Section member',
        permissions: [
          'events:create',
          'templates:view',
          'internal:viewInternalPages',
        ],
        tenantId: tenant.id,
      },
      {
        defaultOrganizerRole: true,
        description: 'Trial members of the section',
        displayInHub: false,
        sortOrder: 4,
        id: getId(),
        name: 'Trial member',
        permissions: [
          'events:create',
          'templates:view',
          'internal:viewInternalPages',
        ],
        tenantId: tenant.id,
      },
      {
        description: 'Helpers of the section',
        displayInHub: true,
        sortOrder: 5,
        id: getId(),
        name: 'Helper',
        permissions: ['templates:view', 'internal:viewInternalPages'],
        tenantId: tenant.id,
      },
      {
        description: 'First-aid trained volunteers.',
        displayInHub: true,
        sortOrder: 6,
        id: getId(),
        name: 'First aid',
        permissions: [],
        tenantId: tenant.id,
      },
      {
        defaultUserRole: true,
        description: 'Default role for all users',
        id: getId(),
        name: 'Regular user',
        permissions: [],
        tenantId: tenant.id,
      },
    ])
    .returning()
    .then((rows) => {
      consola.success(`Inserted ${rows.length} roles for tenant ${tenant.id}`);
      return rows;
    });
};

export const addUsersToRoles = async (
  database: NodePgDatabase<typeof relations>,
  assignments: { roleId: string; userId: string }[],
  tenant: { id: string },
) => {
  if (assignments.length === 0) {
    consola.info('No role assignments to process');
    return;
  }
  const userIds = Array.from(new Set(assignments.map((a) => a.userId)));
  const userTenantRows = await database
    .select({
      id: schema.usersToTenants.id,
      userId: schema.usersToTenants.userId,
    })
    .from(schema.usersToTenants)
    .where(
      and(
        eq(schema.usersToTenants.tenantId, tenant.id),
        inArray(schema.usersToTenants.userId, userIds),
      ),
    );
  const userToTenantMap = new Map<string, string>();
  for (const row of userTenantRows) userToTenantMap.set(row.userId, row.id);

  const roleAssignments = assignments.map((a) => {
    const userTenantId = userToTenantMap.get(a.userId);
    if (!userTenantId) {
      throw new Error('User not found');
    }
    return {
      roleId: a.roleId,
      tenantId: tenant.id,
      userTenantId,
    } satisfies InferInsertModel<typeof schema.rolesToTenantUsers>;
  });

  await database.insert(schema.rolesToTenantUsers).values(roleAssignments);
  consola.success(`Assigned ${roleAssignments.length} role assignments`);
};

export const addExampleUsers = async (
  database: NodePgDatabase<typeof relations>,
  roles: Pick<
    typeof schema.roles.$inferSelect,
    'defaultUserRole' | 'id' | 'name'
  >[],
  tenant: { id: string },
) => {
  const usersToAdd: InferInsertModel<typeof schema.users>[] = [];
  const tenantAssignmentsToAdd: InferInsertModel<
    typeof schema.usersToTenants
  >[] = [];
  const roleAssignmentsToAdd: InferInsertModel<
    typeof schema.rolesToTenantUsers
  >[] = [];
  const defaultUserRole = roles.find((role) => role.defaultUserRole);
  if (!defaultUserRole) {
    throw new Error('Default user role not found');
  }
  const groupSizes: Record<string, number> = {
    Admin: 1,
    'Event manager': 2,
    Treasurer: 0,
    'First aid': 0,
    'Section member': 6,
    'Trial member': 2,
    Helper: 2,
  };
  for (const role of roles) {
    const memberCount = role.defaultUserRole
      ? 100
      : (groupSizes[role.name] ?? 2);
    for (let index = 0; index < memberCount; index++) {
      const user = {
        auth0Id: getId(),
        communicationEmail: randEmail(),
        email: randEmail(),
        firstName: randFirstName(),
        id: getId(),
        lastName: randLastName(),
      };
      usersToAdd.push(user);
      const userToTenant = {
        id: getId(),
        tenantId: tenant.id,
        userId: user.id,
      };
      tenantAssignmentsToAdd.push(userToTenant);
      roleAssignmentsToAdd.push({
        roleId: role.id,
        tenantId: tenant.id,
        userTenantId: userToTenant.id,
      });
      if (!role.defaultUserRole) {
        roleAssignmentsToAdd.push({
          roleId: defaultUserRole.id,
          tenantId: tenant.id,
          userTenantId: userToTenant.id,
        });
      }
    }
  }
  const sectionRole = roles.find((role) => role.name === 'Section member');
  if (sectionRole) {
    const specialistRoleIds = new Set(
      roles
        .filter((role) =>
          ['Admin', 'Event manager', 'Helper'].includes(role.name),
        )
        .map((role) => role.id),
    );
    for (const assignment of [...roleAssignmentsToAdd]) {
      if (specialistRoleIds.has(assignment.roleId))
        roleAssignmentsToAdd.push({ ...assignment, roleId: sectionRole.id });
    }
  }
  const managerRole = roles.find((role) => role.name === 'Event manager');
  const sharedMember = roleAssignmentsToAdd.find(
    (assignment) => assignment.roleId === managerRole?.id,
  );
  if (sharedMember) {
    for (const role of roles.filter((role) =>
      ['Treasurer', 'First aid'].includes(role.name),
    )) {
      roleAssignmentsToAdd.push({ ...sharedMember, roleId: role.id });
    }
  }
  await database.insert(schema.users).values(usersToAdd);
  await database.insert(schema.usersToTenants).values(tenantAssignmentsToAdd);
  await database.insert(schema.rolesToTenantUsers).values(roleAssignmentsToAdd);
  consola.success(
    `Added ${usersToAdd.length} users (${roleAssignmentsToAdd.length} role assignments)`,
  );
};
