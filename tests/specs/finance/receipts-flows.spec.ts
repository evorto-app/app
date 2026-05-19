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
  await expect(page.getByRole('dialog')).not.toBeVisible();
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

test('submit receipt from event organize page @track(finance-receipts_20260205) @req(FIN-RECEIPTS-01)', async ({
  page,
  seeded,
}) => {
  const eventId = seeded.scenario.events.past.eventId;
  const receiptFile = path.resolve('tests/fixtures/sample-receipt.pdf');
  await submitReceiptFromFirstEvent(page, eventId, receiptFile);
});

test('approve and record receipt reimbursements in finance @track(finance-receipts_20260205) @req(FIN-RECEIPTS-02)', async ({
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

test('receipt dialog shows Other option when tenant allows it @track(finance-receipts_20260205) @req(FIN-RECEIPTS-03)', async ({
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
