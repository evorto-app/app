import { createId } from '@db/create-id';
import { databaseLayer } from '@db/index';
import { createNodePgPoolConfig } from '@db/pg-connection-config';
import { relations } from '@db/relations';
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
  platformAuditEntries,
  registrationAcquisitionComponents,
  registrationAcquisitionPayments,
  registrationAcquisitionRefundAllocations,
  registrationAcquisitions,
  roles,
  rolesToTenantUsers,
  tenants,
  tenantStripeTaxRates,
  transactions,
  users,
  usersToTenants,
} from '@db/schema';
import { afterAll, beforeAll, expect, layer } from '@effect/vitest';
import { RpcRequestContext } from '@shared/rpc-contracts/app-rpcs';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Exit, Layer, Result, Schema } from 'effect';
import { Pool } from 'pg';
import Stripe from 'stripe';

import { PlatformAdministratorAuthority } from '../../../../../types/custom/platform-authority';
import { Tenant } from '../../../../../types/custom/tenant';
import { processDueBoundRegistrationCheckouts } from '../../../../registrations/expired-checkout-cleanup';
import { StripeClient } from '../../../../stripe-client';
import {
  stripeBalanceTransactionResponse,
  stripeChargeResponse,
  stripeCheckoutSessionResponse,
  stripeLineItemFixture,
  stripePaymentIntentResponse,
} from '../../../../testing/stripe-test-fixtures';
import { RpcAccess } from '../shared/rpc-access.service';
import {
  checkoutRecoveryQueue,
  recoverCheckout,
} from './platform-checkout-recovery';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl)
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const services = Layer.mergeAll(
  RpcAccess.Default,
  databaseLayer.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: { DATABASE_TLS_REQUIRED: 'false', DATABASE_URL: databaseUrl },
        }),
      ),
    ),
  ),
);
let database: NodePgDatabase<typeof relations>;
let pool: Pool;
beforeAll(() => {
  pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
  database = drizzle({ client: pool, relations });
});
afterAll(async () => {
  await pool.end();
});

const newFixture = () => {
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const tenantId = createId();
  const eventId = createId();
  return {
    categoryId: createId(),
    claimId: createId(),
    eventId,
    membershipId: createId(),
    now,
    optionId: createId(),
    registrationId: createId(),
    roleId: createId(),
    sessionId: `cs_test_${tenantId}`,
    snapshot: {
      customerEmail: 'attendee@example.org',
      eventTitle: 'Recovery event',
      eventUrl: `https://${tenantId}.recovery.example/events/${eventId}`,
      expiresAt: Math.floor(now.getTime() / 1000) + 3600,
      lineItems: [
        {
          kind: 'registration' as const,
          name: 'Registration',
          quantity: 1,
          taxRateId: 'txr_fixture_zero',
          unitAmount: 1000,
        },
      ],
      notificationEmail: 'attendee@example.org',
    },
    stripeAccountId: `acct_${tenantId}`,
    templateId: createId(),
    tenantId,
    userId: createId(),
  };
};
type Fixture = ReturnType<typeof newFixture>;

const cleanup = async (f: Fixture) => {
  await database
    .delete(emailOutbox)
    .where(eq(emailOutbox.tenantId, f.tenantId));
  await database
    .delete(platformAuditEntries)
    .where(eq(platformAuditEntries.targetTenantId, f.tenantId));
  await database
    .delete(registrationAcquisitionRefundAllocations)
    .where(eq(registrationAcquisitionRefundAllocations.tenantId, f.tenantId));
  await database
    .delete(registrationAcquisitionComponents)
    .where(eq(registrationAcquisitionComponents.tenantId, f.tenantId));
  await database
    .delete(registrationAcquisitionPayments)
    .where(eq(registrationAcquisitionPayments.tenantId, f.tenantId));
  await database
    .delete(registrationAcquisitions)
    .where(eq(registrationAcquisitions.tenantId, f.tenantId));
  await database
    .delete(eventRegistrationAddonPurchases)
    .where(eq(eventRegistrationAddonPurchases.tenantId, f.tenantId));
  await database
    .delete(transactions)
    .where(eq(transactions.tenantId, f.tenantId));
  await database
    .delete(eventRegistrations)
    .where(eq(eventRegistrations.tenantId, f.tenantId));
  await database
    .delete(eventRegistrationOptions)
    .where(eq(eventRegistrationOptions.eventId, f.eventId));
  await database
    .delete(eventInstances)
    .where(eq(eventInstances.tenantId, f.tenantId));
  await database
    .delete(eventTemplates)
    .where(eq(eventTemplates.tenantId, f.tenantId));
  await database
    .delete(eventTemplateCategories)
    .where(eq(eventTemplateCategories.tenantId, f.tenantId));
  await database
    .delete(rolesToTenantUsers)
    .where(eq(rolesToTenantUsers.tenantId, f.tenantId));
  await database
    .delete(usersToTenants)
    .where(eq(usersToTenants.tenantId, f.tenantId));
  await database.delete(roles).where(eq(roles.tenantId, f.tenantId));
  await database.delete(users).where(eq(users.id, f.userId));
  await database
    .delete(tenantStripeTaxRates)
    .where(eq(tenantStripeTaxRates.tenantId, f.tenantId));
  await database.delete(tenants).where(eq(tenants.id, f.tenantId));
};

const seed = async () => {
  const f = newFixture();
  try {
    const [tenantRecord] = await database
      .insert(tenants)
      .values({
        domain: `${f.tenantId}.recovery.example`,
        id: f.tenantId,
        name: 'Recovery organization',
        stripeAccountId: f.stripeAccountId,
      })
      .returning();
    if (!tenantRecord) throw new Error('Missing fixture tenant');
    await database.insert(users).values({
      auth0Id: `auth0|${f.userId}`,
      communicationEmail: f.snapshot.notificationEmail,
      email: f.snapshot.customerEmail,
      firstName: 'Ada',
      id: f.userId,
      lastName: 'Lovelace',
    });
    await database
      .insert(usersToTenants)
      .values({ id: f.membershipId, tenantId: f.tenantId, userId: f.userId });
    await database.insert(roles).values({
      defaultUserRole: true,
      id: f.roleId,
      name: 'Attendee',
      tenantId: f.tenantId,
    });
    await database.insert(rolesToTenantUsers).values({
      roleId: f.roleId,
      tenantId: f.tenantId,
      userTenantId: f.membershipId,
    });
    await database.insert(eventTemplateCategories).values({
      icon: { iconColor: 0, iconName: 'calendar:fas' },
      id: f.categoryId,
      tenantId: f.tenantId,
      title: 'Recovery category',
    });
    await database.insert(eventTemplates).values({
      categoryId: f.categoryId,
      description: 'Recovery fixture',
      icon: { iconColor: 0, iconName: 'calendar:fas' },
      id: f.templateId,
      tenantId: f.tenantId,
      title: 'Recovery template',
    });
    await database.insert(eventInstances).values({
      creatorId: f.userId,
      description: 'Recovery fixture',
      end: new Date(f.now.getTime() + 90_000_000),
      icon: { iconColor: 0, iconName: 'calendar:fas' },
      id: f.eventId,
      reviewedAt: f.now,
      reviewedBy: f.userId,
      start: new Date(f.now.getTime() + 86_400_000),
      status: 'APPROVED',
      templateId: f.templateId,
      tenantId: f.tenantId,
      title: f.snapshot.eventTitle,
    });
    await database.insert(tenantStripeTaxRates).values({
      active: true,
      displayName: 'VAT',
      inclusive: true,
      percentage: '0',
      stripeAccountId: f.stripeAccountId,
      stripeTaxRateId: 'txr_fixture_zero',
      tenantId: f.tenantId,
    });
    await database.insert(eventRegistrationOptions).values({
      closeRegistrationTime: new Date(f.now.getTime() + 43_200_000),
      eventId: f.eventId,
      id: f.optionId,
      isPaid: true,
      openRegistrationTime: new Date(f.now.getTime() - 3_600_000),
      organizingRegistration: false,
      price: 1000,
      registrationMode: 'fcfs',
      reservedSpots: 1,
      roleIds: [f.roleId],
      spots: 10,
      stripeTaxRateId: 'txr_fixture_zero',
      title: 'Participant',
    });
    await database.insert(eventRegistrations).values({
      basePriceAtRegistration: 1000,
      discountAmount: 0,
      eventId: f.eventId,
      id: f.registrationId,
      registrationOptionId: f.optionId,
      status: 'PENDING',
      stripeTaxRateId: 'txr_fixture_zero',
      taxRateDisplayName: 'VAT',
      taxRateInclusive: true,
      taxRatePercentage: '0',
      tenantId: f.tenantId,
      userId: f.userId,
    });
    await database.insert(transactions).values({
      amount: 1000,
      appFee: 100,
      createdAt: f.now,
      currency: 'EUR',
      eventId: f.eventId,
      eventRegistrationId: f.registrationId,
      executiveUserId: f.userId,
      id: f.claimId,
      method: 'stripe',
      status: 'pending',
      stripeAccountId: f.stripeAccountId,
      stripeCheckoutRequest: f.snapshot,
      targetUserId: f.userId,
      tenantId: f.tenantId,
      type: 'registration',
    });
    return { ...f, tenant: Schema.decodeUnknownSync(Tenant)(tenantRecord) };
  } catch (error) {
    try {
      await cleanup(f);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Recovery fixture setup and cleanup failed',
        { cause: cleanupError },
      );
    }
    throw error;
  }
};
type SeededFixture = Awaited<ReturnType<typeof seed>>;

class FixtureResponse extends Stripe.HttpClientResponse {
  constructor(
    private readonly body: object,
    statusCode = 200,
  ) {
    super(statusCode, { 'request-id': 'req_recovery_fixture' });
  }
  override getRawResponse() {
    return {};
  }
  override toJSON() {
    return Promise.resolve({ ...this.body });
  }
}
class RecoveryStripeHttp extends Stripe.HttpClient {
  readonly requests: {
    account: string | undefined;
    method: string;
    path: string;
  }[] = [];
  session: Stripe.Checkout.Session;
  lines = [stripeLineItemFixture()];
  paymentFee = 100;
  listMode:
    | 'ambiguous'
    | 'complete'
    | 'emptyContinuation'
    | 'incomplete'
    | 'missing'
    | 'paginated'
    | 'repeated'
    | 'unavailable' = 'complete';
  onSessionRead: (() => Promise<void>) | undefined;
  constructor(readonly fixture: Fixture) {
    super();
    this.session = stripeCheckoutSessionResponse({
      amount_subtotal: 1000,
      amount_total: 1000,
      cancel_url: `${fixture.snapshot.eventUrl}?registrationStatus=cancel`,
      created: Math.floor(fixture.now.getTime() / 1000),
      customer_email: fixture.snapshot.customerEmail,
      expires_at: fixture.snapshot.expiresAt,
      id: fixture.sessionId,
      metadata: {
        registrationId: fixture.registrationId,
        tenantId: fixture.tenantId,
        transactionId: fixture.claimId,
        userId: fixture.userId,
      },
      payment_intent: null,
      payment_status: 'unpaid',
      status: 'open',
      success_url: `${fixture.snapshot.eventUrl}?registrationStatus=success`,
    });
  }
  override getClientName() {
    return 'evorto-checkout-recovery-fixture';
  }
  override async makeRequest(
    ...args: Parameters<Stripe.HttpClient['makeRequest']>
  ) {
    const path = args[2];
    const method = args[3];
    const headers = args[4];
    const account = headers['Stripe-Account'];
    if (typeof account !== 'string')
      throw new Error('Missing connected account');
    this.requests.push({ account, method, path });
    expect(method).toBe('GET');
    expect(headers['Stripe-Account']).toBe(this.fixture.stripeAccountId);
    const url = new URL(path, 'https://api.stripe.com');
    if (url.pathname === '/v1/checkout/sessions') {
      expect(url.searchParams.get('limit')).toBe('100');
      if (this.listMode === 'unavailable')
        return new FixtureResponse(
          { error: { message: 'Fixture unavailable', type: 'api_error' } },
          503,
        );
      const offset = this.requests.filter(
        (r) =>
          new URL(r.path, 'https://api.stripe.com').pathname === url.pathname,
      ).length;
      if (this.listMode === 'paginated' || this.listMode === 'repeated') {
        expect(url.searchParams.get('starting_after')).toBe(
          offset === 1 ? null : this.session.id,
        );
        return new FixtureResponse({
          data:
            offset === 1 || this.listMode === 'repeated'
              ? [this.session]
              : [
                  {
                    ...this.session,
                    id: `${this.session.id}_unrelated`,
                    metadata: {},
                  },
                ],
          has_more: offset === 1,
          object: 'list',
          url: url.pathname,
        });
      }
      if (this.listMode === 'emptyContinuation')
        return new FixtureResponse({
          data: [],
          has_more: true,
          object: 'list',
          url: url.pathname,
        });
      return new FixtureResponse({
        data:
          this.listMode === 'missing'
            ? []
            : this.listMode === 'ambiguous'
              ? [
                  this.session,
                  { ...this.session, id: `${this.session.id}_duplicate` },
                ]
              : this.listMode === 'incomplete'
                ? [
                    {
                      ...this.session,
                      id: `${this.session.id}_page_${offset}`,
                      metadata: {},
                    },
                  ]
                : [this.session],
        has_more: this.listMode === 'incomplete',
        object: 'list',
        url: '/v1/checkout/sessions',
      });
    }
    if (url.pathname.endsWith('/line_items'))
      return new FixtureResponse({
        data: this.lines,
        has_more: false,
        object: 'list',
        url: url.pathname,
      });
    if (url.pathname === `/v1/checkout/sessions/${this.session.id}`) {
      if (this.onSessionRead) await this.onSessionRead();
      return new FixtureResponse(this.session);
    }
    const charge = stripeChargeResponse({
      amount: 1000,
      application_fee_amount: this.paymentFee,
      balance_transaction: stripeBalanceTransactionResponse({
        amount: 1000,
        currency: 'eur',
        fee: this.paymentFee,
        fee_details: [
          {
            amount: this.paymentFee,
            application: null,
            currency: 'eur',
            description: 'Application fee',
            type: 'application_fee',
          },
        ],
        net: 1000 - this.paymentFee,
        source: `ch_${this.fixture.claimId}`,
      }),
      currency: 'eur',
      id: `ch_${this.fixture.claimId}`,
      payment_intent: `pi_${this.fixture.claimId}`,
    });
    if (url.pathname === `/v1/payment_intents/pi_${this.fixture.claimId}`)
      return new FixtureResponse(
        stripePaymentIntentResponse({
          amount: 1000,
          application_fee_amount: this.paymentFee,
          currency: 'eur',
          id: `pi_${this.fixture.claimId}`,
          latest_charge: charge,
        }),
      );
    if (url.pathname === `/v1/charges/${charge.id}`)
      return new FixtureResponse(charge);
    throw new Error(`Unexpected provider read ${url.pathname}`);
  }
  client() {
    return new Stripe('sk_test_fixture', {
      httpClient: this,
      maxNetworkRetries: 0,
    });
  }
}

const asPlatform = <A, E, R>(
  f: SeededFixture,
  http: RecoveryStripeHttp,
  effect: Effect.Effect<A, E, R>,
) =>
  effect.pipe(
    Effect.provideService(StripeClient, http.client()),
    Effect.provideService(RpcRequestContext, {
      authData: {},
      authenticated: true,
      permissions: [],
      platformAuthority: PlatformAdministratorAuthority.make({
        actorEmail: 'operator@example.org',
        actorId: 'auth0|recovery-operator',
        kind: 'platformAdministrator',
      }),
      tenant: f.tenant,
      user: null,
      userAssigned: false,
    }),
  );
const withFixture = <A, E, R>(
  use: (f: SeededFixture, http: RecoveryStripeHttp) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.promise(seed),
    (f) => use(f, new RecoveryStripeHttp(f)),
    (f) => Effect.promise(() => cleanup(f)),
  );
const recoveryInput = (f: SeededFixture) =>
  Effect.gen(function* () {
    const queue = yield* checkoutRecoveryQueue({
      limit: 25,
      offset: 0,
      targetTenantId: f.tenantId,
    });
    expect(queue.data).toHaveLength(1);
    const row = queue.data[0];
    if (!row) throw new Error('Missing recovery claim');
    return {
      claimId: row.id,
      expectedVersion: row.version,
      reason: 'Restore the verified original payment',
      targetTenantId: f.tenantId,
    };
  });
const readClaim = (f: Fixture) =>
  database.query.transactions.findFirst({
    where: { id: f.claimId, tenantId: f.tenantId },
  });
const assertHeld = async (f: Fixture) => {
  expect(await readClaim(f)).toMatchObject({
    amount: 1000,
    appFee: 100,
    status: 'pending',
    stripeCheckoutSessionId: null,
    stripeCheckoutUrl: null,
  });
  expect(
    await database.query.eventRegistrations.findFirst({
      where: { id: f.registrationId },
    }),
  ).toMatchObject({ status: 'PENDING' });
  expect(
    await database.query.eventRegistrationOptions.findFirst({
      where: { id: f.optionId },
    }),
  ).toMatchObject({ reservedSpots: 1 });
  expect(
    await database.query.platformAuditEntries.findMany({
      where: { targetTenantId: f.tenantId },
    }),
  ).toEqual([]);
};

layer(services, { excludeTestServices: true })(
  'audited existing Checkout recovery',
  (it) => {
    for (const known of [false, true]) {
      it.effect(
        `restores the original open page with known identity ${known} and preserves the claim`,
        () =>
          withFixture((f, http) =>
            asPlatform(
              f,
              http,
              Effect.gen(function* () {
                if (known)
                  yield* Effect.promise(() =>
                    database
                      .update(transactions)
                      .set({
                        stripeCheckoutIncidentSessionId: f.sessionId,
                        stripeCheckoutReconcileLastError:
                          'Unconfirmed original binding',
                      })
                      .where(eq(transactions.id, f.claimId)),
                  );
                const input = yield* recoveryInput(f);
                expect(yield* recoverCheckout(input)).toEqual({
                  claimId: f.claimId,
                  sessionState: 'open',
                });
                expect(yield* Effect.promise(() => readClaim(f))).toMatchObject(
                  {
                    amount: 1000,
                    appFee: 100,
                    status: 'pending',
                    stripeCheckoutIncidentSessionId: null,
                    stripeCheckoutRequest: f.snapshot,
                    stripeCheckoutSessionId: f.sessionId,
                    stripeCheckoutUrl: http.session.url,
                  },
                );
                const audit = yield* Effect.promise(() =>
                  database.query.platformAuditEntries.findMany({
                    where: { targetTenantId: f.tenantId },
                  }),
                );
                expect(audit).toHaveLength(1);
                expect(audit[0]).toMatchObject({
                  action: 'registration.recoverCheckout',
                  actorId: 'auth0|recovery-operator',
                  after: { state: { sessionId: f.sessionId } },
                  before: {
                    state: { incidentSessionId: known ? f.sessionId : null },
                  },
                  reason: input.reason,
                });
                expect(http.requests.every((r) => r.method === 'GET')).toBe(
                  true,
                );
                expect(
                  http.requests.some(
                    (r) =>
                      new URL(r.path, 'https://api.stripe.com').pathname ===
                      '/v1/checkout/sessions',
                  ),
                ).toBe(!known);
                expect(
                  yield* Effect.promise(() =>
                    database.query.eventRegistrationOptions.findFirst({
                      where: { id: f.optionId },
                    }),
                  ),
                ).toMatchObject({ reservedSpots: 1 });
              }),
            ),
          ),
      );
    }

    for (const mode of [
      'missing',
      'ambiguous',
      'incomplete',
      'unavailable',
    ] as const) {
      it.effect(`leaves the reservation intact when discovery is ${mode}`, () =>
        withFixture((f, http) =>
          asPlatform(
            f,
            http,
            Effect.gen(function* () {
              http.listMode = mode;
              const result = yield* recoverCheckout(
                yield* recoveryInput(f),
              ).pipe(Effect.result);
              expect(Result.isFailure(result)).toBe(true);
              yield* Effect.promise(() => assertHeld(f));
              expect(http.requests).toHaveLength(mode === 'incomplete' ? 3 : 1);
            }),
          ),
        ),
      );
    }

    for (const mismatch of [
      'metadata',
      'amount',
      'currency',
      'expiry',
      'url',
      'lineItems',
      'fee',
    ] as const) {
      it.effect(`rejects mismatched ${mismatch} before binding`, () =>
        withFixture((f, http) =>
          asPlatform(
            f,
            http,
            Effect.gen(function* () {
              switch (mismatch) {
                case 'amount': {
                  http.session.amount_total = 1001;
                  break;
                }
                case 'currency': {
                  http.session.currency = 'usd';
                  break;
                }
                case 'expiry': {
                  http.session.expires_at += 1;
                  break;
                }
                case 'fee': {
                  http.session.status = 'complete';
                  http.session.payment_status = 'paid';
                  http.session.payment_intent = `pi_${f.claimId}`;
                  http.paymentFee = 200;
                  break;
                }
                case 'lineItems': {
                  http.lines = [stripeLineItemFixture({ quantity: 2 })];
                  break;
                }
                case 'metadata': {
                  http.session.metadata = {
                    ...http.session.metadata,
                    userId: 'other-user',
                  };
                  break;
                }
                case 'url': {
                  http.session.url = 'https://untrusted.example/pay';
                  break;
                }
              }
              expect(
                Result.isFailure(
                  yield* recoverCheckout(yield* recoveryInput(f)).pipe(
                    Effect.result,
                  ),
                ),
              ).toBe(true);
              yield* Effect.promise(() => assertHeld(f));
            }),
          ),
        ),
      );
    }

    it.effect(
      'denies ordinary tenant authority and missing claims before reading Stripe',
      () =>
        withFixture((f, http) =>
          asPlatform(
            f,
            http,
            Effect.gen(function* () {
              const input = yield* recoveryInput(f);
              const denied = yield* recoverCheckout(input).pipe(
                Effect.provideService(RpcRequestContext, {
                  authData: {},
                  authenticated: true,
                  permissions: [
                    'finance:viewTransactions',
                    'events:organizeAll',
                  ],
                  platformAuthority: null,
                  tenant: f.tenant,
                  user: null,
                  userAssigned: false,
                }),
                Effect.result,
              );
              expect(Result.isFailure(denied)).toBe(true);
              expect(
                Result.isFailure(
                  yield* recoverCheckout({
                    ...input,
                    claimId: createId(),
                  }).pipe(Effect.result),
                ),
              ).toBe(true);
              expect(http.requests).toEqual([]);
              yield* Effect.promise(() => assertHeld(f));
            }),
          ),
        ),
    );

    it.effect(
      'denies a real claim from another tenant before reading Stripe',
      () =>
        withFixture((f, http) =>
          withFixture((foreign) =>
            asPlatform(
              f,
              http,
              Effect.gen(function* () {
                const input = yield* recoveryInput(f);
                const outcome = yield* recoverCheckout({
                  ...input,
                  claimId: foreign.claimId,
                }).pipe(Effect.result);
                expect(Result.isFailure(outcome)).toBe(true);
                expect(http.requests).toEqual([]);
                yield* Effect.promise(() => assertHeld(f));
                yield* Effect.promise(() => assertHeld(foreign));
              }),
            ),
          ),
        ),
    );

    for (const mode of [
      'paginated',
      'repeated',
      'emptyContinuation',
    ] as const) {
      it.effect(
        `requires a complete unique provider search for ${mode} pages`,
        () =>
          withFixture((f, http) =>
            asPlatform(
              f,
              http,
              Effect.gen(function* () {
                http.listMode = mode;
                const outcome = yield* recoverCheckout(
                  yield* recoveryInput(f),
                ).pipe(Effect.result);
                expect(Result.isSuccess(outcome)).toBe(mode === 'paginated');
                if (mode === 'paginated') {
                  expect(
                    yield* Effect.promise(() => readClaim(f)),
                  ).toMatchObject({ stripeCheckoutSessionId: f.sessionId });
                } else {
                  yield* Effect.promise(() => assertHeld(f));
                }
              }),
            ),
          ),
      );
    }

    for (const change of [
      'account',
      'amount',
      'cancellation',
      'binding',
      'approvalMode',
      'registration',
    ] as const) {
      it.effect(
        `preserves a concurrent ${change} change without adding a recovery audit`,
        () =>
          withFixture((f, http) =>
            asPlatform(
              f,
              http,
              Effect.gen(function* () {
                const input = yield* recoveryInput(f);
                http.onSessionRead = async () => {
                  switch (change) {
                    case 'account': {
                      await database
                        .update(tenants)
                        .set({
                          stripeAccountId: `${f.stripeAccountId}_changed`,
                        })
                        .where(eq(tenants.id, f.tenantId));
                      break;
                    }
                    case 'amount': {
                      await database
                        .update(transactions)
                        .set({ amount: 999 })
                        .where(eq(transactions.id, f.claimId));
                      break;
                    }
                    case 'approvalMode': {
                      await database
                        .update(eventRegistrationOptions)
                        .set({ registrationMode: 'application' })
                        .where(eq(eventRegistrationOptions.id, f.optionId));
                      break;
                    }
                    case 'binding': {
                      await database
                        .update(transactions)
                        .set({
                          stripeCheckoutSessionId: f.sessionId,
                          stripeCheckoutUrl: http.session.url,
                        })
                        .where(eq(transactions.id, f.claimId));
                      break;
                    }
                    case 'cancellation': {
                      await database
                        .update(transactions)
                        .set({ stripeCheckoutCancellationRequestedAt: f.now })
                        .where(eq(transactions.id, f.claimId));
                      break;
                    }
                    case 'registration': {
                      await database
                        .update(eventRegistrations)
                        .set({ status: 'CANCELLED' })
                        .where(eq(eventRegistrations.id, f.registrationId));
                      break;
                    }
                  }
                };
                const outcome = yield* recoverCheckout(input).pipe(
                  Effect.result,
                );
                expect(Result.isFailure(outcome)).toBe(true);
                const claim = yield* Effect.promise(() => readClaim(f));
                expect(claim).toMatchObject({
                  amount: change === 'amount' ? 999 : 1000,
                  appFee: 100,
                  status: 'pending',
                  stripeCheckoutSessionId:
                    change === 'binding' ? f.sessionId : null,
                });
                expect(claim?.stripeCheckoutCancellationRequestedAt).toEqual(
                  change === 'cancellation' ? f.now : null,
                );
                expect(
                  yield* Effect.promise(() =>
                    database.query.platformAuditEntries.findMany({
                      where: { targetTenantId: f.tenantId },
                    }),
                  ),
                ).toEqual([]);
                expect(
                  yield* Effect.promise(() =>
                    database.query.eventRegistrationOptions.findFirst({
                      where: { id: f.optionId },
                    }),
                  ),
                ).toMatchObject({ reservedSpots: 1 });
              }),
            ),
          ),
      );
    }

    for (const recoveredState of ['open', 'expired'] as const) {
      it.effect(
        `preserves the whole reserved add-on bundle until ${recoveredState} reconciliation`,
        () =>
          withFixture((f, http) =>
            asPlatform(
              f,
              http,
              Effect.gen(function* () {
                const addonId = createId();
                const purchaseId = createId();
                const lotId = createId();
                yield* Effect.promise(async () => {
                  await database.insert(eventAddons).values({
                    allowMultiple: true,
                    allowPurchaseBeforeEvent: false,
                    allowPurchaseDuringEvent: false,
                    allowPurchaseDuringRegistration: true,
                    eventId: f.eventId,
                    id: addonId,
                    isPaid: false,
                    maxQuantityPerUser: 2,
                    price: 0,
                    title: 'Included and optional equipment',
                    totalAvailableQuantity: 3,
                  });
                  await database
                    .insert(addonToEventRegistrationOptions)
                    .values({
                      addonId,
                      eventId: f.eventId,
                      includedQuantity: 1,
                      optionalPurchaseQuantity: 1,
                      registrationOptionId: f.optionId,
                    });
                  await database
                    .insert(eventRegistrationAddonPurchases)
                    .values({
                      addonId,
                      eventId: f.eventId,
                      id: purchaseId,
                      includedQuantity: 1,
                      purchasedQuantity: 1,
                      quantity: 2,
                      registrationId: f.registrationId,
                      registrationOptionId: f.optionId,
                      tenantId: f.tenantId,
                      unitPrice: 0,
                    });
                  await database
                    .insert(eventRegistrationAddonPurchaseLots)
                    .values({
                      applicationFeeAmount: 0,
                      baseAmount: 0,
                      currency: 'EUR',
                      eventId: f.eventId,
                      grossAmount: 0,
                      id: lotId,
                      netAmount: 0,
                      paymentAllocationFinalizedAt: f.now,
                      purchaseId,
                      quantity: 1,
                      registrationId: f.registrationId,
                      registrationOptionId: f.optionId,
                      sourceLineKey: `addon-lot:${lotId}`,
                      stripeFeeAmount: 0,
                      taxAmount: 0,
                      tenantId: f.tenantId,
                      unitPrice: 0,
                    });
                });
                const readBundle = () =>
                  Promise.all([
                    database.query.eventAddons.findFirst({
                      where: { id: addonId },
                    }),
                    database.query.eventRegistrationAddonPurchases.findFirst({
                      where: { id: purchaseId },
                    }),
                    database.query.eventRegistrationAddonPurchaseLots.findFirst(
                      { where: { id: lotId } },
                    ),
                  ]);
                const before = yield* Effect.promise(readBundle);
                http.session.status = recoveredState;
                if (recoveredState === 'expired') http.session.url = null;
                yield* recoverCheckout(yield* recoveryInput(f));
                expect(yield* Effect.promise(readBundle)).toEqual(before);
                const first = yield* processDueBoundRegistrationCheckouts({
                  nowEpochSeconds: Math.floor(Date.now() / 1000) + 10,
                });
                expect(first.failed).toBe(0);
                const after = yield* Effect.promise(readBundle);
                expect(after[0]?.totalAvailableQuantity).toBe(
                  recoveredState === 'expired' ? 5 : 3,
                );
                if (recoveredState === 'open') expect(after).toEqual(before);
                else {
                  // Expiry releases inventory while retaining the original purchase history.
                  expect(after[1]).toEqual(before[1]);
                  expect(after[2]).toEqual(before[2]);
                  expect(
                    yield* Effect.promise(() => readClaim(f)),
                  ).toMatchObject({ status: 'cancelled' });
                  expect(
                    yield* Effect.promise(() =>
                      database.query.eventRegistrations.findFirst({
                        where: { id: f.registrationId },
                      }),
                    ),
                  ).toMatchObject({ status: 'CANCELLED' });
                  yield* processDueBoundRegistrationCheckouts({
                    nowEpochSeconds: Math.floor(Date.now() / 1000) + 20,
                  });
                  expect(yield* Effect.promise(readBundle)).toEqual(after);
                }
              }),
            ),
          ),
      );
    }

    it.effect('revalidates a claim changed during the provider read', () =>
      withFixture((f, http) =>
        asPlatform(
          f,
          http,
          Effect.gen(function* () {
            const input = yield* recoveryInput(f);
            http.onSessionRead = async () => {
              await database
                .update(transactions)
                .set({ comment: 'Changed while investigating' })
                .where(eq(transactions.id, f.claimId));
            };
            expect(
              Result.isFailure(
                yield* recoverCheckout(input).pipe(Effect.result),
              ),
            ).toBe(true);
            yield* Effect.promise(() => assertHeld(f));
          }),
        ),
      ),
    );

    it.effect(
      'commits exactly one recovery and audit when two operators race',
      () =>
        withFixture((f, http) =>
          asPlatform(
            f,
            http,
            Effect.gen(function* () {
              const input = yield* recoveryInput(f);
              const outcomes = yield* Effect.all(
                [
                  recoverCheckout(input).pipe(Effect.result),
                  recoverCheckout(input).pipe(Effect.result),
                ],
                { concurrency: 2 },
              );
              expect(
                outcomes.filter((outcome) => Result.isSuccess(outcome)),
              ).toHaveLength(1);
              expect(
                outcomes.filter((outcome) => Result.isFailure(outcome)),
              ).toHaveLength(1);
              expect(
                yield* Effect.promise(() =>
                  database.query.platformAuditEntries.findMany({
                    where: { targetTenantId: f.tenantId },
                  }),
                ),
              ).toHaveLength(1);
              expect(
                Result.isFailure(
                  yield* recoverCheckout(input).pipe(Effect.result),
                ),
              ).toBe(true);
            }),
          ),
        ),
    );

    it.effect('rolls back a binding when its audit cannot be persisted', () =>
      withFixture((f, http) =>
        asPlatform(
          f,
          http,
          Effect.gen(function* () {
            const input = yield* recoveryInput(f);
            const outcome = yield* recoverCheckout({
              ...input,
              reason: 'Invalid audit\0text',
            }).pipe(Effect.exit);
            expect(Exit.isFailure(outcome)).toBe(true);
            yield* Effect.promise(() => assertHeld(f));
          }),
        ),
      ),
    );

    for (const existingNotification of [false, true]) {
      it.effect(
        `preserves one-attempt approval notification with existing record ${existingNotification}`,
        () =>
          withFixture((f, http) =>
            asPlatform(
              f,
              http,
              Effect.gen(function* () {
                yield* Effect.promise(() =>
                  database
                    .update(eventRegistrationOptions)
                    .set({ registrationMode: 'application' })
                    .where(eq(eventRegistrationOptions.id, f.optionId)),
                );
                if (existingNotification)
                  yield* Effect.promise(() =>
                    database.insert(emailOutbox).values({
                      attempts: 1,
                      html: '<p>Original</p>',
                      idempotencyKey: `manual-approval/${f.tenantId}/${f.registrationId}/${f.claimId}`,
                      kind: 'manualApproval',
                      lastError: 'Delivery failed',
                      status: 'failed',
                      subject: 'Original notification',
                      tenantId: f.tenantId,
                      text: 'Original',
                      toEmail: f.snapshot.notificationEmail,
                    }),
                  );
                yield* recoverCheckout(yield* recoveryInput(f));
                const notifications = yield* Effect.promise(() =>
                  database.query.emailOutbox.findMany({
                    where: { kind: 'manualApproval', tenantId: f.tenantId },
                  }),
                );
                expect(notifications).toHaveLength(1);
                expect(notifications[0]).toMatchObject({
                  attempts: existingNotification ? 1 : 0,
                  status: existingNotification ? 'failed' : 'queued',
                });
                if (existingNotification)
                  expect(notifications[0]?.subject).toBe(
                    'Original notification',
                  );
              }),
            ),
          ),
      );
    }

    for (const state of [
      'paid',
      'expired',
      'feeChangedAfterRecovery',
    ] as const) {
      it.effect(
        `hands ${state} to canonical reconciliation without creating another Checkout`,
        () =>
          withFixture((f, http) =>
            asPlatform(
              f,
              http,
              Effect.gen(function* () {
                if (state === 'paid') {
                  http.session.status = 'complete';
                  http.session.payment_status = 'paid';
                  http.session.payment_intent = `pi_${f.claimId}`;
                  http.session.url = null;
                } else if (state === 'expired') {
                  http.session.status = 'expired';
                  http.session.url = null;
                }
                yield* recoverCheckout(yield* recoveryInput(f));
                if (state === 'feeChangedAfterRecovery') {
                  http.session.status = 'complete';
                  http.session.payment_status = 'paid';
                  http.session.payment_intent = `pi_${f.claimId}`;
                  http.paymentFee = 200;
                }
                const result = yield* processDueBoundRegistrationCheckouts({
                  nowEpochSeconds: Math.floor(Date.now() / 1000) + 10,
                });
                expect(result.failed).toBe(
                  state === 'feeChangedAfterRecovery' ? 1 : 0,
                );
                const registration = yield* Effect.promise(() =>
                  database.query.eventRegistrations.findFirst({
                    where: { id: f.registrationId },
                  }),
                );
                expect(registration?.status).toBe(
                  state === 'paid'
                    ? 'CONFIRMED'
                    : state === 'expired'
                      ? 'CANCELLED'
                      : 'PENDING',
                );
                const option = yield* Effect.promise(() =>
                  database.query.eventRegistrationOptions.findFirst({
                    where: { id: f.optionId },
                  }),
                );
                expect(option?.reservedSpots).toBe(
                  state === 'feeChangedAfterRecovery' ? 1 : 0,
                );
                expect(http.requests.every((r) => r.method === 'GET')).toBe(
                  true,
                );
              }),
            ),
          ),
      );
    }
  },
);
