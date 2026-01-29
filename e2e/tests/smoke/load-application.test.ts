import { expect, test } from '../../fixtures/parallel-test';

test('load application', async ({ page }) => {
  await page.goto('.');
});

test('navigate to events list', async ({ page }) => {
  await page.goto('.');
  await page.getByRole('link', { name: 'Events' }).click();
  await expect(page).toHaveURL(/\/events/);
});
