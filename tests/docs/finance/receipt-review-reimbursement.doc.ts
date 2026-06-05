import { eq } from 'drizzle-orm';
import type { Locator, Page } from '@playwright/test';

import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

const approvalQueueReceiptSurface = (
  page: Page,
  receiptFileName: string,
): Locator =>
  page.locator('app-receipt-approval-list section').filter({
    has: page.getByRole('link', { name: receiptFileName }),
  });

const receiptReviewDecisionSurface = (page: Page): Locator =>
  page
    .locator('app-receipt-approval-detail section')
    .filter({ has: page.getByRole('heading', { name: 'Receipt data' }) })
    .filter({
      has: page.getByText(
        'Approving or rejecting this receipt records the review status and queues a submitter email after saving.',
      ),
    })
    .first();

const recordedReimbursementStateSurface = (page: Page): Locator =>
  page
    .locator('app-receipt-refund-list')
    .filter({ has: page.getByText('Selected total: 0.00 €') })
    .first();

test('Review and reimburse receipts @finance', async ({
  database,
  page,
  permissionOverride,
  tenant,
}, testInfo) => {
  const receiptFileName = 'kitchen-supplies.pdf';
  const receipt = await database.query.financeReceipts.findFirst({
    where: {
      attachmentFileName: receiptFileName,
      tenantId: tenant.id,
    },
  });
  if (!receipt) {
    throw new Error('Expected generated receipt review docs receipt');
  }
  const receiptSubmitter = await database.query.users.findFirst({
    columns: {
      communicationEmail: true,
    },
    where: { id: receipt.submittedByUserId },
  });
  if (!receiptSubmitter) {
    throw new Error('Expected generated receipt submitter');
  }
  let refundTransactionId: null | string = null;

  await permissionOverride({
    add: ['finance:approveReceipts', 'finance:refundReceipts'],
    roleName: 'Section member',
  });

  try {
    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="User permissions" %}
This workflow requires:
- **finance:approveReceipts** to review submitted receipts.
- **finance:refundReceipts** to record manual reimbursement transactions for approved receipts.
{% /callout %}

# Receipt Review and Reimbursement

Finance users review submitted receipts first. Approved receipts then appear in the reimbursement queue, grouped by submitter and payout details.
`,
    });

    await page.goto('/finance/receipts-approval');
    await expect(
      page
        .locator('app-receipt-approval-list')
        .getByRole('heading', { level: 1, name: 'Receipt approvals' }),
    ).toBeVisible();

    await testInfo.attach('markdown', {
      body: `
## Receipt Approval Queue

The approval queue groups submitted receipts by event. Each receipt links to a review page where finance users can inspect the attachment metadata and validate the submitted amounts before approving or rejecting it.
`,
    });
    await expect(
      page.getByRole('link', { name: receiptFileName }),
    ).toHaveAttribute('href', `/finance/receipts-approval/${receipt.id}`);
    const approvalQueueReceipt = approvalQueueReceiptSurface(
      page,
      receiptFileName,
    );
    await expect(approvalQueueReceipt).toBeVisible();
    await takeScreenshot(
      testInfo,
      approvalQueueReceipt,
      page,
      'Receipt approval queue with reimbursable receipt submissions',
    );

    await page.getByRole('link', { name: receiptFileName }).click();
    await expect(
      page.getByRole('heading', { name: 'Review receipt' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Approving or rejecting this receipt records the review status and queues a submitter email after saving.',
      ),
    ).toBeVisible();

    await testInfo.attach('markdown', {
      body: `
## Review Details

The review page shows the receipt file, normalized receipt data, tax/deposit/alcohol fields, and the queued-notification caveat. Approving or rejecting updates Evorto's receipt status and queues the submitter email for delivery.
`,
    });
    const receiptReviewDecision = receiptReviewDecisionSurface(page);
    await expect(receiptReviewDecision).toBeVisible();
    await takeScreenshot(
      testInfo,
      receiptReviewDecision,
      page,
      'Receipt review detail with reimbursement decision controls',
    );

    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page).toHaveURL(/\/finance\/receipts-approval$/);
    await expect
      .poll(async () => {
        const approvedReceipt = await database.query.financeReceipts.findFirst({
          columns: {
            status: true,
          },
          where: { id: receipt.id },
        });

        return approvedReceipt?.status;
      })
      .toBe('approved');

    await page.goto('/finance/receipts-refunds');
    await expect(
      page
        .locator('app-receipt-refund-list')
        .getByRole('heading', { level: 1, name: 'Receipt reimbursements' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Recording a reimbursement creates the Evorto finance transaction only. Transfer the money manually through the selected payout method.',
      ),
    ).toBeVisible();
    await expect(
      page.getByText('No approved receipts are waiting for reimbursement.'),
    ).not.toBeVisible();

    await testInfo.attach('markdown', {
      body: `
## Reimbursement Queue

Approved receipts are grouped by recipient. The contact email shown for each recipient is the submitter's notification email when configured, falling back to login email. Finance users select the receipts to include, choose one of the submitter's saved payout details, and record the manual reimbursement transaction for that batch.
`,
    });

    const reimbursementGroup = page
      .locator('section', {
        has: page.getByRole('button', { name: 'Record reimbursement' }),
      })
      .filter({ hasText: receiptFileName })
      .first();
    await expect(reimbursementGroup).toBeVisible();
    await expect(
      reimbursementGroup.getByText(receiptSubmitter.communicationEmail),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      reimbursementGroup,
      page,
      'Receipt reimbursement group with approved manual payout totals',
    );

    await reimbursementGroup
      .locator('tr.mat-mdc-row', { hasText: receiptFileName })
      .locator('input[type="checkbox"]')
      .check();
    await expect(
      reimbursementGroup.getByRole('button', { name: 'Record reimbursement' }),
    ).toBeEnabled();
    await reimbursementGroup
      .getByRole('button', { name: 'Record reimbursement' })
      .click();

    await expect(
      page.getByText('Selected total: 0.00 €').first(),
    ).toBeVisible();
    const recordedReimbursementState = recordedReimbursementStateSurface(page);
    await expect(recordedReimbursementState).toBeVisible();
    await takeScreenshot(
      testInfo,
      recordedReimbursementState,
      page,
      'Receipt reimbursement page after recording the manual transaction',
    );
    const refundedReceipt = await database.query.financeReceipts.findFirst({
      where: {
        id: receipt.id,
        tenantId: tenant.id,
      },
    });
    if (!refundedReceipt) {
      throw new Error(
        'Expected generated receipt review docs receipt after reimbursement',
      );
    }
    refundTransactionId = refundedReceipt.refundTransactionId;
    expect(refundedReceipt).toEqual(
      expect.objectContaining({
        refundTransactionId: expect.any(String),
        status: 'refunded',
      }),
    );

    await testInfo.attach('markdown', {
      body: `
After recording the reimbursement, the selected receipt leaves the active reimbursement selection and the selected total resets. The action records an Evorto transaction; actual money movement remains a manual finance operation.
`,
    });
  } finally {
    const currentReceipt = await database.query.financeReceipts.findFirst({
      columns: {
        refundTransactionId: true,
      },
      where: { id: receipt.id },
    });
    refundTransactionId ??= currentReceipt?.refundTransactionId ?? null;
    await database
      .update(schema.financeReceipts)
      .set({
        refundedAt: receipt.refundedAt,
        refundedByUserId: receipt.refundedByUserId,
        refundTransactionId: receipt.refundTransactionId,
        reviewedAt: receipt.reviewedAt,
        reviewedByUserId: receipt.reviewedByUserId,
        status: receipt.status,
      })
      .where(eq(schema.financeReceipts.id, receipt.id));
    const createdRefundTransactionId =
      refundTransactionId && refundTransactionId !== receipt.refundTransactionId
        ? refundTransactionId
        : null;
    if (createdRefundTransactionId) {
      await database
        .delete(schema.transactions)
        .where(eq(schema.transactions.id, createdRefundTransactionId));
    }
  }
});
