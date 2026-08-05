import { eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import {
  adminStateFile,
  emptyStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import {
  eventAddons,
  eventRegistrationAddonFulfillmentEvents,
  eventRegistrations,
} from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { waitForScannerAddonFulfillment } from '../../support/utils/scanner-result-page';
import {
  cleanupScannerRegistrationAcquisition,
  seedScannerFulfillmentAddon,
  seedScannerRegistrationAcquisition,
} from '../../support/utils/seed-scanner-fulfillment';

test.use({ storageState: adminStateFile });

test('Hand out add-ons from a scanned ticket', async ({
  database,
  page,
  seeded,
}, testInfo) => {
  const eventId = seeded.scenario.events.past.eventId;
  const event = seeded.events.find((candidate) => candidate.id === eventId);
  const participantOption = event?.registrationOptions.find(
    (option) => !option.organizingRegistration,
  );
  const attendee = usersToAuthenticate.find(
    (user) => user.stateFile === emptyStateFile,
  );
  if (!event || !participantOption || !attendee) {
    throw new Error(
      'Expected a past event, participant option, and attendee for add-on fulfillment documentation',
    );
  }

  const registrationId = getId();
  const acquisitionId = getId();
  const addOnId = getId();
  const purchaseId = getId();
  const purchaseLotId = getId();
  const addOnTitle = 'Welcome tote';

  try {
    await database.insert(eventRegistrations).values({
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      basePriceAtRegistration: participantOption.price,
      checkedInGuestCount: 0,
      discountAmount: 0,
      eventId,
      guestCount: 0,
      id: registrationId,
      registrationOptionId: participantOption.id,
      status: 'CONFIRMED',
      tenantId: seeded.tenant.id,
      userId: attendee.id,
    });
    await seedScannerRegistrationAcquisition({
      acquisitionId,
      database,
      eventId,
      registrationId,
      tenant: seeded.tenant,
    });
    await seedScannerFulfillmentAddon({
      acquisitionId,
      addOnId,
      database,
      eventId,
      includedQuantity: 1,
      optionalQuantity: 2,
      purchaseId,
      purchaseLotId,
      registrationId,
      registrationOptionId: participantOption.id,
      tenant: seeded.tenant,
      title: addOnTitle,
    });

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Before you start" %}
You must be allowed to organize this event. Cancelling unused add-on items needs additional access, and the attendee's ticket must be confirmed. If the cancellation button is missing, ask an administrator who manages event tickets and add-ons.
{% /callout %}


1. Sign in to the organization that owns the event.
2. Select **Scanner** in the main navigation.
3. Scan the attendee's confirmed ticket QR code.
4. Check the attendee, event, sign-up choice, and add-on quantities before selecting **Hand out 1**.

Only someone who can organize this event can view the ticket and confirm that an item was handed out. Sharing or scanning its QR code does not allow someone to organize the event.

If this device cannot use its camera, scan the QR code with a phone camera and open its Evorto link while signed in with organizer access. Check the same details before selecting **Hand out 1**.
`,
    });

    await page.goto(`/scan/registration/${registrationId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ticket scanned' }),
    ).toBeVisible();
    const fulfillmentHeading = await waitForScannerAddonFulfillment(page);
    const addOn = page.locator('article').filter({ hasText: addOnTitle });
    await expect(addOn).toContainText('1 included · 2 purchased');
    await expect(
      addOn.getByText('Handed out', { exact: true }).locator('..'),
    ).toContainText('0');
    await expect(
      addOn.getByText('Cancelled', { exact: true }).locator('..'),
    ).toContainText('0');
    await expect(
      addOn.getByText('Ready to hand out', { exact: true }).locator('..'),
    ).toContainText('3');
    await takeScreenshot(
      testInfo,
      fulfillmentHeading,
      page,
      'Review included and purchased add-on quantities',
    );

    await testInfo.attach('markdown', {
      body: `
## Hand out one item and undo an accidental tap

The overview separates included and purchased quantities and always shows what is ready to hand out, already handed out, cancelled, and whether a refund applies. Select **Hand out 1** only when one item has actually been handed over or the checklist item has been completed.

After a handout, the scanner offers **Undo last handout** only for that add-on's most recent handout. Use it immediately for an accidental tap. Handed-out items cannot be cancelled.
`,
    });

    await addOn.getByRole('button', { name: 'Hand out 1' }).click();
    await expect(
      addOn.getByText('Handed out', { exact: true }).locator('..'),
    ).toContainText('1', { timeout: 15_000 });
    await addOn.getByRole('button', { name: 'Undo last handout' }).click();
    await expect(
      addOn.getByText('Handed out', { exact: true }).locator('..'),
    ).toContainText('0', { timeout: 15_000 });
    await expect(
      addOn.getByRole('button', { name: 'Undo last handout' }),
    ).toHaveCount(0);

    await addOn.getByRole('button', { name: 'Hand out 1' }).click();
    await expect(
      addOn.getByText('Handed out', { exact: true }).locator('..'),
    ).toContainText('1', { timeout: 15_000 });
    await takeScreenshot(testInfo, addOn, page, 'One included item handed out');

    await testInfo.attach('markdown', {
      body: `
## Cancel remaining items

Select **Cancel remaining items**, choose a whole number from 1 to the unused item count shown, enter the reason, and choose whether items bought separately should be refunded. Evorto cancels items bought separately first, then items included with the ticket, and shows the split before you confirm. Included items can be cancelled before they are handed out, but they are never refunded.

This optional add-on is free, so no refund is required. For a paid example, continue with **Cancel a paid ticket with add-ons and resolve a refund problem** in [Cancel a ticket](/docs/cancel-a-ticket). Check the refund shown in Evorto before telling an attendee that money has been returned.
`,
    });

    await addOn.getByRole('button', { name: 'Cancel remaining items' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('2 unused items available');
    await expect(dialog).toContainText(
      'You are cancelling: 1 bought separately, 0 included with the ticket.',
    );
    await expect(dialog).toContainText(
      'Items bought separately are cancelled first and can be refunded. Items included with the ticket cannot be refunded.',
    );
    await expect(dialog).toContainText(
      'These items were bought separately for free, so there is nothing to refund.',
    );
    await expect(
      dialog.getByRole('button', { name: 'Cancel selected items' }),
    ).toBeDisabled();
    await dialog
      .getByLabel('Cancellation reason')
      .fill('The attendee no longer needs the extra tote.');
    await dialog.getByRole('radio', { name: 'Cancel free items' }).click();
    await takeScreenshot(
      testInfo,
      dialog,
      page,
      'Confirm the quantity, reason, and refund choice',
    );
    await dialog.getByRole('button', { name: 'Cancel selected items' }).click();

    await expect(
      addOn.getByText('Cancelled', { exact: true }).locator('..'),
    ).toContainText('1', { timeout: 15_000 });
    await expect(
      page.getByText('The items were cancelled. No refund was needed.'),
    ).toBeVisible();
    await expect(
      addOn.getByText('Handed out', { exact: true }).locator('..'),
    ).toContainText('1');
    await expect(
      addOn.getByText('Ready to hand out', { exact: true }).locator('..'),
    ).toContainText('1');
    await expect(addOn.getByText('No refund needed')).toBeVisible();
    await takeScreenshot(
      testInfo,
      addOn,
      page,
      'Review handed-out, cancelled, and remaining quantities',
    );

    const events = await database
      .select({
        id: eventRegistrationAddonFulfillmentEvents.id,
        reason: eventRegistrationAddonFulfillmentEvents.reason,
        refundRequested:
          eventRegistrationAddonFulfillmentEvents.refundRequested,
        reversesEventId:
          eventRegistrationAddonFulfillmentEvents.reversesEventId,
        type: eventRegistrationAddonFulfillmentEvents.type,
      })
      .from(eventRegistrationAddonFulfillmentEvents)
      .where(
        eq(eventRegistrationAddonFulfillmentEvents.purchaseId, purchaseId),
      );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'redeemed' }),
        expect.objectContaining({ type: 'redemption_undone' }),
        expect.objectContaining({
          reason: 'The attendee no longer needs the extra tote.',
          refundRequested: true,
          type: 'cancelled',
        }),
      ]),
    );
    const redemptions = events.filter(({ type }) => type === 'redeemed');
    const reversal = events.find(({ type }) => type === 'redemption_undone');
    expect(redemptions).toHaveLength(2);
    expect(new Set(redemptions.map(({ id }) => id)).size).toBe(2);
    expect(reversal?.reversesEventId).not.toBeNull();
    expect(
      redemptions.filter(({ id }) => id !== reversal?.reversesEventId),
    ).toHaveLength(1);

    await testInfo.attach('markdown', {
      body: `
## After updating an add-on

Trying the same action again cannot silently hand out or cancel the same item twice. The result shows the latest add-on quantities after each success. If another organizer changes the same add-on first, Evorto asks you to reopen the ticket and review the current quantities instead of overwriting their work.

If the cancellation option is hidden, ask an administrator who manages tickets and add-ons. Tickets and add-ons from another organization cannot be changed here. Handed-out items stay listed as **Handed out** and cannot later be marked **Cancelled**.
`,
    });
  } finally {
    await database
      .delete(eventRegistrationAddonFulfillmentEvents)
      .where(
        eq(eventRegistrationAddonFulfillmentEvents.purchaseId, purchaseId),
      );
    await cleanupScannerRegistrationAcquisition({ acquisitionId, database });
    await database
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, registrationId));
    await database.delete(eventAddons).where(eq(eventAddons.id, addOnId));
  }
});
