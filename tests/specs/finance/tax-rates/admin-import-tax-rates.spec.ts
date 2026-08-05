import { adminStateFile } from '../../../../helpers/user-data';
import { expect, test } from '../../../support/fixtures/permissions-test';
import { openAdminTools } from '../../../support/utils/admin-tools';

test.use({ storageState: adminStateFile });

test.describe('Admin Tax Rates Import', () => {
  test('admin with tax permission can open tax rates settings and import dialog @finance @taxRates', async ({
    isMobile,
    page,
    permissionOverride,
  }) => {
    await permissionOverride({
      roleName: 'Admin',
      add: ['admin:tax'],
      remove: [],
    });

    await page.goto('.');
    await openAdminTools(page, isMobile);

    await page.getByRole('link', { name: 'Tax rates' }).click();
    await expect(page).toHaveURL(/\/admin\/tax-rates/);
    await expect(
      page
        .locator('app-tax-rates-settings')
        .getByRole('heading', { level: 1, name: 'Tax rates' }),
    ).toBeVisible();
    const importButton = page.getByRole('button', {
      name: 'Add tax rates',
      exact: true,
    });
    await expect(importButton).toBeEnabled({ timeout: 15_000 });
    await expect(importButton).not.toHaveAttribute('jsaction', /click/, {
      timeout: 20_000,
    });
    await importButton.click();
    const importDialog = page.getByRole('dialog');
    await expect(importDialog).toBeVisible({ timeout: 15_000 });
    await expect(importDialog).toHaveAccessibleName('Add tax rates');
    await expect(
      importDialog.getByRole('heading', { name: 'Add tax rates' }),
    ).toBeVisible();
    await expect(
      importDialog.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeVisible();
    await importDialog
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await expect(importDialog).not.toBeVisible();
  });

  test('admin without tax permission cannot open tax rates settings @finance @taxRates', async ({
    page,
    permissionOverride,
  }) => {
    await permissionOverride({
      roleName: 'Admin',
      add: [],
      remove: ['admin:tax'],
    });

    await page.goto('/admin/tax-rates');
    await expect(page).toHaveURL(/\/403/);
  });
});
