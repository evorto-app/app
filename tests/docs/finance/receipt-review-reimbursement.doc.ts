import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Review and reimburse receipts @finance', async ({
  page,
  permissionOverride,
}, testInfo) => {
  await permissionOverride({
    add: ['finance:approveReceipts', 'finance:refundReceipts'],
    roleName: 'Section member',
  });

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
      .getByRole('heading', { name: 'Receipt approvals' }),
  ).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
## Receipt Approval Queue

The approval queue groups submitted receipts by event. Each receipt links to a review page where finance users can inspect the attachment metadata and validate the submitted amounts before approving or rejecting it.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-receipt-approval-list'),
    page,
    'Receipt approval queue',
  );

  await page.getByRole('link', { name: /kitchen-supplies\.pdf/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Review receipt' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Approving or rejecting this receipt records the review status only. Notify the submitter manually after saving.',
    ),
  ).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
## Review Details

The review page shows the receipt file, normalized receipt data, tax/deposit/alcohol fields, and the manual-notification caveat. Approving or rejecting updates Evorto's receipt status; it does not send an automatic submitter email yet.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-receipt-approval-detail'),
    page,
    'Receipt review detail',
  );

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page).toHaveURL(/\/finance\/receipts-approval$/);

  await page.goto('/finance/receipts-refunds');
  await expect(
    page
      .locator('app-receipt-refund-list')
      .getByRole('heading', { name: 'Receipt reimbursements' }),
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

Approved receipts are grouped by recipient. Finance users select the receipts to include, choose one of the submitter's saved payout details, and record the manual reimbursement transaction for that batch.
`,
  });

  const reimbursementGroup = page
    .locator('section', {
      has: page.getByRole('button', { name: 'Record reimbursement' }),
    })
    .filter({ hasText: 'organizer@evorto.app' })
    .first();
  await expect(reimbursementGroup).toBeVisible();
  await takeScreenshot(
    testInfo,
    reimbursementGroup,
    page,
    'Receipt reimbursement group',
  );

  await reimbursementGroup
    .locator('tr.mat-mdc-row input[type="checkbox"]')
    .first()
    .check();
  await expect(
    reimbursementGroup.getByRole('button', { name: 'Record reimbursement' }),
  ).toBeEnabled();
  await reimbursementGroup
    .getByRole('button', { name: 'Record reimbursement' })
    .click();

  await expect(page.getByText('Selected total: 0.00 €').first()).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
After recording the reimbursement, the selected receipt leaves the active reimbursement selection and the selected total resets. The action records an Evorto transaction; actual money movement remains a manual finance operation.
`,
  });
});
