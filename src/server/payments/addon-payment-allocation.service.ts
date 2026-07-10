import { Database } from '@db/index';
import { eventRegistrationAddonPurchaseLots, transactions } from '@db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import { finalizeAddonPaymentAllocations } from './addon-payment-allocation';
import { ensureRegistrationPaymentFeeSnapshot } from './registration-payment-fee-snapshot';

export class AddonPaymentAllocationReconciliationError extends Schema.TaggedErrorClass<AddonPaymentAllocationReconciliationError>()(
  'AddonPaymentAllocationReconciliationError',
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    sourceTransactionId: Schema.String,
  },
) {}

const reconciliationError = (
  sourceTransactionId: string,
  message: string,
  cause?: unknown,
) =>
  new AddonPaymentAllocationReconciliationError({
    ...(cause !== undefined && { cause }),
    message,
    sourceTransactionId,
  });

/** Finalizes every add-on lot under one successful Stripe source atomically. */
export const ensureAddonPaymentAllocations = Effect.fn(
  'ensureAddonPaymentAllocations',
)(function* (sourceTransactionId: string) {
  const snapshot = yield* ensureRegistrationPaymentFeeSnapshot(
    sourceTransactionId,
  ).pipe(
    Effect.mapError((cause) =>
      reconciliationError(
        sourceTransactionId,
        'Add-on payment fees are not reconciled yet',
        cause,
      ),
    ),
  );

  return yield* Database.use((database) =>
    database
      .transaction((tx) =>
        Effect.gen(function* () {
          const sourceRows = yield* tx
            .select({
              currency: transactions.currency,
              tenantId: transactions.tenantId,
              type: transactions.type,
            })
            .from(transactions)
            .where(eq(transactions.id, sourceTransactionId))
            .for('update');
          const source = sourceRows[0];
          if (
            !source ||
            (source.type !== 'registration' && source.type !== 'addon')
          ) {
            return yield* reconciliationError(
              sourceTransactionId,
              'Add-on allocation source is not a successful payment',
            );
          }

          const lots = yield* tx
            .select({
              baseAmount: eventRegistrationAddonPurchaseLots.baseAmount,
              currency: eventRegistrationAddonPurchaseLots.currency,
              id: eventRegistrationAddonPurchaseLots.id,
              paymentAllocationFinalizedAt:
                eventRegistrationAddonPurchaseLots.paymentAllocationFinalizedAt,
              quantity: eventRegistrationAddonPurchaseLots.quantity,
              taxRateInclusive:
                eventRegistrationAddonPurchaseLots.taxRateInclusive,
              taxRatePercentage:
                eventRegistrationAddonPurchaseLots.taxRatePercentage,
            })
            .from(eventRegistrationAddonPurchaseLots)
            .where(
              and(
                eq(
                  eventRegistrationAddonPurchaseLots.sourceTransactionId,
                  sourceTransactionId,
                ),
                eq(
                  eventRegistrationAddonPurchaseLots.tenantId,
                  source.tenantId,
                ),
              ),
            )
            .for('update');
          if (lots.length === 0) return [];
          if (
            lots.every(
              ({ paymentAllocationFinalizedAt }) =>
                paymentAllocationFinalizedAt,
            )
          ) {
            return lots.map(({ id }) => id);
          }
          if (
            lots.some(
              ({ paymentAllocationFinalizedAt }) =>
                paymentAllocationFinalizedAt,
            ) ||
            lots.some(({ currency }) => currency !== source.currency)
          ) {
            return yield* reconciliationError(
              sourceTransactionId,
              'Add-on payment lots have mixed or partially finalized terms',
            );
          }

          const allocations = yield* finalizeAddonPaymentAllocations({
            applicationFee: snapshot.appFee,
            grossAmount: snapshot.grossAmount,
            includesRegistrationCharge: source.type === 'registration',
            lots,
            stripeFee: snapshot.stripeFee,
          }).pipe(
            Effect.mapError((cause) =>
              reconciliationError(sourceTransactionId, cause.message, cause),
            ),
          );
          const finalizedAt = new Date();
          for (const allocation of allocations) {
            const updated = yield* tx
              .update(eventRegistrationAddonPurchaseLots)
              .set({
                applicationFeeAmount: allocation.applicationFeeAmount,
                grossAmount: allocation.grossAmount,
                netAmount: allocation.netAmount,
                paymentAllocationFinalizedAt: finalizedAt,
                stripeFeeAmount: allocation.stripeFeeAmount,
                taxAmount: allocation.taxAmount,
              })
              .where(
                and(
                  eq(eventRegistrationAddonPurchaseLots.id, allocation.id),
                  eq(
                    eventRegistrationAddonPurchaseLots.sourceTransactionId,
                    sourceTransactionId,
                  ),
                  eq(
                    eventRegistrationAddonPurchaseLots.tenantId,
                    source.tenantId,
                  ),
                  isNull(
                    eventRegistrationAddonPurchaseLots.paymentAllocationFinalizedAt,
                  ),
                ),
              )
              .returning({ id: eventRegistrationAddonPurchaseLots.id });
            if (updated.length !== 1) {
              return yield* reconciliationError(
                sourceTransactionId,
                'Add-on payment allocation changed while it was finalizing',
              );
            }
          }
          return allocations.map(({ id }) => id);
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof AddonPaymentAllocationReconciliationError
            ? cause
            : reconciliationError(
                sourceTransactionId,
                'Add-on payment allocation could not be finalized',
                cause,
              ),
        ),
      ),
  );
});
