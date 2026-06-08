import { expect, test } from '@playwright/test';

test.describe('public MCP Browser planning seed', () => {
  test('open public Terms page for MCP Browser planning', async ({ page }) => {
    await page.goto('/legal/terms');
    await expect(page.getByRole('heading', { name: 'Terms' })).toBeVisible();
  });
});
