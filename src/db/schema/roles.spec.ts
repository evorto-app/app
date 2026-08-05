import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { roles, roleTenantNameUniqueConstraintName } from './roles';

describe('roles schema', () => {
  it('names the tenant role-name constraint for deterministic conflicts', () => {
    const constraint = getTableConfig(roles).uniqueConstraints.find(
      (candidate) => candidate.getName() === roleTenantNameUniqueConstraintName,
    );

    expect(constraint?.columns.map((column) => column.name)).toEqual([
      'tenantId',
      'name',
    ]);
  });
});
