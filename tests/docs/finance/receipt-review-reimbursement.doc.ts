import { eq, inArray } from 'drizzle-orm';
import path from 'node:path';

import {
  addAvailableConsumedFinanceReceiptUpload,
  addConsumedFinanceReceiptUpload,
} from '../../../helpers/add-finance-receipt-upload';
import { getId } from '../../../helpers/get-id';
import { adminStateFile } from '../../../helpers/user-data';
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
  const eventId = seeded.scenario.events.past.eventId;
  const reimbursementUserId = getId();
  const receiptId = getId();
  const receiptFileName = 'event-supplies.pdf';
  const missingEvidenceReceiptId = getId();
  const missingEvidenceFileName = 'cafe-receipt.pdf';
  const organizerCommunicationEmail = 'alex.organizer@example.org';
  const approvalNotificationIdempotencyKey = `receipt-reviewed/${tenant.id}/${receiptId}/approved`;
  const rejectionNotificationIdempotencyKey = `receipt-reviewed/${tenant.id}/${missingEvidenceReceiptId}/rejected`;
  const missingEvidenceRejectionReason =
    'The uploaded receipt file is unavailable.';
  let receiptUploadId: string | undefined;
  let missingEvidenceUploadId: string | undefined;
  let refundTransactionId: string | undefined;

  try {
    await database.insert(schema.users).values({
      auth0Id: `test|receipt-doc-${reimbursementUserId}`,
      communicationEmail: organizerCommunicationEmail,
      email: 'casey.receipts@example.org',
      firstName: 'Event',
      iban: 'DE89370400440532013000',
      id: reimbursementUserId,
      lastName: 'Organizer',
      paypalEmail: 'organizer-refunds@example.com',
    });

    const receiptUpload = await addAvailableConsumedFinanceReceiptUpload(
      database,
      {
        eventId,
        fileName: receiptFileName,
        mimeType: 'application/pdf',
        sourceFilePath: path.resolve('tests/fixtures/sample-receipt.pdf'),
        tenantId: tenant.id,
        uploadedByUserId: reimbursementUserId,
      },
    );
    receiptUploadId = receiptUpload.id;
    missingEvidenceUploadId = await addConsumedFinanceReceiptUpload(database, {
      eventId,
      fileName: missingEvidenceFileName,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      tenantId: tenant.id,
      uploadedByUserId: reimbursementUserId,
    });
    await database.insert(schema.financeReceipts).values([
      {
        alcoholAmount: 150,
        attachmentFileName: receiptFileName,
        attachmentUploadId: receiptUploadId,
        currency: tenant.currency,
        depositAmount: 150,
        eventId,
        hasAlcohol: true,
        hasDeposit: true,
        id: receiptId,
        purchaseCountry: 'DE',
        receiptDate: new Date(seedDate.getTime() - 1000 * 60 * 60 * 24 * 2)
          .toISOString()
          .slice(0, 10),
        status: 'submitted',
        submittedByUserId: reimbursementUserId,
        taxAmount: 0,
        tenantId: tenant.id,
        totalAmount: 1450,
      },
      {
        alcoholAmount: 0,
        attachmentFileName: missingEvidenceFileName,
        attachmentUploadId: missingEvidenceUploadId,
        currency: tenant.currency,
        depositAmount: 0,
        eventId,
        hasAlcohol: false,
        hasDeposit: false,
        id: missingEvidenceReceiptId,
        purchaseCountry: 'DE',
        receiptDate: new Date(seedDate.getTime() - 1000 * 60 * 60 * 24)
          .toISOString()
          .slice(0, 10),
        status: 'submitted',
        submittedByUserId: reimbursementUserId,
        taxAmount: 100,
        tenantId: tenant.id,
        totalAmount: 1000,
      },
    ]);

    await page.goto('.');
    await testInfo.attach('markdown', {
      body: `

Use this guide when you review submitted event receipts and record reimbursements for your current organization.

{% callout type="note" title="Who can do this" %}
You must be signed in to the organization that owns the receipt. Role names are defined by each organization; you need **Approve receipts** access to approve or reject a receipt and **Record receipt reimbursements** access to record the later reimbursement. One person may have access to both, or two finance team members may handle the separate steps.
{% /callout %}

Before you begin:

- An event organizer must already have submitted the receipt for an event in this organization.
- The uploaded receipt must still be available for review.
- The submitter needs an IBAN or PayPal address in their profile before a finance team member can record how they were paid.
- After you save an approval or rejection, Evorto tries to email the submitter. Delivery may take time or fail.
- Evorto records the reimbursement only after you transfer the money outside Evorto by the selected bank or PayPal method. It does not send that money.

The receipt keeps the currency recorded at submission even if the organization default changes later.

## Open receipts awaiting approval

From the main navigation, select **Finances**, then **Receipt approvals**.
`,
    });

    await page.getByRole('link', { name: 'Finances', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Finances' }),
    ).toBeVisible();
    await page
      .getByRole('link', { name: 'Receipt approvals', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Receipt approvals' }),
    ).toBeVisible();
    await expect(page.getByText(receiptFileName)).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('app-receipt-approval-list'),
      page,
      'Receipts awaiting approval',
    );

    await testInfo.attach('markdown', {
      body: `
## Review the submitted receipt

Open a receipt from the list to review the uploaded file, submitted amounts, country, alcohol or deposit details, and the notice about emailing the submitter.
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
    await expect(
      page.getByText(
        'Receipt approved. Evorto will now try to email the submitter.',
      ),
    ).toBeVisible();
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
    await expect
      .poll(() =>
        database.query.emailOutbox.findFirst({
          where: {
            idempotencyKey: approvalNotificationIdempotencyKey,
            tenantId: tenant.id,
          },
        }),
      )
      .toMatchObject({
        idempotencyKey: approvalNotificationIdempotencyKey,
        kind: 'receiptReviewed',
        subject: 'Receipt approved',
        tenantId: tenant.id,
        toEmail: organizerCommunicationEmail,
      });

    await testInfo.attach('markdown', {
      body: `
The success message confirms that the review was saved. The receipt now shows **Approved** and the reviewer's name; Evorto then attempts to email the submitter.

## When the uploaded file is missing

The list may include a receipt whose uploaded file is no longer available. Open that receipt from the same list. Evorto disables approval, keeps rejection available, and requires a rejection reason. This page cannot replace the missing file. Reject the receipt and tell the submitter that the uploaded file is unavailable and that they need to submit a new receipt with a readable file attached.
`,
    });

    await page
      .getByRole('link', { name: new RegExp(missingEvidenceFileName) })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Review receipt' }),
    ).toBeVisible();
    await expect(
      page.getByRole('alert').filter({
        hasText:
          'The uploaded receipt file is unavailable. You cannot approve the receipt until the file can be checked, but you can still reject it.',
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
    const rejectButton = page.getByRole('button', { name: 'Reject' });
    await expect(rejectButton).toBeDisabled();
    await takeScreenshot(
      testInfo,
      page.locator('app-receipt-approval-detail'),
      page,
      'Receipt file unavailable during review',
    );
    await page
      .getByLabel('Reason shown to the submitter')
      .fill(missingEvidenceRejectionReason);
    await expect(rejectButton).toBeEnabled();
    await rejectButton.click();
    await expect(
      page.getByText(
        'Receipt rejected. Evorto will now try to email the submitter.',
      ),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/finance\/receipts-approval$/);
    await expect
      .poll(() =>
        database.query.financeReceipts.findFirst({
          where: { id: missingEvidenceReceiptId, tenantId: tenant.id },
        }),
      )
      .toMatchObject({
        rejectionReason: missingEvidenceRejectionReason,
        reviewedByUserId: expect.any(String),
        status: 'rejected',
      });
    await expect
      .poll(() =>
        database.query.emailOutbox.findFirst({
          where: {
            idempotencyKey: rejectionNotificationIdempotencyKey,
            tenantId: tenant.id,
          },
        }),
      )
      .toMatchObject({
        idempotencyKey: rejectionNotificationIdempotencyKey,
        kind: 'receiptReviewed',
        subject: 'Receipt rejected',
        tenantId: tenant.id,
        toEmail: organizerCommunicationEmail,
      });

    await testInfo.attach('markdown', {
      body: `
## Record reimbursement

After approval, return to **Finances** and open **Receipt reimbursements**. The approved receipt is grouped by submitter and recorded currency. Select the approved row, confirm the payout method and payout details, transfer the money outside Evorto, and only then record the reimbursement.
`,
    });

    await page.getByRole('link', { name: 'Finances', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Finances' }),
    ).toBeVisible();
    await page
      .getByRole('link', { name: 'Receipt reimbursements', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Receipt reimbursements' }),
    ).toBeVisible();
    await expect(page.getByText(receiptFileName)).toBeVisible();
    await expect(page.getByText(missingEvidenceFileName)).toHaveCount(0);
    await takeScreenshot(
      testInfo,
      page.locator('app-receipt-refund-list'),
      page,
      'Receipts awaiting reimbursement',
    );

    const reimbursementSection = page.locator('section', {
      has: page.getByText(receiptFileName),
    });
    await expect(
      reimbursementSection.getByText('IBAN: DE89370400440532013000'),
    ).toBeVisible();
    await expect(
      reimbursementSection.getByText('PayPal: organizer-refunds@example.com'),
    ).toBeVisible();
    await reimbursementSection
      .locator('tr.mat-mdc-row input[type="checkbox"]')
      .check();
    await expect(
      reimbursementSection.getByText('Selected total: 14,50 €'),
    ).toBeVisible();
    await reimbursementSection
      .getByRole('button', { name: 'Record reimbursement' })
      .click();
    const confirmationDialog = page.getByRole('dialog', {
      name: 'Record reimbursement?',
    });
    await expect(confirmationDialog).toBeVisible();
    await expect(
      confirmationDialog.getByText('Bank transfer · DE89370400440532013000'),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      confirmationDialog,
      page,
      'Confirm receipt reimbursement',
    );
    await confirmationDialog
      .getByRole('button', { name: 'Record reimbursement' })
      .click();
    await expect(page.getByText('Reimbursement recorded')).toBeVisible();

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
Recording reimbursement updates the receipt to **Reimbursed**. This confirms that the bank or PayPal transfer was completed outside Evorto; Evorto does not send the money.
`,
    });
  } finally {
    await database
      .delete(schema.financeReceipts)
      .where(eq(schema.financeReceipts.id, receiptId));
    await database
      .delete(schema.financeReceipts)
      .where(eq(schema.financeReceipts.id, missingEvidenceReceiptId));
    if (receiptUploadId) {
      await database
        .delete(schema.financeReceiptUploads)
        .where(eq(schema.financeReceiptUploads.id, receiptUploadId));
    }
    if (missingEvidenceUploadId) {
      await database
        .delete(schema.financeReceiptUploads)
        .where(eq(schema.financeReceiptUploads.id, missingEvidenceUploadId));
    }
    if (refundTransactionId) {
      await database
        .delete(schema.transactions)
        .where(eq(schema.transactions.id, refundTransactionId));
    }
    await database
      .delete(schema.emailOutbox)
      .where(
        inArray(schema.emailOutbox.idempotencyKey, [
          approvalNotificationIdempotencyKey,
          rejectionNotificationIdempotencyKey,
        ]),
      );
    await database
      .delete(schema.users)
      .where(eq(schema.users.id, reimbursementUserId));
  }
});
