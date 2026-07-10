import type Stripe from 'stripe';

import { Database } from '@db/index';
import { transactions } from '@db/schema';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import { StripeClient } from '../stripe-client';

export interface RegistrationPaymentFeeSnapshot {
  readonly appFee: number;
  readonly grossAmount: number;
  readonly stripeChargeId: string;
  readonly stripeFee: number;
  readonly stripeNetAmount: number;
}

export class RegistrationPaymentFeeSnapshotRetryableError extends Schema.TaggedErrorClass<RegistrationPaymentFeeSnapshotRetryableError>()(
  'RegistrationPaymentFeeSnapshotRetryableError',
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    sourceTransactionId: Schema.String,
  },
) {}

const stripeReferenceId = (
  reference: null | string | { readonly id: string },
): string | undefined =>
  typeof reference === 'string' ? reference : reference?.id;

export const deriveRegistrationPaymentFeeSnapshot = (input: {
  readonly charge: Stripe.Charge;
  readonly expectedCurrency: string;
  readonly expectedGrossAmount: number;
  readonly expectedPaymentIntentId: null | string;
}): RegistrationPaymentFeeSnapshot | undefined => {
  const { charge } = input;
  const balanceTransaction = charge.balance_transaction;
  if (
    charge.amount !== input.expectedGrossAmount ||
    charge.currency.toUpperCase() !== input.expectedCurrency.toUpperCase() ||
    !charge.paid ||
    !charge.captured ||
    typeof balanceTransaction !== 'object' ||
    !balanceTransaction ||
    balanceTransaction.amount !== input.expectedGrossAmount ||
    balanceTransaction.currency.toUpperCase() !==
      input.expectedCurrency.toUpperCase()
  ) {
    return;
  }

  const paymentIntentId = stripeReferenceId(charge.payment_intent);
  if (
    input.expectedPaymentIntentId &&
    paymentIntentId !== input.expectedPaymentIntentId
  ) {
    return;
  }

  return {
    appFee:
      balanceTransaction.fee_details.find(
        (fee) => fee.type === 'application_fee',
      )?.amount ?? 0,
    grossAmount: input.expectedGrossAmount,
    stripeChargeId: charge.id,
    stripeFee:
      balanceTransaction.fee_details.find((fee) => fee.type === 'stripe_fee')
        ?.amount ?? 0,
    stripeNetAmount: balanceTransaction.net,
  };
};

const retryableSnapshotError = (
  sourceTransactionId: string,
  message: string,
  cause?: unknown,
) =>
  new RegistrationPaymentFeeSnapshotRetryableError({
    ...(cause !== undefined && { cause }),
    message,
    sourceTransactionId,
  });

export const ensureRegistrationPaymentFeeSnapshot = Effect.fn(
  'ensureRegistrationPaymentFeeSnapshot',
)(function* (sourceTransactionId: string) {
  const sourceRows = yield* Database.use((database) =>
    database
      .select({
        amount: transactions.amount,
        appFee: transactions.appFee,
        currency: transactions.currency,
        stripeAccountId: transactions.stripeAccountId,
        stripeChargeId: transactions.stripeChargeId,
        stripeFee: transactions.stripeFee,
        stripeNetAmount: transactions.stripeNetAmount,
        stripePaymentIntentId: transactions.stripePaymentIntentId,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.id, sourceTransactionId),
          eq(transactions.method, 'stripe'),
          eq(transactions.status, 'successful'),
          inArray(transactions.type, ['registration', 'addon']),
        ),
      )
      .limit(1),
  ).pipe(
    Effect.mapError((cause) =>
      retryableSnapshotError(
        sourceTransactionId,
        'Registration payment fee snapshot lookup failed; retry the transfer',
        cause,
      ),
    ),
  );
  const source = sourceRows[0];
  if (!source?.stripeAccountId) {
    return yield* retryableSnapshotError(
      sourceTransactionId,
      'Registration payment has no persisted Stripe account; retry after reconciliation',
    );
  }
  const stripeAccountId = source.stripeAccountId;
  if (
    source.appFee !== null &&
    source.stripeFee !== null &&
    source.stripeNetAmount !== null &&
    source.stripeChargeId
  ) {
    return {
      appFee: source.appFee,
      grossAmount: source.amount,
      stripeChargeId: source.stripeChargeId,
      stripeFee: source.stripeFee,
      stripeNetAmount: source.stripeNetAmount,
    } satisfies RegistrationPaymentFeeSnapshot;
  }

  const stripe = yield* StripeClient;
  const stripeChargeId = yield* Effect.gen(function* () {
    if (source.stripeChargeId) return source.stripeChargeId;
    if (!source.stripePaymentIntentId) {
      return yield* retryableSnapshotError(
        sourceTransactionId,
        'Registration payment has no Stripe charge reference; retry after reconciliation',
      );
    }
    const stripePaymentIntentId = source.stripePaymentIntentId;

    const paymentIntent = yield* Effect.tryPromise({
      catch: (cause) =>
        retryableSnapshotError(
          sourceTransactionId,
          'Stripe payment lookup failed; retry the transfer',
          cause,
        ),
      try: () =>
        stripe.paymentIntents.retrieve(
          stripePaymentIntentId,
          { expand: ['latest_charge'] },
          { stripeAccount: stripeAccountId },
        ),
    });
    const latestChargeId = stripeReferenceId(paymentIntent.latest_charge);
    if (!latestChargeId) {
      return yield* retryableSnapshotError(
        sourceTransactionId,
        'Stripe payment charge is not available yet; retry the transfer',
      );
    }
    return latestChargeId;
  });

  const charge = yield* Effect.tryPromise({
    catch: (cause) =>
      retryableSnapshotError(
        sourceTransactionId,
        'Stripe charge fee lookup failed; retry the transfer',
        cause,
      ),
    try: () =>
      stripe.charges.retrieve(
        stripeChargeId,
        { expand: ['balance_transaction'] },
        { stripeAccount: stripeAccountId },
      ),
  });
  if (source.stripeChargeId && charge.id !== source.stripeChargeId) {
    return yield* retryableSnapshotError(
      sourceTransactionId,
      'Stripe returned a charge that does not own this registration payment',
    );
  }
  const snapshot = deriveRegistrationPaymentFeeSnapshot({
    charge,
    expectedCurrency: source.currency,
    expectedGrossAmount: source.amount,
    expectedPaymentIntentId: source.stripePaymentIntentId,
  });
  if (!snapshot) {
    return yield* retryableSnapshotError(
      sourceTransactionId,
      'Stripe charge ownership, currency, or gross amount is not reconciled; retry the transfer',
    );
  }

  const updatedRows = yield* Database.use((database) =>
    database
      .update(transactions)
      .set({
        appFee: snapshot.appFee,
        stripeChargeId: snapshot.stripeChargeId,
        stripeFee: snapshot.stripeFee,
        stripeNetAmount: snapshot.stripeNetAmount,
      })
      .where(
        and(
          eq(transactions.id, sourceTransactionId),
          eq(transactions.amount, source.amount),
          eq(transactions.currency, source.currency),
          eq(transactions.method, 'stripe'),
          eq(transactions.status, 'successful'),
          eq(transactions.stripeAccountId, stripeAccountId),
          source.stripeChargeId
            ? eq(transactions.stripeChargeId, source.stripeChargeId)
            : isNull(transactions.stripeChargeId),
          eq(transactions.type, 'registration'),
        ),
      )
      .returning({ id: transactions.id }),
  ).pipe(
    Effect.mapError((cause) =>
      retryableSnapshotError(
        sourceTransactionId,
        'Registration payment fee snapshot persistence failed; retry the transfer',
        cause,
      ),
    ),
  );
  if (updatedRows.length !== 1) {
    return yield* retryableSnapshotError(
      sourceTransactionId,
      'Registration payment changed during fee reconciliation; retry the transfer',
    );
  }

  return snapshot;
});
