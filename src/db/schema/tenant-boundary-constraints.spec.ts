import { describe, expect, it } from '@effect/vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  eventInstances,
  eventTenantIdentityUniqueConstraintName,
} from './event-instances';
import {
  eventRegistrationOptions,
  registrationOptionEventIdentityUniqueConstraintName,
} from './event-registration-options';
import {
  eventRegistrationEventTenantForeignKeyName,
  eventRegistrationOptionEventForeignKeyName,
  eventRegistrations,
} from './event-registrations';
import { roles, roleTenantIdentityUniqueConstraintName } from './roles';
import {
  roleAssignmentMembershipTenantForeignKeyName,
  roleAssignmentRoleTenantForeignKeyName,
  rolesToTenantUsers,
  usersToTenants,
  userTenantIdentityUniqueConstraintName,
} from './users';

const expectUniqueConstraint = ({
  columns,
  name,
  table,
}: {
  columns: readonly string[];
  name: string;
  table: Parameters<typeof getTableConfig>[0];
}) => {
  const constraint = getTableConfig(table).uniqueConstraints.find(
    (candidate) => candidate.getName() === name,
  );

  expect(constraint).toBeDefined();
  expect(constraint?.columns.map((column) => column.name)).toEqual(columns);
};

describe('tenant boundary constraints', () => {
  it('requires role assignments to share one tenant with both parent rows', () => {
    expectUniqueConstraint({
      columns: ['id', 'tenantId'],
      name: roleTenantIdentityUniqueConstraintName,
      table: roles,
    });
    expectUniqueConstraint({
      columns: ['id', 'tenantId'],
      name: userTenantIdentityUniqueConstraintName,
      table: usersToTenants,
    });

    const assignmentConfig = getTableConfig(rolesToTenantUsers);
    const roleTenantForeignKey = assignmentConfig.foreignKeys.find(
      (foreignKey) =>
        foreignKey.getName() === roleAssignmentRoleTenantForeignKeyName,
    );
    const membershipTenantForeignKey = assignmentConfig.foreignKeys.find(
      (foreignKey) =>
        foreignKey.getName() === roleAssignmentMembershipTenantForeignKeyName,
    );

    expect(
      roleTenantForeignKey?.reference().columns.map((column) => column.name),
    ).toEqual(['roleId', 'tenantId']);
    expect(
      roleTenantForeignKey
        ?.reference()
        .foreignColumns.map((column) => column.name),
    ).toEqual(['id', 'tenantId']);
    expect(roleTenantForeignKey?.reference().foreignTable).toBe(roles);
    expect(
      membershipTenantForeignKey
        ?.reference()
        .columns.map((column) => column.name),
    ).toEqual(['userTenantId', 'tenantId']);
    expect(
      membershipTenantForeignKey
        ?.reference()
        .foreignColumns.map((column) => column.name),
    ).toEqual(['id', 'tenantId']);
    expect(membershipTenantForeignKey?.reference().foreignTable).toBe(
      usersToTenants,
    );

    const validAssignment = {
      roleId: 'role-1',
      tenantId: 'tenant-1',
      userTenantId: 'membership-1',
    } satisfies typeof rolesToTenantUsers.$inferInsert;
    expect(validAssignment.tenantId).toBe('tenant-1');
  });

  it('binds every registration to the tenant event and its option', () => {
    expectUniqueConstraint({
      columns: ['id', 'tenantId'],
      name: eventTenantIdentityUniqueConstraintName,
      table: eventInstances,
    });
    expectUniqueConstraint({
      columns: ['id', 'eventId'],
      name: registrationOptionEventIdentityUniqueConstraintName,
      table: eventRegistrationOptions,
    });

    const registrationConfig = getTableConfig(eventRegistrations);
    const eventTenantForeignKey = registrationConfig.foreignKeys.find(
      (foreignKey) =>
        foreignKey.getName() === eventRegistrationEventTenantForeignKeyName,
    );
    const optionEventForeignKey = registrationConfig.foreignKeys.find(
      (foreignKey) =>
        foreignKey.getName() === eventRegistrationOptionEventForeignKeyName,
    );

    expect(
      eventTenantForeignKey?.reference().columns.map((column) => column.name),
    ).toEqual(['eventId', 'tenantId']);
    expect(
      eventTenantForeignKey
        ?.reference()
        .foreignColumns.map((column) => column.name),
    ).toEqual(['id', 'tenantId']);
    expect(eventTenantForeignKey?.reference().foreignTable).toBe(
      eventInstances,
    );
    expect(
      optionEventForeignKey?.reference().columns.map((column) => column.name),
    ).toEqual(['registrationOptionId', 'eventId']);
    expect(
      optionEventForeignKey
        ?.reference()
        .foreignColumns.map((column) => column.name),
    ).toEqual(['id', 'eventId']);
    expect(optionEventForeignKey?.reference().foreignTable).toBe(
      eventRegistrationOptions,
    );
  });
});
