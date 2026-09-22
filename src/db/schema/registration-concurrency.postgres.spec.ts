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
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import StripeClientLibrary from 'stripe';

import { EventRegistrationService } from '../../server/effect/rpc/handlers/events/event-registration.service';
import { eventRegistrationHandlers } from '../../server/effect/rpc/handlers/events/events-registration.handlers';
import { RpcAccess } from '../../server/effect/rpc/handlers/shared/rpc-access.service';
import { StripeClient } from '../../server/stripe-client';
import {
  AppRpcs,
  RpcRequestContext,
  RpcRequestContextMiddleware,
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

interface CapturedStripeRequest {
  readonly idempotencyKey: string;
  readonly requestData: string;
}

interface FakeStripeSession {
  readonly amount_total: number;
  readonly cancel_url: null | string;
  readonly currency: null | string;
  readonly customer_email: null | string;
  readonly expires_at: number;
  readonly id: string;
  readonly metadata: Record<string, string>;
  readonly mode: 'payment';
  readonly object: 'checkout.session';
  readonly payment_intent: null;
  readonly payment_status: 'unpaid';
  readonly status: 'expired' | 'open';
  readonly success_url: null | string;
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
        this.createSession(this.sessionsByIdempotencyKey.size + 1, requestData);
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
      if (!existingSession) {
        throw new Error(`Cannot expire unknown test session ${sessionId}`);
      }
      return new JsonStripeResponse({
        ...existingSession,
        id: sessionId,
        status: 'expired',
        url: null,
      } satisfies FakeStripeSession);
    }

    throw new Error(`Unexpected Stripe request: ${method} ${path}`);
  }

  private createSession(
    sequence: number,
    requestData: string,
  ): FakeStripeSession {
    const id = `cs_test_${this.sessionNamespace}_${sequence}`;
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
    return {
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

const communicationEmailForUser = (userId: string) =>
  `${userId}.contact@example.com`;

const loginEmailForUser = (userId: string) => `${userId}.login@example.com`;

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
  operationCompleted?: () => boolean,
) =>
  waitFor(async () => {
    if (operationCompleted?.()) {
      throw new Error(
        `Operation completed before reaching its expected ${queryFragment} lock`,
      );
    }
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

const runWithCleanup = async <A>(
  use: () => Promise<A>,
  cleanups: readonly (() => Promise<void> | void)[],
) => {
  const failures: unknown[] = [];
  let outcome: { error: unknown } | { value: A };
  try {
    outcome = { value: await use() };
  } catch (error) {
    outcome = { error };
    failures.push(error);
  }
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Test operation and cleanup failed', {
      cause: failures[0],
    });
  }
  if (failures.length === 1) throw failures[0];
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
};

const createPendingOperationTracker = () => {
  const settlements: Promise<unknown>[] = [];
  const failures: unknown[] = [];
  return {
    drain: async () => {
      await Promise.all(settlements);
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Concurrent test operations failed');
      }
    },
    track: <A>(operation: PromiseLike<A>): Promise<A> => {
      const promise = Promise.resolve(operation);
      settlements.push(
        promise.catch((error: unknown) => {
          failures.push(error);
        }),
      );
      return promise;
    },
  };
};

const releaseRowLock = (
  client: Pick<PoolClient, 'query' | 'release'>,
  transactionOpen: boolean,
  discard = false,
) => {
  let discardClient = discard;
  return runWithCleanup(async () => {
    if (!transactionOpen) return;
    try {
      await client.query('ROLLBACK');
    } catch (error) {
      discardClient = true;
      throw error;
    }
  }, [() => client.release(discardClient)]);
};
const withRowLock = async (
  pool: Pool,
  lock: (client: PoolClient) => Promise<void>,
) => {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await lock(client);

    let released = false;
    return {
      query: client.query.bind(client),
      release: (destroy = false) => {
        client.release(destroy);
        released = true;
      },
      get released() {
        return released;
      },
    };
  } catch (error) {
    return runWithCleanup(async () => {
      throw error;
    }, [() => releaseRowLock(client, transactionOpen, !transactionOpen)]);
  }
};

const makeConfigLayer = (url: string) =>
  ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: Object.fromEntries([
        ['BASE_URL', 'https://concurrency.example'],
        ['CLIENT_ID', 'client-id'],
        ['CLIENT_SECRET', 'client-secret'],
        ['DATABASE_TLS_REQUIRED', 'false'],
        ['DATABASE_URL', url],
        ['ISSUER_BASE_URL', 'https://issuer.example'],
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
type RegistrationCheckoutRetryInput = Parameters<
  typeof EventRegistrationService.retryRegistrationCheckout
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

const runRegistrationCheckoutRetry = (
  input: RegistrationCheckoutRetryInput,
  serviceLayer: ReturnType<typeof makeServiceLayer>,
) =>
  Effect.runPromise(
    EventRegistrationService.retryRegistrationCheckout(input).pipe(
      Effect.match({
        onFailure: (error) => ({ error, status: 'failure' as const }),
        onSuccess: () => ({ status: 'success' as const }),
      }),
      Effect.provide(EventRegistrationService.Default),
      Effect.provide(serviceLayer),
    ),
  );

const cancellationRpc = [...AppRpcs.requests.values()].find(
  (rpc) => rpc._tag === 'events.cancelRegistration',
);
if (!cancellationRpc) throw new Error('Cancellation RPC is missing');
const cancellationOptions = {
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: cancellationRpc.middleware(RpcRequestContextMiddleware),
};
const checkInRpc = [...AppRpcs.requests.values()].find(
  (rpc) => rpc._tag === 'events.checkInRegistration',
);
if (!checkInRpc) throw new Error('Check-in RPC is missing');
const checkInOptions = {
  client: new Rpc.ServerClient(1),
  headers: Headers.empty,
  requestId: RpcMessage.RequestId(1),
  rpc: checkInRpc.middleware(RpcRequestContextMiddleware),
};

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
      cancellationDeadlineHoursBeforeStart: 120,
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
      logoUrl: undefined,
      maxActiveRegistrationsPerUser: 0,
      name: 'Concurrency test',
      privacyPolicyText: undefined,
      privacyPolicyUrl: undefined,
      receiptSettings: {
        allowOther: false,
        receiptCountries: ['DE'],
      },
      refundFeesOnCancellation: true,
      seoDescription: undefined,
      seoTitle: undefined,
      stripeAccountId: `acct_${fixture.tenantId.replace('tenant-', '')}`,
      termsText: undefined,
      termsUrl: undefined,
      theme: 'evorto',
      timezone: 'Europe/Berlin',
      transferDeadlineHoursBeforeStart: 0,
    },
    user: {
      auth0Id: `auth0|${fixture.userId}`,
      communicationEmail: communicationEmailForUser(fixture.userId),
      email: `${fixture.userId}@example.com`,
      firstName: 'Concurrent',
      homeTenantId: undefined,
      homeTenantName: undefined,
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
      cancellationOptions,
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

const runCheckIn = ({
  fixture,
  guestCheckInCount,
  serviceLayer,
}: {
  fixture: Fixture;
  guestCheckInCount: number;
  serviceLayer: ReturnType<typeof makeServiceLayer>;
}) => {
  const permissions = ['events:organizeAll'] as const;
  const scannerUserId = makeId('scanner', fixture.tenantId);
  const requestContext = {
    authData: {},
    authenticated: true,
    permissions,
    tenant: {
      cancellationDeadlineHoursBeforeStart: 120,
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
      logoUrl: undefined,
      maxActiveRegistrationsPerUser: 0,
      name: 'Concurrency test',
      receiptSettings: {
        allowOther: false,
        receiptCountries: ['DE'],
      },
      refundFeesOnCancellation: true,
      seoDescription: undefined,
      seoTitle: undefined,
      stripeAccountId: `acct_${fixture.tenantId.replace('tenant-', '')}`,
      termsText: undefined,
      termsUrl: undefined,
      theme: 'evorto',
      timezone: 'Europe/Berlin',
      transferDeadlineHoursBeforeStart: 0,
    },
    user: {
      auth0Id: `auth0|${scannerUserId}`,
      communicationEmail: communicationEmailForUser(scannerUserId),
      email: loginEmailForUser(scannerUserId),
      firstName: 'Scanner',
      homeTenantId: fixture.tenantId,
      homeTenantName: 'Concurrency test',
      iban: undefined,
      id: scannerUserId,
      lastName: 'Tester',
      paypalEmail: undefined,
      permissions,
      roleIds: [],
    },
    userAssigned: true,
  } satisfies RpcRequestContextShape;

  return Effect.runPromise(
    eventRegistrationHandlers['events.checkInRegistration'](
      {
        guestCheckInCount,
        registrationId: fixture.registrationId,
      },
      checkInOptions,
    ).pipe(
      Effect.match({
        onFailure: (error) => ({ error, status: 'failure' as const }),
        onSuccess: (value) => ({ status: 'success' as const, value }),
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
    timezone: 'Europe/Berlin',
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
    emailSenderEmail: undefined,
    emailSenderName: undefined,
    id: fixture.tenantId,
    maxActiveRegistrationsPerUser: 0,
    name: 'Concurrency test',
    stripeAccountId: `acct_${fixture.tenantId.replace('tenant-', '')}`,
  },
  user: {
    communicationEmail: communicationEmailForUser(fixture.userId),
    email: loginEmailForUser(fixture.userId),
    id: fixture.userId,
    roleIds: [],
  },
});

const insertFixture = async (
  database: Pick<TestDatabase, 'insert'>,
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
    communicationEmail: communicationEmailForUser(userId),
    email: loginEmailForUser(userId),
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
    reviewedAt: new Date(now),
    reviewedBy: userId,
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
    basePriceAtRegistration: 1000,
    discountAmount: 0,
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

const seedFixture = (database: TestDatabase): Promise<Fixture> =>
  database.transaction(insertFixture);

const prepareDirectRegistrationFixture = (
  database: TestDatabase,
): Promise<Fixture> =>
  database.transaction(async (transaction) => {
    const fixture = await insertFixture(transaction);
    await transaction
      .delete(eventRegistrationAddonPurchaseLots)
      .where(
        eq(
          eventRegistrationAddonPurchaseLots.registrationId,
          fixture.registrationId,
        ),
      );
    await transaction
      .delete(eventRegistrationAddonPurchases)
      .where(
        eq(
          eventRegistrationAddonPurchases.registrationId,
          fixture.registrationId,
        ),
      );
    await transaction
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, fixture.registrationId));
    await transaction
      .update(eventRegistrationOptions)
      .set({ registrationMode: 'fcfs' })
      .where(eq(eventRegistrationOptions.id, fixture.optionId));
    return fixture;
  });

const prepareCheckInFixture = (
  database: TestDatabase,
  { guestCount }: { guestCount: number },
): Promise<Fixture> =>
  database.transaction(async (transaction) => {
    const fixture = await insertFixture(transaction);
    const now = Date.now();
    await transaction
      .update(eventInstances)
      .set({
        end: new Date(now + 2 * 60 * 60 * 1000),
        start: new Date(now + 30 * 60 * 1000),
      })
      .where(eq(eventInstances.id, fixture.eventId));
    await transaction
      .update(eventRegistrations)
      .set({
        checkedInGuestCount: 0,
        checkInTime: null,
        guestCount,
        status: 'CONFIRMED',
      })
      .where(eq(eventRegistrations.id, fixture.registrationId));
    await transaction
      .update(eventRegistrationOptions)
      .set({
        checkedInSpots: 0,
        confirmedSpots: guestCount + 1,
      })
      .where(eq(eventRegistrationOptions.id, fixture.optionId));
    return fixture;
  });

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
  const operations = createPendingOperationTracker();
  const reads = [
    operations.track(
      database.query.transactions.findMany({
        where: {
          eventRegistrationId: fixture.registrationId,
          tenantId: fixture.tenantId,
          type: 'registration',
        },
      }),
    ),
    operations.track(
      database.query.eventRegistrationOptions.findFirst({
        where: { id: fixture.optionId },
      }),
    ),
    operations.track(
      database.query.eventAddons.findFirst({
        where: { id: fixture.addOnId },
      }),
    ),
    operations.track(
      database.query.emailOutbox.findMany({
        where: { tenantId: fixture.tenantId },
      }),
    ),
    operations.track(
      database.query.eventRegistrations.findFirst({
        where: { id: fixture.registrationId, tenantId: fixture.tenantId },
      }),
    ),
  ] as const;
  const [claims, option, addOn, emails, registration] = await runWithCleanup(
    () => Promise.all(reads),
    [operations.drain],
  );
  return { addOn, claims, emails, option, registration };
};

const readDirectFixtureState = async (
  database: TestDatabase,
  fixture: Fixture,
) => {
  const operations = createPendingOperationTracker();
  const reads = [
    operations.track(
      database.query.eventAddons.findFirst({
        where: { id: fixture.addOnId },
      }),
    ),
    operations.track(
      database.query.transactions.findMany({
        where: {
          eventId: fixture.eventId,
          tenantId: fixture.tenantId,
          type: 'registration',
        },
      }),
    ),
    operations.track(
      database.query.emailOutbox.findMany({
        where: { tenantId: fixture.tenantId },
      }),
    ),
    operations.track(
      database.query.eventRegistrationOptions.findFirst({
        where: { id: fixture.optionId },
      }),
    ),
    operations.track(
      database.query.eventRegistrationAddonPurchases.findMany({
        where: { addonId: fixture.addOnId },
      }),
    ),
    operations.track(
      database.query.eventRegistrations.findMany({
        where: {
          eventId: fixture.eventId,
          tenantId: fixture.tenantId,
          userId: fixture.userId,
        },
      }),
    ),
  ] as const;
  const [addOn, claims, emails, option, purchases, registrations] =
    await runWithCleanup(() => Promise.all(reads), [operations.drain]);
  return { addOn, claims, emails, option, purchases, registrations };
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
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
    for (const fixture of fixtures.toReversed()) {
      await cleanFixture(database, fixture);
    }
    await pool.end();
  });

  it('rejects an incomplete finalized add-on payment allocation', async () => {
    const fixture = await seedFixture(database);
    fixtures.push(fixture);
    const purchaseLot =
      await database.query.eventRegistrationAddonPurchaseLots.findFirst({
        columns: { id: true },
        where: { registrationId: fixture.registrationId },
      });

    if (!purchaseLot) {
      throw new Error('Expected seeded add-on purchase lot');
    }
    await expect(
      pool.query(
        `UPDATE event_registration_addon_purchase_lots SET tax_amount = NULL WHERE id = $1`,
        [purchaseLot.id],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint:
        'event_registration_addon_purchase_lots_payment_allocation_shape',
    });
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
      eventId: fixture.eventId,
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
              (id, "tenantId", amount, currency, "eventId", "eventRegistrationId", method, status, type)
            VALUES ($1, $2, 1000, 'EUR', $3, $4, 'stripe', 'pending', 'registration')
          `,
          [
            makeId('forged-claim', suffix),
            forgedTenantId,
            fixture.eventId,
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
      .set({ isPaid: false, price: 0, stripeTaxRateId: null })
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
    let membershipTransactionOpen = true;

    const operations = createPendingOperationTracker();

    await runWithCleanup(async () => {
      const input = directRegistrationInput(fixture);
      const first = operations.track(runRegistration(input, serviceLayer));
      const second = operations.track(runRegistration(input, serviceLayer));

      await waitForBlockedQueries(pool, 'users_to_tenants', 1);
      await waitForBlockedQueries(pool, 'event_instances', 1);
      await membershipLock.query('COMMIT');
      membershipTransactionOpen = false;

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
            message: 'You are already signed up for this event.',
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
      expect(state.emails).toEqual([
        expect.objectContaining({
          toEmail: communicationEmailForUser(fixture.userId),
        }),
      ]);
    }, [
      () => releaseRowLock(membershipLock, membershipTransactionOpen),
      operations.drain,
    ]);
  }, 30_000);

  it('rejects check-in when cancellation wins the registration lock', async () => {
    const fixture = await prepareCheckInFixture(database, { guestCount: 0 });
    fixtures.push(fixture);
    const fakeHttpClient = new IdempotentStripeHttpClient();
    const stripe = new StripeClientLibrary('sk_test_concurrency', {
      httpClient: fakeHttpClient,
      maxNetworkRetries: 0,
    });
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);
    const registrationLock = await withRowLock(pool, async (client) => {
      await client.query(
        `
          SELECT id
          FROM event_registrations
          WHERE id = $1
          FOR UPDATE
        `,
        [fixture.registrationId],
      );
    });
    let registrationTransactionOpen = true;

    const operations = createPendingOperationTracker();

    await runWithCleanup(async () => {
      const checkIn = operations.track(
        runCheckIn({
          fixture,
          guestCheckInCount: 0,
          serviceLayer,
        }),
      );

      await waitForBlockedQueries(pool, 'event_registrations', 1);
      await registrationLock.query(
        `
          UPDATE event_registrations
          SET status = 'CANCELLED'
          WHERE id = $1
        `,
        [fixture.registrationId],
      );
      await registrationLock.query('COMMIT');
      registrationTransactionOpen = false;

      expect(await checkIn).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({
            _tag: 'EventRegistrationConflictError',
            message: 'This ticket is not ready for check-in.',
          }),
          status: 'failure',
        }),
      );

      const state = await readFixtureState(database, fixture);
      expect(state.registration).toEqual(
        expect.objectContaining({
          checkInTime: null,
          status: 'CANCELLED',
        }),
      );
      expect(state.option?.checkedInSpots).toBe(0);
      expect(fakeHttpClient.createRequests).toHaveLength(0);
    }, [
      () => releaseRowLock(registrationLock, registrationTransactionOpen),
      operations.drain,
    ]);
  }, 30_000);

  it('serializes competing guest check-ins without overcounting', async () => {
    const fixture = await prepareCheckInFixture(database, { guestCount: 1 });
    fixtures.push(fixture);
    const fakeHttpClient = new IdempotentStripeHttpClient();
    const stripe = new StripeClientLibrary('sk_test_concurrency', {
      httpClient: fakeHttpClient,
      maxNetworkRetries: 0,
    });
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);
    const registrationLock = await withRowLock(pool, async (client) => {
      await client.query(
        `
          SELECT id
          FROM event_registrations
          WHERE id = $1
          FOR UPDATE
        `,
        [fixture.registrationId],
      );
    });
    let registrationTransactionOpen = true;

    const operations = createPendingOperationTracker();

    await runWithCleanup(async () => {
      const first = operations.track(
        runCheckIn({
          fixture,
          guestCheckInCount: 1,
          serviceLayer,
        }),
      );
      const second = operations.track(
        runCheckIn({
          fixture,
          guestCheckInCount: 1,
          serviceLayer,
        }),
      );

      await waitForBlockedQueries(pool, 'event_registrations', 2);
      await registrationLock.query('COMMIT');
      registrationTransactionOpen = false;

      const outcomes = await Promise.all([first, second]);
      const successfulOutcomes = outcomes.filter(
        (outcome) => outcome.status === 'success',
      );
      expect(successfulOutcomes).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => outcome.status === 'failure'),
      ).toEqual([
        expect.objectContaining({
          error: expect.objectContaining({
            _tag: 'EventRegistrationConflictError',
            message: 'Enter no more than 0 additional guests.',
          }),
        }),
      ]);

      const successfulOutcome = successfulOutcomes[0];
      if (!successfulOutcome || successfulOutcome.status !== 'success') {
        throw new Error('Expected one successful guest check-in');
      }
      const state = await readFixtureState(database, fixture);
      expect(state.registration?.checkedInGuestCount).toBe(1);
      expect(state.registration?.checkInTime).toBeInstanceOf(Date);
      expect(state.option?.checkedInSpots).toBe(2);
      expect(successfulOutcome.value).toEqual({
        alreadyCheckedIn: false,
        checkInTime: state.registration?.checkInTime?.toISOString(),
      });
      expect(fakeHttpClient.createRequests).toHaveLength(0);
    }, [
      () => releaseRowLock(registrationLock, registrationTransactionOpen),
      operations.drain,
    ]);
  }, 30_000);

  it('keeps transfer notification reads out of inverse shared-user lock cycles', async () => {
    const fixture = await prepareDirectRegistrationFixture(database);
    fixtures.push(fixture);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const recipientUserId = makeId('recipient', suffix);
    const recipientMembershipId = makeId('membership', suffix);
    const sourceRegistrationId = makeId('source-reg', suffix);
    const recipientRegistrationId = makeId('recipient-reg', suffix);

    let transferClient: PoolClient | undefined;
    let registrationClient: PoolClient | undefined;
    let registrationTransactionOpen = false;
    let transferTransactionOpen = false;

    const operations = createPendingOperationTracker();

    await runWithCleanup(async () => {
      await database.insert(users).values({
        auth0Id: `auth0|recipient-${suffix}`,
        communicationEmail: communicationEmailForUser(recipientUserId),
        email: loginEmailForUser(recipientUserId),
        firstName: 'Recipient',
        id: recipientUserId,
        lastName: 'Tester',
      });
      await database.insert(usersToTenants).values({
        id: recipientMembershipId,
        tenantId: fixture.tenantId,
        userId: recipientUserId,
      });

      transferClient = await pool.connect();
      registrationClient = await pool.connect();

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
      const registrationInsert = operations.track(
        registrationClient.query(
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
        ),
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
    }, [
      async () => {
        if (transferClient) {
          await releaseRowLock(transferClient, transferTransactionOpen);
        }
      },
      async () => {
        if (registrationClient) {
          await releaseRowLock(registrationClient, registrationTransactionOpen);
        }
      },
      operations.drain,
      async () => {
        await database
          .delete(eventRegistrations)
          .where(
            inArray(eventRegistrations.id, [
              sourceRegistrationId,
              recipientRegistrationId,
            ]),
          );
      },
      async () => {
        await database
          .delete(usersToTenants)
          .where(eq(usersToTenants.id, recipientMembershipId));
      },
      async () => {
        await database.delete(users).where(eq(users.id, recipientUserId));
      },
    ]);
  }, 30_000);
});

describe('paid manual approval concurrency', () => {
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

  it('keeps an included-only priced add-on out of manual approval Checkout lines', async () => {
    const fixture = await seedFixture(database);
    fixtures.push(fixture);
    const addOnPrice = 500;
    await database
      .delete(eventRegistrationAddonPurchaseLots)
      .where(
        eq(
          eventRegistrationAddonPurchaseLots.registrationId,
          fixture.registrationId,
        ),
      );
    await database
      .update(eventAddons)
      .set({
        isPaid: true,
        price: addOnPrice,
        stripeTaxRateId: fixture.taxRateId,
      })
      .where(eq(eventAddons.id, fixture.addOnId));
    await database
      .update(eventRegistrationAddonPurchases)
      .set({
        purchasedQuantity: 0,
        quantity: 1,
        unitPrice: addOnPrice,
      })
      .where(
        eq(
          eventRegistrationAddonPurchases.registrationId,
          fixture.registrationId,
        ),
      );
    const fakeHttpClient = new IdempotentStripeHttpClient();
    const stripe = new StripeClientLibrary('sk_test_concurrency', {
      httpClient: fakeHttpClient,
      maxNetworkRetries: 0,
    });
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);

    expect(await runApproval(approvalInput(fixture), serviceLayer)).toEqual({
      status: 'success',
      value: { status: 'paymentPending' },
    });
    expect(fakeHttpClient.createRequests).toHaveLength(1);

    const state = await readFixtureState(database, fixture);
    const claim = state.claims[0];
    if (!claim?.stripeCheckoutRequest) {
      throw new Error('Expected one pending registration Checkout');
    }
    expect(claim).toEqual(
      expect.objectContaining({
        amount: 1000,
        status: 'pending',
      }),
    );
    expect(claim.stripeCheckoutRequest.lineItems).toEqual([
      {
        name: 'Registration fee for Concurrency fixture',
        quantity: 1,
        taxRateId: fixture.taxRateId,
        unitAmount: 1000,
      },
    ]);
    expect(claim.stripeCheckoutRequest).toEqual(
      expect.objectContaining({
        customerEmail: communicationEmailForUser(fixture.userId),
        notificationEmail: communicationEmailForUser(fixture.userId),
      }),
    );
    expect(
      await database.query.eventRegistrationAddonPurchases.findMany({
        where: {
          registrationId: fixture.registrationId,
          tenantId: fixture.tenantId,
        },
      }),
    ).toEqual([
      expect.objectContaining({
        includedQuantity: 1,
        purchasedQuantity: 0,
        quantity: 1,
        unitPrice: addOnPrice,
      }),
    ]);

    const checkoutRequest = fakeHttpClient.createRequests[0];
    if (!checkoutRequest) {
      throw new Error('Expected one Stripe Checkout request');
    }
    const checkoutForm = new URLSearchParams(checkoutRequest.requestData);
    expect(
      [...checkoutForm.keys()].filter((key) =>
        key.endsWith('[price_data][unit_amount]'),
      ),
    ).toHaveLength(1);
    expect(checkoutForm.get('line_items[1][quantity]')).toBeNull();
  }, 30_000);

  it('lets only the fresh simultaneous approval create the durable Checkout session', async () => {
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
        `
          SELECT id
          FROM event_registrations
          WHERE "tenantId" = $1 AND id = $2
          FOR UPDATE
        `,
        [fixture.tenantId, fixture.registrationId],
      );
    });
    let registrationTransactionOpen = true;

    const operations = createPendingOperationTracker();

    await runWithCleanup(async () => {
      const approvals = {
        first: operations.track(
          runApproval(approvalInput(fixture), serviceLayer),
        ),
        second: operations.track(
          runApproval(approvalInput(fixture), serviceLayer),
        ),
      };

      await waitForBlockedQueries(pool, 'event_registrations', 2);
      expect(fakeHttpClient.createRequests).toHaveLength(0);
      await registrationLock.query('COMMIT');
      registrationTransactionOpen = false;
      await waitFor(
        () => fakeHttpClient.createRequests.length === 1,
        'Timed out waiting for the fresh approval Stripe request',
      );
      expect(
        await Promise.race([approvals.first, approvals.second]),
      ).toMatchObject({
        error: { _tag: 'EventRegistrationConflictError' },
        status: 'failure',
      });
      releaseCreates(true);

      const outcomes = await Promise.all([approvals.first, approvals.second]);
      expect(outcomes.filter(({ status }) => status === 'success')).toEqual([
        { status: 'success', value: { status: 'paymentPending' } },
      ]);
      expect(outcomes.filter(({ status }) => status === 'failure')).toEqual([
        expect.objectContaining({
          error: expect.objectContaining({
            _tag: 'EventRegistrationConflictError',
          }),
        }),
      ]);
      expect(fakeHttpClient.createRequests).toHaveLength(1);
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
    }, [
      async () => {
        releaseCreates(true);
      },
      () => releaseRowLock(registrationLock, registrationTransactionOpen),
      operations.drain,
    ]);
  }, 30_000);

  it('preserves an uncertain approval claim without creating another Stripe session', async () => {
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
            'The payment could not be prepared. Contact an organizer before trying again.',
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
    expect(retryOutcome).toMatchObject({
      error: { _tag: 'EventRegistrationConflictError' },
      status: 'failure',
    });
    expect(fakeHttpClient.createRequests).toHaveLength(1);
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
        stripeCheckoutSessionId: null,
      }),
    ]);
    expect(finalState.option?.reservedSpots).toBe(1);
    expect(finalState.addOn?.totalAvailableQuantity).toBe(3);
    expect(finalState.emails).toHaveLength(0);
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
    let registrationTransactionOpen = true;
    let approval: ReturnType<typeof runApproval> | undefined;

    const operations = createPendingOperationTracker();

    await runWithCleanup(async () => {
      approval = operations.track(
        runApproval(approvalInput(fixture), serviceLayer),
      );
      await waitForBlockedQueries(pool, 'event_registrations', 1);
      const cancellation = operations.track(
        runCancellation({ fixture, serviceLayer }),
      );
      await waitForBlockedQueries(pool, 'event_registrations', 2);
      await registrationLock.query('COMMIT');
      registrationTransactionOpen = false;

      await waitFor(
        () => fakeHttpClient.createRequests.length === 1,
        'Timed out waiting for the approval to create its Stripe session',
      );
      expect(await cancellation).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({
            _tag: 'EventRegistrationConflictError',
            message:
              'The sign-up or payment changed after you confirmed. Nothing was cancelled, no refund was started, and no places or add-ons were released. Review the current sign-up, then confirm again.',
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
    }, [
      async () => {
        releaseCreates(true);
      },
      () => releaseRowLock(registrationLock, registrationTransactionOpen),
      operations.drain,
    ]);
  }, 30_000);
});

describe('direct paid registration concurrency', () => {
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

  it('keeps an included-only priced add-on out of direct Checkout lines', async () => {
    const fixture = await prepareDirectRegistrationFixture(database);
    fixtures.push(fixture);
    const addOnPrice = 500;
    await database
      .update(eventAddons)
      .set({
        isPaid: true,
        price: addOnPrice,
        stripeTaxRateId: fixture.taxRateId,
      })
      .where(eq(eventAddons.id, fixture.addOnId));
    const fakeHttpClient = new IdempotentStripeHttpClient();
    const stripe = new StripeClientLibrary('sk_test_concurrency', {
      httpClient: fakeHttpClient,
      maxNetworkRetries: 0,
    });
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);

    expect(
      await runRegistration(
        { ...directRegistrationInput(fixture), addOns: [] },
        serviceLayer,
      ),
    ).toEqual({ status: 'success' });
    expect(fakeHttpClient.createRequests).toHaveLength(1);

    const state = await readDirectFixtureState(database, fixture);
    const registration = state.registrations[0];
    const claim = state.claims[0];
    if (!registration || !claim?.stripeCheckoutRequest) {
      throw new Error('Expected one pending registration Checkout');
    }
    expect(claim).toEqual(
      expect.objectContaining({
        amount: 1000,
        eventRegistrationId: registration.id,
        status: 'pending',
      }),
    );
    expect(claim.stripeCheckoutRequest.lineItems).toEqual([
      {
        name: 'Registration fee for Concurrency fixture',
        quantity: 1,
        taxRateId: fixture.taxRateId,
        unitAmount: 1000,
      },
    ]);
    expect(state.purchases).toEqual([
      expect.objectContaining({
        includedQuantity: 1,
        purchasedQuantity: 0,
        quantity: 1,
        registrationId: registration.id,
        unitPrice: addOnPrice,
      }),
    ]);
    expect(
      await database.query.eventRegistrationAddonPurchaseLots.findMany({
        where: {
          registrationId: registration.id,
          tenantId: fixture.tenantId,
        },
      }),
    ).toEqual([]);

    const checkoutRequest = fakeHttpClient.createRequests[0];
    if (!checkoutRequest) {
      throw new Error('Expected one Stripe Checkout request');
    }
    const checkoutForm = new URLSearchParams(checkoutRequest.requestData);
    expect(
      [...checkoutForm.keys()].filter((key) =>
        key.endsWith('[price_data][unit_amount]'),
      ),
    ).toHaveLength(1);
    expect(checkoutForm.get('line_items[1][quantity]')).toBeNull();
  }, 30_000);

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
    let tenantTransactionOpen = true;

    const operations = createPendingOperationTracker();

    await runWithCleanup(async () => {
      const input = directRegistrationInput(fixture);
      const first = operations.track(runRegistration(input, serviceLayer));
      const second = operations.track(runRegistration(input, serviceLayer));

      await waitForBlockedQueries(pool, 'tenants', 2);
      await tenantLock.query('COMMIT');
      tenantTransactionOpen = false;
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
            message: 'You are already signed up for this event.',
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
    }, [
      async () => {
        releaseCreates(true);
      },
      () => releaseRowLock(tenantLock, tenantTransactionOpen),
      operations.drain,
    ]);
  }, 30_000);

  it('rejects a changed immutable payment tuple after its binding lock waits', async () => {
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
    let registrationCompleted = false;
    let paymentLock: Awaited<ReturnType<typeof withRowLock>> | undefined;
    let paymentTransactionOpen = false;
    const operations = createPendingOperationTracker();

    await runWithCleanup(async () => {
      const registration = operations.track(
        runRegistration(
          directRegistrationInput(fixture),
          makeServiceLayer(databaseUrl, stripe),
        ).finally(() => {
          registrationCompleted = true;
        }),
      );

      await waitFor(
        () => fakeHttpClient.createRequests.length === 1,
        'Timed out waiting for the first Checkout create',
      );
      const beforeBinding = await readDirectFixtureState(database, fixture);
      const claim = beforeBinding.claims[0];
      if (!claim)
        throw new Error(
          'Expected a durable claim before the provider response',
        );
      paymentLock = await withRowLock(pool, async (client) => {
        await client.query(
          'SELECT id FROM transactions WHERE id = $1 FOR UPDATE',
          [claim.id],
        );
      });
      paymentTransactionOpen = true;
      releaseCreates(true);
      await waitForBlockedQueries(
        pool,
        'transactions',
        1,
        () => registrationCompleted,
      );
      await paymentLock.query(
        'UPDATE transactions SET amount = amount + 1 WHERE id = $1',
        [claim.id],
      );
      await paymentLock.query('COMMIT');
      paymentTransactionOpen = false;

      expect(await registration).toMatchObject({
        error: { _tag: 'EventRegistrationConflictError' },
        status: 'failure',
      });
      const finalState = await readDirectFixtureState(database, fixture);
      expect(finalState.claims).toEqual([
        expect.objectContaining({
          amount: claim.amount + 1,
          id: claim.id,
          status: 'pending',
          stripeCheckoutIncidentSessionId: null,
          stripeCheckoutSessionId: null,
          stripeCheckoutUrl: null,
        }),
      ]);
      expect(finalState.registrations).toEqual(beforeBinding.registrations);
      expect(finalState.option?.reservedSpots).toBe(1);
      expect(finalState.addOn?.totalAvailableQuantity).toBe(3);
      expect(finalState.purchases).toEqual(beforeBinding.purchases);
      expect(fakeHttpClient.expiredSessionIds).toEqual(
        fakeHttpClient.createdSessionIds,
      );
      expect(fakeHttpClient.createRequests).toHaveLength(1);
    }, [
      async () => {
        releaseCreates(true);
      },
      async () => {
        if (paymentLock)
          await releaseRowLock(paymentLock, paymentTransactionOpen);
      },
      operations.drain,
    ]);
  }, 30_000);

  it('preserves an uncertain direct Checkout claim without another provider request', async () => {
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
            'The payment could not be prepared. Contact an organizer before trying again.',
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

    const pendingRegistration = stateAfterFailure.registrations[0];
    if (!pendingRegistration) {
      throw new Error(
        'Expected one pending registration after failed payment start',
      );
    }
    expect(
      await runRegistrationCheckoutRetry(
        {
          registrationId: pendingRegistration.id,
          tenantId: fixture.tenantId,
          userId: fixture.userId,
        },
        serviceLayer,
      ),
    ).toMatchObject({
      error: { _tag: 'EventRegistrationConflictError' },
      status: 'failure',
    });
    expect(fakeHttpClient.createRequests).toHaveLength(1);
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
        stripeCheckoutSessionId: null,
      }),
    ]);
    expect(finalState.option?.reservedSpots).toBe(1);
    expect(finalState.addOn?.totalAvailableQuantity).toBe(3);
    expect(finalState.purchases).toEqual(stateAfterFailure.purchases);
  }, 30_000);
});
