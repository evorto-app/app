import { adminStateFile } from '../../../helpers/user-data';
import { test } from '../../fixtures/parallel-test';
import { takeScreenshot } from '../../reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Manage finances @finance @track(playwright-specs-track-linking_20260126) @doc(FINANCE-OVERVIEW-DOC-01)', async ({ page }, testInfo) => {
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
    'Transaction list page',
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
});
