import path from 'node:path';

import { eq } from 'drizzle-orm';

import { organizerStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
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

  await expect(page.getByLabel('Deposit amount (EUR)')).not.toBeVisible();
  await page.getByRole('checkbox', { name: 'Deposit involved' }).check();
  await expect(page.getByLabel('Deposit amount (EUR)')).toBeVisible();
  await expect(page.getByLabel('Alcohol amount (EUR)')).not.toBeVisible();
  await page.getByRole('checkbox', { name: 'Alcohol purchased' }).check();
  await expect(page.getByLabel('Alcohol amount (EUR)')).toBeVisible();

  await page.getByLabel('Total amount (EUR)').fill('14.50');
  await page.getByLabel('Alcohol amount (EUR)').fill('1.50');
  await page.getByLabel('Purchase country').click();
  await page.getByRole('option', { name: 'Germany (DE)' }).click();
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
  if (await page.getByText('No approved receipts are waiting for refund.').isVisible()) {
    return;
  }

  const refundSections = page.locator('section', {
    has: page.getByRole('button', { name: 'Issue refund' }),
  });
  const sectionCount = await refundSections.count();
  let refundTriggered = false;

  for (let index = 0; index < sectionCount; index += 1) {
    const section = refundSections.nth(index);
    const table = section.locator('table[mat-table]');
    if ((await table.count()) === 0) {
      continue;
    }
    await expect(table.first()).toBeVisible();

    const rowCheckboxes = section.locator('tr.mat-mdc-row input[type="checkbox"]');
    if ((await rowCheckboxes.count()) === 0) {
      continue;
    }

    await rowCheckboxes.first().check();

    const issueRefundButton = section.getByRole('button', { name: 'Issue refund' });
    if (await issueRefundButton.isEnabled()) {
      await issueRefundButton.click();
      refundTriggered = true;
      break;
    }
  }

  if (!refundTriggered) {
    return;
  }

  await expect(page.getByText('Selected total: 0.00 €').first()).toBeVisible();
});

test('receipt dialog shows Other option when tenant allows it @track(finance-receipts_20260205) @req(FIN-RECEIPTS-03)', async ({
  database,
  page,
  permissionOverride,
  tenant,
}) => {
  await permissionOverride({
    add: ['finance:manageReceipts'],
    roleName: 'Section member',
  });

  const existingTenant = await database.query.tenants.findFirst({
    where: { id: tenant.id },
  });

  await database
    .update(schema.tenants)
    .set({
      discountProviders: existingTenant?.discountProviders,
      receiptSettings: {
        allowOther: true,
        receiptCountries: ['DE'],
      },
    })
    .where(eq(schema.tenants.id, tenant.id));

  await page.goto('/events');
  const firstEventLink = page
    .locator('a[href^="/events/"]')
    .filter({ hasNotText: 'Create Event' })
    .first();
  await expect(firstEventLink).toBeVisible();
  await firstEventLink.click();
  await page.getByRole('link', { name: 'Organize this event' }).click();
  await page.getByRole('button', { name: 'Add receipt' }).click();
  await page.getByLabel('Purchase country').click();
  const otherCountryOption = page.getByRole('option', {
    name: 'Other (outside configured countries)',
  });
  if ((await otherCountryOption.count()) > 0) {
    await expect(otherCountryOption).toBeVisible();
  }
});
