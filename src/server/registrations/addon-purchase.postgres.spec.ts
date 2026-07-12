import type Stripe from 'stripe';

import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { Pool } from 'pg';

import { databaseLayer } from '../../db';
import { createId } from '../../db/create-id';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import {
  addonToEventRegistrationOptions,
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
  registrationAcquisitionPayments,
  registrationAcquisitions,
  tenants,
  transactions,
  users,
} from '../../db/schema';
import { StripeClient } from '../stripe-client';
import {
  completePaidAddonPurchaseCheckout,
  expirePaidAddonPurchaseCheckout,
} from './addon-purchase-checkout';
import { purchaseRegistrationAddon } from './addon-purchase.service';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}
const neonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';

interface Fixture {
  readonly addOnId: string;
  readonly categoryId: string;
  readonly eventId: string;
  readonly expiresAt: Date;
  readonly optionId: string;
  readonly orderId?: string | undefined;
  readonly purchaseId?: string | undefined;
  readonly purchaseLotId?: string | undefined;
  readonly registrationIds: readonly string[];
  readonly templateId: string;
  readonly tenantId: string;
  readonly transactionId?: string | undefined;
  readonly userIds: readonly string[];
}

type TestDatabase = NodePgDatabase<typeof relations>;

const requireValue = <A>(value: A | null | undefined, label: string): A => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
};

const paidFixtureIdentity = (fixture: Fixture) => ({
  orderId: requireValue(fixture.orderId, 'paid fixture order'),
  registrationId: requireValue(
    fixture.registrationIds[0],
    'paid fixture registration',
  ),
  transactionId: requireValue(
    fixture.transactionId,
    'paid fixture transaction',
  ),
});

const fakeStripe = {
  charges: {
    retrieve: (chargeId: string) => {
      const orderId = chargeId.replace(/^ch_/, '');
      return Promise.resolve({
        amount: 100,
        balance_transaction: {
          amount: 100,
          currency: 'eur',
          fee_details: [
            { amount: 4, type: 'application_fee' },
            { amount: 3, type: 'stripe_fee' },
          ],
          net: 93,
        },
        captured: true,
        currency: 'eur',
        id: chargeId,
        paid: true,
        payment_intent: `pi_${orderId}`,
      });
    },
  },
} as unknown as Stripe;

const makeLayer = (url: string) => {
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: {
        BASE_URL: 'https://addon-purchase.example',
        DATABASE_URL: url,
        NEON_LOCAL_PROXY: String(neonLocalProxy),
        NODE_ENV: 'test',
      },
    }),
  );
  return Layer.mergeAll(
    config,
    databaseLayer.pipe(Layer.provide(config)),
    Layer.succeed(StripeClient, fakeStripe),
  );
};

const seedFixture = async (
  database: TestDatabase,
  input: {
    readonly paid: boolean;
    readonly registrationCount?: number;
    readonly reservationExpiresAt?: Date;
    readonly stock: number;
  },
): Promise<Fixture> => {
  const tenantId = createId();
  const categoryId = createId();
  const templateId = createId();
  const eventId = createId();
  const optionId = createId();
  const addOnId = createId();
  const registrationCount = input.registrationCount ?? 1;
  const userIds = Array.from({ length: registrationCount }, () => createId());
  const registrationIds = Array.from({ length: registrationCount }, () =>
    createId(),
  );
  const now = Date.now();
  const expiresAt =
    input.reservationExpiresAt ?? new Date(now + 30 * 60 * 1000);
  const creatorId = requireValue(userIds[0], 'fixture creator');

  await database.insert(tenants).values({
    domain: `${tenantId}.addon-purchase.example`,
    id: tenantId,
    name: 'Add-on purchase test',
    stripeAccountId: 'acct_addon_purchase_test',
  });
  await database.insert(users).values(
    userIds.map((userId, index) => ({
      auth0Id: `auth0|${userId}`,
      communicationEmail: `${userId}@example.com`,
      email: `${userId}@example.com`,
      firstName: 'Add-on',
      id: userId,
      lastName: `Tester ${index}`,
    })),
  );
  await database.insert(eventTemplateCategories).values({
    icon: { iconColor: 0, iconName: 'circle' },
    id: categoryId,
    tenantId,
    title: 'Add-on purchase',
  });
  await database.insert(eventTemplates).values({
    categoryId,
    description: 'Add-on purchase test',
    icon: { iconColor: 0, iconName: 'circle' },
    id: templateId,
    tenantId,
    title: 'Add-on purchase',
  });
  await database.insert(eventInstances).values({
    creatorId,
    description: 'Add-on purchase test',
    end: new Date(now + 2 * 60 * 60 * 1000),
    icon: { iconColor: 0, iconName: 'circle' },
    id: eventId,
    start: new Date(now + 60 * 60 * 1000),
    status: 'APPROVED',
    templateId,
    tenantId,
    title: 'Add-on purchase',
  });
  await database.insert(eventRegistrationOptions).values({
    closeRegistrationTime: new Date(now + 30 * 60 * 1000),
    eventId,
    id: optionId,
    isPaid: false,
    openRegistrationTime: new Date(now - 60 * 60 * 1000),
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
    isPaid: input.paid,
    maxQuantityPerUser: 1,
    price: input.paid ? 100 : 0,
    title: 'Last add-on',
    totalAvailableQuantity: input.stock,
  });
  await database.insert(addonToEventRegistrationOptions).values({
    addonId: addOnId,
    eventId,
    includedQuantity: 0,
    optionalPurchaseQuantity: 1,
    registrationOptionId: optionId,
  });
  await database.insert(eventRegistrations).values(
    registrationIds.map((registrationId, index) => ({
      eventId,
      id: registrationId,
      registrationOptionId: optionId,
      status: 'CONFIRMED' as const,
      tenantId,
      userId: requireValue(userIds[index], 'registration user'),
    })),
  );
  const acquisitionIds = registrationIds.map(() => createId());
  await database.insert(registrationAcquisitions).values(
    registrationIds.map((registrationId, index) => ({
      acquiredAt: new Date(now),
      eventId,
      id: requireValue(acquisitionIds[index], 'initial acquisition'),
      kind: 'initial' as const,
      operationKey: `registration-initial:${registrationId}`,
      ordinal: 0,
      ownerUserId: requireValue(userIds[index], 'acquisition owner'),
      registrationId,
      spotCount: 1,
      tenantId,
    })),
  );
  await database.insert(registrationAcquisitionComponents).values(
    registrationIds.map((registrationId, index) => ({
      acquiredAt: new Date(now),
      acquisitionId: requireValue(acquisitionIds[index], 'initial acquisition'),
      allocationKey: `registration-initial:${registrationId}`,
      applicationFeeAmount: 0,
      baseAmount: 0,
      currency: 'EUR' as const,
      eventId,
      grossAmount: 0,
      kind: 'registration' as const,
      netAmount: 0,
      quantity: 1,
      registrationId,
      stripeFeeAmount: 0,
      taxAmount: 0,
      tenantId,
    })),
  );

  if (!input.paid) {
    return {
      addOnId,
      categoryId,
      eventId,
      expiresAt,
      optionId,
      registrationIds,
      templateId,
      tenantId,
      userIds,
    };
  }

  const transactionId = createId();
  const orderId = createId();
  const purchaseId = createId();
  const purchaseLotId = createId();
  const registrationId = requireValue(registrationIds[0], 'paid registration');
  const userId = requireValue(userIds[0], 'paid user');
  const expiresAtEpoch = Math.floor(expiresAt.getTime() / 1000);
  await database.insert(transactions).values({
    amount: 100,
    appFee: 4,
    currency: 'EUR',
    eventId,
    eventRegistrationId: registrationId,
    id: transactionId,
    method: 'stripe',
    status: 'pending',
    stripeAccountId: 'acct_addon_purchase_test',
    stripeCheckoutRequest: {
      customerEmail: `${userId}@example.com`,
      eventTitle: 'Add-on purchase',
      eventUrl: 'https://addon-purchase.example/events/test',
      expiresAt: expiresAtEpoch,
      lineItems: [
        {
          addonId: addOnId,
          allocationKey: `addon-order:${orderId}`,
          kind: 'addon',
          name: 'Last add-on',
          quantity: 1,
          unitAmount: 100,
        },
      ],
      notificationEmail: `${userId}@example.com`,
    },
    stripeCheckoutSessionId: `cs_${orderId}`,
    stripeCheckoutUrl: `https://checkout.stripe.test/cs_${orderId}`,
    stripePaymentIntentId: `pi_${orderId}`,
    targetUserId: userId,
    tenantId,
    type: 'addon',
  });
  await database.insert(eventRegistrationAddonPurchaseOrders).values({
    addonId: addOnId,
    applicationFeeAmount: 4,
    baseAmount: 100,
    currency: 'EUR',
    eventId,
    expectedGrossAmount: 100,
    expiresAt,
    id: orderId,
    operationKey: `purchase:${orderId}`,
    purchaseId,
    purchaseLotId,
    quantity: 1,
    registrationId,
    registrationOptionId: optionId,
    requestedByUserId: userId,
    status: 'pending_payment',
    tenantId,
    transactionId,
    unitPrice: 100,
    window: 'before_event',
  });
  return {
    addOnId,
    categoryId,
    eventId,
    expiresAt,
    optionId,
    orderId,
    purchaseId,
    purchaseLotId,
    registrationIds,
    templateId,
    tenantId,
    transactionId,
    userIds,
  };
};

const cleanFixture = async (database: TestDatabase, fixture: Fixture) => {
  await database
    .delete(registrationAcquisitionComponents)
    .where(eq(registrationAcquisitionComponents.eventId, fixture.eventId));
  await database
    .delete(registrationAcquisitionPayments)
    .where(eq(registrationAcquisitionPayments.eventId, fixture.eventId));
  await database
    .delete(registrationAcquisitions)
    .where(eq(registrationAcquisitions.eventId, fixture.eventId));
  await database
    .delete(eventRegistrationAddonPurchaseLots)
    .where(eq(eventRegistrationAddonPurchaseLots.eventId, fixture.eventId));
  await database
    .delete(eventRegistrationAddonPurchases)
    .where(eq(eventRegistrationAddonPurchases.eventId, fixture.eventId));
  await database
    .delete(eventRegistrationAddonPurchaseOrders)
    .where(eq(eventRegistrationAddonPurchaseOrders.eventId, fixture.eventId));
  await database
    .delete(transactions)
    .where(eq(transactions.eventId, fixture.eventId));
  await database
    .delete(eventRegistrations)
    .where(eq(eventRegistrations.eventId, fixture.eventId));
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
  for (const userId of fixture.userIds) {
    await database.delete(users).where(eq(users.id, userId));
  }
  await database.delete(tenants).where(eq(tenants.id, fixture.tenantId));
};

const completedSession = (fixture: Fixture): Stripe.Checkout.Session => {
  const { orderId, registrationId, transactionId } =
    paidFixtureIdentity(fixture);
  return {
    amount_total: 100,
    currency: 'eur',
    expires_at: Math.floor(fixture.expiresAt.getTime() / 1000),
    id: `cs_${orderId}`,
    metadata: {
      addonPurchaseOrderId: orderId,
      registrationId,
      tenantId: fixture.tenantId,
      transactionId,
    },
    object: 'checkout.session',
    payment_intent: {
      id: `pi_${orderId}`,
      latest_charge: `ch_${orderId}`,
    } as Stripe.PaymentIntent,
    payment_status: 'paid',
    status: 'complete',
  } as Stripe.Checkout.Session;
};

describe('post-registration add-on purchase concurrency', () => {
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

  it('keeps a paid reservation invisible until exact Checkout completion', async () => {
    const fixture = await seedFixture(database, { paid: true, stock: 0 });
    fixtures.push(fixture);
    const { orderId, registrationId, transactionId } =
      paidFixtureIdentity(fixture);

    expect(
      await database.query.eventRegistrationAddonPurchases.findMany({
        where: { registrationId },
      }),
    ).toHaveLength(0);
    expect(
      await database.query.eventRegistrationAddonPurchaseLots.findMany({
        where: { registrationId },
      }),
    ).toHaveLength(0);

    const first = await Effect.runPromise(
      completePaidAddonPurchaseCheckout(
        {
          orderId,
          registrationId,
          stripeAccountId: 'acct_addon_purchase_test',
          stripeCheckoutSessionId: `cs_${orderId}`,
          tenantId: fixture.tenantId,
          transactionId,
        },
        completedSession(fixture),
      ).pipe(Effect.provide(layer)),
    );
    const replay = await Effect.runPromise(
      completePaidAddonPurchaseCheckout(
        {
          orderId,
          registrationId,
          stripeAccountId: 'acct_addon_purchase_test',
          stripeCheckoutSessionId: `cs_${orderId}`,
          tenantId: fixture.tenantId,
          transactionId,
        },
        completedSession(fixture),
      ).pipe(Effect.provide(layer)),
    );

    expect(first).toBe('finalized');
    expect(replay).toBe('alreadyCompleted');
    expect(
      await database.query.eventRegistrationAddonPurchases.findMany({
        where: { registrationId },
      }),
    ).toHaveLength(1);
    expect(
      await database.query.eventRegistrationAddonPurchaseLots.findMany({
        where: { registrationId },
      }),
    ).toHaveLength(1);
    expect(
      await database.query.registrationAcquisitionPayments.findMany({
        where: { registrationId },
      }),
    ).toHaveLength(1);
    const components =
      await database.query.registrationAcquisitionComponents.findMany({
        where: { registrationId },
      });
    expect(components).toHaveLength(2);
    expect(components.find(({ kind }) => kind === 'addon_lot')).toMatchObject({
      applicationFeeAmount: 4,
      grossAmount: 100,
      netAmount: 93,
      purchaseLotId: fixture.purchaseLotId,
      stripeFeeAmount: 3,
    });
  });

  it('makes a free operation retry idempotent and serializes the last stock unit', async () => {
    const fixture = await seedFixture(database, {
      paid: false,
      registrationCount: 2,
      stock: 1,
    });
    fixtures.push(fixture);
    const purchase = (index: number, operationKey: string) =>
      Effect.runPromise(
        purchaseRegistrationAddon({
          addonId: fixture.addOnId,
          operationKey,
          quantity: 1,
          registrationId: requireValue(
            fixture.registrationIds[index],
            'free purchase registration',
          ),
          tenantId: fixture.tenantId,
          userId: requireValue(fixture.userIds[index], 'free purchase user'),
        }).pipe(
          Effect.match({
            onFailure: (error) => ({ error, type: 'failure' as const }),
            onSuccess: (value) => ({ type: 'success' as const, value }),
          }),
          Effect.provide(layer),
        ),
      );

    const operationKey = `free:${fixture.registrationIds[0]}`;
    const first = await purchase(0, operationKey);
    const replay = await purchase(0, operationKey);
    expect(first.type).toBe('success');
    expect(replay).toEqual(first);
    expect(
      await database.query.registrationAcquisitionComponents.findMany({
        where: {
          registrationId: requireValue(
            fixture.registrationIds[0],
            'free acquisition registration',
          ),
        },
      }),
    ).toHaveLength(2);

    const raceFixture = await seedFixture(database, {
      paid: false,
      registrationCount: 2,
      stock: 1,
    });
    fixtures.push(raceFixture);
    const racePurchase = (index: number) =>
      Effect.runPromise(
        purchaseRegistrationAddon({
          addonId: raceFixture.addOnId,
          operationKey: `race:${raceFixture.registrationIds[index]}`,
          quantity: 1,
          registrationId: requireValue(
            raceFixture.registrationIds[index],
            'race registration',
          ),
          tenantId: raceFixture.tenantId,
          userId: requireValue(raceFixture.userIds[index], 'race user'),
        }).pipe(
          Effect.match({
            onFailure: () => 'failure' as const,
            onSuccess: () => 'success' as const,
          }),
          Effect.provide(layer),
        ),
      );
    const outcomes = await Promise.all([racePurchase(0), racePurchase(1)]);
    expect(outcomes.toSorted()).toEqual(['failure', 'success']);
    expect(
      await database.query.eventRegistrationAddonPurchaseOrders.findMany({
        where: { eventId: raceFixture.eventId },
      }),
    ).toHaveLength(1);
    expect(
      await database.query.eventAddons.findFirst({
        columns: { totalAvailableQuantity: true },
        where: { id: raceFixture.addOnId },
      }),
    ).toEqual({ totalAvailableQuantity: 0 });
  });

  it('serializes completion against expiry without double-granting or releasing stock', async () => {
    const fixture = await seedFixture(database, {
      paid: true,
      reservationExpiresAt: new Date(Date.now() - 60_000),
      stock: 0,
    });
    fixtures.push(fixture);
    const paidIdentity = paidFixtureIdentity(fixture);
    const identity = {
      orderId: paidIdentity.orderId,
      registrationId: paidIdentity.registrationId,
      stripeAccountId: 'acct_addon_purchase_test',
      stripeCheckoutSessionId: `cs_${paidIdentity.orderId}`,
      tenantId: fixture.tenantId,
      transactionId: paidIdentity.transactionId,
    } as const;

    await Promise.all([
      Effect.runPromise(
        completePaidAddonPurchaseCheckout(
          identity,
          completedSession(fixture),
        ).pipe(Effect.exit, Effect.provide(layer)),
      ),
      Effect.runPromise(
        expirePaidAddonPurchaseCheckout({
          ...identity,
          now: new Date(),
        }).pipe(Effect.exit, Effect.provide(layer)),
      ),
    ]);

    const [order, transaction, purchases, lots, addOn] = await Promise.all([
      database.query.eventRegistrationAddonPurchaseOrders.findFirst({
        where: { id: fixture.orderId },
      }),
      database.query.transactions.findFirst({
        where: { id: fixture.transactionId },
      }),
      database.query.eventRegistrationAddonPurchases.findMany({
        where: { registrationId: fixture.registrationIds[0] },
      }),
      database.query.eventRegistrationAddonPurchaseLots.findMany({
        where: { registrationId: fixture.registrationIds[0] },
      }),
      database.query.eventAddons.findFirst({
        where: { id: fixture.addOnId },
      }),
    ]);
    expect(order?.status === 'completed' || order?.status === 'expired').toBe(
      true,
    );
    if (order?.status === 'completed') {
      expect(transaction?.status).toBe('successful');
      expect(purchases).toHaveLength(1);
      expect(lots).toHaveLength(1);
      expect(addOn?.totalAvailableQuantity).toBe(0);
    } else {
      expect(transaction?.status).toBe('cancelled');
      expect(purchases).toHaveLength(0);
      expect(lots).toHaveLength(0);
      expect(addOn?.totalAvailableQuantity).toBe(1);
    }
  });
});
