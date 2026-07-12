import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { Pool } from 'pg';
import Stripe from 'stripe';

import { Database, databaseLayer } from '../../db';
import { createId } from '../../db/create-id';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventInstances,
  eventRegistrationAddonFulfillmentAllocations,
  eventRegistrationAddonFulfillmentEvents,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  registrationAcquisitionComponents,
  registrationAcquisitionPayments,
  registrationAcquisitionRefundAllocations,
  registrationAcquisitions,
  tenants,
  transactions,
  users,
} from '../../db/schema';
import { StripeClient } from '../stripe-client';
import {
  cancelRegistrationAddon,
  cancelRemainingRegistrationAddons,
  redeemRegistrationAddon,
} from './addon-fulfillment.service';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}
const neonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';
interface Fixture {
  readonly acquisitionId: string;
  readonly addOnId: string;
  readonly categoryId: string;
  readonly eventId: string;
  readonly optionId: string;
  readonly purchaseId: string;
  readonly purchaseLotId: string;
  readonly registrationId: string;
  readonly templateId: string;
  readonly tenantId: string;
  readonly userId: string;
}

type TestDatabase = NodePgDatabase<typeof relations>;

const makeLayer = (url: string) => {
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: {
        DATABASE_URL: url,
        NEON_LOCAL_PROXY: String(neonLocalProxy),
      },
    }),
  );
  return Layer.mergeAll(
    config,
    databaseLayer.pipe(Layer.provide(config)),
    Layer.succeed(StripeClient, new Stripe('sk_test_addon_fulfillment')),
  );
};

const seedFixture = async (
  database: TestDatabase,
  input: {
    readonly includedQuantity: number;
    readonly purchasedQuantity: number;
    readonly unitPrice?: number;
  },
): Promise<Fixture> => {
  const tenantId = createId();
  const userId = createId();
  const categoryId = createId();
  const templateId = createId();
  const eventId = createId();
  const optionId = createId();
  const addOnId = createId();
  const registrationId = createId();
  const purchaseId = createId();
  const purchaseLotId = createId();
  const acquisitionId = createId();
  const unitPrice = input.unitPrice ?? 0;
  const now = Date.now();

  await database.insert(tenants).values({
    domain: `${tenantId}.fulfillment.example`,
    id: tenantId,
    name: 'Fulfillment concurrency',
  });
  await database.insert(users).values({
    auth0Id: `auth0|${userId}`,
    communicationEmail: `${userId}@example.com`,
    email: `${userId}@example.com`,
    firstName: 'Fulfillment',
    id: userId,
    lastName: 'Tester',
  });
  await database.insert(eventTemplateCategories).values({
    icon: { iconColor: 0, iconName: 'circle' },
    id: categoryId,
    tenantId,
    title: 'Fulfillment',
  });
  await database.insert(eventTemplates).values({
    categoryId,
    description: 'Fulfillment test',
    icon: { iconColor: 0, iconName: 'circle' },
    id: templateId,
    tenantId,
    title: 'Fulfillment',
  });
  await database.insert(eventInstances).values({
    creatorId: userId,
    description: 'Fulfillment test',
    end: new Date(now + 2 * 60 * 60 * 1000),
    icon: { iconColor: 0, iconName: 'circle' },
    id: eventId,
    start: new Date(now - 60 * 60 * 1000),
    status: 'APPROVED',
    templateId,
    tenantId,
    title: 'Fulfillment',
  });
  await database.insert(eventRegistrationOptions).values({
    closeRegistrationTime: new Date(now + 60 * 60 * 1000),
    eventId,
    id: optionId,
    isPaid: false,
    openRegistrationTime: new Date(now - 2 * 60 * 60 * 1000),
    organizingRegistration: false,
    price: 0,
    registrationMode: 'fcfs',
    spots: 10,
    title: 'Participant',
  });
  await database.insert(eventAddons).values({
    allowMultiple: true,
    allowPurchaseBeforeEvent: true,
    allowPurchaseDuringEvent: true,
    allowPurchaseDuringRegistration: true,
    eventId,
    id: addOnId,
    isPaid: unitPrice > 0,
    maxQuantityPerUser: input.includedQuantity + input.purchasedQuantity,
    price: unitPrice,
    title: 'Race add-on',
    totalAvailableQuantity: 0,
  });
  await database.insert(addonToEventRegistrationOptions).values({
    addonId: addOnId,
    eventId,
    includedQuantity: input.includedQuantity,
    optionalPurchaseQuantity: input.purchasedQuantity,
    registrationOptionId: optionId,
  });
  await database.insert(eventRegistrations).values({
    eventId,
    id: registrationId,
    registrationOptionId: optionId,
    status: 'CONFIRMED',
    tenantId,
    userId,
  });
  await database.insert(eventRegistrationAddonPurchases).values({
    addonId: addOnId,
    eventId,
    id: purchaseId,
    includedQuantity: input.includedQuantity,
    purchasedQuantity: input.purchasedQuantity,
    quantity: input.includedQuantity + input.purchasedQuantity,
    registrationId,
    registrationOptionId: optionId,
    tenantId,
    unitPrice,
  });
  if (input.purchasedQuantity > 0) {
    await database.insert(eventRegistrationAddonPurchaseLots).values({
      id: purchaseLotId,
      ...(unitPrice === 0 && {
        applicationFeeAmount: 0,
        grossAmount: 0,
        netAmount: 0,
        paymentAllocationFinalizedAt: new Date(),
        stripeFeeAmount: 0,
        taxAmount: 0,
      }),
      baseAmount: unitPrice * input.purchasedQuantity,
      currency: 'EUR',
      eventId,
      purchaseId,
      quantity: input.purchasedQuantity,
      registrationId,
      registrationOptionId: optionId,
      sourceLineKey:
        unitPrice === 0 ? `free:${purchaseId}` : `unreconciled:${purchaseId}`,
      tenantId,
      unitPrice,
    });
  }
  await database.insert(registrationAcquisitions).values({
    acquiredAt: new Date(),
    eventId,
    id: acquisitionId,
    kind: 'initial',
    operationKey: `fixture:${registrationId}`,
    ordinal: 0,
    ownerUserId: userId,
    registrationId,
    spotCount: 1,
    tenantId,
  });
  await database.insert(registrationAcquisitionComponents).values({
    acquiredAt: new Date(),
    acquisitionId,
    allocationKey: 'registration',
    applicationFeeAmount: 0,
    baseAmount: 0,
    currency: 'EUR',
    eventId,
    grossAmount: 0,
    kind: 'registration',
    netAmount: 0,
    quantity: 1,
    registrationId,
    stripeFeeAmount: 0,
    taxAmount: 0,
    taxRateDisplayName: null,
    taxRateInclusive: null,
    taxRatePercentage: null,
    tenantId,
  });
  if (input.purchasedQuantity > 0 && unitPrice === 0) {
    await database.insert(registrationAcquisitionComponents).values({
      acquiredAt: new Date(),
      acquisitionId,
      allocationKey: `addon-lot:${purchaseLotId}`,
      applicationFeeAmount: 0,
      baseAmount: 0,
      currency: 'EUR',
      eventId,
      grossAmount: 0,
      kind: 'addon_lot',
      netAmount: 0,
      purchaseId,
      purchaseLotId,
      quantity: input.purchasedQuantity,
      registrationId,
      stripeFeeAmount: 0,
      taxAmount: 0,
      taxRateDisplayName: null,
      taxRateInclusive: null,
      taxRatePercentage: null,
      tenantId,
    });
  }
  return {
    acquisitionId,
    addOnId,
    categoryId,
    eventId,
    optionId,
    purchaseId,
    purchaseLotId,
    registrationId,
    templateId,
    tenantId,
    userId,
  };
};

const cleanFixture = async (database: TestDatabase, fixture: Fixture) => {
  await database
    .delete(registrationAcquisitionRefundAllocations)
    .where(
      eq(registrationAcquisitionRefundAllocations.tenantId, fixture.tenantId),
    );
  await database
    .delete(registrationAcquisitionComponents)
    .where(eq(registrationAcquisitionComponents.tenantId, fixture.tenantId));
  await database
    .delete(registrationAcquisitionPayments)
    .where(eq(registrationAcquisitionPayments.tenantId, fixture.tenantId));
  await database
    .delete(registrationAcquisitions)
    .where(eq(registrationAcquisitions.tenantId, fixture.tenantId));
  await database
    .delete(eventRegistrationAddonPurchases)
    .where(eq(eventRegistrationAddonPurchases.id, fixture.purchaseId));
  await database
    .delete(transactions)
    .where(eq(transactions.eventRegistrationId, fixture.registrationId));
  await database
    .delete(eventRegistrations)
    .where(eq(eventRegistrations.id, fixture.registrationId));
  await database
    .delete(addonToEventRegistrationOptions)
    .where(eq(addonToEventRegistrationOptions.addonId, fixture.addOnId));
  await database.delete(eventAddons).where(eq(eventAddons.id, fixture.addOnId));
  await database
    .delete(eventRegistrationOptions)
    .where(eq(eventRegistrationOptions.id, fixture.optionId));
  await database
    .delete(eventInstances)
    .where(eq(eventInstances.id, fixture.eventId));
  await database
    .delete(eventTemplates)
    .where(eq(eventTemplates.id, fixture.templateId));
  await database
    .delete(eventTemplateCategories)
    .where(eq(eventTemplateCategories.id, fixture.categoryId));
  await database.delete(users).where(eq(users.id, fixture.userId));
  await database.delete(tenants).where(eq(tenants.id, fixture.tenantId));
};

describe('add-on fulfillment concurrency', () => {
  let database: TestDatabase;
  const fixtures: Fixture[] = [];
  let layer: ReturnType<typeof makeLayer>;
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl, neonLocalProxy }));
    database = drizzle({ client: pool, relations });
    layer = makeLayer(databaseUrl);
  });

  afterAll(async () => {
    for (const fixture of fixtures.toReversed()) {
      await cleanFixture(database, fixture);
    }
    await pool.end();
  });

  it('redeems two distinct intents from one snapshot and keeps an exact retry idempotent', async () => {
    const fixture = await seedFixture(database, {
      includedQuantity: 2,
      purchasedQuantity: 0,
    });
    fixtures.push(fixture);
    const redeem = (operationKey: string) =>
      Effect.runPromise(
        redeemRegistrationAddon({
          actorUserId: fixture.userId,
          operationKey,
          registrationAddonId: fixture.purchaseId,
          registrationId: fixture.registrationId,
          tenantId: fixture.tenantId,
        }).pipe(Effect.provide(layer)),
      );

    const [first, second] = await Promise.all([
      redeem(`redeem:${fixture.purchaseId}:intent-a`),
      redeem(`redeem:${fixture.purchaseId}:intent-b`),
    ]);
    const firstRetry = await redeem(`redeem:${fixture.purchaseId}:intent-a`);

    expect(first.fulfillmentEventId).not.toBe(second.fulfillmentEventId);
    expect(firstRetry.fulfillmentEventId).toBe(first.fulfillmentEventId);
    expect(
      await database.query.eventRegistrationAddonPurchases.findFirst({
        columns: { redeemedQuantity: true },
        where: { id: fixture.purchaseId },
      }),
    ).toEqual({ redeemedQuantity: 2 });
    expect(
      await database
        .select({ id: eventRegistrationAddonFulfillmentEvents.id })
        .from(eventRegistrationAddonFulfillmentEvents)
        .where(
          eq(
            eventRegistrationAddonFulfillmentEvents.purchaseId,
            fixture.purchaseId,
          ),
        ),
    ).toHaveLength(2);
    expect(
      await database
        .select({
          fulfillmentEventId:
            eventRegistrationAddonFulfillmentAllocations.fulfillmentEventId,
        })
        .from(eventRegistrationAddonFulfillmentAllocations)
        .where(
          eq(
            eventRegistrationAddonFulfillmentAllocations.purchaseId,
            fixture.purchaseId,
          ),
        ),
    ).toHaveLength(2);
  });

  it('serializes redemption against whole-registration add-on cancellation', async () => {
    const fixture = await seedFixture(database, {
      includedQuantity: 0,
      purchasedQuantity: 2,
    });
    fixtures.push(fixture);
    const redeem = Effect.runPromise(
      redeemRegistrationAddon({
        actorUserId: fixture.userId,
        operationKey: `redeem:${fixture.purchaseId}:0`,
        registrationAddonId: fixture.purchaseId,
        registrationId: fixture.registrationId,
        tenantId: fixture.tenantId,
      }).pipe(Effect.provide(layer), Effect.exit),
    );
    const cancel = Effect.runPromise(
      Database.use((effectDatabase) =>
        effectDatabase.transaction((tx) =>
          cancelRemainingRegistrationAddons(tx, {
            actor: { kind: 'system', subject: 'concurrency-test' },
            eventId: fixture.eventId,
            reason: 'Registration cancelled in concurrency test',
            refundRequested: false,
            registrationId: fixture.registrationId,
            tenantId: fixture.tenantId,
          }),
        ),
      ).pipe(Effect.provide(layer), Effect.exit),
    );
    await Promise.all([redeem, cancel]);

    const [purchase, addOn] = await Promise.all([
      database.query.eventRegistrationAddonPurchases.findFirst({
        where: { id: fixture.purchaseId },
      }),
      database.query.eventAddons.findFirst({ where: { id: fixture.addOnId } }),
    ]);
    expect(purchase).toBeDefined();
    expect(addOn).toBeDefined();
    expect(
      (purchase?.redeemedQuantity ?? 0) + (purchase?.cancelledQuantity ?? 0),
    ).toBe(2);
    expect(addOn?.totalAvailableQuantity).toBe(purchase?.cancelledQuantity);
  });

  it('serializes direct add-on cancellation against registration cancellation', async () => {
    const fixture = await seedFixture(database, {
      includedQuantity: 1,
      purchasedQuantity: 1,
    });
    fixtures.push(fixture);
    const direct = Effect.runPromise(
      cancelRegistrationAddon({
        actorUserId: fixture.userId,
        operationKey: `cancel:${fixture.purchaseId}:0`,
        quantity: 1,
        reason: 'Direct cancellation race',
        refundRequested: true,
        registrationAddonId: fixture.purchaseId,
        registrationId: fixture.registrationId,
        tenantId: fixture.tenantId,
      }).pipe(Effect.provide(layer), Effect.exit),
    );
    const whole = Effect.runPromise(
      Database.use((effectDatabase) =>
        effectDatabase.transaction((tx) =>
          cancelRemainingRegistrationAddons(tx, {
            actor: { kind: 'system', subject: 'concurrency-test' },
            eventId: fixture.eventId,
            reason: 'Whole registration cancellation race',
            refundRequested: false,
            registrationId: fixture.registrationId,
            tenantId: fixture.tenantId,
          }),
        ),
      ).pipe(Effect.provide(layer), Effect.exit),
    );
    await Promise.all([direct, whole]);

    const [purchase, addOn] = await Promise.all([
      database.query.eventRegistrationAddonPurchases.findFirst({
        where: { id: fixture.purchaseId },
      }),
      database.query.eventAddons.findFirst({ where: { id: fixture.addOnId } }),
    ]);
    expect(purchase?.redeemedQuantity).toBe(0);
    expect(purchase?.cancelledQuantity).toBe(2);
    expect(addOn?.totalAvailableQuantity).toBe(2);
  });

  it('does not cancel a paid add-on while its refund allocation has no source', async () => {
    const fixture = await seedFixture(database, {
      includedQuantity: 0,
      purchasedQuantity: 1,
      unitPrice: 500,
    });
    fixtures.push(fixture);

    const error = await Effect.runPromise(
      cancelRegistrationAddon({
        actorUserId: fixture.userId,
        operationKey: `cancel:${fixture.purchaseId}:unreconciled`,
        quantity: 1,
        reason: 'Refund the unreconciled paid add-on',
        refundRequested: true,
        registrationAddonId: fixture.purchaseId,
        registrationId: fixture.registrationId,
        tenantId: fixture.tenantId,
      }).pipe(Effect.flip, Effect.provide(layer)),
    );

    expect(error).toMatchObject({
      _tag: 'EventRegistrationConflictError',
      message: expect.stringContaining(
        'Current add-on acquisition components are incomplete',
      ),
    });

    const [purchase, lot, addOn, fulfillmentEvents] = await Promise.all([
      database.query.eventRegistrationAddonPurchases.findFirst({
        columns: {
          cancelledQuantity: true,
          refundAllocatedPurchasedQuantity: true,
        },
        where: { id: fixture.purchaseId },
      }),
      database.query.eventRegistrationAddonPurchaseLots.findFirst({
        columns: {
          cancelledQuantity: true,
          refundAllocatedQuantity: true,
        },
        where: { purchaseId: fixture.purchaseId },
      }),
      database.query.eventAddons.findFirst({
        columns: { totalAvailableQuantity: true },
        where: { id: fixture.addOnId },
      }),
      database
        .select({ id: eventRegistrationAddonFulfillmentEvents.id })
        .from(eventRegistrationAddonFulfillmentEvents)
        .where(
          eq(
            eventRegistrationAddonFulfillmentEvents.purchaseId,
            fixture.purchaseId,
          ),
        ),
    ]);
    expect(purchase).toEqual({
      cancelledQuantity: 0,
      refundAllocatedPurchasedQuantity: 0,
    });
    expect(lot).toEqual({
      cancelledQuantity: 0,
      refundAllocatedQuantity: 0,
    });
    expect(addOn).toEqual({ totalAvailableQuantity: 0 });
    expect(fulfillmentEvents).toEqual([]);
  });

  it('does not cancel when a successful source settlement drifts from its immutable component', async () => {
    const fixture = await seedFixture(database, {
      includedQuantity: 0,
      purchasedQuantity: 1,
      unitPrice: 500,
    });
    fixtures.push(fixture);
    const sourceTransactionId = createId();
    const acquisitionPaymentId = createId();
    const stripeAccountId = `acct_${createId()}`;

    await database.insert(transactions).values({
      amount: 501,
      appFee: 20,
      currency: 'EUR',
      eventId: fixture.eventId,
      eventRegistrationId: fixture.registrationId,
      id: sourceTransactionId,
      method: 'stripe',
      status: 'successful',
      stripeAccountId,
      stripeChargeId: `ch_${createId()}`,
      stripeFee: 10,
      stripeNetAmount: 471,
      stripePaymentIntentId: `pi_${createId()}`,
      targetUserId: fixture.userId,
      tenantId: fixture.tenantId,
      type: 'addon',
    });
    await database.insert(registrationAcquisitionPayments).values({
      acquisitionId: fixture.acquisitionId,
      attachedAt: new Date(),
      eventId: fixture.eventId,
      id: acquisitionPaymentId,
      registrationId: fixture.registrationId,
      tenantId: fixture.tenantId,
      transactionId: sourceTransactionId,
    });
    await database.insert(registrationAcquisitionComponents).values({
      acquiredAt: new Date(),
      acquisitionId: fixture.acquisitionId,
      acquisitionPaymentId,
      allocationKey: `addon-lot:${fixture.purchaseLotId}`,
      applicationFeeAmount: 20,
      baseAmount: 500,
      currency: 'EUR',
      eventId: fixture.eventId,
      grossAmount: 500,
      kind: 'addon_lot',
      netAmount: 470,
      purchaseId: fixture.purchaseId,
      purchaseLotId: fixture.purchaseLotId,
      quantity: 1,
      registrationId: fixture.registrationId,
      stripeFeeAmount: 10,
      taxAmount: 0,
      taxRateDisplayName: null,
      taxRateInclusive: null,
      taxRatePercentage: null,
      tenantId: fixture.tenantId,
    });

    const error = await Effect.runPromise(
      cancelRegistrationAddon({
        actorUserId: fixture.userId,
        operationKey: `cancel:${fixture.purchaseId}:drifted`,
        quantity: 1,
        reason: 'Reject a drifted payment settlement',
        refundRequested: true,
        registrationAddonId: fixture.purchaseId,
        registrationId: fixture.registrationId,
        tenantId: fixture.tenantId,
      }).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error).toMatchObject({
      _tag: 'EventRegistrationConflictError',
      message: expect.stringContaining('payment settlement no longer matches'),
    });
    expect(
      await database
        .select({ id: eventRegistrationAddonFulfillmentEvents.id })
        .from(eventRegistrationAddonFulfillmentEvents)
        .where(
          eq(
            eventRegistrationAddonFulfillmentEvents.purchaseId,
            fixture.purchaseId,
          ),
        ),
    ).toEqual([]);
  });

  it('consumes a zero-cent physical slice before allocating the later refundable slice', async () => {
    const fixture = await seedFixture(database, {
      includedQuantity: 0,
      purchasedQuantity: 3,
      unitPrice: 1,
    });
    fixtures.push(fixture);
    const sourceTransactionId = createId();
    const acquisitionPaymentId = createId();
    const addonComponentId = createId();
    const stripeAccountId = `acct_${createId()}`;

    await database
      .update(tenants)
      .set({ refundFeesOnCancellation: true, stripeAccountId })
      .where(eq(tenants.id, fixture.tenantId));
    await database.insert(transactions).values({
      amount: 1,
      appFee: 0,
      currency: 'EUR',
      eventId: fixture.eventId,
      eventRegistrationId: fixture.registrationId,
      id: sourceTransactionId,
      method: 'stripe',
      status: 'successful',
      stripeAccountId,
      stripeChargeId: `ch_${createId()}`,
      stripeFee: 0,
      stripeNetAmount: 1,
      stripePaymentIntentId: `pi_${createId()}`,
      targetUserId: fixture.userId,
      tenantId: fixture.tenantId,
      type: 'addon',
    });
    await database.insert(registrationAcquisitionPayments).values({
      acquisitionId: fixture.acquisitionId,
      attachedAt: new Date(),
      eventId: fixture.eventId,
      id: acquisitionPaymentId,
      registrationId: fixture.registrationId,
      tenantId: fixture.tenantId,
      transactionId: sourceTransactionId,
    });
    await database.insert(registrationAcquisitionComponents).values({
      acquiredAt: new Date(),
      acquisitionId: fixture.acquisitionId,
      acquisitionPaymentId,
      allocationKey: `addon-lot:${fixture.purchaseLotId}`,
      applicationFeeAmount: 0,
      baseAmount: 1,
      currency: 'EUR',
      eventId: fixture.eventId,
      grossAmount: 1,
      id: addonComponentId,
      kind: 'addon_lot',
      netAmount: 1,
      purchaseId: fixture.purchaseId,
      purchaseLotId: fixture.purchaseLotId,
      quantity: 3,
      registrationId: fixture.registrationId,
      stripeFeeAmount: 0,
      taxAmount: 0,
      taxRateDisplayName: null,
      taxRateInclusive: null,
      taxRatePercentage: null,
      tenantId: fixture.tenantId,
    });

    const first = await Effect.runPromise(
      cancelRegistrationAddon({
        actorUserId: fixture.userId,
        operationKey: `cancel:${fixture.purchaseId}:zero-cent`,
        quantity: 1,
        reason: 'Cancel the zero-cent cumulative slice',
        refundRequested: true,
        registrationAddonId: fixture.purchaseId,
        registrationId: fixture.registrationId,
        tenantId: fixture.tenantId,
      }).pipe(Effect.provide(layer)),
    );
    expect(first.refundStatus).toBe('notRequired');
    expect(
      await database
        .select({ id: registrationAcquisitionRefundAllocations.id })
        .from(registrationAcquisitionRefundAllocations)
        .where(
          eq(
            registrationAcquisitionRefundAllocations.componentId,
            addonComponentId,
          ),
        ),
    ).toEqual([]);

    const second = await Effect.runPromise(
      cancelRegistrationAddon({
        actorUserId: fixture.userId,
        operationKey: `cancel:${fixture.purchaseId}:one-cent`,
        quantity: 1,
        reason: 'Cancel the later one-cent cumulative slice',
        refundRequested: true,
        registrationAddonId: fixture.purchaseId,
        registrationId: fixture.registrationId,
        tenantId: fixture.tenantId,
      }).pipe(Effect.provide(layer)),
    );
    expect(second.refundStatus).toBe('pending');

    const [lot, refundClaims, allocations, events] = await Promise.all([
      database.query.eventRegistrationAddonPurchaseLots.findFirst({
        columns: {
          cancelledQuantity: true,
          refundAllocatedQuantity: true,
        },
        where: { id: fixture.purchaseLotId },
      }),
      database.query.transactions.findMany({
        where: {
          eventRegistrationId: fixture.registrationId,
          tenantId: fixture.tenantId,
          type: 'refund',
        },
      }),
      database
        .select({
          grossEntitlementAmount:
            registrationAcquisitionRefundAllocations.grossEntitlementAmount,
          netEntitlementAmount:
            registrationAcquisitionRefundAllocations.netEntitlementAmount,
          quantity: registrationAcquisitionRefundAllocations.quantity,
          refundAmount: registrationAcquisitionRefundAllocations.refundAmount,
        })
        .from(registrationAcquisitionRefundAllocations)
        .where(
          eq(
            registrationAcquisitionRefundAllocations.componentId,
            addonComponentId,
          ),
        ),
      database
        .select({
          refundDisposition:
            eventRegistrationAddonFulfillmentEvents.refundDisposition,
        })
        .from(eventRegistrationAddonFulfillmentEvents)
        .where(
          eq(
            eventRegistrationAddonFulfillmentEvents.purchaseId,
            fixture.purchaseId,
          ),
        )
        .orderBy(eventRegistrationAddonFulfillmentEvents.createdAt),
    ]);
    expect(lot).toEqual({
      cancelledQuantity: 2,
      refundAllocatedQuantity: 0,
    });
    expect(refundClaims).toHaveLength(1);
    expect(refundClaims[0]).toMatchObject({
      amount: -1,
      sourceTransactionId,
      stripeAccountId,
      targetUserId: fixture.userId,
    });
    expect(allocations).toEqual([
      {
        grossEntitlementAmount: 1,
        netEntitlementAmount: 1,
        quantity: 1,
        refundAmount: 1,
      },
    ]);
    expect(events).toEqual([
      { refundDisposition: 'no_monetary_refund_required' },
      { refundDisposition: 'claims_created' },
    ]);
  });

  it('groups multiple selected components from one acquisition payment into one refund claim', async () => {
    const fixture = await seedFixture(database, {
      includedQuantity: 0,
      purchasedQuantity: 2,
      unitPrice: 500,
    });
    fixtures.push(fixture);
    const lotIds = [createId(), createId()];
    const componentIds = [createId(), createId()];
    const sourceTransactionId = createId();
    const acquisitionPaymentId = createId();
    const stripeAccountId = `acct_${createId()}`;

    await database
      .delete(eventRegistrationAddonPurchaseLots)
      .where(eq(eventRegistrationAddonPurchaseLots.id, fixture.purchaseLotId));
    await database.insert(eventRegistrationAddonPurchaseLots).values(
      lotIds.map((id, index) => ({
        baseAmount: 500,
        currency: 'EUR' as const,
        eventId: fixture.eventId,
        id,
        purchaseId: fixture.purchaseId,
        quantity: 1,
        registrationId: fixture.registrationId,
        registrationOptionId: fixture.optionId,
        sourceLineKey: `grouped:${fixture.purchaseId}:${index}`,
        tenantId: fixture.tenantId,
        unitPrice: 500,
      })),
    );
    await database
      .update(tenants)
      .set({ refundFeesOnCancellation: true, stripeAccountId })
      .where(eq(tenants.id, fixture.tenantId));
    await database.insert(transactions).values({
      amount: 1000,
      appFee: 40,
      currency: 'EUR',
      eventId: fixture.eventId,
      eventRegistrationId: fixture.registrationId,
      id: sourceTransactionId,
      method: 'stripe',
      status: 'successful',
      stripeAccountId,
      stripeChargeId: `ch_${createId()}`,
      stripeFee: 20,
      stripeNetAmount: 940,
      stripePaymentIntentId: `pi_${createId()}`,
      targetUserId: fixture.userId,
      tenantId: fixture.tenantId,
      type: 'addon',
    });
    await database.insert(registrationAcquisitionPayments).values({
      acquisitionId: fixture.acquisitionId,
      attachedAt: new Date(),
      eventId: fixture.eventId,
      id: acquisitionPaymentId,
      registrationId: fixture.registrationId,
      tenantId: fixture.tenantId,
      transactionId: sourceTransactionId,
    });
    await database.insert(registrationAcquisitionComponents).values(
      lotIds.map((purchaseLotId, index) => ({
        acquiredAt: new Date(),
        acquisitionId: fixture.acquisitionId,
        acquisitionPaymentId,
        allocationKey: `addon-lot:${purchaseLotId}`,
        applicationFeeAmount: 20,
        baseAmount: 500,
        currency: 'EUR' as const,
        eventId: fixture.eventId,
        grossAmount: 500,
        id: componentIds[index],
        kind: 'addon_lot' as const,
        netAmount: 470,
        purchaseId: fixture.purchaseId,
        purchaseLotId,
        quantity: 1,
        registrationId: fixture.registrationId,
        stripeFeeAmount: 10,
        taxAmount: 0,
        taxRateDisplayName: null,
        taxRateInclusive: null,
        taxRatePercentage: null,
        tenantId: fixture.tenantId,
      })),
    );

    const result = await Effect.runPromise(
      cancelRegistrationAddon({
        actorUserId: fixture.userId,
        operationKey: `cancel:${fixture.purchaseId}:grouped`,
        quantity: 2,
        reason: 'Cancel both components from one payment',
        refundRequested: true,
        registrationAddonId: fixture.purchaseId,
        registrationId: fixture.registrationId,
        tenantId: fixture.tenantId,
      }).pipe(Effect.provide(layer)),
    );
    expect(result.refundStatus).toBe('pending');

    const [refundClaims, allocations] = await Promise.all([
      database.query.transactions.findMany({
        where: {
          eventRegistrationId: fixture.registrationId,
          tenantId: fixture.tenantId,
          type: 'refund',
        },
      }),
      database
        .select({
          componentId: registrationAcquisitionRefundAllocations.componentId,
          refundAmount: registrationAcquisitionRefundAllocations.refundAmount,
          refundTransactionId:
            registrationAcquisitionRefundAllocations.refundTransactionId,
        })
        .from(registrationAcquisitionRefundAllocations)
        .where(
          eq(
            registrationAcquisitionRefundAllocations.acquisitionPaymentId,
            acquisitionPaymentId,
          ),
        )
        .orderBy(registrationAcquisitionRefundAllocations.componentId),
    ]);
    expect(refundClaims).toHaveLength(1);
    expect(refundClaims[0]).toMatchObject({
      amount: -1000,
      sourceTransactionId,
      stripeAccountId,
      targetUserId: fixture.userId,
    });
    expect(allocations).toEqual(
      componentIds.toSorted().map((componentId) => ({
        componentId,
        refundAmount: 500,
        refundTransactionId: refundClaims[0]?.id,
      })),
    );
  });

  it('cancels a reconciled paid add-on into one exact refund claim and allocation', async () => {
    const fixture = await seedFixture(database, {
      includedQuantity: 0,
      purchasedQuantity: 1,
      unitPrice: 500,
    });
    fixtures.push(fixture);
    const sourceTransactionId = createId();
    const acquisitionPaymentId = createId();
    const addonComponentId = createId();
    const stripeAccountId = `acct_${createId()}`;

    await database
      .update(tenants)
      .set({ stripeAccountId })
      .where(eq(tenants.id, fixture.tenantId));
    await database.insert(transactions).values({
      amount: 500,
      appFee: 20,
      currency: 'EUR',
      eventId: fixture.eventId,
      eventRegistrationId: fixture.registrationId,
      id: sourceTransactionId,
      method: 'stripe',
      status: 'successful',
      stripeAccountId,
      stripeChargeId: `ch_${createId()}`,
      stripeFee: 10,
      stripeNetAmount: 470,
      stripePaymentIntentId: `pi_${createId()}`,
      targetUserId: fixture.userId,
      tenantId: fixture.tenantId,
      type: 'addon',
    });
    await database.insert(registrationAcquisitionPayments).values({
      acquisitionId: fixture.acquisitionId,
      attachedAt: new Date(),
      eventId: fixture.eventId,
      id: acquisitionPaymentId,
      registrationId: fixture.registrationId,
      tenantId: fixture.tenantId,
      transactionId: sourceTransactionId,
    });
    await database.insert(registrationAcquisitionComponents).values({
      acquiredAt: new Date(),
      acquisitionId: fixture.acquisitionId,
      acquisitionPaymentId,
      allocationKey: `addon-lot:${fixture.purchaseLotId}`,
      applicationFeeAmount: 20,
      baseAmount: 500,
      currency: 'EUR',
      eventId: fixture.eventId,
      grossAmount: 500,
      id: addonComponentId,
      kind: 'addon_lot',
      netAmount: 470,
      purchaseId: fixture.purchaseId,
      purchaseLotId: fixture.purchaseLotId,
      quantity: 1,
      registrationId: fixture.registrationId,
      stripeFeeAmount: 10,
      taxAmount: 0,
      taxRateDisplayName: null,
      taxRateInclusive: null,
      taxRatePercentage: null,
      tenantId: fixture.tenantId,
    });

    const result = await Effect.runPromise(
      cancelRegistrationAddon({
        actorUserId: fixture.userId,
        operationKey: `cancel:${fixture.purchaseId}:settled`,
        quantity: 1,
        reason: 'Refund the reconciled paid add-on',
        refundRequested: true,
        registrationAddonId: fixture.purchaseId,
        registrationId: fixture.registrationId,
        tenantId: fixture.tenantId,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.refundStatus).toBe('pending');
    const [purchase, lot, addOn, refundClaims, refundAllocations] =
      await Promise.all([
        database.query.eventRegistrationAddonPurchases.findFirst({
          columns: {
            cancelledQuantity: true,
            refundAllocatedPurchasedQuantity: true,
          },
          where: { id: fixture.purchaseId },
        }),
        database.query.eventRegistrationAddonPurchaseLots.findFirst({
          columns: {
            cancelledQuantity: true,
            refundAllocatedApplicationFeeAmount: true,
            refundAllocatedGrossAmount: true,
            refundAllocatedNetAmount: true,
            refundAllocatedQuantity: true,
          },
          where: { purchaseId: fixture.purchaseId },
        }),
        database.query.eventAddons.findFirst({
          columns: { totalAvailableQuantity: true },
          where: { id: fixture.addOnId },
        }),
        database.query.transactions.findMany({
          where: {
            eventRegistrationId: fixture.registrationId,
            tenantId: fixture.tenantId,
            type: 'refund',
          },
        }),
        database
          .select({
            acquisitionId:
              registrationAcquisitionRefundAllocations.acquisitionId,
            acquisitionPaymentId:
              registrationAcquisitionRefundAllocations.acquisitionPaymentId,
            applicationFeeAmount:
              registrationAcquisitionRefundAllocations.applicationFeeAmount,
            applicationFeeRefunded:
              registrationAcquisitionRefundAllocations.applicationFeeRefunded,
            componentId: registrationAcquisitionRefundAllocations.componentId,
            grossEntitlementAmount:
              registrationAcquisitionRefundAllocations.grossEntitlementAmount,
            netEntitlementAmount:
              registrationAcquisitionRefundAllocations.netEntitlementAmount,
            quantity: registrationAcquisitionRefundAllocations.quantity,
            refundAmount: registrationAcquisitionRefundAllocations.refundAmount,
            refundTransactionId:
              registrationAcquisitionRefundAllocations.refundTransactionId,
            stripeFeeAmount:
              registrationAcquisitionRefundAllocations.stripeFeeAmount,
          })
          .from(registrationAcquisitionRefundAllocations)
          .where(
            and(
              eq(
                registrationAcquisitionRefundAllocations.registrationId,
                fixture.registrationId,
              ),
              eq(
                registrationAcquisitionRefundAllocations.tenantId,
                fixture.tenantId,
              ),
            ),
          ),
      ]);

    expect(purchase).toEqual({
      cancelledQuantity: 1,
      refundAllocatedPurchasedQuantity: 0,
    });
    expect(lot).toEqual({
      cancelledQuantity: 1,
      refundAllocatedApplicationFeeAmount: 0,
      refundAllocatedGrossAmount: 0,
      refundAllocatedNetAmount: 0,
      refundAllocatedQuantity: 0,
    });
    expect(addOn).toEqual({ totalAvailableQuantity: 1 });
    expect(refundClaims).toHaveLength(1);
    expect(refundClaims[0]).toMatchObject({
      amount: -500,
      method: 'stripe',
      sourceTransactionId,
      status: 'pending',
      stripeAccountId,
      stripeRefundApplicationFee: true,
      targetUserId: fixture.userId,
      type: 'refund',
    });
    expect(refundClaims[0]?.stripeRefundNextAttemptAt).not.toBeNull();
    expect(refundAllocations).toEqual([
      {
        acquisitionId: fixture.acquisitionId,
        acquisitionPaymentId,
        applicationFeeAmount: 20,
        applicationFeeRefunded: true,
        componentId: addonComponentId,
        grossEntitlementAmount: 500,
        netEntitlementAmount: 470,
        quantity: 1,
        refundAmount: 500,
        refundTransactionId: refundClaims[0]?.id,
        stripeFeeAmount: 10,
      },
    ]);
    const refundClaimId = refundClaims[0]?.id;
    if (!refundClaimId) {
      throw new Error('Expected the paid add-on refund claim');
    }
    await database
      .update(transactions)
      .set({ stripeRefundStatus: 'requires_action' })
      .where(eq(transactions.id, refundClaimId));
    const replay = await Effect.runPromise(
      cancelRegistrationAddon({
        actorUserId: fixture.userId,
        operationKey: `cancel:${fixture.purchaseId}:settled`,
        quantity: 1,
        reason: 'Refund the reconciled paid add-on',
        refundRequested: true,
        registrationAddonId: fixture.purchaseId,
        registrationId: fixture.registrationId,
        tenantId: fixture.tenantId,
      }).pipe(Effect.provide(layer)),
    );
    expect(replay).toEqual({
      fulfillmentEventId: result.fulfillmentEventId,
      refundStatus: 'actionRequired',
    });
  });
});
