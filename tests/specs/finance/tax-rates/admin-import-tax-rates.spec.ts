import { adminStateFile } from '../../../../helpers/user-data';
import { expect, test } from '../../../support/fixtures/permissions-test';
import { openAdminTools } from '../../../support/utils/admin-tools';

test.use({ storageState: adminStateFile });

test.describe('Admin Tax Rates Import', () => {
  test('admin with tax permission can open tax rates settings and import dialog @finance @taxRates @track(playwright-specs-track-linking_20260126) @req(ADMIN-IMPORT-TAX-RATES-SPEC-01)', async ({
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

    await page.getByRole('link', { name: 'Tax Rates' }).click();
    await expect(page).toHaveURL(/\/admin\/tax-rates/);
    await expect(
      page
        .locator('app-tax-rates-settings')
        .getByRole('heading', { level: 1, name: 'Tax Rates' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Import Tax Rates' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Import Tax Rates' }).click();
    await expect(
      page.getByRole('heading', { name: 'Import Stripe tax rates' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Import Stripe tax rates' }),
    ).not.toBeVisible();
  });

  test('admin without tax permission cannot open tax rates settings @finance @taxRates @track(playwright-specs-track-linking_20260126) @req(ADMIN-IMPORT-TAX-RATES-SPEC-02)', async ({
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
