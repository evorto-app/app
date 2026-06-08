import { inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import {
  organizerStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import type { Locator, Page } from '@playwright/test';

test.use({ storageState: organizerStateFile });

const financeOverviewNavigationSurface = (page: Page): Locator =>
  page
    .locator('app-finance-overview nav')
    .filter({ has: page.getByRole('link', { name: 'Transactions' }) })
    .filter({ has: page.getByRole('link', { name: 'Receipt approvals' }) })
    .filter({
      has: page.getByRole('link', { name: 'Receipt reimbursements' }),
    })
    .first();

const financeOverviewNavigationCard = (page: Page, name: string): Locator =>
  page.locator('app-finance-overview nav a').filter({ hasText: name }).first();

const transactionRow = (page: Page, comment: string): Locator =>
  page.getByRole('row').filter({ hasText: comment }).first();

const receiptApprovalRow = (page: Page, fileName: string): Locator =>
  page
    .locator('app-receipt-approval-list a')
    .filter({ hasText: fileName })
    .first();

const receiptReimbursementRow = (page: Page, fileName: string): Locator =>
  page.getByRole('row').filter({ hasText: fileName }).first();

test('Manage finances @finance', async ({
  database,
  permissionOverride,
  page,
  seedDate,
  seeded,
  tenant,
}, testInfo) => {
  const visibleTransactionId = getId();
  const cancelledTransactionId = getId();
  const submittedReceiptId = getId();
  const approvedReceiptId = getId();
  const visibleTransactionComment = `finance-doc-visible-${seedDate.getTime()}`;
  const cancelledTransactionComment = `finance-doc-cancelled-${seedDate.getTime()}`;
  const submittedReceiptFileName = `overview-submitted-${seedDate.getTime()}.pdf`;
  const approvedReceiptFileName = `overview-approved-${seedDate.getTime()}.pdf`;
  const organizerUserId = usersToAuthenticate.find(
    (user) => user.roles === 'organizer',
  )?.id;
  const adminUserId = usersToAuthenticate.find(
    (user) => user.roles === 'admin',
  )?.id;
  if (!organizerUserId) {
    throw new Error('Organizer test user configuration missing');
  }
  if (!adminUserId) {
    throw new Error('Admin test user configuration missing');
  }

  await permissionOverride({
    add: [
      'finance:viewTransactions',
      'finance:approveReceipts',
      'finance:refundReceipts',
    ],
    roleName: 'Section member',
  });

  await database.insert(schema.transactions).values([
    {
      amount: 4200,
      appFee: 210,
      comment: visibleTransactionComment,
      currency: 'EUR',
      id: visibleTransactionId,
      method: 'stripe',
      status: 'successful',
      stripeFee: 120,
      tenantId: tenant.id,
      type: 'other',
    },
    {
      amount: 1300,
      comment: cancelledTransactionComment,
      currency: 'EUR',
      id: cancelledTransactionId,
      method: 'stripe',
      status: 'cancelled',
      tenantId: tenant.id,
      type: 'other',
    },
  ]);
  await database.insert(schema.financeReceipts).values([
    {
      alcoholAmount: 0,
      attachmentFileName: submittedReceiptFileName,
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 12_400,
      attachmentStorageKey: `local-unavailable/${submittedReceiptId}.pdf`,
      depositAmount: 0,
      eventId: seeded.scenario.events.past.eventId,
      hasAlcohol: false,
      hasDeposit: false,
      id: submittedReceiptId,
      purchaseCountry: 'DE',
      receiptDate: new Date(seedDate.getTime() - 1000 * 60 * 60 * 24),
      status: 'submitted',
      submittedByUserId: organizerUserId,
      taxAmount: 190,
      tenantId: tenant.id,
      totalAmount: 1190,
    },
    {
      alcoholAmount: 150,
      attachmentFileName: approvedReceiptFileName,
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 18_200,
      attachmentStorageKey: `local-unavailable/${approvedReceiptId}.pdf`,
      depositAmount: 500,
      eventId: seeded.scenario.events.past.eventId,
      hasAlcohol: true,
      hasDeposit: true,
      id: approvedReceiptId,
      purchaseCountry: 'DE',
      receiptDate: new Date(seedDate.getTime() - 1000 * 60 * 60 * 48),
      reviewedAt: seedDate,
      reviewedByUserId: adminUserId,
      status: 'approved',
      submittedByUserId: organizerUserId,
      taxAmount: 320,
      tenantId: tenant.id,
      totalAmount: 2820,
    },
  ]);

  try {
    await page.goto('.');
    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="User permissions" %}
For this guide, we assume you have the finance permissions needed for each child page:
- **finance:viewTransactions**: view the tenant transaction list.
- **finance:approveReceipts**: review submitted receipts.
- **finance:refundReceipts**: record receipt reimbursement batches.
{% /callout %}

# Finance Management

The finance area groups transaction review, receipt approval, and receipt reimbursement recording. Each child page is guarded by its own finance permission.

## Accessing Finance Overview

To access the finance overview, navigate to the **Finances** section from the main menu.
`,
    });
    await page.getByRole('link', { name: 'Finances' }).click();
    const transactionNavigationCard = financeOverviewNavigationCard(
      page,
      'Transactions',
    );
    await expect(transactionNavigationCard).toBeVisible();
    await expect(
      financeOverviewNavigationCard(page, 'Receipt approvals'),
    ).toBeVisible();
    await expect(
      financeOverviewNavigationCard(page, 'Receipt reimbursements'),
    ).toBeVisible();
    const financeNavigation = financeOverviewNavigationSurface(page);
    await expect(financeNavigation).toBeVisible();
    await takeScreenshot(
      testInfo,
      financeNavigation,
      page,
      'Finance overview navigation with permission-scoped child pages',
    );

    await testInfo.attach('markdown', {
      body: `
## Finance Overview

The finance overview is a navigation surface. It shows links only for the finance capabilities you have, so users with receipt approval access do not automatically see the transaction list.
`,
    });

    await testInfo.attach('markdown', {
      body: `
## Transaction List

You can view a detailed list of all transactions by clicking on the **Transactions** tab. The table is the implemented finance ledger surface for reviewing tenant money movement and exported transaction context.
`,
    });

    await page.getByRole('link', { name: 'Transactions' }).click();
    await expect(page.getByText(visibleTransactionComment)).toBeVisible();
    await expect(page.getByText(cancelledTransactionComment)).toHaveCount(0);
    const visibleTransactionRow = transactionRow(
      page,
      visibleTransactionComment,
    );
    await expect(visibleTransactionRow).toBeVisible();
    await takeScreenshot(
      testInfo,
      visibleTransactionRow,
      page,
      'Transaction list page with filterable finance records',
    );

    await testInfo.attach('markdown', {
      body: `
The transaction list shows all financial transactions with details such as:

- Transaction ID
- Amount
- Status
- Date
- Payment method

Cancelled transactions are omitted from this list.
`,
    });

    await testInfo.attach('markdown', {
      body: `
## Receipt Approvals

The **Receipt approvals** tab shows all receipts waiting for finance review, grouped by event. Reviewers can open each receipt, validate submitted values, and approve or reject it. The detail page explains that receipt review queues a submitter email after saving.

Approving or rejecting records the review status in Evorto and queues the submitter email notification for delivery.
`,
    });
    await page.goto('/finance/receipts-approval');
    await expect(page.getByText(submittedReceiptFileName)).toBeVisible();
    const submittedReceiptRow = receiptApprovalRow(
      page,
      submittedReceiptFileName,
    );
    await expect(submittedReceiptRow).toBeVisible();
    await takeScreenshot(
      testInfo,
      submittedReceiptRow,
      page,
      'Receipt approval list with submitted reimbursement receipts',
    );

    await testInfo.attach('markdown', {
      body: `
## Receipt Reimbursements

The **Receipt reimbursements** tab groups approved receipts by recipient and renders each group in a selectable table. Recipient contact details use the submitter's notification email when configured, with login email as fallback. Finance users can select one or more rows, verify payout details (IBAN/PayPal), and record the manual reimbursement transaction for the selected batch.
`,
    });
    await page.goto('/finance/receipts-refunds');
    await expect(page.getByText(approvedReceiptFileName)).toBeVisible();
    const approvedReceiptRow = receiptReimbursementRow(
      page,
      approvedReceiptFileName,
    );
    await expect(approvedReceiptRow).toBeVisible();
    await takeScreenshot(
      testInfo,
      approvedReceiptRow,
      page,
      'Receipt reimbursements list with approved payout records',
    );
  } finally {
    await database
      .delete(schema.financeReceipts)
      .where(
        inArray(schema.financeReceipts.id, [
          submittedReceiptId,
          approvedReceiptId,
        ]),
      );
    await database
      .delete(schema.transactions)
      .where(
        inArray(schema.transactions.id, [
          visibleTransactionId,
          cancelledTransactionId,
        ]),
      );
  }
});
