import { stat } from 'node:fs/promises';
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
  seedDate,
  seeded,
  tenant,
  testClock,
}, testInfo) => {
  const eventId = seeded.scenario.events.freeOpen.eventId;
  const event = seeded.events.find((candidate) => candidate.id === eventId);
  if (!event) {
    throw new Error('Expected seeded listed event for receipt documentation');
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
  const receiptName = `event-receipt-${seedDate.getTime()}.pdf`;
  let submittedReceiptId: string | undefined;
  let submittedUploadId: string | undefined;
  let sameTenantViewer:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

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
# Submit a receipt for an event

Use this guide when you bought something for an event and need the finance team to review the receipt before reimbursement.

{% callout type="note" title="What you need before you start" %}
- Sign in to the tenant that owns the event.
- You must have a **confirmed organizer/helper registration** for this event, **Organize all events** access (\`events:organizeAll\`), or **Manage receipts** access (\`finance:manageReceipts\`). This walkthrough uses an administrator with **Organize all events** access.
- Have one image or PDF containing the receipt. The app's object-storage service must be available; Stripe and an email provider are not needed to submit.
- Know the purchase date, total, included tax, purchase country, and any deposit or alcohol amounts. Amounts are recorded in the tenant currency shown beside each field.
{% /callout %}

## Open the event from normal navigation

Start on Evorto's normal landing page and choose **Events** in the main navigation. Find the event you organized and open it. Do not start from a copied organizer URL: navigating this way lets you confirm that you are in the intended tenant and event.
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
- **Purchase country**: one of the countries configured for this tenant. Some tenants also allow an **Other** choice.
- **Total amount** and **Tax amount**: enter currency amounts, not minor-unit cents.
- **Deposit involved** and **Alcohol purchased**: leave these clear when they do not apply. Selecting either choice reveals its amount field.
- **Receipt name**: an optional recognizable label for receipt and reimbursement lists. If you leave it unchanged, the uploaded filename is used.
- **Receipt file**: one image or PDF.
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

Choose **Submit receipt** before selecting a file to see the safe validation state. The dialog stays open and explains that an image or PDF is required, so none of the partial values are uploaded or saved.
`,
  });
  await receiptDialog.getByRole('button', { name: 'Submit receipt' }).click();
  await expect(
    receiptDialog.getByText('Choose an image or PDF receipt file.'),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    receiptDialog,
    page,
    'Missing receipt file validation',
  );

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
    'Conditional deposit and alcohol amount fields',
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
The deposit and alcohol breakdown cannot add up to more than the total. If it does, the dialog remains open without uploading anything. Correct the values and submit again; here the deposit is corrected from 12.00 to 2.50.

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
    receiptCard.getByText('submitted', { exact: true }),
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
  submittedReceiptId = submittedReceipt.id;
  submittedUploadId = submittedReceipt.attachmentUploadId;
  expect(submittedReceipt).toEqual(
    expect.objectContaining({
      alcoholAmount: 300,
      attachmentFileName: receiptName,
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: receiptFileSize,
      currency: tenant.currency,
      depositAmount: 250,
      eventId,
      hasAlcohol: true,
      hasDeposit: true,
      purchaseCountry: 'DE',
      receiptDate: expect.any(Date),
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
  if (!uploadedReceipt.storageUrl) {
    throw new Error('Expected receipt upload to have an object-storage URL');
  }

  const expectedStorageKey = [
    'receipts',
    tenant.id,
    eventId,
    submitter.id,
    `${submittedUploadId}-${path.basename(receiptFile)}`,
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

  const storageUrl = new URL(uploadedReceipt.storageUrl);
  const storagePathSegments = storageUrl.pathname.split('/').filter(Boolean);
  const receiptKeySegments = expectedStorageKey.split('/');
  expect(storageUrl.protocol).toMatch(/^https?:$/);
  expect(storagePathSegments.length).toBeGreaterThan(receiptKeySegments.length);
  expect(storagePathSegments.slice(-receiptKeySegments.length)).toEqual(
    receiptKeySegments,
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
The new card confirms the filename, **submitted** status, total, tax, and receipt date. Evorto also binds the uploaded object to this tenant, event, and submitter, consumes that upload exactly once, and stores the entered breakdown in the tenant's current currency.

Submission does **not** send a confirmation email. A finance user with **Approve receipts** access (\`finance:approveReceipts\`) must still review the item. Only a later approve or reject decision queues the submitter's receipt-reviewed email. Reimbursement is another separate, manual money-transfer workflow described in **Review and reimburse receipts**.

## Find the submission in your profile

Use **Profile** in the main navigation, then choose **Receipts**. This personal list is useful when you no longer have the event organizer page open.
`,
  });

  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByRole('button', { name: 'Receipts' })).toBeVisible();
  await page.getByRole('button', { name: 'Receipts' }).click();
  await expect(
    page.getByRole('heading', { name: 'Submitted receipts' }),
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
## Permission and tenant boundary

Tenant membership by itself is not organizer access. A regular member in the same tenant can open this public event but does not see **Organize this event**, is sent to **Access not allowed** if they try the organizer route, and cannot see another user's receipt in **Profile → Receipts**. The upload handler also rejects accounts without receipt-submit access, so a copied organizer URL does not grant upload access.
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

  registerDatabaseCleanup(async () => sameTenantViewer?.context.close());
  sameTenantViewer = await openAuthenticatedTestPage({
    baseUrl: new URL(page.url()).origin,
    browser,
    storageState: userStateFile,
    tenantDomain: tenant.domain,
    testClock,
  });
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
    'Same-tenant member without organizer access',
  );

  await sameTenantViewer.page.goto('.');
  await sameTenantViewer.page.getByRole('link', { name: 'Profile' }).click();
  await sameTenantViewer.page.getByRole('button', { name: 'Receipts' }).click();
  await expect(
    sameTenantViewer.page.getByRole('heading', {
      name: 'Submitted receipts',
    }),
  ).toBeVisible();
  await expect(sameTenantViewer.page.getByText(receiptName)).toHaveCount(0);
});
