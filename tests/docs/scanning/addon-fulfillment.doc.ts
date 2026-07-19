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

test('Fulfill scanned registration add-ons', async ({
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
      checkedInGuestCount: 0,
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
You need a confirmed organizer/helper registration for this event or **Organize all events** access. Cancelling add-on units additionally requires **Cancel registrations and add-ons**. The attendee registration must be confirmed.
{% /callout %}

# Fulfill add-ons from a scanned registration

1. Sign in to the organization that owns the event.
2. Select **Scanner** in the main navigation.
3. Scan the attendee's confirmed ticket QR code.
4. Verify the attendee, event, registration option, and add-on quantities before recording fulfillment.

The QR value identifies a registration but does not grant access by itself. Evorto still checks the organization and your organizer access before showing the result or accepting an action.

If the camera is unavailable, open the attendee's ticket link through the scanner result flow and verify the same registration details before recording fulfillment.
`,
    });

    await page.goto(`/scan/registration/${registrationId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Registration scanned' }),
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
## Hand out one unit and undo an accidental tap

The overview separates included and purchased quantities and always shows what is ready to hand out, already handed out, cancelled, and whether a refund applies. Select **Hand out 1** only when one unit has actually been handed over or the checklist item has been completed.

After a handout, the scanner offers **Undo last handout** only for that add-on's latest recorded handout. Use it immediately for an accidental tap. Handed-out units cannot be cancelled.
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
    await takeScreenshot(
      testInfo,
      addOn,
      page,
      'Record one handed-out included unit',
    );

    await testInfo.attach('markdown', {
      body: `
## Cancel remaining units

Select **Cancel remaining units**, choose a whole-unit quantity, enter the required operational reason, and explicitly choose refund handling when optional units are selected. Evorto allocates the selected cancellation to optional purchased units first, then included units; the dialog shows the exact split before submission. Included units can be cancelled while they remain unredeemed, but they are never refunded. Optional purchased units may be cancelled with or without refund handling.

This optional add-on is free, so no monetary refund is required. For paid cancellation and refund recovery, continue with **Cancel a Stripe-backed registration with settled add-ons and recover its refund** in [Participant registration cancellation](/docs/participant-registration-cancellation), and rely on the refund status Evorto displays before telling a participant that money has been returned.
`,
    });

    await addOn.getByRole('button', { name: 'Cancel remaining units' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('2 unredeemed units available');
    await expect(dialog).toContainText(
      'Selected cancellation: 1 optional, 0 included.',
    );
    await expect(dialog).toContainText(
      'Optional purchased units are cancelled before included units.',
    );
    await expect(dialog).toContainText(
      'No monetary refund is required because these optional units were free.',
    );
    await expect(
      dialog.getByRole('button', { name: 'Cancel selected units' }),
    ).toBeDisabled();
    await dialog
      .getByLabel('Cancellation reason')
      .fill('The attendee no longer needs the extra tote.');
    await dialog.getByRole('radio', { name: /Cancel with refund/ }).click();
    await takeScreenshot(
      testInfo,
      dialog,
      page,
      'Confirm quantity reason and refund handling',
    );
    await dialog.getByRole('button', { name: 'Cancel selected units' }).click();

    await expect(
      addOn.getByText('Cancelled', { exact: true }).locator('..'),
    ).toContainText('1', { timeout: 15_000 });
    await expect(
      page.getByText('Cancellation recorded. No monetary refund was required.'),
    ).toBeVisible();
    await expect(
      addOn.getByText('Handed out', { exact: true }).locator('..'),
    ).toContainText('1');
    await expect(
      addOn.getByText('Ready to hand out', { exact: true }).locator('..'),
    ).toContainText('1');
    await expect(addOn.getByText('No monetary refund required')).toBeVisible();
    await takeScreenshot(
      testInfo,
      addOn,
      page,
      'Review handed-out cancelled remaining and refund status',
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
## Safe completion and recovery

Retrying the same action cannot silently hand out or cancel the same unit twice. The result shows the latest fulfillment state after each success. If another organizer changes the same add-on first, Evorto asks you to refresh instead of overwriting their work.

Cancellation is hidden without the separate cancellation permission. Registrations and add-ons from another organization cannot be changed here. Handed-out units remain visible in the audit trail and cannot be moved into the cancelled quantity.
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
