import path from 'node:path';

import { organizerStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: organizerStateFile });

test('submit receipt from event organize page @track(finance-receipts_20260205) @req(FIN-RECEIPTS-01)', async ({
  permissionOverride,
  page,
}) => {
  await permissionOverride({
    add: ['finance:manageReceipts'],
    roleName: 'Section member',
  });

  const receiptFile = path.resolve('tests/fixtures/sample-receipt.pdf');

  await page.goto('/events');
  const firstEventLink = page
    .locator('a[href^="/events/"]')
    .filter({ hasNotText: 'Create Event' })
    .first();
  await expect(firstEventLink).toBeVisible();
  await firstEventLink.click();

  await page.getByRole('link', { name: 'Organize this event' }).click();
  await expect(page.getByRole('heading', { name: 'Receipts' })).toBeVisible();
  await page.getByRole('button', { name: 'Add receipt' }).click();

  await page.getByLabel('Total amount (EUR)').fill('14.50');
  await page.getByLabel('Purchase country').fill('DE');
  await page
    .locator('input[type="file"][accept="image/*,application/pdf"]')
    .setInputFiles(receiptFile);
  await page.getByRole('button', { name: 'Submit receipt' }).click();

  await expect(page.getByText('sample-receipt.pdf')).toBeVisible();
});

test('approve and refund receipts in finance @track(finance-receipts_20260205) @req(FIN-RECEIPTS-02)', async ({
  permissionOverride,
  page,
}) => {
  await permissionOverride({
    add: ['finance:approveReceipts', 'finance:refundReceipts'],
    roleName: 'Section member',
  });

  await page.goto('/finance/receipts-approval');
  const firstPendingReceipt = page.locator('a[href*="/finance/receipts-approval/"]').first();
  await expect(firstPendingReceipt).toBeVisible();
  await firstPendingReceipt.click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page).toHaveURL(/\/finance\/receipts-approval$/);

  await page.goto('/finance/receipts-refunds');
  const firstCheckbox = page.locator('input[type="checkbox"]').first();
  await expect(firstCheckbox).toBeVisible();
  await firstCheckbox.check();
  await page.getByRole('button', { name: 'Issue refund' }).first().click();
  await expect(page.getByText('Selected total: 0.00 €').first()).toBeVisible();
});
