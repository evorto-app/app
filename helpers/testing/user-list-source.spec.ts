import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (path: string): string =>
  readFileSync(join(repositoryRoot, path), 'utf8');

describe('read-only tenant user list source', () => {
  it('keeps the user-list table scoped to review columns', () => {
    const source = readSource('src/app/admin/user-list/user-list.component.ts');

    expect(source).toContain("'name'");
    expect(source).toContain("'email'");
    expect(source).toContain("'role'");
    expect(source).not.toContain("'select'");
    expect(source).not.toContain("'actions'");
  });

  it('keeps existing-user role assignment visibly deferred in the UI', () => {
    const template = readSource(
      'src/app/admin/user-list/user-list.component.html',
    );

    expect(template).toContain(
      'Existing-user role assignment is deferred for relaunch.',
    );
    expect(template).toContain('This page is read-only');
    expect(template).toContain('Search users');
    expect(template).not.toContain('Assign role');
    expect(template).not.toContain('Edit user');
    expect(template).not.toContain('mat-checkbox');
  });

  it('keeps user-list role names tenant-scoped in the read-only RPC', () => {
    const source = readSource(
      'src/server/effect/rpc/handlers/users.handlers.ts',
    );

    expect(source).toContain('eq(rolesToTenantUsers.roleId, roles.id)');
    expect(source).toContain('eq(roles.tenantId, tenant.id)');
  });

  it('keeps generated roles docs aligned with the read-only relaunch surface', () => {
    const source = readSource('tests/docs/roles/roles.doc.ts');

    expect(source).toContain(
      'The **All users** page is read-only in the relaunch surface.',
    );
    expect(source).toContain(
      'The **users:assignRoles** permission remains reserved for the production migration path and future role-assignment workflows.',
    );
    expect(source).toContain(
      'Assigning roles to existing users is explicitly deferred for relaunch.',
    );
    expect(source).not.toContain('Assign role to user');
    expect(source).not.toContain('Edit user roles');
  });
});
