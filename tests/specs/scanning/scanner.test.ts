import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import type { SeedTenantResult } from '../../../helpers/seed-tenant';
import {
  adminStateFile,
  emptyStateFile,
  organizerStateFile,
} from '../../../helpers/user-data';
import type { relations } from '../../../src/db/relations';
import {
  eventAddons,
  eventInstances,
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
import {
  cleanupScannerRegistrationAcquisition,
  seedScannerFulfillmentAddon,
  seedScannerRegistrationAcquisition,
} from '../../support/utils/seed-scanner-fulfillment';

test.use({ storageState: adminStateFile });

type TestDatabase = NodePgDatabase<typeof relations>;
type RegistrationPriceSnapshot = Pick<
  typeof eventRegistrations.$inferInsert,
  | 'basePriceAtRegistration'
  | 'discountAmount'
  | 'stripeTaxRateId'
  | 'taxRateDisplayName'
  | 'taxRateInclusive'
  | 'taxRatePercentage'
>;

const openScannerEventCheckInWindow = async ({
  database,
  eventId,
  now,
}: {
  database: TestDatabase;
  eventId: string;
  now: Date;
}) => {
  const [eventBefore] = await database
    .select({
      end: eventInstances.end,
      start: eventInstances.start,
    })
    .from(eventInstances)
    .where(eq(eventInstances.id, eventId));
  if (!eventBefore) {
    throw new Error(`Expected scanner event "${eventId}"`);
  }

  const activatedEvents = await database
    .update(eventInstances)
    .set({
      end: new Date(now.getTime() + 30 * 60 * 1000),
      start: new Date(now.getTime() - 30 * 60 * 1000),
    })
    .where(eq(eventInstances.id, eventId))
    .returning({ id: eventInstances.id });
  if (activatedEvents.length !== 1) {
    throw new Error(`Could not activate scanner event "${eventId}"`);
  }

  return async () => {
    const restoredEvents = await database
      .update(eventInstances)
      .set(eventBefore)
      .where(eq(eventInstances.id, eventId))
      .returning({ id: eventInstances.id });
    if (restoredEvents.length !== 1) {
      throw new Error(`Could not restore scanner event "${eventId}"`);
    }
  };
};

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
  if (registrationOption.isPaid && !registrationOption.stripeTaxRateId) {
    throw new Error(
      `Paid registration option "${registrationOption.id}" is missing its Stripe tax rate`,
    );
  }
  if (!registrationOption.isPaid && registrationOption.stripeTaxRateId) {
    throw new Error(
      `Free registration option "${registrationOption.id}" unexpectedly has a Stripe tax rate`,
    );
  }

  const taxRate = registrationOption.stripeTaxRateId
    ? await database.query.tenantStripeTaxRates.findFirst({
        columns: {
          active: true,
          displayName: true,
          inclusive: true,
          percentage: true,
          stripeAccountId: true,
        },
        where: {
          stripeTaxRateId: registrationOption.stripeTaxRateId,
          tenantId: seeded.tenant.id,
        },
      })
    : undefined;
  if (
    registrationOption.stripeTaxRateId &&
    (!taxRate ||
      !taxRate.active ||
      taxRate.percentage === null ||
      taxRate.stripeAccountId !== seeded.tenant.stripeAccountId)
  ) {
    throw new Error(
      `Registration option "${registrationOption.id}" does not reference an active, complete tax rate for its tenant Stripe account`,
    );
  }
  const registrationPriceSnapshot = {
    basePriceAtRegistration: registrationOption.price,
    discountAmount: 0,
    stripeTaxRateId: registrationOption.stripeTaxRateId,
    taxRateDisplayName: taxRate?.displayName ?? null,
    taxRateInclusive: taxRate?.inclusive ?? null,
    taxRatePercentage: taxRate?.percentage ?? null,
  } satisfies RegistrationPriceSnapshot;

  const [optionBefore] = await database
    .select({
      checkedInSpots: eventRegistrationOptions.checkedInSpots,
      confirmedSpots: eventRegistrationOptions.confirmedSpots,
      reservedSpots: eventRegistrationOptions.reservedSpots,
      spots: eventRegistrationOptions.spots,
    })
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

  const insertConfirmedRegistration = async (input: {
    checkedInGuestCount?: number;
    checkInTime?: Date;
    guestCount: number;
    registrationId: string;
  }) => {
    const checkedInGuestCount = input.checkedInGuestCount ?? 0;
    if (
      checkedInGuestCount < 0 ||
      checkedInGuestCount > input.guestCount ||
      (!input.checkInTime && checkedInGuestCount !== 0)
    ) {
      throw new Error(
        `Scanner registration "${input.registrationId}" has inconsistent checked-in guest state`,
      );
    }

    const registrationSpotCount = input.guestCount + 1;
    const initialCheckedInSpotCount = input.checkInTime
      ? checkedInGuestCount + 1
      : 0;
    const confirmedSpots = optionBefore.confirmedSpots + registrationSpotCount;
    const checkedInSpots =
      optionBefore.checkedInSpots + initialCheckedInSpotCount;
    if (
      confirmedSpots + optionBefore.reservedSpots > optionBefore.spots ||
      checkedInSpots > confirmedSpots
    ) {
      throw new Error(
        `Registration option "${registrationOption.id}" lacks coherent capacity for scanner fixture "${input.registrationId}"`,
      );
    }

    await database.transaction(async (transaction) => {
      const updatedOptions = await transaction
        .update(eventRegistrationOptions)
        .set({ checkedInSpots, confirmedSpots })
        .where(
          and(
            eq(eventRegistrationOptions.eventId, eventId),
            eq(eventRegistrationOptions.id, registrationOption.id),
            eq(
              eventRegistrationOptions.checkedInSpots,
              optionBefore.checkedInSpots,
            ),
            eq(
              eventRegistrationOptions.confirmedSpots,
              optionBefore.confirmedSpots,
            ),
          ),
        )
        .returning({ id: eventRegistrationOptions.id });
      if (updatedOptions.length !== 1) {
        throw new Error(
          `Registration option "${registrationOption.id}" counters changed before scanner fixture setup`,
        );
      }

      await transaction.insert(eventRegistrations).values({
        ...registrationPriceSnapshot,
        checkedInGuestCount,
        ...(input.checkInTime && { checkInTime: input.checkInTime }),
        eventId,
        guestCount: input.guestCount,
        id: input.registrationId,
        registrationOptionId: registrationOption.id,
        status: 'CONFIRMED',
        tenantId: seeded.tenant.id,
        userId: scannerUserId,
      });
    });

    return checkedInSpots;
  };

  return {
    cleanupUser: async () => {
      await database
        .delete(usersToTenants)
        .where(eq(usersToTenants.id, scannerTenantUserId));
      await database.delete(users).where(eq(users.id, scannerUserId));
    },
    eventId,
    insertConfirmedRegistration,
    optionBefore,
    registrationOptionId: registrationOption.id,
    restoreOptionCounters: async () => {
      await database
        .update(eventRegistrationOptions)
        .set({
          checkedInSpots: optionBefore.checkedInSpots,
          confirmedSpots: optionBefore.confirmedSpots,
        })
        .where(
          and(
            eq(eventRegistrationOptions.eventId, eventId),
            eq(eventRegistrationOptions.id, registrationOption.id),
          ),
        );
    },
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

  await expect(page.getByRole('alert')).toContainText('Camera unavailable');
  await expect(page.getByRole('alert')).toContainText(
    'The camera could not be started.',
  );
  await expect(
    page.getByRole('button', { name: 'Try camera again' }),
  ).toBeEnabled();
});

test.describe('without organizer scanner capability', () => {
  test.use({ storageState: emptyStateFile });

  test('scanner checks access without requesting the camera', async ({
    page,
  }) => {
    await installMockCamera(page, 'allowed');

    await page.goto('/scan');

    await expect(page.getByRole('alert')).toContainText('Scanner unavailable');
    const cameraPreview = page.getByLabel('Camera preview for ticket scanning');
    await expect(cameraPreview).toBeHidden();
    await expect
      .poll(() =>
        cameraPreview.evaluate((video: HTMLVideoElement) =>
          Boolean(video.srcObject),
        ),
      )
      .toBe(false);
  });
});

test('scanner hands out, immediately undoes, and cancels add-on quantities with explicit refund handling', async ({
  database,
  page,
  seeded,
}) => {
  test.slow();

  const scannerFixture = await requireScannerFixture({ database, seeded });
  const registrationId = getId();
  const acquisitionId = getId();
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
    await scannerFixture.insertConfirmedRegistration({
      guestCount: 0,
      registrationId,
    });
    await seedScannerRegistrationAcquisition({
      acquisitionId,
      database,
      eventId: scannerFixture.eventId,
      registrationId,
      tenant: seeded.tenant,
    });
    await seedScannerFulfillmentAddon({
      acquisitionId,
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
      acquisitionId,
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
      acquisitionId,
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
    await expect(tote).toContainText('1 included · 2 purchased');
    await expect(
      tote.getByText('Handed out', { exact: true }).locator('..'),
    ).toContainText('0');
    await expect(
      tote.getByText('Cancelled', { exact: true }).locator('..'),
    ).toContainText('0');
    await expect(
      tote.getByText('Ready to hand out', { exact: true }).locator('..'),
    ).toContainText('3');
    await expect(tote.getByText('No refund requested')).toBeVisible();

    await tote.getByRole('button', { name: 'Cancel remaining units' }).click();
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

    await tote.getByRole('button', { name: 'Hand out 1' }).click();
    await expect(
      tote.getByText('Handed out', { exact: true }).locator('..'),
    ).toContainText('1', { timeout: 15_000 });
    await expect(page.getByText(`${toteTitle} handed out.`)).toBeVisible();
    await tote.getByRole('button', { name: 'Undo last handout' }).click();
    await expect(
      tote.getByText('Handed out', { exact: true }).locator('..'),
    ).toContainText('0', { timeout: 15_000 });
    await expect(
      page.getByText(`Last ${toteTitle} handout undone.`),
    ).toBeVisible();
    await expect(
      tote.getByRole('button', { name: 'Undo last handout' }),
    ).toHaveCount(0);

    await tote.getByRole('button', { name: 'Hand out 1' }).click();
    await expect(
      tote.getByText('Handed out', { exact: true }).locator('..'),
    ).toContainText('1', { timeout: 15_000 });
    await tote.getByRole('button', { name: 'Hand out 1' }).click();
    await expect(
      tote.getByText('Handed out', { exact: true }).locator('..'),
    ).toContainText('2', { timeout: 15_000 });

    await tote.getByRole('button', { name: 'Cancel remaining units' }).click();
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
      tote.getByText('Ready to hand out', { exact: true }).locator('..'),
    ).toContainText('0');
    await expect(tote.getByText('No monetary refund required')).toBeVisible();
    await expect(tote.getByRole('button', { name: 'Hand out 1' })).toHaveCount(
      0,
    );
    await expect(
      tote.getByRole('button', { name: 'Cancel remaining units' }),
    ).toHaveCount(0);

    await voucher
      .getByRole('button', { name: 'Cancel remaining units' })
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
      .getByRole('button', { name: 'Cancel remaining units' })
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
      checklist.getByText('Ready to hand out', { exact: true }).locator('..'),
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
        refundAllocatedPurchasedQuantity: 0,
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
        refundAllocatedQuantity: 0,
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
    await cleanupScannerRegistrationAcquisition({ acquisitionId, database });
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
    await scannerFixture.restoreOptionCounters();
  }
});

test.describe('organizer add-on cancellation permissions', () => {
  test.use({ storageState: organizerStateFile });

  test('keeps handout available while explaining and enforcing separate cancellation access', async ({
    database,
    page,
    permissionOverride,
    seeded,
  }) => {
    test.slow();

    const scannerFixture = await requireScannerFixture({ database, seeded });
    const registrationId = getId();
    const acquisitionId = getId();
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
      await scannerFixture.insertConfirmedRegistration({
        guestCount: 0,
        registrationId,
      });
      await seedScannerRegistrationAcquisition({
        acquisitionId,
        database,
        eventId: scannerFixture.eventId,
        registrationId,
        tenant: seeded.tenant,
      });
      await seedScannerFulfillmentAddon({
        acquisitionId,
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
        addOn.getByRole('button', { name: 'Hand out 1' }),
      ).toBeVisible();
      await expect(
        addOn.getByRole('button', { name: 'Cancel remaining units' }),
      ).toHaveCount(0);
      await expect(addOn).toContainText(
        'Cancelling units requires Cancel registrations and add-ons access.',
      );

      await addOn.getByRole('button', { name: 'Hand out 1' }).click();
      await expect(
        addOn.getByRole('button', { name: 'Undo last handout' }),
      ).toBeVisible({ timeout: 15_000 });
      await addOn.getByRole('button', { name: 'Undo last handout' }).click();
      await expect(
        addOn.getByText('Handed out', { exact: true }).locator('..'),
      ).toContainText('0', { timeout: 15_000 });

      await permissionOverride({
        add: ['events:cancelRegistrations'],
        roleName: 'Section member',
      });
      await page.reload();
      await waitForScannerAddonFulfillment(page);
      await expect(
        addOn.getByRole('button', { name: 'Cancel remaining units' }),
      ).toBeVisible();
      await expect(addOn).not.toContainText(
        'Cancelling units requires Cancel registrations and add-ons access.',
      );
    } finally {
      await cleanupScannerRegistrationAcquisition({ acquisitionId, database });
      await database
        .delete(eventRegistrations)
        .where(eq(eventRegistrations.id, registrationId));
      await database.delete(eventAddons).where(eq(eventAddons.id, addOnId));
      await scannerFixture.restoreOptionCounters();
    }
  });
});

test('scan confirmed registration records check-in', async ({
  database,
  page,
  seeded,
  testClock,
}) => {
  const scannerFixture = await requireScannerFixture({ database, seeded });
  const registrationId = getId();
  const restoreEventTiming = await openScannerEventCheckInWindow({
    database,
    eventId: scannerFixture.eventId,
    now: testClock.toJSDate(),
  });

  try {
    await scannerFixture.insertConfirmedRegistration({
      guestCount: 2,
      registrationId,
    });

    await page.goto(`/scan/registration/${registrationId}`);
    await expect(
      page.getByRole('heading', { name: 'Registration scanned' }),
    ).toBeVisible();
    await expect(
      page.getByText('Check-in closed', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Check-in not open', { exact: true }),
    ).toHaveCount(0);
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
    await restoreEventTiming();
    await database
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, registrationId));
    await scannerFixture.restoreOptionCounters();
    await scannerFixture.cleanupUser();
  }
});

test('scan checked-in registration records remaining guest arrival', async ({
  database,
  page,
  seedDate,
  seeded,
  testClock,
}) => {
  const scannerFixture = await requireScannerFixture({ database, seeded });
  const registrationId = getId();
  const restoreEventTiming = await openScannerEventCheckInWindow({
    database,
    eventId: scannerFixture.eventId,
    now: testClock.toJSDate(),
  });

  try {
    const checkedInBaseline = await scannerFixture.insertConfirmedRegistration({
      checkedInGuestCount: 1,
      checkInTime: seedDate,
      guestCount: 2,
      registrationId,
    });

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
    await restoreEventTiming();
    await database
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, registrationId));
    await scannerFixture.restoreOptionCounters();
    await scannerFixture.cleanupUser();
  }
});
