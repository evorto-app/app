import { expect, Page } from '@playwright/test';

export const openAdminTools = async (page: Page, isMobile: boolean) => {
  if (isMobile) {
    await page.getByRole('button', { name: 'More' }).click();
  }
  await page.getByRole('link', { name: 'Admin Tools' }).click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(
    page.getByRole('heading', { name: 'Admin settings' }),
  ).toBeVisible();
};
