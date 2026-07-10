import type Stripe from 'stripe';

import { Database } from '@db/index';
import {
  eventAddons,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchaseOrders,
  eventRegistrationAddonPurchases,
  eventRegistrations,
  registrationTransfers,
  transactions,
} from '@db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import { ensureAddonPaymentAllocations } from '../payments/addon-payment-allocation.service';
import { StripeClient } from '../stripe-client';
import { activeRegistrationTransferMutationPredicate } from './registration-transfer-mutation-guard';

export const registrationAddonPurchaseLockOrder = [
  'registration',
  'active_transfer',
  'transaction',
  'order',
  'entitlement',
  'tenant_and_stock',
] as const;

export type AddonPurchaseCheckoutCompletionStatus =
  'alreadyCompleted' | 'finalized';

export type AddonPurchaseCheckoutExpiryStatus =
  'alreadyCompleted' | 'alreadyExpired' | 'expired';
export interface AddonPurchaseCheckoutIdentity {
  readonly orderId: string;
  readonly registrationId: string;
  readonly stripeAccountId: string;
  readonly stripeCheckoutSessionId: string;
  readonly tenantId: string;
  readonly transactionId: string;
}

export class AddonPurchaseCheckoutError extends Schema.TaggedErrorClass<AddonPurchaseCheckoutError>()(
  'AddonPurchaseCheckoutError',
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    orderId: Schema.String,
    registrationId: Schema.String,
    transactionId: Schema.String,
  },
) {}

const checkoutError = (
  input: Pick<
    AddonPurchaseCheckoutIdentity,
    'orderId' | 'registrationId' | 'transactionId'
  >,
  message: string,
  cause?: unknown,
) =>
  new AddonPurchaseCheckoutError({
    ...(cause !== undefined && { cause }),
    message,
    orderId: input.orderId,
    registrationId: input.registrationId,
    transactionId: input.transactionId,
  });

export const addonPurchaseCheckoutPaymentIntentId = (
  session: Stripe.Checkout.Session,
): string | undefined =>
  typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;

export const addonPurchaseCheckoutPaymentOwnsClaim = (input: {
  readonly persistedAmount: number;
  readonly persistedCurrency: string;
  readonly sessionAmountTotal: null | number;
  readonly sessionCurrency: null | string;
}): boolean =>
  Number.isSafeInteger(input.sessionAmountTotal) &&
  input.sessionAmountTotal === input.persistedAmount &&
  Boolean(input.sessionCurrency) &&
  input.sessionCurrency?.toUpperCase() === input.persistedCurrency;

export const addonPurchaseCheckoutMetadataOwnsClaim = (input: {
  readonly identity: Pick<
    AddonPurchaseCheckoutIdentity,
    'orderId' | 'registrationId' | 'tenantId' | 'transactionId'
  >;
  readonly session: Stripe.Checkout.Session;
}): boolean => {
  const metadata = input.session.metadata ?? {};
  const hasAnyOwnershipMetadata = Boolean(
    metadata['addonPurchaseOrderId'] ||
    metadata['registrationId'] ||
    metadata['tenantId'] ||
    metadata['transactionId'],
  );
  if (!hasAnyOwnershipMetadata) return true;
  return (
    metadata['addonPurchaseOrderId'] === input.identity.orderId &&
    metadata['registrationId'] === input.identity.registrationId &&
    metadata['tenantId'] === input.identity.tenantId &&
    metadata['transactionId'] === input.identity.transactionId
  );
};

export const resolveAddonPurchaseTerminalTransition = (input: {
  readonly orderStatus: 'completed' | 'expired' | 'pending_payment';
  readonly registrationStatus:
    'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
  readonly requested: 'complete' | 'expire';
  readonly transactionStatus: 'cancelled' | 'pending' | 'successful';
}): 'already_applied' | 'apply' | 'inconsistent' | 'opposite_terminal_won' => {
  if (input.requested === 'complete') {
    if (
      input.orderStatus === 'pending_payment' &&
      input.transactionStatus === 'pending' &&
      input.registrationStatus === 'CONFIRMED'
    ) {
      return 'apply';
    }
    if (
      input.orderStatus === 'completed' &&
      input.transactionStatus === 'successful' &&
      input.registrationStatus === 'CONFIRMED'
    ) {
      return 'already_applied';
    }
    if (
      input.orderStatus === 'expired' &&
      input.transactionStatus === 'cancelled'
    ) {
      return 'opposite_terminal_won';
    }
    return 'inconsistent';
  }

  if (
    input.orderStatus === 'pending_payment' &&
    input.transactionStatus === 'pending'
  ) {
    return 'apply';
  }
  if (
    input.orderStatus === 'expired' &&
    input.transactionStatus === 'cancelled'
  ) {
    return 'already_applied';
  }
  if (
    input.orderStatus === 'completed' &&
    input.transactionStatus === 'successful'
  ) {
    return 'opposite_terminal_won';
  }
  return 'inconsistent';
};

const latestChargeId = (
  paymentIntent:
    | null
    | string
    | {
        latest_charge?: null | string | { id?: string | undefined };
      },
): string | undefined => {
  if (!paymentIntent || typeof paymentIntent === 'string') return;
  const latestCharge = paymentIntent.latest_charge;
  return typeof latestCharge === 'string' ? latestCharge : latestCharge?.id;
};

const resolveCheckoutChargeId = Effect.fn('resolveAddonCheckoutChargeId')(
  function* (
    input: AddonPurchaseCheckoutIdentity,
    session: Stripe.Checkout.Session,
    paymentIntentId: string,
  ) {
    const inlineChargeId = latestChargeId(session.payment_intent);
    if (inlineChargeId) return inlineChargeId;

    const stripe = yield* StripeClient;
    const paymentIntent = yield* Effect.tryPromise({
      catch: (cause) =>
        checkoutError(
          input,
          'Stripe add-on payment intent could not be resolved',
          cause,
        ),
      try: () =>
        stripe.paymentIntents.retrieve(
          paymentIntentId,
          { expand: ['latest_charge'] },
          { stripeAccount: input.stripeAccountId },
        ),
    });
    return latestChargeId(paymentIntent);
  },
);

/**
 * Completes a post-registration add-on reservation. Stripe reads happen before
 * any database lock; inside the transaction the shared lock order above is
 * registration -> transfer -> transaction -> order -> entitlement.
 */
export const completePaidAddonPurchaseCheckout = Effect.fn(
  'completePaidAddonPurchaseCheckout',
)(function* (
  input: AddonPurchaseCheckoutIdentity,
  session: Stripe.Checkout.Session,
) {
  if (
    session.id !== input.stripeCheckoutSessionId ||
    session.status !== 'complete' ||
    session.payment_status !== 'paid' ||
    !addonPurchaseCheckoutMetadataOwnsClaim({ identity: input, session })
  ) {
    return yield* checkoutError(
      input,
      'Add-on Checkout is not the exact completed and paid session',
    );
  }
  const paymentIntentId = addonPurchaseCheckoutPaymentIntentId(session);
  if (!paymentIntentId) {
    return yield* checkoutError(
      input,
      'Completed add-on Checkout has no payment intent',
    );
  }

  const preflight = yield* Database.use((database) =>
    database
      .select({
        amount: transactions.amount,
        currency: transactions.currency,
        expiresAt: eventRegistrationAddonPurchaseOrders.expiresAt,
        persistedPaymentIntentId: transactions.stripePaymentIntentId,
      })
      .from(transactions)
      .innerJoin(
        eventRegistrationAddonPurchaseOrders,
        and(
          eq(
            eventRegistrationAddonPurchaseOrders.transactionId,
            transactions.id,
          ),
          eq(
            eventRegistrationAddonPurchaseOrders.registrationId,
            transactions.eventRegistrationId,
          ),
          eq(
            eventRegistrationAddonPurchaseOrders.tenantId,
            transactions.tenantId,
          ),
        ),
      )
      .where(
        and(
          eq(transactions.id, input.transactionId),
          eq(transactions.eventRegistrationId, input.registrationId),
          eq(transactions.method, 'stripe'),
          eq(transactions.stripeAccountId, input.stripeAccountId),
          eq(
            transactions.stripeCheckoutSessionId,
            input.stripeCheckoutSessionId,
          ),
          eq(transactions.tenantId, input.tenantId),
          eq(transactions.type, 'addon'),
          eq(eventRegistrationAddonPurchaseOrders.id, input.orderId),
        ),
      )
      .limit(1),
  ).pipe(
    Effect.mapError((cause) =>
      checkoutError(input, 'Add-on Checkout preflight failed', cause),
    ),
  );
  const claim = preflight[0];
  if (
    !claim?.expiresAt ||
    !addonPurchaseCheckoutPaymentOwnsClaim({
      persistedAmount: claim.amount,
      persistedCurrency: claim.currency,
      sessionAmountTotal: session.amount_total,
      sessionCurrency: session.currency,
    }) ||
    session.expires_at !== Math.floor(claim.expiresAt.getTime() / 1000) ||
    (claim.persistedPaymentIntentId !== null &&
      claim.persistedPaymentIntentId !== paymentIntentId)
  ) {
    return yield* checkoutError(
      input,
      'Add-on Checkout amount, currency, expiry, or payment ownership does not match',
    );
  }
  const claimExpiresAt = claim.expiresAt;
  const stripeChargeId = yield* resolveCheckoutChargeId(
    input,
    session,
    paymentIntentId,
  );

  const completion = yield* Database.use((database) =>
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          const registrations = yield* tx
            .select({
              eventId: eventRegistrations.eventId,
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
          const registration = registrations[0];
          if (!registration) {
            return yield* checkoutError(
              input,
              'Add-on Checkout registration no longer exists',
            );
          }

          const activeTransfers = yield* tx
            .select({ id: registrationTransfers.id })
            .from(registrationTransfers)
            .where(
              activeRegistrationTransferMutationPredicate({
                registrationId: input.registrationId,
                tenantId: input.tenantId,
              }),
            )
            .for('update');
          if (activeTransfers.length > 0) {
            return yield* checkoutError(
              input,
              'An active transfer blocks add-on Checkout completion',
            );
          }

          const transactionRows = yield* tx
            .select({
              amount: transactions.amount,
              appFee: transactions.appFee,
              currency: transactions.currency,
              paymentIntentId: transactions.stripePaymentIntentId,
              status: transactions.status,
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.id, input.transactionId),
                eq(transactions.eventRegistrationId, input.registrationId),
                eq(transactions.method, 'stripe'),
                eq(transactions.stripeAccountId, input.stripeAccountId),
                eq(
                  transactions.stripeCheckoutSessionId,
                  input.stripeCheckoutSessionId,
                ),
                eq(transactions.tenantId, input.tenantId),
                eq(transactions.type, 'addon'),
              ),
            )
            .for('update');
          const transaction = transactionRows[0];

          const orderRows = yield* tx
            .select()
            .from(eventRegistrationAddonPurchaseOrders)
            .where(
              and(
                eq(eventRegistrationAddonPurchaseOrders.id, input.orderId),
                eq(
                  eventRegistrationAddonPurchaseOrders.registrationId,
                  input.registrationId,
                ),
                eq(
                  eventRegistrationAddonPurchaseOrders.tenantId,
                  input.tenantId,
                ),
                eq(
                  eventRegistrationAddonPurchaseOrders.transactionId,
                  input.transactionId,
                ),
              ),
            )
            .for('update');
          const order = orderRows[0];
          if (!transaction || !order) {
            return yield* checkoutError(
              input,
              'Add-on Checkout transaction or order ownership changed',
            );
          }
          if (
            transaction.amount !== order.expectedGrossAmount ||
            transaction.amount !== claim.amount ||
            transaction.appFee !== order.applicationFeeAmount ||
            transaction.currency !== order.currency ||
            transaction.currency !== claim.currency ||
            (transaction.paymentIntentId !== null &&
              transaction.paymentIntentId !== paymentIntentId) ||
            order.expiresAt?.getTime() !== claimExpiresAt.getTime() ||
            order.requestedByUserId !== registration.userId ||
            order.eventId !== registration.eventId ||
            order.registrationOptionId !== registration.registrationOptionId
          ) {
            return yield* checkoutError(
              input,
              'Locked add-on Checkout commercial ownership changed',
            );
          }
          const transition = resolveAddonPurchaseTerminalTransition({
            orderStatus: order.status,
            registrationStatus: registration.status,
            requested: 'complete',
            transactionStatus: transaction.status,
          });
          if (transition === 'opposite_terminal_won') {
            return yield* checkoutError(
              input,
              'Add-on Checkout expiry completed before payment finalization',
            );
          }
          if (transition === 'inconsistent') {
            return yield* checkoutError(
              input,
              'Add-on Checkout lifecycle is inconsistent',
            );
          }

          const purchases = yield* tx
            .select()
            .from(eventRegistrationAddonPurchases)
            .where(
              and(
                eq(
                  eventRegistrationAddonPurchases.registrationId,
                  input.registrationId,
                ),
                eq(eventRegistrationAddonPurchases.addonId, order.addonId),
                eq(eventRegistrationAddonPurchases.tenantId, input.tenantId),
              ),
            )
            .for('update');
          const purchase = purchases[0];
          const lots = yield* tx
            .select({
              id: eventRegistrationAddonPurchaseLots.id,
              purchaseId: eventRegistrationAddonPurchaseLots.purchaseId,
              sourceTransactionId:
                eventRegistrationAddonPurchaseLots.sourceTransactionId,
            })
            .from(eventRegistrationAddonPurchaseLots)
            .where(
              and(
                eq(eventRegistrationAddonPurchaseLots.id, order.purchaseLotId),
                eq(eventRegistrationAddonPurchaseLots.tenantId, input.tenantId),
              ),
            )
            .for('update');
          const lot = lots[0];

          if (transition === 'already_applied') {
            if (
              !purchase ||
              purchase.id !== order.purchaseId ||
              !lot ||
              lot.purchaseId !== order.purchaseId ||
              lot.sourceTransactionId !== input.transactionId
            ) {
              return yield* checkoutError(
                input,
                'Completed add-on Checkout entitlement is missing',
              );
            }
            return 'alreadyCompleted' as const;
          }
          if (lot) {
            return yield* checkoutError(
              input,
              'Pending add-on Checkout already has a purchase lot',
            );
          }

          const completedTransactions = yield* tx
            .update(transactions)
            .set({
              status: 'successful',
              stripeChargeId,
              stripeCheckoutReconcileLastError: null,
              stripeCheckoutReconcileLeaseExpiresAt: null,
              stripeCheckoutReconcileLeaseId: null,
              stripeCheckoutReconcileNextAt: null,
              stripePaymentIntentId: paymentIntentId,
            })
            .where(
              and(
                eq(transactions.id, input.transactionId),
                eq(transactions.status, 'pending'),
                eq(transactions.type, 'addon'),
              ),
            )
            .returning({ id: transactions.id });
          if (completedTransactions.length !== 1) {
            return yield* checkoutError(
              input,
              'Locked add-on payment could not be completed',
            );
          }

          if (purchase) {
            if (purchase.id !== order.purchaseId) {
              return yield* checkoutError(
                input,
                'Add-on entitlement identity changed during Checkout',
              );
            }
            const updated = yield* tx
              .update(eventRegistrationAddonPurchases)
              .set({
                purchasedQuantity: sql`${eventRegistrationAddonPurchases.purchasedQuantity} + ${order.quantity}`,
                quantity: sql`${eventRegistrationAddonPurchases.quantity} + ${order.quantity}`,
                taxRateDisplayName: order.taxRateDisplayName,
                taxRateInclusive: order.taxRateInclusive,
                taxRatePercentage: order.taxRatePercentage,
                unitPrice: order.unitPrice,
              })
              .where(eq(eventRegistrationAddonPurchases.id, purchase.id))
              .returning({ id: eventRegistrationAddonPurchases.id });
            if (updated.length !== 1) {
              return yield* checkoutError(
                input,
                'Existing add-on entitlement could not be updated',
              );
            }
          } else {
            yield* tx.insert(eventRegistrationAddonPurchases).values({
              addonId: order.addonId,
              eventId: order.eventId,
              id: order.purchaseId,
              includedQuantity: 0,
              purchasedQuantity: order.quantity,
              quantity: order.quantity,
              registrationId: order.registrationId,
              registrationOptionId: order.registrationOptionId,
              taxRateDisplayName: order.taxRateDisplayName,
              taxRateInclusive: order.taxRateInclusive,
              taxRatePercentage: order.taxRatePercentage,
              tenantId: order.tenantId,
              unitPrice: order.unitPrice,
            });
          }
          yield* tx.insert(eventRegistrationAddonPurchaseLots).values({
            baseAmount: order.baseAmount,
            currency: order.currency,
            eventId: order.eventId,
            id: order.purchaseLotId,
            purchaseId: order.purchaseId,
            quantity: order.quantity,
            registrationId: order.registrationId,
            registrationOptionId: order.registrationOptionId,
            sourceLineKey: `addon-order:${order.id}`,
            sourceTransactionId: input.transactionId,
            taxRateDisplayName: order.taxRateDisplayName,
            taxRateInclusive: order.taxRateInclusive,
            taxRatePercentage: order.taxRatePercentage,
            tenantId: order.tenantId,
            unitPrice: order.unitPrice,
          });
          const completedOrders = yield* tx
            .update(eventRegistrationAddonPurchaseOrders)
            .set({ completedAt: new Date(), status: 'completed' })
            .where(
              and(
                eq(eventRegistrationAddonPurchaseOrders.id, order.id),
                eq(
                  eventRegistrationAddonPurchaseOrders.status,
                  'pending_payment',
                ),
                eq(
                  eventRegistrationAddonPurchaseOrders.transactionId,
                  input.transactionId,
                ),
              ),
            )
            .returning({ id: eventRegistrationAddonPurchaseOrders.id });
          if (completedOrders.length !== 1) {
            return yield* checkoutError(
              input,
              'Locked add-on order could not be completed',
            );
          }
          return 'finalized' as const;
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof AddonPurchaseCheckoutError
            ? cause
            : checkoutError(
                input,
                'Add-on Checkout completion could not be persisted',
                cause,
              ),
        ),
      ),
  );
  yield* ensureAddonPaymentAllocations(input.transactionId).pipe(
    Effect.catch((error) =>
      Effect.logWarning(
        'Add-on Checkout completed before its payment fee allocation was ready',
      ).pipe(
        Effect.annotateLogs({
          cause: error,
          orderId: input.orderId,
          transactionId: input.transactionId,
        }),
      ),
    ),
  );
  return completion;
});

export interface ExpireAddonPurchaseCheckoutInput extends Omit<
  AddonPurchaseCheckoutIdentity,
  'stripeCheckoutSessionId'
> {
  readonly now?: Date | undefined;
  readonly requireDeadline?: boolean | undefined;
  readonly stripeCheckoutSessionId: null | string;
}

/** Releases one paid stock reservation exactly once. */
export const expirePaidAddonPurchaseCheckout = Effect.fn(
  'expirePaidAddonPurchaseCheckout',
)(function* (input: ExpireAddonPurchaseCheckoutInput) {
  const now = input.now ?? new Date();
  return yield* Database.use((database) =>
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          const registrations = yield* tx
            .select({ status: eventRegistrations.status })
            .from(eventRegistrations)
            .where(
              and(
                eq(eventRegistrations.id, input.registrationId),
                eq(eventRegistrations.tenantId, input.tenantId),
              ),
            )
            .for('update');
          const registration = registrations[0];
          if (!registration) {
            return yield* checkoutError(
              input,
              'Add-on Checkout registration no longer exists',
            );
          }

          yield* tx
            .select({ id: registrationTransfers.id })
            .from(registrationTransfers)
            .where(
              activeRegistrationTransferMutationPredicate({
                registrationId: input.registrationId,
                tenantId: input.tenantId,
              }),
            )
            .for('update');

          const transactionRows = yield* tx
            .select({ status: transactions.status })
            .from(transactions)
            .where(
              and(
                eq(transactions.id, input.transactionId),
                eq(transactions.eventRegistrationId, input.registrationId),
                eq(transactions.method, 'stripe'),
                eq(transactions.stripeAccountId, input.stripeAccountId),
                input.stripeCheckoutSessionId
                  ? eq(
                      transactions.stripeCheckoutSessionId,
                      input.stripeCheckoutSessionId,
                    )
                  : isNull(transactions.stripeCheckoutSessionId),
                eq(transactions.tenantId, input.tenantId),
                eq(transactions.type, 'addon'),
              ),
            )
            .for('update');
          const transaction = transactionRows[0];
          const orderRows = yield* tx
            .select()
            .from(eventRegistrationAddonPurchaseOrders)
            .where(
              and(
                eq(eventRegistrationAddonPurchaseOrders.id, input.orderId),
                eq(
                  eventRegistrationAddonPurchaseOrders.registrationId,
                  input.registrationId,
                ),
                eq(
                  eventRegistrationAddonPurchaseOrders.tenantId,
                  input.tenantId,
                ),
                eq(
                  eventRegistrationAddonPurchaseOrders.transactionId,
                  input.transactionId,
                ),
              ),
            )
            .for('update');
          const order = orderRows[0];
          if (!transaction || !order) {
            return yield* checkoutError(
              input,
              'Add-on Checkout expiry ownership changed',
            );
          }
          const transition = resolveAddonPurchaseTerminalTransition({
            orderStatus: order.status,
            registrationStatus: registration.status,
            requested: 'expire',
            transactionStatus: transaction.status,
          });
          if (transition === 'already_applied')
            return 'alreadyExpired' as const;
          if (transition === 'opposite_terminal_won') {
            return 'alreadyCompleted' as const;
          }
          if (transition === 'inconsistent') {
            return yield* checkoutError(
              input,
              'Add-on Checkout expiry lifecycle is inconsistent',
            );
          }
          if (
            (input.requireDeadline ?? true) &&
            (!order.expiresAt || order.expiresAt > now)
          ) {
            return yield* checkoutError(
              input,
              'Add-on Checkout has not reached its persisted expiry',
            );
          }

          const lots = yield* tx
            .select({ id: eventRegistrationAddonPurchaseLots.id })
            .from(eventRegistrationAddonPurchaseLots)
            .where(
              and(
                eq(eventRegistrationAddonPurchaseLots.id, order.purchaseLotId),
                eq(eventRegistrationAddonPurchaseLots.tenantId, input.tenantId),
              ),
            )
            .for('update');
          if (lots.length > 0) {
            return yield* checkoutError(
              input,
              'Pending add-on Checkout already exposes an entitlement lot',
            );
          }

          const expiredTransactions = yield* tx
            .update(transactions)
            .set({
              status: 'cancelled',
              stripeCheckoutReconcileLastError: null,
              stripeCheckoutReconcileLeaseExpiresAt: null,
              stripeCheckoutReconcileLeaseId: null,
              stripeCheckoutReconcileNextAt: null,
            })
            .where(
              and(
                eq(transactions.id, input.transactionId),
                eq(transactions.status, 'pending'),
                eq(transactions.type, 'addon'),
              ),
            )
            .returning({ id: transactions.id });
          const expiredOrders = yield* tx
            .update(eventRegistrationAddonPurchaseOrders)
            .set({ expiredAt: now, status: 'expired' })
            .where(
              and(
                eq(eventRegistrationAddonPurchaseOrders.id, order.id),
                eq(
                  eventRegistrationAddonPurchaseOrders.status,
                  'pending_payment',
                ),
              ),
            )
            .returning({ id: eventRegistrationAddonPurchaseOrders.id });
          if (expiredTransactions.length !== 1 || expiredOrders.length !== 1) {
            return yield* checkoutError(
              input,
              'Locked add-on Checkout could not be expired',
            );
          }

          const releasedStock = yield* tx
            .update(eventAddons)
            .set({
              totalAvailableQuantity: sql`${eventAddons.totalAvailableQuantity} + ${order.quantity}`,
            })
            .where(
              and(
                eq(eventAddons.id, order.addonId),
                eq(eventAddons.eventId, order.eventId),
              ),
            )
            .returning({ id: eventAddons.id });
          if (releasedStock.length !== 1) {
            return yield* checkoutError(
              input,
              'Expired add-on Checkout stock could not be released',
            );
          }
          return 'expired' as const;
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof AddonPurchaseCheckoutError
            ? cause
            : checkoutError(
                input,
                'Add-on Checkout expiry could not be persisted',
                cause,
              ),
        ),
      ),
  );
});
