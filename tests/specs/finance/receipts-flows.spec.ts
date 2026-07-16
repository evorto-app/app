import path from 'node:path';

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, desc, eq } from 'drizzle-orm';

import {
  addAvailableConsumedFinanceReceiptUpload,
  addConsumedFinanceReceiptUpload,
} from '../../../helpers/add-finance-receipt-upload';
import { getId } from '../../../helpers/get-id';
import {
  adminStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';
import type { SupportedTenantCurrency } from '../../../src/types/custom/tenant';
import { expect, test } from '../../support/fixtures/parallel-test';
import {
  completeReceiptSubmissionForm,
  expectReceiptPdfPreviewAvailable,
  formatTenantCurrency,
  openOrganizerReceiptsFromNavigation,
  openReceiptSubmissionDialog,
} from '../../support/utils/receipt-submission';

test.use({ storageState: adminStateFile });

const seedPendingReceiptForApproval = async ({
  currency,
  database,
  eventId,
  receiptFileName,
  receiptId,
  seedDate,
  submittedByUserId,
  tenantId,
}: {
  currency: SupportedTenantCurrency;
  database: NodePgDatabase<typeof relations>;
  eventId: string;
  receiptFileName: string;
  receiptId: string;
  seedDate: Date;
  submittedByUserId: string;
  tenantId: string;
}) => {
  const receiptUpload = await addAvailableConsumedFinanceReceiptUpload(
    database,
    {
      eventId,
      fileName: receiptFileName,
      mimeType: 'application/pdf',
      sourceFilePath: path.resolve('tests/fixtures/sample-receipt.pdf'),
      tenantId,
      uploadedByUserId: submittedByUserId,
    },
  );
  await database.insert(schema.financeReceipts).values({
    alcoholAmount: 150,
    attachmentFileName: receiptFileName,
    attachmentMimeType: 'application/pdf',
    attachmentSizeBytes: receiptUpload.sizeBytes,
    attachmentUploadId: receiptUpload.id,
    currency,
    depositAmount: 150,
    eventId,
    hasAlcohol: true,
    hasDeposit: true,
    id: receiptId,
    purchaseCountry: 'DE',
    receiptDate: new Date(seedDate.getTime() - 1000 * 60 * 60 * 24 * 2),
    status: 'submitted',
    submittedByUserId,
    taxAmount: 0,
    tenantId,
    totalAmount: 1450,
  });

  return receiptUpload.id;
};

test('submit receipt through Events and organizer navigation', async ({
  database,
  page,
  seeded,
  tenant,
}) => {
  const currency = 'AUD';
  const eventId = seeded.scenario.events.freeOpen.eventId;
  const receiptFile = path.resolve('tests/fixtures/sample-receipt.pdf');
  const [event] = await database
    .select()
    .from(schema.eventInstances)
    .where(eq(schema.eventInstances.id, eventId))
    .limit(1);
  if (!event) {
    throw new Error('Expected seeded listed event for receipt submission flow');
  }
  let submittedReceiptId: string | undefined;
  let submittedUploadId: string | undefined;

  try {
    await database
      .update(schema.tenants)
      .set({ currency })
      .where(eq(schema.tenants.id, tenant.id));

    const receiptSection = await openOrganizerReceiptsFromNavigation({
      eventId,
      eventTitle: event.title,
      page,
    });
    const receiptDialog = await openReceiptSubmissionDialog({
      page,
      receiptSection,
    });
    await completeReceiptSubmissionForm({
      alcoholAmount: '1.50',
      currency,
      depositAmount: '2.50',
      dialog: receiptDialog,
      page,
      receiptFile,
      taxAmount: '2.10',
      totalAmount: '14.50',
    });
    await receiptDialog.getByRole('button', { name: 'Submit receipt' }).click();
    await expect(receiptDialog).not.toBeVisible();
    await expect(
      receiptSection.getByText(path.basename(receiptFile), { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      receiptSection.getByText(
        `Total: ${formatTenantCurrency(1450, currency)}`,
      ),
    ).toBeVisible();

    const [submittedReceipt] = await database
      .select()
      .from(schema.financeReceipts)
      .where(
        and(
          eq(schema.financeReceipts.eventId, eventId),
          eq(
            schema.financeReceipts.attachmentFileName,
            path.basename(receiptFile),
          ),
        ),
      )
      .orderBy(desc(schema.financeReceipts.createdAt))
      .limit(1);
    if (!submittedReceipt) {
      throw new Error('Expected submitted receipt after upload flow');
    }
    submittedReceiptId = submittedReceipt.id;
    submittedUploadId = submittedReceipt.attachmentUploadId;
    expect(submittedReceipt).toEqual(
      expect.objectContaining({
        alcoholAmount: 150,
        currency,
        depositAmount: 250,
        hasAlcohol: true,
        hasDeposit: true,
        purchaseCountry: 'DE',
        status: 'submitted',
        taxAmount: 210,
        tenantId: tenant.id,
        totalAmount: 1450,
      }),
    );

    const uploadedReceipt =
      await database.query.financeReceiptUploads.findFirst({
        where: { id: submittedReceipt.attachmentUploadId },
      });
    expect(uploadedReceipt).toEqual(
      expect.objectContaining({
        consumedAt: expect.any(Date),
        eventId,
        id: submittedReceipt.attachmentUploadId,
        tenantId: submittedReceipt.tenantId,
        uploadedAt: expect.any(Date),
        uploadedByUserId: submittedReceipt.submittedByUserId,
      }),
    );
  } finally {
    if (submittedReceiptId) {
      await database
        .delete(schema.financeReceipts)
        .where(eq(schema.financeReceipts.id, submittedReceiptId));
    }
    if (submittedUploadId) {
      await database
        .delete(schema.financeReceiptUploads)
        .where(eq(schema.financeReceiptUploads.id, submittedUploadId));
    }
  }
});

test('approve and record receipt reimbursements in finance', async ({
  database,
  page,
  seedDate,
  seeded,
  tenant,
}) => {
  const currency = 'CZK';
  const organizerUser = usersToAuthenticate.find(
    (user) => user.roles === 'organizer',
  );
  if (!organizerUser) {
    throw new Error('Expected seeded organizer user');
  }
  const originalOrganizer = await database.query.users.findFirst({
    where: { id: organizerUser.id },
  });
  if (!originalOrganizer) {
    throw new Error('Expected seeded organizer user record');
  }
  const seededEventId = seeded.scenario.events.past.eventId;
  const receiptId = getId();
  const receiptFileName = `approval-reimbursement-${seedDate.getTime()}.pdf`;
  let receiptUploadId: string | undefined;
  let refundTransactionId: string | undefined;
  try {
    await database
      .update(schema.tenants)
      .set({ currency })
      .where(eq(schema.tenants.id, tenant.id));
    await database
      .update(schema.users)
      .set({
        communicationEmail: `delivered+receipt-flow-${receiptId}@resend.dev`,
        iban: 'DE00123456781234567890',
        paypalEmail: 'organizer-refunds@example.com',
      })
      .where(eq(schema.users.id, organizerUser.id));

    receiptUploadId = await seedPendingReceiptForApproval({
      currency,
      database,
      eventId: seededEventId,
      receiptFileName,
      receiptId,
      seedDate,
      submittedByUserId: organizerUser.id,
      tenantId: tenant.id,
    });

    const escapedReceiptFileName = receiptFileName.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );
    await page.goto('/finance/receipts-approval');
    const pendingReceipt = page.getByRole('link', {
      name: new RegExp(escapedReceiptFileName),
    });
    await expect(pendingReceipt).toHaveAttribute(
      'href',
      `/finance/receipts-approval/${receiptId}`,
    );
    await expect(
      pendingReceipt.getByText(formatTenantCurrency(1450, currency)),
    ).toBeVisible();
    await pendingReceipt.click();
    await expect(page.getByLabel(`Total amount (${currency})`)).toHaveValue(
      '14.5',
    );
    await expectReceiptPdfPreviewAvailable({ page });
    const approveButton = page.getByRole('button', { name: 'Approve' });
    await expect(approveButton).toBeEnabled();
    await approveButton.click();
    await expect(page).toHaveURL(/\/finance\/receipts-approval$/);

    await page.goto('/finance/receipts-refunds');
    await expect(
      page.getByText(
        'Recording a reimbursement creates the Evorto finance transaction only. Transfer the money manually through the selected payout method.',
      ),
    ).toBeVisible();
    await expect(
      page.getByText('No approved receipts are waiting for reimbursement.'),
    ).not.toBeVisible();

    const refundList = page.locator('app-receipt-refund-list');
    await expect(refundList).not.toHaveAttribute('ngh', /.*/);
    const refundSection = refundList.locator('section', {
      has: page.getByText(receiptFileName),
    });
    await expect(refundSection).toBeVisible();

    await expect(refundSection.locator('table[mat-table]')).toBeVisible();
    const receiptCheckbox = refundSection.getByRole('checkbox', {
      name: new RegExp(escapedReceiptFileName),
    });
    await receiptCheckbox.check();
    await expect(receiptCheckbox).toBeChecked();
    await expect(
      refundSection.getByText(
        `Selected total: ${formatTenantCurrency(1450, currency)}`,
      ),
    ).toBeVisible();

    const issueRefundButton = refundSection.getByRole('button', {
      name: 'Record reimbursement',
    });
    await expect(issueRefundButton).toBeEnabled();
    await issueRefundButton.click();

    await expect(
      page.getByText('Reimbursement transaction recorded'),
    ).toBeVisible();

    await expect
      .poll(() =>
        database.query.financeReceipts.findFirst({
          where: {
            id: receiptId,
            tenantId: tenant.id,
          },
        }),
      )
      .toMatchObject({
        refundTransactionId: expect.any(String),
        status: 'refunded',
      });
    const refundedReceipt = await database.query.financeReceipts.findFirst({
      where: {
        id: receiptId,
        tenantId: tenant.id,
      },
    });
    if (!refundedReceipt?.refundTransactionId) {
      throw new Error('Expected seeded receipt after reimbursement recording');
    }
    const createdRefundTransactionId = refundedReceipt.refundTransactionId;
    refundTransactionId = createdRefundTransactionId;
    await expect
      .poll(() =>
        database.query.transactions.findFirst({
          where: { id: createdRefundTransactionId, tenantId: tenant.id },
        }),
      )
      .toMatchObject({
        currency,
        status: 'successful',
      });
  } finally {
    await database
      .update(schema.users)
      .set({
        communicationEmail: originalOrganizer.communicationEmail,
        firstName: originalOrganizer.firstName,
        iban: originalOrganizer.iban,
        lastName: originalOrganizer.lastName,
        paypalEmail: originalOrganizer.paypalEmail,
      })
      .where(eq(schema.users.id, organizerUser.id));
    await database
      .delete(schema.financeReceipts)
      .where(eq(schema.financeReceipts.id, receiptId));
    if (receiptUploadId) {
      await database
        .delete(schema.financeReceiptUploads)
        .where(eq(schema.financeReceiptUploads.id, receiptUploadId));
    }
    if (refundTransactionId) {
      await database
        .delete(schema.transactions)
        .where(eq(schema.transactions.id, refundTransactionId));
    }
  }
});

test('blocks approval but keeps rejection available when receipt evidence is missing', async ({
  database,
  page,
  registerDatabaseCleanup,
  seedDate,
  seeded,
  tenant,
}) => {
  const organizerUser = usersToAuthenticate.find(
    (user) => user.roles === 'organizer',
  );
  if (!organizerUser) {
    throw new Error('Expected seeded organizer user');
  }

  const eventId = seeded.scenario.events.past.eventId;
  const receiptId = getId();
  const receiptFileName = `missing-evidence-${seedDate.getTime()}.pdf`;
  let receiptUploadId: string | undefined;
  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .delete(schema.financeReceipts)
      .where(eq(schema.financeReceipts.id, receiptId));
    if (receiptUploadId) {
      await cleanupDatabase
        .delete(schema.financeReceiptUploads)
        .where(eq(schema.financeReceiptUploads.id, receiptUploadId));
    }
  });

  receiptUploadId = await addConsumedFinanceReceiptUpload(database, {
    eventId,
    fileName: receiptFileName,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    tenantId: tenant.id,
    uploadedByUserId: organizerUser.id,
  });
  await database.insert(schema.financeReceipts).values({
    alcoholAmount: 0,
    attachmentFileName: receiptFileName,
    attachmentMimeType: 'application/pdf',
    attachmentSizeBytes: 1024,
    attachmentUploadId: receiptUploadId,
    currency: tenant.currency,
    depositAmount: 0,
    eventId,
    hasAlcohol: false,
    hasDeposit: false,
    id: receiptId,
    purchaseCountry: 'DE',
    receiptDate: new Date(seedDate.getTime() - 1000 * 60 * 60 * 24),
    status: 'submitted',
    submittedByUserId: organizerUser.id,
    taxAmount: 100,
    tenantId: tenant.id,
    totalAmount: 1000,
  });

  await page.goto(`/finance/receipts-approval/${receiptId}`);
  await expect(
    page.getByRole('alert').filter({
      hasText:
        'Receipt evidence is unavailable. Approval is disabled until the uploaded file can be verified. You can still reject this receipt.',
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
  const rejectButton = page.getByRole('button', { name: 'Reject' });
  await expect(rejectButton).toBeDisabled();
  await page
    .getByLabel('Reason shown to the submitter')
    .fill('The uploaded receipt evidence is unavailable.');
  await expect(rejectButton).toBeEnabled();
  await rejectButton.click();
  await expect(page).toHaveURL(/\/finance\/receipts-approval$/);
  await expect
    .poll(() =>
      database.query.financeReceipts.findFirst({
        where: { id: receiptId, tenantId: tenant.id },
      }),
    )
    .toMatchObject({ status: 'rejected' });
});

test('receipt dialog shows Other option when tenant allows it', async ({
  database,
  page,
  seeded,
  tenant,
}) => {
  const existingTenant = await database.query.tenants.findFirst({
    where: { id: tenant.id },
  });
  if (!existingTenant) {
    throw new Error('Expected tenant fixture before receipt settings update');
  }

  await database
    .update(schema.tenants)
    .set({
      discountProviders: existingTenant.discountProviders,
      receiptSettings: {
        allowOther: true,
        receiptCountries: ['DE'],
      },
    })
    .where(eq(schema.tenants.id, tenant.id));

  const eventId = seeded.scenario.events.past.eventId;
  await page.goto(`/events/${eventId}/organize`);
  await page.getByRole('button', { name: 'Add receipt' }).click();
  await page.getByLabel('Purchase country').click();
  const otherCountryOption = page.getByRole('option', {
    name: 'Other (outside configured countries)',
  });
  await expect(otherCountryOption).toBeVisible();
});
