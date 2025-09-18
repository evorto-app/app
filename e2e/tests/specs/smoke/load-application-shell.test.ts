import { expect } from '@playwright/test';
import { test } from '../../../fixtures/base-test';

test('loads application shell', async ({ page }) => {
  await page.goto('.');
});

test('navigates to events list from shell', async ({ page }) => {
  await page.goto('.');
  await page.getByRole('link', { name: 'Events' }).click();
  await expect(page).toHaveURL(/\/events/);
});
