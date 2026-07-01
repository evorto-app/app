import { inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { organizerStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: organizerStateFile });

test('Manage finances @finance', async ({
  database,
  permissionOverride,
  page,
  seedDate,
  tenant,
}, testInfo) => {
  const visibleTransactionId = getId();
  const cancelledTransactionId = getId();
  const visibleTransactionComment = `finance-doc-visible-${seedDate.getTime()}`;
  const cancelledTransactionComment = `finance-doc-cancelled-${seedDate.getTime()}`;

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
    await takeScreenshot(
      testInfo,
      page.locator('app-finance-overview'),
      page,
      'Finance overview page',
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

You can view a detailed list of all transactions by clicking on the **Transactions** tab.
`,
    });

    await page.getByRole('link', { name: 'Transactions' }).click();
    await expect(page.getByText(visibleTransactionComment)).toBeVisible();
    await expect(page.getByText(cancelledTransactionComment)).toHaveCount(0);
    await takeScreenshot(
      testInfo,
      page.locator('app-transaction-list'),
      page,
      'Transaction list page',
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

The **Receipt approvals** tab shows all receipts waiting for finance review, grouped by event. Reviewers can open each receipt, validate submitted values, and approve or reject it. The detail page notes that the submitter is emailed after the review is saved.

Approving or rejecting records the review status in Evorto and sends the submitter a receipt-reviewed email when tenant email delivery is configured.
`,
    });
    await page.goto('/finance/receipts-approval');
    await takeScreenshot(
      testInfo,
      page.locator('app-receipt-approval-list'),
      page,
      'Receipt approval list',
    );

    await testInfo.attach('markdown', {
      body: `
## Receipt Reimbursements

The **Receipt reimbursements** tab groups approved receipts by recipient and renders each group in a selectable table. Recipient contact details use the submitter's notification email when configured, with login email as fallback. Finance users can select one or more rows, verify payout details (IBAN/PayPal), and record the manual reimbursement transaction for the selected batch.
`,
    });
    await page.goto('/finance/receipts-refunds');
    await takeScreenshot(
      testInfo,
      page.locator('app-receipt-refund-list'),
      page,
      'Receipt reimbursements list',
    );
  } finally {
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
