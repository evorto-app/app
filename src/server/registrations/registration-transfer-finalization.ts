import type { DatabaseClient } from '@db/index';

import {
  eventAddons,
  eventInstances,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchases,
  eventRegistrationOptions,
  eventRegistrations,
  registrationTransferEvents,
  registrationTransfers,
  tenants,
  transactions,
  users,
} from '@db/schema';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
} from 'drizzle-orm';
import { Effect } from 'effect';

import { enqueueRegistrationTransferredEmail } from '../notifications/email-delivery';
import { createRegistrationRefundClaim } from '../payments/registration-refund';

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
  'insert' | 'select' | 'update'
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
      eq(transactions.id, registrationTransfers.recipientCheckoutTransactionId),
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

interface TransferCompensationPayment {
  readonly amount: number;
  readonly currency: typeof transactions.$inferSelect.currency;
  readonly stripeAccountId: null | string;
}

interface TransferCompensationRegistration {
  readonly registrationOptionId: string;
  readonly status: typeof eventRegistrations.$inferSelect.status;
}

interface TransferCompensationState {
  readonly eventId: string;
  readonly id: string;
  readonly recipientRegistrationId: string;
  readonly recipientSpotCount: number;
  readonly recipientUserId: string;
  readonly registrationOptionId: string;
  readonly reservedAdditionalSpots: number;
}

const compensateRegistrationTransferRecipient = Effect.fn(
  'compensateRegistrationTransferRecipient',
)(function* (
  tx: RegistrationTransferTransaction,
  input: RegistrationTransferCheckoutIdentity & {
    readonly payment: TransferCompensationPayment;
    readonly reason: string;
    readonly recipient: TransferCompensationRegistration | undefined;
    readonly transfer: TransferCompensationState;
  },
) {
  if (
    input.payment.amount <= 0 ||
    !input.payment.stripeAccountId ||
    !Number.isInteger(input.payment.amount)
  ) {
    return yield* transferInvariant(
      'Paid transfer compensation is missing the recipient payment ownership snapshot',
    );
  }

  if (!input.recipient) {
    return yield* transferInvariant(
      'Paid transfer compensation is missing its recipient registration',
    );
  }
  const recipientPending = input.recipient.status === 'PENDING';
  const recipientConfirmed = input.recipient.status === 'CONFIRMED';
  if (recipientPending || recipientConfirmed) {
    const cancelledRecipients = yield* tx
      .update(eventRegistrations)
      .set({ status: 'CANCELLED' })
      .where(
        and(
          eq(eventRegistrations.id, input.transfer.recipientRegistrationId),
          eq(
            eventRegistrations.status,
            recipientPending ? 'PENDING' : 'CONFIRMED',
          ),
          eq(eventRegistrations.tenantId, input.tenantId),
        ),
      )
      .returning({ id: eventRegistrations.id });
    if (cancelledRecipients.length !== 1) {
      return yield* transferInvariant(
        'Paid transfer compensation could not cancel the recipient registration',
      );
    }

    const releasedOptions = recipientPending
      ? yield* tx
          .update(eventRegistrationOptions)
          .set({
            reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - ${input.transfer.reservedAdditionalSpots}`,
          })
          .where(
            and(
              eq(
                eventRegistrationOptions.id,
                input.transfer.registrationOptionId,
              ),
              eq(eventRegistrationOptions.eventId, input.transfer.eventId),
              gte(
                eventRegistrationOptions.reservedSpots,
                input.transfer.reservedAdditionalSpots,
              ),
            ),
          )
          .returning({ id: eventRegistrationOptions.id })
      : yield* tx
          .update(eventRegistrationOptions)
          .set({
            confirmedSpots: sql`${eventRegistrationOptions.confirmedSpots} - ${input.transfer.recipientSpotCount}`,
          })
          .where(
            and(
              eq(
                eventRegistrationOptions.id,
                input.transfer.registrationOptionId,
              ),
              eq(eventRegistrationOptions.eventId, input.transfer.eventId),
              gte(
                eventRegistrationOptions.confirmedSpots,
                input.transfer.recipientSpotCount,
              ),
            ),
          )
          .returning({ id: eventRegistrationOptions.id });
    if (releasedOptions.length !== 1) {
      return yield* transferInvariant(
        'Paid transfer compensation could not release recipient capacity',
      );
    }

    const recipientAddOns = yield* tx
      .select({
        addonId: eventRegistrationAddonPurchases.addonId,
        quantity: eventRegistrationAddonPurchases.quantity,
      })
      .from(eventRegistrationAddonPurchases)
      .where(
        eq(
          eventRegistrationAddonPurchases.registrationId,
          input.transfer.recipientRegistrationId,
        ),
      )
      .for('update');
    for (const recipientAddOn of recipientAddOns) {
      const releasedAddOns = yield* tx
        .update(eventAddons)
        .set({
          totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} + ${recipientAddOn.quantity}`,
        })
        .where(
          and(
            eq(eventAddons.id, recipientAddOn.addonId),
            eq(eventAddons.eventId, input.transfer.eventId),
          ),
        )
        .returning({ id: eventAddons.id });
      if (releasedAddOns.length !== 1) {
        return yield* transferInvariant(
          'Paid transfer compensation could not release recipient add-on inventory',
        );
      }
    }
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
      compensationStartedAt,
      lastError: input.reason,
      refundTransactionId: compensationClaim.id,
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
      'Paid transfer compensation state changed before its refund claim was attached',
    );
  }

  const compensationEvents = [
    ...(recipientPending || recipientConfirmed
      ? [
          {
            actorUserId: input.transfer.recipientUserId,
            eventType: 'recipient_cancelled' as const,
            fromStatus: 'checkout_pending' as const,
            reason: input.reason,
            tenantId: input.tenantId,
            toStatus: 'compensation_pending' as const,
            transferId: input.transfer.id,
          },
        ]
      : []),
    {
      actorUserId: input.transfer.recipientUserId,
      eventType: 'compensation_queued' as const,
      fromStatus: 'checkout_pending' as const,
      reason: input.reason,
      tenantId: input.tenantId,
      toStatus: 'compensation_pending' as const,
      transferId: input.transfer.id,
    },
  ];
  yield* tx.insert(registrationTransferEvents).values(compensationEvents);
  return 'compensationQueued' as const;
});

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
  if (!identity) return 'notTransfer';

  // Source mutations lock the registration before the transfer guard. Match
  // that order here so completion cannot deadlock with cancellation/check-in.
  const sourceRows = yield* tx
    .select({
      checkedInGuestCount: eventRegistrations.checkedInGuestCount,
      checkInTime: eventRegistrations.checkInTime,
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
  const source = sourceRows[0];

  const transferRows = yield* tx
    .select({
      eventId: registrationTransfers.eventId,
      id: registrationTransfers.id,
      recipientRegistrationId: registrationTransfers.recipientRegistrationId,
      recipientSpotCount: registrationTransfers.recipientSpotCount,
      recipientUserId: registrationTransfers.recipientUserId,
      registrationOptionId: registrationTransfers.registrationOptionId,
      reservedAdditionalSpots: registrationTransfers.reservedAdditionalSpots,
      sourcePaymentTransactionId:
        registrationTransfers.sourcePaymentTransactionId,
      sourceRefundAmount: registrationTransfers.sourceRefundAmount,
      sourceRefundApplicationFee:
        registrationTransfers.sourceRefundApplicationFee,
      sourceRegistrationId: registrationTransfers.sourceRegistrationId,
      sourceSpotCount: registrationTransfers.sourceSpotCount,
      sourceUserId: registrationTransfers.sourceUserId,
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
        eq(registrationTransfers.id, identity.id),
        eq(registrationTransfers.tenantId, input.tenantId),
      ),
    )
    .for('update');
  const transfer = transferRows[0];
  if (!transfer) return 'notTransfer';
  if (
    transfer.status === 'completed' ||
    transfer.status === 'compensated' ||
    transfer.status === 'compensation_failed' ||
    transfer.status === 'compensation_pending' ||
    transfer.status === 'refund_failed' ||
    transfer.status === 'refund_pending'
  ) {
    return 'alreadyFinalized';
  }
  if (
    transfer.status !== 'checkout_pending' ||
    !transfer.recipientRegistrationId ||
    !transfer.recipientSpotCount ||
    !transfer.recipientUserId
  ) {
    return 'notTransfer';
  }
  if (
    transfer.sourcePaymentTransactionId &&
    transfer.sourceRefundAmount === null
  ) {
    return yield* transferInvariant(
      'Paid source transfer is missing its reconciled refund amount',
    );
  }

  const paymentRows = yield* tx
    .select({
      amount: transactions.amount,
      currency: transactions.currency,
      eventRegistrationId: transactions.eventRegistrationId,
      request: transactions.stripeCheckoutRequest,
      status: transactions.status,
      stripeAccountId: transactions.stripeAccountId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.id, input.transactionId),
        eq(transactions.eventRegistrationId, input.registrationId),
        eq(transactions.status, 'successful'),
        eq(transactions.tenantId, input.tenantId),
        eq(transactions.type, 'registration'),
      ),
    )
    .for('update');
  const payment = paymentRows[0];
  if (!payment?.request) {
    return yield* transferInvariant(
      'Successful transfer Checkout is missing its immutable request snapshot',
    );
  }

  const sourcePaymentRows = transfer.sourcePaymentTransactionId
    ? yield* tx
        .select({
          currency: transactions.currency,
          stripeAccountId: transactions.stripeAccountId,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.id, transfer.sourcePaymentTransactionId),
            eq(transactions.status, 'successful'),
            eq(transactions.tenantId, input.tenantId),
            eq(transactions.type, 'registration'),
          ),
        )
        .for('update')
    : [];
  const sourcePayment = sourcePaymentRows[0];
  if (transfer.sourcePaymentTransactionId && !sourcePayment?.stripeAccountId) {
    return yield* transferInvariant(
      'Source payment ownership is missing during transfer finalization',
    );
  }

  const recipientRows = yield* tx
    .select({
      registrationOptionId: eventRegistrations.registrationOptionId,
      status: eventRegistrations.status,
      userId: eventRegistrations.userId,
    })
    .from(eventRegistrations)
    .where(
      and(
        eq(eventRegistrations.id, input.registrationId),
        eq(eventRegistrations.tenantId, input.tenantId),
      ),
    )
    .for('update');
  const recipient = recipientRows[0];
  if (
    !source ||
    source.status !== 'CONFIRMED' ||
    source.userId !== transfer.sourceUserId ||
    source.checkInTime !== null ||
    source.checkedInGuestCount !== 0 ||
    !recipient ||
    recipient.status !== 'PENDING' ||
    recipient.userId !== transfer.recipientUserId
  ) {
    return yield* compensateRegistrationTransferRecipient(tx, {
      payment,
      reason:
        'Transfer source or recipient eligibility changed after recipient payment; a full recipient refund was queued.',
      recipient,
      registrationId: input.registrationId,
      tenantId: input.tenantId,
      transactionId: input.transactionId,
      transfer: {
        eventId: transfer.eventId,
        id: transfer.id,
        recipientRegistrationId: transfer.recipientRegistrationId,
        recipientSpotCount: transfer.recipientSpotCount,
        recipientUserId: transfer.recipientUserId,
        registrationOptionId: transfer.registrationOptionId,
        reservedAdditionalSpots: transfer.reservedAdditionalSpots,
      },
    });
  }

  const sourceAddOnEntitlements = yield* tx
    .select({
      addonId: eventRegistrationAddonPurchases.addonId,
      cancelledQuantity: eventRegistrationAddonPurchases.cancelledQuantity,
      id: eventRegistrationAddonPurchases.id,
      quantity: eventRegistrationAddonPurchases.quantity,
      redeemedQuantity: eventRegistrationAddonPurchases.redeemedQuantity,
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
  if (sourceAddOnEntitlements.length > 0) {
    yield* tx
      .select({ id: eventRegistrationAddonPurchaseLots.id })
      .from(eventRegistrationAddonPurchaseLots)
      .where(
        and(
          inArray(
            eventRegistrationAddonPurchaseLots.purchaseId,
            sourceAddOnEntitlements.map(({ id }) => id),
          ),
          eq(eventRegistrationAddonPurchaseLots.tenantId, input.tenantId),
        ),
      )
      .orderBy(eventRegistrationAddonPurchaseLots.id)
      .for('update');
  }
  if (
    sourceAddOnEntitlements.some(
      (entitlement) =>
        entitlement.redeemedQuantity > 0 || entitlement.cancelledQuantity > 0,
    )
  ) {
    return yield* compensateRegistrationTransferRecipient(tx, {
      payment,
      reason:
        'Source add-on fulfillment changed before transfer completion; a full recipient refund was queued.',
      recipient,
      registrationId: input.registrationId,
      tenantId: input.tenantId,
      transactionId: input.transactionId,
      transfer: {
        eventId: transfer.eventId,
        id: transfer.id,
        recipientRegistrationId: transfer.recipientRegistrationId,
        recipientSpotCount: transfer.recipientSpotCount,
        recipientUserId: transfer.recipientUserId,
        registrationOptionId: transfer.registrationOptionId,
        reservedAdditionalSpots: transfer.reservedAdditionalSpots,
      },
    });
  }

  const confirmedRecipients = yield* tx
    .update(eventRegistrations)
    .set({ status: 'CONFIRMED' })
    .where(
      and(
        eq(eventRegistrations.id, input.registrationId),
        eq(eventRegistrations.status, 'PENDING'),
        eq(eventRegistrations.tenantId, input.tenantId),
        eq(eventRegistrations.userId, transfer.recipientUserId),
      ),
    )
    .returning({ id: eventRegistrations.id });
  const cancelledSources = yield* tx
    .update(eventRegistrations)
    .set({ status: 'CANCELLED' })
    .where(
      and(
        eq(eventRegistrations.id, transfer.sourceRegistrationId),
        eq(eventRegistrations.status, 'CONFIRMED'),
        eq(eventRegistrations.tenantId, input.tenantId),
        eq(eventRegistrations.userId, transfer.sourceUserId),
      ),
    )
    .returning({ id: eventRegistrations.id });
  if (confirmedRecipients.length !== 1 || cancelledSources.length !== 1) {
    return yield* transferInvariant(
      'Transfer Checkout registrations could not be atomically reassigned',
    );
  }

  const updatedOptions = yield* tx
    .update(eventRegistrationOptions)
    .set({
      confirmedSpots: sql`${eventRegistrationOptions.confirmedSpots} + ${transfer.recipientSpotCount} - ${transfer.sourceSpotCount}`,
      reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - ${transfer.reservedAdditionalSpots}`,
    })
    .where(
      and(
        eq(eventRegistrationOptions.id, recipient.registrationOptionId),
        eq(eventRegistrationOptions.eventId, transfer.eventId),
        gte(eventRegistrationOptions.confirmedSpots, transfer.sourceSpotCount),
        gte(
          eventRegistrationOptions.reservedSpots,
          transfer.reservedAdditionalSpots,
        ),
      ),
    )
    .returning({ id: eventRegistrationOptions.id });
  if (updatedOptions.length !== 1) {
    return yield* transferInvariant(
      'Transfer Checkout capacity could not be atomically finalized',
    );
  }

  for (const sourceAddOn of sourceAddOnEntitlements) {
    const releasedAddOns = yield* tx
      .update(eventAddons)
      .set({
        totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} + ${sourceAddOn.quantity}`,
      })
      .where(
        and(
          eq(eventAddons.id, sourceAddOn.addonId),
          eq(eventAddons.eventId, transfer.eventId),
        ),
      )
      .returning({ id: eventAddons.id });
    if (releasedAddOns.length !== 1) {
      return yield* transferInvariant(
        'Source add-on inventory could not be released during transfer',
      );
    }
  }

  let refundTransactionId: string | undefined;
  if (
    transfer.sourcePaymentTransactionId &&
    transfer.sourceRefundAmount !== null &&
    transfer.sourceRefundAmount > 0
  ) {
    if (!sourcePayment?.stripeAccountId) {
      return yield* transferInvariant(
        'Source payment ownership is missing during transfer finalization',
      );
    }
    const refundClaim = yield* createRegistrationRefundClaim(tx, {
      amount: transfer.sourceRefundAmount,
      applicationFeeRefunded: transfer.sourceRefundApplicationFee,
      currency: sourcePayment.currency,
      eventId: transfer.eventId,
      eventRegistrationId: transfer.sourceRegistrationId,
      executiveUserId: transfer.sourceUserId,
      operationKey: `registration-transfer-source:${transfer.id}`,
      sourceTransactionId: transfer.sourcePaymentTransactionId,
      stripeAccountId: sourcePayment.stripeAccountId,
      targetUserId: transfer.sourceUserId,
      tenantId: input.tenantId,
    });
    refundTransactionId = refundClaim.id;
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
    registrationId: input.registrationId,
    tenant,
    to: sourceUser.communicationEmail?.trim() || sourceUser.email,
  });
  yield* enqueueRegistrationTransferredEmail(tx, {
    eventTitle: event.title,
    eventUrl: payment.request.eventUrl,
    recipientRole: 'newOwner',
    recipientUserId: transfer.recipientUserId,
    registrationId: input.registrationId,
    tenant,
    to: recipientUser.communicationEmail?.trim() || recipientUser.email,
  });

  const finalizedAt = new Date();
  const nextStatus = refundTransactionId ? 'refund_pending' : 'completed';
  const finalizedTransfers = yield* tx
    .update(registrationTransfers)
    .set({
      completedAt: refundTransactionId ? null : finalizedAt,
      lastError: null,
      recipientConfirmedAt: finalizedAt,
      refundTransactionId,
      reservedAdditionalSpots: 0,
      sourceCancelledAt: finalizedAt,
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
      eventType: 'source_cancelled',
      fromStatus: 'checkout_pending',
      tenantId: input.tenantId,
      toStatus: nextStatus,
      transferId: transfer.id,
    },
  ]);
  if (refundTransactionId) {
    yield* tx.insert(registrationTransferEvents).values({
      actorUserId: transfer.recipientUserId,
      eventType: 'refund_queued',
      fromStatus: 'checkout_pending',
      tenantId: input.tenantId,
      toStatus: 'refund_pending',
      transferId: transfer.id,
    });
  }
  return 'finalized';
});

export const expireRegistrationTransferCheckout = Effect.fn(
  'expireRegistrationTransferCheckout',
)(function* (
  tx: RegistrationTransferTransaction,
  input: RegistrationTransferCheckoutIdentity,
) {
  const identityRows = yield* tx
    .select({
      id: registrationTransfers.id,
      recipientRegistrationId: registrationTransfers.recipientRegistrationId,
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
    .limit(1);
  const identity = identityRows[0];
  if (!identity) return 'notTransfer' as const;
  if (identity.status === 'expired') return 'alreadyExpired' as const;
  if (
    identity.status !== 'checkout_pending' ||
    !identity.recipientRegistrationId
  ) {
    return 'notTransfer' as const;
  }

  const recipientRows = yield* tx
    .select({
      registrationOptionId: eventRegistrations.registrationOptionId,
      status: eventRegistrations.status,
    })
    .from(eventRegistrations)
    .where(
      and(
        eq(eventRegistrations.id, input.registrationId),
        eq(eventRegistrations.tenantId, input.tenantId),
      ),
    )
    .for('update');
  const paymentRows = yield* tx
    .select({ id: transactions.id, status: transactions.status })
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
  const transferRows = yield* tx
    .select({
      eventId: registrationTransfers.eventId,
      id: registrationTransfers.id,
      recipientRegistrationId: registrationTransfers.recipientRegistrationId,
      reservedAdditionalSpots: registrationTransfers.reservedAdditionalSpots,
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
        eq(registrationTransfers.recipientRegistrationId, input.registrationId),
        eq(registrationTransfers.tenantId, input.tenantId),
      ),
    )
    .for('update');
  const transfer = transferRows[0];
  if (!transfer) return 'notTransfer' as const;
  if (transfer.status === 'expired') return 'alreadyExpired' as const;
  if (transfer.status !== 'checkout_pending') return 'notTransfer' as const;

  const recipient = recipientRows[0];
  const payment = paymentRows[0];
  if (
    !recipient ||
    recipient.status !== 'PENDING' ||
    !payment ||
    payment.status !== 'pending'
  ) {
    return 'notTransfer' as const;
  }

  const cancelledRecipients = yield* tx
    .update(eventRegistrations)
    .set({ status: 'CANCELLED' })
    .where(
      and(
        eq(eventRegistrations.id, input.registrationId),
        eq(eventRegistrations.status, 'PENDING'),
        eq(eventRegistrations.tenantId, input.tenantId),
      ),
    )
    .returning({ id: eventRegistrations.id });
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
  const releasedOptions = yield* tx
    .update(eventRegistrationOptions)
    .set({
      reservedSpots: sql`${eventRegistrationOptions.reservedSpots} - ${transfer.reservedAdditionalSpots}`,
    })
    .where(
      and(
        eq(eventRegistrationOptions.id, recipient.registrationOptionId),
        eq(eventRegistrationOptions.eventId, transfer.eventId),
        gte(
          eventRegistrationOptions.reservedSpots,
          transfer.reservedAdditionalSpots,
        ),
      ),
    )
    .returning({ id: eventRegistrationOptions.id });
  if (
    cancelledRecipients.length !== 1 ||
    cancelledPayments.length !== 1 ||
    releasedOptions.length !== 1
  ) {
    return yield* transferInvariant(
      'Transfer Checkout expiry could not release its reservation',
    );
  }

  const recipientAddOns = yield* tx
    .select({
      addonId: eventRegistrationAddonPurchases.addonId,
      quantity: eventRegistrationAddonPurchases.quantity,
    })
    .from(eventRegistrationAddonPurchases)
    .where(
      eq(eventRegistrationAddonPurchases.registrationId, input.registrationId),
    )
    .for('update');
  for (const recipientAddOn of recipientAddOns) {
    const releasedAddOns = yield* tx
      .update(eventAddons)
      .set({
        totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} + ${recipientAddOn.quantity}`,
      })
      .where(
        and(
          eq(eventAddons.id, recipientAddOn.addonId),
          eq(eventAddons.eventId, transfer.eventId),
        ),
      )
      .returning({ id: eventAddons.id });
    if (releasedAddOns.length !== 1) {
      return yield* transferInvariant(
        'Transfer Checkout add-on expiry could not release inventory',
      );
    }
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
