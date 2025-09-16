import { DateTime } from 'luxon';

import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';
import { takeScreenshot } from '../../reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Manage finances @finance', async ({ page }, testInfo) => {
  await page.goto('.');
  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="User permissions" %}
For this guide, we assume you have an admin account with all required permissions. These are:
- **finance:view**: This permission is required to view financial information.
- **finance:manage**: This permission is required to manage financial transactions.
{% /callout %}

# Finance Management

The finance management feature allows you to track and manage all financial transactions in the application. This includes payments for event registrations, refunds, and other financial activities.

## Accessing Finance Overview

To access the finance overview, navigate to the **Finance** section from the main menu.
`,
  });
  await page.getByRole('link', { name: 'Finance' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('app-finance-overview'),
    page,
    'Finance overview page'
  );

  await testInfo.attach('markdown', {
    body: `
## Finance Overview

The finance overview page provides a summary of all financial transactions. You can see:

- Total revenue
- Recent transactions
- Transaction status (completed, pending, failed)
- Payment methods used

This gives you a complete picture of the financial health of your organization.
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
    'Transaction list page'
  );

  await testInfo.attach('markdown', {
    body: `
The transaction list shows all financial transactions with details such as:

- Transaction ID
- Amount
- Status
- Date
- User
- Event (if applicable)
- Payment method

You can filter and sort this list to find specific transactions.
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Transaction Details

Click on any transaction to view its details.
`,
  });

  // Assuming there's at least one transaction in the list
  await page.locator('app-transaction-list tr').first().click();
  await takeScreenshot(
    testInfo,
    page.locator('dialog'),
    page,
    'Transaction details dialog'
  );

  await testInfo.attach('markdown', {
    body: `
The transaction details dialog shows all information about a specific transaction, including:

- Complete payment information
- Related user details
- Related event details (if applicable)
- Payment processing logs
- Refund options (if applicable)

This detailed view helps you understand and manage individual transactions.
`,
  });
});
