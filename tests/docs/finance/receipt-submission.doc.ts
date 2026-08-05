import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { and, desc, eq, inArray, like } from 'drizzle-orm';

import {
  adminStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import {
  completeReceiptSubmissionForm,
  formatTenantCurrency,
  openEventFromEventsNavigation,
  openOrganizerReceiptsFromNavigation,
  openReceiptSubmissionDialog,
} from '../../support/utils/receipt-submission';

test.use({ storageState: adminStateFile });

test('Submit an event receipt @finance', async ({
  browser,
  database,
  registerDatabaseCleanup,
  page,
  seeded,
  tenant,
  testClock,
}, testInfo) => {
  const eventId = seeded.scenario.events.freeOpen.eventId;
  const event = seeded.events.find((candidate) => candidate.id === eventId);
  if (!event) {
    throw new Error(
      'Expected seeded discoverable event for receipt documentation',
    );
  }

  const submitter = usersToAuthenticate.find((user) => user.roles === 'admin');
  if (!submitter) {
    throw new Error('Expected seeded administrator for receipt documentation');
  }
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected regular user for receipt boundary documentation');
  }

  const receiptFile = path.resolve('tests/fixtures/sample-receipt.pdf');
  const receiptFileSize = (await stat(receiptFile)).size;
  const receiptName = 'event-receipt.pdf';
  registerDatabaseCleanup(async (cleanupDatabase) => {
    // Remove only database metadata. Docker teardown owns local MinIO objects,
    // and docs tests must never delete from a developer-configured remote store.
    await cleanupDatabase.transaction(async (transaction) => {
      const matchingReceipts = await transaction
        .select({
          attachmentUploadId: schema.financeReceipts.attachmentUploadId,
          id: schema.financeReceipts.id,
        })
        .from(schema.financeReceipts)
        .where(
          and(
            eq(schema.financeReceipts.tenantId, tenant.id),
            eq(schema.financeReceipts.eventId, eventId),
            eq(schema.financeReceipts.submittedByUserId, submitter.id),
            eq(schema.financeReceipts.attachmentFileName, receiptName),
          ),
        );
      if (matchingReceipts.length === 0) {
        return;
      }

      const receiptIds = matchingReceipts.map((receipt) => receipt.id);
      const uploadIds = [
        ...new Set(
          matchingReceipts.map((receipt) => receipt.attachmentUploadId),
        ),
      ];

      await transaction
        .delete(schema.financeReceipts)
        .where(inArray(schema.financeReceipts.id, receiptIds));
      await transaction
        .delete(schema.financeReceiptUploads)
        .where(
          and(
            inArray(schema.financeReceiptUploads.id, uploadIds),
            eq(schema.financeReceiptUploads.tenantId, tenant.id),
            eq(schema.financeReceiptUploads.eventId, eventId),
            eq(schema.financeReceiptUploads.uploadedByUserId, submitter.id),
          ),
        );
    });
  });

  await testInfo.attach('markdown', {
    body: `

Use this guide when you bought something for an event and need the finance team to review the receipt before reimbursement.

{% callout type="note" title="What you need before you start" %}
- Sign in to the organization that owns the event.
- You must have a **confirmed organizer/helper ticket** for this event, **Organize all events** access, or **Manage receipts** access.
- Have one clear receipt image or document no larger than 20 MB.
- Know the purchase date, total, included tax, purchase country, and any deposit or alcohol amounts. Amounts are recorded in the organization currency shown beside each field.
{% /callout %}

## Open the event from normal navigation

Start on Evorto's normal landing page and choose **Events** in the main navigation. Find the event you organized and open it. Do not start from a copied organizer link: navigating this way lets you confirm that you are in the intended organization and event.
`,
  });

  const receiptSection = await openOrganizerReceiptsFromNavigation({
    eventId,
    eventTitle: event.title,
    page,
  });
  await takeScreenshot(
    testInfo,
    receiptSection,
    page,
    'Organizer receipt section before submission',
  );

  await testInfo.attach('markdown', {
    body: `
On the event details page, choose **Organize this event**. In the **Receipts** section, existing submissions are listed and **Add receipt** opens the submission form.

## Open the receipt form and understand the fields

Choose **Add receipt**. The form contains:

- **Receipt date**: when the purchase happened.
- **Purchase country**: one of the countries the organization accepts. Some organizations also allow an **Other** choice.
- **Total amount** and **Tax amount**: enter the amounts exactly as shown on the receipt, including cents.
- **Deposit involved** and **Alcohol purchased**: leave these unchecked when they do not apply. Selecting either choice reveals its amount field.
- **Receipt name**: an optional recognizable label for receipt and reimbursement lists. If you leave it unchanged, the uploaded filename is used.
- **Receipt image or document**: one clear receipt no larger than 20 MB.
`,
  });

  const receiptDialog = await openReceiptSubmissionDialog({
    page,
    receiptSection,
  });
  await expect(
    receiptDialog.getByLabel(`Deposit amount (${tenant.currency})`),
  ).not.toBeVisible();
  await expect(
    receiptDialog.getByLabel(`Alcohol amount (${tenant.currency})`),
  ).not.toBeVisible();
  await expect(receiptDialog.getByLabel('Receipt date')).not.toHaveValue('');
  await takeScreenshot(
    testInfo,
    receiptDialog,
    page,
    'New receipt form before optional breakdown fields are selected',
  );

  await testInfo.attach('markdown', {
    body: `
## Recover from an incomplete submission

If you choose **Submit receipt** before selecting a receipt, the dialog stays open and explains that an image or document is required. Choose the receipt and try again.
`,
  });
  await receiptDialog
    .getByLabel(`Total amount (${tenant.currency})`)
    .fill('14.50');
  await receiptDialog
    .getByLabel(`Tax amount (${tenant.currency})`)
    .fill('2.10');
  await receiptDialog.getByRole('button', { name: 'Submit receipt' }).click();
  await expect(
    receiptDialog.getByText('Choose a receipt image or document.'),
  ).toBeVisible();
  await takeScreenshot(testInfo, receiptDialog, page, 'Receipt still needed');

  await completeReceiptSubmissionForm({
    alcoholAmount: '3.00',
    attachmentName: receiptName,
    currency: tenant.currency,
    depositAmount: '12.00',
    dialog: receiptDialog,
    page,
    receiptFile,
    taxAmount: '2.10',
    totalAmount: '14.50',
  });
  await expect(
    receiptDialog.getByLabel(`Deposit amount (${tenant.currency})`),
  ).toHaveValue('12.00');
  await expect(
    receiptDialog.getByLabel(`Alcohol amount (${tenant.currency})`),
  ).toHaveValue('3.00');
  await takeScreenshot(
    testInfo,
    receiptDialog,
    page,
    'Deposit and alcohol amounts',
  );

  await receiptDialog.getByRole('button', { name: 'Submit receipt' }).click();
  await expect(
    receiptDialog.getByText(
      'Deposit and alcohol cannot exceed the total amount.',
    ),
  ).toBeVisible();
  await expect(receiptDialog).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
The deposit and alcohol amounts cannot add up to more than the total. If they do, the dialog remains open without uploading anything. Correct the values and submit again.

## Upload and submit
`,
  });
  await receiptDialog
    .getByLabel(`Deposit amount (${tenant.currency})`)
    .fill('2.50');
  await receiptDialog.getByRole('button', { name: 'Submit receipt' }).click();
  await expect(receiptDialog).not.toBeVisible();
  await expect(page.getByText('Receipt submitted')).toBeVisible();

  const receiptCard = receiptSection
    .locator('article')
    .filter({ hasText: receiptName });
  await expect(receiptCard).toBeVisible({ timeout: 20_000 });
  await expect(
    receiptCard.getByText('Submitted', { exact: true }),
  ).toBeVisible();
  await expect(
    receiptCard.getByText(
      `Total: ${formatTenantCurrency(1450, tenant.currency)}`,
    ),
  ).toBeVisible();
  await expect(
    receiptCard.getByText(`Tax: ${formatTenantCurrency(210, tenant.currency)}`),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    receiptCard,
    page,
    'Submitted receipt on the organizer view',
  );

  const [submittedReceipt] = await database
    .select()
    .from(schema.financeReceipts)
    .where(
      and(
        eq(schema.financeReceipts.tenantId, tenant.id),
        eq(schema.financeReceipts.eventId, eventId),
        eq(schema.financeReceipts.submittedByUserId, submitter.id),
        eq(schema.financeReceipts.attachmentFileName, receiptName),
      ),
    )
    .orderBy(desc(schema.financeReceipts.createdAt))
    .limit(1);
  if (!submittedReceipt) {
    throw new Error('Expected submitted receipt after documentation upload');
  }
  const submittedReceiptId = submittedReceipt.id;
  const submittedUploadId = submittedReceipt.attachmentUploadId;
  expect(submittedReceipt).toEqual(
    expect.objectContaining({
      alcoholAmount: 300,
      attachmentFileName: receiptName,
      currency: tenant.currency,
      depositAmount: 250,
      eventId,
      hasAlcohol: true,
      hasDeposit: true,
      purchaseCountry: 'DE',
      receiptDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
      status: 'submitted',
      submittedByUserId: submitter.id,
      taxAmount: 210,
      tenantId: tenant.id,
      totalAmount: 1450,
    }),
  );

  const uploadedReceipt = await database.query.financeReceiptUploads.findFirst({
    where: {
      eventId,
      id: submittedUploadId,
      tenantId: tenant.id,
      uploadedByUserId: submitter.id,
    },
  });
  if (!uploadedReceipt) {
    throw new Error('Expected bound receipt upload after documentation upload');
  }

  const receiptDigest = createHash('sha256')
    .update(await readFile(receiptFile))
    .digest('hex');
  const expectedStorageKey = [
    'receipts',
    tenant.id,
    eventId,
    submitter.id,
    `${submittedUploadId}-${receiptDigest}-${path.basename(receiptFile)}`,
  ].join('/');
  expect(uploadedReceipt).toEqual(
    expect.objectContaining({
      consumedAt: expect.any(Date),
      fileName: path.basename(receiptFile),
      id: submittedUploadId,
      mimeType: 'application/pdf',
      sizeBytes: receiptFileSize,
      storageKey: expectedStorageKey,
      uploadedAt: expect.any(Date),
    }),
  );

  const submissionEmails = await database
    .select({ id: schema.emailOutbox.id })
    .from(schema.emailOutbox)
    .where(
      and(
        eq(schema.emailOutbox.tenantId, tenant.id),
        eq(schema.emailOutbox.kind, 'receiptReviewed'),
        like(
          schema.emailOutbox.idempotencyKey,
          `receipt-reviewed/${tenant.id}/${submittedReceiptId}/%`,
        ),
      ),
    );
  expect(submissionEmails).toEqual([]);

  await testInfo.attach('markdown', {
    body: `
The new card shows the filename, **Submitted**, total, tax, and receipt date.

Submitting does **not** send a confirmation email. A finance team member with **Approve receipts** access must still review the receipt. After the decision is saved, Evorto tries to email the submitter. You can always check the receipt status in Evorto if the email is delayed or does not arrive. Sending and recording the reimbursement is covered in **Review and reimburse receipts**.

## Find the submission in your profile

Use **Profile** in the main navigation, then choose **Receipts**. This personal list is useful when you no longer have the event organizer page open.
`,
  });

  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  const receiptsLink = page
    .getByRole('navigation', { name: 'Profile sections' })
    .getByRole('link', { name: 'Receipts' });
  await expect(receiptsLink).toBeVisible();
  await receiptsLink.click();
  await expect(
    page.getByRole('heading', { name: 'Your receipts' }),
  ).toBeVisible();
  const profileReceipt = page
    .locator('article')
    .filter({ hasText: receiptName });
  await expect(profileReceipt).toBeVisible();
  await expect(profileReceipt.getByText('Submitted')).toBeVisible();
  await expect(profileReceipt.getByText(event.title)).toBeVisible();
  await expect(
    profileReceipt.getByText(formatTenantCurrency(1450, tenant.currency)),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    profileReceipt,
    page,
    'Submitted receipt in the personal profile',
  );

  await testInfo.attach('markdown', {
    body: `
## Who can see and submit receipts

Organization membership by itself does not provide organizer tools. A regular member in the same organization can open the published event page but does not see **Organize this event**, sees **Access not allowed** if they try to open organizer tools, and cannot see another member's receipt in **Profile → Receipts**. A copied organizer link does not provide permission to submit receipts.
`,
  });

  const sameTenantMembership = await database.query.usersToTenants.findFirst({
    where: { tenantId: tenant.id, userId: regularUser.id },
  });
  expect(sameTenantMembership).toEqual(
    expect.objectContaining({
      tenantId: tenant.id,
      userId: regularUser.id,
    }),
  );

  const sameTenantViewer = await openAuthenticatedTestPage({
    baseUrl: new URL(page.url()).origin,
    browser,
    storageState: userStateFile,
    tenantDomain: tenant.domain,
    testClock,
  });
  registerDatabaseCleanup(async () => sameTenantViewer.context.close());
  await openEventFromEventsNavigation({
    eventId,
    eventTitle: event.title,
    page: sameTenantViewer.page,
  });
  await expect(
    sameTenantViewer.page.getByRole('link', {
      name: 'Organize this event',
    }),
  ).toHaveCount(0);
  await sameTenantViewer.page.goto(`/events/${eventId}/organize`);
  await expect(sameTenantViewer.page).toHaveURL(/\/403/);
  await expect(
    sameTenantViewer.page.getByRole('heading', {
      level: 1,
      name: 'Access not allowed',
    }),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    sameTenantViewer.page.getByRole('heading', {
      level: 1,
      name: 'Access not allowed',
    }),
    sameTenantViewer.page,
    'Same-organization member without organizer access',
  );

  await sameTenantViewer.page.goto('.');
  await sameTenantViewer.page
    .getByRole('link', { name: 'Profile', exact: true })
    .click();
  await sameTenantViewer.page
    .getByRole('navigation', { name: 'Profile sections' })
    .getByRole('link', { name: 'Receipts' })
    .click();
  await expect(
    sameTenantViewer.page.getByRole('heading', {
      name: 'Your receipts',
    }),
  ).toBeVisible();
  await expect(sameTenantViewer.page.getByText(receiptName)).toHaveCount(0);
});
