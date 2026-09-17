import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import Stripe from 'stripe';

import { EventRegistrationService } from '../../server/effect/rpc/handlers/events/event-registration.service';
import { StripeClient } from '../../server/stripe-client';
import { databaseLayer } from '../database.layer';
import { createNodePgPoolConfig } from '../pg-connection-config';
import { relations } from '../relations';
import {
  emailOutbox,
  eventInstances,
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
  usersToTenants,
} from './index';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

interface LimitFixture {
  readonly categoryId: string;
  readonly domain: string;
  readonly eventIds: readonly [string, string];
  readonly membershipId: string;
  readonly optionIds: readonly [string, string];
  readonly templateId: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly userId: string;
}

type RegistrationInput = Parameters<
  typeof EventRegistrationService.registerForEvent
>[0];
type TestDatabase = NodePgDatabase<typeof relations>;

const makeId = (prefix: string, suffix: string) =>
  `${prefix}-${suffix}`.slice(0, 20);

const makeConfigLayer = (url: string) =>
  ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: Object.fromEntries([
        ['BASE_URL', 'https://limit-concurrency.example'],
        ['CLIENT_ID', 'client-id'],
        ['CLIENT_SECRET', 'client-secret'],
        ['DATABASE_TLS_REQUIRED', 'false'],
        ['DATABASE_URL', url],
        ['ISSUER_BASE_URL', 'https://issuer.example'],
        ['SECRET', 'test-secret'],
      ]),
    }),
  );

const makeStripeGuard = () => {
  let requestCount = 0;
  const client = new Stripe('sk_test_limit_concurrency', {
    httpClient: Stripe.createFetchHttpClient(async () => {
      requestCount += 1;
      throw new Error('Registration limit tests must not contact Stripe');
    }),
    maxNetworkRetries: 0,
  });
  return { client, requestCount: () => requestCount };
};

const makeServiceLayer = (
  url: string,
  stripeClient = makeStripeGuard().client,
) => {
  const configLayer = makeConfigLayer(url);
  return Layer.mergeAll(
    configLayer,
    databaseLayer.pipe(Layer.provide(configLayer)),
    Layer.succeed(StripeClient, stripeClient),
  );
};

const runRegistration = (
  input: RegistrationInput,
  serviceLayer: ReturnType<typeof makeServiceLayer>,
) =>
  Effect.runPromise(
    EventRegistrationService.registerForEvent(input).pipe(
      Effect.match({
        onFailure: (error) => ({ error, status: 'failure' as const }),
        onSuccess: () => ({ status: 'success' as const }),
      }),
      Effect.provide(EventRegistrationService.Default),
      Effect.provide(serviceLayer),
    ),
  );

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

const waitForBlockedMembershipLocks = (pool: Pool, minimumCount: number) =>
  waitFor(async () => {
    const blocked = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%users_to_tenants%'
      `,
    );
    return Number(blocked.rows[0]?.count ?? 0) >= minimumCount;
  }, `Timed out waiting for ${minimumCount} blocked membership locks`);

const lockMembership = async (pool: Pool, fixture: LimitFixture) => {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query(
      'SELECT id FROM users_to_tenants WHERE id = $1 FOR UPDATE',
      [fixture.membershipId],
    );
    return client;
  } catch (error) {
    const failures: unknown[] = [error];
    let discardClient = !transactionOpen;
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        failures.push(rollbackError);
        discardClient = true;
      }
    }
    try {
      client.release(discardClient);
    } catch (releaseError) {
      failures.push(releaseError);
    }
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        'Failed to acquire and release membership lock',
        { cause: error },
      );
    }
    throw error;
  }
};

const backendPid = async (client: PoolClient) => {
  const result = await client.query<{ pid: number }>(
    'SELECT pg_backend_pid() AS pid',
  );
  const pid = result.rows[0]?.pid;
  if (pid === undefined) throw new Error('Missing PostgreSQL backend PID');
  return pid;
};

const waitForBlockedQuery = async (
  pool: Pool,
  blockerPid: number,
  table: 'tenants' | 'users_to_tenants',
) => {
  let blockedPid: number | undefined;
  await waitFor(async () => {
    const blocked = await pool.query<{ pid: number }>(
      `
        SELECT pid
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND $1 = ANY(pg_blocking_pids(pid))
          AND query ILIKE $2
      `,
      [blockerPid, `%${table}%`],
    );
    blockedPid = blocked.rows[0]?.pid;
    return blockedPid !== undefined;
  }, `Timed out waiting for ${table} lock blocked by backend ${blockerPid}`);
  if (blockedPid === undefined)
    throw new Error('Missing blocked PostgreSQL backend PID');
  return blockedPid;
};

const releaseTransaction = async (
  client: PoolClient,
  transactionOpen: boolean,
  failures: unknown[],
) => {
  let discardClient = false;
  if (transactionOpen) {
    try {
      await client.query('ROLLBACK');
    } catch (error) {
      failures.push(error);
      discardClient = true;
    }
  }
  try {
    client.release(discardClient);
  } catch (error) {
    failures.push(error);
  }
};

const collectActorFailures = async (
  pending: Promise<PromiseSettledResult<unknown>[]> | undefined,
  failures: unknown[],
) => {
  if (!pending) return;
  for (const result of await pending) {
    if (result.status === 'rejected' && !failures.includes(result.reason)) {
      failures.push(result.reason);
    }
  }
};

const throwConcurrencyFailures = (failures: unknown[]) => {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      'Tenant limit concurrency assertion or cleanup failed',
      { cause: failures[0] },
    );
  }
};

const seedLimitFixture = async (
  database: TestDatabase,
): Promise<LimitFixture> => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  const domain = `${suffix}.limit-concurrency.example`;
  const tenantId = makeId('tenant', suffix);
  const tenantName = `Limit concurrency ${suffix}`;
  const userId = makeId('user', suffix);
  const membershipId = makeId('member', suffix);
  const categoryId = makeId('category', suffix);
  const templateId = makeId('template', suffix);
  const eventIds = [
    makeId('event-a', suffix),
    makeId('event-b', suffix),
  ] as const;
  const optionIds = [
    makeId('option-a', suffix),
    makeId('option-b', suffix),
  ] as const;
  const now = Date.now();

  await database.insert(tenants).values({
    domain,
    id: tenantId,
    maxActiveRegistrationsPerUser: 1,
    name: tenantName,
  });
  await database.insert(users).values({
    auth0Id: `auth0|limit-${suffix}`,
    communicationEmail: `${suffix}@example.com`,
    email: `${suffix}@example.com`,
    firstName: 'Limit',
    id: userId,
    lastName: 'Tester',
  });
  await database.insert(usersToTenants).values({
    id: membershipId,
    tenantId,
    userId,
  });
  await database.insert(eventTemplateCategories).values({
    icon: { iconColor: 0, iconName: 'circle' },
    id: categoryId,
    tenantId,
    title: 'Limit concurrency',
  });
  await database.insert(eventTemplates).values({
    categoryId,
    description: 'Cross-event active-registration limit fixture',
    icon: { iconColor: 0, iconName: 'circle' },
    id: templateId,
    tenantId,
    title: 'Limit concurrency',
  });
  await database.insert(eventInstances).values(
    eventIds.map((id, index) => ({
      creatorId: userId,
      description: `Concurrent event ${index + 1}`,
      end: new Date(now + (9 + index) * 24 * 60 * 60 * 1000),
      icon: { iconColor: 0, iconName: 'circle' },
      id,
      reviewedAt: new Date(),
      start: new Date(now + (7 + index) * 24 * 60 * 60 * 1000),
      status: 'APPROVED' as const,
      templateId,
      tenantId,
      title: `Concurrent event ${index + 1}`,
    })),
  );
  await database.insert(eventRegistrationOptions).values(
    optionIds.map((id, index) => ({
      closeRegistrationTime: new Date(now + 6 * 24 * 60 * 60 * 1000),
      eventId: eventIds[index] ?? eventIds[0],
      id,
      isPaid: false,
      openRegistrationTime: new Date(now - 24 * 60 * 60 * 1000),
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs' as const,
      spots: 5,
      title: 'Participant',
    })),
  );

  return {
    categoryId,
    domain,
    eventIds,
    membershipId,
    optionIds,
    templateId,
    tenantId,
    tenantName,
    userId,
  };
};

const cleanLimitFixture = async (
  database: TestDatabase,
  fixture: LimitFixture,
) => {
  await database
    .delete(emailOutbox)
    .where(inArray(emailOutbox.tenantId, [fixture.tenantId]));
  await database
    .delete(registrationAcquisitionComponents)
    .where(
      inArray(registrationAcquisitionComponents.tenantId, [fixture.tenantId]),
    );
  await database
    .delete(registrationAcquisitionPayments)
    .where(
      inArray(registrationAcquisitionPayments.tenantId, [fixture.tenantId]),
    );
  await database
    .delete(transactions)
    .where(inArray(transactions.tenantId, [fixture.tenantId]));
  await database
    .delete(registrationAcquisitions)
    .where(inArray(registrationAcquisitions.tenantId, [fixture.tenantId]));
  await database
    .delete(eventRegistrations)
    .where(inArray(eventRegistrations.eventId, fixture.eventIds));
  await database
    .delete(eventRegistrationOptions)
    .where(inArray(eventRegistrationOptions.id, fixture.optionIds));
  await database
    .delete(eventInstances)
    .where(inArray(eventInstances.id, fixture.eventIds));
  await database
    .delete(eventTemplates)
    .where(inArray(eventTemplates.id, [fixture.templateId]));
  await database
    .delete(eventTemplateCategories)
    .where(inArray(eventTemplateCategories.id, [fixture.categoryId]));
  await database
    .delete(usersToTenants)
    .where(inArray(usersToTenants.id, [fixture.membershipId]));
  await database.delete(users).where(inArray(users.id, [fixture.userId]));
  await database.delete(tenants).where(inArray(tenants.id, [fixture.tenantId]));
};

const snapshotRegistrationEffects = async (
  database: TestDatabase,
  fixture: LimitFixture,
) => ({
  acquisitions: await database
    .select()
    .from(registrationAcquisitions)
    .where(inArray(registrationAcquisitions.tenantId, [fixture.tenantId]))
    .orderBy(registrationAcquisitions.id),
  components: await database
    .select()
    .from(registrationAcquisitionComponents)
    .where(
      inArray(registrationAcquisitionComponents.tenantId, [fixture.tenantId]),
    )
    .orderBy(registrationAcquisitionComponents.id),
  emails: await database
    .select()
    .from(emailOutbox)
    .where(inArray(emailOutbox.tenantId, [fixture.tenantId]))
    .orderBy(emailOutbox.id),
  payments: await database
    .select()
    .from(registrationAcquisitionPayments)
    .where(
      inArray(registrationAcquisitionPayments.tenantId, [fixture.tenantId]),
    )
    .orderBy(registrationAcquisitionPayments.id),
  transactions: await database
    .select()
    .from(transactions)
    .where(inArray(transactions.tenantId, [fixture.tenantId]))
    .orderBy(transactions.id),
});

const registrationInput = (
  fixture: LimitFixture,
  eventIndex: 0 | 1,
  maxActiveRegistrationsPerUser = 1,
): RegistrationInput => ({
  eventId: fixture.eventIds[eventIndex],
  guestCount: 0,
  registrationOptionId: fixture.optionIds[eventIndex],
  tenant: {
    currency: 'EUR',
    domain: fixture.domain,
    id: fixture.tenantId,
    maxActiveRegistrationsPerUser,
    name: fixture.tenantName,
    stripeAccountId: null,
  },
  user: {
    email: `${fixture.userId}@example.com`,
    id: fixture.userId,
    roleIds: [],
  },
});

describe('tenant active-registration limit concurrency', () => {
  let database: TestDatabase;
  const fixtures: LimitFixture[] = [];
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
    const failures: unknown[] = [];
    for (const fixture of fixtures.toReversed()) {
      try {
        await cleanLimitFixture(database, fixture);
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await pool.end();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Failed to release registration limit fixtures',
        { cause: failures[0] },
      );
    }
  });

  it('allows only one simultaneous registration across different events at a limit of one', async () => {
    const fixture = await database.transaction((transaction) =>
      seedLimitFixture(transaction),
    );
    fixtures.push(fixture);
    const serviceLayer = makeServiceLayer(databaseUrl);
    const membershipLock: PoolClient = await lockMembership(pool, fixture);
    let transactionOpen = true;
    const failures: unknown[] = [];
    let pendingRegistrations:
      | Promise<
          PromiseSettledResult<Awaited<ReturnType<typeof runRegistration>>>[]
        >
      | undefined;

    try {
      const first = runRegistration(
        registrationInput(fixture, 0),
        serviceLayer,
      );
      const second = runRegistration(
        registrationInput(fixture, 1),
        serviceLayer,
      );

      pendingRegistrations = Promise.allSettled([first, second]);
      await waitForBlockedMembershipLocks(pool, 2);
      await membershipLock.query('COMMIT');
      transactionOpen = false;

      const outcomes = await Promise.all([first, second]);
      expect(
        outcomes.filter(({ status }) => status === 'success'),
      ).toHaveLength(1);
      expect(outcomes.filter(({ status }) => status === 'failure')).toEqual([
        expect.objectContaining({
          error: expect.objectContaining({
            _tag: 'EventRegistrationConflictError',
            message:
              'This organization has reached its limit for current sign-ups. Contact an administrator.',
          }),
          status: 'failure',
        }),
      ]);

      const registrations = await database.query.eventRegistrations.findMany({
        where: {
          status: { NOT: 'CANCELLED' },
          tenantId: fixture.tenantId,
          userId: fixture.userId,
        },
      });
      expect(registrations).toHaveLength(1);

      const options = await database.query.eventRegistrationOptions.findMany({
        where: { id: { in: [...fixture.optionIds] } },
      });
      expect(
        options.reduce((total, option) => total + option.confirmedSpots, 0),
      ).toBe(1);
    } catch (error) {
      failures.push(error);
    }
    let discardClient = false;
    if (transactionOpen) {
      try {
        await membershipLock.query('ROLLBACK');
      } catch (error) {
        failures.push(error);
        discardClient = true;
      }
    }
    try {
      membershipLock.release(discardClient);
    } catch (error) {
      failures.push(error);
    }
    if (pendingRegistrations) {
      for (const result of await pendingRegistrations) {
        if (result.status === 'rejected' && !failures.includes(result.reason)) {
          failures.push(result.reason);
        }
      }
    }
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        'Registration concurrency assertion or cleanup failed',
        { cause: failures[0] },
      );
    }
  }, 30_000);

  for (const scenario of [
    { after: 1, before: 2, name: 'lowered from two to one', succeeds: false },
    {
      after: 1,
      before: 0,
      name: 'lowered from unlimited to one',
      succeeds: false,
    },
    {
      after: 0,
      before: 1,
      name: 'raised from one to unlimited',
      succeeds: true,
    },
  ]) {
    it(`uses the committed tenant limit ${scenario.name} after waiting for the settings writer`, async () => {
      const fixture = await database.transaction((transaction) =>
        seedLimitFixture(transaction),
      );
      fixtures.push(fixture);
      const stripe = makeStripeGuard();
      const serviceLayer = makeServiceLayer(databaseUrl, stripe.client);
      expect(
        await runRegistration(registrationInput(fixture, 0), serviceLayer),
      ).toEqual({ status: 'success' });
      await database
        .update(tenants)
        .set({ maxActiveRegistrationsPerUser: scenario.before })
        .where(inArray(tenants.id, [fixture.tenantId]));

      const capturedInput = registrationInput(fixture, 1, scenario.before);
      const beforeEffects = await snapshotRegistrationEffects(
        database,
        fixture,
      );
      const writer = await pool.connect();
      let transactionOpen = false;
      const failures: unknown[] = [];
      let pendingRegistration:
        Promise<PromiseSettledResult<unknown>[]> | undefined;

      try {
        transactionOpen = true;
        await writer.query('BEGIN');
        const writerPid = await backendPid(writer);
        // Match the settings writer's explicit lock; a plain UPDATE takes a
        // weaker lock that does not conflict with admission's KEY SHARE.
        const locked = await writer.query(
          'SELECT id FROM tenants WHERE id = $1 FOR UPDATE',
          [fixture.tenantId],
        );
        expect(locked.rowCount).toBe(1);
        await writer.query(
          'UPDATE tenants SET max_active_registrations_per_user = $1 WHERE id = $2',
          [scenario.after, fixture.tenantId],
        );

        const registration = runRegistration(capturedInput, serviceLayer);
        pendingRegistration = Promise.allSettled([registration]);
        await waitForBlockedQuery(pool, writerPid, 'tenants');
        await writer.query('COMMIT');
        transactionOpen = false;

        const outcome = await registration;
        if (scenario.succeeds) {
          expect(outcome).toEqual({ status: 'success' });
        } else {
          expect(outcome).toEqual({
            error: expect.objectContaining({
              _tag: 'EventRegistrationConflictError',
              message:
                'This organization has reached its limit for current sign-ups. Contact an administrator.',
            }),
            status: 'failure',
          });
          expect(await snapshotRegistrationEffects(database, fixture)).toEqual(
            beforeEffects,
          );
        }
        expect(stripe.requestCount()).toBe(0);
        const expectedCount = scenario.succeeds ? 2 : 1;
        const registrations = await database.query.eventRegistrations.findMany({
          where: {
            status: { NOT: 'CANCELLED' },
            tenantId: fixture.tenantId,
            userId: fixture.userId,
          },
        });
        expect(registrations).toHaveLength(expectedCount);
        expect(
          registrations.some(({ eventId }) => eventId === fixture.eventIds[1]),
        ).toBe(scenario.succeeds);
        const options = await database.query.eventRegistrationOptions.findMany({
          where: { id: { in: [...fixture.optionIds] } },
        });
        expect(
          options.reduce((total, option) => total + option.confirmedSpots, 0),
        ).toBe(expectedCount);
        expect(options.every((option) => option.reservedSpots === 0)).toBe(
          true,
        );
        const currentTenant = await database.query.tenants.findFirst({
          where: { id: fixture.tenantId },
        });
        expect(currentTenant?.maxActiveRegistrationsPerUser).toBe(
          scenario.after,
        );
      } catch (error) {
        failures.push(error);
      }
      await releaseTransaction(writer, transactionOpen, failures);
      await collectActorFailures(pendingRegistration, failures);
      throwConcurrencyFailures(failures);
    }, 30_000);
  }

  it('lets admission finish under its locked limit before a settings writer lowers it', async () => {
    const fixture = await database.transaction((transaction) =>
      seedLimitFixture(transaction),
    );
    fixtures.push(fixture);
    const stripe = makeStripeGuard();
    const serviceLayer = makeServiceLayer(databaseUrl, stripe.client);
    expect(
      await runRegistration(registrationInput(fixture, 0), serviceLayer),
    ).toEqual({ status: 'success' });
    await database
      .update(tenants)
      .set({ maxActiveRegistrationsPerUser: 2 })
      .where(inArray(tenants.id, [fixture.tenantId]));
    const capturedInput = registrationInput(fixture, 1, 2);
    const membershipLock = await lockMembership(pool, fixture);
    let membershipTransactionOpen = true;
    let writer: PoolClient | undefined;
    let writerTransactionOpen = false;
    let pendingRegistration:
      Promise<PromiseSettledResult<unknown>[]> | undefined;
    let pendingWriter: Promise<PromiseSettledResult<unknown>[]> | undefined;
    const failures: unknown[] = [];

    try {
      const membershipPid = await backendPid(membershipLock);
      const registration = runRegistration(capturedInput, serviceLayer);
      pendingRegistration = Promise.allSettled([registration]);
      const admissionPid = await waitForBlockedQuery(
        pool,
        membershipPid,
        'users_to_tenants',
      );

      writer = await pool.connect();
      const settingsWriter = writer;
      writerTransactionOpen = true;
      await settingsWriter.query('BEGIN');
      const writerPid = await backendPid(settingsWriter);
      const writeSettings = async () => {
        await settingsWriter.query(
          'SELECT id FROM tenants WHERE id = $1 FOR UPDATE',
          [fixture.tenantId],
        );
        await settingsWriter.query(
          'UPDATE tenants SET max_active_registrations_per_user = 1 WHERE id = $1',
          [fixture.tenantId],
        );
        await settingsWriter.query('COMMIT');
        writerTransactionOpen = false;
      };
      const settingsUpdate = writeSettings();
      pendingWriter = Promise.allSettled([settingsUpdate]);
      expect(await waitForBlockedQuery(pool, admissionPid, 'tenants')).toBe(
        writerPid,
      );

      await membershipLock.query('COMMIT');
      membershipTransactionOpen = false;
      expect(await registration).toEqual({ status: 'success' });
      await settingsUpdate;
      expect(stripe.requestCount()).toBe(0);

      const registrations = await database.query.eventRegistrations.findMany({
        where: {
          status: { NOT: 'CANCELLED' },
          tenantId: fixture.tenantId,
          userId: fixture.userId,
        },
      });
      expect(registrations).toHaveLength(2);
      const options = await database.query.eventRegistrationOptions.findMany({
        where: { id: { in: [...fixture.optionIds] } },
      });
      expect(
        options.reduce((total, option) => total + option.confirmedSpots, 0),
      ).toBe(2);
      expect(options.every((option) => option.reservedSpots === 0)).toBe(true);
      const currentTenant = await database.query.tenants.findFirst({
        where: { id: fixture.tenantId },
      });
      expect(currentTenant?.maxActiveRegistrationsPerUser).toBe(1);
    } catch (error) {
      failures.push(error);
    }
    // Unblock admission before settling either actor or cleaning the writer.
    await releaseTransaction(
      membershipLock,
      membershipTransactionOpen,
      failures,
    );
    await collectActorFailures(pendingRegistration, failures);
    await collectActorFailures(pendingWriter, failures);
    if (writer)
      await releaseTransaction(writer, writerTransactionOpen, failures);
    throwConcurrencyFailures(failures);
  }, 30_000);
});
