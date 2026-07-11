import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { DrizzleQueryError, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { createNodePgPoolConfig } from '../pg-connection-config';
import { relations } from '../relations';
import {
  eventInstances,
  eventRegistrationEventTenantForeignKeyName,
  eventRegistrationOptionEventForeignKeyName,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  roleAssignmentMembershipTenantForeignKeyName,
  roleAssignmentRoleTenantForeignKeyName,
  roles,
  rolesToTenantUsers,
  tenants,
  users,
  usersToTenants,
} from './index';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}
const neonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';

interface TenantBoundaryFixture {
  categoryIds: readonly [string, string];
  eventIds: readonly [string, string];
  membershipIds: readonly [string, string];
  optionIds: readonly [string, string];
  roleIds: readonly [string, string];
  templateIds: readonly [string, string];
  tenantIds: readonly [string, string];
  userIds: readonly [string, string];
}

type TestDatabase = NodePgDatabase<typeof relations>;

const makeFixture = (): TenantBoundaryFixture => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6);
  const ids = (prefix: string): readonly [string, string] => [
    `${prefix}-a-${suffix}`,
    `${prefix}-b-${suffix}`,
  ];

  return {
    categoryIds: ids('cat'),
    eventIds: ids('event'),
    membershipIds: ids('member'),
    optionIds: ids('option'),
    roleIds: ids('role'),
    templateIds: ids('template'),
    tenantIds: ids('tenant'),
    userIds: ids('user'),
  };
};

const seedFixture = async (
  database: TestDatabase,
  fixture: TenantBoundaryFixture,
) => {
  const now = Date.now();

  await database.insert(tenants).values(
    fixture.tenantIds.map((tenantId, index) => ({
      domain: `${tenantId}.tuple-constraints.example`,
      id: tenantId,
      name: `Tuple constraints ${index + 1}`,
    })),
  );
  await database.insert(users).values(
    fixture.userIds.map((userId, index) => ({
      auth0Id: `tuple-constraints|${userId}`,
      communicationEmail: `${userId}@example.com`,
      email: `${userId}@example.com`,
      firstName: `Tenant ${index + 1}`,
      id: userId,
      lastName: 'Boundary',
    })),
  );
  await database.insert(usersToTenants).values(
    fixture.membershipIds.map((membershipId, index) => ({
      id: membershipId,
      tenantId: fixture.tenantIds[index],
      userId: fixture.userIds[index],
    })),
  );
  await database.insert(roles).values(
    fixture.roleIds.map((roleId, index) => ({
      id: roleId,
      name: `Tuple role ${index + 1}`,
      tenantId: fixture.tenantIds[index],
    })),
  );
  await database.insert(eventTemplateCategories).values(
    fixture.categoryIds.map((categoryId, index) => ({
      icon: { iconColor: 0, iconName: 'circle' },
      id: categoryId,
      tenantId: fixture.tenantIds[index],
      title: `Tuple category ${index + 1}`,
    })),
  );
  await database.insert(eventTemplates).values(
    fixture.templateIds.map((templateId, index) => ({
      categoryId: fixture.categoryIds[index],
      description: 'Tenant boundary constraint fixture',
      icon: { iconColor: 0, iconName: 'circle' },
      id: templateId,
      tenantId: fixture.tenantIds[index],
      title: `Tuple template ${index + 1}`,
    })),
  );
  await database.insert(eventInstances).values(
    fixture.eventIds.map((eventId, index) => ({
      creatorId: fixture.userIds[index],
      description: 'Tenant boundary constraint fixture',
      end: new Date(now + 2 * 24 * 60 * 60 * 1000),
      icon: { iconColor: 0, iconName: 'circle' },
      id: eventId,
      start: new Date(now + 24 * 60 * 60 * 1000),
      templateId: fixture.templateIds[index],
      tenantId: fixture.tenantIds[index],
      title: `Tuple event ${index + 1}`,
    })),
  );
  await database.insert(eventRegistrationOptions).values(
    fixture.optionIds.map((optionId, index) => ({
      closeRegistrationTime: new Date(now + 12 * 60 * 60 * 1000),
      eventId: fixture.eventIds[index],
      id: optionId,
      isPaid: false,
      openRegistrationTime: new Date(now - 60 * 60 * 1000),
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs' as const,
      spots: 10,
      title: `Tuple option ${index + 1}`,
    })),
  );
};

const cleanFixture = async (
  database: TestDatabase,
  fixture: TenantBoundaryFixture,
) => {
  await database
    .delete(eventRegistrations)
    .where(inArray(eventRegistrations.tenantId, fixture.tenantIds));
  await database
    .delete(eventRegistrationOptions)
    .where(inArray(eventRegistrationOptions.id, fixture.optionIds));
  await database
    .delete(eventInstances)
    .where(inArray(eventInstances.id, fixture.eventIds));
  await database
    .delete(eventTemplates)
    .where(inArray(eventTemplates.id, fixture.templateIds));
  await database
    .delete(eventTemplateCategories)
    .where(inArray(eventTemplateCategories.id, fixture.categoryIds));
  await database
    .delete(rolesToTenantUsers)
    .where(inArray(rolesToTenantUsers.tenantId, fixture.tenantIds));
  await database.delete(roles).where(inArray(roles.id, fixture.roleIds));
  await database
    .delete(usersToTenants)
    .where(inArray(usersToTenants.id, fixture.membershipIds));
  await database.delete(users).where(inArray(users.id, fixture.userIds));
  await database.delete(tenants).where(inArray(tenants.id, fixture.tenantIds));
};

const expectForeignKeyViolation = async (
  operation: PromiseLike<unknown>,
  constraint: string,
) => {
  try {
    await operation;
    throw new Error(`Expected foreign key constraint ${constraint} to reject`);
  } catch (error) {
    expect(error).toBeInstanceOf(DrizzleQueryError);
    if (!(error instanceof DrizzleQueryError)) {
      throw error;
    }

    const cause = error.cause;
    expect(cause).toBeInstanceOf(Error);
    expect(cause).toHaveProperty('code', '23503');
    expect(cause).toHaveProperty('constraint', constraint);
  }
};

describe('tenant boundary constraints in PostgreSQL', () => {
  let database: TestDatabase;
  const fixture = makeFixture();
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl, neonLocalProxy }));
    database = drizzle({ client: pool, relations });
    await seedFixture(database, fixture);
  });

  afterAll(async () => {
    await cleanFixture(database, fixture);
    await pool.end();
  });

  it('rejects role and membership tuples from different tenants', async () => {
    await expectForeignKeyViolation(
      database.insert(rolesToTenantUsers).values({
        roleId: fixture.roleIds[0],
        tenantId: fixture.tenantIds[0],
        userTenantId: fixture.membershipIds[1],
      }),
      roleAssignmentMembershipTenantForeignKeyName,
    );
    await expectForeignKeyViolation(
      database.insert(rolesToTenantUsers).values({
        roleId: fixture.roleIds[0],
        tenantId: fixture.tenantIds[1],
        userTenantId: fixture.membershipIds[1],
      }),
      roleAssignmentRoleTenantForeignKeyName,
    );

    await expect(
      database.insert(rolesToTenantUsers).values({
        roleId: fixture.roleIds[0],
        tenantId: fixture.tenantIds[0],
        userTenantId: fixture.membershipIds[0],
      }),
    ).resolves.toBeDefined();
  });

  it('rejects registrations with a foreign tenant or event option', async () => {
    await expectForeignKeyViolation(
      database.insert(eventRegistrations).values({
        eventId: fixture.eventIds[0],
        id: `reg-tenant-${fixture.tenantIds[0].slice(-6)}`,
        registrationOptionId: fixture.optionIds[0],
        status: 'PENDING',
        tenantId: fixture.tenantIds[1],
        userId: fixture.userIds[1],
      }),
      eventRegistrationEventTenantForeignKeyName,
    );
    await expectForeignKeyViolation(
      database.insert(eventRegistrations).values({
        eventId: fixture.eventIds[0],
        id: `reg-option-${fixture.tenantIds[0].slice(-6)}`,
        registrationOptionId: fixture.optionIds[1],
        status: 'PENDING',
        tenantId: fixture.tenantIds[0],
        userId: fixture.userIds[0],
      }),
      eventRegistrationOptionEventForeignKeyName,
    );

    await expect(
      database.insert(eventRegistrations).values({
        eventId: fixture.eventIds[0],
        id: `reg-valid-${fixture.tenantIds[0].slice(-6)}`,
        registrationOptionId: fixture.optionIds[0],
        status: 'PENDING',
        tenantId: fixture.tenantIds[0],
        userId: fixture.userIds[0],
      }),
    ).resolves.toBeDefined();
  });
});
