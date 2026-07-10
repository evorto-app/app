import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Source guard: the relaunch user-list owns tenant-scoped role assignment for
// existing users, so review-only copy should not reappear.
const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (sourcePath: string): string =>
  readFileSync(path.join(repositoryRoot, sourcePath), 'utf8');

describe('tenant user role assignment source', () => {
  it('keeps the user-list table scoped to review columns', () => {
    const source = readSource('src/app/admin/user-list/user-list.component.ts');

    expect(source).toContain("'name'");
    expect(source).toContain("'email'");
    expect(source).toContain("'role'");
    expect(source).not.toContain("'select'");
    expect(source).not.toContain("'actions'");
  });

  it('keeps existing-user role assignment visible in the UI', () => {
    const template = readSource(
      'src/app/admin/user-list/user-list.component.html',
    );

    expect(template).toContain(
      'Manage tenant role assignments for existing users.',
    );
    expect(template).toContain('mat-select');
    expect(template).toContain('Assigned roles');
    expect(template).toContain('Search users');
    expect(template).not.toContain('This page is read-only');
    expect(template).not.toContain('Edit user');
    expect(template).not.toContain('mat-checkbox');
  });

  it('warns that unrestricted role assignment is tenant-admin authority', () => {
    const roleForm = readSource(
      'src/app/admin/components/role-form/role-form.component.html',
    );

    expect(roleForm).toContain('Full tenant-administrator authority.');
    expect(roleForm).toContain('form.permissions["users:assignRoles"]');
    expect(roleForm).toContain('including to themselves');
  });

  it('keeps user-list role names tenant-scoped in the read-only RPC', () => {
    const source = readSource(
      'src/server/effect/rpc/handlers/users.handlers.ts',
    );

    expect(source).toContain('eq(rolesToTenantUsers.roleId, roles.id)');
    expect(source).toContain('eq(roles.tenantId, tenant.id)');
  });

  it('keeps generated roles docs aligned with the role-assignment relaunch surface', () => {
    const source = readSource('tests/docs/roles/roles.doc.ts');

    expect(source).toContain(
      'The **All users** page supports searching tenant users by name or email',
    );
    expect(source).toContain(
      'exposes tenant-scoped role assignment controls for existing users',
    );
    expect(source).toContain(
      'Assigning roles to existing users happens from the **All users** page and is guarded by **users:assignRoles**.',
    );
    expect(source).toContain('full tenant-administrator authority');
    expect(source).not.toContain('existing-user role assignment is deferred');
    expect(source).not.toContain('Edit user roles');
  });
});
