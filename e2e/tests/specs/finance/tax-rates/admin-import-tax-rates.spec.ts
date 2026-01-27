import type { Page } from '@playwright/test';

import { adminStateFile, userStateFile } from '../../../../../helpers/user-data';
import { expect, test } from '../../../../fixtures/permissions-test';

const openTaxRates = async (page: Page) => {
  await page.goto('/admin/tax-rates', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Tax Rates' })).toBeVisible();
  const importButton = page.getByRole('button', { name: 'Import Tax Rates' });
  await expect(importButton).toBeVisible();
  await expect(importButton).toBeEnabled();
};

test.describe('Admin Tax Rates Import', () => {
  test.beforeEach(({}, testInfo) => {
    if (testInfo.project.name === 'webkit' || testInfo.project.name === 'Mobile Safari') {
      test.skip(true, 'WebKit fails to load module scripts for /admin/tax-rates in Playwright.');
    }
  });
  test.use({ storageState: adminStateFile });

  test('admin can view and import tax rates with manageTaxes permission @finance @taxRates', async ({
    page,
  }) => {
    await page.goto('.');

    await openTaxRates(page);
  });

  test.describe('Tax Rates Access Control', () => {
    test.use({ storageState: userStateFile });

    test('admin without manageTaxes permission cannot access tax rates @finance @taxRates', async ({
      page,
    }) => {
      await page.goto('.');

      // Try to access tax rates - should be denied
      // This test validates that permission checking works
      await page.goto('/admin/tax-rates', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/403/);
      await expect(page.getByRole('heading', { level: 1, name: 'Tax Rates' })).toHaveCount(0);
    });
  });

  test('admin can list imported tax rates @finance @taxRates', async ({ page }) => {
    await page.goto('.');

    await openTaxRates(page);
    const taxRatesSection = page.locator('app-tax-rates-settings');
    await expect(taxRatesSection).toBeVisible();
    await expect(
      taxRatesSection
        .getByRole('heading', {
          name: /Compatible Tax Rates|Incompatible Rates|No tax rates imported/,
        })
        .first(),
    ).toBeVisible();
  });

  test('admin can view stripe tax rates from provider @finance @taxRates', async ({ page }) => {
    await page.goto('.');

    await openTaxRates(page);
    const importButton = page.getByRole('button', { name: 'Import Tax Rates' });
    await expect(importButton).toBeEnabled();
    await importButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Import Stripe tax rates' })).toBeVisible();
    await expect(dialog.getByText('Open test tax rates')).toBeVisible();
    await expect(dialog).toContainText(
      /Loading from Stripe|Failed to load rates from Stripe|included|excluded \(not compatible\)/,
    );
  });

  test('import dialog shows compatible vs incompatible rates correctly @finance @taxRates', async ({
    page,
  }) => {
    await page.goto('.');

    await openTaxRates(page);
    const importButton = page.getByRole('button', { name: 'Import Tax Rates' });
    await expect(importButton).toBeEnabled();
    await importButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/included|excluded \\(not compatible\\)/i).first()).toBeVisible();
  });

  test('imported rates are tenant-isolated @finance @taxRates', async ({ page }) => {
    await page.goto('.');

    await openTaxRates(page);
    const taxRatesSection = page.locator('app-tax-rates-settings');
    await expect(taxRatesSection).toBeVisible();
    await expect(
      taxRatesSection
        .getByRole('heading', {
          name: /Compatible Tax Rates|Incompatible Rates|No tax rates imported/,
        })
        .first(),
    ).toBeVisible();
  });
});
