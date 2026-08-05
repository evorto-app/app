import { describe, expect, it } from '@effect/vitest';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Cause, Effect } from 'effect';
import { SqlError, UniqueViolation } from 'effect/unstable/sql/SqlError';

import { roleTenantNameUniqueConstraintName } from '../../db/schema';
import { normalizeRoleWrite, roleNameConflictFromDatabase } from './role-write';

const roleInput = {
  defaultOrganizerRole: false,
  defaultUserRole: true,
  description: '  Default tenant member  ',
  displayInHub: true,
  name: '  Member  ',
  permissions: ['users:viewAll', 'admin:manageRoles', 'users:viewAll'] as const,
};

const uniqueViolation = (constraint: string) =>
  new SqlError({
    reason: new UniqueViolation({
      cause: { code: '23505' },
      constraint,
      message: 'duplicate key value violates unique constraint',
      operation: 'INSERT',
    }),
  });

describe('role write normalization', () => {
  it.effect('normalizes both role-write paths to one persisted shape', () =>
    Effect.gen(function* () {
      const normalized = yield* normalizeRoleWrite(roleInput);

      expect(normalized).toEqual({
        defaultOrganizerRole: false,
        defaultUserRole: true,
        description: 'Default tenant member',
        displayInHub: true,
        name: 'Member',
        permissions: ['admin:manageRoles', 'users:viewAll'],
      });
    }),
  );

  it.effect('returns field-specific validation errors', () =>
    Effect.gen(function* () {
      const missingName = yield* normalizeRoleWrite({
        ...roleInput,
        name: ' '.repeat(3),
      }).pipe(Effect.flip);
      expect(missingName).toMatchObject({
        _tag: 'RoleWriteValidationError',
        field: 'name',
        message: 'Role name is required',
      });

      const longDescription = yield* normalizeRoleWrite({
        ...roleInput,
        description: 'x'.repeat(501),
      }).pipe(Effect.flip);
      expect(longDescription).toMatchObject({
        _tag: 'RoleWriteValidationError',
        field: 'description',
      });

      const platformPermission = yield* normalizeRoleWrite({
        ...roleInput,
        permissions: ['globalAdmin:*'],
      }).pipe(Effect.flip);
      expect(platformPermission).toMatchObject({
        _tag: 'RoleWriteValidationError',
        field: 'permissions',
      });
    }),
  );
});

describe('role-name conflict mapping', () => {
  it('maps only the named tenant role-name constraint', () => {
    expect(
      roleNameConflictFromDatabase(
        uniqueViolation(roleTenantNameUniqueConstraintName),
        'Member',
      ),
    ).toMatchObject({
      _tag: 'RoleNameAlreadyExistsError',
      name: 'Member',
    });
    expect(
      roleNameConflictFromDatabase(
        uniqueViolation('another_unique_constraint'),
        'Member',
      ),
    ).toBeUndefined();
  });

  it('recognizes a Drizzle-wrapped SQL conflict', () => {
    const wrapped = new EffectDrizzleQueryError({
      cause: Cause.fail(uniqueViolation(roleTenantNameUniqueConstraintName)),
      params: [],
      query: 'INSERT INTO roles ...',
    });

    expect(roleNameConflictFromDatabase(wrapped, 'Member')).toMatchObject({
      _tag: 'RoleNameAlreadyExistsError',
      name: 'Member',
    });
  });
});
