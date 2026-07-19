import type { DatabaseClient } from '@db/index';

import {
  eventInstances,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrationQuestionAnswers,
  eventRegistrations,
  registrationAcquisitionPayments,
  registrationAcquisitions,
  registrationTransferAnswers,
  registrationTransferBundleAddonPurchaseLots,
  registrationTransferBundleAddonPurchases,
  registrationTransferEvents,
  registrationTransferRefundPlanAcquisitionLinks,
  registrationTransferRefundPlanItems,
  registrationTransfers,
  rolesToTenantUsers,
  tenants,
  transactions,
  users,
  usersToTenants,
} from '@db/schema';
import { registrationTransferAddonAllocationKey } from '@shared/registration-transfer';
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  not,
  sql,
} from 'drizzle-orm';
import { Effect } from 'effect';

import { isUserEligibleForRegistrationOption } from '../effect/rpc/handlers/events/event-registration.service';
import { enqueueRegistrationTransferredEmail } from '../notifications/email-delivery';
import { createRegistrationRefundClaim } from '../payments/registration-refund';
import {
  type AcquisitionComponentTerm,
  establishRegistrationAcquisition,
  settleAcquisitionComponentTerms,
} from './registration-acquisition-write';
import { resolveRegistrationTransferPriorRefunds } from './registration-transfer-prior-refunds';
import { refundPlansExactlyCoverCurrentAcquisitionPayments } from './registration-transfer-refund-plan-coverage';

export interface ExpiredRegistrationTransferCheckoutCandidate {
  readonly registrationId: string;
  readonly stripeAccountId: null | string;
  readonly stripeCheckoutSessionId: null | string;
  readonly tenantId: string;
  readonly transactionId: string;
  readonly transferId: string;
}

export type RegistrationTransferCheckoutExpiryStatus =
  'alreadyExpired' | 'expired' | 'notTransfer';

export type RegistrationTransferCheckoutFinalizationStatus =
  'alreadyFinalized' | 'compensationQueued' | 'finalized' | 'notTransfer';

interface RegistrationTransferCheckoutIdentity {
  readonly registrationId: string;
  readonly tenantId: string;
  readonly transactionId: string;
}

type RegistrationTransferTransaction = Pick<
  DatabaseClient,
  'delete' | 'insert' | 'select' | 'update'
>;

export const expiredRegistrationTransferCheckoutCandidatePredicate = (
  nowEpochSeconds: number,
) =>
  and(
    eq(registrationTransfers.status, 'checkout_pending'),
    isNotNull(registrationTransfers.recipientCheckoutTransactionId),
    isNotNull(registrationTransfers.recipientRegistrationId),
    eq(transactions.method, 'stripe'),
    eq(transactions.status, 'pending'),
    eq(transactions.type, 'registration'),
    isNotNull(transactions.stripeCheckoutRequest),
    isNull(transactions.stripeCheckoutSessionId),
    sql<boolean>`jsonb_path_exists(
      ${transactions.stripeCheckoutRequest},
      '$.expiresAt ? (@.type() == "number" && @ <= $deadline)'::jsonpath,
      jsonb_build_object('deadline', ${nowEpochSeconds}::bigint)
    )`,
  );

export const selectExpiredRegistrationTransferCheckoutCandidates = Effect.fn(
  'selectExpiredRegistrationTransferCheckoutCandidates',
)(function* (
  database: Pick<DatabaseClient, 'select'>,
  input: {
    readonly limit: number;
    readonly nowEpochSeconds: number;
  },
) {
  const rows = yield* database
    .select({
      registrationId: registrationTransfers.recipientRegistrationId,
      stripeAccountId: transactions.stripeAccountId,
      stripeCheckoutSessionId: transactions.stripeCheckoutSessionId,
      tenantId: registrationTransfers.tenantId,
      transactionId: transactions.id,
      transferId: registrationTransfers.id,
    })
    .from(registrationTransfers)
    .innerJoin(
      transactions,
      and(
        eq(
          transactions.id,
          registrationTransfers.recipientCheckoutTransactionId,
        ),
        eq(transactions.tenantId, registrationTransfers.tenantId),
      ),
    )
    .where(
      expiredRegistrationTransferCheckoutCandidatePredicate(
        input.nowEpochSeconds,
      ),
    )
    .orderBy(asc(transactions.createdAt), asc(transactions.id))
    .limit(input.limit);

  return rows.flatMap((row) =>
    row.registrationId
      ? [
          {
            ...row,
            registrationId: row.registrationId,
          } satisfies ExpiredRegistrationTransferCheckoutCandidate,
        ]
      : [],
  );
});

const transferInvariant = (message: string) => Effect.die(new Error(message));

interface TransferCompensationState {
  readonly eventId: string;
  readonly id: string;
  readonly recipientRegistrationId: string;
  readonly recipientUserId: string;
}

interface TransferPayment {
  readonly amount: number;
  readonly appFee: number;
  readonly currency: typeof transactions.$inferSelect.currency;
  readonly request: NonNullable<
    typeof transactions.$inferSelect.stripeCheckoutRequest
  >;
  readonly stripeAccountId: string;
  readonly stripeChargeId: string;
  readonly stripeFee: number;
  readonly stripeNetAmount: number;
  readonly stripePaymentIntentId: string;
}

const compensateRegistrationTransferRecipient = Effect.fn(
  'compensateRegistrationTransferRecipient',
)(function* (
  tx: RegistrationTransferTransaction,
  input: RegistrationTransferCheckoutIdentity & {
    readonly payment: TransferPayment;
    readonly reason: string;
    readonly transfer: TransferCompensationState;
  },
) {
  if (input.payment.amount <= 0 || !Number.isInteger(input.payment.amount)) {
    return yield* transferInvariant(
      'Paid transfer compensation is missing recipient payment ownership',
    );
  }

  const compensationClaim = yield* createRegistrationRefundClaim(tx, {
    amount: input.payment.amount,
    applicationFeeRefunded: true,
    currency: input.payment.currency,
    eventId: input.transfer.eventId,
    eventRegistrationId: input.transfer.recipientRegistrationId,
    operationKey: `registration-transfer-compensation:${input.transfer.id}`,
    sourceTransactionId: input.transactionId,
    stripeAccountId: input.payment.stripeAccountId,
    targetUserId: input.transfer.recipientUserId,
    tenantId: input.tenantId,
  });
  const compensationStartedAt = new Date();
  const compensatedTransfers = yield* tx
    .update(registrationTransfers)
    .set({
      compensationRefundTransactionId: compensationClaim.id,
      compensationStartedAt,
      lastError: input.reason,
      reservedAdditionalSpots: 0,
      status: 'compensation_pending',
    })
    .where(
      and(
        eq(registrationTransfers.id, input.transfer.id),
        eq(registrationTransfers.status, 'checkout_pending'),
        eq(registrationTransfers.tenantId, input.tenantId),
      ),
    )
    .returning({ id: registrationTransfers.id });
  if (compensatedTransfers.length !== 1) {
    return yield* transferInvariant(
      'Paid transfer compensation state changed before its refund was attached',
    );
  }
  yield* tx.insert(registrationTransferEvents).values({
    actorUserId: input.transfer.recipientUserId,
    eventType: 'compensation_queued',
    fromStatus: 'checkout_pending',
    reason: input.reason,
    tenantId: input.tenantId,
    toStatus: 'compensation_pending',
    transferId: input.transfer.id,
  });
  return 'compensationQueued' as const;
});

const bundleSnapshotMatches = (
  snapshot: {
    readonly addonId: string;
    readonly cancelledQuantity: number;
    readonly id: string;
    readonly includedQuantity: number;
    readonly purchasedQuantity: number;
    readonly quantity: number;
    readonly redeemedQuantity: number;
    readonly refundAllocatedPurchasedQuantity: number;
    readonly taxRateDisplayName: null | string;
    readonly taxRateInclusive: boolean | null;
    readonly taxRatePercentage: null | string;
    readonly unitPrice: number;
  },
  current: {
    readonly addonId: string;
    readonly cancelledQuantity: number;
    readonly id: string;
    readonly includedQuantity: number;
    readonly purchasedQuantity: number;
    readonly quantity: number;
    readonly redeemedQuantity: number;
    readonly refundAllocatedPurchasedQuantity: number;
    readonly taxRateDisplayName: null | string;
    readonly taxRateInclusive: boolean | null;
    readonly taxRatePercentage: null | string;
    readonly unitPrice: number;
  },
): boolean =>
  snapshot.id === current.id &&
  snapshot.addonId === current.addonId &&
  snapshot.quantity === current.quantity &&
  snapshot.includedQuantity === current.includedQuantity &&
  snapshot.purchasedQuantity === current.purchasedQuantity &&
  snapshot.redeemedQuantity === current.redeemedQuantity &&
  snapshot.cancelledQuantity === current.cancelledQuantity &&
  snapshot.refundAllocatedPurchasedQuantity ===
    current.refundAllocatedPurchasedQuantity &&
  snapshot.unitPrice === current.unitPrice &&
  snapshot.taxRateDisplayName === current.taxRateDisplayName &&
  snapshot.taxRateInclusive === current.taxRateInclusive &&
  snapshot.taxRatePercentage === current.taxRatePercentage;

export const finalizeRegistrationTransferCheckout = Effect.fn(
  'finalizeRegistrationTransferCheckout',
)(function* (
  tx: RegistrationTransferTransaction,
  input: RegistrationTransferCheckoutIdentity,
) {
  const identityRows = yield* tx
    .select({
      id: registrationTransfers.id,
      sourceRegistrationId: registrationTransfers.sourceRegistrationId,
    })
    .from(registrationTransfers)
    .where(
      and(
        eq(
          registrationTransfers.recipientCheckoutTransactionId,
          input.transactionId,
        ),
        eq(registrationTransfers.recipientRegistrationId, input.registrationId),
        eq(registrationTransfers.tenantId, input.tenantId),
      ),
    )
    .limit(1);
  const identity = identityRows[0];
  if (!identity) return 'notTransfer' as const;

  const registrationRows = yield* tx
    .select({
      eventId: eventRegistrations.eventId,
      guestCount: eventRegistrations.guestCount,
      registrationOptionId: eventRegistrations.registrationOptionId,
      status: eventRegistrations.status,
      userId: eventRegistrations.userId,
    })
    .from(eventRegistrations)
    .where(
      and(
        eq(eventRegistrations.id, identity.sourceRegistrationId),
        eq(eventRegistrations.tenantId, input.tenantId),
      ),
    )
    .for('update');
  const registration = registrationRows[0];

  const transferRows = yield* tx
    .select({
      eventId: registrationTransfers.eventId,
      id: registrationTransfers.id,
      recipientAppliedDiscountedPrice:
        registrationTransfers.recipientAppliedDiscountedPrice,
      recipientAppliedDiscountType:
        registrationTransfers.recipientAppliedDiscountType,
      recipientBasePrice: registrationTransfers.recipientBasePrice,
      recipientDiscountAmount: registrationTransfers.recipientDiscountAmount,
      recipientRegistrationId: registrationTransfers.recipientRegistrationId,
      recipientSpotCount: registrationTransfers.recipientSpotCount,
      recipientStripeTaxRateId: registrationTransfers.recipientStripeTaxRateId,
      recipientTaxRateDisplayName:
        registrationTransfers.recipientTaxRateDisplayName,
      recipientTaxRateInclusive:
        registrationTransfers.recipientTaxRateInclusive,
      recipientTaxRatePercentage:
        registrationTransfers.recipientTaxRatePercentage,
      recipientUserId: registrationTransfers.recipientUserId,
      registrationOptionId: registrationTransfers.registrationOptionId,
      sourceRegistrationId: registrationTransfers.sourceRegistrationId,
      sourceSpotCount: registrationTransfers.sourceSpotCount,
      sourceUserId: registrationTransfers.sourceUserId,
      status: registrationTransfers.status,
    })
    .from(registrationTransfers)
    .where(
      and(
        eq(registrationTransfers.id, identity.id),
        eq(
          registrationTransfers.recipientCheckoutTransactionId,
          input.transactionId,
        ),
        eq(registrationTransfers.tenantId, input.tenantId),
      ),
    )
    .for('update');
  const transfer = transferRows[0];
  if (!transfer) return 'notTransfer' as const;
  if (
    transfer.status === 'completed' ||
    transfer.status === 'compensated' ||
    transfer.status === 'compensation_failed' ||
    transfer.status === 'compensation_pending' ||
    transfer.status === 'refund_failed' ||
    transfer.status === 'refund_pending'
  ) {
    return 'alreadyFinalized' as const;
  }
  if (
    transfer.status !== 'checkout_pending' ||
    !transfer.recipientRegistrationId ||
    !transfer.recipientSpotCount ||
    !transfer.recipientUserId ||
    transfer.recipientBasePrice === null ||
    transfer.recipientRegistrationId !== transfer.sourceRegistrationId
  ) {
    return 'notTransfer' as const;
  }
  const recipientRegistrationId = transfer.recipientRegistrationId;
  const recipientUserId = transfer.recipientUserId;

  const acquisitionRows = yield* tx
    .select({
      eventId: registrationAcquisitions.eventId,
      id: registrationAcquisitions.id,
      ordinal: registrationAcquisitions.ordinal,
      ownerUserId: registrationAcquisitions.ownerUserId,
    })
    .from(registrationAcquisitions)
    .where(
      and(
        eq(
          registrationAcquisitions.registrationId,
          transfer.sourceRegistrationId,
        ),
        eq(registrationAcquisitions.tenantId, input.tenantId),
      ),
    )
    .orderBy(sql`${registrationAcquisitions.ordinal} DESC`)
    .limit(1)
    .for('update');
  const currentAcquisition = acquisitionRows[0];
  if (
    !currentAcquisition ||
    currentAcquisition.eventId !== transfer.eventId ||
    currentAcquisition.ownerUserId !== transfer.sourceUserId
  ) {
    return yield* transferInvariant(
      'Transfer source acquisition does not match the current registration owner',
    );
  }

  const paymentRows = yield* tx
    .select({
      amount: transactions.amount,
      appFee: transactions.appFee,
      currency: transactions.currency,
      request: transactions.stripeCheckoutRequest,
      stripeAccountId: transactions.stripeAccountId,
      stripeChargeId: transactions.stripeChargeId,
      stripeFee: transactions.stripeFee,
      stripeNetAmount: transactions.stripeNetAmount,
      stripePaymentIntentId: transactions.stripePaymentIntentId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.id, input.transactionId),
        eq(transactions.eventRegistrationId, input.registrationId),
        eq(transactions.method, 'stripe'),
        eq(transactions.status, 'successful'),
        eq(transactions.targetUserId, recipientUserId),
        eq(transactions.tenantId, input.tenantId),
        eq(transactions.type, 'registration'),
      ),
    )
    .for('update');
  const paymentRow = paymentRows[0];
  if (
    !paymentRow?.request ||
    !paymentRow.stripeAccountId ||
    !paymentRow.stripeChargeId ||
    !paymentRow.stripePaymentIntentId ||
    paymentRow.appFee === null ||
    paymentRow.stripeFee === null ||
    paymentRow.stripeNetAmount === null ||
    paymentRow.stripeNetAmount + paymentRow.stripeFee + paymentRow.appFee !==
      paymentRow.amount
  ) {
    return yield* transferInvariant(
      'Successful transfer Checkout is missing its immutable payment snapshot',
    );
  }
  const payment: TransferPayment = {
    amount: paymentRow.amount,
    appFee: paymentRow.appFee,
    currency: paymentRow.currency,
    request: paymentRow.request,
    stripeAccountId: paymentRow.stripeAccountId,
    stripeChargeId: paymentRow.stripeChargeId,
    stripeFee: paymentRow.stripeFee,
    stripeNetAmount: paymentRow.stripeNetAmount,
    stripePaymentIntentId: paymentRow.stripePaymentIntentId,
  };
  const compensate = (reason: string) =>
    compensateRegistrationTransferRecipient(tx, {
      payment,
      reason,
      registrationId: input.registrationId,
      tenantId: input.tenantId,
      transactionId: input.transactionId,
      transfer: {
        eventId: transfer.eventId,
        id: transfer.id,
        recipientRegistrationId,
        recipientUserId,
      },
    });

  if (
    !registration ||
    registration.status !== 'CONFIRMED' ||
    registration.userId !== transfer.sourceUserId ||
    registration.eventId !== transfer.eventId ||
    registration.registrationOptionId !== transfer.registrationOptionId ||
    registration.guestCount + 1 !== transfer.sourceSpotCount ||
    transfer.recipientSpotCount !== transfer.sourceSpotCount
  ) {
    return yield* compensate(
      'Transfer source ownership changed after recipient payment; a full recipient refund was queued.',
    );
  }

  const recipientMemberships = yield* tx
    .select({ id: usersToTenants.id })
    .from(usersToTenants)
    .where(
      and(
        eq(usersToTenants.tenantId, input.tenantId),
        eq(usersToTenants.userId, recipientUserId),
      ),
    )
    .for('update');
  const recipientMembership = recipientMemberships[0];
  if (recipientMemberships.length !== 1 || !recipientMembership) {
    return yield* compensate(
      'Recipient eligibility changed after payment; a full recipient refund was queued.',
    );
  }

  const recipientRoleAssignments = yield* tx
    .select({ roleId: rolesToTenantUsers.roleId })
    .from(rolesToTenantUsers)
    .where(
      and(
        eq(rolesToTenantUsers.tenantId, input.tenantId),
        eq(rolesToTenantUsers.userTenantId, recipientMembership.id),
      ),
    )
    .for('update');
  const registrationOptions = yield* tx
    .select({ roleIds: eventRegistrationOptions.roleIds })
    .from(eventRegistrationOptions)
    .where(
      and(
        eq(eventRegistrationOptions.id, transfer.registrationOptionId),
        eq(eventRegistrationOptions.eventId, transfer.eventId),
      ),
    )
    .for('update');
  const registrationOption = registrationOptions[0];
  if (
    registrationOptions.length !== 1 ||
    !registrationOption ||
    !isUserEligibleForRegistrationOption({
      optionRoleIds: registrationOption.roleIds,
      userRoleIds: recipientRoleAssignments.map(
        (assignment) => assignment.roleId,
      ),
    })
  ) {
    return yield* compensate(
      'Recipient eligibility changed after payment; a full recipient refund was queued.',
    );
  }

  const tenantSettings = yield* tx
    .select({
      maxActiveRegistrationsPerUser: tenants.maxActiveRegistrationsPerUser,
    })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  const maxActiveRegistrationsPerUser = Math.max(
    0,
    Math.trunc(tenantSettings[0]?.maxActiveRegistrationsPerUser ?? 0),
  );
  if (maxActiveRegistrationsPerUser > 0) {
    const eligibilityCheckedAt = new Date();
    const activeFutureRegistrations = yield* tx
      .select({ id: eventRegistrations.id })
      .from(eventRegistrations)
      .innerJoin(
        eventInstances,
        eq(eventInstances.id, eventRegistrations.eventId),
      )
      .where(
        and(
          eq(eventRegistrations.tenantId, input.tenantId),
          eq(eventRegistrations.userId, recipientUserId),
          not(eq(eventRegistrations.status, 'CANCELLED')),
          sql`${eventInstances.start} > ${eligibilityCheckedAt}`,
        ),
      )
      .limit(maxActiveRegistrationsPerUser);
    if (activeFutureRegistrations.length >= maxActiveRegistrationsPerUser) {
      return yield* compensate(
        'Recipient eligibility changed after payment; a full recipient refund was queued.',
      );
    }
  }

  const recipientConflicts = yield* tx
    .select({ id: eventRegistrations.id })
    .from(eventRegistrations)
    .where(
      and(
        eq(eventRegistrations.eventId, transfer.eventId),
        eq(eventRegistrations.tenantId, input.tenantId),
        eq(eventRegistrations.userId, transfer.recipientUserId),
        not(eq(eventRegistrations.status, 'CANCELLED')),
        not(eq(eventRegistrations.id, transfer.sourceRegistrationId)),
      ),
    )
    .limit(1)
    .for('update');
  if (recipientConflicts.length > 0) {
    return yield* compensate(
      'Recipient eligibility changed after payment; a full recipient refund was queued.',
    );
  }

  const bundleSnapshots = yield* tx
    .select({
      addonId: registrationTransferBundleAddonPurchases.addonId,
      cancelledQuantity:
        registrationTransferBundleAddonPurchases.cancelledQuantity,
      id: registrationTransferBundleAddonPurchases.sourcePurchaseId,
      includedQuantity:
        registrationTransferBundleAddonPurchases.includedQuantity,
      purchasedQuantity:
        registrationTransferBundleAddonPurchases.purchasedQuantity,
      quantity: registrationTransferBundleAddonPurchases.quantity,
      recipientStripeTaxRateId:
        registrationTransferBundleAddonPurchases.recipientStripeTaxRateId,
      recipientTaxRateDisplayName:
        registrationTransferBundleAddonPurchases.recipientTaxRateDisplayName,
      recipientTaxRateInclusive:
        registrationTransferBundleAddonPurchases.recipientTaxRateInclusive,
      recipientTaxRatePercentage:
        registrationTransferBundleAddonPurchases.recipientTaxRatePercentage,
      recipientUnitPrice:
        registrationTransferBundleAddonPurchases.recipientUnitPrice,
      redeemedQuantity:
        registrationTransferBundleAddonPurchases.redeemedQuantity,
      refundAllocatedPurchasedQuantity:
        registrationTransferBundleAddonPurchases.refundAllocatedPurchasedQuantity,
      taxRateDisplayName:
        registrationTransferBundleAddonPurchases.taxRateDisplayName,
      taxRateInclusive:
        registrationTransferBundleAddonPurchases.taxRateInclusive,
      taxRatePercentage:
        registrationTransferBundleAddonPurchases.taxRatePercentage,
      unitPrice: registrationTransferBundleAddonPurchases.unitPrice,
    })
    .from(registrationTransferBundleAddonPurchases)
    .where(
      and(
        eq(registrationTransferBundleAddonPurchases.transferId, transfer.id),
        eq(registrationTransferBundleAddonPurchases.tenantId, input.tenantId),
      ),
    )
    .orderBy(registrationTransferBundleAddonPurchases.sourcePurchaseId)
    .for('update');
  const currentBundle = yield* tx
    .select({
      addonId: eventRegistrationAddonPurchases.addonId,
      cancelledQuantity: eventRegistrationAddonPurchases.cancelledQuantity,
      id: eventRegistrationAddonPurchases.id,
      includedQuantity: eventRegistrationAddonPurchases.includedQuantity,
      purchasedQuantity: eventRegistrationAddonPurchases.purchasedQuantity,
      quantity: eventRegistrationAddonPurchases.quantity,
      redeemedQuantity: eventRegistrationAddonPurchases.redeemedQuantity,
      refundAllocatedPurchasedQuantity:
        eventRegistrationAddonPurchases.refundAllocatedPurchasedQuantity,
      taxRateDisplayName: eventRegistrationAddonPurchases.taxRateDisplayName,
      taxRateInclusive: eventRegistrationAddonPurchases.taxRateInclusive,
      taxRatePercentage: eventRegistrationAddonPurchases.taxRatePercentage,
      unitPrice: eventRegistrationAddonPurchases.unitPrice,
    })
    .from(eventRegistrationAddonPurchases)
    .where(
      and(
        eq(
          eventRegistrationAddonPurchases.registrationId,
          transfer.sourceRegistrationId,
        ),
        eq(eventRegistrationAddonPurchases.tenantId, input.tenantId),
      ),
    )
    .orderBy(eventRegistrationAddonPurchases.id)
    .for('update');
  if (
    bundleSnapshots.length !== currentBundle.length ||
    bundleSnapshots.some((snapshot, index) => {
      const current = currentBundle[index];
      return !current || !bundleSnapshotMatches(snapshot, current);
    })
  ) {
    return yield* compensate(
      'The fixed transfer bundle changed after recipient payment; a full recipient refund was queued.',
    );
  }
  const bundleLotSnapshots = yield* tx
    .select({
      cancelledQuantity:
        registrationTransferBundleAddonPurchaseLots.cancelledQuantity,
      id: registrationTransferBundleAddonPurchaseLots.sourcePurchaseLotId,
      purchaseId: registrationTransferBundleAddonPurchaseLots.sourcePurchaseId,
      quantity: registrationTransferBundleAddonPurchaseLots.quantity,
      redeemedQuantity:
        registrationTransferBundleAddonPurchaseLots.redeemedQuantity,
      refundAllocatedQuantity:
        registrationTransferBundleAddonPurchaseLots.refundAllocatedQuantity,
      sourceTransactionId:
        registrationTransferBundleAddonPurchaseLots.sourceTransactionId,
    })
    .from(registrationTransferBundleAddonPurchaseLots)
    .where(
      and(
        eq(registrationTransferBundleAddonPurchaseLots.transferId, transfer.id),
        eq(
          registrationTransferBundleAddonPurchaseLots.tenantId,
          input.tenantId,
        ),
      ),
    )
    .orderBy(registrationTransferBundleAddonPurchaseLots.sourcePurchaseLotId)
    .for('update');
  const currentBundleLots =
    currentBundle.length === 0
      ? []
      : yield* tx
          .select({
            cancelledQuantity:
              eventRegistrationAddonPurchaseLots.cancelledQuantity,
            id: eventRegistrationAddonPurchaseLots.id,
            purchaseId: eventRegistrationAddonPurchaseLots.purchaseId,
            quantity: eventRegistrationAddonPurchaseLots.quantity,
            redeemedQuantity:
              eventRegistrationAddonPurchaseLots.redeemedQuantity,
            refundAllocatedQuantity:
              eventRegistrationAddonPurchaseLots.refundAllocatedQuantity,
            sourceTransactionId:
              eventRegistrationAddonPurchaseLots.sourceTransactionId,
          })
          .from(eventRegistrationAddonPurchaseLots)
          .where(
            and(
              inArray(
                eventRegistrationAddonPurchaseLots.purchaseId,
                currentBundle.map(({ id }) => id),
              ),
              eq(eventRegistrationAddonPurchaseLots.tenantId, input.tenantId),
            ),
          )
          .orderBy(eventRegistrationAddonPurchaseLots.id)
          .for('update');
  if (
    bundleLotSnapshots.length !== currentBundleLots.length ||
    bundleLotSnapshots.some((snapshot, index) => {
      const current = currentBundleLots[index];
      return (
        !current ||
        snapshot.id !== current.id ||
        snapshot.purchaseId !== current.purchaseId ||
        snapshot.quantity !== current.quantity ||
        snapshot.redeemedQuantity !== current.redeemedQuantity ||
        snapshot.cancelledQuantity !== current.cancelledQuantity ||
        snapshot.refundAllocatedQuantity !== current.refundAllocatedQuantity ||
        snapshot.sourceTransactionId !== current.sourceTransactionId
      );
    })
  ) {
    return yield* compensate(
      'The sealed transfer purchase-lot history changed after recipient payment; a full recipient refund was queued.',
    );
  }

  const checkoutLines = payment.request.lineItems;
  const checkoutBaseAmount = checkoutLines.reduce(
    (sum, line) => sum + line.unitAmount * line.quantity,
    0,
  );
  if (
    checkoutLines.some(
      (line) =>
        !Number.isSafeInteger(line.unitAmount) ||
        line.unitAmount <= 0 ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity <= 0,
    ) ||
    !Number.isSafeInteger(checkoutBaseAmount) ||
    checkoutBaseAmount !== payment.amount
  ) {
    return yield* compensate(
      'The recipient Checkout line amounts no longer match the sealed transfer payment; a full recipient refund was queued.',
    );
  }
  const addonCheckoutLines = checkoutLines.filter(
    (line) => line.kind === 'addon' || line.addonId !== undefined,
  );
  const componentTerms: AcquisitionComponentTerm[] = [];
  const registrationCheckoutLines = checkoutLines.filter(
    (line) => line.kind !== 'addon' && line.addonId === undefined,
  );
  componentTerms.push({
    allocationKey: 'registration',
    baseAmount: registrationCheckoutLines.reduce(
      (sum, line) => sum + line.unitAmount * line.quantity,
      0,
    ),
    id: 'registration',
    kind: 'registration',
    quantity: transfer.recipientSpotCount,
    taxRateDisplayName: transfer.recipientTaxRateDisplayName,
    taxRateInclusive: transfer.recipientTaxRateInclusive,
    taxRatePercentage: transfer.recipientTaxRatePercentage,
  });
  const acquiredAt = new Date();
  let expectedAddonLineCount = 0;
  for (const snapshot of bundleSnapshots) {
    const sourceLineKey = registrationTransferAddonAllocationKey(
      transfer.id,
      snapshot.id,
    );
    const matchingLines = addonCheckoutLines.filter(
      (line) => line.allocationKey === sourceLineKey,
    );
    const line = matchingLines[0];
    const recipientUnitPrice = snapshot.recipientUnitPrice;
    const expectsPaidLine =
      snapshot.purchasedQuantity > 0 &&
      recipientUnitPrice !== null &&
      recipientUnitPrice > 0;
    if (expectsPaidLine) expectedAddonLineCount += 1;
    if (
      (expectsPaidLine &&
        (matchingLines.length !== 1 ||
          !line ||
          line.kind !== 'addon' ||
          line.addonId !== snapshot.addonId ||
          line.quantity !== snapshot.purchasedQuantity ||
          line.unitAmount !== recipientUnitPrice ||
          (line.taxRateId ?? null) !== snapshot.recipientStripeTaxRateId)) ||
      (!expectsPaidLine && matchingLines.length > 0) ||
      recipientUnitPrice === null
    ) {
      return yield* compensate(
        'The recipient Checkout add-on terms no longer match the sealed transfer; a full recipient refund was queued.',
      );
    }
    const purchaseLots = currentBundleLots.filter(
      ({ purchaseId }) => purchaseId === snapshot.id,
    );
    if (
      purchaseLots.reduce((sum, lot) => sum + lot.quantity, 0) !==
      snapshot.purchasedQuantity
    ) {
      return yield* compensate(
        'The sealed transfer add-on lot quantities no longer match the purchase; a full recipient refund was queued.',
      );
    }
    for (const lot of purchaseLots) {
      componentTerms.push({
        allocationKey: `addon-lot:${lot.id}`,
        baseAmount: recipientUnitPrice * lot.quantity,
        id: `addon-lot:${lot.id}`,
        kind: 'addon_lot',
        purchaseId: lot.purchaseId,
        purchaseLotId: lot.id,
        quantity: lot.quantity,
        taxRateDisplayName: snapshot.recipientTaxRateDisplayName,
        taxRateInclusive: snapshot.recipientTaxRateInclusive,
        taxRatePercentage: snapshot.recipientTaxRatePercentage,
      });
    }
  }
  if (addonCheckoutLines.length !== expectedAddonLineCount) {
    return yield* compensate(
      'The recipient Checkout add-on bundle no longer matches the sealed transfer; a full recipient refund was queued.',
    );
  }
  const settledTerms = settleAcquisitionComponentTerms({
    payment: {
      applicationFeeAmount: payment.appFee,
      grossAmount: payment.amount,
      stripeFeeAmount: payment.stripeFee,
      stripeNetAmount: payment.stripeNetAmount,
    },
    terms: componentTerms,
  });
  if (!settledTerms) {
    return yield* compensate(
      'The recipient acquisition components do not exactly settle the successful payment; a full recipient refund was queued.',
    );
  }

  const currentAcquisitionPayments = yield* tx
    .select({
      id: registrationAcquisitionPayments.id,
      transactionId: registrationAcquisitionPayments.transactionId,
    })
    .from(registrationAcquisitionPayments)
    .where(
      and(
        eq(
          registrationAcquisitionPayments.acquisitionId,
          currentAcquisition.id,
        ),
        eq(registrationAcquisitionPayments.tenantId, input.tenantId),
      ),
    )
    .orderBy(registrationAcquisitionPayments.transactionId)
    .for('update');

  const refundPlans = yield* tx
    .select({
      applicationFeeRefunded:
        registrationTransferRefundPlanItems.applicationFeeRefunded,
      currency: registrationTransferRefundPlanItems.currency,
      id: registrationTransferRefundPlanItems.id,
      operationKey: registrationTransferRefundPlanItems.operationKey,
      originalAmount: registrationTransferRefundPlanItems.originalAmount,
      priorRefundedAmount:
        registrationTransferRefundPlanItems.priorRefundedAmount,
      refundAmountDue: registrationTransferRefundPlanItems.refundAmountDue,
      refundTransactionId:
        registrationTransferRefundPlanItems.refundTransactionId,
      sourceAcquisitionId:
        registrationTransferRefundPlanAcquisitionLinks.sourceAcquisitionId,
      sourceAcquisitionPaymentId:
        registrationTransferRefundPlanAcquisitionLinks.sourceAcquisitionPaymentId,
      sourceAmount: transactions.amount,
      sourceCurrency: transactions.currency,
      sourceEventId: transactions.eventId,
      sourceEventRegistrationId: transactions.eventRegistrationId,
      sourceMethod: transactions.method,
      sourceStatus: transactions.status,
      sourceStripeAccountId: transactions.stripeAccountId,
      sourceStripeChargeId: transactions.stripeChargeId,
      sourceStripePaymentIntentId: transactions.stripePaymentIntentId,
      sourceTargetUserId: transactions.targetUserId,
      sourceTransactionId:
        registrationTransferRefundPlanItems.sourceTransactionId,
      sourceTransactionType: transactions.type,
      stripeAccountId: registrationTransferRefundPlanItems.stripeAccountId,
    })
    .from(registrationTransferRefundPlanItems)
    .innerJoin(
      registrationTransferRefundPlanAcquisitionLinks,
      and(
        eq(
          registrationTransferRefundPlanAcquisitionLinks.planItemId,
          registrationTransferRefundPlanItems.id,
        ),
        eq(
          registrationTransferRefundPlanAcquisitionLinks.sourceTransactionId,
          registrationTransferRefundPlanItems.sourceTransactionId,
        ),
        eq(
          registrationTransferRefundPlanAcquisitionLinks.tenantId,
          registrationTransferRefundPlanItems.tenantId,
        ),
      ),
    )
    .innerJoin(
      registrationAcquisitionPayments,
      and(
        eq(
          registrationAcquisitionPayments.id,
          registrationTransferRefundPlanAcquisitionLinks.sourceAcquisitionPaymentId,
        ),
        eq(
          registrationAcquisitionPayments.acquisitionId,
          registrationTransferRefundPlanAcquisitionLinks.sourceAcquisitionId,
        ),
        eq(
          registrationAcquisitionPayments.transactionId,
          registrationTransferRefundPlanAcquisitionLinks.sourceTransactionId,
        ),
        eq(
          registrationAcquisitionPayments.tenantId,
          registrationTransferRefundPlanAcquisitionLinks.tenantId,
        ),
      ),
    )
    .innerJoin(
      transactions,
      and(
        eq(
          transactions.id,
          registrationTransferRefundPlanItems.sourceTransactionId,
        ),
        eq(transactions.tenantId, registrationTransferRefundPlanItems.tenantId),
      ),
    )
    .where(
      and(
        eq(registrationTransferRefundPlanItems.transferId, transfer.id),
        eq(registrationTransferRefundPlanItems.tenantId, input.tenantId),
      ),
    )
    .orderBy(registrationTransferRefundPlanItems.sourceTransactionId)
    .for('update');
  if (
    !refundPlansExactlyCoverCurrentAcquisitionPayments({
      currentAcquisitionId: currentAcquisition.id,
      currentPayments: currentAcquisitionPayments,
      refundPlans,
    })
  ) {
    return yield* compensate(
      'The source refund plan does not exactly cover the current acquisition payments; a full recipient refund was queued.',
    );
  }
  const sourceIds = refundPlans.map(
    ({ sourceTransactionId }) => sourceTransactionId,
  );
  const priorRefunds =
    sourceIds.length === 0
      ? []
      : yield* tx
          .select({
            amount: transactions.amount,
            currency: transactions.currency,
            eventId: transactions.eventId,
            eventRegistrationId: transactions.eventRegistrationId,
            manuallyCreated: transactions.manuallyCreated,
            method: transactions.method,
            sourceTransactionId: transactions.sourceTransactionId,
            status: transactions.status,
            stripeAccountId: transactions.stripeAccountId,
            stripeRefundId: transactions.stripeRefundId,
            stripeRefundStatus: transactions.stripeRefundStatus,
            targetUserId: transactions.targetUserId,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.tenantId, input.tenantId),
              eq(transactions.type, 'refund'),
              inArray(transactions.sourceTransactionId, sourceIds),
            ),
          )
          .orderBy(transactions.id)
          .for('update');
  const priorRefundResolution = resolveRegistrationTransferPriorRefunds({
    refunds: priorRefunds,
    sourcePayments: refundPlans.map((plan) => ({
      amount: plan.sourceAmount,
      currency: plan.sourceCurrency,
      eventId: plan.sourceEventId,
      eventRegistrationId: plan.sourceEventRegistrationId,
      id: plan.sourceTransactionId,
      stripeAccountId: plan.sourceStripeAccountId,
      targetUserId: plan.sourceTargetUserId,
    })),
  });
  if (priorRefundResolution._tag !== 'Valid') {
    return yield* compensate(
      'Source refund ownership changed after recipient payment; a full recipient refund was queued.',
    );
  }
  const priorRefundedBySource =
    priorRefundResolution.refundedBySourceTransactionId;
  if (
    refundPlans.some(
      (plan) =>
        plan.refundTransactionId !== null ||
        plan.sourceAcquisitionId !== currentAcquisition.id ||
        !plan.sourceAcquisitionPaymentId ||
        plan.sourceAmount !== plan.originalAmount ||
        plan.sourceCurrency !== plan.currency ||
        plan.sourceMethod !== 'stripe' ||
        plan.sourceStatus !== 'successful' ||
        plan.sourceStripeAccountId !== plan.stripeAccountId ||
        (!plan.sourceStripeChargeId && !plan.sourceStripePaymentIntentId) ||
        plan.sourceTargetUserId !== transfer.sourceUserId ||
        (plan.sourceTransactionType !== 'registration' &&
          plan.sourceTransactionType !== 'addon') ||
        (priorRefundedBySource.get(plan.sourceTransactionId) ?? 0) !==
          plan.priorRefundedAmount,
    )
  ) {
    return yield* compensate(
      'Source payment ownership changed after recipient payment; a full recipient refund was queued.',
    );
  }

  const transferredRegistrations = yield* tx
    .update(eventRegistrations)
    .set({
      appliedDiscountedPrice: transfer.recipientAppliedDiscountedPrice,
      appliedDiscountType: transfer.recipientAppliedDiscountType,
      basePriceAtRegistration: transfer.recipientBasePrice,
      discountAmount: transfer.recipientDiscountAmount,
      stripeTaxRateId: transfer.recipientStripeTaxRateId,
      taxRateDisplayName: transfer.recipientTaxRateDisplayName,
      taxRateInclusive: transfer.recipientTaxRateInclusive,
      taxRatePercentage: transfer.recipientTaxRatePercentage,
      userId: transfer.recipientUserId,
    })
    .where(
      and(
        eq(eventRegistrations.id, transfer.sourceRegistrationId),
        eq(eventRegistrations.status, 'CONFIRMED'),
        eq(eventRegistrations.tenantId, input.tenantId),
        eq(eventRegistrations.userId, transfer.sourceUserId),
      ),
    )
    .returning({ id: eventRegistrations.id });
  if (transferredRegistrations.length !== 1) {
    return yield* transferInvariant(
      'Transfer registration ownership could not be atomically reassigned',
    );
  }
  const transferOperationId = `registration-transfer:${transfer.id}`;
  yield* establishRegistrationAcquisition(tx, {
    acquiredAt,
    components: settledTerms,
    currency: payment.currency,
    eventId: transfer.eventId,
    kind: 'claim_transfer',
    operationKey: transferOperationId,
    ownerUserId: recipientUserId,
    payment: {
      settlement: {
        applicationFeeAmount: payment.appFee,
        grossAmount: payment.amount,
        stripeFeeAmount: payment.stripeFee,
        stripeNetAmount: payment.stripeNetAmount,
      },
      stripeAccountId: payment.stripeAccountId,
      stripeChargeId: payment.stripeChargeId,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      transactionId: input.transactionId,
      type: 'registration',
    },
    registrationId: recipientRegistrationId,
    spotCount: transfer.recipientSpotCount,
    tenantId: input.tenantId,
    transferId: transfer.id,
  }).pipe(Effect.catch((error) => Effect.die(error)));

  const transferAnswers = yield* tx
    .select({
      answer: registrationTransferAnswers.answer,
      questionId: registrationTransferAnswers.questionId,
    })
    .from(registrationTransferAnswers)
    .where(
      and(
        eq(registrationTransferAnswers.eventId, transfer.eventId),
        eq(
          registrationTransferAnswers.registrationOptionId,
          transfer.registrationOptionId,
        ),
        eq(registrationTransferAnswers.transferId, transfer.id),
        eq(registrationTransferAnswers.tenantId, input.tenantId),
      ),
    );
  yield* tx
    .delete(eventRegistrationQuestionAnswers)
    .where(
      eq(
        eventRegistrationQuestionAnswers.registrationId,
        transfer.sourceRegistrationId,
      ),
    );
  if (transferAnswers.length > 0) {
    yield* tx.insert(eventRegistrationQuestionAnswers).values(
      transferAnswers.map((answer) => ({
        answer: answer.answer,
        questionId: answer.questionId,
        registrationId: transfer.sourceRegistrationId,
      })),
    );
  }

  const refundClaimIds: string[] = [];
  for (const plan of refundPlans) {
    if (plan.refundAmountDue === 0) continue;
    const refundClaim = yield* createRegistrationRefundClaim(tx, {
      amount: plan.refundAmountDue,
      applicationFeeRefunded: plan.applicationFeeRefunded,
      currency: plan.currency,
      eventId: transfer.eventId,
      eventRegistrationId: transfer.sourceRegistrationId,
      executiveUserId: transfer.sourceUserId,
      operationKey: plan.operationKey,
      sourceTransactionId: plan.sourceTransactionId,
      stripeAccountId: plan.stripeAccountId,
      targetUserId: transfer.sourceUserId,
      tenantId: input.tenantId,
    });
    const attachedPlans = yield* tx
      .update(registrationTransferRefundPlanItems)
      .set({ refundTransactionId: refundClaim.id })
      .where(
        and(
          eq(registrationTransferRefundPlanItems.id, plan.id),
          isNull(registrationTransferRefundPlanItems.refundTransactionId),
          eq(registrationTransferRefundPlanItems.tenantId, input.tenantId),
          eq(registrationTransferRefundPlanItems.transferId, transfer.id),
        ),
      )
      .returning({ id: registrationTransferRefundPlanItems.id });
    if (attachedPlans.length !== 1) {
      return yield* transferInvariant(
        'Source refund plan changed before its claim was attached',
      );
    }
    refundClaimIds.push(refundClaim.id);
  }

  const eventRows = yield* tx
    .select({ title: eventInstances.title })
    .from(eventInstances)
    .where(
      and(
        eq(eventInstances.id, transfer.eventId),
        eq(eventInstances.tenantId, input.tenantId),
      ),
    )
    .limit(1);
  const tenantRows = yield* tx
    .select({
      emailSenderEmail: tenants.emailSenderEmail,
      emailSenderName: tenants.emailSenderName,
      id: tenants.id,
      name: tenants.name,
    })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  const ownerRows = yield* tx
    .select({
      communicationEmail: users.communicationEmail,
      email: users.email,
      id: users.id,
    })
    .from(users)
    .where(
      inArray(users.id, [transfer.sourceUserId, transfer.recipientUserId]),
    );
  const event = eventRows[0];
  const tenant = tenantRows[0];
  const sourceUser = ownerRows.find(
    (owner) => owner.id === transfer.sourceUserId,
  );
  const recipientUser = ownerRows.find(
    (owner) => owner.id === transfer.recipientUserId,
  );
  if (!event || !tenant || !sourceUser || !recipientUser) {
    return yield* transferInvariant(
      'Transfer notification context is missing during finalization',
    );
  }
  yield* enqueueRegistrationTransferredEmail(tx, {
    eventTitle: event.title,
    eventUrl: payment.request.eventUrl,
    recipientRole: 'previousOwner',
    recipientUserId: transfer.sourceUserId,
    registrationId: transfer.sourceRegistrationId,
    tenant,
    to: sourceUser.communicationEmail?.trim() || sourceUser.email,
    transferOperationId,
  });
  yield* enqueueRegistrationTransferredEmail(tx, {
    eventTitle: event.title,
    eventUrl: payment.request.eventUrl,
    recipientRole: 'newOwner',
    recipientUserId: transfer.recipientUserId,
    registrationId: transfer.sourceRegistrationId,
    tenant,
    to: recipientUser.communicationEmail?.trim() || recipientUser.email,
    transferOperationId,
  });

  const finalizedAt = acquiredAt;
  const nextStatus = refundClaimIds.length > 0 ? 'refund_pending' : 'completed';
  const finalizedTransfers = yield* tx
    .update(registrationTransfers)
    .set({
      completedAt: refundClaimIds.length > 0 ? null : finalizedAt,
      lastError: null,
      ownershipTransferredAt: finalizedAt,
      recipientConfirmedAt: finalizedAt,
      reservedAdditionalSpots: 0,
      status: nextStatus,
    })
    .where(
      and(
        eq(registrationTransfers.id, transfer.id),
        eq(registrationTransfers.status, 'checkout_pending'),
        eq(registrationTransfers.tenantId, input.tenantId),
      ),
    )
    .returning({ id: registrationTransfers.id });
  if (finalizedTransfers.length !== 1) {
    return yield* transferInvariant(
      'Transfer state changed during Checkout finalization',
    );
  }
  yield* tx.insert(registrationTransferEvents).values([
    {
      actorUserId: transfer.recipientUserId,
      eventType: 'recipient_confirmed',
      fromStatus: 'checkout_pending',
      tenantId: input.tenantId,
      toStatus: nextStatus,
      transferId: transfer.id,
    },
    {
      actorUserId: transfer.recipientUserId,
      eventType: 'ownership_transferred',
      fromStatus: 'checkout_pending',
      tenantId: input.tenantId,
      toStatus: nextStatus,
      transferId: transfer.id,
    },
    ...(refundClaimIds.length > 0
      ? [
          {
            actorUserId: transfer.recipientUserId,
            eventType: 'refund_queued' as const,
            fromStatus: 'checkout_pending' as const,
            tenantId: input.tenantId,
            toStatus: 'refund_pending' as const,
            transferId: transfer.id,
          },
        ]
      : []),
  ]);
  return 'finalized' as const;
});

export const expireRegistrationTransferCheckout = Effect.fn(
  'expireRegistrationTransferCheckout',
)(function* (
  tx: RegistrationTransferTransaction,
  input: RegistrationTransferCheckoutIdentity,
) {
  const transferRows = yield* tx
    .select({
      id: registrationTransfers.id,
      recipientRegistrationId: registrationTransfers.recipientRegistrationId,
      sourceRegistrationId: registrationTransfers.sourceRegistrationId,
      status: registrationTransfers.status,
    })
    .from(registrationTransfers)
    .where(
      and(
        eq(
          registrationTransfers.recipientCheckoutTransactionId,
          input.transactionId,
        ),
        eq(registrationTransfers.recipientRegistrationId, input.registrationId),
        eq(registrationTransfers.tenantId, input.tenantId),
      ),
    )
    .for('update');
  const transfer = transferRows[0];
  if (!transfer) return 'notTransfer' as const;
  if (transfer.status === 'expired') return 'alreadyExpired' as const;
  if (
    transfer.status !== 'checkout_pending' ||
    transfer.recipientRegistrationId !== transfer.sourceRegistrationId
  ) {
    return 'notTransfer' as const;
  }

  const paymentRows = yield* tx
    .select({ status: transactions.status })
    .from(transactions)
    .where(
      and(
        eq(transactions.id, input.transactionId),
        eq(transactions.eventRegistrationId, input.registrationId),
        eq(transactions.tenantId, input.tenantId),
        eq(transactions.type, 'registration'),
      ),
    )
    .for('update');
  if (paymentRows[0]?.status !== 'pending') return 'notTransfer' as const;

  const cancelledPayments = yield* tx
    .update(transactions)
    .set({
      status: 'cancelled',
      stripeCheckoutReconcileAttempts: 0,
      stripeCheckoutReconcileLastError: null,
      stripeCheckoutReconcileLeaseExpiresAt: null,
      stripeCheckoutReconcileLeaseId: null,
      stripeCheckoutReconcileNextAt: null,
    })
    .where(
      and(
        eq(transactions.id, input.transactionId),
        eq(transactions.eventRegistrationId, input.registrationId),
        eq(transactions.status, 'pending'),
        eq(transactions.tenantId, input.tenantId),
        eq(transactions.type, 'registration'),
      ),
    )
    .returning({ id: transactions.id });
  if (cancelledPayments.length !== 1) {
    return yield* transferInvariant(
      'Transfer Checkout expiry could not cancel its payment',
    );
  }

  const expiredAt = new Date();
  const expiredTransfers = yield* tx
    .update(registrationTransfers)
    .set({
      expiredAt,
      lastError: null,
      reservedAdditionalSpots: 0,
      status: 'expired',
    })
    .where(
      and(
        eq(registrationTransfers.id, transfer.id),
        eq(registrationTransfers.status, 'checkout_pending'),
        eq(registrationTransfers.tenantId, input.tenantId),
      ),
    )
    .returning({ id: registrationTransfers.id });
  if (expiredTransfers.length !== 1) {
    return yield* transferInvariant(
      'Transfer state changed during Checkout expiry',
    );
  }
  yield* tx.insert(registrationTransferEvents).values({
    eventType: 'checkout_expired',
    fromStatus: 'checkout_pending',
    tenantId: input.tenantId,
    toStatus: 'expired',
    transferId: transfer.id,
  });
  return 'expired' as const;
});
