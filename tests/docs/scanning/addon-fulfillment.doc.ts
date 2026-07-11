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
import { seedScannerFulfillmentAddon } from '../../support/utils/seed-scanner-fulfillment';

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
    await seedScannerFulfillmentAddon({
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

1. Sign in to the tenant that owns the event.
2. Select **Scanner** in the main navigation.
3. Scan the attendee's confirmed ticket QR code.
4. Verify the attendee, event, registration option, and add-on quantities before recording fulfillment.

The QR value is only a registration locator. Evorto rechecks the current tenant and your organizer permissions before showing the result or accepting an action.

This generated walkthrough opens the deterministic registration-result URL directly. That keeps documentation repeatable without pretending that a synthetic camera stream proves real-device camera behavior. Review camera permission, focus, and QR recognition manually on a representative organizer device; if camera emulation later becomes straightforward and reliable, it can supplement this result-page journey.
`,
    });

    await page.goto(`/scan/registration/${registrationId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Registration scanned' }),
    ).toBeVisible();
    const fulfillmentHeading = await waitForScannerAddonFulfillment(page);
    const addOn = page.locator('article').filter({ hasText: addOnTitle });
    await expect(addOn).toContainText(
      '1 included (1 unredeemed) · 2 optional (2 unredeemed)',
    );
    await expect(addOn.getByText('Total').locator('..')).toContainText('3');
    await expect(addOn.getByText('Redeemed').locator('..')).toContainText('0');
    await expect(addOn.getByText('Cancelled').locator('..')).toContainText('0');
    await expect(addOn.getByText('Remaining').locator('..')).toContainText('3');
    await takeScreenshot(
      testInfo,
      fulfillmentHeading,
      page,
      'Review included and optional add-on quantities',
    );

    await testInfo.attach('markdown', {
      body: `
## Redeem one unit and undo an accidental tap

The overview separates included and optional quantities and always shows total, redeemed, cancelled, remaining, and refund state. Select **Redeem 1** only when one unit has actually been handed over or the checklist item has been completed.

After a redemption, the scanner offers **Undo last redemption** only for that add-on's current latest unreversed redemption. Use it immediately for an accidental tap. Redeemed units cannot be cancelled.
`,
    });

    await addOn.getByRole('button', { name: 'Redeem 1' }).click();
    await expect(addOn.getByText('Redeemed').locator('..')).toContainText('1');
    await addOn.getByRole('button', { name: 'Undo last redemption' }).click();
    await expect(addOn.getByText('Redeemed').locator('..')).toContainText('0');
    await expect(
      addOn.getByRole('button', { name: 'Undo last redemption' }),
    ).toHaveCount(0);

    await addOn.getByRole('button', { name: 'Redeem 1' }).click();
    await expect(addOn.getByText('Redeemed').locator('..')).toContainText('1');
    await takeScreenshot(
      testInfo,
      addOn,
      page,
      'Record one redeemed included unit',
    );

    await testInfo.attach('markdown', {
      body: `
## Cancel unredeemed units

Select **Cancel unredeemed units**, choose a whole-unit quantity, enter the required operational reason, and explicitly choose refund handling when optional units are selected. Evorto allocates the selected cancellation to optional purchased units first, then included units; the dialog shows the exact split before submission. Included units can be cancelled while they remain unredeemed, but they are never refunded. Optional purchased units may be cancelled with or without refund handling.

For this free optional add-on, the refund choice explains that no monetary refund is required and records that outcome explicitly. This walkthrough does not exercise a paid Stripe refund. Paid refund and recovery evidence belongs to the finance/payment tests; follow the displayed status and the tenant's operator recovery guidance when payment processing needs attention.
`,
    });

    await addOn
      .getByRole('button', { name: 'Cancel unredeemed units' })
      .click();
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
      page.getByText('Cancellation recorded. No monetary refund was required.'),
    ).toBeVisible();
    await expect(addOn.getByText('Redeemed').locator('..')).toContainText('1');
    await expect(addOn.getByText('Cancelled').locator('..')).toContainText('1');
    await expect(addOn.getByText('Remaining').locator('..')).toContainText('1');
    await expect(addOn.getByText('No monetary refund required')).toBeVisible();
    await takeScreenshot(
      testInfo,
      addOn,
      page,
      'Review redeemed cancelled remaining and refund status',
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

Every action uses an idempotent operation key, so a retry cannot silently apply the same write twice. The result refreshes from persisted fulfillment state after each success. If another organizer changes the same add-on first, Evorto rejects the stale action and asks you to refresh instead of overwriting their work.

Cancellation is hidden without the separate cancellation permission and is rejected again on the server. Cross-tenant registration or add-on identifiers are not accepted. Redeemed units remain visible in the audit trail and cannot be moved into the cancelled quantity.
`,
    });
  } finally {
    await database
      .delete(eventRegistrationAddonFulfillmentEvents)
      .where(
        eq(eventRegistrationAddonFulfillmentEvents.purchaseId, purchaseId),
      );
    await database
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, registrationId));
    await database.delete(eventAddons).where(eq(eventAddons.id, addOnId));
  }
});
