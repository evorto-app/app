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
  await expect(page.getByLabel('Search users')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Email' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Roles' })).toBeVisible();

  await page.getByLabel('Search users').fill('admin@evorto.app');
  await expect(page.getByText('admin@evorto.app')).toBeVisible();
  await expect(page.getByText('Admin').first()).toBeVisible();
  await expect(page.getByText('Edit template')).toHaveCount(0);

  await page.goto('/admin/roles');

  await expect(page.getByRole('heading', { name: 'User roles' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create role' })).toBeVisible();

  await page.getByRole('link', { name: 'Create role' }).click();
  await expect(
    page.getByRole('heading', { name: 'Create Role' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save role' })).toBeDisabled();

  const roleForm = page.locator('app-role-form');
  await roleForm.getByRole('textbox', { name: 'Name' }).fill(roleName);
  await roleForm
    .getByRole('textbox', { name: 'Description' })
    .fill('Created by role management stabilization spec');
  await roleForm
    .getByRole('checkbox', { name: 'Show this role in the hub' })
    .click();
  await expect(
    roleForm.getByRole('checkbox', {
      name: 'Collapse the members of this role by default',
    }),
  ).toBeVisible();

  await roleForm.getByRole('checkbox', { name: 'Events' }).click();
  await expect(
    roleForm.getByRole('checkbox', { name: 'Create events' }),
  ).toBeChecked();
  await expect(roleForm.getByText('Includes: View templates')).toBeVisible();
  await expect(
    roleForm.getByRole('checkbox', { name: 'View templates' }),
  ).toBeChecked();

  await page.getByRole('button', { name: 'Save role' }).click();

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
  await roleForm
    .getByRole('textbox', { name: 'Description' })
    .fill(updatedDescription);
  await roleForm
    .getByRole('checkbox', { name: 'Show this role in the hub' })
    .click();
  await page.getByRole('button', { name: 'Save role' }).click();

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
