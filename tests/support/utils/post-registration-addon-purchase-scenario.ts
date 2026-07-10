import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { DateTime } from 'luxon';
import StripeClientLibrary from 'stripe';

import { createId } from '@db/create-id';
import { databaseLayer } from '@db/index';
import { relations } from '@db/relations';
import * as schema from '@db/schema';
import { StripeClient } from '@server/stripe-client';
import { completePaidAddonPurchaseCheckout } from '@server/registrations/addon-purchase-checkout';
import { purchaseRegistrationAddon } from '@server/registrations/addon-purchase.service';
import { resolveTenantPublicOrigin } from '@shared/tenant-origin';

const initialStock = 6;
const optionalPurchaseQuantity = 3;
const paidPurchaseQuantity = 2;
const paidUnitPrice = 500;
const paidGrossAmount = paidPurchaseQuantity * paidUnitPrice;
const applicationFee = 35;
const stripeFee = 29;
const stripeNetAmount = paidGrossAmount - applicationFee - stripeFee;

type TestDatabase = NodePgDatabase<typeof relations>;
type StripeHttpRequestArguments = Parameters<
  InstanceType<typeof StripeClientLibrary.HttpClient>['makeRequest']
>;

class JsonStripeResponse extends StripeClientLibrary.HttpClientResponse {
  constructor(
    private readonly body: unknown,
    private readonly requestId: string,
  ) {
    super(200, { 'request-id': requestId });
  }

  override getRawResponse(): unknown {
    return {
      headers: { 'request-id': this.requestId },
      requestId: this.requestId,
      statusCode: 200,
    };
  }

  override toJSON(): Promise<unknown> {
    return Promise.resolve(this.body);
  }

  override toStream(_streamCompleteCallback: () => void): never {
    throw new Error('Unexpected streaming Stripe response');
  }
}

interface StripeCheckoutIdentity {
  readonly chargeId: string;
  readonly checkoutUrl: string;
  readonly expiresAtEpoch: number;
  readonly orderId: string;
  readonly paymentIntentId: string;
  readonly sessionId: string;
  readonly transactionId: string;
}

interface StripeCompletionClaim {
  readonly currency: string;
  readonly expectedGrossAmount: number;
  readonly expiresAt: Date;
  readonly orderId: string;
  readonly transactionId: string;
}

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

const requireFormValue = (form: URLSearchParams, key: string): string => {
  const [value, ...additionalValues] = form.getAll(key);
  if (value === undefined || additionalValues.length > 0) {
    throw new Error(`Expected one Stripe Checkout field: ${key}`);
  }
  return value;
};

const assertExactFormValues = (
  form: URLSearchParams,
  expectedValues: ReadonlyMap<string, string>,
): void => {
  if ([...form.entries()].length !== expectedValues.size) {
    throw new Error('Stripe Checkout request field count changed');
  }
  for (const [key, expectedValue] of expectedValues) {
    if (form.getAll(key).length !== 1 || form.get(key) !== expectedValue) {
      throw new Error(`Unexpected Stripe Checkout field: ${key}`);
    }
  }
};

class ProductionAddonPurchaseStripeHttpClient
  extends StripeClientLibrary.HttpClient
{
  private chargeRetrieved = false;
  private completionClaim: StripeCompletionClaim | undefined;
  private completionSessionRetrieved = false;
  private expectedQuantity: number | undefined;
  private identity: StripeCheckoutIdentity | undefined;

  constructor(
    private readonly expectedAddOnTitle: string,
    private readonly expectedCurrency: string,
    private readonly expectedEventTitle: string,
    private readonly expectedEventUrl: string,
    private readonly expectedRegistrationId: string,
    private readonly expectedStripeAccountId: string,
    private readonly expectedTenantId: string,
    private readonly expectedUserEmail: string,
    private readonly expectedUserId: string,
  ) {
    super();
  }

  override getClientName(): string {
    return 'evorto-addon-playwright-production-service';
  }

  preparePurchase(quantity: number): void {
    if (quantity !== paidPurchaseQuantity) {
      throw new Error(
        `Expected the paid add-on scenario quantity to be ${paidPurchaseQuantity}`,
      );
    }
    if (this.expectedQuantity !== undefined || this.identity !== undefined) {
      throw new Error('Paid add-on Stripe purchase was already prepared');
    }
    this.expectedQuantity = quantity;
  }

  prepareCompletion(claim: StripeCompletionClaim): void {
    const identity = this.requireIdentity();
    if (
      claim.orderId !== identity.orderId ||
      claim.transactionId !== identity.transactionId ||
      claim.expectedGrossAmount !== paidGrossAmount ||
      claim.currency !== this.expectedCurrency ||
      Math.floor(claim.expiresAt.getTime() / 1000) !== identity.expiresAtEpoch
    ) {
      throw new Error(
        'Paid add-on completion claim changed ownership or terms',
      );
    }
    if (this.completionClaim) {
      throw new Error('Paid add-on completion was already prepared');
    }
    this.completionClaim = claim;
  }

  readIdentity(): StripeCheckoutIdentity {
    return this.requireIdentity();
  }

  assertCompletionRequestsConsumed(): void {
    if (!this.completionSessionRetrieved || !this.chargeRetrieved) {
      throw new Error(
        'Production add-on completion did not reconcile its Stripe session and charge',
      );
    }
  }

  override async makeRequest(
    ...arguments_: StripeHttpRequestArguments
  ): Promise<JsonStripeResponse> {
    const [host, port, path, method, headers, requestData, protocol] =
      arguments_;
    if (
      host !== 'api.stripe.com' ||
      port !== '443' ||
      protocol !== 'https' ||
      readStripeHeader(headers, 'Stripe-Account') !==
        this.expectedStripeAccountId
    ) {
      throw new Error(`Unexpected Stripe connection: ${method} ${path}`);
    }

    if (method === 'POST' && path === '/v1/checkout/sessions') {
      return this.createCheckoutSession(headers, requestData);
    }

    const identity = this.requireIdentity();
    if (
      method === 'GET' &&
      path === `/v1/checkout/sessions/${encodeURIComponent(identity.sessionId)}`
    ) {
      return this.retrieveCompletedCheckoutSession(headers, requestData);
    }
    if (
      method === 'GET' &&
      path ===
        `/v1/charges/${encodeURIComponent(identity.chargeId)}?expand[0]=balance_transaction`
    ) {
      return this.retrieveCharge(headers, requestData);
    }

    throw new Error(`Unexpected Stripe request: ${method} ${path}`);
  }

  private createCheckoutSession(
    headers: StripeHttpRequestArguments[4],
    requestData: string,
  ): JsonStripeResponse {
    if (this.identity || this.expectedQuantity === undefined) {
      throw new Error('Unexpected duplicate Stripe Checkout creation');
    }
    const form = new URLSearchParams(requestData);
    const orderId = requireFormValue(form, 'metadata[addonPurchaseOrderId]');
    const transactionId = requireFormValue(form, 'metadata[transactionId]');
    if (
      !/^[a-z0-9]{20}$/.test(orderId) ||
      !/^[a-z0-9]{20}$/.test(transactionId)
    ) {
      throw new Error('Stripe Checkout ownership ids are not canonical');
    }
    const expiresAt = requireFormValue(form, 'expires_at');
    const expiresAtEpoch = Number(expiresAt);
    const wallNowEpoch = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(expiresAtEpoch) ||
      expiresAtEpoch <= wallNowEpoch ||
      expiresAtEpoch > wallNowEpoch + 24 * 60 * 60 + 5
    ) {
      throw new Error('Stripe Checkout expiry is outside its supported window');
    }

    const expectedValues = new Map([
      ['cancel_url', `${this.expectedEventUrl}?addonPurchaseStatus=cancel`],
      ['customer_email', this.expectedUserEmail],
      ['expires_at', expiresAt],
      ['line_items[0][price_data][currency]', this.expectedCurrency],
      [
        'line_items[0][price_data][product_data][name]',
        `${this.expectedAddOnTitle} add-on for ${this.expectedEventTitle}`,
      ],
      ['line_items[0][price_data][unit_amount]', String(paidUnitPrice)],
      ['line_items[0][quantity]', String(this.expectedQuantity)],
      ['metadata[addonPurchaseOrderId]', orderId],
      ['metadata[registrationId]', this.expectedRegistrationId],
      ['metadata[tenantId]', this.expectedTenantId],
      ['metadata[transactionId]', transactionId],
      ['metadata[userId]', this.expectedUserId],
      ['mode', 'payment'],
      ['payment_intent_data[application_fee_amount]', String(applicationFee)],
      ['success_url', `${this.expectedEventUrl}?addonPurchaseStatus=success`],
    ]);
    assertExactFormValues(form, expectedValues);

    const idempotencyKey = `addon-purchase:${orderId}:transaction:${transactionId}`;
    if (
      readStripeHeader(headers, 'Idempotency-Key') !== idempotencyKey ||
      requireFormValue(form, 'metadata[registrationId]') !==
        this.expectedRegistrationId ||
      requireFormValue(form, 'metadata[tenantId]') !== this.expectedTenantId ||
      requireFormValue(form, 'metadata[userId]') !== this.expectedUserId
    ) {
      throw new Error('Stripe Checkout idempotency or ownership changed');
    }

    const sessionId = `cs_test_addon_${transactionId}`;
    const paymentIntentId = `pi_addon_${transactionId}`;
    const chargeId = `ch_addon_${transactionId}`;
    const checkoutUrl = `https://checkout.stripe.com/c/pay/${sessionId}`;
    this.identity = {
      chargeId,
      checkoutUrl,
      expiresAtEpoch,
      orderId,
      paymentIntentId,
      sessionId,
      transactionId,
    };
    return new JsonStripeResponse(
      {
        id: sessionId,
        object: 'checkout.session',
        payment_intent: null,
        status: 'open',
        url: checkoutUrl,
      },
      `req_create_${transactionId}`,
    );
  }

  private requireCompletionClaim(): StripeCompletionClaim {
    if (!this.completionClaim) {
      throw new Error('Paid add-on Stripe completion was not prepared');
    }
    return this.completionClaim;
  }

  private requireIdentity(): StripeCheckoutIdentity {
    if (!this.identity) {
      throw new Error('Paid add-on Stripe Checkout was not created');
    }
    return this.identity;
  }

  private retrieveCharge(
    headers: StripeHttpRequestArguments[4],
    requestData: string,
  ): JsonStripeResponse {
    const identity = this.requireIdentity();
    if (
      !this.completionSessionRetrieved ||
      this.chargeRetrieved ||
      requestData !== '' ||
      readStripeHeader(headers, 'Idempotency-Key') !== undefined
    ) {
      throw new Error('Unexpected Stripe charge reconciliation request');
    }
    this.chargeRetrieved = true;
    return new JsonStripeResponse(
      {
        amount: paidGrossAmount,
        balance_transaction: {
          amount: paidGrossAmount,
          currency: this.expectedCurrency.toLowerCase(),
          fee: applicationFee + stripeFee,
          fee_details: [
            {
              amount: applicationFee,
              currency: this.expectedCurrency.toLowerCase(),
              type: 'application_fee',
            },
            {
              amount: stripeFee,
              currency: this.expectedCurrency.toLowerCase(),
              type: 'stripe_fee',
            },
          ],
          id: `txn_addon_${identity.transactionId}`,
          net: stripeNetAmount,
          object: 'balance_transaction',
        },
        captured: true,
        currency: this.expectedCurrency.toLowerCase(),
        id: identity.chargeId,
        object: 'charge',
        paid: true,
        payment_intent: identity.paymentIntentId,
      },
      `req_charge_${identity.transactionId}`,
    );
  }

  private retrieveCompletedCheckoutSession(
    headers: StripeHttpRequestArguments[4],
    requestData: string,
  ): JsonStripeResponse {
    const completionClaim = this.requireCompletionClaim();
    const identity = this.requireIdentity();
    if (
      this.completionSessionRetrieved ||
      requestData !== '' ||
      readStripeHeader(headers, 'Idempotency-Key') !== undefined
    ) {
      throw new Error('Unexpected Stripe Checkout completion request');
    }
    this.completionSessionRetrieved = true;
    return new JsonStripeResponse(
      {
        amount_total: completionClaim.expectedGrossAmount,
        currency: completionClaim.currency.toLowerCase(),
        expires_at: identity.expiresAtEpoch,
        id: identity.sessionId,
        metadata: {
          addonPurchaseOrderId: identity.orderId,
          registrationId: this.expectedRegistrationId,
          tenantId: this.expectedTenantId,
          transactionId: identity.transactionId,
          userId: this.expectedUserId,
        },
        object: 'checkout.session',
        payment_intent: {
          id: identity.paymentIntentId,
          latest_charge: identity.chargeId,
        },
        payment_status: 'paid',
        status: 'complete',
      },
      `req_complete_${identity.transactionId}`,
    );
  }
}

interface AddOnIdentity {
  readonly id: string;
  readonly title: string;
}

const resolveScenarioEventWindow = (
  testClock: DateTime,
  window: 'before' | 'during',
): { readonly end: DateTime; readonly start: DateTime } => {
  const wallClock = DateTime.utc();
  const latestNow =
    testClock.toMillis() > wallClock.toMillis() ? testClock : wallClock;
  const earliestNow =
    testClock.toMillis() < wallClock.toMillis() ? testClock : wallClock;
  if (window === 'before') {
    const start = latestNow.plus({ days: 7 });
    return { end: start.plus({ hours: 2 }), start };
  }
  return {
    end: latestNow.plus({ hours: 1 }),
    start: earliestNow.minus({ hours: 1 }),
  };
};

interface SeedPostRegistrationAddonPurchaseScenarioInput {
  readonly database: TestDatabase;
  readonly templateId: string;
  readonly tenant: {
    readonly domain: string;
    readonly id: string;
  };
  readonly testClock: DateTime;
  readonly title: string;
  readonly userId: string;
}

export interface PostRegistrationAddonPurchaseScenario {
  readonly addOns: {
    readonly beforeOnly: AddOnIdentity;
    readonly duringOnly: AddOnIdentity;
    readonly free: AddOnIdentity;
    readonly paid: AddOnIdentity;
  };
  readonly eventId: string;
  readonly optionId: string;
  readonly registrationId: string;
  readonly title: string;
  beginPaidCheckout: (quantity?: number) => Promise<{
    readonly chargeId: string;
    readonly checkoutUrl: string;
    readonly expiresAt: Date;
    readonly orderId: string;
    readonly paymentIntentId: string;
    readonly sessionId: string;
    readonly transactionId: string;
  }>;
  cleanup: () => Promise<void>;
  completeCheckout: () => Promise<'alreadyCompleted' | 'finalized'>;
  setWindow: (window: 'before' | 'during') => Promise<void>;
}

const configProviderLayer = ConfigProvider.layer(ConfigProvider.fromEnv());
const effectDatabaseAndConfigLayer = Layer.mergeAll(
  configProviderLayer,
  databaseLayer.pipe(Layer.provide(configProviderLayer)),
);

export const seedPostRegistrationAddonPurchaseScenario = async (
  input: SeedPostRegistrationAddonPurchaseScenarioInput,
): Promise<PostRegistrationAddonPurchaseScenario> => {
  if (!input.testClock.isValid) {
    throw new Error('Expected a valid Playwright test clock');
  }

  const tenant = await input.database.query.tenants.findFirst({
    columns: { currency: true, stripeAccountId: true },
    where: { id: input.tenant.id },
  });
  if (!tenant?.stripeAccountId) {
    throw new Error(
      'Expected the post-registration add-on scenario tenant to have Stripe configured',
    );
  }
  const stripeAccountId = tenant.stripeAccountId;

  const template = await input.database.query.eventTemplates.findFirst({
    columns: { id: true },
    where: { id: input.templateId, tenantId: input.tenant.id },
  });
  if (!template) {
    throw new Error(
      'Expected a tenant-owned event template for the add-on scenario',
    );
  }

  const user = await input.database.query.users.findFirst({
    columns: { email: true, id: true },
    where: { id: input.userId },
  });
  if (!user) {
    throw new Error('Expected the add-on scenario participant user');
  }
  const membership = await input.database.query.usersToTenants.findFirst({
    columns: { id: true },
    where: { tenantId: input.tenant.id, userId: user.id },
  });
  if (!membership) {
    throw new Error(
      'Expected the add-on scenario participant to belong to the tenant',
    );
  }

  const eventId = createId();
  const optionId = createId();
  const registrationId = createId();
  const freeAddOn = { id: createId(), title: 'Free refreshment voucher' };
  const paidAddOn = { id: createId(), title: 'Paid workshop kit' };
  const duringOnlyAddOn = { id: createId(), title: 'Event-day snack' };
  const beforeOnlyAddOn = { id: createId(), title: 'Advance welcome pack' };
  const now = input.testClock.toUTC();
  const nowDate = now.toJSDate();
  const beforeWindow = resolveScenarioEventWindow(now, 'before');
  const expectedEventOrigin = resolveTenantPublicOrigin({
    baseUrl: process.env['BASE_URL'],
    nodeEnvironment: process.env['NODE_ENV'],
    primaryDomain: input.tenant.domain,
  });
  const expectedEventUrl = new URL(
    `/events/${encodeURIComponent(eventId)}`,
    `${expectedEventOrigin}/`,
  ).toString();
  const stripeHttpClient = new ProductionAddonPurchaseStripeHttpClient(
    paidAddOn.title,
    tenant.currency,
    input.title,
    expectedEventUrl,
    registrationId,
    stripeAccountId,
    input.tenant.id,
    user.email,
    user.id,
  );
  const stripe = new StripeClientLibrary('sk_test_deterministic', {
    httpClient: stripeHttpClient,
    maxNetworkRetries: 0,
    telemetry: false,
  });
  const scenarioLayer = Layer.merge(
    effectDatabaseAndConfigLayer,
    Layer.succeed(StripeClient, stripe),
  );

  await input.database.transaction(async (tx) => {
    await tx.insert(schema.eventInstances).values({
      createdAt: nowDate,
      creatorId: user.id,
      description:
        'A deterministic participant add-on purchase lifecycle scenario.',
      end: beforeWindow.end.toJSDate(),
      icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
      id: eventId,
      reviewedAt: nowDate,
      reviewedBy: user.id,
      simpleModeEnabled: false,
      start: beforeWindow.start.toJSDate(),
      status: 'APPROVED',
      templateId: template.id,
      tenantId: input.tenant.id,
      title: input.title,
      unlisted: false,
      updatedAt: nowDate,
    });
    await tx.insert(schema.eventRegistrationOptions).values({
      cancellationDeadlineHoursBeforeStart: 0,
      checkedInSpots: 0,
      closeRegistrationTime: beforeWindow.start.minus({ hours: 1 }).toJSDate(),
      confirmedSpots: 1,
      createdAt: nowDate,
      eventId,
      id: optionId,
      isPaid: false,
      openRegistrationTime: now.minus({ days: 1 }).toJSDate(),
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: true,
      registeredDescription: 'Your participant registration is confirmed.',
      registrationMode: 'fcfs',
      reservedSpots: 0,
      roleIds: [],
      spots: 20,
      stripeTaxRateId: null,
      title: 'Participant registration',
      transferDeadlineHoursBeforeStart: 0,
      updatedAt: nowDate,
      waitlistSpots: 0,
    });
    await tx.insert(schema.eventRegistrations).values({
      basePriceAtRegistration: 0,
      createdAt: nowDate,
      eventId,
      id: registrationId,
      registrationOptionId: optionId,
      status: 'CONFIRMED',
      tenantId: input.tenant.id,
      updatedAt: nowDate,
      userId: user.id,
    });
    await tx.insert(schema.eventAddons).values([
      {
        allowMultiple: true,
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: true,
        allowPurchaseDuringRegistration: false,
        createdAt: nowDate,
        description: 'Added immediately to a confirmed ticket.',
        eventId,
        id: freeAddOn.id,
        isPaid: false,
        maxQuantityPerUser: optionalPurchaseQuantity,
        price: 0,
        stripeTaxRateId: null,
        title: freeAddOn.title,
        totalAvailableQuantity: initialStock,
        updatedAt: nowDate,
      },
      {
        allowMultiple: true,
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: true,
        allowPurchaseDuringRegistration: false,
        createdAt: nowDate,
        description: 'Requires the same Stripe checkout until payment settles.',
        eventId,
        id: paidAddOn.id,
        isPaid: true,
        maxQuantityPerUser: optionalPurchaseQuantity,
        price: paidUnitPrice,
        stripeTaxRateId: null,
        title: paidAddOn.title,
        totalAvailableQuantity: initialStock,
        updatedAt: nowDate,
      },
      {
        allowMultiple: true,
        allowPurchaseBeforeEvent: false,
        allowPurchaseDuringEvent: true,
        allowPurchaseDuringRegistration: false,
        createdAt: nowDate,
        description: 'Available only while the event is running.',
        eventId,
        id: duringOnlyAddOn.id,
        isPaid: false,
        maxQuantityPerUser: optionalPurchaseQuantity,
        price: 0,
        stripeTaxRateId: null,
        title: duringOnlyAddOn.title,
        totalAvailableQuantity: initialStock,
        updatedAt: nowDate,
      },
      {
        allowMultiple: true,
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: false,
        allowPurchaseDuringRegistration: false,
        createdAt: nowDate,
        description: 'Available only before the event starts.',
        eventId,
        id: beforeOnlyAddOn.id,
        isPaid: false,
        maxQuantityPerUser: optionalPurchaseQuantity,
        price: 0,
        stripeTaxRateId: null,
        title: beforeOnlyAddOn.title,
        totalAvailableQuantity: initialStock,
        updatedAt: nowDate,
      },
    ]);
    await tx.insert(schema.addonToEventRegistrationOptions).values(
      [freeAddOn, paidAddOn, duringOnlyAddOn, beforeOnlyAddOn].map((addOn) => ({
        addonId: addOn.id,
        eventId,
        includedQuantity: 0,
        optionalPurchaseQuantity,
        registrationOptionId: optionId,
      })),
    );
  });

  const setWindow = async (window: 'before' | 'during') => {
    const eventWindow = resolveScenarioEventWindow(now, window);
    const updated = await input.database
      .update(schema.eventInstances)
      .set({
        end: eventWindow.end.toJSDate(),
        start: eventWindow.start.toJSDate(),
        updatedAt: nowDate,
      })
      .where(
        and(
          eq(schema.eventInstances.id, eventId),
          eq(schema.eventInstances.tenantId, input.tenant.id),
        ),
      )
      .returning({ id: schema.eventInstances.id });
    if (updated.length !== 1) {
      throw new Error('Expected to update the add-on scenario event window');
    }
  };

  const beginPaidCheckout = async (quantity = 2) => {
    const existingOrder =
      await input.database.query.eventRegistrationAddonPurchaseOrders.findFirst(
        {
          columns: { id: true },
          where: {
            addonId: paidAddOn.id,
            registrationId,
            tenantId: input.tenant.id,
          },
        },
      );
    if (existingOrder) {
      throw new Error('Paid add-on scenario checkout was already started');
    }
    stripeHttpClient.preparePurchase(quantity);

    const result = await Effect.runPromise(
      purchaseRegistrationAddon({
        addonId: paidAddOn.id,
        operationKey: `playwright-paid-addon:${registrationId}`,
        quantity,
        registrationId,
        tenantId: input.tenant.id,
        userId: user.id,
      }).pipe(Effect.provide(scenarioLayer)),
    );
    if (result.status !== 'checkout_required') {
      throw new Error('Expected production paid add-on Checkout reservation');
    }
    const identity = stripeHttpClient.readIdentity();
    const order =
      await input.database.query.eventRegistrationAddonPurchaseOrders.findFirst(
        {
          where: {
            id: result.orderId,
            registrationId,
            tenantId: input.tenant.id,
          },
        },
      );
    if (!order?.transactionId || !order.expiresAt) {
      throw new Error('Expected the production-created paid add-on order');
    }
    const transaction = await input.database.query.transactions.findFirst({
      where: {
        eventRegistrationId: registrationId,
        id: order.transactionId,
        tenantId: input.tenant.id,
        type: 'addon',
      },
    });
    if (
      !transaction ||
      result.orderId !== identity.orderId ||
      order.addonId !== paidAddOn.id ||
      order.quantity !== quantity ||
      order.status !== 'pending_payment' ||
      order.transactionId !== identity.transactionId ||
      Math.floor(order.expiresAt.getTime() / 1000) !==
        identity.expiresAtEpoch ||
      result.expiresAt.getTime() !== order.expiresAt.getTime() ||
      result.checkoutUrl !== identity.checkoutUrl ||
      transaction.amount !== paidGrossAmount ||
      transaction.appFee !== applicationFee ||
      transaction.status !== 'pending' ||
      transaction.stripeAccountId !== stripeAccountId ||
      transaction.stripeChargeId !== null ||
      transaction.stripeCheckoutSessionId !== identity.sessionId ||
      transaction.stripeCheckoutUrl !== identity.checkoutUrl ||
      transaction.stripeFee !== null ||
      transaction.stripeNetAmount !== null ||
      transaction.stripePaymentIntentId !== null ||
      transaction.targetUserId !== user.id
    ) {
      throw new Error(
        'Production paid add-on reservation did not preserve its exact pending state',
      );
    }

    return {
      chargeId: identity.chargeId,
      checkoutUrl: identity.checkoutUrl,
      expiresAt: order.expiresAt,
      orderId: order.id,
      paymentIntentId: identity.paymentIntentId,
      sessionId: identity.sessionId,
      transactionId: order.transactionId,
    };
  };

  const completeCheckout = async () => {
    const identity = stripeHttpClient.readIdentity();
    const pendingOrder =
      await input.database.query.eventRegistrationAddonPurchaseOrders.findFirst(
        {
          columns: {
            currency: true,
            expectedGrossAmount: true,
            expiresAt: true,
            id: true,
            status: true,
            transactionId: true,
          },
          where: {
            id: identity.orderId,
            registrationId,
            tenantId: input.tenant.id,
          },
        },
      );
    const pendingTransaction =
      await input.database.query.transactions.findFirst({
        columns: {
          appFee: true,
          status: true,
          stripeChargeId: true,
          stripeFee: true,
          stripeNetAmount: true,
          stripePaymentIntentId: true,
        },
        where: {
          eventRegistrationId: registrationId,
          id: identity.transactionId,
          tenantId: input.tenant.id,
          type: 'addon',
        },
      });
    if (
      !pendingOrder?.expiresAt ||
      pendingOrder.status !== 'pending_payment' ||
      pendingOrder.transactionId !== identity.transactionId ||
      !pendingTransaction ||
      pendingTransaction.appFee !== applicationFee ||
      pendingTransaction.status !== 'pending' ||
      pendingTransaction.stripeChargeId !== null ||
      pendingTransaction.stripeFee !== null ||
      pendingTransaction.stripeNetAmount !== null ||
      pendingTransaction.stripePaymentIntentId !== null
    ) {
      throw new Error(
        'Expected the production-created canonical pending add-on checkout',
      );
    }
    stripeHttpClient.prepareCompletion({
      currency: pendingOrder.currency,
      expectedGrossAmount: pendingOrder.expectedGrossAmount,
      expiresAt: pendingOrder.expiresAt,
      orderId: pendingOrder.id,
      transactionId: identity.transactionId,
    });
    const session = await stripe.checkout.sessions.retrieve(
      identity.sessionId,
      undefined,
      { stripeAccount: stripeAccountId },
    );

    const completion = await Effect.runPromise(
      completePaidAddonPurchaseCheckout(
        {
          orderId: identity.orderId,
          registrationId,
          stripeAccountId,
          stripeCheckoutSessionId: identity.sessionId,
          tenantId: input.tenant.id,
          transactionId: identity.transactionId,
        },
        session,
      ).pipe(Effect.provide(scenarioLayer)),
    );
    stripeHttpClient.assertCompletionRequestsConsumed();
    const completedTransaction =
      await input.database.query.transactions.findFirst({
        columns: {
          appFee: true,
          status: true,
          stripeChargeId: true,
          stripeFee: true,
          stripeNetAmount: true,
          stripePaymentIntentId: true,
        },
        where: {
          eventRegistrationId: registrationId,
          id: identity.transactionId,
          tenantId: input.tenant.id,
          type: 'addon',
        },
      });
    const completedLot =
      await input.database.query.eventRegistrationAddonPurchaseLots.findFirst({
        where: {
          registrationId,
          sourceTransactionId: identity.transactionId,
          tenantId: input.tenant.id,
        },
      });
    if (
      !completedTransaction ||
      completedTransaction.appFee !== applicationFee ||
      completedTransaction.status !== 'successful' ||
      completedTransaction.stripeChargeId !== identity.chargeId ||
      completedTransaction.stripeFee !== stripeFee ||
      completedTransaction.stripeNetAmount !== stripeNetAmount ||
      completedTransaction.stripePaymentIntentId !== identity.paymentIntentId ||
      !completedLot?.paymentAllocationFinalizedAt ||
      completedLot.applicationFeeAmount !== applicationFee ||
      completedLot.grossAmount !== paidGrossAmount ||
      completedLot.netAmount !== stripeNetAmount ||
      completedLot.stripeFeeAmount !== stripeFee
    ) {
      throw new Error(
        'Production add-on fee snapshot did not persist the reconciled Stripe allocation',
      );
    }
    return completion;
  };

  const cleanup = async () => {
    await input.database
      .delete(schema.eventRegistrationAddonPurchaseLots)
      .where(
        and(
          eq(
            schema.eventRegistrationAddonPurchaseLots.registrationId,
            registrationId,
          ),
          eq(
            schema.eventRegistrationAddonPurchaseLots.tenantId,
            input.tenant.id,
          ),
        ),
      );
    await input.database
      .delete(schema.eventRegistrationAddonPurchaseOrders)
      .where(
        and(
          eq(
            schema.eventRegistrationAddonPurchaseOrders.registrationId,
            registrationId,
          ),
          eq(
            schema.eventRegistrationAddonPurchaseOrders.tenantId,
            input.tenant.id,
          ),
        ),
      );
    await input.database
      .delete(schema.eventRegistrationAddonPurchases)
      .where(
        and(
          eq(
            schema.eventRegistrationAddonPurchases.registrationId,
            registrationId,
          ),
          eq(schema.eventRegistrationAddonPurchases.tenantId, input.tenant.id),
        ),
      );
    await input.database
      .delete(schema.transactions)
      .where(
        and(
          eq(schema.transactions.eventRegistrationId, registrationId),
          eq(schema.transactions.tenantId, input.tenant.id),
          eq(schema.transactions.type, 'addon'),
        ),
      );
    await input.database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.id, registrationId),
          eq(schema.eventRegistrations.tenantId, input.tenant.id),
        ),
      );
    await input.database
      .delete(schema.addonToEventRegistrationOptions)
      .where(eq(schema.addonToEventRegistrationOptions.eventId, eventId));
    await input.database
      .delete(schema.eventAddons)
      .where(eq(schema.eventAddons.eventId, eventId));
    await input.database
      .delete(schema.eventRegistrationOptions)
      .where(
        and(
          eq(schema.eventRegistrationOptions.id, optionId),
          eq(schema.eventRegistrationOptions.eventId, eventId),
        ),
      );
    await input.database
      .delete(schema.eventInstances)
      .where(
        and(
          eq(schema.eventInstances.id, eventId),
          eq(schema.eventInstances.tenantId, input.tenant.id),
        ),
      );
  };

  return {
    addOns: {
      beforeOnly: beforeOnlyAddOn,
      duringOnly: duringOnlyAddOn,
      free: freeAddOn,
      paid: paidAddOn,
    },
    beginPaidCheckout,
    cleanup,
    completeCheckout,
    eventId,
    optionId,
    registrationId,
    setWindow,
    title: input.title,
  };
};
