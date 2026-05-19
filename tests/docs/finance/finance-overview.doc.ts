import { organizerStateFile } from '../../../helpers/user-data';
import { test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: organizerStateFile });

test('Manage finances @finance @track(playwright-specs-track-linking_20260126) @doc(FINANCE-OVERVIEW-DOC-01)', async ({
  permissionOverride,
  page,
}, testInfo) => {
  await permissionOverride({
    add: [
      'finance:viewTransactions',
      'finance:approveReceipts',
      'finance:refundReceipts',
    ],
    roleName: 'Section member',
  });

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

The **Receipt approvals** tab shows all receipts waiting for finance review, grouped by event. Reviewers can open each receipt, validate submitted values, and approve or reject it.
`,
  });
  await page.getByRole('link', { name: 'Receipt approvals' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('app-receipt-approval-list'),
    page,
    'Receipt approval list',
  );

  await testInfo.attach('markdown', {
    body: `
## Receipt Refunds

The **Receipt refunds** tab groups approved receipts by recipient and renders each group in a selectable table. Finance users can select one or more rows, verify payout details (IBAN/PayPal), and record the reimbursement transaction for the selected batch.
`,
  });
  await page.getByRole('link', { name: 'Receipt refunds' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('app-receipt-refund-list'),
    page,
    'Receipt refunds list',
  );
});
