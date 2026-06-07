import { eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import {
  collectBrowserLogFailures,
  expectStablePageLayout,
} from '../../support/utils/page-layout';
import {
  seedProfileEventCards,
  type SeededProfileEventCards,
} from '../../support/utils/profile-event-cards';

test.setTimeout(120_000);

test.use({ storageState: userStateFile });

const viewportSizes = [
  { height: 740, label: 'narrow mobile', width: 320 },
  { height: 844, label: 'mobile', width: 390 },
  { height: 900, label: 'desktop', width: 1440 },
];

const seededEsnCardIdentifier = 'TEST-ESN-0001';

test('profile sections have stable layouts across viewports @profile', async ({
  database,
  discounts,
  page,
  seedDate,
  seeded,
}) => {
  const browserLogFailures = collectBrowserLogFailures(page);
  void discounts;
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
  const receiptFileName = `profile-viewport-receipt-${seedDate.getTime()}.pdf`;
  let profileEventCards: SeededProfileEventCards | undefined;

  try {
    profileEventCards = await seedProfileEventCards({
      database,
      seedDate,
      seeded,
      userId: regularUser.id,
    });
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

    for (const viewport of viewportSizes) {
      await test.step(`${viewport.label} profile viewport`, async () => {
        browserLogFailures.length = 0;
        await page.setViewportSize(viewport);
        await page.goto('/profile');

        const profilePage = page.locator('app-user-profile');
        await expect(profilePage).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Edit profile' }),
        ).toBeVisible();
        await expectStablePageLayout(page);
        expect(
          browserLogFailures,
          `${viewport.label} profile overview should not emit browser warning/error logs`,
        ).toEqual([]);

        browserLogFailures.length = 0;
        await page.getByRole('button', { name: 'Events' }).click();
        await expect(
          page.getByRole('heading', { name: 'Your Event Registrations' }),
        ).toBeVisible();
        await expect(
          page.locator('article').filter({
            hasText: profileEventCards.confirmed.addOnTitle,
          }),
        ).toBeVisible();
        await expectStablePageLayout(page);
        expect(
          browserLogFailures,
          `${viewport.label} profile events should not emit browser warning/error logs`,
        ).toEqual([]);

        browserLogFailures.length = 0;
        await page.getByRole('button', { name: 'Receipts' }).click();
        await expect(
          page.getByRole('heading', { name: 'Submitted receipts' }),
        ).toBeVisible();
        const receiptCard = page.locator('article').filter({
          hasText: receiptFileName,
        });
        await expect(receiptCard).toBeVisible();
        await expect(receiptCard.getByText(event.title)).toBeVisible();
        await expectStablePageLayout(page);
        expect(
          browserLogFailures,
          `${viewport.label} profile receipts should not emit browser warning/error logs`,
        ).toEqual([]);

        browserLogFailures.length = 0;
        await page.getByRole('button', { name: 'Discounts' }).click();
        await expect(
          page.getByRole('heading', { level: 2, name: 'Discount Cards' }),
        ).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText(seededEsnCardIdentifier)).toBeVisible();
        await expectStablePageLayout(page);
        expect(
          browserLogFailures,
          `${viewport.label} profile discounts should not emit browser warning/error logs`,
        ).toEqual([]);
      });
    }
  } finally {
    await profileEventCards?.cleanup();
    await database
      .delete(schema.financeReceipts)
      .where(eq(schema.financeReceipts.id, receiptId));
  }
});
