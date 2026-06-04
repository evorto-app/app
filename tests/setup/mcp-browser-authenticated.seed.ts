import { expect, test } from '@playwright/test';

import {
  adminStateFile,
  gaStateFile,
  userStateFile,
} from '../../helpers/user-data';

test.describe('tenant-admin authenticated MCP Browser planning seed', () => {
  test.use({ storageState: adminStateFile });

  test('open tenant-admin General settings for MCP Browser planning', async ({
    page,
  }) => {
    await page.goto('/admin/settings');
    await expect(
      page.getByRole('heading', { name: 'General settings' }),
    ).toBeVisible();
  });
});

test.describe('global-admin authenticated MCP Browser planning seed', () => {
  test.use({ storageState: gaStateFile });

  test('open global-admin tenant list for MCP Browser planning', async ({
    page,
  }) => {
    await page.goto('/global-admin/tenants');
    await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  });
});

test.describe('profile authenticated MCP Browser planning seed', () => {
  test.use({ storageState: userStateFile });

  test('open profile for MCP Browser planning', async ({ page }) => {
    await page.goto('/profile');
    await expect(
      page.getByRole('button', { name: 'Edit profile' }),
    ).toBeVisible();
  });
});
