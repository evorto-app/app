import { eq, inArray } from 'drizzle-orm';
import path from 'node:path';

import {
  addAvailableConsumedFinanceReceiptUpload,
  addConsumedFinanceReceiptUpload,
} from '../../../helpers/add-finance-receipt-upload';
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
  const missingEvidenceReceiptId = getId();
  const missingEvidenceFileName = `receipt-missing-evidence-doc-${seedDate.getTime()}.pdf`;
  const organizerCommunicationEmail = `delivered+receipt-doc-${receiptId}@resend.dev`;
  const approvalNotificationIdempotencyKey = `receipt-reviewed/${tenant.id}/${receiptId}/approved`;
  const rejectionNotificationIdempotencyKey = `receipt-reviewed/${tenant.id}/${missingEvidenceReceiptId}/rejected`;
  const missingEvidenceRejectionReason =
    'The uploaded receipt evidence is unavailable.';
  let receiptUploadId: string | undefined;
  let missingEvidenceUploadId: string | undefined;
  let refundTransactionId: string | undefined;

  try {
    await database
      .update(schema.users)
      .set({
        communicationEmail: organizerCommunicationEmail,
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
    missingEvidenceUploadId = await addConsumedFinanceReceiptUpload(database, {
      eventId,
      fileName: missingEvidenceFileName,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      tenantId: tenant.id,
      uploadedByUserId: organizerUser.id,
    });
    await database.insert(schema.financeReceipts).values([
      {
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
      },
      {
        alcoholAmount: 0,
        attachmentFileName: missingEvidenceFileName,
        attachmentMimeType: 'application/pdf',
        attachmentSizeBytes: 1024,
        attachmentUploadId: missingEvidenceUploadId,
        currency: tenant.currency,
        depositAmount: 0,
        eventId,
        hasAlcohol: false,
        hasDeposit: false,
        id: missingEvidenceReceiptId,
        purchaseCountry: 'DE',
        receiptDate: new Date(seedDate.getTime() - 1000 * 60 * 60 * 24),
        status: 'submitted',
        submittedByUserId: organizerUser.id,
        taxAmount: 100,
        tenantId: tenant.id,
        totalAmount: 1000,
      },
    ]);

    await page.goto('.');
    await testInfo.attach('markdown', {
      body: `
# Review and reimburse receipts

Use this guide when you review submitted event receipts and record reimbursements for your current organization.

{% callout type="note" title="Account and permission requirements" %}
You must be signed in to the organization that owns the receipt. Role names are defined by each organization; the account needs **Approve receipts** access to approve or reject a receipt and **Record receipt reimbursements** access to record the later reimbursement. One account may hold both permissions, or the two steps may be handled by different finance users.
{% /callout %}

Before you begin:

- An event organizer must already have submitted the receipt for an event in this organization.
- The uploaded receipt image or PDF must still be available for review.
- The submitter needs an IBAN or PayPal address in their profile before a finance user can record the matching payout method.
- Approval or rejection schedules an email to the submitter. Delivery may take a short time.
- Evorto records the reimbursement only after you transfer the money outside Evorto by the selected bank or PayPal method. It does not send that money.

The receipt keeps the currency recorded at submission even if the organization default changes later.

## Open the approval queue

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
    await expect(
      page.getByText(
        'Receipt approved and the submitter notification was queued.',
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
The success message confirms that the review was saved and the submitter will be notified. The receipt now has **approved** status and records the reviewer. Email delivery may take a short time.

## Recover when the evidence is missing

The approval queue may list a receipt whose uploaded file is no longer available. Open that receipt from the same queue. Evorto disables approval, keeps rejection available, and requires a rejection reason. This review screen cannot replace the missing file, so reject the receipt and explain what the submitter needs to correct.
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
          'Receipt evidence is unavailable. Approval is disabled until the uploaded file can be verified. You can still reject this receipt.',
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
    const rejectButton = page.getByRole('button', { name: 'Reject' });
    await expect(rejectButton).toBeDisabled();
    await takeScreenshot(
      testInfo,
      page.locator('app-receipt-approval-detail'),
      page,
      'Missing receipt evidence recovery',
    );
    await page
      .getByLabel('Reason shown to the submitter')
      .fill(missingEvidenceRejectionReason);
    await expect(rejectButton).toBeEnabled();
    await rejectButton.click();
    await expect(
      page.getByText(
        'Receipt rejected and the submitter notification was queued.',
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
      'Receipt reimbursement queue',
    );

    const reimbursementSection = page.locator('section', {
      has: page.getByText(receiptFileName),
    });
    await expect(
      reimbursementSection.getByText('IBAN: DE00123456781234567890'),
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
Recording reimbursement updates the receipt to **Reimbursed** and creates a successful manual refund transaction in Evorto using the receipt's recorded currency. The actual bank or PayPal transfer remains an external finance action.
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
  }
});
