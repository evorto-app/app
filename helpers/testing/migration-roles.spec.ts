import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  canonicalMigrationRoleDefinitions,
  collectMigrationOwnedRoleIds,
  legacyPositionRoleDescription,
  legacyPositionRoleDefinition,
} from '../../migration/steps/roles';
import { ALL_PERMISSIONS } from '../../src/shared/permissions/permissions';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

describe('canonical migration roles', () => {
  it('defines one current-schema role for every supported legacy status', () => {
    const roles = canonicalMigrationRoleDefinitions('tenant-1');

    expect(roles.map(({ name }) => name)).toEqual([
      'Admin',
      'Section member',
      'Trial member',
      'Helper',
      'Sponsor',
      'Alumni',
      'Selected applicant',
      'Blacklisted',
      'Regular user',
    ]);
    expect(new Set(roles.map(({ name }) => name)).size).toBe(roles.length);
    expect(roles.every(({ tenantId }) => tenantId === 'tenant-1')).toBe(true);
  });

  it('keeps every legacy membership status in a distinct role', () => {
    const roles = canonicalMigrationRoleDefinitions('tenant-1');
    const roleByName = new Map(roles.map((role) => [role.name, role]));

    expect(roleByName.get('Helper')?.permissions).toEqual([
      'events:viewPublic',
    ]);
    expect(roleByName.get('Sponsor')?.permissions).toContain(
      'internal:viewInternalPages',
    );
    expect(roleByName.get('Selected applicant')?.permissions).toEqual([
      'events:viewPublic',
    ]);
  });

  it('grants the canonical full permission set only to the admin role', () => {
    const roles = canonicalMigrationRoleDefinitions('tenant-1');
    const admin = roles.find(({ name }) => name === 'Admin');

    expect(admin?.permissions).toEqual(ALL_PERMISSIONS);
    expect(admin?.permissions).not.toContain('admin:manageTaxes');
  });
});

describe('legacy position roles', () => {
  it('namespaces positions so they cannot collide with canonical roles', () => {
    expect(legacyPositionRoleDefinition('Admin')).toEqual({
      name: 'Position: Admin',
      sortOrder: 2_147_483_647,
    });
    expect(legacyPositionRoleDefinition('01 - President')).toEqual({
      name: 'Position: President',
      sortOrder: 1,
    });
  });

  it('blocks empty and out-of-range position definitions', () => {
    expect(() => legacyPositionRoleDefinition('  ')).toThrow(
      'has no role name',
    );
    expect(() =>
      legacyPositionRoleDefinition('999999999999999999999 President'),
    ).toThrow('invalid sort order');
  });

  it('scopes replacement to canonical and importer-created position roles', () => {
    const roleIds = collectMigrationOwnedRoleIds(
      ['canonical-role'],
      [
        {
          description: legacyPositionRoleDescription,
          id: 'imported-position-role',
          name: 'Position: President',
        },
        {
          description: 'Created in the target application',
          id: 'target-custom-role',
          name: 'Custom coordinator',
        },
        {
          description: 'Created in the target application',
          id: 'target-position-role',
          name: 'Position: Treasurer',
        },
      ],
    );

    expect([...roleIds]).toEqual(['canonical-role', 'imported-position-role']);
  });

  it('uses the migration-owned role scope when replacing assignment links', () => {
    const assignmentStep = readFileSync(
      path.join(repositoryRoot, 'migration/steps/user-assignments.ts'),
      'utf8',
    );

    expect(assignmentStep).toContain('collectMigrationOwnedRoleIds(');
    expect(assignmentStep).toMatch(
      /inArray\(schema\.rolesToTenantUsers\.roleId, \[\s*\.\.\.migrationOwnedRoleIds,?\s*\]\)/u,
    );
  });
});
