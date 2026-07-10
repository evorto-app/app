import type { Locator, Page } from '@playwright/test';

import { adminStateFile, organizerStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import {
  seedUserRoleAssignmentScenario,
  type UserRoleAssignmentScenario,
} from '../../support/utils/user-role-assignment-scenario';

test.setTimeout(120_000);

const openUserAssignment = async (
  page: Page,
  scenario: UserRoleAssignmentScenario,
): Promise<{ roleSelect: Locator; userRow: Locator }> => {
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'All users' })).toBeVisible();
  await page.getByPlaceholder('Name or email').fill(scenario.user.email);
  const userRow = page
    .getByRole('row')
    .filter({ has: page.getByText(scenario.user.email, { exact: true }) });
  await expect(userRow).toBeVisible();
  return {
    roleSelect: userRow.getByRole('combobox', { name: 'Assigned roles' }),
    userRow,
  };
};

test.describe('with users:assignRoles', () => {
  test.use({ storageState: adminStateFile });

  test('assigns and removes an existing user role with persisted UI readback @admin @permissions', async ({
    database,
    page,
    tenant,
  }) => {
    const scenario = await seedUserRoleAssignmentScenario({
      database,
      roleName: 'Event assistant',
      tenant,
      userEmail: 'casey.role-assignment@evorto.test',
    });

    try {
      let { roleSelect } = await openUserAssignment(page, scenario);
      await expect(roleSelect).toBeEnabled();
      await roleSelect.click();
      let roleOption = page.getByRole('option', {
        exact: true,
        name: scenario.role.name,
      });
      await expect(roleOption).toHaveAttribute('aria-selected', 'false');
      await roleOption.click();
      await page.keyboard.press('Escape');
      await expect(page.getByText('User roles updated')).toBeVisible();
      await expect
        .poll(scenario.readAssignedRoleIds)
        .toEqual([scenario.role.id]);

      ({ roleSelect } = await openUserAssignment(page, scenario));
      await expect(roleSelect).toContainText(scenario.role.name);
      await roleSelect.click();
      roleOption = page.getByRole('option', {
        exact: true,
        name: scenario.role.name,
      });
      await expect(roleOption).toHaveAttribute('aria-selected', 'true');
      await roleOption.click();
      await page.keyboard.press('Escape');
      await expect.poll(scenario.readAssignedRoleIds).toEqual([]);

      ({ roleSelect } = await openUserAssignment(page, scenario));
      await expect(roleSelect).not.toContainText(scenario.role.name);
      await roleSelect.click();
      await expect(
        page.getByRole('option', {
          exact: true,
          name: scenario.role.name,
        }),
      ).toHaveAttribute('aria-selected', 'false');
      await page.keyboard.press('Escape');
    } finally {
      await scenario.cleanup();
    }
  });
});

test.describe('with users:viewAll but without users:assignRoles', () => {
  test.use({ storageState: organizerStateFile });

  test('shows existing-user assignments as read-only role chips @admin @permissions', async ({
    database,
    page,
    permissionOverride,
    tenant,
  }) => {
    const scenario = await seedUserRoleAssignmentScenario({
      database,
      initiallyAssigned: true,
      roleName: 'Read-only event assistant',
      tenant,
      userEmail: 'casey.read-only-role@evorto.test',
    });

    try {
      await permissionOverride({
        add: ['users:viewAll'],
        remove: ['users:assignRoles'],
        roleName: 'Section member',
      });

      const { roleSelect, userRow } = await openUserAssignment(page, scenario);
      await expect(roleSelect).toHaveCount(0);
      await expect(
        userRow.getByText(scenario.role.name, { exact: true }),
      ).toBeVisible();
      expect(await scenario.readAssignedRoleIds()).toEqual([scenario.role.id]);
    } finally {
      await scenario.cleanup();
    }
  });
});
