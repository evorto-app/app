import { eq } from 'drizzle-orm';
import path from 'node:path';

import { addAvailableConsumedFinanceReceiptUpload } from '../../../helpers/add-finance-receipt-upload';
import { getId } from '../../../helpers/get-id';
import {
  adminStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { expectReceiptPdfPreviewAvailable } from '../../support/utils/receipt-submission';

test.use({ storageState: adminStateFile });

test('Review and reimburse receipts @finance', async ({
  database,
  page,
  seedDate,
  seeded,
  tenant,
}, testInfo) => {
  const organizerUser = usersToAuthenticate.find(
    (user) => user.roles === 'organizer',
  );
  if (!organizerUser) {
    throw new Error('Expected seeded organizer user for receipt docs');
  }

  const originalOrganizer = await database.query.users.findFirst({
    where: { id: organizerUser.id },
  });
  if (!originalOrganizer) {
    throw new Error('Expected organizer user record for receipt docs');
  }

  const eventId = seeded.scenario.events.past.eventId;
  const receiptId = getId();
  const receiptFileName = `receipt-review-doc-${seedDate.getTime()}.pdf`;
  let receiptUploadId: string | undefined;
  let refundTransactionId: string | undefined;

  try {
    await database
      .update(schema.users)
      .set({
        communicationEmail: `delivered+receipt-doc-${receiptId}@resend.dev`,
        iban: 'DE00123456781234567890',
        paypalEmail: 'organizer-refunds@example.com',
      })
      .where(eq(schema.users.id, organizerUser.id));

    const receiptUpload = await addAvailableConsumedFinanceReceiptUpload(
      database,
      {
        eventId,
        fileName: receiptFileName,
        mimeType: 'application/pdf',
        sourceFilePath: path.resolve('tests/fixtures/sample-receipt.pdf'),
        tenantId: tenant.id,
        uploadedByUserId: organizerUser.id,
      },
    );
    receiptUploadId = receiptUpload.id;
    await database.insert(schema.financeReceipts).values({
      alcoholAmount: 150,
      attachmentFileName: receiptFileName,
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: receiptUpload.sizeBytes,
      attachmentUploadId: receiptUploadId,
      currency: tenant.currency,
      depositAmount: 150,
      eventId,
      hasAlcohol: true,
      hasDeposit: true,
      id: receiptId,
      purchaseCountry: 'DE',
      receiptDate: new Date(seedDate.getTime() - 1000 * 60 * 60 * 24 * 2),
      status: 'submitted',
      submittedByUserId: organizerUser.id,
      taxAmount: 0,
      tenantId: tenant.id,
      totalAmount: 1450,
    });

    await testInfo.attach('markdown', {
      body: `
# Review and reimburse receipts

Finance users review submitted receipts before recording manual reimbursement. This guide starts with a receipt that an event organizer has already submitted for a past event. Its currency is recorded with the receipt and remains stable even if tenant defaults change later.
`,
    });

    await page.goto('/finance/receipts-approval');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Receipt approvals' }),
    ).toBeVisible();
    await expect(page.getByText(receiptFileName)).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('app-receipt-approval-list'),
      page,
      'Receipt approval queue',
    );

    await testInfo.attach('markdown', {
      body: `
## Review the submitted receipt

Open a receipt from the approval queue to inspect the attachment metadata, submitted amounts, country, alcohol/deposit flags, and the manual submitter-notification notice.
`,
    });

    await page.getByRole('link', { name: new RegExp(receiptFileName) }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Review receipt' }),
    ).toBeVisible();
    await expect(page.getByText(receiptFileName)).toBeVisible();
    await expectReceiptPdfPreviewAvailable({ page });
    await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled();
    await takeScreenshot(
      testInfo,
      page.locator('app-receipt-approval-detail'),
      page,
      'Receipt approval detail',
    );

    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page).toHaveURL(/\/finance\/receipts-approval$/);

    const approvedReceipt = await database.query.financeReceipts.findFirst({
      where: { id: receiptId, tenantId: tenant.id },
    });
    expect(approvedReceipt).toEqual(
      expect.objectContaining({
        reviewedByUserId: expect.any(String),
        status: 'approved',
      }),
    );

    await testInfo.attach('markdown', {
      body: `
## Record reimbursement

After approval, the receipt appears on **Receipt reimbursements**, grouped by submitter and recorded currency. Select the approved row, confirm the payout method and payout details, then record the reimbursement after the money has been transferred outside Evorto.
`,
    });

    await page.goto('/finance/receipts-refunds');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Receipt reimbursements' }),
    ).toBeVisible();
    await expect(page.getByText(receiptFileName)).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('app-receipt-refund-list'),
      page,
      'Receipt reimbursement queue',
    );

    const reimbursementSection = page.locator('section', {
      has: page.getByText(receiptFileName),
    });
    await reimbursementSection
      .locator('tr.mat-mdc-row input[type="checkbox"]')
      .check();
    await expect(
      reimbursementSection.getByText('Selected total: 14,50 €'),
    ).toBeVisible();
    await reimbursementSection
      .getByRole('button', { name: 'Record reimbursement' })
      .click();
    await expect(
      page.getByText('Reimbursement transaction recorded'),
    ).toBeVisible();

    await expect
      .poll(() =>
        database.query.financeReceipts.findFirst({
          where: { id: receiptId, tenantId: tenant.id },
        }),
      )
      .toMatchObject({
        refundedByUserId: expect.any(String),
        status: 'refunded',
      });
    const refundedReceipt = await database.query.financeReceipts.findFirst({
      where: { id: receiptId, tenantId: tenant.id },
    });
    if (!refundedReceipt?.refundTransactionId) {
      throw new Error('Expected receipt reimbursement to create a transaction');
    }
    const createdRefundTransactionId = refundedReceipt.refundTransactionId;
    refundTransactionId = createdRefundTransactionId;
    const reimbursementTransaction =
      await database.query.transactions.findFirst({
        where: { id: createdRefundTransactionId, tenantId: tenant.id },
      });
    expect(reimbursementTransaction).toEqual(
      expect.objectContaining({
        currency: tenant.currency,
        status: 'successful',
      }),
    );

    await testInfo.attach('markdown', {
      body: `
Recording reimbursement updates the receipt to **refunded** and creates a successful manual refund transaction in Evorto using the receipt's recorded currency. The actual bank or PayPal transfer remains an external finance action.
`,
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
