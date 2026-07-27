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
import { completePaidRegistrationCheckout } from '../../server/registrations/registration-checkout-completion';
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
  eventRegistrationAddonFulfillmentAllocations,
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

interface PreparedStripeCharge {
  readonly amount: number;
  readonly applicationFeeAmount: number;
  readonly chargeId: string;
  readonly currency: string;
  readonly paymentIntentId: string;
  readonly stripeAccountId: string;
  readonly stripeFeeAmount: number;
}

type StripeHttpRequestArguments = Parameters<
  InstanceType<typeof StripeClientLibrary.HttpClient>['makeRequest']
>;
type TestDatabase = NodePgDatabase<typeof relations>;

const readStripeHeader = (
  headers: StripeHttpRequestArguments[4],
  expectedName: string,
): string | undefined => {
  const value = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === expectedName.toLowerCase(),
  )?.[1];
  return Array.isArray(value)
    ? value.join(',')
    : value === undefined
      ? undefined
      : String(value);
};

class IdempotentStripeHttpClient extends StripeClientLibrary.HttpClient {
  readonly createRequests: CapturedStripeRequest[] = [];
  readonly expiredSessionIds: string[] = [];
  readonly retrievedChargeIds: string[] = [];

  get createdSessionIds(): readonly string[] {
    return [...this.sessionsByIdempotencyKey.values()].map(
      (session) => session.id,
    );
  }
  private createGate: Promise<unknown> | undefined;
  private failNextCreateAfterSessionCreation = false;
  private readonly preparedCharges = new Map<string, PreparedStripeCharge>();
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

    const preparedCharge = [...this.preparedCharges.values()].find(
      ({ chargeId }) =>
        method === 'GET' &&
        path ===
          `/v1/charges/${encodeURIComponent(chargeId)}?expand[0]=balance_transaction`,
    );
    if (preparedCharge) {
      if (
        readStripeHeader(headers, 'Stripe-Account') !==
        preparedCharge.stripeAccountId
      ) {
        throw new Error('Stripe charge used the wrong connected account');
      }
      this.retrievedChargeIds.push(preparedCharge.chargeId);
      const stripeNetAmount =
        preparedCharge.amount -
        preparedCharge.applicationFeeAmount -
        preparedCharge.stripeFeeAmount;
      return new JsonStripeResponse({
        amount: preparedCharge.amount,
        balance_transaction: {
          amount: preparedCharge.amount,
          currency: preparedCharge.currency.toLowerCase(),
          fee:
            preparedCharge.applicationFeeAmount +
            preparedCharge.stripeFeeAmount,
          fee_details: [
            {
              amount: preparedCharge.applicationFeeAmount,
              currency: preparedCharge.currency.toLowerCase(),
              type: 'application_fee',
            },
            {
              amount: preparedCharge.stripeFeeAmount,
              currency: preparedCharge.currency.toLowerCase(),
              type: 'stripe_fee',
            },
          ],
          id: `txn_${preparedCharge.chargeId}`,
          net: stripeNetAmount,
          object: 'balance_transaction',
        },
        captured: true,
        currency: preparedCharge.currency.toLowerCase(),
        id: preparedCharge.chargeId,
        object: 'charge',
        paid: true,
        payment_intent: preparedCharge.paymentIntentId,
      });
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

  prepareCharge(charge: PreparedStripeCharge): void {
    if (this.preparedCharges.has(charge.chargeId)) {
      throw new Error('Stripe charge was already prepared');
    }
    this.preparedCharges.set(charge.chargeId, charge);
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
        ['SECRET', 'test-secret'],
      ]),
    }),
  );

const completedRegistrationCheckoutSession = (input: {
  readonly amount: number;
  readonly chargeId: string;
  readonly currency: string;
  readonly paymentIntentId: string;
  readonly registrationId: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly transactionId: string;
}): Stripe.Checkout.Session => {
  const webhookSecret = 'whsec_registration_concurrency';
  const payload = JSON.stringify({
    account: `acct_${input.tenantId.replace('tenant-', '')}`,
    api_version: null,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        amount_total: input.amount,
        currency: input.currency.toLowerCase(),
        id: input.sessionId,
        metadata: {
          registrationId: input.registrationId,
          tenantId: input.tenantId,
          transactionId: input.transactionId,
        },
        object: 'checkout.session',
        payment_intent: {
          id: input.paymentIntentId,
          latest_charge: input.chargeId,
          object: 'payment_intent',
        },
        payment_status: 'paid',
        status: 'complete',
      },
    },
    id: `evt_${input.transactionId}`,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: 'checkout.session.completed',
  });
  const signature = StripeClientLibrary.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  const event = StripeClientLibrary.webhooks.constructEvent(
    payload,
    signature,
    webhookSecret,
  );
  if (event.type !== 'checkout.session.completed') {
    throw new Error('Expected a completed registration Checkout event');
  }
  return event.data.object;
};

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

const createRegistrationRequestContext = ({
  fixture,
  permissions = [],
  userId = fixture.userId,
}: {
  fixture: Fixture;
  permissions?: RpcRequestContextShape['permissions'];
  userId?: string;
}): RpcRequestContextShape => ({
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
    logoUrl: undefined,
    maxActiveRegistrationsPerUser: 0,
    name: 'Concurrency test',
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
    auth0Id: `auth0|${userId}`,
    communicationEmail: `${userId}@example.com`,
    email: `${userId}@example.com`,
    firstName: 'Concurrent',
    iban: undefined,
    id: userId,
    lastName: 'Tester',
    paypalEmail: undefined,
    permissions,
    roleIds: [],
  },
  userAssigned: true,
});

const runCancellation = ({
  expectedPaymentPending = false,
  fixture,
  serviceLayer,
}: {
  expectedPaymentPending?: boolean;
  fixture: Fixture;
  serviceLayer: ReturnType<typeof makeServiceLayer>;
}) => {
  const requestContext = createRegistrationRequestContext({ fixture });

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

const runCheckIn = ({
  fixture,
  guestCheckInCount,
  serviceLayer,
}: {
  fixture: Fixture;
  guestCheckInCount: number;
  serviceLayer: ReturnType<typeof makeServiceLayer>;
}) => {
  const requestContext = createRegistrationRequestContext({
    fixture,
    permissions: ['events:organizeAll'],
    userId: makeId('scanner', fixture.tenantId),
  });

  return Effect.runPromise(
    eventRegistrationHandlers['events.checkInRegistration'](
      {
        guestCheckInCount,
        registrationId: fixture.registrationId,
      },
      { headers: Headers.empty },
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
    id: fixture.tenantId,
    maxActiveRegistrationsPerUser: 0,
    stripeAccountId: `acct_${fixture.tenantId.replace('tenant-', '')}`,
  },
  user: {
    communicationEmail: `${fixture.userId}@example.com`,
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

const seedWaitlistRegistration = async (
  database: TestDatabase,
  fixture: Fixture,
) => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  const userId = makeId('wait-user', suffix);
  const registrationId = makeId('wait-reg', suffix);
  const communicationEmail = `waitlist-${suffix}@example.com`;
  await database.insert(users).values({
    auth0Id: `auth0|waitlist-${suffix}`,
    communicationEmail,
    email: communicationEmail,
    firstName: 'Waiting',
    id: userId,
    lastName: 'Member',
  });
  await database.insert(usersToTenants).values({
    id: makeId('wait-member', suffix),
    tenantId: fixture.tenantId,
    userId,
  });
  await database.insert(eventRegistrations).values({
    eventId: fixture.eventId,
    id: registrationId,
    registrationOptionId: fixture.optionId,
    status: 'WAITLIST',
    tenantId: fixture.tenantId,
    userId,
  });
  await database
    .update(eventRegistrationOptions)
    .set({ waitlistSpots: 1 })
    .where(eq(eventRegistrationOptions.id, fixture.optionId));
  return { communicationEmail, registrationId };
};

const prepareCheckInFixture = async (
  database: TestDatabase,
  { guestCount }: { guestCount: number },
): Promise<Fixture> => {
  const fixture = await seedFixture(database);
  const now = Date.now();
  await database
    .update(eventInstances)
    .set({
      end: new Date(now + 2 * 60 * 60 * 1000),
      start: new Date(now + 30 * 60 * 1000),
    })
    .where(eq(eventInstances.id, fixture.eventId));
  await database
    .update(eventRegistrations)
    .set({
      checkedInGuestCount: 0,
      checkInTime: null,
      guestCount,
      status: 'CONFIRMED',
    })
    .where(eq(eventRegistrations.id, fixture.registrationId));
  await database
    .update(eventRegistrationOptions)
    .set({
      checkedInSpots: 0,
      confirmedSpots: guestCount + 1,
    })
    .where(eq(eventRegistrationOptions.id, fixture.optionId));
  return fixture;
};

const cleanFixture = async (database: TestDatabase, fixture: Fixture) => {
  const tenantMemberships = await database
    .select({ userId: usersToTenants.userId })
    .from(usersToTenants)
    .where(eq(usersToTenants.tenantId, fixture.tenantId));
  const tenantUserIds = [
    fixture.userId,
    ...tenantMemberships
      .map(({ userId }) => userId)
      .filter((userId) => userId !== fixture.userId),
  ];
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
    .delete(eventRegistrationAddonFulfillmentAllocations)
    .where(
      eq(
        eventRegistrationAddonFulfillmentAllocations.tenantId,
        fixture.tenantId,
      ),
    );
  await database
    .delete(eventRegistrationAddonPurchaseLots)
    .where(eq(eventRegistrationAddonPurchaseLots.tenantId, fixture.tenantId));
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
    .where(eq(usersToTenants.tenantId, fixture.tenantId));
  await database.delete(users).where(inArray(users.id, tenantUserIds));
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
              (id, "tenantId", "eventId", "registrationOptionId", status, "userId",
               base_price_at_registration, discount_amount)
            VALUES ($1, $2, $3, $4, 'PENDING', $5, 1000, 0)
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

    try {
      const checkIn = runCheckIn({
        fixture,
        guestCheckInCount: 0,
        serviceLayer,
      });

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

      expect(await checkIn).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({
            _tag: 'EventRegistrationConflictError',
            message: 'Only confirmed registrations can be checked in',
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
    } finally {
      if (!registrationLock.released) {
        await registrationLock.query('ROLLBACK').catch(() => null);
      }
      registrationLock.release();
    }
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

    try {
      const first = runCheckIn({
        fixture,
        guestCheckInCount: 1,
        serviceLayer,
      });
      const second = runCheckIn({
        fixture,
        guestCheckInCount: 1,
        serviceLayer,
      });

      await waitForBlockedQueries(pool, 'event_registrations', 2);
      await registrationLock.query('COMMIT');

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
            message: 'Guest check-in count exceeds remaining guests',
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
    } finally {
      if (!registrationLock.released) {
        await registrationLock.query('ROLLBACK').catch(() => null);
      }
      registrationLock.release();
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
            (id, "tenantId", "eventId", "registrationOptionId", status, "userId",
             base_price_at_registration, discount_amount)
          VALUES
            ($1, $2, $3, $4, 'PENDING', $5, 1000, 0),
            ($6, $2, $3, $4, 'WAITLIST', $7, NULL, NULL)
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

    const pendingRegistration = stateAfterFailure.registrations[0];
    if (!pendingRegistration) {
      throw new Error(
        'Expected one pending registration after failed Checkout',
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
    ).toEqual({ status: 'success' });
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

  it('settles one paid initial Checkout across the registration and its paid add-on', async () => {
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
      await runRegistration(directRegistrationInput(fixture), serviceLayer),
    ).toEqual({ status: 'success' });
    expect(fakeHttpClient.createRequests).toHaveLength(1);
    expect(fakeHttpClient.createdSessionIds).toHaveLength(1);

    const pendingState = await readDirectFixtureState(database, fixture);
    expect(pendingState.registrations).toHaveLength(1);
    expect(pendingState.claims).toHaveLength(1);
    expect(pendingState.purchases).toHaveLength(1);
    const registration = pendingState.registrations[0];
    const claim = pendingState.claims[0];
    const purchase = pendingState.purchases[0];
    const purchaseLot =
      await database.query.eventRegistrationAddonPurchaseLots.findFirst({
        where: {
          registrationId: registration?.id,
          tenantId: fixture.tenantId,
        },
      });
    if (
      !registration ||
      !claim ||
      !purchase ||
      !purchaseLot ||
      claim.appFee === null ||
      !claim.stripeCheckoutRequest ||
      !claim.stripeCheckoutSessionId ||
      !claim.stripePaymentIntentId
    ) {
      throw new Error('Expected one complete pending registration Checkout');
    }

    expect(claim).toEqual(
      expect.objectContaining({
        amount: 1000 + addOnPrice,
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
      {
        addonId: fixture.addOnId,
        allocationKey: `addon-lot:${purchaseLot.id}`,
        kind: 'addon',
        name: 'Concurrency add-on add-on for Concurrency fixture',
        quantity: 1,
        taxRateId: fixture.taxRateId,
        unitAmount: addOnPrice,
      },
    ]);
    expect(purchase).toEqual(
      expect.objectContaining({
        purchasedQuantity: 1,
        registrationId: registration.id,
        unitPrice: addOnPrice,
      }),
    );
    expect(purchaseLot).toEqual(
      expect.objectContaining({
        baseAmount: addOnPrice,
        grossAmount: null,
        paymentAllocationFinalizedAt: null,
        sourceLineKey: `addon-lot:${purchaseLot.id}`,
        sourceTransactionId: claim.id,
      }),
    );

    const checkoutRequest = fakeHttpClient.createRequests[0];
    if (!checkoutRequest) {
      throw new Error('Expected one Stripe Checkout request');
    }
    const checkoutForm = new URLSearchParams(checkoutRequest.requestData);
    expect(
      [...checkoutForm.keys()].filter((key) =>
        key.endsWith('[price_data][unit_amount]'),
      ),
    ).toHaveLength(2);
    expect(
      checkoutForm.get('line_items[0][price_data][product_data][name]'),
    ).toBe('Registration fee for Concurrency fixture');
    expect(checkoutForm.get('line_items[0][price_data][unit_amount]')).toBe(
      '1000',
    );
    expect(
      checkoutForm.get('line_items[1][price_data][product_data][name]'),
    ).toBe('Concurrency add-on add-on for Concurrency fixture');
    expect(checkoutForm.get('line_items[1][price_data][unit_amount]')).toBe(
      String(addOnPrice),
    );

    const stripeChargeId = `ch_${claim.id}`;
    fakeHttpClient.prepareCharge({
      amount: claim.amount,
      applicationFeeAmount: claim.appFee,
      chargeId: stripeChargeId,
      currency: claim.currency,
      paymentIntentId: claim.stripePaymentIntentId,
      stripeAccountId: `acct_${fixture.tenantId.replace('tenant-', '')}`,
      stripeFeeAmount: 47,
    });
    expect(
      await Effect.runPromise(
        completePaidRegistrationCheckout(
          {
            registrationId: registration.id,
            stripeAccountId: `acct_${fixture.tenantId.replace('tenant-', '')}`,
            stripeCheckoutSessionId: claim.stripeCheckoutSessionId,
            tenantId: fixture.tenantId,
            transactionId: claim.id,
          },
          completedRegistrationCheckoutSession({
            amount: claim.amount,
            chargeId: stripeChargeId,
            currency: claim.currency,
            paymentIntentId: claim.stripePaymentIntentId,
            registrationId: registration.id,
            sessionId: claim.stripeCheckoutSessionId,
            tenantId: fixture.tenantId,
            transactionId: claim.id,
          }),
        ).pipe(Effect.provide(serviceLayer)),
      ),
    ).toBe('finalized');
    expect(fakeHttpClient.createRequests).toHaveLength(1);
    expect(fakeHttpClient.retrievedChargeIds).toEqual([stripeChargeId]);

    const [completedState, settledLot, acquisitions, acquisitionPayments] =
      await Promise.all([
        readDirectFixtureState(database, fixture),
        database.query.eventRegistrationAddonPurchaseLots.findFirst({
          where: {
            id: purchaseLot.id,
            tenantId: fixture.tenantId,
          },
        }),
        database.query.registrationAcquisitions.findMany({
          where: {
            registrationId: registration.id,
            tenantId: fixture.tenantId,
          },
        }),
        database.query.registrationAcquisitionPayments.findMany({
          where: {
            registrationId: registration.id,
            tenantId: fixture.tenantId,
          },
        }),
      ]);
    const acquisitionComponents =
      await database.query.registrationAcquisitionComponents.findMany({
        where: {
          registrationId: registration.id,
          tenantId: fixture.tenantId,
        },
      });

    expect(completedState.registrations).toEqual([
      expect.objectContaining({ id: registration.id, status: 'CONFIRMED' }),
    ]);
    expect(completedState.claims).toEqual([
      expect.objectContaining({
        id: claim.id,
        status: 'successful',
        stripeChargeId,
      }),
    ]);
    expect(completedState.option).toEqual(
      expect.objectContaining({ confirmedSpots: 1, reservedSpots: 0 }),
    );
    expect(acquisitions).toEqual([
      expect.objectContaining({
        kind: 'initial',
        ownerUserId: fixture.userId,
        registrationId: registration.id,
        spotCount: 1,
      }),
    ]);
    expect(acquisitionPayments).toEqual([
      expect.objectContaining({
        acquisitionId: acquisitions[0]?.id,
        transactionId: claim.id,
      }),
    ]);
    expect(acquisitionComponents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          allocationKey: `registration-initial:${registration.id}`,
          baseAmount: 1000,
          grossAmount: 1000,
          kind: 'registration',
        }),
        expect.objectContaining({
          allocationKey: `addon-lot:${purchaseLot.id}`,
          baseAmount: addOnPrice,
          grossAmount: addOnPrice,
          kind: 'addon_lot',
          purchaseId: purchase.id,
          purchaseLotId: purchaseLot.id,
        }),
      ]),
    );
    expect(acquisitionComponents).toHaveLength(2);
    expect(
      acquisitionComponents.reduce(
        (total, component) => total + component.grossAmount,
        0,
      ),
    ).toBe(claim.amount);
    expect(
      new Set(
        acquisitionComponents.map(
          ({ acquisitionPaymentId }) => acquisitionPaymentId,
        ),
      ),
    ).toEqual(new Set([acquisitionPayments[0]?.id]));
    expect(settledLot).toEqual(
      expect.objectContaining({
        baseAmount: addOnPrice,
        grossAmount: addOnPrice,
        paymentAllocationFinalizedAt: expect.any(Date),
        sourceTransactionId: claim.id,
      }),
    );
  }, 30_000);

  it('rolls back paid completion when the reserved-capacity counter is too small', async () => {
    const fixture = await prepareDirectRegistrationFixture(database);
    fixtures.push(fixture);
    const fakeHttpClient = new IdempotentStripeHttpClient();
    const stripe = new StripeClientLibrary('sk_test_concurrency', {
      httpClient: fakeHttpClient,
      maxNetworkRetries: 0,
    });
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);

    expect(
      await runRegistration(directRegistrationInput(fixture), serviceLayer),
    ).toEqual({ status: 'success' });

    const pendingState = await readDirectFixtureState(database, fixture);
    const registration = pendingState.registrations[0];
    const claim = pendingState.claims[0];
    if (
      !registration ||
      !claim ||
      claim.appFee === null ||
      !claim.stripeAccountId ||
      !claim.stripeCheckoutSessionId ||
      !claim.stripePaymentIntentId
    ) {
      throw new Error('Expected one complete pending registration Checkout');
    }
    expect(pendingState.option).toEqual(
      expect.objectContaining({ confirmedSpots: 0, reservedSpots: 1 }),
    );
    await database
      .update(eventRegistrationOptions)
      .set({ reservedSpots: 0 })
      .where(eq(eventRegistrationOptions.id, fixture.optionId));

    const stripeChargeId = `ch_${claim.id}`;
    fakeHttpClient.prepareCharge({
      amount: claim.amount,
      applicationFeeAmount: claim.appFee,
      chargeId: stripeChargeId,
      currency: claim.currency,
      paymentIntentId: claim.stripePaymentIntentId,
      stripeAccountId: claim.stripeAccountId,
      stripeFeeAmount: 47,
    });
    const completionError = await Effect.runPromise(
      completePaidRegistrationCheckout(
        {
          registrationId: registration.id,
          stripeAccountId: claim.stripeAccountId,
          stripeCheckoutSessionId: claim.stripeCheckoutSessionId,
          tenantId: fixture.tenantId,
          transactionId: claim.id,
        },
        completedRegistrationCheckoutSession({
          amount: claim.amount,
          chargeId: stripeChargeId,
          currency: claim.currency,
          paymentIntentId: claim.stripePaymentIntentId,
          registrationId: registration.id,
          sessionId: claim.stripeCheckoutSessionId,
          tenantId: fixture.tenantId,
          transactionId: claim.id,
        }),
      ).pipe(Effect.flip, Effect.provide(serviceLayer)),
    );

    expect(completionError.kind).toBe('stateConflict');
    expect(completionError.message).toBe(
      'Paid registration reserved capacity could not be confirmed',
    );
    const [failedState, refundClaims, acquisitions, emails] = await Promise.all(
      [
        readDirectFixtureState(database, fixture),
        database.query.transactions.findMany({
          where: {
            sourceTransactionId: claim.id,
            tenantId: fixture.tenantId,
            type: 'refund',
          },
        }),
        database.query.registrationAcquisitions.findMany({
          where: {
            registrationId: registration.id,
            tenantId: fixture.tenantId,
          },
        }),
        database.query.emailOutbox.findMany({
          where: { tenantId: fixture.tenantId },
        }),
      ],
    );
    expect(failedState.registrations).toEqual([
      expect.objectContaining({ id: registration.id, status: 'PENDING' }),
    ]);
    expect(failedState.claims).toEqual([
      expect.objectContaining({ id: claim.id, status: 'pending' }),
    ]);
    expect(failedState.option).toEqual(
      expect.objectContaining({ confirmedSpots: 0, reservedSpots: 0 }),
    );
    expect(failedState.addOn?.totalAvailableQuantity).toBe(3);
    expect(refundClaims).toEqual([]);
    expect(acquisitions).toEqual([]);
    expect(emails).toEqual([]);
  }, 30_000);

  it('compensates a paid registration exactly once when tenant membership is lost during Checkout', async () => {
    const fixture = await prepareDirectRegistrationFixture(database);
    fixtures.push(fixture);
    await database
      .update(eventRegistrationOptions)
      .set({ spots: 1 })
      .where(eq(eventRegistrationOptions.id, fixture.optionId));
    const fakeHttpClient = new IdempotentStripeHttpClient();
    const stripe = new StripeClientLibrary('sk_test_concurrency', {
      httpClient: fakeHttpClient,
      maxNetworkRetries: 0,
    });
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);

    expect(
      await runRegistration(directRegistrationInput(fixture), serviceLayer),
    ).toEqual({ status: 'success' });

    const pendingState = await readDirectFixtureState(database, fixture);
    expect(pendingState.registrations).toHaveLength(1);
    expect(pendingState.claims).toHaveLength(1);
    const registration = pendingState.registrations[0];
    const claim = pendingState.claims[0];
    if (
      !registration ||
      !claim ||
      claim.appFee === null ||
      !claim.stripeAccountId ||
      !claim.stripeCheckoutSessionId ||
      !claim.stripePaymentIntentId
    ) {
      throw new Error('Expected one complete pending registration Checkout');
    }
    expect(pendingState.option).toEqual(
      expect.objectContaining({ confirmedSpots: 0, reservedSpots: 1 }),
    );
    expect(pendingState.addOn?.totalAvailableQuantity).toBe(3);
    expect(
      await database.query.emailOutbox.findMany({
        where: { tenantId: fixture.tenantId },
      }),
    ).toEqual([]);
    const waitlistRegistration = await seedWaitlistRegistration(
      database,
      fixture,
    );

    expect(
      await database
        .delete(usersToTenants)
        .where(
          and(
            eq(usersToTenants.tenantId, fixture.tenantId),
            eq(usersToTenants.userId, fixture.userId),
          ),
        )
        .returning({ id: usersToTenants.id }),
    ).toHaveLength(1);

    const stripeChargeId = `ch_${claim.id}`;
    fakeHttpClient.prepareCharge({
      amount: claim.amount,
      applicationFeeAmount: claim.appFee,
      chargeId: stripeChargeId,
      currency: claim.currency,
      paymentIntentId: claim.stripePaymentIntentId,
      stripeAccountId: claim.stripeAccountId,
      stripeFeeAmount: 47,
    });
    const completionIdentity = {
      registrationId: registration.id,
      stripeAccountId: claim.stripeAccountId,
      stripeCheckoutSessionId: claim.stripeCheckoutSessionId,
      tenantId: fixture.tenantId,
      transactionId: claim.id,
    };
    const completedSession = completedRegistrationCheckoutSession({
      amount: claim.amount,
      chargeId: stripeChargeId,
      currency: claim.currency,
      paymentIntentId: claim.stripePaymentIntentId,
      registrationId: registration.id,
      sessionId: claim.stripeCheckoutSessionId,
      tenantId: fixture.tenantId,
      transactionId: claim.id,
    });
    const completeCheckout = () =>
      Effect.runPromise(
        completePaidRegistrationCheckout(
          completionIdentity,
          completedSession,
        ).pipe(Effect.provide(serviceLayer)),
      );

    expect(await completeCheckout()).toBe('compensationQueued');
    expect(await completeCheckout()).toBe('alreadyFinalized');

    const [compensatedState, refundClaims, acquisitions, emails] =
      await Promise.all([
        readDirectFixtureState(database, fixture),
        database.query.transactions.findMany({
          where: {
            sourceTransactionId: claim.id,
            tenantId: fixture.tenantId,
            type: 'refund',
          },
        }),
        database.query.registrationAcquisitions.findMany({
          where: {
            registrationId: registration.id,
            tenantId: fixture.tenantId,
          },
        }),
        database.query.emailOutbox.findMany({
          where: { tenantId: fixture.tenantId },
        }),
      ]);

    expect(compensatedState.registrations).toEqual([
      expect.objectContaining({
        id: registration.id,
        status: 'CANCELLED',
      }),
    ]);
    expect(compensatedState.claims).toEqual([
      expect.objectContaining({
        appFee: claim.appFee,
        id: claim.id,
        status: 'successful',
        stripeAccountId: claim.stripeAccountId,
        stripeChargeId,
        targetUserId: fixture.userId,
      }),
    ]);
    expect(compensatedState.option).toEqual(
      expect.objectContaining({
        confirmedSpots: 0,
        reservedSpots: 0,
        waitlistSpots: 1,
      }),
    );
    expect(compensatedState.addOn?.totalAvailableQuantity).toBe(5);
    expect(refundClaims).toEqual([
      expect.objectContaining({
        amount: -claim.amount,
        currency: claim.currency,
        eventId: fixture.eventId,
        eventRegistrationId: registration.id,
        manuallyCreated: false,
        method: 'stripe',
        refundOperationKey: `registration-eligibility-compensation:${claim.id}`,
        sourceTransactionId: claim.id,
        status: 'pending',
        stripeAccountId: claim.stripeAccountId,
        stripeRefundApplicationFee: true,
        targetUserId: fixture.userId,
        type: 'refund',
      }),
    ]);
    expect(acquisitions).toEqual([]);
    expect(emails).toHaveLength(2);
    expect(emails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          idempotencyKey: `registration-cancelled/${fixture.tenantId}/${registration.id}`,
          kind: 'registrationCancelled',
          text: expect.stringContaining(
            'The full amount you paid was queued for refund to your original payment method',
          ),
          toEmail: `${fixture.userId.replace('user-', '')}@example.com`,
        }),
        expect.objectContaining({
          idempotencyKey: `waitlist-spot-available/${fixture.tenantId}/${waitlistRegistration.registrationId}/eligibility-compensation-${registration.id}`,
          kind: 'waitlistSpotAvailable',
          text: expect.stringContaining(
            'A spot may now be available for Concurrency fixture',
          ),
          toEmail: waitlistRegistration.communicationEmail,
        }),
      ]),
    );
    expect(emails.some(({ kind }) => kind === 'registrationConfirmed')).toBe(
      false,
    );
  }, 30_000);

  it('compensates when the event is withdrawn without notifying the waitlist', async () => {
    const fixture = await prepareDirectRegistrationFixture(database);
    fixtures.push(fixture);
    await database
      .update(eventRegistrationOptions)
      .set({ spots: 1 })
      .where(eq(eventRegistrationOptions.id, fixture.optionId));
    const fakeHttpClient = new IdempotentStripeHttpClient();
    const stripe = new StripeClientLibrary('sk_test_concurrency', {
      httpClient: fakeHttpClient,
      maxNetworkRetries: 0,
    });
    const serviceLayer = makeServiceLayer(databaseUrl, stripe);

    expect(
      await runRegistration(directRegistrationInput(fixture), serviceLayer),
    ).toEqual({ status: 'success' });
    const pendingState = await readDirectFixtureState(database, fixture);
    const registration = pendingState.registrations[0];
    const claim = pendingState.claims[0];
    if (
      !registration ||
      !claim ||
      claim.appFee === null ||
      !claim.stripeAccountId ||
      !claim.stripeCheckoutSessionId ||
      !claim.stripePaymentIntentId
    ) {
      throw new Error('Expected one complete pending registration Checkout');
    }
    const waitlistRegistration = await seedWaitlistRegistration(
      database,
      fixture,
    );
    await database
      .update(eventInstances)
      .set({
        reviewedAt: null,
        reviewedBy: null,
        status: 'DRAFT',
        statusComment: null,
      })
      .where(eq(eventInstances.id, fixture.eventId));

    const stripeChargeId = `ch_${claim.id}`;
    fakeHttpClient.prepareCharge({
      amount: claim.amount,
      applicationFeeAmount: claim.appFee,
      chargeId: stripeChargeId,
      currency: claim.currency,
      paymentIntentId: claim.stripePaymentIntentId,
      stripeAccountId: claim.stripeAccountId,
      stripeFeeAmount: 47,
    });
    expect(
      await Effect.runPromise(
        completePaidRegistrationCheckout(
          {
            registrationId: registration.id,
            stripeAccountId: claim.stripeAccountId,
            stripeCheckoutSessionId: claim.stripeCheckoutSessionId,
            tenantId: fixture.tenantId,
            transactionId: claim.id,
          },
          completedRegistrationCheckoutSession({
            amount: claim.amount,
            chargeId: stripeChargeId,
            currency: claim.currency,
            paymentIntentId: claim.stripePaymentIntentId,
            registrationId: registration.id,
            sessionId: claim.stripeCheckoutSessionId,
            tenantId: fixture.tenantId,
            transactionId: claim.id,
          }),
        ).pipe(Effect.provide(serviceLayer)),
      ),
    ).toBe('compensationQueued');

    const [compensatedState, refundClaims, emails, waitlistState] =
      await Promise.all([
        readDirectFixtureState(database, fixture),
        database.query.transactions.findMany({
          where: {
            sourceTransactionId: claim.id,
            tenantId: fixture.tenantId,
            type: 'refund',
          },
        }),
        database.query.emailOutbox.findMany({
          where: { tenantId: fixture.tenantId },
        }),
        database.query.eventRegistrations.findFirst({
          where: {
            id: waitlistRegistration.registrationId,
            tenantId: fixture.tenantId,
          },
        }),
      ]);
    expect(compensatedState.registrations).toEqual([
      expect.objectContaining({ id: registration.id, status: 'CANCELLED' }),
    ]);
    expect(waitlistState).toEqual(
      expect.objectContaining({
        id: waitlistRegistration.registrationId,
        status: 'WAITLIST',
      }),
    );
    expect(compensatedState.option).toEqual(
      expect.objectContaining({
        confirmedSpots: 0,
        reservedSpots: 0,
        waitlistSpots: 1,
      }),
    );
    expect(compensatedState.addOn?.totalAvailableQuantity).toBe(5);
    expect(refundClaims).toEqual([
      expect.objectContaining({
        amount: -claim.amount,
        refundOperationKey: `registration-eligibility-compensation:${claim.id}`,
        sourceTransactionId: claim.id,
        status: 'pending',
        stripeRefundApplicationFee: true,
      }),
    ]);
    expect(emails).toEqual([
      expect.objectContaining({
        idempotencyKey: `registration-cancelled/${fixture.tenantId}/${registration.id}`,
        kind: 'registrationCancelled',
        text: expect.stringContaining('the event is no longer published'),
      }),
    ]);
    expect(emails.some(({ kind }) => kind === 'waitlistSpotAvailable')).toBe(
      false,
    );
  }, 30_000);
});
