import { userStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';
import { takeScreenshot } from '../../reporters/documentation-reporter';

test.use({ storageState: userStateFile });

test('Manage ESN discount card', async ({ page }, testInfo) => {
  await page.goto('./profile');
  await testInfo.attach('markdown', {
    body: `
# ESN Discount Card

Add your ESN card to receive discounted prices on eligible events. Your card is validated against esncard.org and discounts apply only while the card is valid.
`,
  });

  await expect(page.getByRole('heading', { name: 'Discount Cards' })).toBeVisible();
  await takeScreenshot(testInfo, page.getByRole('heading', { name: 'Discount Cards' }), page, 'Discount cards section');

  await testInfo.attach('markdown', {
    body: `
If you already added your ESN card, you will see its status and validity here. You can refresh its status or remove it. Use the form to add or update your ESN card number.
`,
  });
});

