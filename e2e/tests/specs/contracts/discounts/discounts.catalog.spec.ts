import type { Page } from '@playwright/test';

import { expect, test } from '../../../../fixtures/parallel-test';
import { adminStateFile } from '../../../../../helpers/user-data';

const SNACKBAR = 'mat-snack-bar-container';

const providerSwitch = (page: Page) => page.getByTestId('enable-esn-provider').getByRole('switch');

async function toggleProvider(page: Page, enabled: boolean) {
  const toggle = providerSwitch(page);
  const expected = enabled ? 'true' : 'false';
  if ((await toggle.getAttribute('aria-checked')) !== expected) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', expected);
  }
}

test.describe('Contract: discounts.catalog → getTenantProviders', () => {
  test.use({ storageState: adminStateFile });

  test('persists provider configuration across reloads', async ({ page }) => {
    await page.goto('/admin/settings/discounts', { waitUntil: 'domcontentloaded' });

    await expect(providerSwitch(page)).toHaveAttribute('aria-checked', 'true');

    const ctaToggle = page.getByTestId('esn-show-cta-toggle').getByRole('switch');

    // Turn the CTA off and verify the persisted state.
    if ((await ctaToggle.getAttribute('aria-checked')) !== 'false') {
      await ctaToggle.click();
      await expect(ctaToggle).toHaveAttribute('aria-checked', 'false');
    }

    await page.getByTestId('save-discount-settings').click();
    await expect(page.locator(SNACKBAR)).toContainText('Discount settings saved successfully');
    await page.locator(SNACKBAR).waitFor({ state: 'detached' });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(providerSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await expect(ctaToggle).toHaveAttribute('aria-checked', 'false');

    // Re-enable the CTA to keep the fixture state aligned for later tests.
    await ctaToggle.click();
    await expect(ctaToggle).toHaveAttribute('aria-checked', 'true');

    await page.getByTestId('save-discount-settings').click();
    await expect(page.locator(SNACKBAR)).toContainText('Discount settings saved successfully');
    await page.locator(SNACKBAR).waitFor({ state: 'detached' });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(providerSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await expect(ctaToggle).toHaveAttribute('aria-checked', 'true');
  });
});
