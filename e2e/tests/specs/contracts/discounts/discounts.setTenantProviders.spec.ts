import { Page } from '@playwright/test';

import { adminStateFile, userStateFile } from '../../../../../helpers/user-data';
import { expect, test } from '../../../../fixtures/parallel-test';
import { runWithStorageState } from '../../../../utils/auth-context';

const SNACKBAR = 'mat-snack-bar-container';
const CTA_LINK_TEXT = 'Get your ESNcard →';
const providerSection = (page: Page) =>
  page.getByRole('heading', { name: 'ESNcard' }).locator('..').locator('..');
const providerSwitch = (page: Page) => providerSection(page).getByRole('switch').first();
const ctaSwitch = (page: Page) =>
  providerSection(page).getByRole('switch', { name: 'Show buy ESNcard link' }).first();
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save Settings' });

test.describe('Contract: discounts.setTenantProviders', () => {
  test.use({ seedDiscounts: false });

  test('updates tenant providers and reflects on the user profile', async ({ browser, tenant }) => {
    await runWithStorageState(
      browser,
      adminStateFile,
      async (page) => {
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

      await saveButton(page).click();
      await expect(page.locator(SNACKBAR)).toContainText('Discount settings saved successfully');
      await page.locator(SNACKBAR).waitFor({ state: 'detached' });
    },
      tenant.domain,
    );

    await runWithStorageState(
      browser,
      userStateFile,
      async (page) => {
      await page.goto('/profile/discount-cards', {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByRole('link', { name: CTA_LINK_TEXT })).toHaveCount(0);
    },
      tenant.domain,
    );

    await runWithStorageState(
      browser,
      adminStateFile,
      async (page) => {
      await page.goto('/admin/settings/discounts', {
        waitUntil: 'domcontentloaded',
      });
      const ctaToggle = ctaSwitch(page);
      if ((await ctaToggle.getAttribute('aria-checked')) !== 'true') {
        await ctaToggle.click();
        await expect(ctaToggle).toHaveAttribute('aria-checked', 'true');
      }
      await page.getByLabel('CTA link (Get ESNcard URL)').fill('https://example.com/esncard');
      await saveButton(page).click();
      await expect(page.locator(SNACKBAR)).toContainText('Discount settings saved successfully');
      await page.locator(SNACKBAR).waitFor({ state: 'detached' });
    },
      tenant.domain,
    );

    await runWithStorageState(
      browser,
      userStateFile,
      async (page) => {
      await page.goto('/profile/discount-cards', {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByRole('link', { name: CTA_LINK_TEXT })).toBeVisible();
    },
      tenant.domain,
    );
  });
});
