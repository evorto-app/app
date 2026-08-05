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
  tenant,
}, testInfo) => {
  const visibleTransactionId = getId();
  const cancelledTransactionId = getId();
  const visibleTransactionComment = 'Community dinner ticket payment';
  const cancelledTransactionComment = 'Cancelled workshop ticket payment';

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
{% callout type="note" title="Who can do this" %}
You need the finance access for the page you want to use:
- **View money received and spent** to review the organization's payment history.
- **Approve receipts** to review submitted receipts.
- **Record receipt reimbursements** to record that approved receipts were paid.
{% /callout %}


The finance area brings together payments, receipt approval, and reimbursements. You see only the pages you are allowed to use.

## Open finances

To access the finance overview, navigate to the **Finances** section from the main menu.
`,
    });
    await page.getByRole('link', { name: 'Finances' }).click();
    await takeScreenshot(
      testInfo,
      page.locator('app-finance-overview'),
      page,
      'Finance actions available to this member',
    );

    await testInfo.attach('markdown', {
      body: `
## Finance overview

The finance overview shows links only for the work you are allowed to do. For example, someone who can approve receipts does not automatically see all payments.
`,
    });

    await testInfo.attach('markdown', {
      body: `
## Payment history

Select **Payment history** to see money received and refunded.
`,
    });

    await page.getByRole('link', { name: 'Payment history' }).click();
    await expect(page.getByText(visibleTransactionComment)).toBeVisible();
    await expect(page.getByText(cancelledTransactionComment)).toHaveCount(0);
    await takeScreenshot(
      testInfo,
      page.locator('app-transaction-list'),
      page,
      'Organization payments with amount, method, status, and comment',
    );

    await testInfo.attach('markdown', {
      body: `
The payment history shows money received and refunded by the organization. Each item includes:

- Amount
- Method
- Created
- Status
- Comment

Cancelled payment attempts are omitted from this list.
`,
    });

    await testInfo.attach('markdown', {
      body: `
## Receipt approvals

The **Receipt approvals** page shows all receipts waiting for finance review, grouped by event. Each amount is displayed in the currency recorded when the receipt was submitted, rather than a later organization default. Reviewers can open each receipt, check the submitted values, and approve or reject it.

The detail page explains that Evorto will try to email the submitter after the review is saved. Saving records the decision immediately; email delivery is separate and may take time or fail.
`,
    });
    await page.goto('/finance/receipts-approval');
    await expect(
      page.getByText('kitchen-supplies.pdf', { exact: true }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('app-receipt-approval-list'),
      page,
      'Submitted receipts waiting for review',
    );

    await testInfo.attach('markdown', {
      body: `
## Receipt reimbursements

The **Receipt reimbursements** page groups approved receipts by recipient and currency. Finance team members can select receipts in the same currency, check the recipient's IBAN or PayPal details, send the money outside Evorto, and record that the selected receipts were reimbursed.
`,
    });
    await page.goto('/finance/receipts-refunds');
    await expect(
      page.getByText('venue-deposit.pdf', { exact: true }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('app-receipt-refund-list'),
      page,
      'Approved receipts grouped for reimbursement',
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
