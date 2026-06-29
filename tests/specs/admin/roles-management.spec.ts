import { and, eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: adminStateFile });

test('tenant admin reviews users and manages role definitions @admin @permissions', async ({
  database,
  page,
  seedDate,
  tenant,
}) => {
  const roleName = `Stabilization events ${seedDate.getTime()}`;
  const updatedDescription = 'Updated role description from stabilization spec';

  await page.goto('/admin/users');

  await expect(page.getByRole('heading', { name: 'All users' })).toBeVisible();
  await expect(
    page.getByText('Existing-user role assignment is deferred for relaunch.'),
  ).toBeVisible();
  const userSearchInput = page.getByPlaceholder('Name or email');
  await expect(userSearchInput).toBeVisible();
  await userSearchInput.fill('admin@evorto.app');
  await expect(userSearchInput).toHaveValue('admin@evorto.app');
  await expect(page.getByText('Edit template')).toHaveCount(0);

  await page.goto('/admin/roles');

  await expect(
    page.getByRole('heading', { level: 1, name: 'User roles' }),
  ).toBeVisible();
  const createRoleAction = page.getByText('Create role', { exact: true });
  await expect(createRoleAction).toBeVisible();

  await createRoleAction.click();
  await expect(
    page.getByRole('heading', { name: 'Create Role' }),
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
  await expect(
    roleFormCheckbox('Collapse the members of this role by default'),
  ).toBeVisible();

  await setRoleFormCheckbox(/^Events$/, true);
  await expect(roleFormCheckbox(/^Create events$/)).toBeChecked();
  await expect(roleForm.getByText('Includes: View templates')).toBeVisible();
  await expect(roleFormCheckbox(/^View templates$/)).toBeChecked();

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

  await expect(page.getByRole('heading', { name: 'Edit Role' })).toBeVisible();
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
