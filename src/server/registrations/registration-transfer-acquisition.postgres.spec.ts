import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { and, asc, desc, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { Pool } from 'pg';

import { Database, databaseLayer } from '../../db';
import { createId } from '../../db/create-id';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import {
  addonToEventRegistrationOptions,
  emailOutbox,
  eventAddons,
  eventInstances,
  eventRegistrationAddonFulfillmentAllocations,
  eventRegistrationAddonFulfillmentEvents,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  registrationAcquisitionComponents,
  registrationAcquisitionPayments,
  registrationAcquisitionRefundAllocations,
  registrationAcquisitions,
  registrationTransferBundleAddonPurchaseLots,
  registrationTransferBundleAddonPurchases,
  registrationTransferRefundPlanAcquisitionLinks,
  registrationTransferRefundPlanItems,
  registrationTransfers,
  tenants,
  transactions,
  users,
  usersToTenants,
} from '../../db/schema';
import { registrationTransferAddonAllocationKey } from '../../shared/registration-transfer';
import { cancelRegistrationAddon } from './addon-fulfillment.service';
import { allocateAcquisitionComponentQuantity } from './registration-acquisition-refund';
import {
  establishRegistrationAcquisition,
  settleAcquisitionComponentTerms,
} from './registration-acquisition-write';
import { finalizeRegistrationTransferCheckout } from './registration-transfer-finalization';
import {
  lockRegistrationTransferRefundForRecovery,
  markRegistrationTransferRefundRequeued,
} from './registration-transfer-refund-reconciliation';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

interface AcquisitionFixture {
  readonly acquisitionIds: readonly [string, string, string];
  readonly acquisitionPaymentIds: readonly [string, string, string];
  readonly addonComponentIds: readonly [string, string, string];
  readonly addonId: string;
  readonly categoryId: string;
  readonly eventId: string;
  readonly ownerUserIds: readonly [string, string, string];
  readonly purchaseId: string;
  readonly purchaseLotId: string;
  readonly registrationId: string;
  readonly registrationTransactionIds: readonly [string, string, string];
  readonly templateId: string;
  readonly tenantId: string;
  readonly transferIds: readonly [string, string];
}

type TestDatabase = NodePgDatabase<typeof relations>;

const makeLayer = (url: string) => {
  const config = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: {
        DATABASE_URL: url,
      },
    }),
  );
  return Layer.mergeAll(config, databaseLayer.pipe(Layer.provide(config)));
};

type TestLayer = ReturnType<typeof makeLayer>;

const requireValue = <A>(value: A | null | undefined, label: string): A => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
};

const seedAcquisitionFixture = async (
  database: TestDatabase,
  layer: TestLayer,
  input: {
    readonly addonQuantity?: number;
    readonly priorCancelledQuantity?: number;
    readonly priorRedeemedQuantity?: number;
  } = {},
): Promise<AcquisitionFixture> => {
  const tenantId = createId();
  const categoryId = createId();
  const templateId = createId();
  const eventId = createId();
  const optionId = createId();
  const addonId = createId();
  const registrationId = createId();
  const purchaseId = createId();
  const purchaseLotId = createId();
  const sourceUserId = createId();
  const firstRecipientUserId = createId();
  const secondRecipientUserId = createId();
  const sourceTransactionId = createId();
  const firstRecipientTransactionId = createId();
  const secondRecipientTransactionId = createId();
  const firstTransferId = createId();
  const secondTransferId = createId();
  const firstPlanItemId = createId();
  const secondPlanItemId = createId();
  const addonQuantity = input.addonQuantity ?? 2;
  const priorCancelledQuantity = input.priorCancelledQuantity ?? 0;
  const priorRedeemedQuantity = input.priorRedeemedQuantity ?? 0;
  const sourceAddonAmount = 500 * addonQuantity;
  const firstRecipientAddonAmount = 100 * addonQuantity;
  const secondRecipientAddonAmount = 150 * addonQuantity;
  const firstRecipientAmount = 1000 + firstRecipientAddonAmount;
  const secondRecipientAmount = 1100 + secondRecipientAddonAmount;
  const secondRecipientApplicationFee = addonQuantity === 3 ? 6 : 30;
  const secondRecipientStripeFee = 20;
  const now = Date.now();
  const initialAcquiredAt = new Date(now - 30_000);
  const firstTransferredAt = new Date(now - 20_000);
  const secondTransferredAt = new Date(now - 10_000);

  await database.insert(tenants).values({
    domain: `${tenantId}.acquisition.example`,
    id: tenantId,
    name: 'Registration acquisition ledger',
    stripeAccountId: 'acct_current_second_recipient',
  });
  await database.insert(users).values(
    [sourceUserId, firstRecipientUserId, secondRecipientUserId].map(
      (userId, index) => ({
        auth0Id: `auth0|${userId}`,
        communicationEmail: `${userId}@example.com`,
        email: `${userId}@example.com`,
        firstName: 'Acquisition',
        id: userId,
        lastName: `Owner ${index}`,
      }),
    ),
  );
  await database.insert(usersToTenants).values(
    [sourceUserId, firstRecipientUserId, secondRecipientUserId].map(
      (userId) => ({
        tenantId,
        userId,
      }),
    ),
  );
  await database.insert(eventTemplateCategories).values({
    icon: { iconColor: 0, iconName: 'circle' },
    id: categoryId,
    tenantId,
    title: 'Acquisition ledger',
  });
  await database.insert(eventTemplates).values({
    categoryId,
    description: 'Registration acquisition ledger test',
    icon: { iconColor: 0, iconName: 'circle' },
    id: templateId,
    tenantId,
    title: 'Acquisition ledger',
  });
  await database.insert(eventInstances).values({
    creatorId: sourceUserId,
    description: 'Registration acquisition ledger test',
    end: new Date(now + 2 * 60 * 60 * 1000),
    icon: { iconColor: 0, iconName: 'circle' },
    id: eventId,
    start: new Date(now + 60 * 60 * 1000),
    status: 'APPROVED',
    templateId,
    tenantId,
    title: 'Acquisition ledger',
  });
  await database.insert(eventRegistrationOptions).values({
    closeRegistrationTime: new Date(now + 30 * 60 * 1000),
    eventId,
    id: optionId,
    isPaid: true,
    openRegistrationTime: new Date(now - 60 * 60 * 1000),
    organizingRegistration: false,
    price: 1100,
    registrationMode: 'fcfs',
    spots: 10,
    title: 'Participant',
  });
  await database.insert(eventAddons).values({
    allowMultiple: true,
    allowPurchaseBeforeEvent: true,
    allowPurchaseDuringEvent: true,
    allowPurchaseDuringRegistration: true,
    eventId,
    id: addonId,
    isPaid: true,
    maxQuantityPerUser: addonQuantity,
    price: 150,
    title: 'Acquired add-on',
    totalAvailableQuantity: priorCancelledQuantity,
  });
  await database.insert(addonToEventRegistrationOptions).values({
    addonId,
    eventId,
    includedQuantity: 0,
    optionalPurchaseQuantity: addonQuantity,
    registrationOptionId: optionId,
  });
  await database.insert(eventRegistrations).values({
    checkedInGuestCount: 1,
    checkInTime: new Date(now - 5000),
    eventId,
    guestCount: 1,
    id: registrationId,
    registrationOptionId: optionId,
    status: 'CONFIRMED',
    tenantId,
    userId: secondRecipientUserId,
  });
  await database.insert(transactions).values([
    {
      amount: sourceAddonAmount,
      appFee: 20,
      currency: 'EUR',
      eventId,
      eventRegistrationId: registrationId,
      id: sourceTransactionId,
      method: 'stripe',
      status: 'successful',
      stripeAccountId: 'acct_historical_source',
      stripeChargeId: `ch_${sourceTransactionId}`,
      stripeFee: 10,
      stripeNetAmount: sourceAddonAmount - 30,
      stripePaymentIntentId: `pi_${sourceTransactionId}`,
      targetUserId: sourceUserId,
      tenantId,
      type: 'addon',
    },
    {
      amount: firstRecipientAmount,
      appFee: 25,
      currency: 'EUR',
      eventId,
      eventRegistrationId: registrationId,
      id: firstRecipientTransactionId,
      method: 'stripe',
      status: 'successful',
      stripeAccountId: 'acct_first_recipient',
      stripeChargeId: `ch_${firstRecipientTransactionId}`,
      stripeFee: 15,
      stripeNetAmount: firstRecipientAmount - 40,
      stripePaymentIntentId: `pi_${firstRecipientTransactionId}`,
      targetUserId: firstRecipientUserId,
      tenantId,
      type: 'registration',
    },
    {
      amount: secondRecipientAmount,
      appFee: secondRecipientApplicationFee,
      currency: 'EUR',
      eventId,
      eventRegistrationId: registrationId,
      id: secondRecipientTransactionId,
      method: 'stripe',
      status: 'successful',
      stripeAccountId: 'acct_current_second_recipient',
      stripeChargeId: `ch_${secondRecipientTransactionId}`,
      stripeFee: secondRecipientStripeFee,
      stripeNetAmount:
        secondRecipientAmount -
        secondRecipientApplicationFee -
        secondRecipientStripeFee,
      stripePaymentIntentId: `pi_${secondRecipientTransactionId}`,
      targetUserId: secondRecipientUserId,
      tenantId,
      type: 'registration',
    },
  ]);
  await database.insert(eventRegistrationAddonPurchases).values({
    addonId,
    cancelledQuantity: priorCancelledQuantity,
    eventId,
    id: purchaseId,
    includedQuantity: 0,
    purchasedQuantity: addonQuantity,
    quantity: addonQuantity,
    redeemedQuantity: priorRedeemedQuantity,
    registrationId,
    registrationOptionId: optionId,
    tenantId,
    unitPrice: 500,
  });
  await database.insert(eventRegistrationAddonPurchaseLots).values({
    applicationFeeAmount: 20,
    baseAmount: sourceAddonAmount,
    cancelledQuantity: priorCancelledQuantity,
    currency: 'EUR',
    eventId,
    grossAmount: sourceAddonAmount,
    id: purchaseLotId,
    netAmount: sourceAddonAmount - 30,
    paymentAllocationFinalizedAt: initialAcquiredAt,
    purchaseId,
    quantity: addonQuantity,
    redeemedQuantity: priorRedeemedQuantity,
    registrationId,
    registrationOptionId: optionId,
    sourceLineKey: `registration-initial:${purchaseLotId}`,
    sourceTransactionId,
    stripeFeeAmount: 10,
    taxAmount: 0,
    tenantId,
    unitPrice: 500,
  });
  if (priorRedeemedQuantity > 0) {
    const fulfillmentEventId = createId();
    await database.insert(eventRegistrationAddonFulfillmentEvents).values({
      actorKind: 'user',
      actorUserId: sourceUserId,
      eventId,
      id: fulfillmentEventId,
      operationKey: `historic-redeem:${purchaseId}`,
      purchaseId,
      quantity: priorRedeemedQuantity,
      registrationId,
      tenantId,
      type: 'redeemed',
    });
    await database.insert(eventRegistrationAddonFulfillmentAllocations).values({
      fulfillmentEventId,
      purchaseId,
      purchaseLotId,
      quantity: priorRedeemedQuantity,
      source: 'purchased',
      tenantId,
    });
  }
  if (priorCancelledQuantity > 0) {
    const fulfillmentEventId = createId();
    await database.insert(eventRegistrationAddonFulfillmentEvents).values({
      actorKind: 'user',
      actorUserId: sourceUserId,
      eventId,
      id: fulfillmentEventId,
      operationKey: `historic-cancel:${purchaseId}`,
      purchaseId,
      quantity: priorCancelledQuantity,
      reason: 'Cancelled before the latest ownership epoch',
      refundRequested: false,
      registrationId,
      tenantId,
      type: 'cancelled',
    });
    await database.insert(eventRegistrationAddonFulfillmentAllocations).values({
      fulfillmentEventId,
      purchaseId,
      purchaseLotId,
      quantity: priorCancelledQuantity,
      source: 'purchased',
      tenantId,
    });
  }
  await database.insert(registrationTransfers).values([
    {
      claimCodeHash: `code-${firstTransferId}`,
      claimTokenHash: `token-${firstTransferId}`,
      completedAt: firstTransferredAt,
      eventId,
      expiresAt: new Date(now + 60 * 60 * 1000),
      id: firstTransferId,
      ownershipTransferredAt: firstTransferredAt,
      recipientBasePrice: 1000,
      recipientCheckoutTransactionId: firstRecipientTransactionId,
      recipientConfirmedAt: firstTransferredAt,
      recipientRegistrationId: registrationId,
      recipientSpotCount: 2,
      recipientUserId: firstRecipientUserId,
      registrationOptionId: optionId,
      sourceRegistrationId: registrationId,
      sourceSpotCount: 2,
      sourceUserId,
      status: 'completed',
      tenantId,
    },
    {
      claimCodeHash: `code-${secondTransferId}`,
      claimTokenHash: `token-${secondTransferId}`,
      completedAt: secondTransferredAt,
      eventId,
      expiresAt: new Date(now + 60 * 60 * 1000),
      id: secondTransferId,
      ownershipTransferredAt: secondTransferredAt,
      recipientBasePrice: 1100,
      recipientCheckoutTransactionId: secondRecipientTransactionId,
      recipientConfirmedAt: secondTransferredAt,
      recipientRegistrationId: registrationId,
      recipientSpotCount: 2,
      recipientUserId: secondRecipientUserId,
      registrationOptionId: optionId,
      sourceRegistrationId: registrationId,
      sourceSpotCount: 2,
      sourceUserId: firstRecipientUserId,
      status: 'completed',
      tenantId,
    },
  ]);
  const settleTerms = (
    registrationBaseAmount: number,
    addonBaseAmount: number,
    registrationAllocationKey: string,
    addonAllocationKey: string,
    settlement: {
      readonly applicationFeeAmount: number;
      readonly grossAmount: number;
      readonly stripeFeeAmount: number;
      readonly stripeNetAmount: number;
    },
  ) =>
    requireValue(
      settleAcquisitionComponentTerms({
        payment: settlement,
        terms: [
          {
            allocationKey: registrationAllocationKey,
            baseAmount: registrationBaseAmount,
            id: createId(),
            kind: 'registration',
            quantity: 2,
            taxRateDisplayName: null,
            taxRateInclusive: null,
            taxRatePercentage: null,
          },
          {
            allocationKey: addonAllocationKey,
            baseAmount: addonBaseAmount,
            id: createId(),
            kind: 'addon_lot',
            purchaseId,
            purchaseLotId,
            quantity: addonQuantity,
            taxRateDisplayName: null,
            taxRateInclusive: null,
            taxRatePercentage: null,
          },
        ],
      }),
      'settled acquisition components',
    );
  const establish = (
    input: Parameters<typeof establishRegistrationAcquisition>[1],
  ) =>
    Effect.runPromise(
      Database.use((effectDatabase) =>
        effectDatabase.transaction((tx) =>
          establishRegistrationAcquisition(tx, input),
        ),
      ).pipe(Effect.provide(layer)),
    );
  const initialSettlement = {
    applicationFeeAmount: 20,
    grossAmount: sourceAddonAmount,
    stripeFeeAmount: 10,
    stripeNetAmount: sourceAddonAmount - 30,
  };
  const initial = await establish({
    acquiredAt: initialAcquiredAt,
    components: settleTerms(
      0,
      sourceAddonAmount,
      `registration-initial:${registrationId}`,
      `registration-initial:${purchaseLotId}`,
      initialSettlement,
    ),
    currency: 'EUR',
    eventId,
    kind: 'initial',
    operationKey: `registration-initial:${registrationId}`,
    ownerUserId: sourceUserId,
    payment: {
      settlement: initialSettlement,
      stripeAccountId: 'acct_historical_source',
      stripeChargeId: `ch_${sourceTransactionId}`,
      stripePaymentIntentId: `pi_${sourceTransactionId}`,
      transactionId: sourceTransactionId,
      type: 'addon',
    },
    registrationId,
    spotCount: 2,
    tenantId,
  });
  const firstSettlement = {
    applicationFeeAmount: 25,
    grossAmount: firstRecipientAmount,
    stripeFeeAmount: 15,
    stripeNetAmount: firstRecipientAmount - 40,
  };
  const firstRecipient = await establish({
    acquiredAt: firstTransferredAt,
    components: settleTerms(
      1000,
      firstRecipientAddonAmount,
      `registration-transfer:${firstTransferId}:registration`,
      `registration-transfer:${firstTransferId}:${purchaseId}`,
      firstSettlement,
    ),
    currency: 'EUR',
    eventId,
    kind: 'claim_transfer',
    operationKey: `registration-transfer:${firstTransferId}`,
    ownerUserId: firstRecipientUserId,
    payment: {
      settlement: firstSettlement,
      stripeAccountId: 'acct_first_recipient',
      stripeChargeId: `ch_${firstRecipientTransactionId}`,
      stripePaymentIntentId: `pi_${firstRecipientTransactionId}`,
      transactionId: firstRecipientTransactionId,
      type: 'registration',
    },
    registrationId,
    spotCount: 2,
    tenantId,
    transferId: firstTransferId,
  });
  const secondSettlement = {
    applicationFeeAmount: secondRecipientApplicationFee,
    grossAmount: secondRecipientAmount,
    stripeFeeAmount: secondRecipientStripeFee,
    stripeNetAmount:
      secondRecipientAmount -
      secondRecipientApplicationFee -
      secondRecipientStripeFee,
  };
  const secondRecipient = await establish({
    acquiredAt: secondTransferredAt,
    components: settleTerms(
      1100,
      secondRecipientAddonAmount,
      `registration-transfer:${secondTransferId}:registration`,
      `registration-transfer:${secondTransferId}:${purchaseId}`,
      secondSettlement,
    ),
    currency: 'EUR',
    eventId,
    kind: 'claim_transfer',
    operationKey: `registration-transfer:${secondTransferId}`,
    ownerUserId: secondRecipientUserId,
    payment: {
      settlement: secondSettlement,
      stripeAccountId: 'acct_current_second_recipient',
      stripeChargeId: `ch_${secondRecipientTransactionId}`,
      stripePaymentIntentId: `pi_${secondRecipientTransactionId}`,
      transactionId: secondRecipientTransactionId,
      type: 'registration',
    },
    registrationId,
    spotCount: 2,
    tenantId,
    transferId: secondTransferId,
  });
  const initialAcquisitionId = initial.acquisitionId;
  const firstRecipientAcquisitionId = firstRecipient.acquisitionId;
  const secondRecipientAcquisitionId = secondRecipient.acquisitionId;
  const initialAcquisitionPaymentId = requireValue(
    initial.paymentId,
    'initial acquisition payment',
  );
  const firstRecipientAcquisitionPaymentId = requireValue(
    firstRecipient.paymentId,
    'first recipient acquisition payment',
  );
  const secondRecipientAcquisitionPaymentId = requireValue(
    secondRecipient.paymentId,
    'second recipient acquisition payment',
  );
  const initialAddonComponentId = requireValue(
    initial.componentIds[1],
    'initial add-on component',
  );
  const firstRecipientAddonComponentId = requireValue(
    firstRecipient.componentIds[1],
    'first recipient add-on component',
  );
  const secondRecipientAddonComponentId = requireValue(
    secondRecipient.componentIds[1],
    'second recipient add-on component',
  );
  await database.insert(registrationTransferRefundPlanItems).values([
    {
      applicationFeeRefunded: true,
      currency: 'EUR',
      id: firstPlanItemId,
      operationKey: `registration-transfer:${firstTransferId}:refund`,
      originalAmount: sourceAddonAmount,
      priorRefundedAmount: 0,
      refundAmountDue: sourceAddonAmount,
      sourceRegistrationId: registrationId,
      sourceTransactionId,
      sourceTransactionType: 'addon',
      stripeAccountId: 'acct_historical_source',
      tenantId,
      transferId: firstTransferId,
    },
    {
      applicationFeeRefunded: true,
      currency: 'EUR',
      id: secondPlanItemId,
      operationKey: `registration-transfer:${secondTransferId}:refund`,
      originalAmount: firstRecipientAmount,
      priorRefundedAmount: 0,
      refundAmountDue: firstRecipientAmount,
      sourceRegistrationId: registrationId,
      sourceTransactionId: firstRecipientTransactionId,
      sourceTransactionType: 'registration',
      stripeAccountId: 'acct_first_recipient',
      tenantId,
      transferId: secondTransferId,
    },
  ]);
  await database.insert(registrationTransferRefundPlanAcquisitionLinks).values([
    {
      planItemId: firstPlanItemId,
      sourceAcquisitionId: initialAcquisitionId,
      sourceAcquisitionPaymentId: initialAcquisitionPaymentId,
      sourceTransactionId,
      tenantId,
    },
    {
      planItemId: secondPlanItemId,
      sourceAcquisitionId: firstRecipientAcquisitionId,
      sourceAcquisitionPaymentId: firstRecipientAcquisitionPaymentId,
      sourceTransactionId: firstRecipientTransactionId,
      tenantId,
    },
  ]);

  return {
    acquisitionIds: [
      initialAcquisitionId,
      firstRecipientAcquisitionId,
      secondRecipientAcquisitionId,
    ],
    acquisitionPaymentIds: [
      initialAcquisitionPaymentId,
      firstRecipientAcquisitionPaymentId,
      secondRecipientAcquisitionPaymentId,
    ],
    addonComponentIds: [
      initialAddonComponentId,
      firstRecipientAddonComponentId,
      secondRecipientAddonComponentId,
    ],
    addonId,
    categoryId,
    eventId,
    ownerUserIds: [sourceUserId, firstRecipientUserId, secondRecipientUserId],
    purchaseId,
    purchaseLotId,
    registrationId,
    registrationTransactionIds: [
      sourceTransactionId,
      firstRecipientTransactionId,
      secondRecipientTransactionId,
    ],
    templateId,
    tenantId,
    transferIds: [firstTransferId, secondTransferId],
  };
};

const seedPaidRepeatTransferCheckout = async (
  database: TestDatabase,
  layer: TestLayer,
  fixture: AcquisitionFixture,
  input: { readonly linkRefundPlan?: boolean } = {},
) => {
  const transferId = createId();
  const recipientTransactionId = createId();
  const planItemId = createId();
  const sourceUserId = fixture.ownerUserIds[2];
  const recipientUserId = fixture.ownerUserIds[0];
  const sourceTransactionId = fixture.registrationTransactionIds[2];
  const addonAllocationKey = registrationTransferAddonAllocationKey(
    transferId,
    fixture.purchaseId,
  );
  const checkoutRequest = {
    customerEmail: `${recipientUserId}@example.com`,
    eventTitle: 'Acquisition ledger',
    eventUrl: 'https://acquisition.example/events/repeat-transfer',
    expiresAt: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
    lineItems: [
      {
        allocationKey: `registration-transfer:${transferId}:registration`,
        kind: 'registration' as const,
        name: 'Participant',
        quantity: 2,
        unitAmount: 600,
      },
      {
        addonId: fixture.addonId,
        allocationKey: addonAllocationKey,
        kind: 'addon' as const,
        name: 'Acquired add-on',
        quantity: 2,
        unitAmount: 200,
      },
    ],
    notificationEmail: `${recipientUserId}@example.com`,
  };

  await database.insert(transactions).values({
    amount: 1600,
    appFee: 40,
    currency: 'EUR',
    eventId: fixture.eventId,
    eventRegistrationId: fixture.registrationId,
    id: recipientTransactionId,
    method: 'stripe',
    status: 'successful',
    stripeAccountId: 'acct_current_second_recipient',
    stripeChargeId: `ch_${recipientTransactionId}`,
    stripeCheckoutRequest: checkoutRequest,
    stripeFee: 20,
    stripeNetAmount: 1540,
    stripePaymentIntentId: `pi_${recipientTransactionId}`,
    targetUserId: recipientUserId,
    tenantId: fixture.tenantId,
    type: 'registration',
  });
  await database.insert(registrationTransfers).values({
    claimCodeHash: `code-${transferId}`,
    claimTokenHash: `token-${transferId}`,
    eventId: fixture.eventId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    id: transferId,
    recipientBasePrice: 1200,
    recipientCheckoutTransactionId: recipientTransactionId,
    recipientRegistrationId: fixture.registrationId,
    recipientSpotCount: 2,
    recipientUserId,
    registrationOptionId: requireValue(
      await database
        .select({ id: eventRegistrationOptions.id })
        .from(eventRegistrationOptions)
        .where(eq(eventRegistrationOptions.eventId, fixture.eventId))
        .then((rows) => rows[0]?.id),
      'registration option',
    ),
    sourceRegistrationId: fixture.registrationId,
    sourceSpotCount: 2,
    sourceUserId,
    status: 'checkout_pending',
    tenantId: fixture.tenantId,
  });
  const purchase = requireValue(
    await database.query.eventRegistrationAddonPurchases.findFirst({
      where: { id: fixture.purchaseId },
    }),
    'transfer add-on purchase',
  );
  const lotBefore = requireValue(
    await database.query.eventRegistrationAddonPurchaseLots.findFirst({
      where: { id: fixture.purchaseLotId },
    }),
    'transfer add-on lot',
  );
  await database.insert(registrationTransferBundleAddonPurchases).values({
    addonId: purchase.addonId,
    cancelledQuantity: purchase.cancelledQuantity,
    eventId: purchase.eventId,
    includedQuantity: purchase.includedQuantity,
    purchasedQuantity: purchase.purchasedQuantity,
    quantity: purchase.quantity,
    recipientStripeTaxRateId: null,
    recipientTaxRateDisplayName: null,
    recipientTaxRateInclusive: null,
    recipientTaxRatePercentage: null,
    recipientUnitPrice: 200,
    redeemedQuantity: purchase.redeemedQuantity,
    refundAllocatedPurchasedQuantity: purchase.refundAllocatedPurchasedQuantity,
    registrationOptionId: purchase.registrationOptionId,
    sourcePurchaseId: purchase.id,
    taxRateDisplayName: purchase.taxRateDisplayName,
    taxRateInclusive: purchase.taxRateInclusive,
    taxRatePercentage: purchase.taxRatePercentage,
    tenantId: fixture.tenantId,
    transferId,
    unitPrice: purchase.unitPrice,
  });
  await database.insert(registrationTransferBundleAddonPurchaseLots).values({
    cancelledQuantity: lotBefore.cancelledQuantity,
    quantity: lotBefore.quantity,
    redeemedQuantity: lotBefore.redeemedQuantity,
    refundAllocatedQuantity: lotBefore.refundAllocatedQuantity,
    sourcePurchaseId: lotBefore.purchaseId,
    sourcePurchaseLotId: lotBefore.id,
    sourceTransactionId: lotBefore.sourceTransactionId,
    tenantId: fixture.tenantId,
    transferId,
  });
  await database.insert(registrationTransferRefundPlanItems).values({
    applicationFeeRefunded: true,
    currency: 'EUR',
    id: planItemId,
    operationKey: `registration-transfer:${transferId}:refund`,
    originalAmount: 1400,
    priorRefundedAmount: 0,
    refundAmountDue: 1400,
    sourceRegistrationId: fixture.registrationId,
    sourceTransactionId,
    sourceTransactionType: 'registration',
    stripeAccountId: 'acct_current_second_recipient',
    tenantId: fixture.tenantId,
    transferId,
  });
  if (input.linkRefundPlan !== false) {
    await database
      .insert(registrationTransferRefundPlanAcquisitionLinks)
      .values({
        planItemId,
        sourceAcquisitionId: fixture.acquisitionIds[2],
        sourceAcquisitionPaymentId: fixture.acquisitionPaymentIds[2],
        sourceTransactionId,
        tenantId: fixture.tenantId,
      });
  }

  const finalize = () =>
    Effect.runPromise(
      Database.use((effectDatabase) =>
        effectDatabase.transaction((tx) =>
          finalizeRegistrationTransferCheckout(tx, {
            registrationId: fixture.registrationId,
            tenantId: fixture.tenantId,
            transactionId: recipientTransactionId,
          }),
        ),
      ).pipe(Effect.provide(layer)),
    );

  return {
    finalize,
    lotBefore,
    planItemId,
    recipientTransactionId,
    recipientUserId,
    sourceTransactionId,
    sourceUserId,
    transferId,
  };
};

const cleanFixture = async (
  database: TestDatabase,
  fixture: AcquisitionFixture,
) => {
  await database
    .delete(emailOutbox)
    .where(eq(emailOutbox.tenantId, fixture.tenantId));
  await database
    .delete(registrationAcquisitionRefundAllocations)
    .where(
      eq(registrationAcquisitionRefundAllocations.tenantId, fixture.tenantId),
    );
  await database
    .delete(eventRegistrationAddonFulfillmentEvents)
    .where(
      eq(eventRegistrationAddonFulfillmentEvents.tenantId, fixture.tenantId),
    );
  await database
    .delete(registrationTransferRefundPlanAcquisitionLinks)
    .where(
      eq(
        registrationTransferRefundPlanAcquisitionLinks.tenantId,
        fixture.tenantId,
      ),
    );
  await database
    .delete(registrationTransferRefundPlanItems)
    .where(eq(registrationTransferRefundPlanItems.tenantId, fixture.tenantId));
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
    .delete(registrationTransfers)
    .where(eq(registrationTransfers.tenantId, fixture.tenantId));
  await database
    .delete(eventRegistrationAddonPurchases)
    .where(eq(eventRegistrationAddonPurchases.id, fixture.purchaseId));
  await database
    .delete(transactions)
    .where(eq(transactions.tenantId, fixture.tenantId));
  await database
    .delete(eventRegistrations)
    .where(eq(eventRegistrations.id, fixture.registrationId));
  await database
    .delete(addonToEventRegistrationOptions)
    .where(eq(addonToEventRegistrationOptions.addonId, fixture.addonId));
  await database.delete(eventAddons).where(eq(eventAddons.id, fixture.addonId));
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
  await database.delete(users).where(eq(users.id, fixture.ownerUserIds[0]));
  await database.delete(users).where(eq(users.id, fixture.ownerUserIds[1]));
  await database.delete(users).where(eq(users.id, fixture.ownerUserIds[2]));
  await database.delete(tenants).where(eq(tenants.id, fixture.tenantId));
};

describe('registration acquisition ledger', () => {
  let database: TestDatabase;
  const fixtures: AcquisitionFixture[] = [];
  let layer: TestLayer;
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
    layer = makeLayer(databaseUrl);
  });

  afterAll(async () => {
    for (const fixture of fixtures.toReversed()) {
      await cleanFixture(database, fixture);
    }
    await pool.end();
  });

  it('keeps one linear current ownership epoch across repeated transfers', async () => {
    const fixture = await seedAcquisitionFixture(database, layer);
    fixtures.push(fixture);
    const [initialAcquisitionId, firstAcquisitionId, currentAcquisitionId] =
      fixture.acquisitionIds;

    const epochs = await database
      .select({
        id: registrationAcquisitions.id,
        ordinal: registrationAcquisitions.ordinal,
        ownerUserId: registrationAcquisitions.ownerUserId,
        previousAcquisitionId: registrationAcquisitions.previousAcquisitionId,
        registrationId: registrationAcquisitions.registrationId,
        transferId: registrationAcquisitions.transferId,
      })
      .from(registrationAcquisitions)
      .where(
        and(
          eq(registrationAcquisitions.tenantId, fixture.tenantId),
          eq(registrationAcquisitions.registrationId, fixture.registrationId),
        ),
      )
      .orderBy(asc(registrationAcquisitions.ordinal));

    expect(epochs).toEqual([
      {
        id: initialAcquisitionId,
        ordinal: 0,
        ownerUserId: fixture.ownerUserIds[0],
        previousAcquisitionId: null,
        registrationId: fixture.registrationId,
        transferId: null,
      },
      {
        id: firstAcquisitionId,
        ordinal: 1,
        ownerUserId: fixture.ownerUserIds[1],
        previousAcquisitionId: initialAcquisitionId,
        registrationId: fixture.registrationId,
        transferId: fixture.transferIds[0],
      },
      {
        id: currentAcquisitionId,
        ordinal: 2,
        ownerUserId: fixture.ownerUserIds[2],
        previousAcquisitionId: firstAcquisitionId,
        registrationId: fixture.registrationId,
        transferId: fixture.transferIds[1],
      },
    ]);
    const current = await database
      .select({
        id: registrationAcquisitions.id,
        ordinal: registrationAcquisitions.ordinal,
        ownerUserId: registrationAcquisitions.ownerUserId,
      })
      .from(registrationAcquisitions)
      .where(
        and(
          eq(registrationAcquisitions.tenantId, fixture.tenantId),
          eq(registrationAcquisitions.registrationId, fixture.registrationId),
        ),
      )
      .orderBy(desc(registrationAcquisitions.ordinal))
      .limit(1);
    expect(current).toEqual([
      {
        id: currentAcquisitionId,
        ordinal: 2,
        ownerUserId: fixture.ownerUserIds[2],
      },
    ]);

    const appendCandidate = () =>
      database
        .insert(registrationAcquisitions)
        .values({
          acquiredAt: new Date(),
          eventId: fixture.eventId,
          id: createId(),
          kind: 'direct_transfer',
          operationKey: `direct-transfer:${createId()}`,
          ordinal: 3,
          ownerUserId: fixture.ownerUserIds[0],
          previousAcquisitionId: currentAcquisitionId,
          registrationId: fixture.registrationId,
          spotCount: 2,
          tenantId: fixture.tenantId,
        })
        .onConflictDoNothing()
        .returning({ id: registrationAcquisitions.id });
    const appendResults = await Promise.all([
      appendCandidate(),
      appendCandidate(),
    ]);
    const appended = appendResults.flat();
    expect(appended).toHaveLength(1);
    expect(
      await database
        .select({ id: registrationAcquisitions.id })
        .from(registrationAcquisitions)
        .where(
          and(
            eq(registrationAcquisitions.tenantId, fixture.tenantId),
            eq(registrationAcquisitions.registrationId, fixture.registrationId),
            eq(registrationAcquisitions.ordinal, 3),
          ),
        ),
    ).toEqual(appended);
  });

  it('locks a refund-linked transfer without locking an outer join', async () => {
    const fixture = await seedAcquisitionFixture(database, layer);
    fixtures.push(fixture);
    const refundTransactionId = createId();
    const sourceTransactionId = fixture.registrationTransactionIds[0];
    const transferId = fixture.transferIds[0];

    await database.insert(transactions).values({
      amount: -1000,
      currency: 'EUR',
      eventId: fixture.eventId,
      eventRegistrationId: fixture.registrationId,
      id: refundTransactionId,
      method: 'stripe',
      refundOperationKey: `refund-recovery:${refundTransactionId}`,
      sourceTransactionId,
      status: 'pending',
      stripeAccountId: 'acct_historical_source',
      stripeRefundApplicationFee: true,
      stripeRefundAttempts: 8,
      stripeRefundId: `re_${refundTransactionId}`,
      stripeRefundStatus: 'failed',
      targetUserId: fixture.ownerUserIds[0],
      tenantId: fixture.tenantId,
      type: 'refund',
    });
    const linkedPlans = await database
      .update(registrationTransferRefundPlanItems)
      .set({ refundTransactionId })
      .where(
        and(
          eq(registrationTransferRefundPlanItems.tenantId, fixture.tenantId),
          eq(registrationTransferRefundPlanItems.transferId, transferId),
          eq(
            registrationTransferRefundPlanItems.sourceTransactionId,
            sourceTransactionId,
          ),
        ),
      )
      .returning({ id: registrationTransferRefundPlanItems.id });
    expect(linkedPlans).toHaveLength(1);

    const lookupTransfer = () =>
      Effect.runPromise(
        Database.use((effectDatabase) =>
          effectDatabase.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .select({ id: transactions.id })
                .from(transactions)
                .where(
                  and(
                    eq(transactions.id, refundTransactionId),
                    eq(transactions.tenantId, fixture.tenantId),
                    eq(transactions.type, 'refund'),
                  ),
                )
                .for('update');
              return yield* lockRegistrationTransferRefundForRecovery(tx, {
                refundTransactionId,
                tenantId: fixture.tenantId,
              });
            }),
          ),
        ).pipe(Effect.provide(layer)),
      );

    expect(await lookupTransfer()).toEqual({
      kind: 'source',
      status: 'matched',
      transfer: {
        id: transferId,
        status: 'completed',
        tenantId: fixture.tenantId,
      },
    });

    await database
      .update(registrationTransfers)
      .set({ status: 'refund_failed' })
      .where(
        and(
          eq(registrationTransfers.id, transferId),
          eq(registrationTransfers.tenantId, fixture.tenantId),
        ),
      );
    const mismatchedRecovery = await Effect.runPromise(
      Database.use((effectDatabase) =>
        effectDatabase.transaction((tx) =>
          markRegistrationTransferRefundRequeued(tx, {
            expectedTransfer: { kind: 'compensation', transferId },
            reason: 'Prove the locked transfer kind remains authoritative',
            refundTransactionId,
            tenantId: fixture.tenantId,
          }),
        ),
      ).pipe(Effect.provide(layer)),
    );
    expect(mismatchedRecovery).toBe('notTransfer');

    await database
      .update(registrationTransfers)
      .set({ compensationRefundTransactionId: refundTransactionId })
      .where(
        and(
          eq(registrationTransfers.id, transferId),
          eq(registrationTransfers.tenantId, fixture.tenantId),
        ),
      );
    expect(await lookupTransfer()).toEqual({ status: 'ambiguous' });
  });

  it('links exact payments and the same immutable add-on lot through account rotation', async () => {
    const fixture = await seedAcquisitionFixture(database, layer);
    fixtures.push(fixture);

    const lineage = await database
      .select({
        accountId: transactions.stripeAccountId,
        acquisitionId: registrationAcquisitions.id,
        amount: transactions.amount,
        ordinal: registrationAcquisitions.ordinal,
        paymentId: registrationAcquisitionPayments.id,
        transactionId: transactions.id,
      })
      .from(registrationAcquisitions)
      .innerJoin(
        registrationAcquisitionPayments,
        eq(
          registrationAcquisitionPayments.acquisitionId,
          registrationAcquisitions.id,
        ),
      )
      .innerJoin(
        transactions,
        eq(transactions.id, registrationAcquisitionPayments.transactionId),
      )
      .where(eq(registrationAcquisitions.tenantId, fixture.tenantId))
      .orderBy(asc(registrationAcquisitions.ordinal));
    expect(lineage).toEqual([
      {
        accountId: 'acct_historical_source',
        acquisitionId: fixture.acquisitionIds[0],
        amount: 1000,
        ordinal: 0,
        paymentId: fixture.acquisitionPaymentIds[0],
        transactionId: fixture.registrationTransactionIds[0],
      },
      {
        accountId: 'acct_first_recipient',
        acquisitionId: fixture.acquisitionIds[1],
        amount: 1200,
        ordinal: 1,
        paymentId: fixture.acquisitionPaymentIds[1],
        transactionId: fixture.registrationTransactionIds[1],
      },
      {
        accountId: 'acct_current_second_recipient',
        acquisitionId: fixture.acquisitionIds[2],
        amount: 1400,
        ordinal: 2,
        paymentId: fixture.acquisitionPaymentIds[2],
        transactionId: fixture.registrationTransactionIds[2],
      },
    ]);

    const components = await database
      .select({
        acquisitionId: registrationAcquisitionComponents.acquisitionId,
        acquisitionPaymentId:
          registrationAcquisitionComponents.acquisitionPaymentId,
        baseAmount: registrationAcquisitionComponents.baseAmount,
        grossAmount: registrationAcquisitionComponents.grossAmount,
        id: registrationAcquisitionComponents.id,
        purchaseId: registrationAcquisitionComponents.purchaseId,
        purchaseLotId: registrationAcquisitionComponents.purchaseLotId,
        quantity: registrationAcquisitionComponents.quantity,
      })
      .from(registrationAcquisitionComponents)
      .where(
        and(
          eq(registrationAcquisitionComponents.tenantId, fixture.tenantId),
          eq(registrationAcquisitionComponents.kind, 'addon_lot'),
        ),
      )
      .orderBy(asc(registrationAcquisitionComponents.acquiredAt));
    expect(components).toEqual([
      {
        acquisitionId: fixture.acquisitionIds[0],
        acquisitionPaymentId: fixture.acquisitionPaymentIds[0],
        baseAmount: 1000,
        grossAmount: 1000,
        id: fixture.addonComponentIds[0],
        purchaseId: fixture.purchaseId,
        purchaseLotId: fixture.purchaseLotId,
        quantity: 2,
      },
      {
        acquisitionId: fixture.acquisitionIds[1],
        acquisitionPaymentId: fixture.acquisitionPaymentIds[1],
        baseAmount: 200,
        grossAmount: 200,
        id: fixture.addonComponentIds[1],
        purchaseId: fixture.purchaseId,
        purchaseLotId: fixture.purchaseLotId,
        quantity: 2,
      },
      {
        acquisitionId: fixture.acquisitionIds[2],
        acquisitionPaymentId: fixture.acquisitionPaymentIds[2],
        baseAmount: 300,
        grossAmount: 300,
        id: fixture.addonComponentIds[2],
        purchaseId: fixture.purchaseId,
        purchaseLotId: fixture.purchaseLotId,
        quantity: 2,
      },
    ]);
    expect(components.map(({ purchaseLotId }) => purchaseLotId)).toEqual([
      fixture.purchaseLotId,
      fixture.purchaseLotId,
      fixture.purchaseLotId,
    ]);

    const lot =
      await database.query.eventRegistrationAddonPurchaseLots.findFirst({
        columns: {
          cancelledQuantity: true,
          id: true,
          quantity: true,
          redeemedQuantity: true,
          refundAllocatedQuantity: true,
          sourceTransactionId: true,
        },
        where: { id: fixture.purchaseLotId },
      });
    expect(lot).toEqual({
      cancelledQuantity: 0,
      id: fixture.purchaseLotId,
      quantity: 2,
      redeemedQuantity: 0,
      refundAllocatedQuantity: 0,
      sourceTransactionId: fixture.registrationTransactionIds[0],
    });

    const sourceLinks = await database
      .select({
        accountId: registrationTransferRefundPlanItems.stripeAccountId,
        sourceAcquisitionId:
          registrationTransferRefundPlanAcquisitionLinks.sourceAcquisitionId,
        sourceAcquisitionPaymentId:
          registrationTransferRefundPlanAcquisitionLinks.sourceAcquisitionPaymentId,
        sourceTransactionId:
          registrationTransferRefundPlanItems.sourceTransactionId,
      })
      .from(registrationTransferRefundPlanAcquisitionLinks)
      .innerJoin(
        registrationTransferRefundPlanItems,
        eq(
          registrationTransferRefundPlanItems.id,
          registrationTransferRefundPlanAcquisitionLinks.planItemId,
        ),
      )
      .where(
        eq(
          registrationTransferRefundPlanAcquisitionLinks.tenantId,
          fixture.tenantId,
        ),
      )
      .orderBy(asc(registrationTransferRefundPlanItems.createdAt));
    expect(sourceLinks).toEqual([
      {
        accountId: 'acct_historical_source',
        sourceAcquisitionId: fixture.acquisitionIds[0],
        sourceAcquisitionPaymentId: fixture.acquisitionPaymentIds[0],
        sourceTransactionId: fixture.registrationTransactionIds[0],
      },
      {
        accountId: 'acct_first_recipient',
        sourceAcquisitionId: fixture.acquisitionIds[1],
        sourceAcquisitionPaymentId: fixture.acquisitionPaymentIds[1],
        sourceTransactionId: fixture.registrationTransactionIds[1],
      },
    ]);

    await expect(
      database.insert(registrationAcquisitionPayments).values({
        acquisitionId: fixture.acquisitionIds[2],
        attachedAt: new Date(),
        eventId: fixture.eventId,
        registrationId: fixture.registrationId,
        tenantId: fixture.tenantId,
        transactionId: fixture.registrationTransactionIds[0],
      }),
    ).rejects.toThrow();
  });

  it('finalizes a paid repeat transfer into one new acquisition without rewriting lot history', async () => {
    const fixture = await seedAcquisitionFixture(database, layer);
    fixtures.push(fixture);
    const {
      finalize,
      lotBefore,
      recipientUserId,
      sourceTransactionId,
      sourceUserId,
      transferId,
    } = await seedPaidRepeatTransferCheckout(database, layer, fixture);
    expect(await finalize()).toBe('finalized');
    expect(await finalize()).toBe('alreadyFinalized');

    const [registration, acquisitions, acquiredComponents, lotAfter, refunds] =
      await Promise.all([
        database.query.eventRegistrations.findFirst({
          columns: {
            checkedInGuestCount: true,
            checkInTime: true,
            guestCount: true,
            id: true,
            userId: true,
          },
          where: { id: fixture.registrationId },
        }),
        database
          .select({
            id: registrationAcquisitions.id,
            ordinal: registrationAcquisitions.ordinal,
            ownerUserId: registrationAcquisitions.ownerUserId,
            previousAcquisitionId:
              registrationAcquisitions.previousAcquisitionId,
            transferId: registrationAcquisitions.transferId,
          })
          .from(registrationAcquisitions)
          .where(
            and(
              eq(registrationAcquisitions.tenantId, fixture.tenantId),
              eq(
                registrationAcquisitions.registrationId,
                fixture.registrationId,
              ),
            ),
          )
          .orderBy(asc(registrationAcquisitions.ordinal)),
        database
          .select({
            acquisitionId: registrationAcquisitionComponents.acquisitionId,
            acquisitionPaymentId:
              registrationAcquisitionComponents.acquisitionPaymentId,
            baseAmount: registrationAcquisitionComponents.baseAmount,
            grossAmount: registrationAcquisitionComponents.grossAmount,
            kind: registrationAcquisitionComponents.kind,
            purchaseLotId: registrationAcquisitionComponents.purchaseLotId,
            quantity: registrationAcquisitionComponents.quantity,
          })
          .from(registrationAcquisitionComponents)
          .innerJoin(
            registrationAcquisitions,
            eq(
              registrationAcquisitions.id,
              registrationAcquisitionComponents.acquisitionId,
            ),
          )
          .where(eq(registrationAcquisitions.transferId, transferId))
          .orderBy(asc(registrationAcquisitionComponents.kind)),
        database.query.eventRegistrationAddonPurchaseLots.findFirst({
          where: { id: fixture.purchaseLotId },
        }),
        database.query.transactions.findMany({
          where: {
            sourceTransactionId,
            tenantId: fixture.tenantId,
            type: 'refund',
          },
        }),
      ]);
    expect(registration).toMatchObject({
      checkedInGuestCount: 1,
      guestCount: 1,
      id: fixture.registrationId,
      userId: recipientUserId,
    });
    expect(registration?.checkInTime).not.toBeNull();
    const finalAcquisition = requireValue(
      acquisitions.at(-1),
      'finalized repeat-transfer acquisition',
    );
    expect(finalAcquisition).toMatchObject({
      ordinal: 3,
      ownerUserId: recipientUserId,
      previousAcquisitionId: fixture.acquisitionIds[2],
      transferId,
    });
    expect(acquisitions).toHaveLength(4);
    expect(acquiredComponents).toEqual([
      expect.objectContaining({
        acquisitionId: finalAcquisition.id,
        baseAmount: 1200,
        grossAmount: 1200,
        kind: 'registration',
        purchaseLotId: null,
        quantity: 2,
      }),
      expect.objectContaining({
        acquisitionId: finalAcquisition.id,
        baseAmount: 400,
        grossAmount: 400,
        kind: 'addon_lot',
        purchaseLotId: fixture.purchaseLotId,
        quantity: 2,
      }),
    ]);
    expect(lotAfter).toEqual(lotBefore);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      amount: -1400,
      sourceTransactionId,
      status: 'pending',
      stripeAccountId: 'acct_current_second_recipient',
      targetUserId: sourceUserId,
      type: 'refund',
    });
  });

  it('compensates exactly once when a current acquisition payment is missing its refund-plan link', async () => {
    const fixture = await seedAcquisitionFixture(database, layer);
    fixtures.push(fixture);
    const {
      finalize,
      planItemId,
      recipientTransactionId,
      sourceTransactionId,
      sourceUserId,
      transferId,
    } = await seedPaidRepeatTransferCheckout(database, layer, fixture, {
      linkRefundPlan: false,
    });
    const sourcePaymentsBefore = await database
      .select({
        acquisitionId: registrationAcquisitionPayments.acquisitionId,
        id: registrationAcquisitionPayments.id,
        transactionId: registrationAcquisitionPayments.transactionId,
      })
      .from(registrationAcquisitionPayments)
      .where(
        eq(
          registrationAcquisitionPayments.acquisitionId,
          fixture.acquisitionIds[2],
        ),
      );

    expect(await finalize()).toBe('compensationQueued');
    expect(await finalize()).toBe('alreadyFinalized');

    const [
      registration,
      transfer,
      acquisitions,
      sourcePaymentsAfter,
      sourcePlan,
      recipientPayment,
      sourceRefunds,
      compensationClaims,
    ] = await Promise.all([
      database.query.eventRegistrations.findFirst({
        columns: { userId: true },
        where: { id: fixture.registrationId },
      }),
      database.query.registrationTransfers.findFirst({
        columns: {
          compensationRefundTransactionId: true,
          status: true,
        },
        where: { id: transferId },
      }),
      database
        .select({
          id: registrationAcquisitions.id,
          ordinal: registrationAcquisitions.ordinal,
          ownerUserId: registrationAcquisitions.ownerUserId,
          transferId: registrationAcquisitions.transferId,
        })
        .from(registrationAcquisitions)
        .where(
          and(
            eq(registrationAcquisitions.tenantId, fixture.tenantId),
            eq(registrationAcquisitions.registrationId, fixture.registrationId),
          ),
        )
        .orderBy(asc(registrationAcquisitions.ordinal)),
      database
        .select({
          acquisitionId: registrationAcquisitionPayments.acquisitionId,
          id: registrationAcquisitionPayments.id,
          transactionId: registrationAcquisitionPayments.transactionId,
        })
        .from(registrationAcquisitionPayments)
        .where(
          eq(
            registrationAcquisitionPayments.acquisitionId,
            fixture.acquisitionIds[2],
          ),
        ),
      database.query.registrationTransferRefundPlanItems.findFirst({
        columns: { refundTransactionId: true },
        where: { id: planItemId },
      }),
      database.query.transactions.findFirst({
        columns: { amount: true, status: true, type: true },
        where: { id: recipientTransactionId },
      }),
      database.query.transactions.findMany({
        where: {
          sourceTransactionId,
          tenantId: fixture.tenantId,
          type: 'refund',
        },
      }),
      database.query.transactions.findMany({
        where: {
          sourceTransactionId: recipientTransactionId,
          tenantId: fixture.tenantId,
          type: 'refund',
        },
      }),
    ]);

    expect(registration).toEqual({ userId: sourceUserId });
    expect(acquisitions).toHaveLength(3);
    expect(acquisitions.at(-1)).toMatchObject({
      id: fixture.acquisitionIds[2],
      ordinal: 2,
      ownerUserId: sourceUserId,
      transferId: fixture.transferIds[1],
    });
    expect(sourcePaymentsAfter).toEqual(sourcePaymentsBefore);
    expect(sourcePlan).toEqual({ refundTransactionId: null });
    expect(recipientPayment).toEqual({
      amount: 1600,
      status: 'successful',
      type: 'registration',
    });
    expect(sourceRefunds).toEqual([]);
    expect(compensationClaims).toHaveLength(1);
    expect(compensationClaims[0]).toMatchObject({
      amount: -1600,
      sourceTransactionId: recipientTransactionId,
      status: 'pending',
      stripeAccountId: 'acct_current_second_recipient',
      type: 'refund',
    });
    expect(transfer).toEqual({
      compensationRefundTransactionId: compensationClaims[0]?.id,
      status: 'compensation_pending',
    });
  });

  it('serializes concurrent add-on cancellation retries into one current-owner refund', async () => {
    const fixture = await seedAcquisitionFixture(database, layer, {
      addonQuantity: 3,
      priorCancelledQuantity: 1,
      priorRedeemedQuantity: 1,
    });
    fixtures.push(fixture);
    const operationKey = `addon-cancel:${fixture.purchaseId}:current-owner`;
    const currentComponentBefore = requireValue(
      await database.query.registrationAcquisitionComponents.findFirst({
        where: { id: fixture.addonComponentIds[2] },
      }),
      'current acquisition component before cancellation',
    );
    const finalSlotAmounts = requireValue(
      allocateAcquisitionComponentQuantity({
        alreadyAllocatedQuantity: 2,
        component: currentComponentBefore,
        quantity: 1,
      }),
      'final acquisition component quantity slot',
    );
    const cancel = () =>
      Effect.runPromise(
        cancelRegistrationAddon({
          actorUserId: fixture.ownerUserIds[2],
          operationKey,
          quantity: 1,
          reason: 'Refund one acquired unit',
          refundRequested: true,
          registrationAddonId: fixture.purchaseId,
          registrationId: fixture.registrationId,
          tenantId: fixture.tenantId,
        }).pipe(Effect.provide(layer)),
      );

    const concurrentResults = await Promise.all([cancel(), cancel()]);
    expect(concurrentResults[0]).toEqual(concurrentResults[1]);
    expect(concurrentResults[0]?.refundStatus).toBe('pending');
    expect(await cancel()).toEqual(concurrentResults[0]);
    const fulfillmentEventId = requireValue(
      concurrentResults[0]?.fulfillmentEventId,
      'add-on cancellation event',
    );

    const allocations = await database
      .select({
        acquisitionId: registrationAcquisitionRefundAllocations.acquisitionId,
        acquisitionPaymentId:
          registrationAcquisitionRefundAllocations.acquisitionPaymentId,
        applicationFeeAmount:
          registrationAcquisitionRefundAllocations.applicationFeeAmount,
        applicationFeeRefunded:
          registrationAcquisitionRefundAllocations.applicationFeeRefunded,
        componentId: registrationAcquisitionRefundAllocations.componentId,
        grossEntitlementAmount:
          registrationAcquisitionRefundAllocations.grossEntitlementAmount,
        netEntitlementAmount:
          registrationAcquisitionRefundAllocations.netEntitlementAmount,
        operationKey: registrationAcquisitionRefundAllocations.operationKey,
        quantity: registrationAcquisitionRefundAllocations.quantity,
        refundAmount: registrationAcquisitionRefundAllocations.refundAmount,
        refundTransactionId:
          registrationAcquisitionRefundAllocations.refundTransactionId,
        stripeFeeAmount:
          registrationAcquisitionRefundAllocations.stripeFeeAmount,
      })
      .from(registrationAcquisitionRefundAllocations)
      .where(
        and(
          eq(
            registrationAcquisitionRefundAllocations.tenantId,
            fixture.tenantId,
          ),
          eq(
            registrationAcquisitionRefundAllocations.componentId,
            fixture.addonComponentIds[2],
          ),
        ),
      );
    expect(allocations).toEqual([
      {
        acquisitionId: fixture.acquisitionIds[2],
        acquisitionPaymentId: fixture.acquisitionPaymentIds[2],
        applicationFeeAmount: finalSlotAmounts.applicationFeeAmount,
        applicationFeeRefunded: true,
        componentId: fixture.addonComponentIds[2],
        grossEntitlementAmount: finalSlotAmounts.grossAmount,
        netEntitlementAmount: finalSlotAmounts.netAmount,
        operationKey: `addon-cancel:${fulfillmentEventId}:${fixture.addonComponentIds[2]}`,
        quantity: 1,
        refundAmount: finalSlotAmounts.grossAmount,
        refundTransactionId: expect.any(String),
        stripeFeeAmount: finalSlotAmounts.stripeFeeAmount,
      },
    ]);

    const [purchase, lot, addOn, events, refundClaims] = await Promise.all([
      database.query.eventRegistrationAddonPurchases.findFirst({
        columns: { cancelledQuantity: true, redeemedQuantity: true },
        where: { id: fixture.purchaseId },
      }),
      database.query.eventRegistrationAddonPurchaseLots.findFirst({
        columns: {
          cancelledQuantity: true,
          id: true,
          redeemedQuantity: true,
          refundAllocatedQuantity: true,
          sourceTransactionId: true,
        },
        where: { id: fixture.purchaseLotId },
      }),
      database.query.eventAddons.findFirst({
        columns: { totalAvailableQuantity: true },
        where: { id: fixture.addonId },
      }),
      database
        .select({ id: eventRegistrationAddonFulfillmentEvents.id })
        .from(eventRegistrationAddonFulfillmentEvents)
        .where(
          and(
            eq(
              eventRegistrationAddonFulfillmentEvents.purchaseId,
              fixture.purchaseId,
            ),
            eq(
              eventRegistrationAddonFulfillmentEvents.operationKey,
              operationKey,
            ),
          ),
        ),
      database.query.transactions.findMany({
        where: {
          sourceTransactionId: fixture.registrationTransactionIds[2],
          tenantId: fixture.tenantId,
          type: 'refund',
        },
      }),
    ]);
    expect(purchase).toEqual({ cancelledQuantity: 2, redeemedQuantity: 1 });
    expect(lot).toEqual({
      cancelledQuantity: 2,
      id: fixture.purchaseLotId,
      redeemedQuantity: 1,
      refundAllocatedQuantity: 0,
      sourceTransactionId: fixture.registrationTransactionIds[0],
    });
    expect(addOn).toEqual({ totalAvailableQuantity: 2 });
    expect(events).toEqual([{ id: fulfillmentEventId }]);
    expect(refundClaims).toHaveLength(1);
    expect(refundClaims[0]).toMatchObject({
      amount: -finalSlotAmounts.grossAmount,
      sourceTransactionId: fixture.registrationTransactionIds[2],
      status: 'pending',
      stripeAccountId: 'acct_current_second_recipient',
      stripeRefundApplicationFee: true,
      targetUserId: fixture.ownerUserIds[2],
      type: 'refund',
    });

    const currentComponentAfter = requireValue(
      await database.query.registrationAcquisitionComponents.findFirst({
        columns: {
          grossAmount: true,
          id: true,
          purchaseLotId: true,
          quantity: true,
        },
        where: { id: fixture.addonComponentIds[2] },
      }),
      'current acquisition component',
    );
    expect(currentComponentAfter).toEqual({
      grossAmount: 450,
      id: fixture.addonComponentIds[2],
      purchaseLotId: fixture.purchaseLotId,
      quantity: 3,
    });
    expect(finalSlotAmounts).toEqual({
      applicationFeeAmount: 0,
      grossAmount: 150,
      netAmount: 148,
      stripeFeeAmount: 2,
    });
    expect(
      allocateAcquisitionComponentQuantity({
        alreadyAllocatedQuantity: 0,
        component: currentComponentBefore,
        quantity: 1,
      }),
    ).toEqual({
      applicationFeeAmount: 1,
      grossAmount: 150,
      netAmount: 147,
      stripeFeeAmount: 2,
    });
  });
});
