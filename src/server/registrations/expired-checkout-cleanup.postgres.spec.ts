import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from '@effect/vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer, Result } from 'effect';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import Stripe from 'stripe';

import { Database, databaseLayer } from '../../db/database.layer';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import {
  addonToEventRegistrationOptions,
  emailOutbox,
  eventAddons,
  eventInstances,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  registrationAcquisitionComponents,
  registrationAcquisitionPayments,
  registrationAcquisitions,
  registrationTransfers,
  tenants,
  transactions,
  users,
  usersToTenants,
} from '../../db/schema';
import {
  createRegistrationRefundClaim,
  processRegistrationRefundClaim,
  reconcileRegistrationRefundWebhook,
  registrationRefundIdempotencyKey,
  requeueRegistrationRefundClaim,
} from '../payments/registration-refund';
import { StripeClient } from '../stripe-client';
import {
  cancelExpiredBoundRegistrationClaim,
  claimDueBoundRegistrationCheckoutCandidates,
  expiredUnboundRegistrationClaimPredicate,
  processDueBoundRegistrationCheckouts,
  processExpiredUnboundRegistrationCheckouts,
} from './expired-checkout-cleanup';
import { expiredRegistrationTransferCheckoutCandidatePredicate } from './registration-transfer-finalization';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

interface Fixture {
  readonly addOnId: string;
  readonly categoryId: string;
  readonly eventId: string;
  readonly optionId: string;
  readonly registrationId: string;
  readonly stripeAccountId: string;
  readonly templateId: string;
  readonly tenantId: string;
  readonly transactionId: string;
  readonly userId: string;
}

type TestDatabase = NodePgDatabase<typeof relations>;

const makeId = (prefix: string, suffix: string): string =>
  `${prefix}-${suffix}`.slice(0, 20);

const makeDatabaseServiceLayer = (url: string) => {
  const configLayer = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: Object.fromEntries([['DATABASE_URL', url]]),
    }),
  );
  return databaseLayer.pipe(Layer.provide(configLayer));
};

const runCleanup = (url: string, nowEpochSeconds: number) =>
  Effect.runPromise(
    processExpiredUnboundRegistrationCheckouts({
      batchSize: 10,
      nowEpochSeconds,
    }).pipe(Effect.provide(makeDatabaseServiceLayer(url))),
  );

const runBoundCancellation = (
  url: string,
  candidate: {
    readonly registrationId: string;
    readonly stripeAccountId: string;
    readonly stripeCheckoutSessionId: string;
    readonly tenantId: string;
    readonly transactionId: string;
  },
  nowEpochSeconds: number,
) =>
  Effect.runPromise(
    cancelExpiredBoundRegistrationClaim(candidate, nowEpochSeconds).pipe(
      Effect.provide(makeDatabaseServiceLayer(url)),
    ),
  );

const runDueClaim = (
  url: string,
  input: {
    readonly leaseDurationMs?: number;
    readonly limit: number;
    readonly now: Date;
  },
) =>
  Effect.runPromise(
    Database.use((database) =>
      claimDueBoundRegistrationCheckoutCandidates(database, input),
    ).pipe(Effect.provide(makeDatabaseServiceLayer(url))),
  );

const bindDueCheckout = async (
  database: TestDatabase,
  fixture: Fixture,
  now: Date,
) => {
  const stripeCheckoutSessionId = `cs_test_${fixture.transactionId}`;
  await database
    .update(transactions)
    .set({
      stripeCheckoutReconcileNextAt: now,
      stripeCheckoutSessionId,
      stripeCheckoutUrl: `https://checkout.stripe.test/${fixture.transactionId}`,
    })
    .where(eq(transactions.id, fixture.transactionId));
  return stripeCheckoutSessionId;
};

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 10_000,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
};

const waitForBlockedRegistrationLocks = (pool: Pool, minimumCount: number) =>
  waitFor(async () => {
    const blocked = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%event_registrations%'
      `,
    );
    return Number(blocked.rows[0]?.count ?? 0) >= minimumCount;
  }, `Timed out waiting for ${minimumCount} blocked registration locks`);

const lockRegistration = async (
  pool: Pool,
  registrationId: string,
): Promise<PoolClient> => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    await client.query(
      'SELECT id FROM event_registrations WHERE id = $1 FOR UPDATE',
      [registrationId],
    );
    return client;
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }
};

const seedFixture = async (
  database: TestDatabase,
  expiresAt: number,
): Promise<Fixture> => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  const tenantId = makeId('tenant', suffix);
  const userId = makeId('user', suffix);
  const categoryId = makeId('category', suffix);
  const templateId = makeId('template', suffix);
  const eventId = makeId('event', suffix);
  const optionId = makeId('option', suffix);
  const addOnId = makeId('addon', suffix);
  const purchaseId = makeId('purchase', suffix);
  const purchaseLotId = makeId('lot', suffix);
  const registrationId = makeId('reg', suffix);
  const transactionId = makeId('claim', suffix);
  const stripeAccountId = `acct_${suffix}`;
  const now = Date.now();

  await database.insert(tenants).values({
    domain: `${suffix}.cleanup.example`,
    id: tenantId,
    name: `Cleanup ${suffix}`,
    stripeAccountId,
  });
  await database.insert(users).values({
    auth0Id: `auth0|${suffix}`,
    communicationEmail: `${suffix}@example.com`,
    email: `${suffix}@example.com`,
    firstName: 'Cleanup',
    id: userId,
    lastName: 'Tester',
  });
  await database.insert(usersToTenants).values({
    id: makeId('member', suffix),
    tenantId,
    userId,
  });
  await database.insert(eventTemplateCategories).values({
    icon: { iconColor: 0, iconName: 'circle' },
    id: categoryId,
    tenantId,
    title: 'Cleanup tests',
  });
  await database.insert(eventTemplates).values({
    categoryId,
    description: 'Cleanup fixture template',
    icon: { iconColor: 0, iconName: 'circle' },
    id: templateId,
    tenantId,
    title: 'Cleanup fixture',
  });
  await database.insert(eventInstances).values({
    creatorId: userId,
    description: 'Cleanup fixture event',
    end: new Date(now + 8 * 24 * 60 * 60 * 1000),
    icon: { iconColor: 0, iconName: 'circle' },
    id: eventId,
    start: new Date(now + 7 * 24 * 60 * 60 * 1000),
    status: 'APPROVED',
    templateId,
    tenantId,
    title: 'Cleanup fixture',
  });
  await database.insert(eventRegistrationOptions).values({
    closeRegistrationTime: new Date(now + 6 * 24 * 60 * 60 * 1000),
    eventId,
    id: optionId,
    isPaid: true,
    openRegistrationTime: new Date(now - 24 * 60 * 60 * 1000),
    organizingRegistration: false,
    price: 1000,
    registrationMode: 'application',
    reservedSpots: 1,
    spots: 2,
    title: 'Participant',
  });
  await database.insert(eventAddons).values({
    allowMultiple: true,
    allowPurchaseBeforeEvent: false,
    allowPurchaseDuringEvent: false,
    allowPurchaseDuringRegistration: true,
    eventId,
    id: addOnId,
    isPaid: false,
    maxQuantityPerUser: 2,
    price: 0,
    title: 'Cleanup add-on',
    totalAvailableQuantity: 3,
  });
  await database.insert(addonToEventRegistrationOptions).values({
    addonId: addOnId,
    eventId,
    includedQuantity: 1,
    optionalPurchaseQuantity: 1,
    registrationOptionId: optionId,
  });
  await database.insert(eventRegistrations).values({
    basePriceAtRegistration: 1000,
    eventId,
    id: registrationId,
    registrationOptionId: optionId,
    status: 'PENDING',
    tenantId,
    userId,
  });
  await database.insert(eventRegistrationAddonPurchases).values({
    addonId: addOnId,
    eventId,
    id: purchaseId,
    includedQuantity: 1,
    purchasedQuantity: 1,
    quantity: 2,
    registrationId,
    registrationOptionId: optionId,
    tenantId,
    unitPrice: 0,
  });
  await database.insert(eventRegistrationAddonPurchaseLots).values({
    applicationFeeAmount: 0,
    baseAmount: 0,
    currency: 'EUR',
    eventId,
    grossAmount: 0,
    id: purchaseLotId,
    netAmount: 0,
    paymentAllocationFinalizedAt: new Date(now),
    purchaseId,
    quantity: 1,
    registrationId,
    registrationOptionId: optionId,
    sourceLineKey: `addon-lot:${purchaseLotId}`,
    stripeFeeAmount: 0,
    taxAmount: 0,
    tenantId,
    unitPrice: 0,
  });
  await database.insert(transactions).values({
    amount: 1000,
    appFee: 35,
    currency: 'EUR',
    eventId,
    eventRegistrationId: registrationId,
    executiveUserId: userId,
    id: transactionId,
    method: 'stripe',
    status: 'pending',
    stripeAccountId,
    stripeCheckoutRequest: {
      customerEmail: `${suffix}@example.com`,
      eventTitle: 'Cleanup fixture',
      eventUrl: 'https://cleanup.example/events/fixture',
      expiresAt,
      lineItems: [
        {
          name: 'Registration fee',
          quantity: 1,
          unitAmount: 1000,
        },
      ],
      notificationEmail: `${suffix}@example.com`,
    },
    targetUserId: userId,
    tenantId,
    type: 'registration',
  });

  return {
    addOnId,
    categoryId,
    eventId,
    optionId,
    registrationId,
    stripeAccountId,
    templateId,
    tenantId,
    transactionId,
    userId,
  };
};

const cleanFixture = async (database: TestDatabase, fixture: Fixture) => {
  await database
    .delete(emailOutbox)
    .where(eq(emailOutbox.tenantId, fixture.tenantId));
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
    .delete(transactions)
    .where(eq(transactions.tenantId, fixture.tenantId));
  await database
    .delete(eventRegistrationAddonPurchases)
    .where(
      eq(
        eventRegistrationAddonPurchases.registrationId,
        fixture.registrationId,
      ),
    );
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
  await database
    .delete(usersToTenants)
    .where(
      and(
        eq(usersToTenants.tenantId, fixture.tenantId),
        eq(usersToTenants.userId, fixture.userId),
      ),
    );
  await database.delete(users).where(eq(users.id, fixture.userId));
  await database.delete(tenants).where(eq(tenants.id, fixture.tenantId));
};

const readFixtureState = async (database: TestDatabase, fixture: Fixture) => {
  const [claim, registration, option, addOn] = await Promise.all([
    database.query.transactions.findFirst({
      where: { id: fixture.transactionId },
    }),
    database.query.eventRegistrations.findFirst({
      where: { id: fixture.registrationId },
    }),
    database.query.eventRegistrationOptions.findFirst({
      where: { id: fixture.optionId },
    }),
    database.query.eventAddons.findFirst({
      where: { id: fixture.addOnId },
    }),
  ]);
  return { addOn, claim, option, registration };
};

describe('expired unbound checkout cleanup concurrency', () => {
  let database: TestDatabase;
  const fixtures: Fixture[] = [];
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
  });

  afterEach(async () => {
    for (const fixture of fixtures.toReversed()) {
      await cleanFixture(database, fixture);
    }
    fixtures.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('executes typed JSONPath deadline selectors for registration and transfer claims', async () => {
    const deadline = 1_750_000_000;

    await database
      .select({ id: transactions.id })
      .from(transactions)
      .where(expiredUnboundRegistrationClaimPredicate(deadline))
      .limit(1);
    await database
      .select({ id: registrationTransfers.id })
      .from(registrationTransfers)
      .innerJoin(
        transactions,
        eq(
          transactions.id,
          registrationTransfers.recipientCheckoutTransactionId,
        ),
      )
      .where(expiredRegistrationTransferCheckoutCandidatePredicate(deadline))
      .limit(1);
  });

  it('releases one reservation exactly once across simultaneous sweepers', async () => {
    const expiresAt = 4_000_000_000;
    const fixture = await seedFixture(database, expiresAt);
    fixtures.push(fixture);
    const registrationLock = await lockRegistration(
      pool,
      fixture.registrationId,
    );

    try {
      const firstCleanup = runCleanup(databaseUrl, expiresAt);
      const secondCleanup = runCleanup(databaseUrl, expiresAt);
      await waitForBlockedRegistrationLocks(pool, 2);
      await registrationLock.query('COMMIT');

      const summaries = await Promise.all([firstCleanup, secondCleanup]);
      expect(
        summaries.reduce((total, summary) => total + summary.cancelled, 0),
      ).toBe(1);
      expect(
        summaries.reduce((total, summary) => total + summary.failed, 0),
      ).toBe(0);

      const state = await readFixtureState(database, fixture);
      expect(state.registration?.status).toBe('CANCELLED');
      expect(state.option?.reservedSpots).toBe(0);
      expect(state.option?.confirmedSpots).toBe(0);
      expect(state.addOn?.totalAvailableQuantity).toBe(5);
      expect(state.claim).toEqual(
        expect.objectContaining({
          status: 'cancelled',
          stripeCheckoutSessionId: null,
        }),
      );
    } finally {
      if (!registrationLock.released) {
        await registrationLock.query('ROLLBACK').catch(() => null);
      }
      registrationLock.release();
    }
  }, 30_000);

  it('preserves a claim that becomes bound while the sweeper waits', async () => {
    const expiresAt = 4_000_000_000;
    const fixture = await seedFixture(database, expiresAt);
    fixtures.push(fixture);
    const registrationLock = await lockRegistration(
      pool,
      fixture.registrationId,
    );
    const stripeCheckoutSessionId = `cs_test_${fixture.transactionId}`;

    try {
      const cleanup = runCleanup(databaseUrl, expiresAt);
      await waitForBlockedRegistrationLocks(pool, 1);
      await registrationLock.query(
        `
          UPDATE transactions
          SET "stripeCheckoutSessionId" = $1,
              "stripeCheckoutUrl" = $2
          WHERE id = $3
        `,
        [
          stripeCheckoutSessionId,
          `https://checkout.stripe.test/${fixture.transactionId}`,
          fixture.transactionId,
        ],
      );
      await registrationLock.query('COMMIT');

      expect(await cleanup).toEqual({
        cancelled: 0,
        failed: 0,
        scanned: 1,
        skipped: 1,
      });
      const state = await readFixtureState(database, fixture);
      expect(state.registration?.status).toBe('PENDING');
      expect(state.option?.reservedSpots).toBe(1);
      expect(state.addOn?.totalAvailableQuantity).toBe(3);
      expect(state.claim).toEqual(
        expect.objectContaining({
          status: 'pending',
          stripeCheckoutSessionId,
        }),
      );
    } finally {
      if (!registrationLock.released) {
        await registrationLock.query('ROLLBACK').catch(() => null);
      }
      registrationLock.release();
    }
  }, 30_000);

  it('releases one bound expired Checkout reservation exactly once across simultaneous reconcilers', async () => {
    const expiresAt = 4_000_000_000;
    const fixture = await seedFixture(database, expiresAt);
    fixtures.push(fixture);
    const stripeCheckoutSessionId = `cs_test_${fixture.transactionId}`;
    await database
      .update(transactions)
      .set({
        stripeCheckoutSessionId,
        stripeCheckoutUrl: `https://checkout.stripe.test/${fixture.transactionId}`,
      })
      .where(eq(transactions.id, fixture.transactionId));
    const registrationLock = await lockRegistration(
      pool,
      fixture.registrationId,
    );
    const candidate = {
      registrationId: fixture.registrationId,
      stripeAccountId: fixture.stripeAccountId,
      stripeCheckoutSessionId,
      tenantId: fixture.tenantId,
      transactionId: fixture.transactionId,
    };

    try {
      const firstReconciliation = runBoundCancellation(
        databaseUrl,
        candidate,
        expiresAt,
      );
      const secondReconciliation = runBoundCancellation(
        databaseUrl,
        candidate,
        expiresAt,
      );
      await waitForBlockedRegistrationLocks(pool, 2);
      await registrationLock.query('COMMIT');

      const outcomes = await Promise.all([
        firstReconciliation,
        secondReconciliation,
      ]);
      expect(outcomes.toSorted()).toEqual(['cancelled', 'skipped']);

      const state = await readFixtureState(database, fixture);
      expect(state.registration?.status).toBe('CANCELLED');
      expect(state.option?.reservedSpots).toBe(0);
      expect(state.addOn?.totalAvailableQuantity).toBe(5);
      expect(state.claim).toEqual(
        expect.objectContaining({
          status: 'cancelled',
          stripeAccountId: fixture.stripeAccountId,
          stripeCheckoutSessionId,
        }),
      );
    } finally {
      if (!registrationLock.released) {
        await registrationLock.query('ROLLBACK').catch(() => null);
      }
      registrationLock.release();
    }
  }, 30_000);

  it('leases fair due batches across two workers without starving later claims', async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const firstFixture = await seedFixture(database, 4_000_000_000);
    const secondFixture = await seedFixture(database, 4_000_000_000);
    fixtures.push(firstFixture, secondFixture);
    await Promise.all([
      bindDueCheckout(database, firstFixture, now),
      bindDueCheckout(database, secondFixture, now),
    ]);

    const [firstBatch, secondBatch] = await Promise.all([
      runDueClaim(databaseUrl, { limit: 1, now }),
      runDueClaim(databaseUrl, { limit: 1, now }),
    ]);
    expect(firstBatch).toHaveLength(1);
    expect(secondBatch).toHaveLength(1);
    expect(
      new Set([firstBatch[0]?.transactionId, secondBatch[0]?.transactionId]),
    ).toEqual(
      new Set([firstFixture.transactionId, secondFixture.transactionId]),
    );
    expect(firstBatch[0]?.leaseId).not.toBe(secondBatch[0]?.leaseId);
  }, 30_000);

  it('releases database locks before retrieving a leased Checkout from Stripe', async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const fixture = await seedFixture(database, 4_000_000_000);
    fixtures.push(fixture);
    const stripeCheckoutSessionId = await bindDueCheckout(
      database,
      fixture,
      now,
    );
    const stripe = new Stripe('sk_test_123');
    const { promise: retrievedSession, resolve: releaseRetrieve } =
      Promise.withResolvers<Stripe.Checkout.Session>();
    const retrieve = vi
      .spyOn(stripe.checkout.sessions, 'retrieve')
      .mockImplementation(() => retrievedSession as never);
    const worker = Effect.runPromise(
      processDueBoundRegistrationCheckouts({
        batchSize: 1,
        nowEpochSeconds: Math.floor(now.getTime() / 1000),
      }).pipe(
        Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
        Effect.provideService(StripeClient, stripe),
      ),
    );

    await waitFor(
      () => retrieve.mock.calls.length === 1,
      'Timed out waiting for the Stripe retrieval probe',
    );
    const probe = await pool.connect();
    try {
      await probe.query('BEGIN');
      await probe.query("SET LOCAL lock_timeout = '250ms'");
      await probe.query('UPDATE transactions SET comment = $1 WHERE id = $2', [
        'lock probe completed',
        fixture.transactionId,
      ]);
      await probe.query('COMMIT');
    } finally {
      await probe.query('ROLLBACK').catch(() => null);
      probe.release();
    }

    releaseRetrieve({
      id: stripeCheckoutSessionId,
      object: 'checkout.session',
      payment_status: 'unpaid',
      status: 'open',
    } as Stripe.Checkout.Session);
    expect(await worker).toEqual({
      cancelled: 0,
      failed: 0,
      scanned: 1,
      skipped: 1,
    });
  }, 30_000);

  it('recovers a lost direct paid-completion webhook exactly once', async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const fixture = await seedFixture(database, 4_000_000_000);
    fixtures.push(fixture);
    const stripeCheckoutSessionId = await bindDueCheckout(
      database,
      fixture,
      now,
    );
    await database
      .update(transactions)
      .set({ stripeCheckoutCancellationRequestedAt: now })
      .where(eq(transactions.id, fixture.transactionId));
    const stripePaymentIntentId = `pi_${fixture.transactionId}`;
    const stripeChargeId = `ch_${fixture.transactionId}`;
    const stripe = new Stripe('sk_test_123');
    const retrieve = vi
      .spyOn(stripe.checkout.sessions, 'retrieve')
      .mockResolvedValue({
        amount_total: 1000,
        currency: 'eur',
        id: stripeCheckoutSessionId,
        metadata: {
          registrationId: fixture.registrationId,
          tenantId: fixture.tenantId,
          transactionId: fixture.transactionId,
        },
        object: 'checkout.session',
        payment_intent: {
          id: stripePaymentIntentId,
          latest_charge: stripeChargeId,
        },
        payment_status: 'paid',
        status: 'complete',
      } as never);
    const retrieveCharge = vi
      .spyOn(stripe.charges, 'retrieve')
      .mockResolvedValue({
        amount: 1000,
        balance_transaction: {
          amount: 1000,
          currency: 'eur',
          fee_details: [
            { amount: 35, type: 'application_fee' },
            { amount: 29, type: 'stripe_fee' },
          ],
          net: 936,
        },
        captured: true,
        currency: 'eur',
        id: stripeChargeId,
        paid: true,
        payment_intent: stripePaymentIntentId,
      } as never);
    const configLayer = ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: {
          BASE_URL: 'https://caller-controlled.invalid',
          NODE_ENV: 'production',
        },
      }),
    );

    const summary = await Effect.runPromise(
      processDueBoundRegistrationCheckouts({
        batchSize: 1,
        nowEpochSeconds: Math.floor(now.getTime() / 1000),
      }).pipe(
        Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
        Effect.provide(configLayer),
        Effect.provideService(StripeClient, stripe),
      ),
    );
    expect(summary).toEqual({
      cancelled: 0,
      failed: 0,
      scanned: 1,
      skipped: 1,
    });
    expect(retrieve).toHaveBeenCalledWith(stripeCheckoutSessionId, undefined, {
      stripeAccount: fixture.stripeAccountId,
    });
    expect(retrieveCharge).toHaveBeenCalledWith(
      stripeChargeId,
      { expand: ['balance_transaction'] },
      { stripeAccount: fixture.stripeAccountId },
    );

    const state = await readFixtureState(database, fixture);
    expect(state.registration?.status).toBe('CONFIRMED');
    expect(state.option).toEqual(
      expect.objectContaining({ confirmedSpots: 1, reservedSpots: 0 }),
    );
    expect(state.claim).toEqual(
      expect.objectContaining({
        status: 'successful',
        stripeChargeId,
        stripeCheckoutCancellationRequestedAt: null,
        stripeCheckoutReconcileLeaseId: null,
        stripeCheckoutReconcileNextAt: null,
        stripePaymentIntentId,
      }),
    );
    const confirmationEmail = await database.query.emailOutbox.findFirst({
      where: {
        idempotencyKey: `registration-confirmed/${fixture.tenantId}/${fixture.registrationId}`,
      },
    });
    expect(confirmationEmail?.html).toContain(
      `https://${fixture.tenantId.replace('tenant-', '')}.cleanup.example/events/${fixture.eventId}`,
    );
    expect(confirmationEmail?.html).not.toContain('caller-controlled.invalid');

    const replay = await Effect.runPromise(
      processDueBoundRegistrationCheckouts({
        batchSize: 1,
        nowEpochSeconds: Math.floor(now.getTime() / 1000),
      }).pipe(
        Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
        Effect.provide(configLayer),
        Effect.provideService(StripeClient, stripe),
      ),
    );
    expect(replay.scanned).toBe(0);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieveCharge).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('fails closed before registration mutation when Stripe gross or currency differs', async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const amountMismatch = await seedFixture(database, 4_000_000_000);
    const currencyMismatch = await seedFixture(database, 4_000_000_000);
    fixtures.push(amountMismatch, currencyMismatch);
    const amountSessionId = await bindDueCheckout(
      database,
      amountMismatch,
      now,
    );
    const currencySessionId = await bindDueCheckout(
      database,
      currencyMismatch,
      now,
    );
    const stripe = new Stripe('sk_test_123');
    const retrieve = vi
      .spyOn(stripe.checkout.sessions, 'retrieve')
      .mockImplementation(async (sessionId) => {
        const fixture =
          sessionId === amountSessionId ? amountMismatch : currencyMismatch;
        return {
          amount_total: sessionId === amountSessionId ? 999 : 1000,
          currency: sessionId === currencySessionId ? 'usd' : 'eur',
          id: sessionId,
          metadata: {
            registrationId: fixture.registrationId,
            tenantId: fixture.tenantId,
            transactionId: fixture.transactionId,
          },
          object: 'checkout.session',
          payment_intent: `pi_${fixture.transactionId}`,
          payment_status: 'paid',
          status: 'complete',
        } as never;
      });

    const summary = await Effect.runPromise(
      processDueBoundRegistrationCheckouts({
        batchSize: 2,
        nowEpochSeconds: Math.floor(now.getTime() / 1000),
      }).pipe(
        Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
        Effect.provideService(StripeClient, stripe),
      ),
    );
    expect(summary).toEqual({
      cancelled: 0,
      failed: 2,
      scanned: 2,
      skipped: 0,
    });
    expect(retrieve).toHaveBeenCalledTimes(2);

    for (const fixture of [amountMismatch, currencyMismatch]) {
      const state = await readFixtureState(database, fixture);
      expect(state.registration?.status).toBe('PENDING');
      expect(state.option).toEqual(
        expect.objectContaining({ confirmedSpots: 0, reservedSpots: 1 }),
      );
      expect(state.claim).toEqual(
        expect.objectContaining({
          status: 'pending',
          stripeCheckoutReconcileLastError:
            'Registration Checkout amount or currency does not match persisted payment terms',
          stripeCheckoutReconcileLeaseId: null,
        }),
      );
    }
  }, 30_000);

  it('claims one durable refund across simultaneous workers and preserves the source gross amount', async () => {
    const fixture = await seedFixture(database, 4_000_000_000);
    fixtures.push(fixture);
    const stripePaymentIntentId = `pi_${fixture.transactionId}`;
    await database
      .update(transactions)
      .set({
        status: 'successful',
        stripePaymentIntentId,
      })
      .where(eq(transactions.id, fixture.transactionId));

    const refundClaim = await Effect.runPromise(
      Database.use((effectDatabase) =>
        createRegistrationRefundClaim(effectDatabase, {
          amount: 1000,
          applicationFeeRefunded: true,
          currency: 'EUR',
          eventId: fixture.eventId,
          eventRegistrationId: fixture.registrationId,
          executiveUserId: fixture.userId,
          operationKey: `test-refund:${fixture.transactionId}`,
          sourceTransactionId: fixture.transactionId,
          stripeAccountId: fixture.stripeAccountId,
          targetUserId: fixture.userId,
          tenantId: fixture.tenantId,
        }),
      ).pipe(Effect.provide(makeDatabaseServiceLayer(databaseUrl))),
    );
    expect(refundClaim.id).toHaveLength(20);

    const stripe = new Stripe('sk_test_123');
    const { promise: stripeCreateBarrier, resolve: releaseStripeCreate } =
      Promise.withResolvers<undefined>();
    const createRefund = vi
      .spyOn(stripe.refunds, 'create')
      .mockImplementation(async () => {
        await stripeCreateBarrier;
        return {
          amount: 1000,
          charge: null,
          currency: 'eur',
          id: 're_durable_1',
          metadata: {
            refundClaimId: refundClaim.id,
            refundGeneration: '0',
            registrationId: fixture.registrationId,
            sourceTransactionId: fixture.transactionId,
            tenantId: fixture.tenantId,
          },
          object: 'refund',
          payment_intent: stripePaymentIntentId,
          status: 'succeeded',
        } as never;
      });
    const runRefund = () =>
      Effect.runPromise(
        processRegistrationRefundClaim(refundClaim.id).pipe(
          Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
          Effect.provideService(StripeClient, stripe),
        ),
      );

    const firstWorker = runRefund();
    const secondWorker = runRefund();
    await waitFor(
      () => createRefund.mock.calls.length === 1,
      'Timed out waiting for the claimed Stripe refund',
    );
    releaseStripeCreate(undefined);
    const outcomes = await Promise.all([firstWorker, secondWorker]);

    expect(outcomes.map((outcome) => outcome.status).toSorted()).toEqual([
      'processed',
      'skipped',
    ]);
    expect(createRefund).toHaveBeenCalledTimes(1);
    expect(createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1000,
        metadata: expect.objectContaining({ refundClaimId: refundClaim.id }),
        payment_intent: stripePaymentIntentId,
        refund_application_fee: true,
      }),
      {
        idempotencyKey: registrationRefundIdempotencyKey(refundClaim.id),
        stripeAccount: fixture.stripeAccountId,
      },
    );

    const source = await database.query.transactions.findFirst({
      where: { id: fixture.transactionId },
    });
    const persistedRefund = await database.query.transactions.findFirst({
      where: { id: refundClaim.id },
    });
    expect(source?.amount).toBe(1000);
    expect(persistedRefund).toEqual(
      expect.objectContaining({
        amount: -1000,
        sourceTransactionId: fixture.transactionId,
        status: 'successful',
        stripeAccountId: fixture.stripeAccountId,
        stripeRefundId: 're_durable_1',
        stripeRefundStatus: 'succeeded',
      }),
    );
  }, 30_000);

  it('atomically requeues one terminal refund generation and rejects its late archived webhook', async () => {
    const fixture = await seedFixture(database, 4_000_000_000);
    fixtures.push(fixture);
    const stripePaymentIntentId = `pi_${fixture.transactionId}`;
    await database
      .update(transactions)
      .set({ status: 'successful', stripePaymentIntentId })
      .where(eq(transactions.id, fixture.transactionId));
    const refundClaim = await Effect.runPromise(
      Database.use((effectDatabase) =>
        createRegistrationRefundClaim(effectDatabase, {
          amount: 1000,
          applicationFeeRefunded: true,
          currency: 'EUR',
          eventId: fixture.eventId,
          eventRegistrationId: fixture.registrationId,
          executiveUserId: fixture.userId,
          operationKey: `test-refund:${fixture.transactionId}`,
          sourceTransactionId: fixture.transactionId,
          stripeAccountId: fixture.stripeAccountId,
          targetUserId: fixture.userId,
          tenantId: fixture.tenantId,
        }),
      ).pipe(Effect.provide(makeDatabaseServiceLayer(databaseUrl))),
    );
    const archivedRefundId = `re_failed_${fixture.transactionId}`;
    await database
      .update(transactions)
      .set({
        stripeRefundAttempts: 8,
        stripeRefundId: archivedRefundId,
        stripeRefundNextAttemptAt: null,
        stripeRefundStatus: 'failed',
      })
      .where(eq(transactions.id, refundClaim.id));

    const runRequeue = () =>
      Effect.runPromise(
        Database.use((effectDatabase) =>
          effectDatabase.transaction((tx) =>
            requeueRegistrationRefundClaim(tx, {
              reason: 'Operator confirmed terminal Stripe failure',
              refundClaimId: refundClaim.id,
              tenantId: fixture.tenantId,
            }),
          ),
        ).pipe(
          Effect.result,
          Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
        ),
      );
    const outcomes = await Promise.all([runRequeue(), runRequeue()]);
    expect(
      outcomes
        .map((outcome) =>
          Result.isSuccess(outcome) ? outcome.success.mode : 'rejected',
        )
        .toSorted(),
    ).toEqual(['newGeneration', 'rejected']);

    const requeued = await database.query.transactions.findFirst({
      where: { id: refundClaim.id },
    });
    expect(requeued).toEqual(
      expect.objectContaining({
        stripeRefundAttempts: 0,
        stripeRefundGeneration: 1,
        stripeRefundId: null,
        stripeRefundStatus: null,
      }),
    );
    expect(requeued?.stripeRefundHistory).toEqual([
      expect.objectContaining({
        generation: 0,
        refundId: archivedRefundId,
        status: 'failed',
      }),
    ]);

    const lateWebhook = await Effect.runPromise(
      reconcileRegistrationRefundWebhook(
        {
          amount: 1000,
          charge: null,
          currency: 'eur',
          id: archivedRefundId,
          metadata: {
            refundClaimId: refundClaim.id,
            refundGeneration: '0',
            registrationId: fixture.registrationId,
            sourceTransactionId: fixture.transactionId,
            tenantId: fixture.tenantId,
          },
          object: 'refund',
          payment_intent: stripePaymentIntentId,
          status: 'failed',
        } as Stripe.Refund,
        fixture.stripeAccountId,
      ).pipe(Effect.provide(makeDatabaseServiceLayer(databaseUrl))),
    );
    expect(lateWebhook).toEqual({ status: 'rejected' });
    const afterLateWebhook = await database.query.transactions.findFirst({
      where: { id: refundClaim.id },
    });
    expect(afterLateWebhook).toEqual(
      expect.objectContaining({
        stripeRefundGeneration: 1,
        stripeRefundId: null,
        stripeRefundStatus: null,
      }),
    );
  }, 30_000);
});
