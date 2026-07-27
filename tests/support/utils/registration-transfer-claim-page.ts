import { expect, type Page } from '@playwright/test';

export const openRegistrationTransferClaim = async (
  page: Page,
  claimCode: string,
): Promise<void> => {
  await page.goto('/registration-transfers');
  const reviewTransfer = page.getByRole('button', { name: 'Review transfer' });
  const codeForm = page.locator('form').filter({ has: reviewTransfer });
  await expect(codeForm).not.toHaveAttribute('jsaction', /submit/, {
    timeout: 20_000,
  });
  await page.getByLabel('Claim code').fill(claimCode);
  await reviewTransfer.click();
};
