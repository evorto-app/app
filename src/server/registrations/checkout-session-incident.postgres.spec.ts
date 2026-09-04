import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer, Result } from 'effect';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { databaseLayer } from '../../db/database.layer';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import {
  eventInstances,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  type RegistrationCheckoutSnapshot,
  tenants,
  transactions,
  users,
  usersToTenants,
} from '../../db/schema';
import {
  type CheckoutSessionIncidentInput,
  checkoutSessionIncidentLastError,
  recordCheckoutSessionIncident,
} from './checkout-session-incident';
import { cancelExpiredUnboundRegistrationClaim } from './expired-checkout-cleanup';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

interface Fixture {
  readonly categoryId: string;
  readonly eventId: string;
  readonly membershipId: string;
  readonly optionId: string;
  readonly registrationId: string;
  readonly templateId: string;
  readonly tenantId: string;
  readonly transactionIds: string[];
  readonly userId: string;
}

type TestDatabase = NodePgDatabase<typeof relations>;

const makeFixture = (): Fixture => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6);
  return {
    categoryId: `ic-${suffix}`,
    eventId: `ie-${suffix}`,
    membershipId: `im-${suffix}`,
    optionId: `io-${suffix}`,
    registrationId: `ir-${suffix}`,
    templateId: `it-${suffix}`,
    tenantId: `in-${suffix}`,
    transactionIds: [],
    userId: `iu-${suffix}`,
  };
};

const request = {
  customerEmail: 'incident@example.com',
  eventTitle: 'Incident fixture',
  eventUrl: 'https://incident.example/events/event',
  expiresAt: 1_900_000_000,
  lineItems: [
    {
      kind: 'registration',
      name: 'Registration',
      quantity: 1,
      unitAmount: 1000,
    },
  ],
  notificationEmail: 'incident@example.com',
} as const satisfies RegistrationCheckoutSnapshot;

const makeDatabaseServiceLayer = (url: string) =>
  databaseLayer.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: Object.fromEntries([
            ['DATABASE_URL', url],
            ['DATABASE_TLS_REQUIRED', 'false'],
          ]),
        }),
      ),
    ),
  );

const seedFixture = async (database: TestDatabase, fixture: Fixture) => {
  const now = Date.now();
  await database.insert(tenants).values({
    domain: `${fixture.tenantId}.incident.example`,
    id: fixture.tenantId,
    name: 'Incident tenant',
  });
  await database.insert(users).values({
    auth0Id: `incident|${fixture.userId}`,
    communicationEmail: 'incident@example.com',
    email: 'incident@example.com',
    firstName: 'Incident',
    id: fixture.userId,
    lastName: 'Tester',
  });
  await database.insert(usersToTenants).values({
    id: fixture.membershipId,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
  });
  await database.insert(eventTemplateCategories).values({
    icon: { iconColor: 0, iconName: 'circle' },
    id: fixture.categoryId,
    tenantId: fixture.tenantId,
    title: 'Incident category',
  });
  await database.insert(eventTemplates).values({
    categoryId: fixture.categoryId,
    description: 'Incident fixture',
    icon: { iconColor: 0, iconName: 'circle' },
    id: fixture.templateId,
    tenantId: fixture.tenantId,
    title: 'Incident template',
  });
  await database.insert(eventInstances).values({
    creatorId: fixture.userId,
    description: 'Incident fixture',
    end: new Date(now + 86_400_000),
    icon: { iconColor: 0, iconName: 'circle' },
    id: fixture.eventId,
    start: new Date(now + 43_200_000),
    templateId: fixture.templateId,
    tenantId: fixture.tenantId,
    title: 'Incident event',
  });
  await database.insert(eventRegistrationOptions).values({
    closeRegistrationTime: new Date(now + 21_600_000),
    eventId: fixture.eventId,
    id: fixture.optionId,
    isPaid: true,
    openRegistrationTime: new Date(now - 3_600_000),
    organizingRegistration: false,
    price: 1000,
    registrationMode: 'fcfs',
    reservedSpots: 1,
    spots: 10,
    title: 'Incident option',
  });
  await database.insert(eventRegistrations).values({
    eventId: fixture.eventId,
    id: fixture.registrationId,
    registrationOptionId: fixture.optionId,
    status: 'PENDING',
    tenantId: fixture.tenantId,
    userId: fixture.userId,
  });
};

const cleanupFixture = async (database: TestDatabase, fixture: Fixture) => {
  if (fixture.transactionIds.length > 0) {
    await database
      .delete(transactions)
      .where(inArray(transactions.id, fixture.transactionIds));
  }
  await database
    .delete(eventRegistrations)
    .where(eq(eventRegistrations.id, fixture.registrationId));
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
    .where(eq(usersToTenants.id, fixture.membershipId));
  await database.delete(users).where(eq(users.id, fixture.userId));
  await database.delete(tenants).where(eq(tenants.id, fixture.tenantId));
};

const transactionValues = (
  fixture: Fixture,
  id: string,
  overrides: Partial<typeof transactions.$inferInsert> = {},
) => ({
  amount: 1000,
  appFee: 0,
  currency: 'EUR' as const,
  eventId: fixture.eventId,
  eventRegistrationId: fixture.registrationId,
  id,
  method: 'stripe' as const,
  status: 'successful' as const,
  stripeAccountId: 'acct_incident',
  stripeCheckoutRequest: request,
  targetUserId: fixture.userId,
  tenantId: fixture.tenantId,
  type: 'registration' as const,
  ...overrides,
});

const incidentInput = (
  fixture: Fixture,
  transactionId: string,
  overrides: Partial<CheckoutSessionIncidentInput> = {},
): CheckoutSessionIncidentInput => ({
  amount: 1000,
  appFee: 0,
  currency: 'EUR',
  eventId: fixture.eventId,
  method: 'stripe',
  operation: 'test.record',
  registrationId: fixture.registrationId,
  stripeAccountId: 'acct_incident',
  stripeCheckoutRequest: request,
  stripeCheckoutSessionId: `cs_${transactionId}`,
  targetUserId: fixture.userId,
  tenantId: fixture.tenantId,
  transactionId,
  type: 'registration',
  ...overrides,
});

describe('Checkout session incident persistence', () => {
  let database: TestDatabase;
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('accepts a canonical session without a URL and enforces one cross-column session namespace', async () => {
    const fixture = makeFixture();
    await seedFixture(database, fixture);
    const canonicalId = `ct-${fixture.tenantId}`;
    const incidentId = `ii-${fixture.tenantId}`;
    fixture.transactionIds.push(
      canonicalId,
      incidentId,
      `ci-${fixture.tenantId}`,
      `ic-${fixture.tenantId}`,
    );
    try {
      await database.insert(transactions).values(
        transactionValues(fixture, canonicalId, {
          stripeCheckoutSessionId: 'cs_canonical_shared',
          stripeCheckoutUrl: null,
        }),
      );
      await database.insert(transactions).values(
        transactionValues(fixture, incidentId, {
          status: 'cancelled',
          stripeCheckoutIncidentSessionId: 'cs_incident_shared',
          stripeCheckoutReconcileLastError: checkoutSessionIncidentLastError,
        }),
      );

      await expect(
        database.insert(transactions).values(
          transactionValues(fixture, `ci-${fixture.tenantId}`, {
            stripeCheckoutIncidentSessionId: 'cs_canonical_shared',
            stripeCheckoutReconcileLastError: checkoutSessionIncidentLastError,
          }),
        ),
      ).rejects.toThrow();
      await expect(
        database.insert(transactions).values(
          transactionValues(fixture, `ic-${fixture.tenantId}`, {
            stripeCheckoutSessionId: 'cs_incident_shared',
            stripeCheckoutUrl: null,
          }),
        ),
      ).rejects.toThrow();
    } finally {
      await cleanupFixture(database, fixture);
    }
  });

  it('rejects incomplete or contradictory incident evidence while allowing any business status', async () => {
    const fixture = makeFixture();
    await seedFixture(database, fixture);
    const validId = `iv-${fixture.tenantId}`;
    const incompleteId = `ix-${fixture.tenantId}`;
    const contradictoryId = `iy-${fixture.tenantId}`;
    fixture.transactionIds.push(validId, incompleteId, contradictoryId);
    try {
      await database.insert(transactions).values(
        transactionValues(fixture, validId, {
          status: 'cancelled',
          stripeCheckoutIncidentSessionId: `cs_${validId}`,
          stripeCheckoutReconcileLastError: checkoutSessionIncidentLastError,
        }),
      );
      await expect(
        database.insert(transactions).values(
          transactionValues(fixture, incompleteId, {
            appFee: null,
            stripeCheckoutIncidentSessionId: `cs_${incompleteId}`,
            stripeCheckoutReconcileLastError: checkoutSessionIncidentLastError,
          }),
        ),
      ).rejects.toThrow();
      await expect(
        database.insert(transactions).values(
          transactionValues(fixture, contradictoryId, {
            stripeCheckoutIncidentSessionId: `cs_${contradictoryId}`,
            stripeCheckoutReconcileLastError: checkoutSessionIncidentLastError,
            stripeCheckoutSessionId: `cs_bound_${contradictoryId}`,
          }),
        ),
      ).rejects.toThrow();
    } finally {
      await cleanupFixture(database, fixture);
    }
  });

  it('records by an exact immutable tuple despite a concurrent status change and leaves business state untouched', async () => {
    const fixture = makeFixture();
    await seedFixture(database, fixture);
    const transactionId = `is-${fixture.tenantId}`;
    fixture.transactionIds.push(transactionId);
    try {
      await database.insert(transactions).values(
        transactionValues(fixture, transactionId, {
          status: 'pending',
          stripeCheckoutReconcileLeaseExpiresAt: new Date(Date.now() + 60_000),
          stripeCheckoutReconcileLeaseId: 'lease-before-incident',
          stripeCheckoutReconcileNextAt: new Date(Date.now() + 120_000),
        }),
      );

      const layer = makeDatabaseServiceLayer(databaseUrl);
      await Promise.all([
        database
          .update(transactions)
          .set({ status: 'successful' })
          .where(eq(transactions.id, transactionId)),
        Effect.runPromise(
          recordCheckoutSessionIncident(
            incidentInput(fixture, transactionId),
          ).pipe(Effect.provide(layer)),
        ),
      ]);

      const [transaction, registration, option] = await Promise.all([
        database.query.transactions.findFirst({ where: { id: transactionId } }),
        database.query.eventRegistrations.findFirst({
          where: { id: fixture.registrationId },
        }),
        database.query.eventRegistrationOptions.findFirst({
          where: { id: fixture.optionId },
        }),
      ]);
      expect(transaction).toEqual(
        expect.objectContaining({
          status: 'successful',
          stripeCheckoutIncidentSessionId: `cs_${transactionId}`,
          stripeCheckoutReconcileLastError: checkoutSessionIncidentLastError,
          stripeCheckoutReconcileLeaseExpiresAt: null,
          stripeCheckoutReconcileLeaseId: null,
          stripeCheckoutReconcileNextAt: null,
        }),
      );
      expect(registration?.status).toBe('PENDING');
      expect(option).toEqual(
        expect.objectContaining({ confirmedSpots: 0, reservedSpots: 1 }),
      );
    } finally {
      await cleanupFixture(database, fixture);
    }
  });

  it('rejects every immutable tuple mismatch and an already changed binding identity', async () => {
    const fixture = makeFixture();
    await seedFixture(database, fixture);
    const transactionId = `im-${fixture.tenantId}`;
    fixture.transactionIds.push(transactionId);
    try {
      await database
        .insert(transactions)
        .values(transactionValues(fixture, transactionId));
      const mismatches: readonly Partial<CheckoutSessionIncidentInput>[] = [
        { amount: 999 },
        { appFee: 1 },
        { currency: 'CZK' },
        { eventId: 'different-event' },
        { registrationId: 'different-reg' },
        { stripeAccountId: 'acct_different' },
        { stripeCheckoutRequest: { ...request, expiresAt: 1_900_000_001 } },
        { targetUserId: 'different-user' },
        { tenantId: 'different-tenant' },
        { transactionId: 'different-tx' },
        { type: 'addon' },
      ];
      const layer = makeDatabaseServiceLayer(databaseUrl);
      for (const mismatch of mismatches) {
        const result = await Effect.runPromise(
          Effect.result(
            recordCheckoutSessionIncident(
              incidentInput(fixture, transactionId, mismatch),
            ),
          ).pipe(Effect.provide(layer)),
        );
        expect(Result.isFailure(result)).toBe(true);
      }

      await database
        .update(transactions)
        .set({
          stripeCheckoutSessionId: 'cs_already_bound',
          stripeCheckoutUrl: null,
        })
        .where(eq(transactions.id, transactionId));
      const changedIdentity = await Effect.runPromise(
        Effect.result(
          recordCheckoutSessionIncident(incidentInput(fixture, transactionId)),
        ).pipe(Effect.provide(layer)),
      );
      expect(Result.isFailure(changedIdentity)).toBe(true);
      expect(
        await database.query.transactions.findFirst({
          where: { id: transactionId },
        }),
      ).toEqual(
        expect.objectContaining({
          stripeCheckoutIncidentSessionId: null,
          stripeCheckoutSessionId: 'cs_already_bound',
        }),
      );
    } finally {
      await cleanupFixture(database, fixture);
    }
  });
  it('retains expired unbound incident claims and their reserved capacity', async () => {
    const fixture = makeFixture();
    await seedFixture(database, fixture);
    const transactionId = `ip-${fixture.tenantId}`;
    fixture.transactionIds.push(transactionId);
    const now = Math.floor(Date.now() / 1000);
    const expiredRequest = { ...request, expiresAt: now - 60 };
    try {
      await database.insert(transactions).values(
        transactionValues(fixture, transactionId, {
          status: 'pending',
          stripeCheckoutRequest: expiredRequest,
        }),
      );
      const layer = makeDatabaseServiceLayer(databaseUrl);
      await Effect.runPromise(
        recordCheckoutSessionIncident(
          incidentInput(fixture, transactionId, {
            stripeCheckoutRequest: expiredRequest,
          }),
        ).pipe(Effect.provide(layer)),
      );
      const outcome = await Effect.runPromise(
        cancelExpiredUnboundRegistrationClaim(
          {
            registrationId: fixture.registrationId,
            tenantId: fixture.tenantId,
            transactionId,
          },
          now,
        ).pipe(Effect.provide(layer)),
      );
      expect(outcome).toBe('skipped');
      const registration = await database.query.eventRegistrations.findFirst({
        where: { id: fixture.registrationId },
      });
      const option = await database.query.eventRegistrationOptions.findFirst({
        where: { id: fixture.optionId },
      });
      expect(registration?.status).toBe('PENDING');
      expect(option?.reservedSpots).toBe(1);
    } finally {
      await cleanupFixture(database, fixture);
    }
  });
});
