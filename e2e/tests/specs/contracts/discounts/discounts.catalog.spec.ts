import type { Page } from '@playwright/test';

import { expect, test } from '../../../../fixtures/parallel-test';
import { adminStateFile } from '../../../../../helpers/user-data';

const SNACKBAR = 'mat-snack-bar-container';

const providerSection = (page: Page) =>
  page.getByRole('heading', { name: 'ESNcard' }).locator('..').locator('..');
const providerSwitch = (page: Page) => providerSection(page).getByRole('switch').first();
const ctaSwitch = (page: Page) =>
  providerSection(page).getByRole('switch', { name: 'Show buy ESNcard link' }).first();
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save Settings' });

test.describe('Contract: discounts.catalog → getTenantProviders', () => {
  test.use({ storageState: adminStateFile });

  test('persists provider configuration across reloads', async ({ page }) => {
    await page.goto('/admin/settings/discounts', { waitUntil: 'domcontentloaded' });

    await expect(providerSwitch(page)).toHaveAttribute('aria-checked', 'true');

    const ctaToggle = ctaSwitch(page);

    // Turn the CTA off and verify the persisted state.
    if ((await ctaToggle.getAttribute('aria-checked')) !== 'false') {
      await ctaToggle.click();
      await expect(ctaToggle).toHaveAttribute('aria-checked', 'false');
    }

    await saveButton(page).click();
    await expect(page.locator(SNACKBAR)).toContainText('Discount settings saved successfully');
    await page.locator(SNACKBAR).waitFor({ state: 'detached' });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(providerSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await expect(ctaToggle).toHaveAttribute('aria-checked', 'false');

    // Re-enable the CTA to keep the fixture state aligned for later tests.
    await ctaToggle.click();
    await expect(ctaToggle).toHaveAttribute('aria-checked', 'true');
    await page.getByLabel('CTA link (Get ESNcard URL)').fill('https://example.com/esncard');

    await saveButton(page).click();
    await expect(page.locator(SNACKBAR)).toContainText('Discount settings saved successfully');
    await page.locator(SNACKBAR).waitFor({ state: 'detached' });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(providerSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await expect(ctaToggle).toHaveAttribute('aria-checked', 'true');
  });
});
