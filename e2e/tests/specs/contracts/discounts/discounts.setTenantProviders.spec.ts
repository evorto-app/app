import { Page } from '@playwright/test';

import { adminStateFile, userStateFile } from '../../../../../helpers/user-data';
import { expect, test } from '../../../../fixtures/parallel-test';
import { runWithStorageState } from '../../../../utils/auth-context';

const SNACKBAR = 'mat-snack-bar-container';
const CTA_SECTION = '[data-testid="esn-cta-section"]';
const providerSwitch = (page: Page) => page.getByTestId('enable-esn-provider').getByRole('switch');

const ctaSwitch = (page: Page) => page.getByTestId('esn-show-cta-toggle').getByRole('switch');

test.describe('Contract: discounts.setTenantProviders', () => {
  test('updates tenant providers and reflects on the user profile', async ({ browser, tenant }) => {
    await runWithStorageState(browser, adminStateFile, async (page) => {
      await page.goto('/admin/settings/discounts', {
        waitUntil: 'domcontentloaded',
      });

      const providerToggle = providerSwitch(page);
      if ((await providerToggle.getAttribute('aria-checked')) !== 'true') {
        await providerToggle.click();
        await expect(providerToggle).toHaveAttribute('aria-checked', 'true');
      }

      const ctaToggle = ctaSwitch(page);
      await expect(ctaToggle).toHaveCount(1);
      if ((await ctaToggle.getAttribute('aria-checked')) === 'true') {
        await ctaToggle.click();
        await expect(ctaToggle).toHaveAttribute('aria-checked', 'false');
      }

      await page.getByTestId('save-discount-settings').click();
      await expect(page.locator(SNACKBAR)).toContainText('Discount settings saved successfully');
      await page.locator(SNACKBAR).waitFor({ state: 'detached' });
    });

    await runWithStorageState(browser, userStateFile, async (page) => {
      await page.goto('/profile/discount-cards', {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.locator(CTA_SECTION)).toHaveCount(0);
    });

    await runWithStorageState(browser, adminStateFile, async (page) => {
      await page.goto('/admin/settings/discounts', {
        waitUntil: 'domcontentloaded',
      });
      const ctaToggle = ctaSwitch(page);
      if ((await ctaToggle.getAttribute('aria-checked')) !== 'true') {
        await ctaToggle.click();
        await expect(ctaToggle).toHaveAttribute('aria-checked', 'true');
        await page.getByTestId('save-discount-settings').click();
        await expect(page.locator(SNACKBAR)).toContainText('Discount settings saved successfully');
        await page.locator(SNACKBAR).waitFor({ state: 'detached' });
      }
    });

    await runWithStorageState(browser, userStateFile, async (page) => {
      await page.goto('/profile/discount-cards', {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.locator(CTA_SECTION)).toBeVisible();
    });
  });
});
