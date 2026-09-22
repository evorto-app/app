import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import {
  MAX_REGISTRATION_ADDON_QUANTITY,
  MAX_REGISTRATION_GUESTS,
} from '@shared/registration-quantity-limits';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { createNodePgPoolConfig } from '../pg-connection-config';
import { relations } from '../relations';
import {
  addonToEventRegistrationOptions,
  addonToTemplateRegistrationOptions,
  eventAddons,
  eventInstances,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchaseOrders,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  registrationAcquisitionComponents,
  registrationAcquisitions,
  registrationTransferBundleAddonPurchaseLots,
  registrationTransferBundleAddonPurchases,
  registrationTransfers,
  templateEventAddons,
  templateRegistrationOptions,
  tenants,
  users,
} from './index';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

type TestDatabase = NodePgDatabase<typeof relations>;

const makeFixture = () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const id = (prefix: string) => `${prefix}-${suffix}`;
  return {
    acquisitionId: id('acq'),
    addonComponentId: id('cmp-addon'),
    addonId: id('addon'),
    categoryId: id('cat'),
    eventId: id('evt'),
    lotId: id('lot'),
    optionId: id('opt'),
    orderId: id('order'),
    purchaseId: id('purchase'),
    registrationComponentId: id('cmp-reg'),
    registrationId: id('reg'),
    templateAddonId: id('tpl-addon'),
    templateId: id('tpl'),
    templateOptionId: id('tpl-opt'),
    tenantId: id('tenant'),
    transferId: id('transfer'),
    userId: id('user'),
  };
};

type Fixture = ReturnType<typeof makeFixture>;

const seedFixture = async (database: TestDatabase, fixture: Fixture) => {
  const now = new Date();
  const later = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const quantity = MAX_REGISTRATION_ADDON_QUANTITY;
  const spots = MAX_REGISTRATION_GUESTS + 1;

  await database.transaction(async (transaction) => {
    await transaction.insert(tenants).values({
      domain: `${fixture.tenantId}.quantity-limits.example`,
      id: fixture.tenantId,
      name: 'Quantity bounds tenant',
    });
    await transaction.insert(users).values({
      auth0Id: `quantity-limits|${fixture.userId}`,
      communicationEmail: `${fixture.userId}@example.com`,
      email: `${fixture.userId}@example.com`,
      firstName: 'Quantity',
      id: fixture.userId,
      lastName: 'Bounds',
    });
    await transaction.insert(eventTemplateCategories).values({
      icon: { iconColor: 0, iconName: 'circle' },
      id: fixture.categoryId,
      tenantId: fixture.tenantId,
      title: 'Quantity bounds category',
    });
    await transaction.insert(eventTemplates).values({
      categoryId: fixture.categoryId,
      description: 'Quantity bounds fixture',
      icon: { iconColor: 0, iconName: 'circle' },
      id: fixture.templateId,
      tenantId: fixture.tenantId,
      title: 'Quantity bounds template',
    });
    await transaction.insert(templateRegistrationOptions).values({
      closeRegistrationOffset: 0,
      id: fixture.templateOptionId,
      isPaid: false,
      openRegistrationOffset: 24,
      organizingRegistration: false,
      price: 0,
      spots,
      templateId: fixture.templateId,
      title: 'Template option',
    });
    const addon = {
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: true,
      allowPurchaseDuringRegistration: true,
      isPaid: false,
      maxQuantityPerUser: quantity,
      price: 0,
      title: 'Bounded add-on',
      totalAvailableQuantity: quantity,
    };
    await transaction.insert(templateEventAddons).values({
      ...addon,
      id: fixture.templateAddonId,
      templateId: fixture.templateId,
    });
    await transaction.insert(addonToTemplateRegistrationOptions).values({
      addonId: fixture.templateAddonId,
      includedQuantity: 0,
      optionalPurchaseQuantity: quantity,
      registrationOptionId: fixture.templateOptionId,
      templateId: fixture.templateId,
    });
    await transaction.insert(eventInstances).values({
      creatorId: fixture.userId,
      description: 'Quantity bounds fixture',
      end: later,
      icon: { iconColor: 0, iconName: 'circle' },
      id: fixture.eventId,
      start: now,
      templateId: fixture.templateId,
      tenantId: fixture.tenantId,
      title: 'Quantity bounds event',
    });
    await transaction.insert(eventRegistrationOptions).values({
      closeRegistrationTime: later,
      eventId: fixture.eventId,
      id: fixture.optionId,
      isPaid: false,
      openRegistrationTime: now,
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      spots,
      title: 'Event option',
    });
    await transaction.insert(eventAddons).values({
      ...addon,
      eventId: fixture.eventId,
      id: fixture.addonId,
    });
    await transaction.insert(addonToEventRegistrationOptions).values({
      addonId: fixture.addonId,
      eventId: fixture.eventId,
      includedQuantity: 0,
      optionalPurchaseQuantity: quantity,
      registrationOptionId: fixture.optionId,
    });
    await transaction.insert(eventRegistrations).values({
      basePriceAtRegistration: 0,
      checkedInGuestCount: MAX_REGISTRATION_GUESTS,
      discountAmount: 0,
      eventId: fixture.eventId,
      guestCount: MAX_REGISTRATION_GUESTS,
      id: fixture.registrationId,
      registrationOptionId: fixture.optionId,
      status: 'CONFIRMED',
      tenantId: fixture.tenantId,
      userId: fixture.userId,
    });
    await transaction.insert(eventRegistrationAddonPurchases).values({
      addonId: fixture.addonId,
      eventId: fixture.eventId,
      id: fixture.purchaseId,
      includedQuantity: 0,
      purchasedQuantity: quantity,
      quantity,
      registrationId: fixture.registrationId,
      registrationOptionId: fixture.optionId,
      tenantId: fixture.tenantId,
      unitPrice: 0,
    });
    await transaction.insert(eventRegistrationAddonPurchaseLots).values({
      baseAmount: 0,
      currency: 'EUR',
      eventId: fixture.eventId,
      id: fixture.lotId,
      purchaseId: fixture.purchaseId,
      quantity,
      registrationId: fixture.registrationId,
      registrationOptionId: fixture.optionId,
      sourceLineKey: 'quantity-bounds-lot',
      tenantId: fixture.tenantId,
      unitPrice: 0,
    });
    await transaction.insert(eventRegistrationAddonPurchaseOrders).values({
      addonId: fixture.addonId,
      applicationFeeAmount: 0,
      baseAmount: 0,
      completedAt: now,
      currency: 'EUR',
      eventId: fixture.eventId,
      expectedGrossAmount: 0,
      id: fixture.orderId,
      operationKey: 'quantity-bounds-order',
      purchaseId: fixture.purchaseId,
      purchaseLotId: fixture.lotId,
      quantity,
      registrationId: fixture.registrationId,
      registrationOptionId: fixture.optionId,
      requestedByUserId: fixture.userId,
      status: 'completed',
      tenantId: fixture.tenantId,
      unitPrice: 0,
      window: 'before_event',
    });
    await transaction.insert(registrationAcquisitions).values({
      acquiredAt: now,
      eventId: fixture.eventId,
      id: fixture.acquisitionId,
      kind: 'initial',
      operationKey: 'quantity-bounds-acquisition',
      ordinal: 0,
      ownerUserId: fixture.userId,
      registrationId: fixture.registrationId,
      spotCount: spots,
      tenantId: fixture.tenantId,
    });
    const component = {
      acquiredAt: now,
      acquisitionId: fixture.acquisitionId,
      allocationKey: 'registration',
      applicationFeeAmount: 0,
      baseAmount: 0,
      currency: 'EUR',
      eventId: fixture.eventId,
      grossAmount: 0,
      kind: 'registration',
      netAmount: 0,
      quantity: spots,
      registrationId: fixture.registrationId,
      stripeFeeAmount: 0,
      taxAmount: 0,
      tenantId: fixture.tenantId,
    } satisfies typeof registrationAcquisitionComponents.$inferInsert;
    await transaction.insert(registrationAcquisitionComponents).values([
      { ...component, id: fixture.registrationComponentId },
      {
        ...component,
        allocationKey: 'addon-lot',
        id: fixture.addonComponentId,
        kind: 'addon_lot',
        purchaseId: fixture.purchaseId,
        purchaseLotId: fixture.lotId,
        quantity,
      },
    ]);
    await transaction.insert(registrationTransfers).values({
      claimCodeHash: fixture.transferId.padEnd(64, 'c'),
      claimTokenHash: fixture.transferId.padEnd(64, 't'),
      eventId: fixture.eventId,
      expiresAt: later,
      id: fixture.transferId,
      registrationOptionId: fixture.optionId,
      sourceRegistrationId: fixture.registrationId,
      sourceSpotCount: spots,
      sourceUserId: fixture.userId,
      tenantId: fixture.tenantId,
    });
    await transaction.insert(registrationTransferBundleAddonPurchases).values({
      addonId: fixture.addonId,
      cancelledQuantity: 0,
      eventId: fixture.eventId,
      includedQuantity: 0,
      purchasedQuantity: quantity,
      quantity,
      redeemedQuantity: 0,
      refundAllocatedPurchasedQuantity: 0,
      registrationOptionId: fixture.optionId,
      sourcePurchaseId: fixture.purchaseId,
      tenantId: fixture.tenantId,
      transferId: fixture.transferId,
      unitPrice: 0,
    });
    await transaction
      .insert(registrationTransferBundleAddonPurchaseLots)
      .values({
        cancelledQuantity: 0,
        quantity,
        redeemedQuantity: 0,
        refundAllocatedQuantity: 0,
        sourcePurchaseId: fixture.purchaseId,
        sourcePurchaseLotId: fixture.lotId,
        tenantId: fixture.tenantId,
        transferId: fixture.transferId,
      });
  });
};

const cleanFixture = async (database: TestDatabase, fixture: Fixture) => {
  await database.transaction(async (transaction) => {
    await transaction
      .delete(registrationAcquisitionComponents)
      .where(
        eq(
          registrationAcquisitionComponents.acquisitionId,
          fixture.acquisitionId,
        ),
      );
    await transaction
      .delete(registrationAcquisitions)
      .where(eq(registrationAcquisitions.id, fixture.acquisitionId));
    await transaction
      .delete(registrationTransferBundleAddonPurchaseLots)
      .where(
        eq(
          registrationTransferBundleAddonPurchaseLots.transferId,
          fixture.transferId,
        ),
      );
    await transaction
      .delete(registrationTransferBundleAddonPurchases)
      .where(
        eq(
          registrationTransferBundleAddonPurchases.transferId,
          fixture.transferId,
        ),
      );
    await transaction
      .delete(registrationTransfers)
      .where(eq(registrationTransfers.id, fixture.transferId));
    await transaction
      .delete(eventRegistrationAddonPurchaseOrders)
      .where(eq(eventRegistrationAddonPurchaseOrders.id, fixture.orderId));
    await transaction
      .delete(eventRegistrationAddonPurchaseLots)
      .where(eq(eventRegistrationAddonPurchaseLots.id, fixture.lotId));
    await transaction
      .delete(eventRegistrationAddonPurchases)
      .where(eq(eventRegistrationAddonPurchases.id, fixture.purchaseId));
    await transaction
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, fixture.registrationId));
    await transaction
      .delete(addonToEventRegistrationOptions)
      .where(eq(addonToEventRegistrationOptions.eventId, fixture.eventId));
    await transaction
      .delete(eventAddons)
      .where(eq(eventAddons.id, fixture.addonId));
    await transaction
      .delete(eventRegistrationOptions)
      .where(eq(eventRegistrationOptions.id, fixture.optionId));
    await transaction
      .delete(eventInstances)
      .where(eq(eventInstances.id, fixture.eventId));
    await transaction
      .delete(addonToTemplateRegistrationOptions)
      .where(
        eq(addonToTemplateRegistrationOptions.templateId, fixture.templateId),
      );
    await transaction
      .delete(templateEventAddons)
      .where(eq(templateEventAddons.id, fixture.templateAddonId));
    await transaction
      .delete(templateRegistrationOptions)
      .where(eq(templateRegistrationOptions.id, fixture.templateOptionId));
    await transaction
      .delete(eventTemplates)
      .where(eq(eventTemplates.id, fixture.templateId));
    await transaction
      .delete(eventTemplateCategories)
      .where(eq(eventTemplateCategories.id, fixture.categoryId));
    await transaction.delete(users).where(eq(users.id, fixture.userId));
    await transaction.delete(tenants).where(eq(tenants.id, fixture.tenantId));
  });
};

describe('registration quantity bounds in PostgreSQL', () => {
  const fixture = makeFixture();
  const pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
  const database = drizzle({ client: pool, relations });

  beforeAll(async () => {
    await seedFixture(database, fixture);
  });

  afterAll(async () => {
    const failures: unknown[] = [];
    try {
      await cleanFixture(database, fixture);
    } catch (error) {
      failures.push(error);
    }
    try {
      await pool.end();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Failed to release quantity-bound fixtures',
        { cause: failures[0] },
      );
    }
  });

  const cases = [
    {
      constraint: 'event_registrations_guest_count_bounded',
      maximum: MAX_REGISTRATION_GUESTS,
      name: 'guests',
      read: () =>
        database
          .select({ quantity: eventRegistrations.guestCount })
          .from(eventRegistrations)
          .where(eq(eventRegistrations.id, fixture.registrationId)),
      write: (value: number) =>
        database
          .update(eventRegistrations)
          .set({ guestCount: value })
          .where(eq(eventRegistrations.id, fixture.registrationId)),
    },
    {
      constraint: 'event_registrations_checked_in_guest_count_bounded',
      maximum: MAX_REGISTRATION_GUESTS,
      name: 'checked-in guests',
      read: () =>
        database
          .select({ quantity: eventRegistrations.checkedInGuestCount })
          .from(eventRegistrations)
          .where(eq(eventRegistrations.id, fixture.registrationId)),
      write: (value: number) =>
        database
          .update(eventRegistrations)
          .set({ checkedInGuestCount: value })
          .where(eq(eventRegistrations.id, fixture.registrationId)),
    },
    {
      constraint: 'event_addons_max_quantity_per_user_bounded',
      maximum: MAX_REGISTRATION_ADDON_QUANTITY,
      name: 'event per-user allowance',
      read: () =>
        database
          .select({ quantity: eventAddons.maxQuantityPerUser })
          .from(eventAddons)
          .where(eq(eventAddons.id, fixture.addonId)),
      write: (value: number) =>
        database
          .update(eventAddons)
          .set({ maxQuantityPerUser: value })
          .where(eq(eventAddons.id, fixture.addonId)),
    },
    {
      constraint: 'template_event_addons_max_quantity_per_user_bounded',
      maximum: MAX_REGISTRATION_ADDON_QUANTITY,
      name: 'template per-user allowance',
      read: () =>
        database
          .select({ quantity: templateEventAddons.maxQuantityPerUser })
          .from(templateEventAddons)
          .where(eq(templateEventAddons.id, fixture.templateAddonId)),
      write: (value: number) =>
        database
          .update(templateEventAddons)
          .set({ maxQuantityPerUser: value })
          .where(eq(templateEventAddons.id, fixture.templateAddonId)),
    },
    {
      constraint: 'addon_to_event_registration_options_quantity_bounded',
      maximum: MAX_REGISTRATION_ADDON_QUANTITY,
      name: 'event included plus optional allowance',
      read: () =>
        database
          .select({
            quantity: sql<number>`${addonToEventRegistrationOptions.includedQuantity} + ${addonToEventRegistrationOptions.optionalPurchaseQuantity}`,
          })
          .from(addonToEventRegistrationOptions)
          .where(eq(addonToEventRegistrationOptions.addonId, fixture.addonId)),
      write: (value: number) =>
        database
          .update(addonToEventRegistrationOptions)
          .set({ includedQuantity: 1, optionalPurchaseQuantity: value - 1 })
          .where(eq(addonToEventRegistrationOptions.addonId, fixture.addonId)),
    },
    {
      constraint: 'addon_to_template_options_quantity_bounded',
      maximum: MAX_REGISTRATION_ADDON_QUANTITY,
      name: 'template included plus optional allowance',
      read: () =>
        database
          .select({
            quantity: sql<number>`${addonToTemplateRegistrationOptions.includedQuantity} + ${addonToTemplateRegistrationOptions.optionalPurchaseQuantity}`,
          })
          .from(addonToTemplateRegistrationOptions)
          .where(
            eq(
              addonToTemplateRegistrationOptions.addonId,
              fixture.templateAddonId,
            ),
          ),
      write: (value: number) =>
        database
          .update(addonToTemplateRegistrationOptions)
          .set({ includedQuantity: 1, optionalPurchaseQuantity: value - 1 })
          .where(
            eq(
              addonToTemplateRegistrationOptions.addonId,
              fixture.templateAddonId,
            ),
          ),
    },
    {
      constraint: 'event_registration_addon_purchases_quantity_bounded',
      maximum: MAX_REGISTRATION_ADDON_QUANTITY,
      name: 'aggregate purchase',
      read: () =>
        database
          .select({ quantity: eventRegistrationAddonPurchases.quantity })
          .from(eventRegistrationAddonPurchases)
          .where(eq(eventRegistrationAddonPurchases.id, fixture.purchaseId)),
      write: (value: number) =>
        database
          .update(eventRegistrationAddonPurchases)
          .set({ purchasedQuantity: value, quantity: value })
          .where(eq(eventRegistrationAddonPurchases.id, fixture.purchaseId)),
    },
    {
      constraint: 'event_registration_addon_purchase_orders_quantity_bounded',
      maximum: MAX_REGISTRATION_ADDON_QUANTITY,
      name: 'purchase order',
      read: () =>
        database
          .select({ quantity: eventRegistrationAddonPurchaseOrders.quantity })
          .from(eventRegistrationAddonPurchaseOrders)
          .where(eq(eventRegistrationAddonPurchaseOrders.id, fixture.orderId)),
      write: (value: number) =>
        database
          .update(eventRegistrationAddonPurchaseOrders)
          .set({ quantity: value })
          .where(eq(eventRegistrationAddonPurchaseOrders.id, fixture.orderId)),
    },
    {
      constraint: 'event_registration_addon_purchase_lots_quantity_bounded',
      maximum: MAX_REGISTRATION_ADDON_QUANTITY,
      name: 'purchase lot',
      read: () =>
        database
          .select({ quantity: eventRegistrationAddonPurchaseLots.quantity })
          .from(eventRegistrationAddonPurchaseLots)
          .where(eq(eventRegistrationAddonPurchaseLots.id, fixture.lotId)),
      write: (value: number) =>
        database
          .update(eventRegistrationAddonPurchaseLots)
          .set({ quantity: value })
          .where(eq(eventRegistrationAddonPurchaseLots.id, fixture.lotId)),
    },
    {
      constraint: 'registration_acquisition_spot_count_bounded',
      maximum: MAX_REGISTRATION_GUESTS + 1,
      name: 'acquisition spots',
      read: () =>
        database
          .select({ quantity: registrationAcquisitions.spotCount })
          .from(registrationAcquisitions)
          .where(eq(registrationAcquisitions.id, fixture.acquisitionId)),
      write: (value: number) =>
        database
          .update(registrationAcquisitions)
          .set({ spotCount: value })
          .where(eq(registrationAcquisitions.id, fixture.acquisitionId)),
    },
    {
      constraint: 'registration_acquisition_component_quantity_bounded',
      maximum: MAX_REGISTRATION_GUESTS + 1,
      name: 'registration component',
      read: () =>
        database
          .select({ quantity: registrationAcquisitionComponents.quantity })
          .from(registrationAcquisitionComponents)
          .where(
            eq(
              registrationAcquisitionComponents.id,
              fixture.registrationComponentId,
            ),
          ),
      write: (value: number) =>
        database
          .update(registrationAcquisitionComponents)
          .set({ quantity: value })
          .where(
            eq(
              registrationAcquisitionComponents.id,
              fixture.registrationComponentId,
            ),
          ),
    },
    {
      constraint: 'registration_acquisition_component_quantity_bounded',
      maximum: MAX_REGISTRATION_ADDON_QUANTITY,
      name: 'add-on component',
      read: () =>
        database
          .select({ quantity: registrationAcquisitionComponents.quantity })
          .from(registrationAcquisitionComponents)
          .where(
            eq(registrationAcquisitionComponents.id, fixture.addonComponentId),
          ),
      write: (value: number) =>
        database
          .update(registrationAcquisitionComponents)
          .set({ quantity: value })
          .where(
            eq(registrationAcquisitionComponents.id, fixture.addonComponentId),
          ),
    },
    {
      constraint: 'registration_transfers_source_spot_count_bounded',
      maximum: MAX_REGISTRATION_GUESTS + 1,
      name: 'transfer source spots',
      read: () =>
        database
          .select({ quantity: registrationTransfers.sourceSpotCount })
          .from(registrationTransfers)
          .where(eq(registrationTransfers.id, fixture.transferId)),
      write: (value: number) =>
        database
          .update(registrationTransfers)
          .set({ sourceSpotCount: value })
          .where(eq(registrationTransfers.id, fixture.transferId)),
    },
    {
      constraint: 'registration_transfer_bundle_quantity_bounded',
      maximum: MAX_REGISTRATION_ADDON_QUANTITY,
      name: 'transfer purchase',
      read: () =>
        database
          .select({
            quantity: registrationTransferBundleAddonPurchases.quantity,
          })
          .from(registrationTransferBundleAddonPurchases)
          .where(
            eq(
              registrationTransferBundleAddonPurchases.transferId,
              fixture.transferId,
            ),
          ),
      write: (value: number) =>
        database
          .update(registrationTransferBundleAddonPurchases)
          .set({ purchasedQuantity: value, quantity: value })
          .where(
            eq(
              registrationTransferBundleAddonPurchases.transferId,
              fixture.transferId,
            ),
          ),
    },
    {
      constraint: 'registration_transfer_bundle_addon_lot_quantity_bounded',
      maximum: MAX_REGISTRATION_ADDON_QUANTITY,
      name: 'transfer purchase lot',
      read: () =>
        database
          .select({
            quantity: registrationTransferBundleAddonPurchaseLots.quantity,
          })
          .from(registrationTransferBundleAddonPurchaseLots)
          .where(
            eq(
              registrationTransferBundleAddonPurchaseLots.transferId,
              fixture.transferId,
            ),
          ),
      write: (value: number) =>
        database
          .update(registrationTransferBundleAddonPurchaseLots)
          .set({ quantity: value })
          .where(
            eq(
              registrationTransferBundleAddonPurchaseLots.transferId,
              fixture.transferId,
            ),
          ),
    },
  ];

  it('rejects checked-in guests beyond the registration guest count', async () => {
    await expect(
      database
        .update(eventRegistrations)
        .set({ guestCount: MAX_REGISTRATION_GUESTS - 1 })
        .where(eq(eventRegistrations.id, fixture.registrationId)),
    ).rejects.toMatchObject({
      cause: {
        code: '23514',
        constraint: 'event_registrations_checked_in_guest_count_bounded',
      },
    });
    const rows = await database
      .select({
        checkedInGuestCount: eventRegistrations.checkedInGuestCount,
        guestCount: eventRegistrations.guestCount,
      })
      .from(eventRegistrations)
      .where(eq(eventRegistrations.id, fixture.registrationId));
    expect(rows).toEqual([
      {
        checkedInGuestCount: MAX_REGISTRATION_GUESTS,
        guestCount: MAX_REGISTRATION_GUESTS,
      },
    ]);
  });

  it.each(cases)(
    'accepts the maximum $name and rejects the next value',
    async (test) => {
      await expect(test.read()).resolves.toEqual([{ quantity: test.maximum }]);
      await expect(test.write(test.maximum + 1)).rejects.toMatchObject({
        cause: { code: '23514', constraint: test.constraint },
      });
      await expect(test.read()).resolves.toEqual([{ quantity: test.maximum }]);
    },
  );
});
