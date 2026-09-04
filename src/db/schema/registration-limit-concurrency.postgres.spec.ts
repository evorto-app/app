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

const makeServiceLayer = (url: string) => {
  const configLayer = makeConfigLayer(url);
  return Layer.mergeAll(
    configLayer,
    databaseLayer.pipe(Layer.provide(configLayer)),
    Layer.succeed(StripeClient, new Stripe('sk_test_limit_concurrency')),
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

const seedLimitFixture = async (
  database: TestDatabase,
): Promise<LimitFixture> => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  const domain = `${suffix}.limit-concurrency.example`;
  const tenantId = makeId('tenant', suffix);
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
    name: `Limit concurrency ${suffix}`,
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

const registrationInput = (
  fixture: LimitFixture,
  eventIndex: 0 | 1,
): RegistrationInput => ({
  eventId: fixture.eventIds[eventIndex],
  guestCount: 0,
  registrationOptionId: fixture.optionIds[eventIndex],
  tenant: {
    currency: 'EUR',
    domain: fixture.domain,
    id: fixture.tenantId,
    maxActiveRegistrationsPerUser: 1,
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
            message: 'Active registration limit reached',
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
});
