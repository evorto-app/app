import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { and, eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';

type TestDatabase = NodePgDatabase<typeof relations>;

export interface UserRoleAssignmentScenario {
  cleanup: () => Promise<void>;
  readAssignedRoleIds: () => Promise<string[]>;
  role: {
    id: string;
    name: string;
  };
  user: {
    email: string;
    firstName: string;
    id: string;
    lastName: string;
  };
  userTenantId: string;
}

export interface MembersHubTenantScopeDecoy {
  cleanup: () => Promise<void>;
  memberDisplayName: string;
}

export const seedMembersHubTenantScopeDecoy = async ({
  database,
  roleName,
}: {
  database: TestDatabase;
  roleName: string;
}): Promise<MembersHubTenantScopeDecoy> => {
  const tenantId = getId();
  const roleId = getId();
  const userId = getId();
  const userTenantId = getId();
  const member = {
    email: `neighbor-hub-${userId}@evorto.test`,
    firstName: 'Neighbor',
    lastName: 'Tenant member',
  };

  await database.transaction(async (transaction) => {
    await transaction.insert(schema.tenants).values({
      domain: `neighbor-hub-${tenantId}`,
      id: tenantId,
      name: 'Neighboring Members Hub tenant',
    });
    await transaction.insert(schema.users).values({
      auth0Id: `neighbor-hub|${userId}`,
      communicationEmail: member.email,
      email: member.email,
      firstName: member.firstName,
      id: userId,
      lastName: member.lastName,
    });
    await transaction.insert(schema.usersToTenants).values({
      id: userTenantId,
      tenantId,
      userId,
    });
    await transaction.insert(schema.roles).values({
      description: 'This same-named role belongs to another tenant',
      displayInHub: true,
      id: roleId,
      name: roleName,
      permissions: [],
      tenantId,
    });
    await transaction.insert(schema.rolesToTenantUsers).values({
      roleId,
      tenantId,
      userTenantId,
    });
  });

  const cleanup = async (): Promise<void> => {
    await database.transaction(async (transaction) => {
      await transaction
        .delete(schema.rolesToTenantUsers)
        .where(
          and(
            eq(schema.rolesToTenantUsers.roleId, roleId),
            eq(schema.rolesToTenantUsers.userTenantId, userTenantId),
          ),
        );
      await transaction
        .delete(schema.roles)
        .where(
          and(eq(schema.roles.id, roleId), eq(schema.roles.tenantId, tenantId)),
        );
      await transaction
        .delete(schema.usersToTenants)
        .where(eq(schema.usersToTenants.id, userTenantId));
      await transaction.delete(schema.users).where(eq(schema.users.id, userId));
      await transaction
        .delete(schema.tenants)
        .where(eq(schema.tenants.id, tenantId));
    });
  };

  return {
    cleanup,
    memberDisplayName: `${member.firstName} ${member.lastName}`,
  };
};

export const seedUserRoleAssignmentScenario = async ({
  database,
  initiallyAssigned = false,
  roleName,
  tenant,
  userEmail,
}: {
  database: TestDatabase;
  initiallyAssigned?: boolean;
  roleName: string;
  tenant: { id: string };
  userEmail: string;
}): Promise<UserRoleAssignmentScenario> => {
  const roleId = getId();
  const userId = getId();
  const userTenantId = getId();
  const user = {
    email: userEmail,
    firstName: 'Casey',
    id: userId,
    lastName: 'Member',
  };

  await database.transaction(async (transaction) => {
    await transaction.insert(schema.users).values({
      auth0Id: `role-assignment|${userId}`,
      communicationEmail: user.email,
      email: user.email,
      firstName: user.firstName,
      id: user.id,
      lastName: user.lastName,
    });
    await transaction.insert(schema.usersToTenants).values({
      id: userTenantId,
      tenantId: tenant.id,
      userId: user.id,
    });
    await transaction.insert(schema.roles).values({
      description: 'Temporary role used to verify existing-user assignment',
      id: roleId,
      name: roleName,
      permissions: [],
      tenantId: tenant.id,
    });
    if (initiallyAssigned) {
      await transaction.insert(schema.rolesToTenantUsers).values({
        roleId,
        tenantId: tenant.id,
        userTenantId,
      });
    }
  });

  const readAssignedRoleIds = async (): Promise<string[]> => {
    const assignments = await database
      .select({ roleId: schema.rolesToTenantUsers.roleId })
      .from(schema.rolesToTenantUsers)
      .where(eq(schema.rolesToTenantUsers.userTenantId, userTenantId));
    return assignments.map((assignment) => assignment.roleId).sort();
  };

  const cleanup = async (): Promise<void> => {
    await database.transaction(async (transaction) => {
      await transaction
        .delete(schema.rolesToTenantUsers)
        .where(eq(schema.rolesToTenantUsers.userTenantId, userTenantId));
      await transaction
        .delete(schema.roles)
        .where(
          and(
            eq(schema.roles.id, roleId),
            eq(schema.roles.tenantId, tenant.id),
          ),
        );
      await transaction
        .delete(schema.usersToTenants)
        .where(eq(schema.usersToTenants.id, userTenantId));
      await transaction
        .delete(schema.users)
        .where(eq(schema.users.id, user.id));
    });
  };

  return {
    cleanup,
    readAssignedRoleIds,
    role: { id: roleId, name: roleName },
    user,
    userTenantId,
  };
};
