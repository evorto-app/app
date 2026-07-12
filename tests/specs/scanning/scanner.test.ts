import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import type { SeedTenantResult } from '../../../helpers/seed-tenant';
import { adminStateFile, organizerStateFile } from '../../../helpers/user-data';
import type { relations } from '../../../src/db/relations';
import {
  eventAddons,
  eventRegistrationAddonFulfillmentAllocations,
  eventRegistrationAddonFulfillmentEvents,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationAddonRefundAllocations,
  eventRegistrationOptions,
  eventRegistrations,
  users,
  usersToTenants,
} from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { installMockCamera } from '../../support/utils/mock-camera';
import {
  fillScannerGuestCheckInCount,
  waitForScannerAddonFulfillment,
} from '../../support/utils/scanner-result-page';
import { seedScannerFulfillmentAddon } from '../../support/utils/seed-scanner-fulfillment';

test.use({ storageState: adminStateFile });

type TestDatabase = NodePgDatabase<typeof relations>;

const requireScannerFixture = async ({
  database,
  seeded,
}: {
  database: TestDatabase;
  seeded: SeedTenantResult;
}) => {
  const eventId = seeded.scenario.events.past.eventId;
  const event = seeded.events.find((seededEvent) => seededEvent.id === eventId);
  if (!event) {
    throw new Error('Expected seeded past event for scanner coverage');
  }

  const registrationOption = event.registrationOptions.find(
    (option) => !option.organizingRegistration,
  );
  if (!registrationOption) {
    throw new Error(
      'Expected participant registration option for scanner coverage',
    );
  }

  const [optionBefore] = await database
    .select({ checkedInSpots: eventRegistrationOptions.checkedInSpots })
    .from(eventRegistrationOptions)
    .where(
      and(
        eq(eventRegistrationOptions.eventId, eventId),
        eq(eventRegistrationOptions.id, registrationOption.id),
      ),
    );
  if (!optionBefore) {
    throw new Error(
      `Expected registration option "${registrationOption.id}" for seeded scanner event`,
    );
  }

  const scannerUserId = getId();
  const scannerTenantUserId = getId();
  const scannerUserEmail = `scanner-${scannerUserId}@example.test`;
  await database.insert(users).values({
    auth0Id: `test|scanner-${scannerUserId}`,
    communicationEmail: scannerUserEmail,
    email: scannerUserEmail,
    firstName: 'Scanner',
    id: scannerUserId,
    lastName: 'Fixture',
  });
  await database.insert(usersToTenants).values({
    id: scannerTenantUserId,
    tenantId: seeded.tenant.id,
    userId: scannerUserId,
  });

  return {
    cleanupUser: async () => {
      await database
        .delete(usersToTenants)
        .where(eq(usersToTenants.id, scannerTenantUserId));
      await database.delete(users).where(eq(users.id, scannerUserId));
    },
    eventId,
    optionBefore,
    registrationOptionId: registrationOption.id,
    tenantId: seeded.tenant.id,
    userId: scannerUserId,
  };
};

test('scanner starts a first-party camera allowed by the response policy', async ({
  page,
}) => {
  await installMockCamera(page, 'allowed');

  const response = await page.goto('/scan');

  expect(response?.headers()['permissions-policy']).toBe(
    'camera=(self), geolocation=(), microphone=()',
  );
  await expect(
    page.getByRole('heading', { level: 1, name: 'Scanner' }),
  ).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Camera ready.' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .getByLabel('Camera preview for ticket scanning')
        .evaluate((video: HTMLVideoElement) => Boolean(video.srcObject)),
    )
    .toBe(true);
});

test('scanner explains a denied camera and offers a retry', async ({
  page,
}) => {
  await installMockCamera(page, 'denied');

  await page.goto('/scan');

  await expect(page.getByRole('alert')).toContainText('Scanning error');
  await expect(page.getByRole('alert')).toContainText(
    'The camera could not be started.',
  );
  await expect(
    page.getByRole('button', { name: 'Try camera again' }),
  ).toBeEnabled();
});

test('scanner redeems, immediately undoes, and cancels add-on quantities with explicit refund handling', async ({
  database,
  page,
  seeded,
}) => {
  test.slow();

  const scannerFixture = await requireScannerFixture({ database, seeded });
  const registrationId = getId();
  const toteAddOnId = getId();
  const totePurchaseId = getId();
  const totePurchaseLotId = getId();
  const voucherAddOnId = getId();
  const voucherPurchaseId = getId();
  const voucherPurchaseLotId = getId();
  const checklistAddOnId = getId();
  const checklistPurchaseId = getId();
  const checklistPurchaseLotId = getId();
  const toteTitle = 'Welcome tote';
  const voucherTitle = 'Drink voucher';
  const checklistTitle = 'Photo acknowledgement';

  try {
    await database.insert(eventRegistrations).values({
      checkedInGuestCount: 0,
      eventId: scannerFixture.eventId,
      guestCount: 0,
      id: registrationId,
      registrationOptionId: scannerFixture.registrationOptionId,
      status: 'CONFIRMED',
      tenantId: scannerFixture.tenantId,
      userId: scannerFixture.userId,
    });
    await seedScannerFulfillmentAddon({
      addOnId: toteAddOnId,
      database,
      eventId: scannerFixture.eventId,
      includedQuantity: 1,
      optionalQuantity: 2,
      purchaseId: totePurchaseId,
      purchaseLotId: totePurchaseLotId,
      registrationId,
      registrationOptionId: scannerFixture.registrationOptionId,
      tenant: seeded.tenant,
      title: toteTitle,
    });
    await seedScannerFulfillmentAddon({
      addOnId: voucherAddOnId,
      database,
      eventId: scannerFixture.eventId,
      includedQuantity: 0,
      optionalQuantity: 1,
      purchaseId: voucherPurchaseId,
      purchaseLotId: voucherPurchaseLotId,
      registrationId,
      registrationOptionId: scannerFixture.registrationOptionId,
      tenant: seeded.tenant,
      title: voucherTitle,
    });
    await seedScannerFulfillmentAddon({
      addOnId: checklistAddOnId,
      database,
      eventId: scannerFixture.eventId,
      includedQuantity: 1,
      optionalQuantity: 0,
      purchaseId: checklistPurchaseId,
      purchaseLotId: checklistPurchaseLotId,
      registrationId,
      registrationOptionId: scannerFixture.registrationOptionId,
      tenant: seeded.tenant,
      title: checklistTitle,
    });

    await page.goto(`/scan/registration/${registrationId}`);
    await waitForScannerAddonFulfillment(page);

    const tote = page.locator('article').filter({ hasText: toteTitle });
    const voucher = page.locator('article').filter({ hasText: voucherTitle });
    const checklist = page
      .locator('article')
      .filter({ hasText: checklistTitle });
    await expect(tote).toContainText(
      '1 included (1 unredeemed) · 2 optional (2 unredeemed)',
    );
    await expect(
      tote.getByText('Total', { exact: true }).locator('..'),
    ).toContainText('3');
    await expect(
      tote.getByText('Redeemed', { exact: true }).locator('..'),
    ).toContainText('0');
    await expect(
      tote.getByText('Cancelled', { exact: true }).locator('..'),
    ).toContainText('0');
    await expect(
      tote.getByText('Remaining', { exact: true }).locator('..'),
    ).toContainText('3');
    await expect(tote.getByText('No refund requested')).toBeVisible();

    await tote.getByRole('button', { name: 'Cancel unredeemed units' }).click();
    const allocationPreviewDialog = page.getByRole('dialog');
    await expect(allocationPreviewDialog).toContainText(
      'Selected cancellation: 1 optional, 0 included.',
    );
    await expect(allocationPreviewDialog).toContainText(
      'Optional purchased units are cancelled before included units.',
    );
    const previewQuantity =
      allocationPreviewDialog.getByLabel('Quantity to cancel');
    await previewQuantity.fill('1.5');
    await previewQuantity.blur();
    await expect(allocationPreviewDialog).toContainText(
      'Choose an available whole-unit quantity.',
    );
    await expect(
      allocationPreviewDialog.getByRole('button', {
        name: 'Cancel selected units',
      }),
    ).toBeDisabled();
    await previewQuantity.fill('1');
    await allocationPreviewDialog
      .getByRole('button', { name: 'Keep units' })
      .click();

    await tote.getByRole('button', { name: 'Redeem 1' }).click();
    await expect(
      tote.getByText('Redeemed', { exact: true }).locator('..'),
    ).toContainText('1', { timeout: 15_000 });
    await expect(page.getByText(`${toteTitle} redeemed.`)).toBeVisible();
    await tote.getByRole('button', { name: 'Undo last redemption' }).click();
    await expect(
      tote.getByText('Redeemed', { exact: true }).locator('..'),
    ).toContainText('0', { timeout: 15_000 });
    await expect(
      page.getByText(`${toteTitle} redemption undone.`),
    ).toBeVisible();
    await expect(
      tote.getByRole('button', { name: 'Undo last redemption' }),
    ).toHaveCount(0);

    await tote.getByRole('button', { name: 'Redeem 1' }).click();
    await expect(
      tote.getByText('Redeemed', { exact: true }).locator('..'),
    ).toContainText('1', { timeout: 15_000 });
    await tote.getByRole('button', { name: 'Redeem 1' }).click();
    await expect(
      tote.getByText('Redeemed', { exact: true }).locator('..'),
    ).toContainText('2', { timeout: 15_000 });

    await tote.getByRole('button', { name: 'Cancel unredeemed units' }).click();
    const refundDialog = page.getByRole('dialog');
    await expect(refundDialog).toContainText('1 unredeemed unit available');
    await expect(refundDialog).toContainText(
      'No monetary refund is required because these optional units were free.',
    );
    await refundDialog
      .getByLabel('Cancellation reason')
      .fill('The attendee no longer needs the remaining tote.');
    await refundDialog
      .getByRole('radio', { name: /Cancel with refund/ })
      .click();
    await refundDialog
      .getByRole('button', { name: 'Cancel selected units' })
      .click();
    await expect(
      tote.getByText('Cancelled', { exact: true }).locator('..'),
    ).toContainText('1', { timeout: 15_000 });
    await expect(
      page.getByText('Cancellation recorded. No monetary refund was required.'),
    ).toBeVisible();
    await expect(
      tote.getByText('Remaining', { exact: true }).locator('..'),
    ).toContainText('0');
    await expect(tote.getByText('No monetary refund required')).toBeVisible();
    await expect(tote.getByRole('button', { name: 'Redeem 1' })).toHaveCount(0);
    await expect(
      tote.getByRole('button', { name: 'Cancel unredeemed units' }),
    ).toHaveCount(0);

    await voucher
      .getByRole('button', { name: 'Cancel unredeemed units' })
      .click();
    const noRefundDialog = page.getByRole('dialog');
    await noRefundDialog
      .getByLabel('Cancellation reason')
      .fill('The attendee declined the voucher.');
    await noRefundDialog
      .getByRole('radio', { name: 'Cancel without a refund' })
      .click();
    await noRefundDialog
      .getByRole('button', { name: 'Cancel selected units' })
      .click();
    await expect(
      voucher.getByText('Cancelled', { exact: true }).locator('..'),
    ).toContainText('1', { timeout: 15_000 });
    await expect(voucher.getByText('Cancelled without refund')).toBeVisible();

    await checklist
      .getByRole('button', { name: 'Cancel unredeemed units' })
      .click();
    const includedDialog = page.getByRole('dialog');
    await expect(includedDialog).toContainText('1 unredeemed unit available');
    await expect(includedDialog).toContainText(
      'Only included units remain. No payment refund applies to them.',
    );
    await expect(includedDialog).toContainText(
      'This cancellation contains only included units and will be recorded without a refund.',
    );
    await expect(includedDialog.getByRole('radio')).toHaveCount(0);
    await includedDialog
      .getByLabel('Cancellation reason')
      .fill('The checklist item is no longer needed.');
    await includedDialog
      .getByRole('button', { name: 'Cancel selected units' })
      .click();
    await expect(
      checklist.getByText('Cancelled', { exact: true }).locator('..'),
    ).toContainText('1', { timeout: 15_000 });
    await expect(
      checklist.getByText('Remaining', { exact: true }).locator('..'),
    ).toContainText('0');
    await expect(
      checklist.getByText('No monetary refund required'),
    ).toBeVisible();

    const fulfillmentEvents = await database
      .select({
        id: eventRegistrationAddonFulfillmentEvents.id,
        purchaseId: eventRegistrationAddonFulfillmentEvents.purchaseId,
        reason: eventRegistrationAddonFulfillmentEvents.reason,
        refundDisposition:
          eventRegistrationAddonFulfillmentEvents.refundDisposition,
        refundRequested:
          eventRegistrationAddonFulfillmentEvents.refundRequested,
        reversesEventId:
          eventRegistrationAddonFulfillmentEvents.reversesEventId,
        type: eventRegistrationAddonFulfillmentEvents.type,
      })
      .from(eventRegistrationAddonFulfillmentEvents)
      .where(
        inArray(eventRegistrationAddonFulfillmentEvents.purchaseId, [
          totePurchaseId,
          voucherPurchaseId,
          checklistPurchaseId,
        ]),
      );
    expect(fulfillmentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          purchaseId: checklistPurchaseId,
          refundRequested: false,
          type: 'cancelled',
        }),
        expect.objectContaining({
          purchaseId: totePurchaseId,
          refundRequested: true,
          type: 'cancelled',
        }),
        expect.objectContaining({
          purchaseId: voucherPurchaseId,
          refundRequested: false,
          type: 'cancelled',
        }),
        expect.objectContaining({
          purchaseId: totePurchaseId,
          type: 'redemption_undone',
        }),
      ]),
    );

    const toteEvents = fulfillmentEvents.filter(
      ({ purchaseId }) => purchaseId === totePurchaseId,
    );
    const toteRedemptions = toteEvents.filter(
      ({ type }) => type === 'redeemed',
    );
    const toteUndo = toteEvents.find(
      ({ type }) => type === 'redemption_undone',
    );
    expect(toteRedemptions).toHaveLength(3);
    expect(new Set(toteRedemptions.map(({ id }) => id)).size).toBe(3);
    expect(toteUndo?.reversesEventId).not.toBeNull();
    expect(
      toteRedemptions.filter(({ id }) => id !== toteUndo?.reversesEventId),
    ).toHaveLength(2);

    const cancellationEventByPurchaseId = new Map(
      fulfillmentEvents
        .filter(({ type }) => type === 'cancelled')
        .map((event) => [event.purchaseId, event]),
    );
    const toteCancellation = cancellationEventByPurchaseId.get(totePurchaseId);
    const voucherCancellation =
      cancellationEventByPurchaseId.get(voucherPurchaseId);
    const checklistCancellation =
      cancellationEventByPurchaseId.get(checklistPurchaseId);
    if (!toteCancellation || !voucherCancellation || !checklistCancellation) {
      throw new Error('Expected one cancellation event for each seeded add-on');
    }
    expect(toteCancellation.refundDisposition).toBe(
      'no_monetary_refund_required',
    );
    expect(voucherCancellation.refundDisposition).toBe('not_requested');
    expect(checklistCancellation.refundDisposition).toBe('not_requested');

    const inventoryRows = await database
      .select({
        id: eventAddons.id,
        totalAvailableQuantity: eventAddons.totalAvailableQuantity,
      })
      .from(eventAddons)
      .where(
        inArray(eventAddons.id, [
          toteAddOnId,
          voucherAddOnId,
          checklistAddOnId,
        ]),
      );
    expect(
      Object.fromEntries(
        inventoryRows.map(({ id, totalAvailableQuantity }) => [
          id,
          totalAvailableQuantity,
        ]),
      ),
    ).toEqual({
      [checklistAddOnId]: 10,
      [toteAddOnId]: 8,
      [voucherAddOnId]: 10,
    });

    const purchaseRows = await database
      .select({
        cancelledQuantity: eventRegistrationAddonPurchases.cancelledQuantity,
        id: eventRegistrationAddonPurchases.id,
        redeemedQuantity: eventRegistrationAddonPurchases.redeemedQuantity,
        refundAllocatedPurchasedQuantity:
          eventRegistrationAddonPurchases.refundAllocatedPurchasedQuantity,
      })
      .from(eventRegistrationAddonPurchases)
      .where(
        inArray(eventRegistrationAddonPurchases.id, [
          totePurchaseId,
          voucherPurchaseId,
          checklistPurchaseId,
        ]),
      );
    expect(
      Object.fromEntries(
        purchaseRows.map(({ id, ...counters }) => [id, counters]),
      ),
    ).toEqual({
      [checklistPurchaseId]: {
        cancelledQuantity: 1,
        redeemedQuantity: 0,
        refundAllocatedPurchasedQuantity: 0,
      },
      [totePurchaseId]: {
        cancelledQuantity: 1,
        redeemedQuantity: 2,
        refundAllocatedPurchasedQuantity: 1,
      },
      [voucherPurchaseId]: {
        cancelledQuantity: 1,
        redeemedQuantity: 0,
        refundAllocatedPurchasedQuantity: 0,
      },
    });

    const purchaseLotRows = await database
      .select({
        cancelledQuantity: eventRegistrationAddonPurchaseLots.cancelledQuantity,
        id: eventRegistrationAddonPurchaseLots.id,
        redeemedQuantity: eventRegistrationAddonPurchaseLots.redeemedQuantity,
        refundAllocatedQuantity:
          eventRegistrationAddonPurchaseLots.refundAllocatedQuantity,
      })
      .from(eventRegistrationAddonPurchaseLots)
      .where(
        inArray(eventRegistrationAddonPurchaseLots.id, [
          totePurchaseLotId,
          voucherPurchaseLotId,
        ]),
      );
    expect(
      Object.fromEntries(
        purchaseLotRows.map(({ id, ...counters }) => [id, counters]),
      ),
    ).toEqual({
      [totePurchaseLotId]: {
        cancelledQuantity: 1,
        redeemedQuantity: 1,
        refundAllocatedQuantity: 1,
      },
      [voucherPurchaseLotId]: {
        cancelledQuantity: 1,
        redeemedQuantity: 0,
        refundAllocatedQuantity: 0,
      },
    });

    const cancellationAllocations = await database
      .select({
        fulfillmentEventId:
          eventRegistrationAddonFulfillmentAllocations.fulfillmentEventId,
        purchaseLotId:
          eventRegistrationAddonFulfillmentAllocations.purchaseLotId,
        quantity: eventRegistrationAddonFulfillmentAllocations.quantity,
        source: eventRegistrationAddonFulfillmentAllocations.source,
      })
      .from(eventRegistrationAddonFulfillmentAllocations)
      .where(
        inArray(
          eventRegistrationAddonFulfillmentAllocations.fulfillmentEventId,
          [
            toteCancellation.id,
            voucherCancellation.id,
            checklistCancellation.id,
          ],
        ),
      );
    expect(cancellationAllocations).toHaveLength(3);
    expect(cancellationAllocations).toEqual(
      expect.arrayContaining([
        {
          fulfillmentEventId: toteCancellation.id,
          purchaseLotId: totePurchaseLotId,
          quantity: 1,
          source: 'purchased',
        },
        {
          fulfillmentEventId: voucherCancellation.id,
          purchaseLotId: voucherPurchaseLotId,
          quantity: 1,
          source: 'purchased',
        },
        {
          fulfillmentEventId: checklistCancellation.id,
          purchaseLotId: null,
          quantity: 1,
          source: 'included',
        },
      ]),
    );

    const refundAllocations = await database
      .select({ id: eventRegistrationAddonRefundAllocations.id })
      .from(eventRegistrationAddonRefundAllocations)
      .where(
        inArray(eventRegistrationAddonRefundAllocations.purchaseId, [
          totePurchaseId,
          voucherPurchaseId,
          checklistPurchaseId,
        ]),
      );
    expect(refundAllocations).toEqual([]);
  } finally {
    await database
      .delete(eventRegistrationAddonFulfillmentEvents)
      .where(
        inArray(eventRegistrationAddonFulfillmentEvents.purchaseId, [
          totePurchaseId,
          voucherPurchaseId,
          checklistPurchaseId,
        ]),
      );
    await database
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, registrationId));
    await database
      .delete(eventAddons)
      .where(
        inArray(eventAddons.id, [
          toteAddOnId,
          voucherAddOnId,
          checklistAddOnId,
        ]),
      );
  }
});

test.describe('organizer add-on cancellation permissions', () => {
  test.use({ storageState: organizerStateFile });

  test('keeps redemption available while explaining and enforcing separate cancellation access', async ({
    database,
    page,
    permissionOverride,
    seeded,
  }) => {
    test.slow();

    const scannerFixture = await requireScannerFixture({ database, seeded });
    const registrationId = getId();
    const addOnId = getId();
    const purchaseId = getId();
    const purchaseLotId = getId();
    const title = 'Permission-scoped welcome pack';

    try {
      await permissionOverride({
        add: ['events:organizeAll'],
        remove: ['events:cancelRegistrations'],
        roleName: 'Section member',
      });
      await database.insert(eventRegistrations).values({
        checkedInGuestCount: 0,
        eventId: scannerFixture.eventId,
        guestCount: 0,
        id: registrationId,
        registrationOptionId: scannerFixture.registrationOptionId,
        status: 'CONFIRMED',
        tenantId: scannerFixture.tenantId,
        userId: scannerFixture.userId,
      });
      await seedScannerFulfillmentAddon({
        addOnId,
        database,
        eventId: scannerFixture.eventId,
        includedQuantity: 1,
        optionalQuantity: 1,
        purchaseId,
        purchaseLotId,
        registrationId,
        registrationOptionId: scannerFixture.registrationOptionId,
        tenant: seeded.tenant,
        title,
      });

      await page.goto('/scan/registration/' + registrationId);
      await waitForScannerAddonFulfillment(page);
      const addOn = page.locator('article').filter({ hasText: title });
      await expect(
        addOn.getByRole('button', { name: 'Redeem 1' }),
      ).toBeVisible();
      await expect(
        addOn.getByRole('button', { name: 'Cancel unredeemed units' }),
      ).toHaveCount(0);
      await expect(addOn).toContainText(
        'Cancelling units requires Cancel registrations and add-ons access.',
      );

      await addOn.getByRole('button', { name: 'Redeem 1' }).click();
      await expect(
        addOn.getByRole('button', { name: 'Undo last redemption' }),
      ).toBeVisible({ timeout: 15_000 });
      await addOn.getByRole('button', { name: 'Undo last redemption' }).click();
      await expect(
        addOn.getByText('Redeemed', { exact: true }).locator('..'),
      ).toContainText('0', { timeout: 15_000 });

      await permissionOverride({
        add: ['events:cancelRegistrations'],
        roleName: 'Section member',
      });
      await page.reload();
      await waitForScannerAddonFulfillment(page);
      await expect(
        addOn.getByRole('button', { name: 'Cancel unredeemed units' }),
      ).toBeVisible();
      await expect(addOn).not.toContainText(
        'Cancelling units requires Cancel registrations and add-ons access.',
      );
    } finally {
      await database
        .delete(eventRegistrations)
        .where(eq(eventRegistrations.id, registrationId));
      await database.delete(eventAddons).where(eq(eventAddons.id, addOnId));
    }
  });
});

test('scan confirmed registration records check-in', async ({
  database,
  page,
  seeded,
}) => {
  const scannerFixture = await requireScannerFixture({ database, seeded });
  const registrationId = getId();

  try {
    await database.insert(eventRegistrations).values({
      checkedInGuestCount: 0,
      eventId: scannerFixture.eventId,
      guestCount: 2,
      id: registrationId,
      registrationOptionId: scannerFixture.registrationOptionId,
      status: 'CONFIRMED',
      tenantId: scannerFixture.tenantId,
      userId: scannerFixture.userId,
    });

    await page.goto(`/scan/registration/${registrationId}`);
    await expect(
      page.getByRole('heading', { name: 'Registration scanned' }),
    ).toBeVisible();
    await expect(page.getByText('Event starting in the future')).toHaveCount(0);
    const confirmCheckIn = await fillScannerGuestCheckInCount(page, {
      guestCount: 2,
      includeAttendee: true,
    });
    await confirmCheckIn.click();
    await expect(page.getByText('Check-in recorded')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Checked in' }),
    ).toBeDisabled();

    await expect
      .poll(async () => {
        const [registration] = await database
          .select({
            checkedInGuestCount: eventRegistrations.checkedInGuestCount,
            checkInTime: eventRegistrations.checkInTime,
          })
          .from(eventRegistrations)
          .where(eq(eventRegistrations.id, registrationId));
        const [option] = await database
          .select({ checkedInSpots: eventRegistrationOptions.checkedInSpots })
          .from(eventRegistrationOptions)
          .where(
            eq(
              eventRegistrationOptions.id,
              scannerFixture.registrationOptionId,
            ),
          );

        return {
          checkedIn: registration?.checkInTime !== null,
          checkedInGuestCount: registration?.checkedInGuestCount,
          checkedInSpots: option?.checkedInSpots,
        };
      })
      .toEqual({
        checkedIn: true,
        checkedInGuestCount: 2,
        checkedInSpots: scannerFixture.optionBefore.checkedInSpots + 3,
      });

    await page.goto(`/events/${scannerFixture.eventId}/organize`);
    await expect(page.getByTestId('event-organize-checked-in-stat')).toHaveText(
      String(scannerFixture.optionBefore.checkedInSpots + 3),
      { timeout: 15_000 },
    );
  } finally {
    await database
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, registrationId));
    await database
      .update(eventRegistrationOptions)
      .set({ checkedInSpots: scannerFixture.optionBefore.checkedInSpots })
      .where(
        eq(eventRegistrationOptions.id, scannerFixture.registrationOptionId),
      );
    await scannerFixture.cleanupUser();
  }
});

test('scan checked-in registration records remaining guest arrival', async ({
  database,
  page,
  seedDate,
  seeded,
}) => {
  const scannerFixture = await requireScannerFixture({ database, seeded });
  const registrationId = getId();
  const checkedInBaseline = scannerFixture.optionBefore.checkedInSpots + 2;

  try {
    await database.insert(eventRegistrations).values({
      checkedInGuestCount: 1,
      checkInTime: seedDate,
      eventId: scannerFixture.eventId,
      guestCount: 2,
      id: registrationId,
      registrationOptionId: scannerFixture.registrationOptionId,
      status: 'CONFIRMED',
      tenantId: scannerFixture.tenantId,
      userId: scannerFixture.userId,
    });
    await database
      .update(eventRegistrationOptions)
      .set({ checkedInSpots: checkedInBaseline })
      .where(
        eq(eventRegistrationOptions.id, scannerFixture.registrationOptionId),
      );

    await page.goto(`/scan/registration/${registrationId}`);
    await expect(
      page.getByRole('heading', { name: 'Registration scanned' }),
    ).toBeVisible();
    await expect(page.getByText('1 checked in, 1 remaining.')).toBeVisible();
    await expect(page.getByText('Already checked in')).toHaveCount(0);

    const confirmGuestCheckIn = await fillScannerGuestCheckInCount(page, {
      guestCount: 1,
      includeAttendee: false,
    });
    await confirmGuestCheckIn.click();
    await expect(page.getByText('Check-in recorded')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Checked in' }),
    ).toBeDisabled();

    await expect
      .poll(async () => {
        const [registration] = await database
          .select({
            checkedInGuestCount: eventRegistrations.checkedInGuestCount,
            checkInTime: eventRegistrations.checkInTime,
          })
          .from(eventRegistrations)
          .where(eq(eventRegistrations.id, registrationId));
        const [option] = await database
          .select({ checkedInSpots: eventRegistrationOptions.checkedInSpots })
          .from(eventRegistrationOptions)
          .where(
            eq(
              eventRegistrationOptions.id,
              scannerFixture.registrationOptionId,
            ),
          );

        return {
          checkedIn: registration?.checkInTime !== null,
          checkedInGuestCount: registration?.checkedInGuestCount,
          checkedInSpots: option?.checkedInSpots,
        };
      })
      .toEqual({
        checkedIn: true,
        checkedInGuestCount: 2,
        checkedInSpots: checkedInBaseline + 1,
      });

    await page.goto(`/events/${scannerFixture.eventId}/organize`);
    await expect(page.getByTestId('event-organize-checked-in-stat')).toHaveText(
      String(checkedInBaseline + 1),
      { timeout: 15_000 },
    );
  } finally {
    await database
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, registrationId));
    await database
      .update(eventRegistrationOptions)
      .set({ checkedInSpots: scannerFixture.optionBefore.checkedInSpots })
      .where(
        eq(eventRegistrationOptions.id, scannerFixture.registrationOptionId),
      );
    await scannerFixture.cleanupUser();
  }
});
