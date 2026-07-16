import Stripe from 'stripe';

import { createId } from '@db/create-id';
import { Database, databaseLayer } from '@db/index';
import { relations } from '@db/relations';
import * as schema from '@db/schema';
import { completePaidRegistrationCheckout } from '@server/registrations/registration-checkout-completion';
import { cancelRegistrationAddon } from '@server/registrations/addon-fulfillment.service';
import {
  type RegistrationTransferRefundRequeueStatus,
  markRegistrationTransferRefundRequeued,
  reconcileRegistrationTransferRefund,
} from '@server/registrations/registration-transfer-refund-reconciliation';
import { createRegistrationTransferCredentials } from '@server/registrations/registration-transfer-credentials';
import { StripeClient } from '@server/stripe-client';
import {
  type RegistrationRefundRequeueState,
  requeueRegistrationRefundClaim,
} from '@server/payments/registration-refund';
import { deriveTenantPublicOrigin } from '@shared/tenant-origin';
import { registrationTransferAddonAllocationKey } from '@shared/registration-transfer';
import { and, eq, like } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';

import {
  futureServerEventWindow,
  latestServerOrWallNow,
} from './server-test-clock';

const sourceUnitPrice = 1800;
const sourceDiscountedUnitPrice = 1500;
const sourceRegistrationAmount = sourceDiscountedUnitPrice + sourceUnitPrice;
const sourceAddonAmount = 1000;
const priorAddonRefundAmount = 500;
const recipientUnitPrice = 2100;
const recipientPaidAddonUnitPrice = 650;
const recipientAmount = 5500;
const recipientApplicationFee = 193;
const recipientStripeFee = 100;
const sourceRegistrationApplicationFee = 116;
const sourceRegistrationStripeFee = 84;
const sourceRegistrationNetAmount =
  sourceRegistrationAmount -
  sourceRegistrationApplicationFee -
  sourceRegistrationStripeFee;

type StripeHttpRequestArguments = Parameters<
  InstanceType<typeof Stripe.HttpClient>['makeRequest']
>;

class JsonStripeResponse extends Stripe.HttpClientResponse {
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

interface PaidTransferChargeSnapshot {
  readonly applicationFeeAmount: number;
  readonly chargeId: string;
  readonly currency: string;
  readonly grossAmount: number;
  readonly paymentIntentId: string;
  readonly stripeAccountId: string;
  readonly stripeFeeAmount: number;
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

class PaidTransferStripeHttpClient extends Stripe.HttpClient {
  private readonly chargeSnapshots = new Map<
    string,
    PaidTransferChargeSnapshot
  >();

  override getClientName(): string {
    return 'evorto-paid-transfer-playwright';
  }

  prepareCharge(snapshot: PaidTransferChargeSnapshot): void {
    if (this.chargeSnapshots.has(snapshot.chargeId)) {
      throw new Error('Paid transfer Stripe charge was already prepared');
    }
    this.chargeSnapshots.set(snapshot.chargeId, snapshot);
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
      method !== 'GET' ||
      requestData !== '' ||
      readStripeHeader(headers, 'Idempotency-Key') !== undefined
    ) {
      throw new Error(`Unexpected Stripe request: ${method} ${path}`);
    }

    const snapshot = [...this.chargeSnapshots.values()].find(
      ({ chargeId }) =>
        path ===
        `/v1/charges/${encodeURIComponent(chargeId)}?expand[0]=balance_transaction`,
    );
    if (
      !snapshot ||
      readStripeHeader(headers, 'Stripe-Account') !== snapshot.stripeAccountId
    ) {
      throw new Error(`Unexpected paid transfer Stripe charge: ${path}`);
    }

    const netAmount =
      snapshot.grossAmount -
      snapshot.applicationFeeAmount -
      snapshot.stripeFeeAmount;
    return new JsonStripeResponse(
      {
        amount: snapshot.grossAmount,
        balance_transaction: {
          amount: snapshot.grossAmount,
          currency: snapshot.currency.toLowerCase(),
          fee: snapshot.applicationFeeAmount + snapshot.stripeFeeAmount,
          fee_details: [
            {
              amount: snapshot.applicationFeeAmount,
              currency: snapshot.currency.toLowerCase(),
              type: 'application_fee',
            },
            {
              amount: snapshot.stripeFeeAmount,
              currency: snapshot.currency.toLowerCase(),
              type: 'stripe_fee',
            },
          ],
          id: `txn_transfer_${snapshot.chargeId}`,
          net: netAmount,
          object: 'balance_transaction',
        },
        captured: true,
        currency: snapshot.currency.toLowerCase(),
        id: snapshot.chargeId,
        object: 'charge',
        paid: true,
        payment_intent: snapshot.paymentIntentId,
      },
      `req_transfer_${snapshot.chargeId}`,
    );
  }
}

type TestDatabase = NodePgDatabase<typeof relations>;

interface PaidRegistrationTransferScenarioInput {
  readonly database: TestDatabase;
  readonly recipient: {
    readonly communicationEmail?: null | string;
    readonly email: string;
    readonly id: string;
  };
  readonly source: {
    readonly id: string;
  };
  readonly templateId: string;
  readonly tenant: {
    readonly domain: string;
    readonly id: string;
  };
  readonly title: string;
}

export interface PaidRegistrationTransferScenario {
  readonly claimPath: string;
  readonly eventId: string;
  readonly optionId: string;
  readonly recipientRegistrationId: string;
  readonly recipientTransactionId: string;
  readonly recipientChargeId: string;
  readonly recipientPaymentIntentId: string;
  readonly paidPurchaseId: string;
  readonly paidPurchaseLotId: string;
  readonly freePurchaseLotId: string;
  readonly sourceAcquisitionId: string;
  readonly sourceRegistrationId: string;
  readonly sourceStripeAccountId: string;
  readonly sourceTransactionId: string;
  readonly sourceTransactionIds: readonly string[];
  readonly stripeAccountId: string;
  readonly transferId: string;
  cancelInheritedAddon: () => Promise<{
    readonly fulfillmentEventId: string;
    readonly refundStatus: 'pending';
  }>;
  completeCheckout: () => Promise<
    'alreadyCompleted' | 'alreadyFinalized' | 'compensationQueued' | 'finalized'
  >;
  completeSourceRefunds: () => Promise<readonly string[]>;
  failSourceRefund: () => Promise<string>;
  requeueSourceRefund: () => Promise<{
    readonly refundAfter: RegistrationRefundRequeueState;
    readonly recoveryMode: 'newGeneration' | 'resumeGeneration';
    readonly transferStatus: 'alreadyPending' | 'notTransfer' | 'requeued';
  }>;
  cleanup: () => Promise<void>;
}

const effectDatabaseLayer = databaseLayer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
);
const paidTransferStripeHttpClient = new PaidTransferStripeHttpClient();
const deterministicStripe = new Stripe('sk_test_paid_transfer_scenario', {
  httpClient: paidTransferStripeHttpClient,
  maxNetworkRetries: 0,
  telemetry: false,
});
const scenarioLayer = Layer.merge(
  effectDatabaseLayer,
  Layer.succeed(StripeClient, deterministicStripe),
);

const runDatabaseEffect = <A, E>(
  effect: Effect.Effect<A, E, Database | StripeClient>,
) => Effect.runPromise(effect.pipe(Effect.provide(scenarioLayer)));

const requireRefundRequeueStatus = (
  status: string,
): RegistrationTransferRefundRequeueStatus => {
  switch (status) {
    case 'alreadyPending':
    case 'notTransfer':
    case 'requeued':
      return status;
    default:
      throw new Error(
        `Unexpected registration transfer refund requeue status: ${status}`,
      );
  }
};

export const seedPaidRegistrationTransferScenario = async (
  input: PaidRegistrationTransferScenarioInput,
): Promise<PaidRegistrationTransferScenario> => {
  const eventId = createId();
  const optionId = createId();
  const sourceRegistrationId = createId();
  const recipientRegistrationId = sourceRegistrationId;
  const recipientTransactionId = createId();
  const sourceTransactionId = createId();
  const sourceAddonTransactionId = createId();
  const priorAddonRefundTransactionId = createId();
  const sourceAcquisitionId = createId();
  const sourceRegistrationAcquisitionPaymentId = createId();
  const sourceAddonAcquisitionPaymentId = createId();
  const sourceRegistrationComponentId = createId();
  const sourcePaidAddonComponentId = createId();
  const sourceFreeAddonComponentId = createId();
  const sourceRegistrationPlanItemId = createId();
  const sourceAddonPlanItemId = createId();
  const paidAddonId = createId();
  const paidPurchaseId = createId();
  const paidPurchaseLotId = createId();
  const paidRedemptionEventId = createId();
  const paidCancellationEventId = createId();
  const freeAddonId = createId();
  const freePurchaseId = createId();
  const freePurchaseLotId = createId();
  const freeRedemptionEventId = createId();
  const freeCancellationEventId = createId();
  const transferId = createId();
  const credentials = createRegistrationTransferCredentials();
  const stripeAccountId = `acct_transfer_${transferId}`;
  const sourceStripeAccountId = `acct_transfer_source_${transferId}`;
  const checkoutSessionId = `cs_test_transfer_${recipientTransactionId}`;
  const paymentIntentId = `pi_transfer_${recipientTransactionId}`;
  const chargeId = `ch_transfer_${recipientTransactionId}`;
  const sourceChargeId = `ch_transfer_source_${sourceTransactionId}`;
  const sourceAddonChargeId = `ch_transfer_addon_${sourceAddonTransactionId}`;
  const sourcePaymentIntentId = `pi_transfer_source_${sourceTransactionId}`;
  const sourceAddonPaymentIntentId = `pi_transfer_addon_${sourceAddonTransactionId}`;
  const priorAddonRefundId = `re_transfer_prior_${sourceAddonTransactionId}`;
  const terminalRefundId = `re_transfer_${sourceTransactionId}`;
  const eventWindow = futureServerEventWindow();
  const startsAt = eventWindow.start;
  const checkoutExpiresAt = new Date(
    latestServerOrWallNow().getTime() + 60 * 60 * 1000,
  );
  const originalTenant = await input.database.query.tenants.findFirst({
    columns: { stripeAccountId: true },
    where: { id: input.tenant.id },
  });
  if (!originalTenant) {
    throw new Error('Expected paid transfer scenario tenant');
  }

  paidTransferStripeHttpClient.prepareCharge({
    applicationFeeAmount: recipientApplicationFee,
    chargeId,
    currency: 'EUR',
    grossAmount: recipientAmount,
    paymentIntentId,
    stripeAccountId,
    stripeFeeAmount: recipientStripeFee,
  });

  await input.database
    .update(schema.tenants)
    .set({ stripeAccountId })
    .where(eq(schema.tenants.id, input.tenant.id));
  await input.database.insert(schema.eventInstances).values({
    creatorId: input.source.id,
    description: 'Deterministic paid transfer lifecycle scenario',
    end: eventWindow.end,
    icon: { iconColor: 0x4f46e5, iconName: 'ticket' },
    id: eventId,
    start: startsAt,
    status: 'APPROVED',
    templateId: input.templateId,
    tenantId: input.tenant.id,
    title: input.title,
    unlisted: true,
  });
  await input.database.insert(schema.eventRegistrationOptions).values({
    closeRegistrationTime: eventWindow.closeRegistrationTime,
    confirmedSpots: 2,
    eventId,
    id: optionId,
    isPaid: true,
    openRegistrationTime: eventWindow.openRegistrationTime,
    organizingRegistration: false,
    price: recipientUnitPrice,
    refundFeesOnCancellation: true,
    registeredDescription: 'Your transferred registration is confirmed.',
    registrationMode: 'fcfs',
    roleIds: [],
    spots: 10,
    title: 'Paid participant',
    transferDeadlineHoursBeforeStart: 0,
  });
  const checkInTime = new Date(latestServerOrWallNow().getTime() - 60_000);
  await input.database.insert(schema.eventRegistrations).values({
    appliedDiscountedPrice: sourceDiscountedUnitPrice,
    appliedDiscountType: 'esnCard',
    basePriceAtRegistration: sourceUnitPrice,
    checkedInGuestCount: 1,
    checkInTime,
    discountAmount: sourceUnitPrice - sourceDiscountedUnitPrice,
    eventId,
    guestCount: 1,
    id: sourceRegistrationId,
    registrationOptionId: optionId,
    status: 'CONFIRMED',
    tenantId: input.tenant.id,
    userId: input.source.id,
  });
  await input.database.insert(schema.eventAddons).values([
    {
      allowMultiple: true,
      allowPurchaseBeforeEvent: false,
      allowPurchaseDuringEvent: false,
      allowPurchaseDuringRegistration: true,
      description:
        'Included and purchased units with settled fulfillment history.',
      eventId,
      id: paidAddonId,
      isPaid: true,
      maxQuantityPerUser: 3,
      price: recipientPaidAddonUnitPrice,
      stripeTaxRateId: null,
      title: 'Transfer workshop kit',
      totalAvailableQuantity: 18,
    },
    {
      allowMultiple: true,
      allowPurchaseBeforeEvent: false,
      allowPurchaseDuringEvent: false,
      allowPurchaseDuringRegistration: true,
      description: 'Free optional units with settled fulfillment history.',
      eventId,
      id: freeAddonId,
      isPaid: false,
      maxQuantityPerUser: 2,
      price: 0,
      stripeTaxRateId: null,
      title: 'Transfer checklist item',
      totalAvailableQuantity: 8,
    },
  ]);
  await input.database.insert(schema.addonToEventRegistrationOptions).values([
    {
      addonId: paidAddonId,
      eventId,
      includedQuantity: 1,
      optionalPurchaseQuantity: 2,
      registrationOptionId: optionId,
    },
    {
      addonId: freeAddonId,
      eventId,
      includedQuantity: 0,
      optionalPurchaseQuantity: 2,
      registrationOptionId: optionId,
    },
  ]);
  await input.database.insert(schema.transactions).values([
    {
      amount: sourceRegistrationAmount,
      appFee: sourceRegistrationApplicationFee,
      currency: 'EUR',
      eventId,
      eventRegistrationId: sourceRegistrationId,
      id: sourceTransactionId,
      method: 'stripe',
      status: 'successful',
      stripeAccountId: sourceStripeAccountId,
      stripeChargeId: sourceChargeId,
      stripeFee: sourceRegistrationStripeFee,
      stripeNetAmount: sourceRegistrationNetAmount,
      stripePaymentIntentId: sourcePaymentIntentId,
      targetUserId: input.source.id,
      tenantId: input.tenant.id,
      type: 'registration',
    },
    {
      amount: sourceAddonAmount,
      appFee: 40,
      currency: 'EUR',
      eventId,
      eventRegistrationId: sourceRegistrationId,
      id: sourceAddonTransactionId,
      method: 'stripe',
      status: 'successful',
      stripeAccountId: sourceStripeAccountId,
      stripeChargeId: sourceAddonChargeId,
      stripeFee: 30,
      stripeNetAmount: 930,
      stripePaymentIntentId: sourceAddonPaymentIntentId,
      targetUserId: input.source.id,
      tenantId: input.tenant.id,
      type: 'addon',
    },
    {
      amount: -priorAddonRefundAmount,
      currency: 'EUR',
      eventId,
      eventRegistrationId: sourceRegistrationId,
      id: priorAddonRefundTransactionId,
      method: 'stripe',
      refundOperationKey: `registration-addon-cancellation:${paidCancellationEventId}:${sourceAddonTransactionId}`,
      sourceTransactionId: sourceAddonTransactionId,
      status: 'successful',
      stripeAccountId: sourceStripeAccountId,
      stripeRefundApplicationFee: true,
      stripeRefundId: priorAddonRefundId,
      stripeRefundStatus: 'succeeded',
      targetUserId: input.source.id,
      tenantId: input.tenant.id,
      type: 'refund',
    },
    {
      amount: recipientAmount,
      appFee: recipientApplicationFee,
      currency: 'EUR',
      eventId,
      eventRegistrationId: sourceRegistrationId,
      id: recipientTransactionId,
      method: 'stripe',
      status: 'pending',
      stripeAccountId,
      stripeCheckoutReconcileNextAt: checkoutExpiresAt,
      stripeCheckoutRequest: {
        customerEmail: input.recipient.email,
        eventTitle: input.title,
        eventUrl: new URL(
          `/events/${encodeURIComponent(eventId)}`,
          deriveTenantPublicOrigin(input.tenant.domain),
        ).toString(),
        expiresAt: Math.floor(checkoutExpiresAt.getTime() / 1000),
        lineItems: [
          {
            name: `Registration fee for ${input.title}`,
            quantity: 1,
            unitAmount: recipientUnitPrice,
          },
          {
            name: `Guest registration fee for ${input.title}`,
            quantity: 1,
            unitAmount: recipientUnitPrice,
          },
          {
            addonId: paidAddonId,
            allocationKey: registrationTransferAddonAllocationKey(
              transferId,
              paidPurchaseId,
            ),
            kind: 'addon',
            name: `Transfer workshop kit add-on for ${input.title}`,
            quantity: 2,
            unitAmount: recipientPaidAddonUnitPrice,
          },
        ],
        notificationEmail:
          input.recipient.communicationEmail?.trim() || input.recipient.email,
      },
      stripeCheckoutSessionId: checkoutSessionId,
      stripeCheckoutUrl: `https://checkout.stripe.com/c/pay/${checkoutSessionId}`,
      targetUserId: input.recipient.id,
      tenantId: input.tenant.id,
      type: 'registration',
    },
  ]);
  await input.database.insert(schema.eventRegistrationAddonPurchases).values([
    {
      addonId: paidAddonId,
      cancelledQuantity: 1,
      eventId,
      id: paidPurchaseId,
      includedQuantity: 1,
      purchasedQuantity: 2,
      quantity: 3,
      redeemedQuantity: 1,
      refundAllocatedPurchasedQuantity: 1,
      registrationId: sourceRegistrationId,
      registrationOptionId: optionId,
      tenantId: input.tenant.id,
      unitPrice: 500,
    },
    {
      addonId: freeAddonId,
      cancelledQuantity: 1,
      eventId,
      id: freePurchaseId,
      includedQuantity: 0,
      purchasedQuantity: 2,
      quantity: 2,
      redeemedQuantity: 1,
      refundAllocatedPurchasedQuantity: 0,
      registrationId: sourceRegistrationId,
      registrationOptionId: optionId,
      tenantId: input.tenant.id,
      unitPrice: 0,
    },
  ]);
  await input.database
    .insert(schema.eventRegistrationAddonPurchaseLots)
    .values([
      {
        applicationFeeAmount: 40,
        baseAmount: sourceAddonAmount,
        cancelledQuantity: 1,
        currency: 'EUR',
        eventId,
        grossAmount: sourceAddonAmount,
        id: paidPurchaseLotId,
        netAmount: 930,
        paymentAllocationFinalizedAt: checkInTime,
        purchaseId: paidPurchaseId,
        quantity: 2,
        redeemedQuantity: 0,
        refundAllocatedApplicationFeeAmount: 20,
        refundAllocatedGrossAmount: priorAddonRefundAmount,
        refundAllocatedNetAmount: 465,
        refundAllocatedQuantity: 1,
        registrationId: sourceRegistrationId,
        registrationOptionId: optionId,
        sourceLineKey: `transfer-source:${sourceAddonTransactionId}:0`,
        sourceTransactionId: sourceAddonTransactionId,
        stripeFeeAmount: 30,
        taxAmount: 0,
        tenantId: input.tenant.id,
        unitPrice: 500,
      },
      {
        applicationFeeAmount: 0,
        baseAmount: 0,
        cancelledQuantity: 1,
        currency: 'EUR',
        eventId,
        grossAmount: 0,
        id: freePurchaseLotId,
        netAmount: 0,
        paymentAllocationFinalizedAt: checkInTime,
        purchaseId: freePurchaseId,
        quantity: 2,
        redeemedQuantity: 1,
        refundAllocatedApplicationFeeAmount: 0,
        refundAllocatedGrossAmount: 0,
        refundAllocatedNetAmount: 0,
        refundAllocatedQuantity: 0,
        registrationId: sourceRegistrationId,
        registrationOptionId: optionId,
        sourceLineKey: `transfer-free:${freePurchaseId}`,
        stripeFeeAmount: 0,
        taxAmount: 0,
        tenantId: input.tenant.id,
        unitPrice: 0,
      },
    ]);
  await input.database.insert(schema.registrationAcquisitions).values({
    acquiredAt: checkInTime,
    eventId,
    id: sourceAcquisitionId,
    kind: 'initial',
    operationKey: `registration-initial:${sourceRegistrationId}`,
    ordinal: 0,
    ownerUserId: input.source.id,
    registrationId: sourceRegistrationId,
    spotCount: 2,
    tenantId: input.tenant.id,
  });
  await input.database.insert(schema.registrationAcquisitionPayments).values([
    {
      acquisitionId: sourceAcquisitionId,
      attachedAt: checkInTime,
      eventId,
      id: sourceRegistrationAcquisitionPaymentId,
      registrationId: sourceRegistrationId,
      tenantId: input.tenant.id,
      transactionId: sourceTransactionId,
    },
    {
      acquisitionId: sourceAcquisitionId,
      attachedAt: checkInTime,
      eventId,
      id: sourceAddonAcquisitionPaymentId,
      registrationId: sourceRegistrationId,
      tenantId: input.tenant.id,
      transactionId: sourceAddonTransactionId,
    },
  ]);
  await input.database.insert(schema.registrationAcquisitionComponents).values([
    {
      acquiredAt: checkInTime,
      acquisitionId: sourceAcquisitionId,
      acquisitionPaymentId: sourceRegistrationAcquisitionPaymentId,
      allocationKey: `registration-initial:${sourceRegistrationId}`,
      applicationFeeAmount: sourceRegistrationApplicationFee,
      baseAmount: sourceRegistrationAmount,
      currency: 'EUR',
      eventId,
      grossAmount: sourceRegistrationAmount,
      id: sourceRegistrationComponentId,
      kind: 'registration',
      netAmount: sourceRegistrationNetAmount,
      quantity: 2,
      registrationId: sourceRegistrationId,
      stripeFeeAmount: sourceRegistrationStripeFee,
      taxAmount: 0,
      tenantId: input.tenant.id,
    },
    {
      acquiredAt: checkInTime,
      acquisitionId: sourceAcquisitionId,
      acquisitionPaymentId: sourceAddonAcquisitionPaymentId,
      allocationKey: `addon-lot:${paidPurchaseLotId}`,
      applicationFeeAmount: 40,
      baseAmount: sourceAddonAmount,
      currency: 'EUR',
      eventId,
      grossAmount: sourceAddonAmount,
      id: sourcePaidAddonComponentId,
      kind: 'addon_lot',
      netAmount: 930,
      purchaseId: paidPurchaseId,
      purchaseLotId: paidPurchaseLotId,
      quantity: 2,
      registrationId: sourceRegistrationId,
      stripeFeeAmount: 30,
      taxAmount: 0,
      tenantId: input.tenant.id,
    },
    {
      acquiredAt: checkInTime,
      acquisitionId: sourceAcquisitionId,
      allocationKey: `addon-lot:${freePurchaseLotId}`,
      applicationFeeAmount: 0,
      baseAmount: 0,
      currency: 'EUR',
      eventId,
      grossAmount: 0,
      id: sourceFreeAddonComponentId,
      kind: 'addon_lot',
      netAmount: 0,
      purchaseId: freePurchaseId,
      purchaseLotId: freePurchaseLotId,
      quantity: 2,
      registrationId: sourceRegistrationId,
      stripeFeeAmount: 0,
      taxAmount: 0,
      tenantId: input.tenant.id,
    },
  ]);
  await input.database
    .insert(schema.eventRegistrationAddonFulfillmentEvents)
    .values([
      {
        actorKind: 'user',
        actorUserId: input.source.id,
        eventId,
        id: paidRedemptionEventId,
        operationKey: `transfer-paid-redeemed:${paidPurchaseId}`,
        purchaseId: paidPurchaseId,
        quantity: 1,
        registrationId: sourceRegistrationId,
        tenantId: input.tenant.id,
        type: 'redeemed',
      },
      {
        actorKind: 'user',
        actorUserId: input.source.id,
        eventId,
        id: paidCancellationEventId,
        operationKey: `transfer-paid-cancelled:${paidPurchaseId}`,
        purchaseId: paidPurchaseId,
        quantity: 1,
        reason: 'Preserved paid cancellation history.',
        refundDisposition: 'claims_created',
        refundRequested: true,
        registrationId: sourceRegistrationId,
        tenantId: input.tenant.id,
        type: 'cancelled',
      },
      {
        actorKind: 'user',
        actorUserId: input.source.id,
        eventId,
        id: freeRedemptionEventId,
        operationKey: `transfer-free-redeemed:${freePurchaseId}`,
        purchaseId: freePurchaseId,
        quantity: 1,
        registrationId: sourceRegistrationId,
        tenantId: input.tenant.id,
        type: 'redeemed',
      },
      {
        actorKind: 'user',
        actorUserId: input.source.id,
        eventId,
        id: freeCancellationEventId,
        operationKey: `transfer-free-cancelled:${freePurchaseId}`,
        purchaseId: freePurchaseId,
        quantity: 1,
        reason: 'Preserved free cancellation history.',
        refundDisposition: 'no_monetary_refund_required',
        refundRequested: true,
        registrationId: sourceRegistrationId,
        tenantId: input.tenant.id,
        type: 'cancelled',
      },
    ]);
  await input.database
    .insert(schema.eventRegistrationAddonRefundAllocations)
    .values({
      applicationFeeAmount: 20,
      applicationFeeRefunded: true,
      currency: 'EUR',
      eventId,
      fulfillmentEventId: paidCancellationEventId,
      grossEntitlementAmount: priorAddonRefundAmount,
      netEntitlementAmount: 465,
      purchaseId: paidPurchaseId,
      purchaseLotId: paidPurchaseLotId,
      quantity: 1,
      refundAmount: priorAddonRefundAmount,
      refundTransactionId: priorAddonRefundTransactionId,
      registrationId: sourceRegistrationId,
      tenantId: input.tenant.id,
    });
  await input.database
    .insert(schema.registrationAcquisitionRefundAllocations)
    .values({
      acquisitionId: sourceAcquisitionId,
      acquisitionPaymentId: sourceAddonAcquisitionPaymentId,
      applicationFeeAmount: 20,
      applicationFeeRefunded: true,
      componentId: sourcePaidAddonComponentId,
      eventId,
      fulfillmentEventId: paidCancellationEventId,
      grossEntitlementAmount: priorAddonRefundAmount,
      netEntitlementAmount: 465,
      operationKey: `addon-cancel:${paidCancellationEventId}:${sourcePaidAddonComponentId}`,
      operationKind: 'addon_cancellation',
      purchaseId: paidPurchaseId,
      quantity: 1,
      refundAmount: priorAddonRefundAmount,
      refundTransactionId: priorAddonRefundTransactionId,
      registrationId: sourceRegistrationId,
      stripeFeeAmount: 15,
      tenantId: input.tenant.id,
    });
  await input.database.insert(schema.registrationTransfers).values({
    claimCodeHash: credentials.claimCodeHash,
    claimTokenHash: credentials.claimTokenHash,
    eventId,
    expiresAt: checkoutExpiresAt,
    id: transferId,
    recipientCheckoutTransactionId: recipientTransactionId,
    recipientBasePrice: recipientUnitPrice,
    recipientDiscountAmount: 0,
    recipientRegistrationId: sourceRegistrationId,
    recipientSpotCount: 2,
    recipientUserId: input.recipient.id,
    registrationOptionId: optionId,
    reservedAdditionalSpots: 0,
    sourceRegistrationId,
    sourceSpotCount: 2,
    sourceUserId: input.source.id,
    status: 'checkout_pending',
    tenantId: input.tenant.id,
  });
  await input.database
    .insert(schema.registrationTransferBundleAddonPurchases)
    .values([
      {
        addonId: freeAddonId,
        cancelledQuantity: 1,
        eventId,
        includedQuantity: 0,
        purchasedQuantity: 2,
        quantity: 2,
        redeemedQuantity: 1,
        refundAllocatedPurchasedQuantity: 0,
        registrationOptionId: optionId,
        sourcePurchaseId: freePurchaseId,
        tenantId: input.tenant.id,
        transferId,
        unitPrice: 0,
        recipientStripeTaxRateId: null,
        recipientTaxRateDisplayName: null,
        recipientTaxRateInclusive: null,
        recipientTaxRatePercentage: null,
        recipientUnitPrice: 0,
      },
      {
        addonId: paidAddonId,
        cancelledQuantity: 1,
        eventId,
        includedQuantity: 1,
        purchasedQuantity: 2,
        quantity: 3,
        redeemedQuantity: 1,
        refundAllocatedPurchasedQuantity: 1,
        registrationOptionId: optionId,
        sourcePurchaseId: paidPurchaseId,
        tenantId: input.tenant.id,
        transferId,
        unitPrice: 500,
        recipientStripeTaxRateId: null,
        recipientTaxRateDisplayName: null,
        recipientTaxRateInclusive: null,
        recipientTaxRatePercentage: null,
        recipientUnitPrice: recipientPaidAddonUnitPrice,
      },
    ]);
  await input.database
    .insert(schema.registrationTransferBundleAddonPurchaseLots)
    .values([
      {
        cancelledQuantity: 1,
        quantity: 2,
        redeemedQuantity: 1,
        refundAllocatedQuantity: 0,
        sourcePurchaseId: freePurchaseId,
        sourcePurchaseLotId: freePurchaseLotId,
        sourceTransactionId: null,
        tenantId: input.tenant.id,
        transferId,
      },
      {
        cancelledQuantity: 1,
        quantity: 2,
        redeemedQuantity: 0,
        refundAllocatedQuantity: 1,
        sourcePurchaseId: paidPurchaseId,
        sourcePurchaseLotId: paidPurchaseLotId,
        sourceTransactionId: sourceAddonTransactionId,
        tenantId: input.tenant.id,
        transferId,
      },
    ]);
  await input.database
    .insert(schema.registrationTransferRefundPlanItems)
    .values([
      {
        applicationFeeRefunded: true,
        currency: 'EUR',
        id: sourceRegistrationPlanItemId,
        operationKey: `registration-transfer-source:${transferId}:${sourceTransactionId}`,
        originalAmount: sourceRegistrationAmount,
        priorRefundedAmount: 0,
        refundAmountDue: sourceRegistrationAmount,
        sourceRegistrationId,
        sourceTransactionId,
        sourceTransactionType: 'registration',
        stripeAccountId: sourceStripeAccountId,
        tenantId: input.tenant.id,
        transferId,
      },
      {
        applicationFeeRefunded: true,
        currency: 'EUR',
        id: sourceAddonPlanItemId,
        operationKey: `registration-transfer-source:${transferId}:${sourceAddonTransactionId}`,
        originalAmount: sourceAddonAmount,
        priorRefundedAmount: priorAddonRefundAmount,
        refundAmountDue: sourceAddonAmount - priorAddonRefundAmount,
        sourceRegistrationId,
        sourceTransactionId: sourceAddonTransactionId,
        sourceTransactionType: 'addon',
        stripeAccountId: sourceStripeAccountId,
        tenantId: input.tenant.id,
        transferId,
      },
    ]);
  await input.database
    .insert(schema.registrationTransferRefundPlanAcquisitionLinks)
    .values([
      {
        planItemId: sourceRegistrationPlanItemId,
        sourceAcquisitionId,
        sourceAcquisitionPaymentId: sourceRegistrationAcquisitionPaymentId,
        sourceTransactionId,
        tenantId: input.tenant.id,
      },
      {
        planItemId: sourceAddonPlanItemId,
        sourceAcquisitionId,
        sourceAcquisitionPaymentId: sourceAddonAcquisitionPaymentId,
        sourceTransactionId: sourceAddonTransactionId,
        tenantId: input.tenant.id,
      },
    ]);
  await input.database.insert(schema.registrationTransferEvents).values([
    {
      actorUserId: input.source.id,
      eventType: 'created',
      tenantId: input.tenant.id,
      toStatus: 'open',
      transferId,
    },
    {
      actorUserId: input.recipient.id,
      eventType: 'claimed',
      fromStatus: 'open',
      tenantId: input.tenant.id,
      toStatus: 'checkout_pending',
      transferId,
    },
    {
      actorUserId: input.recipient.id,
      eventType: 'checkout_started',
      fromStatus: 'open',
      tenantId: input.tenant.id,
      toStatus: 'checkout_pending',
      transferId,
    },
  ]);

  const completeCheckout = () => {
    const webhookSecret = 'whsec_paid_transfer_scenario';
    const payload = JSON.stringify({
      account: stripeAccountId,
      api_version: '2026-06-24.dahlia',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          amount_total: recipientAmount,
          currency: 'eur',
          id: checkoutSessionId,
          metadata: {
            registrationId: recipientRegistrationId,
            tenantId: input.tenant.id,
            transactionId: recipientTransactionId,
            transferId,
          },
          object: 'checkout.session',
          payment_intent: {
            id: paymentIntentId,
            latest_charge: chargeId,
            object: 'payment_intent',
          },
          payment_status: 'paid',
          status: 'complete',
        },
      },
      id: `evt_transfer_${recipientTransactionId}`,
      livemode: false,
      object: 'event',
      pending_webhooks: 1,
      request: {
        id: null,
        idempotency_key: null,
      },
      type: 'checkout.session.completed',
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });
    const event = Stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret,
    );
    if (event.type !== 'checkout.session.completed') {
      throw new Error('Expected a completed Checkout event');
    }
    return runDatabaseEffect(
      completePaidRegistrationCheckout(
        {
          registrationId: recipientRegistrationId,
          stripeAccountId,
          stripeCheckoutSessionId: checkoutSessionId,
          tenantId: input.tenant.id,
          transactionId: recipientTransactionId,
        },
        event.data.object,
      ),
    );
  };

  const cancelInheritedAddon = async () => {
    const result = await runDatabaseEffect(
      cancelRegistrationAddon({
        actorUserId: input.recipient.id,
        operationKey: `transfer-recipient-addon-cancel:${transferId}`,
        quantity: 1,
        reason: 'Recipient cancels one inherited add-on unit.',
        refundRequested: true,
        registrationAddonId: paidPurchaseId,
        registrationId: sourceRegistrationId,
        tenantId: input.tenant.id,
      }),
    );
    if (result.refundStatus !== 'pending') {
      throw new Error(
        `Expected pending recipient add-on refund, received ${result.refundStatus}`,
      );
    }
    return {
      fulfillmentEventId: result.fulfillmentEventId,
      refundStatus: result.refundStatus,
    };
  };

  const failSourceRefund = async () => {
    const plan =
      await input.database.query.registrationTransferRefundPlanItems.findFirst({
        columns: { refundTransactionId: true },
        where: {
          sourceTransactionId,
          tenantId: input.tenant.id,
          transferId,
        },
      });
    const refundTransactionId = plan?.refundTransactionId;
    if (!refundTransactionId) {
      throw new Error('Expected a persisted source refund claim');
    }
    await input.database
      .update(schema.transactions)
      .set({
        status: 'pending',
        stripeRefundAttempts: 8,
        // Mirror terminal webhook handling so an in-flight worker loses its lease.
        stripeRefundClaimLeaseExpiresAt: null,
        stripeRefundClaimLeaseId: null,
        stripeRefundId: terminalRefundId,
        stripeRefundLastError: 'Deterministic terminal Stripe refund failure',
        stripeRefundNextAttemptAt: null,
        stripeRefundStatus: 'failed',
      })
      .where(
        and(
          eq(schema.transactions.id, refundTransactionId),
          eq(schema.transactions.tenantId, input.tenant.id),
          eq(schema.transactions.type, 'refund'),
        ),
      );
    await runDatabaseEffect(
      Database.use((database) =>
        database.transaction((tx) =>
          reconcileRegistrationTransferRefund(tx, {
            refundTransactionId,
            stripeRefundStatus: 'failed',
          }),
        ),
      ),
    );
    return refundTransactionId;
  };

  const requeueSourceRefund = async () => {
    const plan =
      await input.database.query.registrationTransferRefundPlanItems.findFirst({
        columns: { refundTransactionId: true },
        where: {
          sourceTransactionId,
          tenantId: input.tenant.id,
          transferId,
        },
      });
    const refundTransactionId = plan?.refundTransactionId;
    if (!refundTransactionId) {
      throw new Error('Expected a source refund claim for operator requeue');
    }
    return runDatabaseEffect(
      Database.use((database) =>
        database.transaction((tx) =>
          Effect.gen(function* () {
            const recovery = yield* requeueRegistrationRefundClaim(tx, {
              reason: 'Playwright verifies deterministic refund recovery',
              refundClaimId: refundTransactionId,
              tenantId: input.tenant.id,
            });
            const transferStatus =
              yield* markRegistrationTransferRefundRequeued(tx, {
                expectedTransfer: { kind: 'source', transferId },
                reason: recovery.reason,
                refundTransactionId,
                tenantId: input.tenant.id,
              });
            return {
              refundAfter: recovery.after,
              recoveryMode: recovery.mode,
              transferStatus: requireRefundRequeueStatus(transferStatus),
            };
          }),
        ),
      ),
    );
  };

  const completeSourceRefunds = async () => {
    const plans =
      await input.database.query.registrationTransferRefundPlanItems.findMany({
        columns: { refundTransactionId: true },
        orderBy: { sourceTransactionId: 'asc' },
        where: {
          tenantId: input.tenant.id,
          transferId,
        },
      });
    const refundTransactionIds = plans.flatMap((plan) =>
      plan.refundTransactionId ? [plan.refundTransactionId] : [],
    );
    if (
      refundTransactionIds.length === 0 ||
      refundTransactionIds.length !== plans.length
    ) {
      throw new Error('Expected every source refund claim before completion');
    }

    for (const refundTransactionId of refundTransactionIds) {
      await input.database
        .update(schema.transactions)
        .set({
          status: 'successful',
          stripeRefundClaimLeaseExpiresAt: null,
          stripeRefundClaimLeaseId: null,
          stripeRefundId: `re_transfer_complete_${refundTransactionId}`,
          stripeRefundLastError: null,
          stripeRefundNextAttemptAt: null,
          stripeRefundStatus: 'succeeded',
        })
        .where(
          and(
            eq(schema.transactions.id, refundTransactionId),
            eq(schema.transactions.tenantId, input.tenant.id),
            eq(schema.transactions.type, 'refund'),
          ),
        );
      await runDatabaseEffect(
        Database.use((database) =>
          database.transaction((tx) =>
            reconcileRegistrationTransferRefund(tx, {
              refundTransactionId,
              stripeRefundStatus: 'succeeded',
            }),
          ),
        ),
      );
    }

    return refundTransactionIds;
  };

  const cleanup = async () => {
    await input.database
      .delete(schema.emailOutbox)
      .where(
        like(
          schema.emailOutbox.idempotencyKey,
          `registration-transferred/${input.tenant.id}/${recipientRegistrationId}/%`,
        ),
      );
    await input.database
      .delete(schema.registrationAcquisitionRefundAllocations)
      .where(
        and(
          eq(
            schema.registrationAcquisitionRefundAllocations.registrationId,
            sourceRegistrationId,
          ),
          eq(
            schema.registrationAcquisitionRefundAllocations.tenantId,
            input.tenant.id,
          ),
        ),
      );
    await input.database
      .delete(schema.registrationTransferRefundPlanAcquisitionLinks)
      .where(
        and(
          eq(
            schema.registrationTransferRefundPlanAcquisitionLinks
              .sourceAcquisitionId,
            sourceAcquisitionId,
          ),
          eq(
            schema.registrationTransferRefundPlanAcquisitionLinks.tenantId,
            input.tenant.id,
          ),
        ),
      );
    await input.database
      .delete(schema.registrationTransferRefundPlanItems)
      .where(
        and(
          eq(schema.registrationTransferRefundPlanItems.transferId, transferId),
          eq(
            schema.registrationTransferRefundPlanItems.tenantId,
            input.tenant.id,
          ),
        ),
      );
    await input.database
      .delete(schema.registrationAcquisitionComponents)
      .where(
        and(
          eq(
            schema.registrationAcquisitionComponents.registrationId,
            sourceRegistrationId,
          ),
          eq(
            schema.registrationAcquisitionComponents.tenantId,
            input.tenant.id,
          ),
        ),
      );
    await input.database
      .delete(schema.registrationAcquisitionPayments)
      .where(
        and(
          eq(
            schema.registrationAcquisitionPayments.registrationId,
            sourceRegistrationId,
          ),
          eq(schema.registrationAcquisitionPayments.tenantId, input.tenant.id),
        ),
      );
    await input.database
      .delete(schema.registrationAcquisitions)
      .where(
        and(
          eq(
            schema.registrationAcquisitions.registrationId,
            sourceRegistrationId,
          ),
          eq(schema.registrationAcquisitions.tenantId, input.tenant.id),
        ),
      );
    await input.database
      .delete(schema.registrationTransfers)
      .where(eq(schema.registrationTransfers.id, transferId));
    await input.database
      .delete(schema.eventRegistrationAddonRefundAllocations)
      .where(
        eq(
          schema.eventRegistrationAddonRefundAllocations.registrationId,
          sourceRegistrationId,
        ),
      );
    await input.database
      .delete(schema.eventRegistrationAddonFulfillmentEvents)
      .where(
        eq(
          schema.eventRegistrationAddonFulfillmentEvents.registrationId,
          sourceRegistrationId,
        ),
      );
    await input.database
      .delete(schema.eventRegistrationAddonPurchaseLots)
      .where(
        eq(
          schema.eventRegistrationAddonPurchaseLots.registrationId,
          sourceRegistrationId,
        ),
      );
    await input.database
      .delete(schema.eventRegistrationAddonPurchases)
      .where(
        eq(
          schema.eventRegistrationAddonPurchases.registrationId,
          sourceRegistrationId,
        ),
      );
    await input.database
      .delete(schema.transactions)
      .where(eq(schema.transactions.eventId, eventId));
    await input.database
      .delete(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.eventId, eventId));
    await input.database
      .delete(schema.addonToEventRegistrationOptions)
      .where(eq(schema.addonToEventRegistrationOptions.eventId, eventId));
    await input.database
      .delete(schema.eventAddons)
      .where(eq(schema.eventAddons.eventId, eventId));
    await input.database
      .delete(schema.eventRegistrationOptions)
      .where(eq(schema.eventRegistrationOptions.id, optionId));
    await input.database
      .delete(schema.eventInstances)
      .where(eq(schema.eventInstances.id, eventId));
    await input.database
      .update(schema.tenants)
      .set({ stripeAccountId: originalTenant.stripeAccountId })
      .where(eq(schema.tenants.id, input.tenant.id));
  };

  return {
    cancelInheritedAddon,
    claimPath: `/registration-transfers/${credentials.claimToken}`,
    cleanup,
    completeCheckout,
    completeSourceRefunds,
    eventId,
    failSourceRefund,
    optionId,
    paidPurchaseId,
    paidPurchaseLotId,
    recipientChargeId: chargeId,
    recipientPaymentIntentId: paymentIntentId,
    recipientRegistrationId,
    recipientTransactionId,
    requeueSourceRefund,
    freePurchaseLotId,
    sourceAcquisitionId,
    sourceRegistrationId,
    sourceStripeAccountId,
    sourceTransactionId,
    sourceTransactionIds: [sourceTransactionId, sourceAddonTransactionId],
    stripeAccountId,
    transferId,
  };
};
