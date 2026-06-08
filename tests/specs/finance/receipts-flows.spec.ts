import path from 'node:path';

import type { Page } from '@playwright/test';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { adminStateFile } from '../../../helpers/user-data';
import { createId } from '../../../src/db/create-id';
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
  receiptFileName,
  receiptId,
  seedDate,
  submittedByUserId,
  tenantId,
}: {
  database: NodePgDatabase<typeof relations>;
  eventId: string;
  receiptFileName: string;
  receiptId: string;
  seedDate: Date;
  submittedByUserId: string;
  tenantId: string;
}) => {
  await database.insert(schema.financeReceipts).values({
    alcoholAmount: 150,
    attachmentFileName: receiptFileName,
    attachmentMimeType: 'application/pdf',
    attachmentSizeBytes: 1024,
    depositAmount: 150,
    eventId,
    hasAlcohol: true,
    hasDeposit: true,
    id: receiptId,
    purchaseCountry: 'DE',
    receiptDate: new Date(seedDate.getTime() - 1000 * 60 * 60 * 24 * 2),
    status: 'submitted',
    submittedByUserId,
    taxAmount: 0,
    tenantId,
    totalAmount: 1450,
  });
};

test('submit receipt from event organize page', async ({ page, seeded }) => {
  const eventId = seeded.scenario.events.past.eventId;
  const receiptFile = path.resolve('tests/fixtures/sample-receipt.pdf');
  await submitReceiptFromFirstEvent(page, eventId, receiptFile);
});

test('approve and record receipt reimbursements in finance', async ({
  database,
  page,
  seedDate,
  seeded,
  tenant,
}) => {
  const seededEventId = seeded.scenario.events.past.eventId;
  const receiptId = getId();
  const receiptFileName = `approval-reimbursement-${seedDate.getTime()}.pdf`;
  const reimbursementUserId = createId();
  await database.insert(schema.users).values({
    auth0Id: `receipt-flow-${reimbursementUserId}`,
    communicationEmail: `receipt-flow-${reimbursementUserId}@example.com`,
    email: `receipt-flow-${reimbursementUserId}@example.com`,
    firstName: 'Receipt',
    iban: 'DE00123456781234567890',
    id: reimbursementUserId,
    lastName: 'Recipient',
    paypalEmail: 'organizer-refunds@example.com',
  });
  await seedPendingReceiptForApproval({
    database,
    eventId: seededEventId,
    receiptFileName,
    receiptId,
    seedDate,
    submittedByUserId: reimbursementUserId,
    tenantId: tenant.id,
  });

  const escapedReceiptFileName = receiptFileName.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
  await page.goto('/finance/receipts-approval');
  const pendingReceipt = page.getByRole('link', {
    name: new RegExp(escapedReceiptFileName),
  });
  await expect(pendingReceipt).toHaveAttribute(
    'href',
    `/finance/receipts-approval/${receiptId}`,
  );
  await pendingReceipt.click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page).toHaveURL(/\/finance\/receipts-approval$/);
  await expect
    .poll(async () => {
      const approvedReceipt = await database.query.financeReceipts.findFirst({
        columns: {
          status: true,
        },
        where: {
          id: receiptId,
          tenantId: tenant.id,
        },
      });

      return approvedReceipt?.status;
    })
    .toBe('approved');

  await page.goto('/finance/receipts-refunds');
  await expect(
    page.getByText(
      'Recording a reimbursement creates the Evorto finance transaction only. Transfer the money manually through the selected payout method.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText('No approved receipts are waiting for reimbursement.'),
  ).not.toBeVisible();

  const refundSection = page.locator('section', {
    has: page.getByText(receiptFileName),
  });
  await expect(refundSection).toBeVisible();

  await expect(refundSection.locator('table[mat-table]')).toBeVisible();
  await refundSection
    .locator('tr.mat-mdc-row', { hasText: receiptFileName })
    .locator('input[type="checkbox"]')
    .check();

  const issueRefundButton = refundSection.getByRole('button', {
    name: 'Record reimbursement',
  });
  await expect(issueRefundButton).toBeEnabled();
  await issueRefundButton.click();

  await expect
    .poll(async () => {
      return database.query.financeReceipts.findFirst({
        where: {
          id: receiptId,
          tenantId: tenant.id,
        },
      });
    })
    .toMatchObject({
      refundTransactionId: expect.any(String),
      status: 'refunded',
    });

  await expect(page.getByText('Selected total: 0.00 €').first()).toBeVisible();

  const refundedReceipt = await database.query.financeReceipts.findFirst({
    where: {
      id: receiptId,
      tenantId: tenant.id,
    },
  });
  if (!refundedReceipt) {
    throw new Error('Expected seeded receipt after reimbursement recording');
  }
});

test('receipt dialog shows Other option when tenant allows it', async ({
  database,
  page,
  seeded,
  tenant,
}) => {
  const existingTenant = await database.query.tenants.findFirst({
    where: { id: tenant.id },
  });
  if (!existingTenant) {
    throw new Error('Expected tenant fixture before receipt settings update');
  }

  await database
    .update(schema.tenants)
    .set({
      discountProviders: existingTenant.discountProviders,
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
