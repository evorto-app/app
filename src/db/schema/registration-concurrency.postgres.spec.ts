import type Stripe from 'stripe';

import { afterAll, beforeAll, describe, expect, it, vi } from '@effect/vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

import { EventRegistrationService } from '../../server/effect/rpc/handlers/events/event-registration.service';
import { eventRegistrationHandlers } from '../../server/effect/rpc/handlers/events/events-registration.handlers';
import { RpcAccess } from '../../server/effect/rpc/handlers/shared/rpc-access.service';
import { StripeClient } from '../../server/stripe-client';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../shared/rpc-contracts/app-rpcs';
import { databaseLayer } from '../database.layer';
import { createNodePgPoolConfig } from '../pg-connection-config';
import { relations } from '../relations';
import {
  addonToEventRegistrationOptions,
  emailOutbox,
  eventAddons,
  eventInstances,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  tenants,
  transactions,
  users,
  usersToTenants,
} from './index';

const databaseUrl = process.env['DATABASE_URL'];
const neonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';
const describeWithPostgres = databaseUrl ? describe : describe.skip;

interface Fixture {
  addOnId: string;
  categoryId: string;
  eventId: string;
  optionId: string;
  registrationId?: string;
  templateId: string;
  tenantId: string;
  userId: string;
}

interface ServiceOutcome {
  error?: { readonly _tag?: string; readonly message?: string };
  status: 'failure' | 'success';
}

type TestDatabase = NodePgDatabase<typeof relations>;

const makeId = (prefix: string, suffix: string) =>
  `${prefix}-${suffix}`.slice(0, 20);

const tenantDomainForFixture = (fixture: Fixture): string =>
  `${fixture.tenantId.replace(/^tenant-/, '')}.concurrency.example`;

const waitFor = async (
  predicate: () => Promise<boolean>,
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

const waitForBlockedQueries = (
  pool: Pool,
  queryFragment: string,
  minimumCount: number,
) =>
  waitFor(async () => {
    const blocked = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE $1
      `,
      [`%${queryFragment}%`],
    );
    return Number(blocked.rows[0]?.count ?? 0) >= minimumCount;
  }, `Timed out waiting for ${minimumCount} blocked ${queryFragment} queries`);

const withRowLock = async (
  pool: Pool,
  lock: (client: PoolClient) => Promise<void>,
) => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    await lock(client);
    return client;
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }
};

const makeConfigLayer = (url: string) =>
  ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: Object.fromEntries([
        ['BASE_URL', 'https://concurrency.example'],
        ['CLIENT_ID', 'client-id'],
        ['CLIENT_SECRET', 'client-secret'],
        ['DATABASE_URL', url],
        ['ISSUER_BASE_URL', 'https://issuer.example'],
        ['NEON_LOCAL_PROXY', String(neonLocalProxy)],
        ['RESEND_API_KEY', 're_test_concurrency'],
        ['SECRET', 'test-secret'],
      ]),
    }),
  );

const makeServiceLayer = (url: string, stripe: Stripe) => {
  const configLayer = makeConfigLayer(url);
  return Layer.mergeAll(
    configLayer,
    databaseLayer.pipe(Layer.provide(configLayer)),
    Layer.succeed(StripeClient, stripe),
  );
};

const runService = (
  effect: Effect.Effect<
    void,
    { readonly _tag?: string; readonly message?: string },
    EventRegistrationService
  >,
  serviceLayer: Layer.Layer<
    | ConfigProvider.ConfigProvider
    | import('../database.layer').Database
    | StripeClient
  >,
): Promise<ServiceOutcome> =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onFailure: (error) => ({ error, status: 'failure' as const }),
        onSuccess: () => ({ status: 'success' as const }),
      }),
      Effect.provide(EventRegistrationService.Default),
      Effect.provide(serviceLayer),
    ),
  );

const runCancellation = ({
  fixture,
  serviceLayer,
}: {
  fixture: Fixture & { registrationId: string };
  serviceLayer: ReturnType<typeof makeServiceLayer>;
}): Promise<ServiceOutcome> => {
  const permissions = [] as const;
  const requestContext = {
    authData: {},
    authenticated: true,
    permissions,
    tenant: {
      canonicalRootUrl: `https://${tenantDomainForFixture(fixture)}`,
      currency: 'EUR',
      defaultLocation: null,
      discountProviders: {
        esnCard: {
          config: {},
          status: 'disabled',
        },
      },
      domain: tenantDomainForFixture(fixture),
      id: fixture.tenantId,
      locale: 'en',
      name: 'Concurrency test',
      receiptSettings: {
        allowOther: false,
        receiptCountries: ['DE'],
      },
      stripeAccountId: `acct_${fixture.tenantId.replace('tenant-', '')}`,
      theme: 'evorto',
      timezone: 'Europe/Amsterdam',
    },
    user: {
      attributes: [],
      auth0Id: `auth0|${fixture.userId}`,
      email: `${fixture.userId}@example.com`,
      firstName: 'Concurrent',
      iban: null,
      id: fixture.userId,
      lastName: 'Tester',
      paypalEmail: null,
      permissions,
      roleIds: [],
    },
    userAssigned: true,
  } satisfies RpcRequestContextShape;

  return Effect.runPromise(
    eventRegistrationHandlers['events.cancelRegistration'](
      { registrationId: fixture.registrationId },
      { headers: Headers.empty },
    ).pipe(
      Effect.match({
        onFailure: (error) => ({ error, status: 'failure' as const }),
        onSuccess: () => ({ status: 'success' as const }),
      }),
      Effect.provide(
        Layer.mergeAll(
          serviceLayer,
          RpcAccess.Default,
          Layer.succeed(RpcRequestContext, requestContext),
        ),
      ),
    ),
  );
};

const seedFixture = async (
  database: TestDatabase,
  {
    mode,
    paid,
    withPendingRegistration,
  }: {
    mode: 'application' | 'fcfs';
    paid: boolean;
    withPendingRegistration: boolean;
  },
): Promise<Fixture> => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  const tenantId = makeId('tenant', suffix);
  const userId = makeId('user', suffix);
  const categoryId = makeId('category', suffix);
  const templateId = makeId('template', suffix);
  const eventId = makeId('event', suffix);
  const optionId = makeId('option', suffix);
  const addOnId = makeId('addon', suffix);
  const registrationId = withPendingRegistration
    ? makeId('reg', suffix)
    : undefined;
  const now = Date.now();

  await database.insert(tenants).values({
    canonicalRootUrl: `https://${suffix}.concurrency.example`,
    domain: `${suffix}.concurrency.example`,
    id: tenantId,
    name: `Concurrency ${suffix}`,
    stripeAccountId: paid ? `acct_${suffix}` : null,
  });
  await database.insert(users).values({
    auth0Id: `auth0|${suffix}`,
    communicationEmail: `${suffix}@example.com`,
    email: `${suffix}@example.com`,
    firstName: 'Concurrent',
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
    title: 'Concurrency tests',
  });
  await database.insert(eventTemplates).values({
    categoryId,
    description: 'Concurrency fixture template',
    icon: { iconColor: 0, iconName: 'circle' },
    id: templateId,
    tenantId,
    title: 'Concurrency fixture',
  });
  await database.insert(eventInstances).values({
    creatorId: userId,
    description: 'Concurrency fixture event',
    end: new Date(now + 8 * 24 * 60 * 60 * 1000),
    icon: { iconColor: 0, iconName: 'circle' },
    id: eventId,
    start: new Date(now + 7 * 24 * 60 * 60 * 1000),
    status: 'APPROVED',
    templateId,
    tenantId,
    title: 'Concurrency fixture',
  });
  await database.insert(eventRegistrationOptions).values({
    closeRegistrationTime: new Date(now + 6 * 24 * 60 * 60 * 1000),
    eventId,
    id: optionId,
    isPaid: paid,
    openRegistrationTime: new Date(now - 24 * 60 * 60 * 1000),
    organizingRegistration: false,
    price: paid ? 1000 : 0,
    registrationMode: mode,
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
    title: 'Concurrency add-on',
    totalAvailableQuantity: 5,
  });
  await database.insert(addonToEventRegistrationOptions).values({
    addonId: addOnId,
    quantity: 2,
    registrationOptionId: optionId,
  });

  if (registrationId) {
    await database.insert(eventRegistrations).values({
      eventId,
      id: registrationId,
      registrationOptionId: optionId,
      status: 'PENDING',
      tenantId,
      userId,
    });
    await database.insert(eventRegistrationAddonPurchases).values({
      addonId: addOnId,
      quantity: 2,
      registrationId,
      unitPrice: 0,
    });
  }

  return {
    addOnId,
    categoryId,
    eventId,
    optionId,
    registrationId,
    templateId,
    tenantId,
    userId,
  };
};

const cleanFixture = async (database: TestDatabase, fixture: Fixture) => {
  await database
    .delete(emailOutbox)
    .where(eq(emailOutbox.tenantId, fixture.tenantId));
  await database
    .delete(transactions)
    .where(eq(transactions.tenantId, fixture.tenantId));
  await database
    .delete(eventRegistrationAddonPurchases)
    .where(eq(eventRegistrationAddonPurchases.addonId, fixture.addOnId));
  await database
    .delete(eventRegistrations)
    .where(eq(eventRegistrations.tenantId, fixture.tenantId));
  await database
    .delete(addonToEventRegistrationOptions)
    .where(eq(addonToEventRegistrationOptions.addonId, fixture.addOnId));
  await database.delete(eventAddons).where(eq(eventAddons.id, fixture.addOnId));
  await database
    .delete(eventRegistrationOptions)
    .where(eq(eventRegistrationOptions.eventId, fixture.eventId));
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

describeWithPostgres('registration service concurrency invariants', () => {
  let database: TestDatabase;
  const fixtures: Fixture[] = [];
  let pool: Pool;

  beforeAll(() => {
    if (!databaseUrl) {
      return;
    }
    pool = new Pool(createNodePgPoolConfig({ databaseUrl, neonLocalProxy }));
    database = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
    if (!databaseUrl) {
      return;
    }
    for (const fixture of fixtures.toReversed()) {
      await cleanFixture(database, fixture);
    }
    await pool.end();
  });

  it('serializes duplicate registration through the tenant membership and preserves capacity and add-on stock', async () => {
    if (!databaseUrl) {
      return;
    }
    const fixture = await seedFixture(database, {
      mode: 'fcfs',
      paid: false,
      withPendingRegistration: false,
    });
    fixtures.push(fixture);
    const stripe = {} as Stripe;
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);
    const membershipLock = await withRowLock(pool, async (client) => {
      await client.query(
        `
          SELECT id
          FROM users_to_tenants
          WHERE "tenantId" = $1 AND "userId" = $2
          FOR UPDATE
        `,
        [fixture.tenantId, fixture.userId],
      );
    });

    try {
      const register = () =>
        runService(
          EventRegistrationService.registerForEvent({
            addOns: [{ addOnId: fixture.addOnId, quantity: 1 }],
            eventId: fixture.eventId,
            guestCount: 0,
            registrationOptionId: fixture.optionId,
            tenant: {
              canonicalRootUrl: `https://${tenantDomainForFixture(fixture)}`,
              currency: 'EUR',
              domain: tenantDomainForFixture(fixture),
              id: fixture.tenantId,
              stripeAccountId: null,
            },
            user: {
              email: `${fixture.userId}@example.com`,
              id: fixture.userId,
              roleIds: [],
            },
          }),
          serviceLayer,
        );
      const first = register();
      const second = register();

      await waitForBlockedQueries(pool, 'users_to_tenants', 2);
      await membershipLock.query('COMMIT');

      const outcomes = await Promise.all([first, second]);
      expect(
        outcomes.filter((outcome) => outcome.status === 'success'),
      ).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => outcome.status === 'failure'),
      ).toEqual([
        expect.objectContaining({
          error: expect.objectContaining({
            _tag: 'EventRegistrationConflictError',
            message: 'User is already registered for this event',
          }),
        }),
      ]);

      const activeRegistrations =
        await database.query.eventRegistrations.findMany({
          where: {
            eventId: fixture.eventId,
            status: { NOT: 'CANCELLED' },
            tenantId: fixture.tenantId,
            userId: fixture.userId,
          },
        });
      const option = await database.query.eventRegistrationOptions.findFirst({
        where: { id: fixture.optionId },
      });
      const addOn = await database.query.eventAddons.findFirst({
        where: { id: fixture.addOnId },
      });
      const purchases = activeRegistrations[0]
        ? await database.query.eventRegistrationAddonPurchases.findMany({
            where: { registrationId: activeRegistrations[0].id },
          })
        : [];

      expect(activeRegistrations).toHaveLength(1);
      expect(option?.confirmedSpots).toBe(1);
      expect(option?.reservedSpots).toBe(0);
      expect(addOn?.totalAvailableQuantity).toBe(3);
      expect(purchases).toEqual([
        expect.objectContaining({ quantity: 2, unitPrice: 0 }),
      ]);
    } finally {
      if (!membershipLock.released) {
        await membershipLock.query('ROLLBACK').catch(() => null);
      }
      membershipLock.release();
    }
  }, 30_000);

  it('serializes duplicate paid approval into one pending claim, one reservation, and one Stripe binding', async () => {
    if (!databaseUrl) {
      return;
    }
    const fixture = await seedFixture(database, {
      mode: 'application',
      paid: true,
      withPendingRegistration: true,
    });
    fixtures.push(fixture);
    if (!fixture.registrationId) {
      throw new Error('Expected pending registration fixture');
    }

    const { promise: stripeGate, resolve: releaseStripe } =
      Promise.withResolvers<boolean>();
    const registrationId = fixture.registrationId;
    const createSession = vi.fn(async () => {
      await stripeGate;
      return {
        id: `cs_${fixture.registrationId}`,
        payment_intent: `pi_${fixture.registrationId}`,
        url: `https://checkout.example/${fixture.registrationId}`,
      } as Stripe.Checkout.Session;
    });
    const stripe = {
      checkout: {
        sessions: {
          create: createSession,
        },
      },
    } as unknown as Stripe;
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);
    const registrationLock = await withRowLock(pool, async (client) => {
      await client.query(
        `SELECT id FROM event_registrations WHERE id = $1 FOR UPDATE`,
        [fixture.registrationId],
      );
    });

    try {
      const approve = () =>
        runService(
          EventRegistrationService.approveManualRegistration({
            eventId: fixture.eventId,
            registrationId,
            tenant: {
              canonicalRootUrl: `https://${tenantDomainForFixture(fixture)}`,
              currency: 'EUR',
              domain: tenantDomainForFixture(fixture),
              emailSenderEmail: null,
              emailSenderName: null,
              id: fixture.tenantId,
              name: 'Concurrency test',
              stripeAccountId: `acct_${fixture.tenantId.replace('tenant-', '')}`,
            },
            user: { id: fixture.userId },
          }),
          serviceLayer,
        );
      const first = approve();
      const second = approve();

      await waitForBlockedQueries(pool, 'event_registrations', 2);
      await registrationLock.query('COMMIT');
      await waitFor(
        async () => createSession.mock.calls.length === 1,
        'Timed out waiting for the winning Stripe request',
      );
      releaseStripe(true);

      const outcomes = await Promise.all([first, second]);
      expect(
        outcomes.filter((outcome) => outcome.status === 'success'),
      ).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => outcome.status === 'failure'),
      ).toEqual([
        expect.objectContaining({
          error: expect.objectContaining({
            _tag: 'EventRegistrationConflictError',
            message: 'Registration is already awaiting payment',
          }),
        }),
      ]);
      expect(createSession).toHaveBeenCalledTimes(1);

      const pendingClaims = await database.query.transactions.findMany({
        where: {
          eventRegistrationId: fixture.registrationId,
          status: 'pending',
          tenantId: fixture.tenantId,
          type: 'registration',
        },
      });
      const option = await database.query.eventRegistrationOptions.findFirst({
        where: { id: fixture.optionId },
      });
      const addOn = await database.query.eventAddons.findFirst({
        where: { id: fixture.addOnId },
      });
      const emails = await database.query.emailOutbox.findMany({
        where: { tenantId: fixture.tenantId },
      });

      expect(pendingClaims).toEqual([
        expect.objectContaining({
          amount: 1000,
          stripeCheckoutSessionId: `cs_${fixture.registrationId}`,
        }),
      ]);
      expect(option?.reservedSpots).toBe(1);
      expect(option?.confirmedSpots).toBe(0);
      expect(addOn?.totalAvailableQuantity).toBe(3);
      expect(emails).toHaveLength(1);
    } finally {
      releaseStripe(true);
      if (!registrationLock.released) {
        await registrationLock.query('ROLLBACK').catch(() => null);
      }
      registrationLock.release();
    }
  }, 30_000);

  it('cancellation re-reads a concurrent approval claim and prevents a checkout from binding to the cancelled registration', async () => {
    if (!databaseUrl) {
      return;
    }
    const fixture = await seedFixture(database, {
      mode: 'application',
      paid: true,
      withPendingRegistration: true,
    });
    fixtures.push(fixture);
    if (!fixture.registrationId) {
      throw new Error('Expected pending registration fixture');
    }
    const registrationId = fixture.registrationId;
    const fixtureWithRegistration = { ...fixture, registrationId };
    const { promise: stripeGate, resolve: releaseStripe } =
      Promise.withResolvers<boolean>();
    const createSession = vi.fn(async () => {
      await stripeGate;
      return {
        id: `cs_${registrationId}`,
        payment_intent: `pi_${registrationId}`,
        url: `https://checkout.example/${registrationId}`,
      } as Stripe.Checkout.Session;
    });
    const expireSession = vi.fn(async () => ({
      id: `cs_${registrationId}`,
      status: 'expired',
    }));
    const stripe = {
      checkout: {
        sessions: {
          create: createSession,
          expire: expireSession,
        },
      },
      refunds: {
        create: vi.fn(),
      },
    } as unknown as Stripe;
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);
    const registrationLock = await withRowLock(pool, async (client) => {
      await client.query(
        `SELECT id FROM event_registrations WHERE id = $1 FOR UPDATE`,
        [registrationId],
      );
    });

    try {
      const approval = runService(
        EventRegistrationService.approveManualRegistration({
          eventId: fixture.eventId,
          registrationId,
          tenant: {
            canonicalRootUrl: `https://${tenantDomainForFixture(fixture)}`,
            currency: 'EUR',
            domain: tenantDomainForFixture(fixture),
            emailSenderEmail: null,
            emailSenderName: null,
            id: fixture.tenantId,
            name: 'Concurrency test',
            stripeAccountId: `acct_${fixture.tenantId.replace('tenant-', '')}`,
          },
          user: { id: fixture.userId },
        }),
        serviceLayer,
      );
      await waitForBlockedQueries(pool, 'event_registrations', 1);

      const cancellation = runCancellation({
        fixture: fixtureWithRegistration,
        serviceLayer,
      });
      await waitForBlockedQueries(pool, 'event_registrations', 2);
      await registrationLock.query('COMMIT');

      const cancellationOutcome = await cancellation;
      expect(cancellationOutcome).toEqual({ status: 'success' });
      await waitFor(
        async () => createSession.mock.calls.length === 1,
        'Timed out waiting for Stripe checkout creation',
      );
      releaseStripe(true);

      const approvalOutcome = await approval;
      expect(approvalOutcome).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({
            _tag: 'EventRegistrationConflictError',
            message: 'Registration is no longer awaiting payment',
          }),
          status: 'failure',
        }),
      );
      expect(expireSession).toHaveBeenCalledTimes(1);

      const currentRegistration =
        await database.query.eventRegistrations.findFirst({
          where: { id: registrationId, tenantId: fixture.tenantId },
        });
      const claims = await database.query.transactions.findMany({
        where: {
          eventRegistrationId: registrationId,
          tenantId: fixture.tenantId,
          type: 'registration',
        },
      });
      const option = await database.query.eventRegistrationOptions.findFirst({
        where: { id: fixture.optionId },
      });
      const addOn = await database.query.eventAddons.findFirst({
        where: { id: fixture.addOnId },
      });
      const emails = await database.query.emailOutbox.findMany({
        where: { tenantId: fixture.tenantId },
      });

      expect(currentRegistration?.status).toBe('CANCELLED');
      expect(claims).toEqual([
        expect.objectContaining({
          status: 'cancelled',
          stripeCheckoutSessionId: null,
        }),
      ]);
      expect(option?.reservedSpots).toBe(0);
      expect(option?.confirmedSpots).toBe(0);
      expect(addOn?.totalAvailableQuantity).toBe(5);
      expect(emails).toHaveLength(0);
    } finally {
      releaseStripe(true);
      if (!registrationLock.released) {
        await registrationLock.query('ROLLBACK').catch(() => null);
      }
      registrationLock.release();
    }
  }, 30_000);
});
