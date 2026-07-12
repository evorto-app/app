import type Stripe from 'stripe';

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from '@effect/vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import StripeClientLibrary from 'stripe';

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
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
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

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}
const neonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';

interface CapturedStripeRequest {
  readonly idempotencyKey: string;
  readonly requestData: string;
}

interface FakeStripeSession {
  readonly id: string;
  readonly object: 'checkout.session';
  readonly payment_intent: string;
  readonly status: 'expired' | 'open';
  readonly url: null | string;
}

interface Fixture {
  addOnId: string;
  categoryId: string;
  eventId: string;
  optionId: string;
  registrationId: string;
  taxRateId: string;
  templateId: string;
  tenantId: string;
  userId: string;
}

type StripeHttpRequestArguments = Parameters<
  InstanceType<typeof StripeClientLibrary.HttpClient>['makeRequest']
>;
type TestDatabase = NodePgDatabase<typeof relations>;

class IdempotentStripeHttpClient extends StripeClientLibrary.HttpClient {
  readonly createRequests: CapturedStripeRequest[] = [];
  readonly expiredSessionIds: string[] = [];

  get createdSessionIds(): readonly string[] {
    return [...this.sessionsByIdempotencyKey.values()].map(
      (session) => session.id,
    );
  }
  private createGate: Promise<unknown> | undefined;
  private failNextCreateAfterSessionCreation = false;
  private readonly sessionNamespace = randomUUID()
    .replaceAll('-', '')
    .slice(0, 8);

  private readonly sessionsByIdempotencyKey = new Map<
    string,
    FakeStripeSession
  >();

  failNextCreateAmbiguously(): void {
    this.failNextCreateAfterSessionCreation = true;
  }

  override getClientName(): string {
    return 'evorto-registration-concurrency-test';
  }

  holdCreatesUntil(gate: Promise<unknown>): void {
    this.createGate = gate;
  }

  override async makeRequest(
    ...arguments_: StripeHttpRequestArguments
  ): Promise<JsonStripeResponse> {
    const path = arguments_[2];
    const method = arguments_[3];
    const headers = arguments_[4];
    const requestData = arguments_[5];
    if (method === 'POST' && path === '/v1/checkout/sessions') {
      const idempotencyHeader = Object.entries(headers).find(
        ([name]) => name.toLowerCase() === 'idempotency-key',
      )?.[1];
      const idempotencyKey = Array.isArray(idempotencyHeader)
        ? idempotencyHeader.join(',')
        : idempotencyHeader === undefined
          ? undefined
          : String(idempotencyHeader);
      if (!idempotencyKey) {
        throw new Error('Stripe request did not include an idempotency key');
      }

      const existingSession = this.sessionsByIdempotencyKey.get(idempotencyKey);
      const session =
        existingSession ??
        this.createSession(this.sessionsByIdempotencyKey.size + 1);
      this.sessionsByIdempotencyKey.set(idempotencyKey, session);
      this.createRequests.push({ idempotencyKey, requestData });

      if (this.failNextCreateAfterSessionCreation) {
        this.failNextCreateAfterSessionCreation = false;
        throw StripeClientLibrary.HttpClient.makeTimeoutError();
      }

      if (this.createGate) {
        await this.createGate;
      }
      return new JsonStripeResponse(session);
    }

    const expireMatch =
      method === 'POST'
        ? /^\/v1\/checkout\/sessions\/([^/]+)\/expire$/.exec(path)
        : null;
    const encodedSessionId = expireMatch?.[1];
    if (encodedSessionId) {
      const sessionId = decodeURIComponent(encodedSessionId);
      this.expiredSessionIds.push(sessionId);
      const existingSession = [...this.sessionsByIdempotencyKey.values()].find(
        (session) => session.id === sessionId,
      );
      return new JsonStripeResponse({
        ...(existingSession ?? this.createSession(1)),
        id: sessionId,
        status: 'expired',
        url: null,
      } satisfies FakeStripeSession);
    }

    throw new Error(`Unexpected Stripe request: ${method} ${path}`);
  }

  private createSession(sequence: number): FakeStripeSession {
    const id = `cs_test_${this.sessionNamespace}_${sequence}`;
    return {
      id,
      object: 'checkout.session',
      payment_intent: `pi_test_${this.sessionNamespace}_${sequence}`,
      status: 'open',
      url: `https://checkout.stripe.test/${id}`,
    };
  }
}

class JsonStripeResponse extends StripeClientLibrary.HttpClientResponse {
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

const makeId = (prefix: string, suffix: string) =>
  `${prefix}-${suffix}`.slice(0, 20);

const tenantDomainForFixture = (fixture: Fixture): string =>
  `${fixture.tenantId.replace(/^tenant-/, '')}.concurrency.example`;

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

type ApprovalInput = Parameters<
  typeof EventRegistrationService.approveManualRegistration
>[0];
type RegistrationInput = Parameters<
  typeof EventRegistrationService.registerForEvent
>[0];

const runApproval = (
  input: ApprovalInput,
  serviceLayer: ReturnType<typeof makeServiceLayer>,
) =>
  Effect.runPromise(
    EventRegistrationService.approveManualRegistration(input).pipe(
      Effect.match({
        onFailure: (error) => ({ error, status: 'failure' as const }),
        onSuccess: (value) => ({ status: 'success' as const, value }),
      }),
      Effect.provide(EventRegistrationService.Default),
      Effect.provide(serviceLayer),
    ),
  );

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

const runCancellation = ({
  expectedPaymentPending = false,
  fixture,
  serviceLayer,
}: {
  expectedPaymentPending?: boolean;
  fixture: Fixture;
  serviceLayer: ReturnType<typeof makeServiceLayer>;
}) => {
  const permissions = [] as const;
  const requestContext = {
    authData: {},
    authenticated: true,
    permissions,
    tenant: {
      currency: 'EUR',
      defaultLocation: undefined,
      discountProviders: {
        esnCard: {
          config: {},
          status: 'disabled',
        },
      },
      domain: tenantDomainForFixture(fixture),
      emailSenderEmail: undefined,
      emailSenderName: undefined,
      faviconUrl: undefined,
      id: fixture.tenantId,
      legalNoticeText: undefined,
      legalNoticeUrl: undefined,
      locale: 'en-GB',
      logoUrl: undefined,
      maxActiveRegistrationsPerUser: 0,
      name: 'Concurrency test',
      privacyPolicyText: undefined,
      privacyPolicyUrl: undefined,
      receiptSettings: {
        allowOther: false,
        receiptCountries: ['DE'],
      },
      seoDescription: undefined,
      seoTitle: undefined,
      stripeAccountId: `acct_${fixture.tenantId.replace('tenant-', '')}`,
      termsText: undefined,
      termsUrl: undefined,
      theme: 'evorto',
      timezone: 'Europe/Berlin',
    },
    user: {
      attributes: [],
      auth0Id: `auth0|${fixture.userId}`,
      communicationEmail: undefined,
      email: `${fixture.userId}@example.com`,
      firstName: 'Concurrent',
      iban: undefined,
      id: fixture.userId,
      lastName: 'Tester',
      paypalEmail: undefined,
      permissions,
      roleIds: [],
    },
    userAssigned: true,
  } satisfies RpcRequestContextShape;

  return Effect.runPromise(
    eventRegistrationHandlers['events.cancelRegistration'](
      {
        expectedPaymentPending,
        expectedStatus: 'PENDING',
        registrationId: fixture.registrationId,
      },
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

const approvalInput = (fixture: Fixture): ApprovalInput => ({
  executiveUserId: fixture.userId,
  expectedEventId: fixture.eventId,
  registrationId: fixture.registrationId,
  targetTenant: {
    currency: 'EUR',
    domain: tenantDomainForFixture(fixture),
    emailSenderEmail: null,
    emailSenderName: null,
    id: fixture.tenantId,
    name: 'Concurrency test',
    stripeAccountId: `acct_${fixture.tenantId.replace('tenant-', '')}`,
  },
});

const directRegistrationInput = (fixture: Fixture): RegistrationInput => ({
  addOns: [{ addOnId: fixture.addOnId, quantity: 1 }],
  eventId: fixture.eventId,
  guestCount: 0,
  registrationOptionId: fixture.optionId,
  tenant: {
    currency: 'EUR',
    domain: tenantDomainForFixture(fixture),
    id: fixture.tenantId,
    maxActiveRegistrationsPerUser: 0,
    stripeAccountId: `acct_${fixture.tenantId.replace('tenant-', '')}`,
  },
  user: {
    email: `${fixture.userId}@example.com`,
    id: fixture.userId,
    roleIds: [],
  },
});

const seedFixture = async (database: TestDatabase): Promise<Fixture> => {
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
  const taxRateId = `txr_${suffix}`;
  const now = Date.now();

  await database.insert(tenants).values({
    domain: `${suffix}.concurrency.example`,
    id: tenantId,
    name: `Concurrency ${suffix}`,
    stripeAccountId: `acct_${suffix}`,
  });
  await database.insert(tenantStripeTaxRates).values({
    active: true,
    displayName: 'VAT',
    inclusive: true,
    percentage: '19',
    stripeAccountId: `acct_${suffix}`,
    stripeTaxRateId: taxRateId,
    tenantId,
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
    isPaid: true,
    openRegistrationTime: new Date(now - 24 * 60 * 60 * 1000),
    organizingRegistration: false,
    price: 1000,
    registrationMode: 'application',
    spots: 2,
    stripeTaxRateId: taxRateId,
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
    eventId,
    includedQuantity: 1,
    optionalPurchaseQuantity: 1,
    registrationOptionId: optionId,
  });
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

  return {
    addOnId,
    categoryId,
    eventId,
    optionId,
    registrationId,
    taxRateId,
    templateId,
    tenantId,
    userId,
  };
};

const prepareDirectRegistrationFixture = async (
  database: TestDatabase,
): Promise<Fixture> => {
  const fixture = await seedFixture(database);
  await database
    .delete(eventRegistrationAddonPurchaseLots)
    .where(
      eq(
        eventRegistrationAddonPurchaseLots.registrationId,
        fixture.registrationId,
      ),
    );
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
    .update(eventRegistrationOptions)
    .set({ registrationMode: 'fcfs' })
    .where(eq(eventRegistrationOptions.id, fixture.optionId));
  return fixture;
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
  await database
    .delete(tenantStripeTaxRates)
    .where(eq(tenantStripeTaxRates.tenantId, fixture.tenantId));
  await database.delete(tenants).where(eq(tenants.id, fixture.tenantId));
};

const readFixtureState = async (database: TestDatabase, fixture: Fixture) => {
  const [claims, option, addOn, emails, registration] = await Promise.all([
    database.query.transactions.findMany({
      where: {
        eventRegistrationId: fixture.registrationId,
        tenantId: fixture.tenantId,
        type: 'registration',
      },
    }),
    database.query.eventRegistrationOptions.findFirst({
      where: { id: fixture.optionId },
    }),
    database.query.eventAddons.findFirst({
      where: { id: fixture.addOnId },
    }),
    database.query.emailOutbox.findMany({
      where: { tenantId: fixture.tenantId },
    }),
    database.query.eventRegistrations.findFirst({
      where: { id: fixture.registrationId, tenantId: fixture.tenantId },
    }),
  ]);
  return { addOn, claims, emails, option, registration };
};

const readDirectFixtureState = async (
  database: TestDatabase,
  fixture: Fixture,
) => {
  const [addOn, claims, option, purchases, registrations] = await Promise.all([
    database.query.eventAddons.findFirst({
      where: { id: fixture.addOnId },
    }),
    database.query.transactions.findMany({
      where: {
        eventId: fixture.eventId,
        tenantId: fixture.tenantId,
        type: 'registration',
      },
    }),
    database.query.eventRegistrationOptions.findFirst({
      where: { id: fixture.optionId },
    }),
    database.query.eventRegistrationAddonPurchases.findMany({
      where: { addonId: fixture.addOnId },
    }),
    database.query.eventRegistrations.findMany({
      where: {
        eventId: fixture.eventId,
        tenantId: fixture.tenantId,
        userId: fixture.userId,
      },
    }),
  ]);
  return { addOn, claims, option, purchases, registrations };
};

const assertEquivalentStripeRequests = (
  requests: readonly CapturedStripeRequest[],
): void => {
  expect(requests).toHaveLength(2);
  expect(new Set(requests.map((request) => request.idempotencyKey)).size).toBe(
    1,
  );
  expect(new Set(requests.map((request) => request.requestData)).size).toBe(1);
};

const assertStripeRequestUsesTaxRate = (
  request: CapturedStripeRequest | undefined,
  taxRateId: string,
): void => {
  expect(request).toBeDefined();
  expect(
    new URLSearchParams(request?.requestData).get(
      'line_items[0][tax_rates][0]',
    ),
  ).toBe(taxRateId);
};

describe('database registration concurrency invariants', () => {
  let database: TestDatabase;
  const fixtures: Fixture[] = [];
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl, neonLocalProxy }));
    database = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
    for (const fixture of fixtures.toReversed()) {
      await cleanFixture(database, fixture);
    }
    await pool.end();
  });

  it('rejects an active-registration duplicate even when its tenant id is forged', async () => {
    const fixture = await seedFixture(database);
    fixtures.push(fixture);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const forgedTenantId = makeId('tenant', suffix);
    await database.insert(tenants).values({
      domain: `${suffix}.forged-registration.example`,
      id: forgedTenantId,
      name: `Forged registration ${suffix}`,
    });

    try {
      await expect(
        pool.query(
          `
            INSERT INTO event_registrations
              (id, "tenantId", "eventId", "registrationOptionId", status, "userId")
            VALUES ($1, $2, $3, $4, 'PENDING', $5)
          `,
          [
            makeId('forged-reg', suffix),
            forgedTenantId,
            fixture.eventId,
            fixture.optionId,
            fixture.userId,
          ],
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'event_registrations_active_user_event_unique',
      });
    } finally {
      await database
        .delete(eventRegistrations)
        .where(eq(eventRegistrations.tenantId, forgedTenantId));
      await database.delete(tenants).where(eq(tenants.id, forgedTenantId));
    }
  });

  it('rejects a pending-payment duplicate even when its tenant id is forged', async () => {
    const fixture = await seedFixture(database);
    fixtures.push(fixture);
    await database.insert(transactions).values({
      amount: 1000,
      currency: 'EUR',
      eventRegistrationId: fixture.registrationId,
      id: makeId('claim', randomUUID().replaceAll('-', '').slice(0, 8)),
      method: 'stripe',
      status: 'pending',
      tenantId: fixture.tenantId,
      type: 'registration',
    });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const forgedTenantId = makeId('tenant', suffix);
    await database.insert(tenants).values({
      domain: `${suffix}.forged-claim.example`,
      id: forgedTenantId,
      name: `Forged claim ${suffix}`,
    });

    try {
      await expect(
        pool.query(
          `
            INSERT INTO transactions
              (id, "tenantId", amount, currency, "eventRegistrationId", method, status, type)
            VALUES ($1, $2, 1000, 'EUR', $3, 'stripe', 'pending', 'registration')
          `,
          [
            makeId('forged-claim', suffix),
            forgedTenantId,
            fixture.registrationId,
          ],
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'transactions_pending_registration_unique',
      });
    } finally {
      await database
        .delete(transactions)
        .where(eq(transactions.tenantId, forgedTenantId));
      await database.delete(tenants).where(eq(tenants.id, forgedTenantId));
    }
  });

  it('serializes free duplicate registration through tenant membership without consuming stock twice', async () => {
    const fixture = await prepareDirectRegistrationFixture(database);
    fixtures.push(fixture);
    await database
      .update(eventRegistrationOptions)
      .set({ isPaid: false, price: 0 })
      .where(eq(eventRegistrationOptions.id, fixture.optionId));
    const fakeHttpClient = new IdempotentStripeHttpClient();
    const stripe = new StripeClientLibrary('sk_test_concurrency', {
      httpClient: fakeHttpClient,
      maxNetworkRetries: 0,
    });
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
      const input = directRegistrationInput(fixture);
      const first = runRegistration(input, serviceLayer);
      const second = runRegistration(input, serviceLayer);

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
      expect(fakeHttpClient.createRequests).toHaveLength(0);

      const state = await readDirectFixtureState(database, fixture);
      expect(state.registrations).toEqual([
        expect.objectContaining({ status: 'CONFIRMED' }),
      ]);
      expect(state.claims).toHaveLength(0);
      expect(state.option?.confirmedSpots).toBe(1);
      expect(state.option?.reservedSpots).toBe(0);
      expect(state.addOn?.totalAvailableQuantity).toBe(3);
      expect(state.purchases).toEqual([
        expect.objectContaining({ quantity: 2, unitPrice: 0 }),
      ]);
    } finally {
      if (!membershipLock.released) {
        await membershipLock.query('ROLLBACK').catch(() => null);
      }
      membershipLock.release();
    }
  }, 30_000);

  it('keeps transfer notification reads out of inverse shared-user lock cycles', async () => {
    const fixture = await prepareDirectRegistrationFixture(database);
    fixtures.push(fixture);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const recipientUserId = makeId('recipient', suffix);
    const recipientMembershipId = makeId('membership', suffix);
    const sourceRegistrationId = makeId('source-reg', suffix);
    const recipientRegistrationId = makeId('recipient-reg', suffix);

    await database.insert(users).values({
      auth0Id: `auth0|recipient-${suffix}`,
      communicationEmail: `recipient-${suffix}@example.com`,
      email: `recipient-${suffix}@example.com`,
      firstName: 'Recipient',
      id: recipientUserId,
      lastName: 'Tester',
    });
    await database.insert(usersToTenants).values({
      id: recipientMembershipId,
      tenantId: fixture.tenantId,
      userId: recipientUserId,
    });

    const transferClient = await pool.connect();
    const registrationClient = await pool.connect();
    let registrationTransactionOpen = false;
    let transferTransactionOpen = false;

    try {
      await transferClient.query('BEGIN');
      transferTransactionOpen = true;
      await transferClient.query("SET LOCAL lock_timeout = '5s'");
      await registrationClient.query('BEGIN');
      registrationTransactionOpen = true;
      await registrationClient.query("SET LOCAL lock_timeout = '5s'");

      await transferClient.query(
        'SELECT id FROM users WHERE id = $1 FOR UPDATE',
        [recipientUserId],
      );
      const registrationInsert = registrationClient.query(
        `
          /* inverse-user-lock-regression */
          INSERT INTO event_registrations
            (id, "tenantId", "eventId", "registrationOptionId", status, "userId")
          VALUES
            ($1, $2, $3, $4, 'PENDING', $5),
            ($6, $2, $3, $4, 'WAITLIST', $7)
        `,
        [
          sourceRegistrationId,
          fixture.tenantId,
          fixture.eventId,
          fixture.optionId,
          fixture.userId,
          recipientRegistrationId,
          recipientUserId,
        ],
      );

      await waitForBlockedQueries(pool, 'inverse-user-lock-regression', 1);
      const sourceUserRead = await transferClient.query<{ email: string }>(
        'SELECT email FROM users WHERE id = $1',
        [fixture.userId],
      );
      expect(sourceUserRead.rows).toHaveLength(1);
      expect(sourceUserRead.rows[0]?.email).toContain('@example.com');

      await transferClient.query('COMMIT');
      transferTransactionOpen = false;
      await registrationInsert;
      await registrationClient.query('COMMIT');
      registrationTransactionOpen = false;

      const insertedRegistrations =
        await database.query.eventRegistrations.findMany({
          where: {
            id: { in: [sourceRegistrationId, recipientRegistrationId] },
            tenantId: fixture.tenantId,
          },
        });
      expect(insertedRegistrations).toHaveLength(2);
    } finally {
      if (registrationTransactionOpen) {
        await registrationClient.query('ROLLBACK').catch(() => null);
      }
      if (transferTransactionOpen) {
        await transferClient.query('ROLLBACK').catch(() => null);
      }
      registrationClient.release();
      transferClient.release();
      await database
        .delete(eventRegistrations)
        .where(
          inArray(eventRegistrations.id, [
            sourceRegistrationId,
            recipientRegistrationId,
          ]),
        );
      await database
        .delete(usersToTenants)
        .where(eq(usersToTenants.id, recipientMembershipId));
      await database.delete(users).where(eq(users.id, recipientUserId));
    }
  }, 30_000);
});

describe('paid manual approval concurrency', () => {
  let database: TestDatabase;
  const fixtures: Fixture[] = [];
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl, neonLocalProxy }));
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

  it('shares one durable claim, reservation, email, and Stripe session across simultaneous approvals', async () => {
    const fixture = await seedFixture(database);
    fixtures.push(fixture);
    const { promise: createGate, resolve: releaseCreates } =
      Promise.withResolvers<boolean>();
    const fakeHttpClient = new IdempotentStripeHttpClient();
    fakeHttpClient.holdCreatesUntil(createGate);
    const stripe = new StripeClientLibrary('sk_test_concurrency', {
      httpClient: fakeHttpClient,
      maxNetworkRetries: 0,
    });
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);
    const registrationLock = await withRowLock(pool, async (client) => {
      await client.query(
        'SELECT id FROM event_registrations WHERE id = $1 FOR UPDATE',
        [fixture.registrationId],
      );
    });

    try {
      const first = runApproval(approvalInput(fixture), serviceLayer);
      const second = runApproval(approvalInput(fixture), serviceLayer);

      await waitForBlockedQueries(pool, 'event_registrations', 2);
      await registrationLock.query('COMMIT');
      await waitFor(
        () => fakeHttpClient.createRequests.length === 2,
        'Timed out waiting for both idempotent Stripe requests',
      );
      releaseCreates(true);

      const outcomes = await Promise.all([first, second]);
      expect(outcomes).toEqual([
        { status: 'success', value: { status: 'paymentPending' } },
        { status: 'success', value: { status: 'paymentPending' } },
      ]);
      assertEquivalentStripeRequests(fakeHttpClient.createRequests);
      expect(new Set(fakeHttpClient.createdSessionIds).size).toBe(1);

      const state = await readFixtureState(database, fixture);
      expect(state.claims).toEqual([
        expect.objectContaining({
          amount: 1000,
          status: 'pending',
          stripeCheckoutSessionId: fakeHttpClient.createdSessionIds[0],
        }),
      ]);
      const claim = state.claims[0];
      expect(fakeHttpClient.createRequests[0]?.idempotencyKey).toBe(
        claim
          ? `registration:${fixture.registrationId}:transaction:${claim.id}`
          : undefined,
      );
      expect(state.option?.reservedSpots).toBe(1);
      expect(state.option?.confirmedSpots).toBe(0);
      expect(state.addOn?.totalAvailableQuantity).toBe(3);
      expect(state.emails).toHaveLength(1);
    } finally {
      releaseCreates(true);
      if (!registrationLock.released) {
        await registrationLock.query('ROLLBACK').catch(() => null);
      }
      registrationLock.release();
    }
  }, 30_000);

  it('reuses the original claim and checkout snapshot after an ambiguous Stripe failure', async () => {
    const fixture = await seedFixture(database);
    fixtures.push(fixture);
    const fakeHttpClient = new IdempotentStripeHttpClient();
    fakeHttpClient.failNextCreateAmbiguously();
    const stripe = new StripeClientLibrary('sk_test_concurrency', {
      httpClient: fakeHttpClient,
      maxNetworkRetries: 0,
    });
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);

    const firstOutcome = await runApproval(
      approvalInput(fixture),
      serviceLayer,
    );
    expect(firstOutcome).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          _tag: 'EventRegistrationInternalError',
          message:
            'Payment setup is still pending. Retry approval or cancel the registration.',
        }),
        status: 'failure',
      }),
    );

    const stateAfterFailure = await readFixtureState(database, fixture);
    expect(stateAfterFailure.claims).toEqual([
      expect.objectContaining({
        status: 'pending',
        stripeCheckoutSessionId: null,
      }),
    ]);
    expect(stateAfterFailure.option?.reservedSpots).toBe(1);
    expect(stateAfterFailure.addOn?.totalAvailableQuantity).toBe(3);
    expect(stateAfterFailure.emails).toHaveLength(0);

    const retryOutcome = await runApproval(
      approvalInput(fixture),
      serviceLayer,
    );
    expect(retryOutcome).toEqual({
      status: 'success',
      value: { status: 'paymentPending' },
    });
    assertEquivalentStripeRequests(fakeHttpClient.createRequests);
    assertStripeRequestUsesTaxRate(
      fakeHttpClient.createRequests[0],
      fixture.taxRateId,
    );
    expect(new Set(fakeHttpClient.createdSessionIds).size).toBe(1);

    const finalState = await readFixtureState(database, fixture);
    expect(finalState.claims).toEqual([
      expect.objectContaining({
        id: stateAfterFailure.claims[0]?.id,
        status: 'pending',
        stripeCheckoutRequest:
          stateAfterFailure.claims[0]?.stripeCheckoutRequest,
        stripeCheckoutSessionId: fakeHttpClient.createdSessionIds[0],
      }),
    ]);
    expect(finalState.option?.reservedSpots).toBe(1);
    expect(finalState.addOn?.totalAvailableQuantity).toBe(3);
    expect(finalState.emails).toHaveLength(1);
  }, 30_000);

  it('re-reads a concurrently created claim during cancellation and expires an unbindable session', async () => {
    const fixture = await seedFixture(database);
    fixtures.push(fixture);
    const { promise: createGate, resolve: releaseCreates } =
      Promise.withResolvers<boolean>();
    const fakeHttpClient = new IdempotentStripeHttpClient();
    fakeHttpClient.holdCreatesUntil(createGate);
    const stripe = new StripeClientLibrary('sk_test_concurrency', {
      httpClient: fakeHttpClient,
      maxNetworkRetries: 0,
    });
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);
    const registrationLock = await withRowLock(pool, async (client) => {
      await client.query(
        'SELECT id FROM event_registrations WHERE id = $1 FOR UPDATE',
        [fixture.registrationId],
      );
    });

    try {
      const approval = runApproval(approvalInput(fixture), serviceLayer);
      await waitForBlockedQueries(pool, 'event_registrations', 1);
      const cancellation = runCancellation({ fixture, serviceLayer });
      await waitForBlockedQueries(pool, 'event_registrations', 2);
      await registrationLock.query('COMMIT');

      await waitFor(
        () => fakeHttpClient.createRequests.length === 1,
        'Timed out waiting for the approval to create its Stripe session',
      );
      expect(await cancellation).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({
            _tag: 'EventRegistrationConflictError',
            message:
              'Registration status or payment state changed after confirmation, so nothing was cancelled, no refund was created, and no spots or inventory were released. Refresh, review the current registration, then confirm again.',
          }),
          status: 'failure',
        }),
      );
      releaseCreates(true);

      const approvalOutcome = await approval;
      expect(approvalOutcome).toEqual({
        status: 'success',
        value: { status: 'paymentPending' },
      });
      expect(
        await runCancellation({
          expectedPaymentPending: true,
          fixture,
          serviceLayer,
        }),
      ).toEqual({ status: 'success' });
      expect(fakeHttpClient.expiredSessionIds).toEqual(
        fakeHttpClient.createdSessionIds,
      );

      const state = await readFixtureState(database, fixture);
      expect(state.registration?.status).toBe('CANCELLED');
      expect(state.claims).toEqual([
        expect.objectContaining({
          status: 'cancelled',
          stripeCheckoutSessionId: fakeHttpClient.createdSessionIds[0],
        }),
      ]);
      expect(state.option?.reservedSpots).toBe(0);
      expect(state.option?.confirmedSpots).toBe(0);
      expect(state.addOn?.totalAvailableQuantity).toBe(5);
      expect(state.emails).toHaveLength(2);
    } finally {
      releaseCreates(true);
      if (!registrationLock.released) {
        await registrationLock.query('ROLLBACK').catch(() => null);
      }
      registrationLock.release();
    }
  }, 30_000);
});

describe('direct paid registration concurrency', () => {
  let database: TestDatabase;
  const fixtures: Fixture[] = [];
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl, neonLocalProxy }));
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

  it('keeps one durable registration, reservation, add-on purchase, claim, and Stripe session across simultaneous attempts', async () => {
    const fixture = await prepareDirectRegistrationFixture(database);
    fixtures.push(fixture);
    const { promise: createGate, resolve: releaseCreates } =
      Promise.withResolvers<boolean>();
    const fakeHttpClient = new IdempotentStripeHttpClient();
    fakeHttpClient.holdCreatesUntil(createGate);
    const stripe = new StripeClientLibrary('sk_test_concurrency', {
      httpClient: fakeHttpClient,
      maxNetworkRetries: 0,
    });
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);
    const tenantLock = await withRowLock(pool, async (client) => {
      await client.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [
        fixture.tenantId,
      ]);
    });

    try {
      const input = directRegistrationInput(fixture);
      const first = runRegistration(input, serviceLayer);
      const second = runRegistration(input, serviceLayer);

      await waitForBlockedQueries(pool, 'tenants', 2);
      await tenantLock.query('COMMIT');
      await waitFor(
        () => fakeHttpClient.createRequests.length === 1,
        'Timed out waiting for the winning registration to create its Stripe session',
      );
      releaseCreates(true);

      const outcomes = await Promise.all([first, second]);
      expect(
        outcomes.filter(({ status }) => status === 'success'),
      ).toHaveLength(1);
      expect(outcomes.filter(({ status }) => status === 'failure')).toEqual([
        expect.objectContaining({
          error: expect.objectContaining({
            _tag: 'EventRegistrationConflictError',
            message: 'User is already registered for this event',
          }),
          status: 'failure',
        }),
      ]);
      expect(fakeHttpClient.createRequests).toHaveLength(1);
      expect(fakeHttpClient.createdSessionIds).toHaveLength(1);

      const state = await readDirectFixtureState(database, fixture);
      expect(state.registrations).toEqual([
        expect.objectContaining({
          status: 'PENDING',
        }),
      ]);
      const registration = state.registrations[0];
      expect(state.claims).toEqual([
        expect.objectContaining({
          amount: 1000,
          eventRegistrationId: registration?.id,
          status: 'pending',
          stripeCheckoutSessionId: fakeHttpClient.createdSessionIds[0],
        }),
      ]);
      const claim = state.claims[0];
      expect(fakeHttpClient.createRequests[0]?.idempotencyKey).toBe(
        registration && claim
          ? `registration:${registration.id}:transaction:${claim.id}`
          : undefined,
      );
      expect(state.option?.reservedSpots).toBe(1);
      expect(state.option?.confirmedSpots).toBe(0);
      expect(state.addOn?.totalAvailableQuantity).toBe(3);
      expect(state.purchases).toEqual([
        expect.objectContaining({
          quantity: 2,
          registrationId: registration?.id,
        }),
      ]);
    } finally {
      releaseCreates(true);
      if (!tenantLock.released) {
        await tenantLock.query('ROLLBACK').catch(() => null);
      }
      tenantLock.release();
    }
  }, 30_000);

  it('retries an ambiguous direct Checkout attempt with the same claim and request snapshot', async () => {
    const fixture = await prepareDirectRegistrationFixture(database);
    fixtures.push(fixture);
    const fakeHttpClient = new IdempotentStripeHttpClient();
    fakeHttpClient.failNextCreateAmbiguously();
    const stripe = new StripeClientLibrary('sk_test_concurrency', {
      httpClient: fakeHttpClient,
      maxNetworkRetries: 0,
    });
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);
    const input = directRegistrationInput(fixture);

    const firstOutcome = await runRegistration(input, serviceLayer);
    expect(firstOutcome).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          _tag: 'EventRegistrationInternalError',
          message:
            'Payment setup is still pending. Retry registration or cancel it.',
        }),
        status: 'failure',
      }),
    );

    const stateAfterFailure = await readDirectFixtureState(database, fixture);
    expect(stateAfterFailure.registrations).toHaveLength(1);
    expect(stateAfterFailure.claims).toEqual([
      expect.objectContaining({
        status: 'pending',
        stripeCheckoutSessionId: null,
      }),
    ]);
    expect(stateAfterFailure.option?.reservedSpots).toBe(1);
    expect(stateAfterFailure.addOn?.totalAvailableQuantity).toBe(3);
    expect(stateAfterFailure.purchases).toHaveLength(1);

    expect(await runRegistration(input, serviceLayer)).toEqual({
      status: 'success',
    });
    assertEquivalentStripeRequests(fakeHttpClient.createRequests);
    assertStripeRequestUsesTaxRate(
      fakeHttpClient.createRequests[0],
      fixture.taxRateId,
    );
    expect(fakeHttpClient.createdSessionIds).toHaveLength(1);

    const finalState = await readDirectFixtureState(database, fixture);
    expect(finalState.registrations).toEqual(stateAfterFailure.registrations);
    expect(finalState.claims).toEqual([
      expect.objectContaining({
        id: stateAfterFailure.claims[0]?.id,
        stripeCheckoutRequest:
          stateAfterFailure.claims[0]?.stripeCheckoutRequest,
        stripeCheckoutSessionId: fakeHttpClient.createdSessionIds[0],
      }),
    ]);
    expect(finalState.option?.reservedSpots).toBe(1);
    expect(finalState.addOn?.totalAvailableQuantity).toBe(3);
    expect(finalState.purchases).toEqual(stateAfterFailure.purchases);
  }, 30_000);
});
