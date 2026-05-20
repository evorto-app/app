import { eq } from 'drizzle-orm';

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

  try {
    await database.insert(schema.financeReceipts).values({
      attachmentFileName: receiptFileName,
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 2048,
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
    await expect(receiptCard.getByText('18.75 €')).toBeVisible();

    const receipt = await database.query.financeReceipts.findFirst({
      where: {
        id: receiptId,
        submittedByUserId: regularUser.id,
        tenantId: seeded.tenant.id,
      },
    });
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
  }
});
