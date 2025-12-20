import { randEmail, randFirstName, randLastName } from '@ngneat/falso';
import { InferInsertModel, and, eq, inArray } from 'drizzle-orm';
import consola from 'consola';
import { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { ALL_PERMISSIONS } from '../src/shared/permissions/permissions';
import { getId } from './get-id';

export const addRoles = (
  database: NeonDatabase<Record<string, never>, typeof relations>,
  tenant: { id: string },
) => {
  return database
    .insert(schema.roles)
    .values([
      {
        description: 'Full app admins',
        id: getId(),
        name: 'Admin',
        permissions: ALL_PERMISSIONS,
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
        defaultOrganizerRole: true,
        description: 'Trial members of the section',
        id: getId(),
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
        id: getId(),
        name: 'Helper',
        permissions: ['events:viewPublic', 'templates:view', 'internal:viewInternalPages'],
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
    .returning()
    .then((rows) => {
      consola.success(`Inserted ${rows.length} roles for tenant ${tenant.id}`);
      return rows;
    });
};

export const addUsersToRoles = async (
  database: NeonDatabase<Record<string, never>, typeof relations>,
  assignments: { roleId: string; userId: string }[],
  tenant: { id: string },
) => {
  if (assignments.length === 0) {
    consola.info('No role assignments to process');
    return;
  }
  const userIds = Array.from(new Set(assignments.map((a) => a.userId)));
  const userTenantRows = await database
    .select({ id: schema.usersToTenants.id, userId: schema.usersToTenants.userId })
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
    return { roleId: a.roleId, userTenantId } as InferInsertModel<typeof schema.rolesToTenantUsers>;
  });

  await database.insert(schema.rolesToTenantUsers).values(roleAssignments);
  consola.success(`Assigned ${roleAssignments.length} role assignments`);
};

export const addExampleUsers = async (
  database: NeonDatabase<Record<string, never>, typeof relations>,
  roles: { defaultUserRole: boolean; id: string }[],
  tenant: { id: string },
) => {
  const usersToAdd: InferInsertModel<typeof schema.users>[] = [];
  const tenantAssignmentsToAdd: InferInsertModel<typeof schema.usersToTenants>[] = [];
  const roleAssignmentsToAdd: InferInsertModel<typeof schema.rolesToTenantUsers>[] = [];
  const defaultUserRole = roles.find((role) => role.defaultUserRole);
  if (!defaultUserRole) {
    throw new Error('Default user role not found');
  }
  for (const role of roles) {
    for (let index = 0; index < (role.defaultUserRole ? 100 : 20); index++) {
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
        userTenantId: userToTenant.id,
      });
      if (!role.defaultUserRole) {
        roleAssignmentsToAdd.push({
          roleId: defaultUserRole.id,
          userTenantId: userToTenant.id,
        });
      }
    }
  }
  await database.insert(schema.users).values(usersToAdd);
  await database.insert(schema.usersToTenants).values(tenantAssignmentsToAdd);
  await database.insert(schema.rolesToTenantUsers).values(roleAssignmentsToAdd);
  consola.success(
    `Added ${usersToAdd.length} users (${roleAssignmentsToAdd.length} role assignments)`,
  );
};
