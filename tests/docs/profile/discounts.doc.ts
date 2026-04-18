import { userStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: userStateFile });

test('Manage ESN discount card @finance @track(playwright-specs-track-linking_20260126) @doc(DISCOUNTS-DOC-01)', async ({
  page,
}, testInfo) => {
  await page.goto('.');
  await page.getByRole('link', { name: 'Profile' }).click();

  const profilePage = page.locator('app-user-profile');
  await expect(profilePage).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
# ESN Discount Card

Add your ESN card to receive discounted prices on eligible events. Your card is validated against esncard.org and discounts apply only while the card is valid.
`,
  });

  const discountsSectionButton = profilePage
    .locator('nav button')
    .filter({ hasText: 'Discounts' });
  await expect(discountsSectionButton).toBeVisible();
  await discountsSectionButton.click();

  await expect(
    page.getByRole('heading', { level: 2, name: 'Discount Cards' }),
  ).toBeVisible({ timeout: 15_000 });
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { level: 2, name: 'Discount Cards' }),
    page,
    'Discount cards section',
  );

  await testInfo.attach('markdown', {
    body: `
If you already added your ESN card, you will see its status and validity here. You can refresh its status or remove it. Use the form to add or update your ESN card number.
`,
  });
});
