import { adminStateFile, userStateFile } from '../../../../helpers/user-data';
import { expect, test } from '../../../fixtures/parallel-test';
import { takeScreenshot } from '../../../reporters/documentation-reporter';

const SNACKBAR = 'mat-snack-bar-container';
const CTA_SECTION = '[data-testid="esn-cta-section"]';
const CARD_IDENTIFIER_CELL = '[data-testid="refresh-esn-card"]';

test.describe('Documentation: Discount provider journey — admin setup', () => {
  test.use({ storageState: adminStateFile });

  test('Admin enables ESN discount provider', async ({ page }, testInfo) => {
    // test.skip(
    //   true,
    //   'ESN card validation requires reliable upstream test numbers.',
    // );

    await page.goto('/admin/settings/discounts', {
      waitUntil: 'domcontentloaded',
    });

    const providerToggle = page
      .getByTestId('enable-esn-provider')
      .getByRole('switch');
    if ((await providerToggle.getAttribute('aria-checked')) !== 'true') {
      await providerToggle.click();
      await expect(providerToggle).toHaveAttribute('aria-checked', 'true');
    }

    const ctaToggle = page
      .getByTestId('esn-show-cta-toggle')
      .getByRole('switch');
    await expect(ctaToggle).toBeVisible();
    if ((await ctaToggle.getAttribute('aria-checked')) !== 'true') {
      await ctaToggle.click();
      await expect(ctaToggle).toHaveAttribute('aria-checked', 'true');
    }

    await page.getByTestId('save-discount-settings').click();
    await expect(page.locator(SNACKBAR)).toContainText(
      'Discount settings saved successfully',
    );
    await page.locator(SNACKBAR).waitFor({ state: 'detached' });

    await takeScreenshot(
      testInfo,
      page.locator('app-discount-settings'),
      page,
      'Admin enables ESN provider',
    );

    await testInfo.attach('markdown', {
      body: `\n## Enable the ESN provider\n\n1. Visit **Admin → Settings → Discounts**.\n2. Toggle on the **ESN provider** and the optional CTA.\n3. Save changes to make the CTA available for members.\n`,
    });
  });
});

test.describe('Documentation: Discount provider journey — user experience', () => {
  test.use({ storageState: userStateFile });

  test('User registers an ESN discount card', async ({ page }, testInfo) => {
    // test.skip(true, 'ESN card validation requires reliable upstream test numbers.');

    await page.goto('/profile/discount-cards', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator(CTA_SECTION)).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator(CTA_SECTION),
      page,
      'CTA encourages ESN registration',
    );

    const identifier = `ESN-DOC-${Date.now()}`;
    await page.getByTestId('esn-card-input').fill(identifier);
    await page.getByTestId('add-esn-card-button').click();
    await expect(page.locator(SNACKBAR)).toContainText(
      'Card added successfully',
    );
    await page.locator(SNACKBAR).waitFor({ state: 'detached' });

    const cardPanel = page
      .locator(CARD_IDENTIFIER_CELL)
      .first()
      .locator('..')
      .locator('..');
    await expect(cardPanel).toContainText(identifier);
    await expect(cardPanel).toContainText('Verified');
    await takeScreenshot(
      testInfo,
      cardPanel,
      page,
      'Verified ESN card on file',
    );

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('delete-esn-card').click();
    await expect(page.locator(SNACKBAR)).toContainText(
      'Card deleted successfully',
    );
    await page.locator(SNACKBAR).waitFor({ state: 'detached' });

    await testInfo.attach('markdown', {
      body: `\n## Member adds an ESN card\n\n1. Open **Profile → Discount cards** to view the CTA.\n2. Enter the ESN identifier and add the card.\n3. Confirm the verified status and remove the card if needed.\n`,
    });
  });
});
