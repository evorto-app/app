import { defaultStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';

test.use({ storageState: defaultStateFile });

test('load application', async ({ page }) => {
  await page.goto('.');
});

test('load template list', async ({ page }) => {
  await page.goto('.');
  await page.getByRole('link', { name: 'Event templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
});
