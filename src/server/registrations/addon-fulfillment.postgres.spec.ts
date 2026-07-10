import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { Pool } from 'pg';

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
  tenants,
  users,
} from '../../db/schema';
import {
  cancelRegistrationAddon,
  cancelRemainingRegistrationAddons,
  redeemRegistrationAddon,
} from './addon-fulfillment.service';

const databaseUrl = process.env['DATABASE_URL'];
const neonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';
const describeWithPostgres = databaseUrl ? describe : describe.skip;
interface Fixture {
  readonly addOnId: string;
  readonly categoryId: string;
  readonly eventId: string;
  readonly optionId: string;
  readonly purchaseId: string;
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
  return Layer.mergeAll(config, databaseLayer.pipe(Layer.provide(config)));
};

const seedFixture = async (
  database: TestDatabase,
  input: {
    readonly includedQuantity: number;
    readonly purchasedQuantity: number;
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
  const now = Date.now();

  await database.insert(tenants).values({
    canonicalRootUrl: `https://${tenantId}.fulfillment.example`,
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
    isPaid: false,
    maxQuantityPerUser: input.includedQuantity + input.purchasedQuantity,
    price: 0,
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
    unitPrice: 0,
  });
  if (input.purchasedQuantity > 0) {
    await database.insert(eventRegistrationAddonPurchaseLots).values({
      applicationFeeAmount: 0,
      baseAmount: 0,
      currency: 'EUR',
      eventId,
      grossAmount: 0,
      netAmount: 0,
      paymentAllocationFinalizedAt: new Date(),
      purchaseId,
      quantity: input.purchasedQuantity,
      registrationId,
      registrationOptionId: optionId,
      sourceLineKey: `free:${purchaseId}`,
      stripeFeeAmount: 0,
      taxAmount: 0,
      tenantId,
      unitPrice: 0,
    });
  }
  return {
    addOnId,
    categoryId,
    eventId,
    optionId,
    purchaseId,
    registrationId,
    templateId,
    tenantId,
    userId,
  };
};

const cleanFixture = async (database: TestDatabase, fixture: Fixture) => {
  await database
    .delete(eventRegistrationAddonPurchases)
    .where(eq(eventRegistrationAddonPurchases.id, fixture.purchaseId));
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

describeWithPostgres('add-on fulfillment concurrency', () => {
  let database: TestDatabase;
  const fixtures: Fixture[] = [];
  let layer: ReturnType<typeof makeLayer>;
  let pool: Pool;

  beforeAll(() => {
    if (!databaseUrl) return;
    pool = new Pool(createNodePgPoolConfig({ databaseUrl, neonLocalProxy }));
    database = drizzle({ client: pool, relations });
    layer = makeLayer(databaseUrl);
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    for (const fixture of fixtures.toReversed()) {
      await cleanFixture(database, fixture);
    }
    await pool.end();
  });

  it('redeems two distinct intents from one snapshot and keeps an exact retry idempotent', async () => {
    if (!databaseUrl) return;
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
    if (!databaseUrl) return;
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
      }).pipe(Effect.provide(layer), Effect.either),
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
      ).pipe(Effect.provide(layer), Effect.either),
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
    if (!databaseUrl) return;
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
      }).pipe(Effect.provide(layer), Effect.either),
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
      ).pipe(Effect.provide(layer), Effect.either),
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
});
