import { and, eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import { createId } from '../../../src/db/create-id';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: adminStateFile });

test('tenant admin reviews members and manages role definitions @admin @permissions', async ({
  database,
  page,
  seedDate,
  tenant,
}) => {
  const roleName = `Stabilization events ${seedDate.getTime()}`;
  const updatedDescription = 'Updated role description from stabilization spec';

  await page.goto('/admin/users');

  await expect(
    page.getByRole('heading', { name: 'All members' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Manage role assignments for existing members. Role changes apply only to this organization.',
    ),
  ).toBeVisible();
  const userSearchInput = page.getByPlaceholder('Name or email');
  await expect(userSearchInput).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 15_000 });
  await userSearchInput.fill('admin@evorto.app');
  await expect(userSearchInput).toHaveValue('admin@evorto.app');
  await expect(page.getByText('Assigned roles').first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Edit template')).toHaveCount(0);

  await page.goto('/admin/roles');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Member roles' }),
  ).toBeVisible();
  const createRoleAction = page.getByText('Create role', { exact: true });
  await expect(createRoleAction).toBeVisible();

  await createRoleAction.click();
  await expect(
    page.getByRole('heading', { name: 'Create role' }),
  ).toBeVisible();
  await page.waitForLoadState('networkidle');

  const roleForm = page.locator('app-role-form');
  const roleFormCheckbox = (name: string | RegExp) =>
    roleForm.getByRole('checkbox', { name });
  const setRoleFormCheckbox = async (
    name: string | RegExp,
    checked: boolean,
  ) => {
    await roleFormCheckbox(name).setChecked(checked);
  };
  const saveRoleButton = roleForm.locator('button[type="submit"]');
  await roleForm.locator('input').first().fill(roleName);
  await roleForm
    .locator('textarea')
    .first()
    .fill('Created by role management stabilization spec');
  await setRoleFormCheckbox('Show this role in the hub', true);
  await expect(roleFormCheckbox('Show this role in the hub')).toBeChecked();

  await setRoleFormCheckbox(/^Events$/, true);
  await expect(roleFormCheckbox(/^Create events$/)).toBeChecked();
  await expect(roleForm.getByText('Includes: View templates')).toBeVisible();
  await expect(roleFormCheckbox(/^View templates$/)).toBeChecked();
  await expect(saveRoleButton).toBeEnabled();

  await saveRoleButton.click();

  await expect(page.getByRole('heading', { name: roleName })).toBeVisible();
  await expect(page.getByText('Create events')).toBeVisible();
  await expect(page.getByText('View templates')).toBeVisible();

  const createdRole = await database.query.roles.findFirst({
    where: { name: roleName, tenantId: tenant.id },
  });
  if (!createdRole) {
    throw new Error('Expected role create flow to persist the new role');
  }
  expect(createdRole).toMatchObject({
    defaultOrganizerRole: false,
    defaultUserRole: false,
    description: 'Created by role management stabilization spec',
    displayInHub: true,
    name: roleName,
    tenantId: tenant.id,
  });
  expect(createdRole.permissions).toContain('events:create');
  expect(createdRole.permissions).toContain('templates:view');

  await page.goto(`/admin/roles/${createdRole.id}/edit`);

  await expect(page.getByRole('heading', { name: 'Edit role' })).toBeVisible();
  // The SSR form is visible before Angular attaches its submit handler.
  // Event replay removes `jsaction` once saving is safely interactive.
  await expect(roleForm.locator('form')).not.toHaveAttribute(
    'jsaction',
    /submit/,
  );
  await roleForm.locator('textarea').first().fill(updatedDescription);
  await setRoleFormCheckbox('Show this role in the hub', false);
  await expect(roleFormCheckbox('Show this role in the hub')).not.toBeChecked();
  await saveRoleButton.click();

  await expect(page.getByRole('heading', { name: roleName })).toBeVisible();
  await expect(page.getByText(updatedDescription)).toBeVisible();

  const updatedRoleRows = await database
    .select()
    .from(schema.roles)
    .where(
      and(
        eq(schema.roles.id, createdRole.id),
        eq(schema.roles.tenantId, tenant.id),
      ),
    )
    .limit(1);
  const updatedRole = updatedRoleRows[0];
  if (!updatedRole) {
    throw new Error('Expected role edit flow to persist the updated role');
  }
  expect(updatedRole).toMatchObject({
    description: updatedDescription,
    displayInHub: false,
    name: roleName,
    tenantId: tenant.id,
  });
  expect(updatedRole.permissions).toContain('events:create');
  expect(updatedRole.permissions).toContain('templates:view');
});

test('preserves wildcard grants through a rename and revokes only the selected capability @admin @permissions', async ({
  database,
  page,
  registerDatabaseCleanup,
  tenant,
}) => {
  const roleId = createId();
  const roleName = `Wildcard review ${roleId}`;
  const renamedRole = `${roleName} renamed`;
  const rolePredicate = and(
    eq(schema.roles.id, roleId),
    eq(schema.roles.tenantId, tenant.id),
  );
  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase.delete(schema.roles).where(rolePredicate);
  });
  await database.insert(schema.roles).values({
    id: roleId,
    name: roleName,
    permissions: ['admin:*', 'users:*'],
    tenantId: tenant.id,
  });

  await page.goto('/admin/roles');
  await page.getByRole('link', { exact: true, name: roleName }).click();
  const roleDetails = page.locator('app-role-details');
  await expect(
    roleDetails.getByText('Change organization settings', { exact: true }),
  ).toBeVisible();
  await expect(
    roleDetails.getByText('Assign all member roles (organization admin)', {
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Edit role' }).click();
  const roleForm = page.locator('app-role-form');
  await expect(roleForm.locator('form')).not.toHaveAttribute(
    'jsaction',
    /submit/,
  );
  await expect(
    roleForm.getByRole('checkbox', {
      exact: true,
      name: 'Change organization settings',
    }),
  ).toBeChecked();
  await expect(
    roleForm.getByRole('checkbox', {
      exact: true,
      name: 'Assign all member roles (organization admin)',
    }),
  ).toBeChecked();
  await roleForm
    .getByRole('textbox', { exact: true, name: 'Name' })
    .fill(renamedRole);
  await roleForm.getByRole('button', { name: 'Save role' }).click();
  await expect(page.getByRole('heading', { name: renamedRole })).toBeVisible();

  const renamedRows = await database
    .select()
    .from(schema.roles)
    .where(rolePredicate);
  expect(renamedRows).toHaveLength(1);
  expect(renamedRows[0]).toMatchObject({
    name: renamedRole,
    permissions: ['admin:*', 'users:*'],
  });
  await page.reload();
  await expect(
    roleDetails.getByText('Change organization settings', { exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Edit role' }).click();
  await expect(roleForm.locator('form')).not.toHaveAttribute(
    'jsaction',
    /submit/,
  );
  await roleForm
    .getByRole('checkbox', {
      exact: true,
      name: 'Change organization settings',
    })
    .uncheck();
  await roleForm.getByRole('button', { name: 'Save role' }).click();
  await expect(page.getByRole('heading', { name: renamedRole })).toBeVisible();
  const revokedRows = await database
    .select()
    .from(schema.roles)
    .where(rolePredicate);
  expect(revokedRows).toHaveLength(1);
  expect(revokedRows[0]?.permissions.toSorted()).toEqual([
    'admin:managePayments',
    'admin:manageRoles',
    'admin:manageTaxes',
    'users:*',
  ]);

  await page.reload();
  await expect(page.getByRole('heading', { name: renamedRole })).toBeVisible();
  await expect(
    roleDetails.getByText('Change organization settings', { exact: true }),
  ).toHaveCount(0);
  await expect(
    roleDetails.getByText('Manage roles', { exact: true }),
  ).toBeVisible();
  await expect(
    roleDetails.getByText('Assign all member roles (organization admin)', {
      exact: true,
    }),
  ).toBeVisible();
});
