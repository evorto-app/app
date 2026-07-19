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
    const normalizedTemplate = template.replaceAll(/\s+/gu, ' ');

    expect(normalizedTemplate).toContain(
      'Manage role assignments for existing members.',
    );
    expect(normalizedTemplate).toContain(
      'Role changes apply only to this organization.',
    );
    expect(template).toContain('mat-select');
    expect(template).toContain('Assigned roles');
    expect(template).toContain('Search users');
    expect(template).not.toContain('This page is read-only');
    expect(template).not.toContain('Edit user');
    expect(template).not.toContain('mat-checkbox');
  });

  it('warns that unrestricted role assignment is organization-admin authority', () => {
    const roleForm = readSource(
      'src/app/admin/components/role-form/role-form.component.html',
    );

    expect(roleForm).toContain('Full organization-administrator authority.');
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
      'The **All users** page supports searching organization members by name or email',
    );
    expect(source).toContain(
      'Administrators with **Assign all user roles** access can change roles for existing members',
    );
    expect(source).toContain(
      '**Assign all user roles** is full organization-administrator authority',
    );
    expect(source).toContain('full organization-administrator authority');
    expect(source).not.toContain('existing-user role assignment is deferred');
    expect(source).not.toContain('Edit user roles');
  });

  it('keeps page-backed role mutation and read-only permission coverage active', () => {
    const source = readSource('tests/specs/admin/user-role-assignment.spec.ts');

    expect(source).toContain('seedUserRoleAssignmentScenario');
    expect(source).toContain(
      'assigns and removes an existing user role with persisted UI readback',
    );
    expect(source).toContain('expect.poll(scenario.readAssignedRoleIds)');
    expect(source).toContain("toHaveAttribute('aria-selected', 'true')");
    expect(source).toContain("toHaveAttribute('aria-selected', 'false')");
    expect(source).toContain('await scenario.cleanup()');
    expect(source).toContain(
      'with users:viewAll but without users:assignRoles',
    );
    expect(source).toContain('await expect(roleSelect).toHaveCount(0)');
  });

  it('keeps disposable role-assignment records safely cleaned up', () => {
    const source = readSource(
      'tests/support/utils/user-role-assignment-scenario.ts',
    );

    expect(source).toContain('readAssignedRoleIds');
    expect(source).toContain('.delete(schema.rolesToTenantUsers)');
    expect(source).toContain('.delete(schema.roles)');
    expect(source).toContain('.delete(schema.usersToTenants)');
    expect(source).toContain('.delete(schema.users)');
    expect(source).toContain('database.transaction');
  });
});
