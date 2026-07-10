import path from 'node:path';

import type { Page } from '@playwright/test';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, desc, eq } from 'drizzle-orm';

import { addConsumedFinanceReceiptUpload } from '../../../helpers/add-finance-receipt-upload';
import { getId } from '../../../helpers/get-id';
import {
  adminStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';
import type { SupportedTenantCurrency } from '../../../src/types/custom/tenant';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: adminStateFile });

const openEventOrganizePage = async (page: Page, eventId: string) => {
  await page.goto(`/events/${eventId}/organize`);
};

const formatTenantCurrency = (
  amountInMinorUnits: number,
  currency: SupportedTenantCurrency,
): string =>
  new Intl.NumberFormat('de-DE', {
    currency,
    style: 'currency',
  }).format(amountInMinorUnits / 100);

const submitReceiptFromFirstEvent = async (
  page: Page,
  eventId: string,
  receiptFile: string,
  currency: SupportedTenantCurrency,
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
    receiptDialog.getByLabel(`Deposit amount (${currency})`),
  ).not.toBeVisible();
  await receiptDialog
    .getByRole('checkbox', { name: 'Deposit involved' })
    .check();
  await expect(
    receiptDialog.getByLabel(`Deposit amount (${currency})`),
  ).toBeVisible();
  await expect(
    receiptDialog.getByLabel(`Alcohol amount (${currency})`),
  ).not.toBeVisible();
  await receiptDialog
    .getByRole('checkbox', { name: 'Alcohol purchased' })
    .check();
  await expect(
    receiptDialog.getByLabel(`Alcohol amount (${currency})`),
  ).toBeVisible();

  await receiptDialog.getByLabel(`Total amount (${currency})`).fill('14.50');
  await receiptDialog.getByLabel(`Alcohol amount (${currency})`).fill('1.50');
  await receiptDialog.getByLabel('Purchase country').click();
  await page.getByRole('option', { name: 'Germany (DE)' }).click();
  await receiptDialog
    .locator('input[type="file"][accept="image/*,application/pdf"]')
    .setInputFiles(receiptFile);
  await receiptDialog.getByRole('button', { name: 'Submit receipt' }).click();
  await expect(receiptDialog).not.toBeVisible();
  await expect(
    page.getByText(path.basename(receiptFile), { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
};

const seedPendingReceiptForApproval = async ({
  currency,
  database,
  eventId,
  receiptFileName,
  receiptId,
  seedDate,
  submittedByUserId,
  tenantId,
}: {
  currency: SupportedTenantCurrency;
  database: NodePgDatabase<typeof relations>;
  eventId: string;
  receiptFileName: string;
  receiptId: string;
  seedDate: Date;
  submittedByUserId: string;
  tenantId: string;
}) => {
  const receiptUploadId = await addConsumedFinanceReceiptUpload(database, {
    eventId,
    fileName: receiptFileName,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    tenantId,
    uploadedByUserId: submittedByUserId,
  });
  await database.insert(schema.financeReceipts).values({
    alcoholAmount: 150,
    attachmentFileName: receiptFileName,
    attachmentMimeType: 'application/pdf',
    attachmentSizeBytes: 1024,
    attachmentUploadId: receiptUploadId,
    currency,
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

  return receiptUploadId;
};

test('submit receipt from event organize page', async ({
  database,
  page,
  seeded,
  tenant,
}) => {
  const currency = 'AUD';
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
  let submittedReceiptId: string | undefined;
  let submittedUploadId: string | undefined;

  try {
    await database
      .update(schema.tenants)
      .set({ currency })
      .where(eq(schema.tenants.id, tenant.id));
    const now = new Date();
    await database
      .update(schema.eventInstances)
      .set({
        end: new Date(now.getTime() - 60 * 60 * 1000),
        start: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      })
      .where(eq(schema.eventInstances.id, eventId));

    await submitReceiptFromFirstEvent(page, eventId, receiptFile, currency);
    await expect(
      page.getByText(`Total: ${formatTenantCurrency(1450, currency)}`),
    ).toBeVisible();

    const [submittedReceipt] = await database
      .select()
      .from(schema.financeReceipts)
      .where(
        and(
          eq(schema.financeReceipts.eventId, eventId),
          eq(
            schema.financeReceipts.attachmentFileName,
            path.basename(receiptFile),
          ),
        ),
      )
      .orderBy(desc(schema.financeReceipts.createdAt))
      .limit(1);
    if (!submittedReceipt) {
      throw new Error('Expected submitted receipt after upload flow');
    }
    submittedReceiptId = submittedReceipt.id;
    submittedUploadId = submittedReceipt.attachmentUploadId;

    const uploadedReceipt =
      await database.query.financeReceiptUploads.findFirst({
        where: { id: submittedReceipt.attachmentUploadId },
      });
    expect(uploadedReceipt).toEqual(
      expect.objectContaining({
        consumedAt: expect.any(Date),
        eventId,
        id: submittedReceipt.attachmentUploadId,
        tenantId: submittedReceipt.tenantId,
        uploadedAt: expect.any(Date),
        uploadedByUserId: submittedReceipt.submittedByUserId,
      }),
    );
  } finally {
    if (submittedReceiptId) {
      await database
        .delete(schema.financeReceipts)
        .where(eq(schema.financeReceipts.id, submittedReceiptId));
    }
    if (submittedUploadId) {
      await database
        .delete(schema.financeReceiptUploads)
        .where(eq(schema.financeReceiptUploads.id, submittedUploadId));
    }
    await database
      .update(schema.eventInstances)
      .set({
        end: event.end,
        start: event.start,
      })
      .where(eq(schema.eventInstances.id, eventId));
  }
});

test('approve and record receipt reimbursements in finance', async ({
  database,
  page,
  seedDate,
  seeded,
  tenant,
}) => {
  const currency = 'CZK';
  const organizerUser = usersToAuthenticate.find(
    (user) => user.roles === 'organizer',
  );
  if (!organizerUser) {
    throw new Error('Expected seeded organizer user');
  }
  const originalOrganizer = await database.query.users.findFirst({
    where: { id: organizerUser.id },
  });
  if (!originalOrganizer) {
    throw new Error('Expected seeded organizer user record');
  }
  const seededEventId = seeded.scenario.events.past.eventId;
  const receiptId = getId();
  const receiptFileName = `approval-reimbursement-${seedDate.getTime()}.pdf`;
  let receiptUploadId: string | undefined;
  let refundTransactionId: string | undefined;
  try {
    await database
      .update(schema.tenants)
      .set({ currency })
      .where(eq(schema.tenants.id, tenant.id));
    await database
      .update(schema.users)
      .set({
        communicationEmail: `delivered+receipt-flow-${receiptId}@resend.dev`,
        iban: 'DE00123456781234567890',
        paypalEmail: 'organizer-refunds@example.com',
      })
      .where(eq(schema.users.id, organizerUser.id));

    receiptUploadId = await seedPendingReceiptForApproval({
      currency,
      database,
      eventId: seededEventId,
      receiptFileName,
      receiptId,
      seedDate,
      submittedByUserId: organizerUser.id,
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
    await expect(
      pendingReceipt.getByText(formatTenantCurrency(1450, currency)),
    ).toBeVisible();
    await pendingReceipt.click();
    await expect(page.getByLabel(`Total amount (${currency})`)).toHaveValue(
      '14.5',
    );
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page).toHaveURL(/\/finance\/receipts-approval$/);

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
      .locator('tr.mat-mdc-row input[type="checkbox"]')
      .first()
      .check();
    await expect(
      refundSection.getByText(
        `Selected total: ${formatTenantCurrency(1450, currency)}`,
      ),
    ).toBeVisible();

    const issueRefundButton = refundSection.getByRole('button', {
      name: 'Record reimbursement',
    });
    await expect(issueRefundButton).toBeEnabled();
    await issueRefundButton.click();

    await expect(
      page.getByText('Reimbursement transaction recorded'),
    ).toBeVisible();

    await expect
      .poll(() =>
        database.query.financeReceipts.findFirst({
          where: {
            id: receiptId,
            tenantId: tenant.id,
          },
        }),
      )
      .toMatchObject({
        refundTransactionId: expect.any(String),
        status: 'refunded',
      });
    const refundedReceipt = await database.query.financeReceipts.findFirst({
      where: {
        id: receiptId,
        tenantId: tenant.id,
      },
    });
    if (!refundedReceipt?.refundTransactionId) {
      throw new Error('Expected seeded receipt after reimbursement recording');
    }
    const createdRefundTransactionId = refundedReceipt.refundTransactionId;
    refundTransactionId = createdRefundTransactionId;
    await expect
      .poll(() =>
        database.query.transactions.findFirst({
          where: { id: createdRefundTransactionId, tenantId: tenant.id },
        }),
      )
      .toMatchObject({
        currency,
        status: 'successful',
      });
  } finally {
    await database
      .update(schema.users)
      .set({
        communicationEmail: originalOrganizer.communicationEmail,
        firstName: originalOrganizer.firstName,
        iban: originalOrganizer.iban,
        lastName: originalOrganizer.lastName,
        paypalEmail: originalOrganizer.paypalEmail,
      })
      .where(eq(schema.users.id, organizerUser.id));
    await database
      .delete(schema.financeReceipts)
      .where(eq(schema.financeReceipts.id, receiptId));
    if (receiptUploadId) {
      await database
        .delete(schema.financeReceiptUploads)
        .where(eq(schema.financeReceiptUploads.id, receiptUploadId));
    }
    if (refundTransactionId) {
      await database
        .delete(schema.transactions)
        .where(eq(schema.transactions.id, refundTransactionId));
    }
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
