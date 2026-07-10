import { and, eq } from 'drizzle-orm';

import { addConsumedFinanceReceiptUpload } from '../../../helpers/add-finance-receipt-upload';
import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: userStateFile });

test('profile receipts show submitted receipt status and event context', async ({
  database,
  page,
  seedDate,
  seeded,
}) => {
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected regular profile user fixture');
  }

  const eventId = seeded.scenario.events.freeOpen.eventId;
  const event = seeded.events.find((seededEvent) => seededEvent.id === eventId);
  if (!event) {
    throw new Error('Expected seeded free profile event');
  }

  const receiptId = getId();
  const receiptFileName = `profile-receipt-${seedDate.getTime()}.pdf`;
  let receiptUploadId: string | undefined;

  try {
    receiptUploadId = await addConsumedFinanceReceiptUpload(database, {
      eventId,
      fileName: receiptFileName,
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      tenantId: seeded.tenant.id,
      uploadedByUserId: regularUser.id,
    });
    await database.insert(schema.financeReceipts).values({
      attachmentFileName: receiptFileName,
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 2048,
      attachmentUploadId: receiptUploadId,
      eventId,
      id: receiptId,
      purchaseCountry: 'DE',
      receiptDate: seedDate,
      status: 'submitted',
      submittedByUserId: regularUser.id,
      taxAmount: 300,
      tenantId: seeded.tenant.id,
      totalAmount: 1875,
    });

    await page.goto('/profile#receipts');
    await expect(
      page.getByRole('heading', { name: 'Submitted receipts' }),
    ).toBeVisible();

    const receiptCard = page.locator('article').filter({
      hasText: receiptFileName,
    });
    await expect(receiptCard).toBeVisible();
    await expect(receiptCard.getByText('Submitted')).toBeVisible();
    await expect(receiptCard.getByText(event.title)).toBeVisible();
    await expect(receiptCard.getByText('18,75 €')).toBeVisible();

    const [receipt] = await database
      .select()
      .from(schema.financeReceipts)
      .where(
        and(
          eq(schema.financeReceipts.id, receiptId),
          eq(schema.financeReceipts.submittedByUserId, regularUser.id),
          eq(schema.financeReceipts.tenantId, seeded.tenant.id),
        ),
      );
    if (!receipt) {
      throw new Error('Expected seeded profile receipt after profile read');
    }
    expect(receipt).toEqual(
      expect.objectContaining({
        attachmentFileName: receiptFileName,
        status: 'submitted',
        totalAmount: 1875,
      }),
    );
  } finally {
    await database
      .delete(schema.financeReceipts)
      .where(eq(schema.financeReceipts.id, receiptId));
    if (receiptUploadId) {
      await database
        .delete(schema.financeReceiptUploads)
        .where(eq(schema.financeReceiptUploads.id, receiptUploadId));
    }
  }
});
