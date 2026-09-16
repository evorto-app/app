import * as PgClient from '@effect/sql-pg/PgClient';
import { afterAll, beforeAll, describe, expect, it, vi } from '@effect/vitest';
import { EventRegistrationConflictError } from '@shared/rpc-contracts/app-rpcs/events.errors';
import { RpcRequestContext } from '@shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';
import { and, eq, getTableName } from 'drizzle-orm';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  Cause,
  ConfigProvider,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
} from 'effect';
import { Pool } from 'pg';
import Stripe from 'stripe';

import { Database, databaseLayer } from '../../db';
import { createId } from '../../db/create-id';
import {
  createNodePgPoolConfig,
  createPgClientConfig,
} from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import {
  addonToEventRegistrationOptions,
  emailOutbox,
  eventAddons,
  eventInstances,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchaseOrders,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  platformAuditEntries,
  registrationAcquisitionComponents,
  registrationAcquisitionPayments,
  registrationAcquisitions,
  roles,
  rolesToTenantUsers,
  tenants,
  tenantStripeTaxRates,
  transactions,
  users,
  usersToTenants,
} from '../../db/schema';
import { PlatformAdministratorAuthority } from '../../types/custom/platform-authority';
import { Tenant } from '../../types/custom/tenant';
import { EventRegistrationService } from '../effect/rpc/handlers/events/event-registration.service';
import { platformTenantAdminHandlers } from '../effect/rpc/handlers/platform/platform-tenant-admin.handlers';
import { RpcAccess } from '../effect/rpc/handlers/shared/rpc-access.service';
import { buildCheckoutSessionExpiresAt } from '../integrations/stripe-checkout';
import { StripeClient } from '../stripe-client';
import {
  createRejectingStripeClient,
  stripeBalanceTransactionResponse,
  stripeChargeResponse,
  stripePaymentIntentResponse,
} from '../testing/stripe-test-fixtures';
import {
  completePaidAddonPurchaseCheckout,
  expirePaidAddonPurchaseCheckout,
} from './addon-purchase-checkout';
import {
  purchaseRegistrationAddon,
  type PurchaseRegistrationAddonInput,
} from './addon-purchase.service';
import { expiredUnboundAddonPurchaseCheckoutPredicate } from './expired-checkout-cleanup';
import { completePaidRegistrationCheckout } from './registration-checkout-completion';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

interface Fixture {
  readonly addOnId: string;
  readonly categoryId: string;
  readonly eventId: string;
  readonly expiresAt: Date;
  readonly optionId: string;
  readonly orderId?: string | undefined;
  readonly purchaseId?: string | undefined;
  readonly purchaseLotId?: string | undefined;
  readonly registrationIds: readonly string[];
  readonly sharedTenant?: boolean;
  readonly templateId: string;
  readonly tenantId: string;
  readonly transactionId?: string | undefined;
  readonly userIds: readonly string[];
}

type TestDatabase = NodePgDatabase<typeof relations>;

const requireValue = <A>(value: A | null | undefined, label: string): A => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
};

const paidFixtureIdentity = (fixture: Fixture) => ({
  orderId: requireValue(fixture.orderId, 'paid fixture order'),
  registrationId: requireValue(
    fixture.registrationIds[0],
    'paid fixture registration',
  ),
  transactionId: requireValue(
    fixture.transactionId,
    'paid fixture transaction',
  ),
});

const fakeStripe = createRejectingStripeClient();
vi.spyOn(fakeStripe.charges, 'retrieve').mockImplementation(
  async (chargeId) => {
    const orderId = chargeId.replace(/^ch_/, '');
    return stripeChargeResponse({
      amount: 100,
      balance_transaction: stripeBalanceTransactionResponse({
        amount: 100,
        currency: 'eur',
        fee: 7,
        fee_details: [
          {
            amount: 4,
            application: null,
            currency: 'eur',
            description: null,
            type: 'application_fee',
          },
          {
            amount: 3,
            application: null,
            currency: 'eur',
            description: null,
            type: 'stripe_fee',
          },
        ],
        id: 'txn_' + orderId,
        net: 93,
        source: chargeId,
      }),
      captured: true,
      currency: 'eur',
      id: chargeId,
      paid: true,
      payment_intent: 'pi_' + orderId,
    });
  },
);

const makeLayer = (url: string, stripe: Stripe = fakeStripe) => {
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: {
        BASE_URL: 'https://addon-purchase.example',
        DATABASE_TLS_REQUIRED: 'false',
        DATABASE_URL: url,
        NODE_ENV: 'test',
      },
    }),
  );
  return Layer.mergeAll(
    config,
    databaseLayer.pipe(Layer.provide(config)),
    Layer.succeed(StripeClient, stripe),
  );
};

const seedFixture = async (
  database: TestDatabase,
  input: {
    readonly eventEnd?: Date;
    readonly eventStart?: Date;
    readonly existingTenantId?: string;
    readonly paid: boolean;
    readonly registrationCount?: number;
    readonly reservationExpiresAt?: Date;
    readonly seedPaidReservation?: boolean;
    readonly stock: number;
  },
): Promise<Fixture> => {
  const tenantId = input.existingTenantId ?? createId();
  const categoryId = createId();
  const templateId = createId();
  const eventId = createId();
  const optionId = createId();
  const addOnId = createId();
  const registrationCount = input.registrationCount ?? 1;
  const userIds = Array.from({ length: registrationCount }, () => createId());
  const registrationIds = Array.from({ length: registrationCount }, () =>
    createId(),
  );
  const now = Date.now();
  const expiresAt =
    input.reservationExpiresAt ?? new Date(now + 30 * 60 * 1000);
  const creatorId = requireValue(userIds[0], 'fixture creator');

  return database.transaction(async (transaction) => {
    if (!input.existingTenantId)
      await transaction.insert(tenants).values({
        domain: `${tenantId}.addon-purchase.example`,
        id: tenantId,
        name: 'Add-on purchase test',
        stripeAccountId: 'acct_addon_purchase_test',
      });
    await transaction.insert(users).values(
      userIds.map((userId, index) => ({
        auth0Id: `auth0|${userId}`,
        communicationEmail: `${userId}.contact@example.com`,
        email: `${userId}.login@example.com`,
        firstName: 'Add-on',
        id: userId,
        lastName: `Tester ${index}`,
      })),
    );
    await transaction.insert(eventTemplateCategories).values({
      icon: { iconColor: 0, iconName: 'circle' },
      id: categoryId,
      tenantId,
      title: 'Add-on purchase',
    });
    await transaction.insert(eventTemplates).values({
      categoryId,
      description: 'Add-on purchase test',
      icon: { iconColor: 0, iconName: 'circle' },
      id: templateId,
      tenantId,
      title: 'Add-on purchase',
    });
    await transaction.insert(eventInstances).values({
      creatorId,
      description: 'Add-on purchase test',
      end: input.eventEnd ?? new Date(now + 2 * 60 * 60 * 1000),
      icon: { iconColor: 0, iconName: 'circle' },
      id: eventId,
      reviewedAt: new Date(now),
      reviewedBy: creatorId,
      start: input.eventStart ?? new Date(now + 60 * 60 * 1000),
      status: 'APPROVED',
      templateId,
      tenantId,
      title: 'Add-on purchase',
    });
    await transaction.insert(eventRegistrationOptions).values({
      closeRegistrationTime: new Date(now + 30 * 60 * 1000),
      eventId,
      id: optionId,
      isPaid: false,
      openRegistrationTime: new Date(now - 60 * 60 * 1000),
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      spots: 10,
      title: 'Participant',
    });
    if (input.paid) {
      await transaction.insert(tenantStripeTaxRates).values({
        active: true,
        displayName: 'Zero tax',
        inclusive: true,
        percentage: '0',
        stripeAccountId: 'acct_addon_purchase_test',
        stripeTaxRateId: `txr_addon_${eventId}`,
        tenantId,
      });
    }
    await transaction.insert(eventAddons).values({
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: true,
      allowPurchaseDuringRegistration: true,
      eventId,
      id: addOnId,
      isPaid: input.paid,
      maxQuantityPerUser: 1,
      price: input.paid ? 100 : 0,
      stripeTaxRateId: input.paid ? `txr_addon_${eventId}` : null,
      title: 'Last add-on',
      totalAvailableQuantity: input.stock,
    });
    await transaction.insert(addonToEventRegistrationOptions).values({
      addonId: addOnId,
      eventId,
      includedQuantity: 0,
      optionalPurchaseQuantity: 1,
      registrationOptionId: optionId,
    });
    await transaction.insert(eventRegistrations).values(
      registrationIds.map((registrationId, index) => ({
        basePriceAtRegistration: 0,
        discountAmount: 0,
        eventId,
        id: registrationId,
        registrationOptionId: optionId,
        status: 'CONFIRMED' as const,
        tenantId,
        userId: requireValue(userIds[index], 'registration user'),
      })),
    );
    const acquisitionIds = registrationIds.map(() => createId());
    await transaction.insert(registrationAcquisitions).values(
      registrationIds.map((registrationId, index) => ({
        acquiredAt: new Date(now),
        eventId,
        id: requireValue(acquisitionIds[index], 'initial acquisition'),
        kind: 'initial' as const,
        operationKey: `registration-initial:${registrationId}`,
        ordinal: 0,
        ownerUserId: requireValue(userIds[index], 'acquisition owner'),
        registrationId,
        spotCount: 1,
        tenantId,
      })),
    );
    await transaction.insert(registrationAcquisitionComponents).values(
      registrationIds.map((registrationId, index) => ({
        acquiredAt: new Date(now),
        acquisitionId: requireValue(
          acquisitionIds[index],
          'initial acquisition',
        ),
        allocationKey: `registration-initial:${registrationId}`,
        applicationFeeAmount: 0,
        baseAmount: 0,
        currency: 'EUR' as const,
        eventId,
        grossAmount: 0,
        kind: 'registration' as const,
        netAmount: 0,
        quantity: 1,
        registrationId,
        stripeFeeAmount: 0,
        taxAmount: 0,
        tenantId,
      })),
    );

    if (!input.paid || input.seedPaidReservation === false) {
      return {
        addOnId,
        categoryId,
        eventId,
        expiresAt,
        optionId,
        registrationIds,
        templateId,
        tenantId,
        userIds,
      };
    }

    const transactionId = createId();
    const orderId = createId();
    const purchaseId = createId();
    const purchaseLotId = createId();
    const registrationId = requireValue(
      registrationIds[0],
      'paid registration',
    );
    const userId = requireValue(userIds[0], 'paid user');
    const expiresAtEpoch = Math.floor(expiresAt.getTime() / 1000);
    await transaction.insert(transactions).values({
      amount: 100,
      appFee: 4,
      currency: 'EUR',
      eventId,
      eventRegistrationId: registrationId,
      id: transactionId,
      method: 'stripe',
      status: 'pending',
      stripeAccountId: 'acct_addon_purchase_test',
      stripeCheckoutRequest: {
        customerEmail: `${userId}.contact@example.com`,
        eventTitle: 'Add-on purchase',
        eventUrl: 'https://addon-purchase.example/events/test',
        expiresAt: expiresAtEpoch,
        lineItems: [
          {
            addonId: addOnId,
            allocationKey: `addon-order:${orderId}`,
            kind: 'addon',
            name: 'Last add-on',
            quantity: 1,
            unitAmount: 100,
          },
        ],
        notificationEmail: `${userId}.contact@example.com`,
      },
      stripeCheckoutSessionId: `cs_${orderId}`,
      stripeCheckoutUrl: `https://checkout.stripe.com/c/pay/cs_${orderId}`,
      stripePaymentIntentId: `pi_${orderId}`,
      targetUserId: userId,
      tenantId,
      type: 'addon',
    });
    await transaction.insert(eventRegistrationAddonPurchaseOrders).values({
      addonId: addOnId,
      applicationFeeAmount: 4,
      baseAmount: 100,
      currency: 'EUR',
      eventId,
      expectedGrossAmount: 100,
      expiresAt,
      id: orderId,
      operationKey: `purchase:${orderId}`,
      purchaseId,
      purchaseLotId,
      quantity: 1,
      registrationId,
      registrationOptionId: optionId,
      requestedByUserId: userId,
      status: 'pending_payment',
      tenantId,
      transactionId,
      unitPrice: 100,
      window: 'before_event',
    });
    return {
      addOnId,
      categoryId,
      eventId,
      expiresAt,
      optionId,
      orderId,
      purchaseId,
      purchaseLotId,
      registrationIds,
      templateId,
      tenantId,
      transactionId,
      userIds,
    };
  });
};

const cleanFixture = async (database: TestDatabase, fixture: Fixture) => {
  await database
    .delete(emailOutbox)
    .where(eq(emailOutbox.tenantId, fixture.tenantId));
  await database
    .delete(platformAuditEntries)
    .where(eq(platformAuditEntries.targetTenantId, fixture.tenantId));
  await database
    .delete(rolesToTenantUsers)
    .where(eq(rolesToTenantUsers.tenantId, fixture.tenantId));
  await database.delete(roles).where(eq(roles.tenantId, fixture.tenantId));
  await database
    .delete(usersToTenants)
    .where(eq(usersToTenants.tenantId, fixture.tenantId));
  await database
    .delete(registrationAcquisitionComponents)
    .where(eq(registrationAcquisitionComponents.eventId, fixture.eventId));
  await database
    .delete(registrationAcquisitionPayments)
    .where(eq(registrationAcquisitionPayments.eventId, fixture.eventId));
  await database
    .delete(registrationAcquisitions)
    .where(eq(registrationAcquisitions.eventId, fixture.eventId));
  await database
    .delete(eventRegistrationAddonPurchaseLots)
    .where(eq(eventRegistrationAddonPurchaseLots.eventId, fixture.eventId));
  await database
    .delete(eventRegistrationAddonPurchases)
    .where(eq(eventRegistrationAddonPurchases.eventId, fixture.eventId));
  await database
    .delete(eventRegistrationAddonPurchaseOrders)
    .where(eq(eventRegistrationAddonPurchaseOrders.eventId, fixture.eventId));
  await database
    .delete(transactions)
    .where(eq(transactions.eventId, fixture.eventId));
  await database
    .delete(eventRegistrations)
    .where(eq(eventRegistrations.eventId, fixture.eventId));
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
  for (const userId of fixture.userIds) {
    await database.delete(users).where(eq(users.id, userId));
  }
  await database
    .delete(tenantStripeTaxRates)
    .where(eq(tenantStripeTaxRates.tenantId, fixture.tenantId));
  if (!fixture.sharedTenant)
    await database.delete(tenants).where(eq(tenants.id, fixture.tenantId));
};

const completedSession = (fixture: Fixture): Stripe.Checkout.Session => {
  const { orderId, registrationId, transactionId } =
    paidFixtureIdentity(fixture);
  return {
    ...checkoutSessionResponse({
      id: `cs_${orderId}`,
      paymentIntent: null,
      url: `https://checkout.stripe.com/c/pay/cs_${orderId}`,
    }),
    amount_total: 100,
    currency: 'eur',
    expires_at: Math.floor(fixture.expiresAt.getTime() / 1000),
    id: `cs_${orderId}`,
    metadata: {
      addonPurchaseOrderId: orderId,
      registrationId,
      tenantId: fixture.tenantId,
      transactionId,
    },
    object: 'checkout.session',
    payment_intent: stripePaymentIntentResponse({
      amount: 100,
      amount_received: 100,
      currency: 'eur',
      id: `pi_${orderId}`,
      latest_charge: `ch_${orderId}`,
    }),
    payment_status: 'paid',
    status: 'complete',
  };
};

const checkoutSessionResponse = ({
  id,
  paymentIntent,
  url,
}: {
  id: string;
  paymentIntent: Stripe.Checkout.Session['payment_intent'];
  url: string;
}): Stripe.Response<Stripe.Checkout.Session> => ({
  adaptive_pricing: null,
  after_expiration: null,
  allow_promotion_codes: null,
  amount_subtotal: null,
  amount_total: null,
  automatic_tax: {
    enabled: false,
    liability: null,
    provider: null,
    status: null,
  },
  billing_address_collection: null,
  cancel_url: null,
  client_reference_id: null,
  client_secret: null,
  collected_information: null,
  consent: null,
  consent_collection: null,
  created: 1_900_000_000,
  currency: 'eur',
  currency_conversion: null,
  custom_fields: [],
  custom_text: {
    after_submit: null,
    shipping_address: null,
    submit: null,
    terms_of_service_acceptance: null,
  },
  customer: null,
  customer_account: null,
  customer_creation: null,
  customer_details: null,
  customer_email: null,
  discounts: null,
  expires_at: 1_900_000_000,
  id,
  integration_identifier: null,
  invoice: null,
  invoice_creation: null,
  lastResponse: {
    headers: {},
    requestId: `req_${id}`,
    statusCode: 200,
  },
  livemode: false,
  locale: null,
  managed_payments: null,
  metadata: null,
  mode: 'payment',
  object: 'checkout.session',
  origin_context: null,
  payment_intent: paymentIntent,
  payment_link: null,
  payment_method_collection: null,
  payment_method_configuration_details: null,
  payment_method_options: null,
  payment_method_types: ['card'],
  payment_status: 'unpaid',
  permissions: null,
  recovered_from: null,
  saved_payment_method_options: null,
  setup_intent: null,
  shipping_address_collection: null,
  shipping_cost: null,
  shipping_options: [],
  status: 'open',
  submit_type: null,
  subscription: null,
  success_url: null,
  total_details: null,
  ui_mode: 'hosted_page',
  url,
  wallet_options: null,
});

const addonCreatedSessionResponse = (
  parameters: Stripe.Checkout.SessionCreateParams | undefined,
  {
    id,
    url,
  }: {
    readonly id: string;
    readonly url: string;
  },
): Stripe.Response<Stripe.Checkout.Session> => {
  if (!parameters)
    throw new Error('Add-on Checkout fixture requires create parameters');
  const lineItems = parameters.line_items;
  if (!lineItems || lineItems.length === 0)
    throw new Error('Add-on Checkout fixture requires line items');

  let amountTotal = 0;
  for (const lineItem of lineItems) {
    const unitAmount = Schema.decodeUnknownSync(Schema.Number)(
      lineItem.price_data?.unit_amount,
    );
    const quantity = Schema.decodeUnknownSync(Schema.Number)(lineItem.quantity);
    amountTotal += unitAmount * quantity;
  }
  const currency = Schema.decodeUnknownSync(Schema.String)(
    lineItems[0]?.price_data?.currency,
  ).toLowerCase();
  const metadata = Schema.decodeUnknownSync(
    Schema.Record(Schema.String, Schema.String),
  )(parameters.metadata);

  return {
    ...checkoutSessionResponse({ id, paymentIntent: null, url }),
    amount_total: amountTotal,
    cancel_url: Schema.decodeUnknownSync(Schema.String)(parameters.cancel_url),
    currency,
    customer_email: Schema.decodeUnknownSync(Schema.String)(
      parameters.customer_email,
    ),
    expires_at: Schema.decodeUnknownSync(Schema.Number)(parameters.expires_at),
    metadata,
    success_url: Schema.decodeUnknownSync(Schema.String)(
      parameters.success_url,
    ),
  };
};

const purchaseWithBindingFault = (
  input: PurchaseRegistrationAddonInput,
  mode: 'afterCommit' | 'rollback',
  fault: Error,
) =>
  Effect.gen(function* () {
    const database = yield* Database;
    const transaction = database.transaction.bind(database);
    let transactionCount = 0;
    const interception = vi
      .spyOn(database, 'transaction')
      .mockImplementation((run) => {
        transactionCount += 1;
        if (transactionCount !== 2) return transaction(run);
        return mode === 'afterCommit'
          ? transaction(run).pipe(Effect.andThen(Effect.die(fault)))
          : transaction((tx) =>
              run(tx).pipe(Effect.andThen(Effect.die(fault))),
            );
      });
    return yield* purchaseRegistrationAddon(input).pipe(
      Effect.ensuring(Effect.sync(() => interception.mockRestore())),
    );
  });

const addonPurchaseInput = (
  fixture: Fixture,
): PurchaseRegistrationAddonInput => ({
  addonId: fixture.addOnId,
  operationKey: `checkout-safety:${fixture.eventId}`,
  quantity: 1,
  registrationId: requireValue(
    fixture.registrationIds[0],
    'checkout registration',
  ),
  tenantId: fixture.tenantId,
  userId: requireValue(fixture.userIds[0], 'checkout user'),
});

const createAddonStripeTestClient = () => {
  const stripe = createRejectingStripeClient();
  vi.spyOn(stripe.checkout.sessions, 'create').mockRejectedValue(
    new Error('Unexpected Checkout create'),
  );
  vi.spyOn(stripe.checkout.sessions, 'expire').mockRejectedValue(
    new Error('Unexpected Checkout expire'),
  );
  vi.spyOn(stripe.checkout.sessions, 'retrieve').mockRejectedValue(
    new Error('Unexpected Checkout retrieve'),
  );
  return stripe;
};

// Interpose only scheduling barriers on the real transaction connection.
// Query construction, row locks, state changes and commits remain PostgreSQL's.
const withQueryBarriers = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  before: (statement: string) => Effect.Effect<void>,
  after: (statement: string) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const database = yield* Database;
    const client = yield* PgClient.PgClient;
    const transaction = database.transaction.bind(database);
    const interception = vi
      .spyOn(database, 'transaction')
      .mockImplementation((run) =>
        transaction((tx) =>
          Effect.gen(function* () {
            const [connection, depth] = yield* client.transactionService;
            return yield* run(tx).pipe(
              Effect.provideService(client.transactionService, [
                {
                  execute: connection.execute.bind(connection),
                  executeRaw: connection.executeRaw.bind(connection),
                  executeStream: connection.executeStream.bind(connection),
                  executeUnprepared:
                    connection.executeUnprepared.bind(connection),
                  executeValues: (statement, parameters) =>
                    before(statement).pipe(
                      Effect.andThen(
                        connection.executeValues(statement, parameters),
                      ),
                      Effect.tap(() => after(statement)),
                    ),
                  executeValuesUnprepared:
                    connection.executeValuesUnprepared.bind(connection),
                },
                depth,
              ]),
            );
          }),
        ),
      );
    return yield* effect.pipe(
      Effect.ensuring(Effect.sync(() => interception.mockRestore())),
    );
  });

const makeBarrierLayer = (url: string, stripe: Stripe) => {
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: {
        BASE_URL: 'https://addon-purchase.example',
        DATABASE_TLS_REQUIRED: 'false',
        NODE_ENV: 'test',
      },
    }),
  );
  return Layer.mergeAll(
    config,
    Layer.effect(Database, PgDrizzle.makeWithDefaults({ relations })).pipe(
      Layer.provideMerge(
        PgClient.layer(createPgClientConfig({ databaseUrl: url })),
      ),
    ),
    Layer.succeed(StripeClient, stripe),
  );
};

const isTableLock = (statement: string, table: string) =>
  statement.includes(`from "${table}"`) &&
  (statement.endsWith('for update') ||
    statement.endsWith(`for update of "${table}"`));

describe('post-registration add-on purchase concurrency', () => {
  let database: TestDatabase;
  const fixtures: Fixture[] = [];
  let layer: ReturnType<typeof makeLayer>;
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
    layer = makeLayer(databaseUrl);
  });

  afterAll(async () => {
    const failures: unknown[] = [];
    for (const fixture of fixtures.toReversed()) {
      try {
        await cleanFixture(database, fixture);
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await pool.end();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Add-on fixture cleanup failures');
  });

  it('serializes a paid sign-up with an existing attendee add-on purchase without deadlock', async () => {
    const fixture = await seedFixture(database, { paid: false, stock: 1 });
    const participantId = createId();
    fixtures.push({ ...fixture, userIds: [...fixture.userIds, participantId] });
    await database.insert(users).values({
      auth0Id: `auth0|${participantId}`,
      communicationEmail: `${participantId}@example.com`,
      email: `${participantId}@example.com`,
      firstName: 'New',
      id: participantId,
      lastName: 'Participant',
    });
    await database
      .insert(usersToTenants)
      .values({ tenantId: fixture.tenantId, userId: participantId });
    await database.insert(tenantStripeTaxRates).values({
      active: true,
      displayName: 'Zero tax',
      inclusive: true,
      percentage: '0',
      stripeAccountId: 'acct_addon_purchase_test',
      stripeTaxRateId: `txr_${fixture.eventId}`,
      tenantId: fixture.tenantId,
    });
    await database
      .update(eventRegistrationOptions)
      .set({
        confirmedSpots: 1,
        isPaid: true,
        price: 100,
        stripeTaxRateId: `txr_${fixture.eventId}`,
      })
      .where(eq(eventRegistrationOptions.id, fixture.optionId));
    const tenant = requireValue(
      await database.query.tenants.findFirst({
        where: { id: fixture.tenantId },
      }),
      'tenant',
    );
    const stripe = createAddonStripeTestClient();
    vi.mocked(stripe.checkout.sessions.create).mockImplementation(
      async (parameters) =>
        addonCreatedSessionResponse(parameters, {
          id: `cs_${fixture.eventId}`,
          url: `https://checkout.stripe.com/c/pay/cs_${fixture.eventId}`,
        }),
    );
    const outcomes = await Effect.runPromise(
      Effect.gen(function* () {
        const addonHasTenant = yield* Deferred.make<undefined>();
        const registrationNeedsTenant = yield* Deferred.make<undefined>();
        const purchase = withQueryBarriers(
          purchaseRegistrationAddon(addonPurchaseInput(fixture)),
          () => Effect.void,
          (statement) =>
            isTableLock(statement, getTableName(tenants))
              ? Deferred.succeed(addonHasTenant, undefined).pipe(
                  Effect.andThen(Deferred.await(registrationNeedsTenant)),
                )
              : Effect.void,
        ).pipe(
          Effect.provide(makeBarrierLayer(databaseUrl, stripe)),
          Effect.exit,
        );
        const registration = Deferred.await(addonHasTenant).pipe(
          Effect.andThen(
            withQueryBarriers(
              EventRegistrationService.registerForEvent({
                eventId: fixture.eventId,
                guestCount: 0,
                registrationOptionId: fixture.optionId,
                tenant: {
                  ...tenant,
                  emailSenderEmail: undefined,
                  emailSenderName: undefined,
                  stripeAccountId: tenant.stripeAccountId ?? undefined,
                },
                user: {
                  email: `${participantId}@example.com`,
                  id: participantId,
                  roleIds: [],
                },
              }).pipe(Effect.provide(EventRegistrationService.Default)),
              (statement) =>
                isTableLock(statement, getTableName(tenants))
                  ? Deferred.succeed(registrationNeedsTenant, undefined).pipe(
                      Effect.asVoid,
                    )
                  : Effect.void,
              () => Effect.void,
            ).pipe(
              Effect.provide(makeBarrierLayer(databaseUrl, stripe)),
              Effect.exit,
            ),
          ),
        );
        return yield* Effect.all([purchase, registration], {
          concurrency: 'unbounded',
        });
      }).pipe(Effect.timeout('15 seconds')),
    );
    expect(
      outcomes.map((outcome) =>
        Exit.isFailure(outcome) ? Cause.pretty(outcome.cause) : 'success',
      ),
    ).toEqual(['success', 'success']);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(
      await database.query.eventRegistrationAddonPurchaseOrders.findMany({
        where: { eventId: fixture.eventId },
      }),
    ).toMatchObject([{ status: 'completed' }]);
    expect(
      await database.query.transactions.findMany({
        where: { eventId: fixture.eventId },
      }),
    ).toMatchObject([{ status: 'pending', targetUserId: participantId }]);
  }, 20_000);

  it('serializes paid application approval replay with Checkout completion without deadlock', async () => {
    const fixture = await seedFixture(database, { paid: false, stock: 1 });
    const participantId = createId();
    fixtures.push({ ...fixture, userIds: [...fixture.userIds, participantId] });
    await database.insert(users).values({
      auth0Id: `auth0|${participantId}`,
      communicationEmail: `${participantId}@example.com`,
      email: `${participantId}@example.com`,
      firstName: 'New',
      id: participantId,
      lastName: 'Applicant',
    });
    await database
      .insert(usersToTenants)
      .values({ tenantId: fixture.tenantId, userId: participantId });
    await database.insert(tenantStripeTaxRates).values({
      active: true,
      displayName: 'Zero tax',
      inclusive: true,
      percentage: '0',
      stripeAccountId: 'acct_addon_purchase_test',
      stripeTaxRateId: `txr_${fixture.eventId}`,
      tenantId: fixture.tenantId,
    });
    await database
      .update(eventRegistrationOptions)
      .set({
        confirmedSpots: 1,
        isPaid: true,
        price: 100,
        registrationMode: 'application',
        stripeTaxRateId: `txr_${fixture.eventId}`,
      })
      .where(eq(eventRegistrationOptions.id, fixture.optionId));
    const tenant = requireValue(
      await database.query.tenants.findFirst({
        where: { id: fixture.tenantId },
      }),
      'tenant',
    );
    const targetTenant = {
      ...tenant,
      emailSenderEmail: undefined,
      emailSenderName: undefined,
      stripeAccountId: tenant.stripeAccountId ?? undefined,
    };
    const stripe = createAddonStripeTestClient();
    let createdSession: Stripe.Checkout.Session | undefined;
    vi.mocked(stripe.checkout.sessions.create).mockImplementation(
      async (parameters) => {
        const session = addonCreatedSessionResponse(parameters, {
          id: `cs_${fixture.eventId}`,
          url: `https://checkout.stripe.com/c/pay/cs_${fixture.eventId}`,
        });
        createdSession = session;
        return session;
      },
    );
    vi.spyOn(stripe.charges, 'retrieve').mockImplementation(
      requireValue(
        vi.mocked(fakeStripe.charges.retrieve).getMockImplementation(),
        'charge fixture',
      ),
    );
    await Effect.runPromise(
      EventRegistrationService.registerForEvent({
        eventId: fixture.eventId,
        guestCount: 0,
        registrationOptionId: fixture.optionId,
        tenant: targetTenant,
        user: {
          email: `${participantId}@example.com`,
          id: participantId,
          roleIds: [],
        },
      }).pipe(
        Effect.provide(EventRegistrationService.Default),
        Effect.provide(makeBarrierLayer(databaseUrl, stripe)),
      ),
    );
    const registration = requireValue(
      await database.query.eventRegistrations.findFirst({
        where: { eventId: fixture.eventId, userId: participantId },
      }),
      'application',
    );
    const approve = EventRegistrationService.approveManualRegistration({
      executiveUserId: requireValue(fixture.userIds[0], 'organizer'),
      expectedEventId: fixture.eventId,
      registrationId: registration.id,
      targetTenant,
    }).pipe(Effect.provide(EventRegistrationService.Default));
    await Effect.runPromise(
      approve.pipe(Effect.provide(makeBarrierLayer(databaseUrl, stripe))),
    );
    const payment = requireValue(
      await database.query.transactions.findFirst({
        where: { eventRegistrationId: registration.id },
      }),
      'payment',
    );
    const session = requireValue(createdSession, 'created Checkout');
    const paidSession: Stripe.Checkout.Session = {
      ...session,
      payment_intent: stripePaymentIntentResponse({
        amount: 100,
        amount_received: 100,
        currency: 'eur',
        id: `pi_${fixture.eventId}`,
        latest_charge: `ch_${fixture.eventId}`,
      }),
      payment_status: 'paid',
      status: 'complete',
    };
    const outcomes = await Effect.runPromise(
      Effect.gen(function* () {
        const completionHasRegistration = yield* Deferred.make<undefined>();
        const approvalNeedsRegistration = yield* Deferred.make<undefined>();
        const complete = withQueryBarriers(
          completePaidRegistrationCheckout(
            {
              registrationId: registration.id,
              stripeAccountId: 'acct_addon_purchase_test',
              stripeCheckoutSessionId: session.id,
              tenantId: fixture.tenantId,
              transactionId: payment.id,
            },
            paidSession,
          ),
          () => Effect.void,
          (statement) =>
            isTableLock(statement, getTableName(eventRegistrations))
              ? Deferred.succeed(completionHasRegistration, undefined).pipe(
                  Effect.andThen(Deferred.await(approvalNeedsRegistration)),
                )
              : Effect.void,
        ).pipe(
          Effect.provide(makeBarrierLayer(databaseUrl, stripe)),
          Effect.exit,
        );
        const replay = Deferred.await(completionHasRegistration).pipe(
          Effect.andThen(
            withQueryBarriers(
              approve,
              (statement) =>
                isTableLock(statement, getTableName(eventRegistrations))
                  ? Deferred.succeed(approvalNeedsRegistration, undefined).pipe(
                      Effect.asVoid,
                    )
                  : Effect.void,
              () => Effect.void,
            ).pipe(
              Effect.provide(makeBarrierLayer(databaseUrl, stripe)),
              Effect.exit,
            ),
          ),
        );
        return yield* Effect.all([complete, replay], {
          concurrency: 'unbounded',
        });
      }).pipe(Effect.timeout('15 seconds')),
    );
    const completion = requireValue(outcomes[0], 'completion outcome');
    expect(
      Exit.isFailure(completion)
        ? Cause.pretty(completion.cause)
        : completion.value,
    ).toBe('finalized');
    const replay = requireValue(outcomes[1], 'approval replay outcome');
    if (Exit.isSuccess(replay))
      throw new Error('Approval replay must reject the completed registration');
    expect(Cause.hasDies(replay.cause)).toBe(false);
    expect(Cause.hasInterrupts(replay.cause)).toBe(false);
    const replayError = Option.getOrThrow(Cause.findErrorOption(replay.cause));
    expect(replayError).toBeInstanceOf(EventRegistrationConflictError);
    expect(replayError.message).toBe(
      'Only pending manual approval registrations can be approved',
    );
    expect(
      await database.query.eventRegistrations.findFirst({
        where: { id: registration.id },
      }),
    ).toMatchObject({ status: 'CONFIRMED' });
    expect(
      await database.query.eventRegistrationOptions.findFirst({
        where: { id: fixture.optionId },
      }),
    ).toMatchObject({ confirmedSpots: 2, reservedSpots: 0 });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(
      await database.query.transactions.findMany({
        where: { eventId: fixture.eventId },
      }),
    ).toMatchObject([
      { id: payment.id, status: 'successful', targetUserId: participantId },
    ]);
    expect(
      await database.query.emailOutbox.findMany({
        where: { kind: 'manualApproval', tenantId: fixture.tenantId },
      }),
    ).toHaveLength(1);
  }, 20_000);

  it('lets free sign-ups for different events share the tenant guard concurrently', async () => {
    const first = await seedFixture(database, { paid: false, stock: 1 });
    const second = await seedFixture(database, {
      existingTenantId: first.tenantId,
      paid: false,
      stock: 1,
    });
    const firstUserId = createId();
    const secondUserId = createId();
    fixtures.push(
      { ...first, userIds: [...first.userIds, firstUserId] },
      {
        ...second,
        sharedTenant: true,
        userIds: [...second.userIds, secondUserId],
      },
    );
    for (const userId of [firstUserId, secondUserId]) {
      await database.insert(users).values({
        auth0Id: `auth0|${userId}`,
        communicationEmail: `${userId}@example.com`,
        email: `${userId}@example.com`,
        firstName: 'Free',
        id: userId,
        lastName: 'Participant',
      });
      await database
        .insert(usersToTenants)
        .values({ tenantId: first.tenantId, userId });
    }
    const tenant = requireValue(
      await database.query.tenants.findFirst({ where: { id: first.tenantId } }),
      'tenant',
    );
    const stripe = createAddonStripeTestClient();
    const register = (fixture: Fixture, userId: string) =>
      EventRegistrationService.registerForEvent({
        eventId: fixture.eventId,
        guestCount: 0,
        registrationOptionId: fixture.optionId,
        tenant: {
          ...tenant,
          emailSenderEmail: undefined,
          emailSenderName: undefined,
          stripeAccountId: tenant.stripeAccountId ?? undefined,
        },
        user: { email: `${userId}@example.com`, id: userId, roleIds: [] },
      }).pipe(Effect.provide(EventRegistrationService.Default));
    const outcomes = await Effect.runPromise(
      Effect.gen(function* () {
        const firstHasEvent = yield* Deferred.make<undefined>();
        const secondCommitted = yield* Deferred.make<undefined>();
        const paused = withQueryBarriers(
          register(first, firstUserId),
          () => Effect.void,
          (statement) =>
            isTableLock(statement, getTableName(eventRegistrationOptions))
              ? Deferred.succeed(firstHasEvent, undefined).pipe(
                  Effect.andThen(Deferred.await(secondCommitted)),
                )
              : Effect.void,
        ).pipe(
          Effect.provide(makeBarrierLayer(databaseUrl, stripe)),
          Effect.exit,
        );
        const concurrent = Deferred.await(firstHasEvent).pipe(
          Effect.andThen(
            register(second, secondUserId).pipe(
              Effect.provide(makeBarrierLayer(databaseUrl, stripe)),
              Effect.tap(() => Deferred.succeed(secondCommitted, undefined)),
              Effect.exit,
            ),
          ),
        );
        return yield* Effect.all([paused, concurrent], {
          concurrency: 'unbounded',
        });
      }).pipe(Effect.timeout('10 seconds')),
    );
    expect(
      outcomes.map((outcome) =>
        Exit.isFailure(outcome) ? Cause.pretty(outcome.cause) : 'success',
      ),
    ).toEqual(['success', 'success']);
    for (const [fixture, userId] of [
      [first, firstUserId],
      [second, secondUserId],
    ] as const) {
      expect(
        await database.query.eventRegistrations.findFirst({
          where: { eventId: fixture.eventId, userId },
        }),
      ).toMatchObject({
        basePriceAtRegistration: 0,
        discountAmount: 0,
        status: 'CONFIRMED',
      });
    }
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  }, 15_000);

  it('serializes platform role revocation after an eligible sign-up without deadlock', async () => {
    const fixture = await seedFixture(database, { paid: false, stock: 1 });
    const participantId = createId();
    fixtures.push({ ...fixture, userIds: [...fixture.userIds, participantId] });
    await database.insert(users).values({
      auth0Id: `auth0|${participantId}`,
      communicationEmail: `${participantId}@example.com`,
      email: `${participantId}@example.com`,
      firstName: 'Eligible',
      id: participantId,
      lastName: 'Participant',
    });
    const insertedMemberships = await database
      .insert(usersToTenants)
      .values({ tenantId: fixture.tenantId, userId: participantId })
      .returning({ id: usersToTenants.id });
    const membership = requireValue(insertedMemberships[0], 'membership');
    const roleId = createId();
    await database
      .insert(roles)
      .values({ id: roleId, name: 'Eligible', tenantId: fixture.tenantId });
    await database.insert(rolesToTenantUsers).values({
      roleId,
      tenantId: fixture.tenantId,
      userTenantId: membership.id,
    });
    await database
      .update(eventRegistrationOptions)
      .set({ confirmedSpots: 1, roleIds: [roleId] })
      .where(eq(eventRegistrationOptions.id, fixture.optionId));
    const tenant = requireValue(
      await database.query.tenants.findFirst({
        where: { id: fixture.tenantId },
      }),
      'tenant',
    );
    const authority = PlatformAdministratorAuthority.make({
      actorEmail: 'platform@example.com',
      actorId: 'auth0|platform-lock-order',
      kind: 'platformAdministrator',
    });
    const stripe = createAddonStripeTestClient();
    const outcomes = await Effect.runPromise(
      Effect.gen(function* () {
        const registrationHasMembership = yield* Deferred.make<undefined>();
        const assignmentNeedsMembership = yield* Deferred.make<undefined>();
        const registration = withQueryBarriers(
          EventRegistrationService.registerForEvent({
            eventId: fixture.eventId,
            guestCount: 0,
            registrationOptionId: fixture.optionId,
            tenant: {
              ...tenant,
              emailSenderEmail: undefined,
              emailSenderName: undefined,
              stripeAccountId: tenant.stripeAccountId ?? undefined,
            },
            user: {
              email: `${participantId}@example.com`,
              id: participantId,
              roleIds: [roleId],
            },
          }).pipe(Effect.provide(EventRegistrationService.Default)),
          () => Effect.void,
          (statement) =>
            isTableLock(statement, getTableName(usersToTenants))
              ? Deferred.succeed(registrationHasMembership, undefined).pipe(
                  Effect.andThen(Deferred.await(assignmentNeedsMembership)),
                )
              : Effect.void,
        ).pipe(
          Effect.provide(makeBarrierLayer(databaseUrl, stripe)),
          Effect.exit,
        );
        const assignment = Deferred.await(registrationHasMembership).pipe(
          Effect.andThen(
            withQueryBarriers(
              platformTenantAdminHandlers['platform.tenantUsers.assignRoles'](
                {
                  reason:
                    'Remove expired eligibility after current registration',
                  roleIds: [],
                  targetTenantId: fixture.tenantId,
                  userId: participantId,
                },
                undefined,
              ).pipe(
                Effect.provide(RpcAccess.Default),
                Effect.provideService(RpcRequestContext, {
                  authData: { sub: authority.actorId },
                  authenticated: true,
                  permissions: [],
                  platformAuthority: authority,
                  tenant: Schema.decodeUnknownSync(Tenant)(tenant),
                  user: null,
                  userAssigned: false,
                }),
              ),
              (statement) =>
                isTableLock(statement, getTableName(usersToTenants))
                  ? Deferred.succeed(assignmentNeedsMembership, undefined).pipe(
                      Effect.asVoid,
                    )
                  : Effect.void,
              () => Effect.void,
            ).pipe(
              Effect.provide(makeBarrierLayer(databaseUrl, stripe)),
              Effect.exit,
            ),
          ),
        );
        return yield* Effect.all([registration, assignment], {
          concurrency: 'unbounded',
        });
      }).pipe(Effect.timeout('15 seconds')),
    );
    expect(outcomes).toMatchObject([{ _tag: 'Success' }, { _tag: 'Success' }]);
    expect(
      await database.query.eventRegistrations.findFirst({
        where: { eventId: fixture.eventId, userId: participantId },
      }),
    ).toMatchObject({ status: 'CONFIRMED' });
    expect(
      await database.query.eventRegistrationOptions.findFirst({
        where: { id: fixture.optionId },
      }),
    ).toMatchObject({ confirmedSpots: 2, reservedSpots: 0 });
    expect(
      await database.query.rolesToTenantUsers.findMany({
        where: { tenantId: fixture.tenantId, userTenantId: membership.id },
      }),
    ).toEqual([]);
    expect(
      await database.query.platformAuditEntries.findMany({
        where: { targetTenantId: fixture.tenantId },
      }),
    ).toMatchObject([
      {
        action: 'user.assignRoles',
        actorEmail: authority.actorEmail,
        actorId: authority.actorId,
        after: {
          resourceId: participantId,
          resourceType: 'userRoleAssignment',
          state: { roleIds: [], userId: participantId },
        },
        before: {
          resourceId: participantId,
          resourceType: 'userRoleAssignment',
          state: { roleIds: [roleId], userId: participantId },
        },
        targetTenantId: fixture.tenantId,
      },
    ]);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  }, 20_000);

  it('preserves a committed binding when its acknowledgement fails and replays without another provider create', async () => {
    const fixture = await seedFixture(database, {
      paid: true,
      seedPaidReservation: false,
      stock: 1,
    });
    fixtures.push(fixture);
    const input = addonPurchaseInput(fixture);
    const stripe = createAddonStripeTestClient();
    const sessionId = `cs_${fixture.eventId}`;
    const checkoutUrl = `https://checkout.stripe.com/c/pay/${sessionId}`;
    const create = vi
      .mocked(stripe.checkout.sessions.create)
      .mockImplementation(async (parameters) =>
        addonCreatedSessionResponse(parameters, {
          id: sessionId,
          url: checkoutUrl,
        }),
      );
    const fault = new Error(
      'Injected acknowledgement failure after addon binding commit',
    );
    const exit = await Effect.runPromiseExit(
      purchaseWithBindingFault(input, 'afterCommit', fault).pipe(
        Effect.provide(makeLayer(databaseUrl, stripe)),
      ),
    );
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    const payment = await database.query.transactions.findFirst({
      where: { eventId: fixture.eventId },
    });
    expect(payment).toMatchObject({
      status: 'pending',
      stripeCheckoutIncidentSessionId: null,
      stripeCheckoutSessionId: sessionId,
      stripeCheckoutUrl: checkoutUrl,
    });
    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    const replay = await Effect.runPromise(
      purchaseRegistrationAddon(input).pipe(
        Effect.provide(makeLayer(databaseUrl, stripe)),
      ),
    );
    expect(replay).toMatchObject({ checkoutUrl, status: 'checkout_required' });
    expect(create).toHaveBeenCalledOnce();
    expect(
      await database.query.eventRegistrationAddonPurchaseLots.findMany({
        where: { eventId: fixture.eventId },
      }),
    ).toEqual([]);
  });

  it.each(['providerFailure', 'wrongIdentity', 'paidSession'] as const)(
    'records an addon binding incident when expiry cannot be proven: %s',
    async (expiryFailure) => {
      const fixture = await seedFixture(database, {
        paid: true,
        seedPaidReservation: false,
        stock: 1,
      });
      fixtures.push(fixture);
      const input = addonPurchaseInput(fixture);
      const stripe = createAddonStripeTestClient();
      const sessionId = `cs_${fixture.eventId}`;
      const checkoutUrl = `https://checkout.stripe.com/c/pay/${sessionId}`;
      const create = vi
        .mocked(stripe.checkout.sessions.create)
        .mockImplementation(async (parameters) =>
          addonCreatedSessionResponse(parameters, {
            id: sessionId,
            url: checkoutUrl,
          }),
        );
      const expire = vi.mocked(stripe.checkout.sessions.expire);
      if (expiryFailure === 'providerFailure') {
        expire.mockRejectedValue(
          new Error('Injected Stripe expiry uncertainty'),
        );
      } else {
        expire.mockResolvedValue({
          ...checkoutSessionResponse({
            id: sessionId,
            paymentIntent: null,
            url: checkoutUrl,
          }),
          id:
            expiryFailure === 'wrongIdentity'
              ? 'cs_another_session'
              : sessionId,
          payment_status: expiryFailure === 'paidSession' ? 'paid' : 'unpaid',
          status: 'expired',
        });
      }
      const exit = await Effect.runPromiseExit(
        purchaseWithBindingFault(
          input,
          'rollback',
          new Error('Injected addon binding rollback'),
        ).pipe(Effect.provide(makeLayer(databaseUrl, stripe))),
      );
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      const payment = requireValue(
        await database.query.transactions.findFirst({
          where: { eventId: fixture.eventId },
        }),
        'incident payment',
      );
      const order = requireValue(
        await database.query.eventRegistrationAddonPurchaseOrders.findFirst({
          where: { eventId: fixture.eventId },
        }),
        'incident order',
      );
      expect(payment).toMatchObject({
        status: 'pending',
        stripeCheckoutIncidentSessionId: sessionId,
        stripeCheckoutSessionId: null,
        stripeCheckoutUrl: null,
      });
      expect(order.status).toBe('pending_payment');
      expect(expire).toHaveBeenCalledWith(sessionId, undefined, {
        stripeAccount: 'acct_addon_purchase_test',
      });
      const replay = await Effect.runPromiseExit(
        purchaseRegistrationAddon(input).pipe(
          Effect.provide(makeLayer(databaseUrl, stripe)),
        ),
      );
      expect(Exit.isFailure(replay)).toBe(true);
      expect(create).toHaveBeenCalledOnce();
      expect(expire).toHaveBeenCalledOnce();

      const afterExpiry = new Date(
        requireValue(order.expiresAt, 'incident deadline').getTime() + 1000,
      );
      const candidates = await database
        .select({ id: transactions.id })
        .from(eventRegistrationAddonPurchaseOrders)
        .innerJoin(
          transactions,
          eq(
            transactions.id,
            eventRegistrationAddonPurchaseOrders.transactionId,
          ),
        )
        .where(
          and(
            expiredUnboundAddonPurchaseCheckoutPredicate(afterExpiry),
            eq(transactions.tenantId, fixture.tenantId),
          ),
        );
      expect(candidates).toEqual([]);
      const staleExpiry = await Effect.runPromiseExit(
        expirePaidAddonPurchaseCheckout({
          now: afterExpiry,
          orderId: order.id,
          registrationId: input.registrationId,
          stripeAccountId: 'acct_addon_purchase_test',
          stripeCheckoutSessionId: null,
          tenantId: fixture.tenantId,
          transactionId: payment.id,
        }).pipe(Effect.provide(makeLayer(databaseUrl, stripe))),
      );
      expect(Exit.isFailure(staleExpiry)).toBe(true);
      expect(
        await database.query.transactions.findFirst({
          where: { id: payment.id },
        }),
      ).toEqual(payment);
      expect(
        await database.query.eventRegistrationAddonPurchaseOrders.findFirst({
          where: { id: order.id },
        }),
      ).toEqual(order);
      expect(
        await database.query.eventAddons.findFirst({
          columns: { totalAvailableQuantity: true },
          where: { id: fixture.addOnId },
        }),
      ).toEqual({ totalAvailableQuantity: 0 });
      expect(
        await database.query.eventRegistrationAddonPurchaseLots.findMany({
          where: { eventId: fixture.eventId },
        }),
      ).toEqual([]);
    },
  );

  it('rejects a payment tuple changed while Stripe creates the addon Checkout', async () => {
    const fixture = await seedFixture(database, {
      paid: true,
      seedPaidReservation: false,
      stock: 1,
    });
    fixtures.push(fixture);
    const input = addonPurchaseInput(fixture);
    const stripe = createAddonStripeTestClient();
    const sessionId = `cs_${fixture.eventId}`;
    const checkoutUrl = `https://checkout.stripe.com/c/pay/${sessionId}`;
    vi.mocked(stripe.checkout.sessions.create).mockImplementation(
      async (parameters) => {
        const payment = requireValue(
          await database.query.transactions.findFirst({
            where: { eventId: fixture.eventId },
          }),
          'reserved payment',
        );
        await database
          .update(transactions)
          .set({ amount: payment.amount + 1 })
          .where(eq(transactions.id, payment.id));
        return addonCreatedSessionResponse(parameters, {
          id: sessionId,
          url: checkoutUrl,
        });
      },
    );
    vi.mocked(stripe.checkout.sessions.expire).mockResolvedValue({
      ...checkoutSessionResponse({
        id: sessionId,
        paymentIntent: null,
        url: checkoutUrl,
      }),
      status: 'expired',
    });
    const exit = await Effect.runPromiseExit(
      purchaseRegistrationAddon(input).pipe(
        Effect.provide(makeLayer(databaseUrl, stripe)),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      sessionId,
      undefined,
      { stripeAccount: 'acct_addon_purchase_test' },
    );
    expect(
      await database.query.transactions.findMany({
        where: { eventId: fixture.eventId },
      }),
    ).toMatchObject([
      {
        amount: 101,
        status: 'pending',
        stripeCheckoutIncidentSessionId: null,
        stripeCheckoutSessionId: null,
        stripeCheckoutUrl: null,
      },
    ]);
    expect(
      await database.query.eventRegistrationAddonPurchaseLots.findMany({
        where: { eventId: fixture.eventId },
      }),
    ).toEqual([]);
  });

  it('does not retry provider creation for an existing unbound claim after creation times out', async () => {
    const fixture = await seedFixture(database, {
      paid: true,
      seedPaidReservation: false,
      stock: 1,
    });
    fixtures.push(fixture);
    const input = addonPurchaseInput(fixture);
    const stripe = createAddonStripeTestClient();
    const create = vi
      .mocked(stripe.checkout.sessions.create)
      .mockRejectedValue(new Error('Injected provider timeout'));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const exit = await Effect.runPromiseExit(
        purchaseRegistrationAddon(input).pipe(
          Effect.provide(makeLayer(databaseUrl, stripe)),
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }
    expect(create).toHaveBeenCalledOnce();
    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(
      await database.query.transactions.findMany({
        where: { eventId: fixture.eventId },
      }),
    ).toMatchObject([
      {
        status: 'pending',
        stripeCheckoutIncidentSessionId: null,
        stripeCheckoutSessionId: null,
        stripeCheckoutUrl: null,
      },
    ]);
    expect(
      await database.query.eventRegistrationAddonPurchaseOrders.findMany({
        where: { eventId: fixture.eventId },
      }),
    ).toHaveLength(1);
  });

  it.each(['metadata', 'url'] as const)(
    'rejects invalid created addon Checkout %s before binding or exposing its URL',
    async (invalidField) => {
      const fixture = await seedFixture(database, {
        paid: true,
        seedPaidReservation: false,
        stock: 1,
      });
      fixtures.push(fixture);
      const input = addonPurchaseInput(fixture);
      const stripe = createAddonStripeTestClient();
      const sessionId = `cs_${fixture.eventId}`;
      const checkoutUrl = `https://checkout.stripe.com/c/pay/${sessionId}`;
      vi.mocked(stripe.checkout.sessions.create).mockImplementation(
        async (parameters) => {
          const response = addonCreatedSessionResponse(parameters, {
            id: sessionId,
            url: checkoutUrl,
          });
          return invalidField === 'metadata'
            ? {
                ...response,
                metadata: { ...response.metadata, userId: 'different-user' },
              }
            : {
                ...response,
                url: 'https://checkout.stripe.com/c/pay/cs_different_session',
              };
        },
      );
      vi.mocked(stripe.checkout.sessions.expire).mockResolvedValue({
        ...checkoutSessionResponse({
          id: sessionId,
          paymentIntent: null,
          url: checkoutUrl,
        }),
        status: 'expired',
      });
      const exit = await Effect.runPromiseExit(
        purchaseRegistrationAddon(input).pipe(
          Effect.provide(makeLayer(databaseUrl, stripe)),
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(stripe.checkout.sessions.expire).toHaveBeenCalledOnce();
      expect(
        await database.query.transactions.findMany({
          where: { eventId: fixture.eventId },
        }),
      ).toMatchObject([
        {
          status: 'pending',
          stripeCheckoutIncidentSessionId: null,
          stripeCheckoutSessionId: null,
          stripeCheckoutUrl: null,
        },
      ]);
      expect(
        await database.query.eventRegistrationAddonPurchaseLots.findMany({
          where: { eventId: fixture.eventId },
        }),
      ).toEqual([]);
    },
  );

  it('keeps a paid reservation invisible and finalizes payment received after the event ends', async () => {
    const fixture = await seedFixture(database, { paid: true, stock: 0 });
    fixtures.push(fixture);
    const { orderId, registrationId, transactionId } =
      paidFixtureIdentity(fixture);

    expect(
      await database.query.eventRegistrationAddonPurchases.findMany({
        where: { registrationId },
      }),
    ).toHaveLength(0);
    expect(
      await database.query.eventRegistrationAddonPurchaseLots.findMany({
        where: { registrationId },
      }),
    ).toHaveLength(0);

    const completionNow = Date.now();
    await database
      .update(eventInstances)
      .set({
        end: new Date(completionNow - 60 * 60 * 1000),
        start: new Date(completionNow - 2 * 60 * 60 * 1000),
      })
      .where(eq(eventInstances.id, fixture.eventId));

    const first = await Effect.runPromise(
      completePaidAddonPurchaseCheckout(
        {
          orderId,
          registrationId,
          stripeAccountId: 'acct_addon_purchase_test',
          stripeCheckoutSessionId: `cs_${orderId}`,
          tenantId: fixture.tenantId,
          transactionId,
        },
        completedSession(fixture),
      ).pipe(Effect.provide(layer)),
    );
    const replay = await Effect.runPromise(
      completePaidAddonPurchaseCheckout(
        {
          orderId,
          registrationId,
          stripeAccountId: 'acct_addon_purchase_test',
          stripeCheckoutSessionId: `cs_${orderId}`,
          tenantId: fixture.tenantId,
          transactionId,
        },
        completedSession(fixture),
      ).pipe(Effect.provide(layer)),
    );

    expect(first).toBe('finalized');
    expect(replay).toBe('alreadyCompleted');
    expect(
      await database.query.eventRegistrationAddonPurchases.findMany({
        where: { registrationId },
      }),
    ).toHaveLength(1);
    expect(
      await database.query.eventRegistrationAddonPurchaseLots.findMany({
        where: { registrationId },
      }),
    ).toHaveLength(1);
    expect(
      await database.query.registrationAcquisitionPayments.findMany({
        where: { registrationId },
      }),
    ).toHaveLength(1);
    const components =
      await database.query.registrationAcquisitionComponents.findMany({
        where: { registrationId },
      });
    expect(components).toHaveLength(2);
    expect(components.find(({ kind }) => kind === 'addon_lot')).toMatchObject({
      applicationFeeAmount: 4,
      grossAmount: 100,
      netAmount: 93,
      purchaseLotId: fixture.purchaseLotId,
      stripeFeeAmount: 3,
    });
  });

  it('makes a free operation retry idempotent and serializes the last stock unit', async () => {
    const fixture = await seedFixture(database, {
      paid: false,
      registrationCount: 2,
      stock: 1,
    });
    fixtures.push(fixture);
    const purchase = (index: number, operationKey: string) =>
      Effect.runPromise(
        purchaseRegistrationAddon({
          addonId: fixture.addOnId,
          operationKey,
          quantity: 1,
          registrationId: requireValue(
            fixture.registrationIds[index],
            'free purchase registration',
          ),
          tenantId: fixture.tenantId,
          userId: requireValue(fixture.userIds[index], 'free purchase user'),
        }).pipe(
          Effect.match({
            onFailure: (error) => ({ error, type: 'failure' as const }),
            onSuccess: (value) => ({ type: 'success' as const, value }),
          }),
          Effect.provide(layer),
        ),
      );

    const operationKey = `free:${fixture.registrationIds[0]}`;
    const first = await purchase(0, operationKey);
    const replay = await purchase(0, operationKey);
    expect(first.type).toBe('success');
    expect(replay).toEqual(first);
    expect(
      await database.query.registrationAcquisitionComponents.findMany({
        where: {
          registrationId: requireValue(
            fixture.registrationIds[0],
            'free acquisition registration',
          ),
        },
      }),
    ).toHaveLength(2);

    const raceFixture = await seedFixture(database, {
      paid: false,
      registrationCount: 2,
      stock: 1,
    });
    fixtures.push(raceFixture);
    const racePurchase = (index: number) =>
      Effect.runPromise(
        purchaseRegistrationAddon({
          addonId: raceFixture.addOnId,
          operationKey: `race:${raceFixture.registrationIds[index]}`,
          quantity: 1,
          registrationId: requireValue(
            raceFixture.registrationIds[index],
            'race registration',
          ),
          tenantId: raceFixture.tenantId,
          userId: requireValue(raceFixture.userIds[index], 'race user'),
        }).pipe(
          Effect.match({
            onFailure: () => 'failure' as const,
            onSuccess: () => 'success' as const,
          }),
          Effect.provide(layer),
        ),
      );
    const outcomes = await Promise.all([racePurchase(0), racePurchase(1)]);
    expect(outcomes.toSorted()).toEqual(['failure', 'success']);
    expect(
      await database.query.eventRegistrationAddonPurchaseOrders.findMany({
        where: { eventId: raceFixture.eventId },
      }),
    ).toHaveLength(1);
    expect(
      await database.query.eventAddons.findFirst({
        columns: { totalAvailableQuantity: true },
        where: { id: raceFixture.addOnId },
      }),
    ).toEqual({ totalAvailableQuantity: 0 });
  });

  it('uses the communication email for a paid add-on Checkout', async () => {
    const fixture = await seedFixture(database, {
      paid: true,
      seedPaidReservation: false,
      stock: 1,
    });
    fixtures.push(fixture);
    const registrationId = requireValue(
      fixture.registrationIds[0],
      'paid add-on registration',
    );
    const userId = requireValue(fixture.userIds[0], 'paid add-on user');
    const communicationEmail = `${userId}.contact@example.com`;
    const checkoutStripe = createRejectingStripeClient();
    const createCheckout = vi
      .spyOn(checkoutStripe.checkout.sessions, 'create')
      .mockImplementation(async (parameters) =>
        addonCreatedSessionResponse(parameters, {
          id: 'cs_paid_addon_communication',
          url: 'https://checkout.stripe.com/c/pay/cs_paid_addon_communication',
        }),
      );

    const result = await Effect.runPromise(
      purchaseRegistrationAddon({
        addonId: fixture.addOnId,
        operationKey: `paid-contact:${registrationId}`,
        quantity: 1,
        registrationId,
        tenantId: fixture.tenantId,
        userId,
      }).pipe(Effect.provide(makeLayer(databaseUrl, checkoutStripe))),
    );

    expect(result.status).toBe('checkout_required');
    const transaction = await database.query.transactions.findFirst({
      where: {
        eventRegistrationId: registrationId,
        tenantId: fixture.tenantId,
        type: 'addon',
      },
    });
    expect(transaction?.stripeCheckoutRequest).toEqual(
      expect.objectContaining({
        customerEmail: communicationEmail,
        notificationEmail: communicationEmail,
      }),
    );
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ customer_email: communicationEmail }),
      expect.objectContaining({
        stripeAccount: 'acct_addon_purchase_test',
      }),
    );
  });

  it('rejects paid Checkout that would expire one second after the event without mutating stock or payment state', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const now = new Date('2026-09-01T12:00:00.000Z');
      vi.setSystemTime(now);
      const expiresAtEpoch = buildCheckoutSessionExpiresAt(30, {
        pinnedNowIso: now.toISOString(),
      });
      const fixture = await seedFixture(database, {
        eventEnd: new Date(expiresAtEpoch * 1000 - 1000),
        eventStart: new Date(now.getTime() - 60 * 60 * 1000),
        paid: true,
        seedPaidReservation: false,
        stock: 1,
      });
      fixtures.push(fixture);
      const registrationId = requireValue(
        fixture.registrationIds[0],
        'cutoff registration',
      );
      const userId = requireValue(fixture.userIds[0], 'cutoff user');
      const checkoutStripe = createRejectingStripeClient();
      const createCheckout = vi.spyOn(
        checkoutStripe.checkout.sessions,
        'create',
      );

      const outcome = await Effect.runPromise(
        purchaseRegistrationAddon({
          addonId: fixture.addOnId,
          operationKey: `cutoff-rejection:${registrationId}`,
          quantity: 1,
          registrationId,
          tenantId: fixture.tenantId,
          userId,
        }).pipe(
          Effect.match({
            onFailure: (error) => ({ error, status: 'failure' as const }),
            onSuccess: (value) => ({ status: 'success' as const, value }),
          }),
          Effect.provide(makeLayer(databaseUrl, checkoutStripe)),
        ),
      );

      expect(outcome.status).toBe('failure');
      if (outcome.status === 'failure') {
        expect(outcome.error.message).toBe(
          'There is not enough time to finish online payment before the event ends. No purchase was started.',
        );
      }
      const [addOn, orders, paymentTransactions, purchases, lots] =
        await Promise.all([
          database.query.eventAddons.findFirst({
            columns: { totalAvailableQuantity: true },
            where: { id: fixture.addOnId },
          }),
          database.query.eventRegistrationAddonPurchaseOrders.findMany({
            where: { eventId: fixture.eventId },
          }),
          database.query.transactions.findMany({
            where: { eventId: fixture.eventId },
          }),
          database.query.eventRegistrationAddonPurchases.findMany({
            where: { eventId: fixture.eventId },
          }),
          database.query.eventRegistrationAddonPurchaseLots.findMany({
            where: { eventId: fixture.eventId },
          }),
        ]);
      expect(addOn).toEqual({ totalAvailableQuantity: 1 });
      expect(orders).toHaveLength(0);
      expect(paymentTransactions).toHaveLength(0);
      expect(purchases).toHaveLength(0);
      expect(lots).toHaveLength(0);
      expect(createCheckout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a paid Checkout ending exactly with the event and persists that expiry unchanged', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const now = new Date('2026-09-01T13:00:00.000Z');
      vi.setSystemTime(now);
      const expiresAtEpoch = buildCheckoutSessionExpiresAt(30, {
        pinnedNowIso: now.toISOString(),
      });
      const expiresAt = new Date(expiresAtEpoch * 1000);
      const fixture = await seedFixture(database, {
        eventEnd: expiresAt,
        eventStart: new Date(now.getTime() - 60 * 60 * 1000),
        paid: true,
        seedPaidReservation: false,
        stock: 1,
      });
      fixtures.push(fixture);
      const registrationId = requireValue(
        fixture.registrationIds[0],
        'exact cutoff registration',
      );
      const userId = requireValue(fixture.userIds[0], 'exact cutoff user');
      const checkoutStripe = createRejectingStripeClient();
      const createCheckout = vi
        .spyOn(checkoutStripe.checkout.sessions, 'create')
        .mockImplementation(async (parameters) =>
          addonCreatedSessionResponse(parameters, {
            id: 'cs_paid_addon_exact_cutoff',
            url: 'https://checkout.stripe.com/c/pay/cs_paid_addon_exact_cutoff',
          }),
        );

      const result = await Effect.runPromise(
        purchaseRegistrationAddon({
          addonId: fixture.addOnId,
          operationKey: `exact-cutoff:${registrationId}`,
          quantity: 1,
          registrationId,
          tenantId: fixture.tenantId,
          userId,
        }).pipe(Effect.provide(makeLayer(databaseUrl, checkoutStripe))),
      );

      expect(result).toEqual(
        expect.objectContaining({
          expiresAt,
          status: 'checkout_required',
        }),
      );
      const order =
        await database.query.eventRegistrationAddonPurchaseOrders.findFirst({
          where: { eventId: fixture.eventId },
        });
      const paymentTransaction = await database.query.transactions.findFirst({
        where: { eventId: fixture.eventId },
      });
      expect(order?.expiresAt).toEqual(expiresAt);
      expect(paymentTransaction?.stripeCheckoutRequest?.expiresAt).toBe(
        expiresAtEpoch,
      );
      expect(createCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ expires_at: expiresAtEpoch }),
        expect.objectContaining({
          stripeAccount: 'acct_addon_purchase_test',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps free add-ons available immediately before the event ends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const now = new Date('2026-09-01T14:00:00.000Z');
      vi.setSystemTime(now);
      const fixture = await seedFixture(database, {
        eventEnd: new Date(now.getTime() + 1),
        eventStart: new Date(now.getTime() - 60 * 60 * 1000),
        paid: false,
        stock: 1,
      });
      fixtures.push(fixture);
      const registrationId = requireValue(
        fixture.registrationIds[0],
        'free cutoff registration',
      );
      const userId = requireValue(fixture.userIds[0], 'free cutoff user');

      const result = await Effect.runPromise(
        purchaseRegistrationAddon({
          addonId: fixture.addOnId,
          operationKey: `free-cutoff:${registrationId}`,
          quantity: 1,
          registrationId,
          tenantId: fixture.tenantId,
          userId,
        }).pipe(Effect.provide(layer)),
      );

      expect(result.status).toBe('completed');
      expect(
        await database.query.eventAddons.findFirst({
          columns: { totalAvailableQuantity: true },
          where: { id: fixture.addOnId },
        }),
      ).toEqual({ totalAvailableQuantity: 0 });
      expect(
        await database.query.eventRegistrationAddonPurchaseOrders.findMany({
          where: { eventId: fixture.eventId },
        }),
      ).toEqual([expect.objectContaining({ status: 'completed' })]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes completion against expiry without double-granting or releasing stock', async () => {
    const fixture = await seedFixture(database, {
      paid: true,
      reservationExpiresAt: new Date(Date.now() - 60_000),
      stock: 0,
    });
    fixtures.push(fixture);
    const paidIdentity = paidFixtureIdentity(fixture);
    const identity = {
      orderId: paidIdentity.orderId,
      registrationId: paidIdentity.registrationId,
      stripeAccountId: 'acct_addon_purchase_test',
      stripeCheckoutSessionId: `cs_${paidIdentity.orderId}`,
      tenantId: fixture.tenantId,
      transactionId: paidIdentity.transactionId,
    } as const;

    await Promise.all([
      Effect.runPromise(
        completePaidAddonPurchaseCheckout(
          identity,
          completedSession(fixture),
        ).pipe(Effect.exit, Effect.provide(layer)),
      ),
      Effect.runPromise(
        expirePaidAddonPurchaseCheckout({
          ...identity,
          now: new Date(),
        }).pipe(Effect.exit, Effect.provide(layer)),
      ),
    ]);

    const [order, transaction, purchases, lots, addOn] = await Promise.all([
      database.query.eventRegistrationAddonPurchaseOrders.findFirst({
        where: { id: fixture.orderId },
      }),
      database.query.transactions.findFirst({
        where: { id: fixture.transactionId },
      }),
      database.query.eventRegistrationAddonPurchases.findMany({
        where: { registrationId: fixture.registrationIds[0] },
      }),
      database.query.eventRegistrationAddonPurchaseLots.findMany({
        where: { registrationId: fixture.registrationIds[0] },
      }),
      database.query.eventAddons.findFirst({
        where: { id: fixture.addOnId },
      }),
    ]);
    expect(order?.status === 'completed' || order?.status === 'expired').toBe(
      true,
    );
    if (order?.status === 'completed') {
      expect(transaction?.status).toBe('successful');
      expect(purchases).toHaveLength(1);
      expect(lots).toHaveLength(1);
      expect(addOn?.totalAvailableQuantity).toBe(0);
    } else {
      expect(transaction?.status).toBe('cancelled');
      expect(purchases).toHaveLength(0);
      expect(lots).toHaveLength(0);
      expect(addOn?.totalAvailableQuantity).toBe(1);
    }
  });
});
