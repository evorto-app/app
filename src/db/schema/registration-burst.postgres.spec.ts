import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer, ManagedRuntime } from 'effect';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { Pool } from 'pg';
import Stripe from 'stripe';

import { EventRegistrationService } from '../../server/effect/rpc/handlers/events/event-registration.service';
import { StripeClient } from '../../server/stripe-client';
import { Database, databaseLayer } from '../database.layer';
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
  tenantStripeTaxRates,
  transactions,
  users,
  usersToTenants,
} from './index';

// EVO-21: burst behaviour of one registration option under a signup rush.
// Measures wall time, per-request latency and PostgreSQL lock waits with the
// production pool shape (3 web containers x DATABASE_POOL_MAX=5). Only the
// outcomes are asserted; the numbers are printed for review.

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

const CONTAINER_COUNT = 3;
const POOL_MAX_PER_CONTAINER = 5;
const REQUEST_COUNT = 40;
const STRIPE_CREATE_LATENCY_MS = 100;
const LOCK_SAMPLE_INTERVAL_MS = 5;
const FULL_MESSAGE =
  'There are not enough places left for this sign-up choice.';

interface BurstFixture {
  readonly categoryId: string;
  readonly domain: string;
  readonly eventIds: readonly string[];
  readonly optionIds: readonly string[];
  readonly stripeAccountId: string;
  readonly templateId: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly userIds: readonly string[];
}

interface LockSample {
  readonly byTable: Readonly<Record<string, number>>;
  readonly waiting: number;
}

type RegistrationInput = Parameters<
  typeof EventRegistrationService.registerForEvent
>[0];
type StripeHttpRequestArguments = Parameters<
  InstanceType<typeof Stripe.HttpClient>['makeRequest']
>;
type TestDatabase = NodePgDatabase<typeof relations>;

class JsonStripeResponse extends Stripe.HttpClientResponse {
  constructor(private readonly body: unknown) {
    super(200, { 'request-id': `req_${randomUUID()}` });
  }

  override getRawResponse(): unknown {
    return this.body;
  }

  override toJSON(): Promise<unknown> {
    return Promise.resolve(this.body);
  }
}

// Answers Checkout Session creation after a fixed delay, like a provider
// round trip. Nothing leaves the process.
class SlowCheckoutStripeHttpClient extends Stripe.HttpClient {
  get createCount(): number {
    return this.sessionsByIdempotencyKey.size;
  }

  get requestCount(): number {
    return this.requests;
  }

  private requests = 0;

  private readonly sessionNamespace = randomUUID()
    .replaceAll('-', '')
    .slice(0, 8);

  private readonly sessionsByIdempotencyKey = new Map<string, string>();

  override getClientName(): string {
    return 'evorto-registration-burst-test';
  }

  override async makeRequest(
    ...arguments_: StripeHttpRequestArguments
  ): Promise<JsonStripeResponse> {
    const path = arguments_[2];
    const method = arguments_[3];
    const headers = arguments_[4];
    const requestData = arguments_[5];
    this.requests += 1;
    if (method !== 'POST' || path !== '/v1/checkout/sessions') {
      throw new Error(`Unexpected Stripe request: ${method} ${path}`);
    }
    const idempotencyKey = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === 'idempotency-key',
    )?.[1];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
      throw new Error('Stripe request did not include an idempotency key');
    }
    const id =
      this.sessionsByIdempotencyKey.get(idempotencyKey) ??
      `cs_test_${this.sessionNamespace}_${this.sessionsByIdempotencyKey.size + 1}`;
    this.sessionsByIdempotencyKey.set(idempotencyKey, id);
    await sleep(STRIPE_CREATE_LATENCY_MS);

    const form = new URLSearchParams(requestData);
    const metadata = Object.fromEntries(
      [...form].flatMap(([key, value]) => {
        const match = /^metadata\[([^\]]+)\]$/.exec(key);
        return match?.[1] ? [[match[1], value]] : [];
      }),
    );
    let amount = 0;
    for (const [key, value] of form) {
      const match = /^line_items\[(\d+)\]\[price_data\]\[unit_amount\]$/.exec(
        key,
      );
      if (match?.[1]) {
        amount +=
          Number(value) * Number(form.get(`line_items[${match[1]}][quantity]`));
      }
    }
    return new JsonStripeResponse({
      amount_total: amount,
      cancel_url: form.get('cancel_url'),
      currency:
        form.get('line_items[0][price_data][currency]')?.toLowerCase() ?? null,
      customer_email: form.get('customer_email'),
      expires_at: Number(form.get('expires_at')),
      id,
      metadata,
      mode: 'payment',
      object: 'checkout.session',
      payment_intent: null,
      payment_status: 'unpaid',
      status: 'open',
      success_url: form.get('success_url'),
      url: `https://checkout.stripe.com/c/pay/${id}`,
    });
  }
}

const makeId = (prefix: string, suffix: string) =>
  `${prefix}-${suffix}`.slice(0, 20);

const itemAt = <A>(items: readonly A[], index: number): A => {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Fixture has no item at index ${index}`);
  }
  return item;
};

const makeContainerRuntime = (stripe: Stripe) => {
  const configLayer = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: Object.fromEntries([
        ['BASE_URL', 'https://registration-burst.example'],
        ['CLIENT_ID', 'client-id'],
        ['CLIENT_SECRET', 'client-secret'],
        ['DATABASE_POOL_MAX', String(POOL_MAX_PER_CONTAINER)],
        ['DATABASE_POOL_MIN', '0'],
        ['DATABASE_TLS_REQUIRED', 'false'],
        ['DATABASE_URL', databaseUrl],
        ['ISSUER_BASE_URL', 'https://issuer.example'],
        ['SECRET', 'test-secret'],
      ]),
    }),
  );
  return ManagedRuntime.make(
    EventRegistrationService.Default.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          configLayer,
          databaseLayer.pipe(Layer.provide(configLayer)),
          Layer.succeed(StripeClient, stripe),
        ),
      ),
    ),
  );
};

type ContainerRuntime = ReturnType<typeof makeContainerRuntime>;

// Open every pool connection before the burst so the numbers show steady
// state rather than connection setup. Each query holds its connection briefly
// so the pool cannot serve two of them from one connection.
const warmPool = (runtime: ContainerRuntime) =>
  runtime.runPromise(
    Effect.all(
      Array.from({ length: POOL_MAX_PER_CONTAINER }, () =>
        Effect.gen(function* () {
          const database = yield* Database;
          return yield* database
            .select({ slept: sql<string>`pg_sleep(0.05)::text` })
            .from(tenants)
            .limit(1);
        }),
      ),
      { concurrency: 'unbounded' },
    ),
  );

const runRegistration = (runtime: ContainerRuntime, input: RegistrationInput) =>
  runtime
    .runPromise(
      EventRegistrationService.registerForEvent(input).pipe(
        Effect.match({
          onFailure: (error) => ({ error, status: 'failure' as const }),
          onSuccess: () => ({ status: 'success' as const }),
        }),
      ),
    )
    .catch((error: unknown) => ({ defect: error, status: 'defect' as const }));

const seedBurstFixture = async (
  database: TestDatabase,
  { eventCount, isPaid }: { eventCount: number; isPaid: boolean },
): Promise<BurstFixture> => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  const domain = `${suffix}.registration-burst.example`;
  const tenantId = makeId('tenant', suffix);
  const tenantName = `Registration burst ${suffix}`;
  const stripeAccountId = `acct_${suffix}`;
  const taxRateId = `txr_${suffix}`;
  const categoryId = makeId('category', suffix);
  const templateId = makeId('template', suffix);
  const userIds = Array.from({ length: REQUEST_COUNT }, (_, index) =>
    makeId(`u${index}`, suffix),
  );
  const eventIds = Array.from({ length: eventCount }, (_, index) =>
    makeId(`e${index}`, suffix),
  );
  const optionIds = Array.from({ length: eventCount }, (_, index) =>
    makeId(`o${index}`, suffix),
  );
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  await database.transaction(async (transaction) => {
    await transaction.insert(tenants).values({
      domain,
      id: tenantId,
      name: tenantName,
      stripeAccountId,
    });
    await transaction.insert(tenantStripeTaxRates).values({
      active: true,
      displayName: 'VAT',
      inclusive: true,
      percentage: '19',
      stripeAccountId,
      stripeTaxRateId: taxRateId,
      tenantId,
    });
    await transaction.insert(users).values(
      userIds.map((id) => ({
        auth0Id: `auth0|${id}`,
        communicationEmail: `${id}.contact@example.com`,
        email: `${id}@example.com`,
        firstName: 'Burst',
        id,
        lastName: 'Tester',
      })),
    );
    await transaction.insert(usersToTenants).values(
      userIds.map((userId, index) => ({
        id: makeId(`m${index}`, suffix),
        tenantId,
        userId,
      })),
    );
    await transaction.insert(eventTemplateCategories).values({
      icon: { iconColor: 0, iconName: 'circle' },
      id: categoryId,
      tenantId,
      title: 'Registration burst',
    });
    await transaction.insert(eventTemplates).values({
      categoryId,
      description: 'Registration burst fixture',
      icon: { iconColor: 0, iconName: 'circle' },
      id: templateId,
      tenantId,
      title: 'Registration burst',
    });
    await transaction.insert(eventInstances).values(
      eventIds.map((id, index) => ({
        creatorId: itemAt(userIds, 0),
        description: `Burst event ${index + 1}`,
        end: new Date(now + 8 * day),
        icon: { iconColor: 0, iconName: 'circle' },
        id,
        reviewedAt: new Date(now),
        start: new Date(now + 7 * day),
        status: 'APPROVED' as const,
        templateId,
        tenantId,
        title: `Burst event ${index + 1}`,
      })),
    );
    await transaction.insert(eventRegistrationOptions).values(
      optionIds.map((id, index) => ({
        closeRegistrationTime: new Date(now + 6 * day),
        eventId: itemAt(eventIds, index),
        id,
        isPaid,
        openRegistrationTime: new Date(now - day),
        organizingRegistration: false,
        price: isPaid ? 1000 : 0,
        registrationMode: 'fcfs' as const,
        spots: 10,
        ...(isPaid && { stripeTaxRateId: taxRateId }),
        title: 'Participant',
      })),
    );
  });

  return {
    categoryId,
    domain,
    eventIds,
    optionIds,
    stripeAccountId,
    templateId,
    tenantId,
    tenantName,
    userIds,
  };
};

const cleanBurstFixture = async (
  database: TestDatabase,
  fixture: BurstFixture,
) => {
  const tenantId = fixture.tenantId;
  await database.delete(emailOutbox).where(eq(emailOutbox.tenantId, tenantId));
  await database
    .delete(registrationAcquisitionComponents)
    .where(eq(registrationAcquisitionComponents.tenantId, tenantId));
  await database
    .delete(registrationAcquisitionPayments)
    .where(eq(registrationAcquisitionPayments.tenantId, tenantId));
  await database
    .delete(registrationAcquisitions)
    .where(eq(registrationAcquisitions.tenantId, tenantId));
  await database
    .delete(transactions)
    .where(eq(transactions.tenantId, tenantId));
  await database
    .delete(eventRegistrations)
    .where(eq(eventRegistrations.tenantId, tenantId));
  await database
    .delete(eventRegistrationOptions)
    .where(inArray(eventRegistrationOptions.id, [...fixture.optionIds]));
  await database
    .delete(eventInstances)
    .where(inArray(eventInstances.id, [...fixture.eventIds]));
  await database
    .delete(eventTemplates)
    .where(eq(eventTemplates.id, fixture.templateId));
  await database
    .delete(eventTemplateCategories)
    .where(eq(eventTemplateCategories.id, fixture.categoryId));
  await database
    .delete(usersToTenants)
    .where(eq(usersToTenants.tenantId, tenantId));
  await database.delete(users).where(inArray(users.id, [...fixture.userIds]));
  await database
    .delete(tenantStripeTaxRates)
    .where(eq(tenantStripeTaxRates.tenantId, tenantId));
  await database.delete(tenants).where(eq(tenants.id, tenantId));
};

const registrationInput = (
  fixture: BurstFixture,
  userIndex: number,
): RegistrationInput => {
  const eventIndex = userIndex % fixture.eventIds.length;
  const userId = itemAt(fixture.userIds, userIndex);
  return {
    eventId: itemAt(fixture.eventIds, eventIndex),
    guestCount: 0,
    registrationOptionId: itemAt(fixture.optionIds, eventIndex),
    tenant: {
      currency: 'EUR',
      domain: fixture.domain,
      emailSenderEmail: null,
      emailSenderName: null,
      id: fixture.tenantId,
      maxActiveRegistrationsPerUser: 0,
      name: fixture.tenantName,
      stripeAccountId: fixture.stripeAccountId,
    },
    user: {
      communicationEmail: `${userId}.contact@example.com`,
      email: `${userId}@example.com`,
      id: userId,
      roleIds: [],
    },
  };
};

// Samples backends of this database that wait on a heavyweight lock, grouped
// by the first table their statement reads or writes.
const startLockSampler = (pool: Pool) => {
  const samples: LockSample[] = [];
  let running = true;
  let failure: undefined | { readonly error: unknown };
  const sample = async () => {
    while (running) {
      const result = await pool.query<{ count: number; locked: string }>(
        `
          SELECT
            coalesce(
              substring(query FROM '(?:from|update|into) "([a-z_]+)"'),
              'other'
            ) AS locked,
            count(*)::int AS count
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
          GROUP BY 1
        `,
      );
      const byTable = Object.fromEntries(
        result.rows.map((row) => [row.locked, row.count]),
      );
      samples.push({
        byTable,
        waiting: result.rows.reduce((total, row) => total + row.count, 0),
      });
      await sleep(LOCK_SAMPLE_INTERVAL_MS);
    }
  };
  // A sampler failure must not mask the burst's own outcome; it is reported
  // after the burst has settled.
  const loop = sample().catch((error: unknown) => {
    failure = { error };
  });
  return {
    stop: async () => {
      running = false;
      await loop;
      return { failure, samples };
    },
  };
};

const percentile = (sorted: readonly number[], fraction: number) =>
  sorted[
    Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
  ] ?? NaN;

const summarizeLockSamples = (samples: readonly LockSample[]) => {
  const peakByTable: Record<string, number> = {};
  for (const sample of samples) {
    for (const [table, count] of Object.entries(sample.byTable)) {
      peakByTable[table] = Math.max(peakByTable[table] ?? 0, count);
    }
  }
  return {
    peakByTable,
    peakWaiting: Math.max(0, ...samples.map((sample) => sample.waiting)),
    samples: samples.length,
    samplesWithWaiters: samples.filter((sample) => sample.waiting > 0).length,
  };
};

const runBurst = async (name: string, fixture: BurstFixture, pool: Pool) => {
  const fakeHttpClient = new SlowCheckoutStripeHttpClient();
  const stripe = new Stripe('sk_test_registration_burst', {
    httpClient: fakeHttpClient,
    maxNetworkRetries: 0,
  });
  const runtimes = Array.from({ length: CONTAINER_COUNT }, () =>
    makeContainerRuntime(stripe),
  );
  try {
    await Promise.all(runtimes.map((runtime) => warmPool(runtime)));
    const sampler = startLockSampler(pool);
    let sampled: Awaited<ReturnType<typeof sampler.stop>> | undefined;
    let wallMs = 0;
    let results: {
      latencyMs: number;
      outcome: Awaited<ReturnType<typeof runRegistration>>;
    }[] = [];
    try {
      const burstStart = performance.now();
      results = await Promise.all(
        fixture.userIds.map(async (_, index) => {
          const runtime = runtimes[index % CONTAINER_COUNT];
          if (!runtime) throw new Error('Missing container runtime');
          const start = performance.now();
          const outcome = await runRegistration(
            runtime,
            registrationInput(fixture, index),
          );
          return { latencyMs: performance.now() - start, outcome };
        }),
      );
      wallMs = performance.now() - burstStart;
    } finally {
      sampled = await sampler.stop();
    }
    if (!sampled) throw new Error('Lock sampler did not stop');
    if (sampled.failure) {
      throw new Error('Lock sampler failed', { cause: sampled.failure.error });
    }

    const latencies = results
      .map(({ latencyMs }) => latencyMs)
      .toSorted((left, right) => left - right);
    const round = (value: number) => Math.round(value);
    const failures = results.flatMap(({ outcome }) =>
      outcome.status === 'failure' ? [outcome.error] : [],
    );
    const defects = results.flatMap(({ outcome }) =>
      outcome.status === 'defect' ? [outcome.defect] : [],
    );
    const full = failures.filter(
      (error) =>
        error._tag === 'EventRegistrationConflictError' &&
        error.message === FULL_MESSAGE,
    );
    const summary = {
      checkoutCreates: fakeHttpClient.createCount,
      checkoutRequests: fakeHttpClient.requestCount,
      latencyMs: {
        max: round(latencies.at(-1) ?? NaN),
        min: round(latencies[0] ?? NaN),
        p50: round(percentile(latencies, 0.5)),
        p90: round(percentile(latencies, 0.9)),
        p99: round(percentile(latencies, 0.99)),
      },
      lockWaits: summarizeLockSamples(sampled.samples),
      outcomes: {
        full: full.length,
        other: failures.length - full.length + defects.length,
        success: results.length - failures.length - defects.length,
      },
      pools: `${CONTAINER_COUNT}x${POOL_MAX_PER_CONTAINER}`,
      requests: results.length,
      scenario: name,
      wallMs: round(wallMs),
    };
    console.info(`[EVO-21 registration burst] ${JSON.stringify(summary)}`);
    return {
      failures: [...failures, ...defects],
      otherFailures: [
        ...failures.filter((error) => !full.includes(error)),
        ...defects,
      ],
      stripeCreates: fakeHttpClient.createCount,
      stripeRequests: fakeHttpClient.requestCount,
      summary,
    };
  } finally {
    await Promise.all(runtimes.map((runtime) => runtime.dispose()));
  }
};

const readCapacity = async (database: TestDatabase, fixture: BurstFixture) => {
  const options = await database.query.eventRegistrationOptions.findMany({
    columns: { confirmedSpots: true, id: true, reservedSpots: true },
    where: { id: { in: [...fixture.optionIds] } },
  });
  const registrations = await database
    .select({
      registrationOptionId: eventRegistrations.registrationOptionId,
      status: eventRegistrations.status,
      userId: eventRegistrations.userId,
    })
    .from(eventRegistrations)
    .where(
      and(
        eq(eventRegistrations.tenantId, fixture.tenantId),
        inArray(eventRegistrations.status, ['CONFIRMED', 'PENDING']),
      ),
    );
  const claims = await database
    .select({ id: transactions.id, status: transactions.status })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, fixture.tenantId),
        eq(transactions.type, 'registration'),
      ),
    );
  return { claims, options, registrations };
};

describe('registration burst on one tenant (EVO-21)', () => {
  let database: TestDatabase;
  const fixtures: BurstFixture[] = [];
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
    const failures: unknown[] = [];
    for (const fixture of fixtures.toReversed()) {
      try {
        await cleanBurstFixture(database, fixture);
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
        'Failed to release registration burst fixtures',
        { cause: failures[0] },
      );
    }
  });

  for (const isPaid of [false, true]) {
    const kind = isPaid ? 'paid' : 'free';

    it(`admits exactly 10 of ${REQUEST_COUNT} simultaneous ${kind} signups for a 10-place option`, async () => {
      const fixture = await seedBurstFixture(database, {
        eventCount: 1,
        isPaid,
      });
      fixtures.push(fixture);

      const burst = await runBurst(`one option, ${kind}`, fixture, pool);

      expect(burst.otherFailures).toEqual([]);
      expect(burst.summary.outcomes).toEqual({
        full: REQUEST_COUNT - 10,
        other: 0,
        success: 10,
      });
      expect(burst.stripeCreates).toBe(isPaid ? 10 : 0);
      expect(burst.stripeRequests).toBe(burst.stripeCreates);

      const state = await readCapacity(database, fixture);
      expect(state.options).toEqual([
        {
          confirmedSpots: isPaid ? 0 : 10,
          id: fixture.optionIds[0],
          reservedSpots: isPaid ? 10 : 0,
        },
      ]);
      expect(state.registrations).toHaveLength(10);
      expect(
        new Set(state.registrations.map(({ userId }) => userId)).size,
      ).toBe(10);
      expect(
        state.registrations.every(
          ({ status }) => status === (isPaid ? 'PENDING' : 'CONFIRMED'),
        ),
      ).toBe(true);
      expect(state.claims).toHaveLength(isPaid ? 10 : 0);
      expect(state.claims.every(({ status }) => status === 'pending')).toBe(
        true,
      );
    }, 60_000);

    // Measurement for the paid-only tenant row lock: the same 40 signups
    // spread over four events, so only a tenant-wide lock can queue them.
    it(`admits ${REQUEST_COUNT} simultaneous ${kind} signups spread over four events`, async () => {
      const fixture = await seedBurstFixture(database, {
        eventCount: 4,
        isPaid,
      });
      fixtures.push(fixture);

      const burst = await runBurst(`four events, ${kind}`, fixture, pool);

      expect(burst.failures).toEqual([]);
      expect(burst.stripeCreates).toBe(isPaid ? REQUEST_COUNT : 0);
      expect(burst.stripeRequests).toBe(burst.stripeCreates);
      const state = await readCapacity(database, fixture);
      expect(
        state.options.toSorted((left, right) =>
          left.id.localeCompare(right.id),
        ),
      ).toEqual(
        fixture.optionIds.toSorted().map((id) => ({
          confirmedSpots: isPaid ? 0 : 10,
          id,
          reservedSpots: isPaid ? 10 : 0,
        })),
      );
      expect(state.registrations).toHaveLength(REQUEST_COUNT);
      expect(state.claims).toHaveLength(isPaid ? REQUEST_COUNT : 0);
    }, 60_000);
  }
});
