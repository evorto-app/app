import { userStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: userStateFile });

test('Manage ESN discount card @finance', async ({
  page,
  tenant,
}, testInfo) => {
  const seededEsnCardIdentifier = `TEST-ESN-0001-${tenant.id.slice(0, 6)}`;

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
  await expect(page.getByText('ESN card')).toBeVisible();
  await expect(page.getByText(seededEsnCardIdentifier)).toBeVisible();
  await expect(page.getByText(/Status: Verified/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { level: 2, name: 'Discount Cards' }),
    page,
    'Discount cards section',
  );

  await testInfo.attach('markdown', {
    body: `
If you already added your ESN card, you will see a readable verification status and validity here. You can refresh its status or remove it. Use the form to add or update your ESN card number. The profile page shows clear pending states while the card is checked and maps validation/provider errors into readable messages.
`,
  });

  await page.getByRole('textbox', { name: 'ESN card number' }).fill('short');
  await expect(page.getByText(/Enter a valid ESN card number/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save ESN card' }),
  ).toBeDisabled();
});
