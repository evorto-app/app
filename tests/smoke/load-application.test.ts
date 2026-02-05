import { expect, test } from '../fixtures/parallel-test';

test('load application @track(playwright-specs-track-linking_20260126) @req(LOAD-APPLICATION-TEST-01)', async ({ page }) => {
  await page.goto('.');
});

test('navigate to events list @track(playwright-specs-track-linking_20260126) @req(LOAD-APPLICATION-TEST-02)', async ({ page }) => {
  await page.goto('.');
  await page.getByRole('link', { name: 'Events' }).click();
  await expect(page).toHaveURL(/\/events/);
});
