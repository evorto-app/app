import path from 'node:path';

import type { Page } from '@playwright/test';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: adminStateFile });

const openEventOrganizePage = async (page: Page, eventId: string) => {
  await page.goto(`/events/${eventId}/organize`);
};

const submitReceiptFromFirstEvent = async (
  page: Page,
  eventId: string,
  receiptFile: string,
) => {
  await openEventOrganizePage(page, eventId);
  await expect(page.getByRole('heading', { name: 'Receipts' })).toBeVisible();
  await expect(page.getByText('Loading receipts...')).not.toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByText('Receipts can be added after the event has loaded.'),
  ).not.toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Add receipt' }).click();
  const receiptDialog = page.locator('app-receipt-submit-dialog');
  await expect(receiptDialog).toBeVisible();
  await expect(
    receiptDialog.getByLabel('Deposit amount (EUR)'),
  ).not.toBeVisible();
  await receiptDialog
    .locator('mat-checkbox', { hasText: 'Deposit involved' })
    .click();
  await expect(receiptDialog.getByLabel('Deposit amount (EUR)')).toBeVisible();
  await expect(
    receiptDialog.getByLabel('Alcohol amount (EUR)'),
  ).not.toBeVisible();
  await receiptDialog
    .locator('mat-checkbox', { hasText: 'Alcohol purchased' })
    .click();
  await expect(receiptDialog.getByLabel('Alcohol amount (EUR)')).toBeVisible();

  await receiptDialog.getByLabel('Total amount (EUR)').fill('14.50');
  await receiptDialog.getByLabel('Alcohol amount (EUR)').fill('1.50');
  await receiptDialog.getByLabel('Purchase country').click();
  await page.getByRole('option', { name: 'Germany (DE)' }).click();
  await receiptDialog
    .locator('input[type="file"][accept="image/*,application/pdf"]')
    .setInputFiles(receiptFile);
  await receiptDialog.getByRole('button', { name: 'Submit receipt' }).click();
  await expect(receiptDialog).not.toBeVisible();
};

const seedPendingReceiptForApproval = async ({
  database,
  eventId,
  seedDate,
  submittedByUserId,
  tenantId,
}: {
  database: NodePgDatabase<typeof relations>;
  eventId: string;
  seedDate: Date;
  submittedByUserId: string;
  tenantId: string;
}) => {
  await database.insert(schema.financeReceipts).values({
    alcoholAmount: 150,
    attachmentFileName: 'sample-receipt.pdf',
    attachmentMimeType: 'application/pdf',
    attachmentSizeBytes: 1024,
    depositAmount: 150,
    eventId,
    hasAlcohol: true,
    hasDeposit: true,
    purchaseCountry: 'DE',
    receiptDate: new Date(seedDate.getTime() - 1000 * 60 * 60 * 24 * 2),
    status: 'submitted',
    submittedByUserId,
    taxAmount: 0,
    tenantId,
    totalAmount: 1450,
  });
};

test.skip('submit receipt from event organize page', async ({
  database,
  page,
  seeded,
}) => {
  const eventId = seeded.scenario.events.past.eventId;
  const receiptFile = path.resolve('tests/fixtures/sample-receipt.pdf');
  const [event] = await database
    .select()
    .from(schema.eventInstances)
    .where(eq(schema.eventInstances.id, eventId))
    .limit(1);
  if (!event) {
    throw new Error('Expected seeded past event for receipt submission flow');
  }

  try {
    const now = new Date();
    await database
      .update(schema.eventInstances)
      .set({
        end: new Date(now.getTime() - 60 * 60 * 1000),
        start: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      })
      .where(eq(schema.eventInstances.id, eventId));

    await submitReceiptFromFirstEvent(page, eventId, receiptFile);
  } finally {
    await database
      .update(schema.eventInstances)
      .set({
        end: event.end,
        start: event.start,
      })
      .where(eq(schema.eventInstances.id, eventId));
  }
});

test.skip('approve and record receipt reimbursements in finance', async ({
  database,
  page,
  seedDate,
  seeded,
  tenant,
}) => {
  const seededEventId = seeded.scenario.events.past.eventId;
  await seedPendingReceiptForApproval({
    database,
    eventId: seededEventId,
    seedDate,
    submittedByUserId: '334967d7626fbd6ad449',
    tenantId: tenant.id,
  });

  await page.goto('/finance/receipts-approval');
  const firstPendingReceipt = page
    .locator('a[href*="/finance/receipts-approval/"]')
    .first();
  await expect(firstPendingReceipt).toBeVisible();
  await firstPendingReceipt.click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page).toHaveURL(/\/finance\/receipts-approval$/);

  await page.goto('/finance/receipts-refunds');
  await expect(
    page.getByText('No approved receipts are waiting for reimbursement.'),
  ).not.toBeVisible();

  const refundSections = page.locator('section', {
    has: page.getByRole('button', { name: 'Record reimbursement' }),
  });
  const refundSection = refundSections.first();
  await expect(refundSection).toBeVisible();

  await expect(refundSection.locator('table[mat-table]').first()).toBeVisible();
  await refundSection
    .locator('tr.mat-mdc-row input[type="checkbox"]')
    .first()
    .check();

  const issueRefundButton = refundSection.getByRole('button', {
    name: 'Record reimbursement',
  });
  await expect(issueRefundButton).toBeEnabled();
  await issueRefundButton.click();

  await expect(page.getByText('Selected total: 0.00 €').first()).toBeVisible();
});

test.skip('receipt dialog shows Other option when tenant allows it', async ({
  database,
  page,
  seeded,
  tenant,
}) => {
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

  const eventId = seeded.scenario.events.past.eventId;
  await openEventOrganizePage(page, eventId);
  await page.getByRole('button', { name: 'Add receipt' }).click();
  await page.getByLabel('Purchase country').click();
  const otherCountryOption = page.getByRole('option', {
    name: 'Other (outside configured countries)',
  });
  await expect(otherCountryOption).toBeVisible();
});
