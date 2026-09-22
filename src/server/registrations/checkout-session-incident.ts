import { Database } from '@db/index';
import { type RegistrationCheckoutSnapshot, transactions } from '@db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

export const checkoutSessionIncidentLastError =
  'A payment page was created but could not be linked or safely closed. Manual review is required.';

export interface CheckoutSessionIncidentInput {
  readonly amount: number;
  readonly appFee: number;
  readonly currency: typeof transactions.$inferSelect.currency;
  readonly eventId: string;
  readonly method: 'stripe';
  readonly operation: string;
  readonly registrationId: string;
  readonly stripeAccountId: string;
  readonly stripeCheckoutRequest: RegistrationCheckoutSnapshot;
  readonly stripeCheckoutSessionId: string;
  readonly targetUserId: string;
  readonly tenantId: string;
  readonly transactionId: string;
  readonly type: 'addon' | 'registration';
}

export class CheckoutSessionIncidentError extends Schema.TaggedError<CheckoutSessionIncidentError>()(
  'CheckoutSessionIncidentError',
  {
    message: Schema.String,
    operation: Schema.String,
    stripeAccountId: Schema.String,
    stripeCheckoutSessionId: Schema.String,
    transactionId: Schema.String,
  },
) {}

const failCheckoutSessionIncident = (
  input: CheckoutSessionIncidentInput,
  message: string,
) =>
  Effect.logError(message).pipe(
    Effect.annotateLogs({
      operation: input.operation,
      stripeAccountId: input.stripeAccountId,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      transactionId: input.transactionId,
    }),
    Effect.andThen(
      Effect.fail(
        new CheckoutSessionIncidentError({
          message,
          operation: input.operation,
          stripeAccountId: input.stripeAccountId,
          stripeCheckoutSessionId: input.stripeCheckoutSessionId,
          transactionId: input.transactionId,
        }),
      ),
    ),
  );

/**
 * Records durable evidence for one known Checkout session that could neither be
 * bound to its exact claim nor proven stopped. This deliberately does not
 * change the transaction's business status.
 */
export const recordCheckoutSessionIncident = Effect.fn(
  'recordCheckoutSessionIncident',
)(function* (input: CheckoutSessionIncidentInput) {
  const updated = yield* Database.use((database) =>
    database
      .update(transactions)
      .set({
        stripeCheckoutIncidentSessionId: input.stripeCheckoutSessionId,
        stripeCheckoutReconcileLastError: checkoutSessionIncidentLastError,
        stripeCheckoutReconcileLeaseExpiresAt: null,
        stripeCheckoutReconcileLeaseId: null,
        stripeCheckoutReconcileNextAt: null,
      })
      .where(
        and(
          eq(transactions.id, input.transactionId),
          eq(transactions.tenantId, input.tenantId),
          eq(transactions.eventRegistrationId, input.registrationId),
          eq(transactions.eventId, input.eventId),
          eq(transactions.targetUserId, input.targetUserId),
          eq(transactions.type, input.type),
          eq(transactions.method, input.method),
          eq(transactions.amount, input.amount),
          eq(transactions.currency, input.currency),
          eq(transactions.appFee, input.appFee),
          eq(transactions.stripeAccountId, input.stripeAccountId),
          eq(transactions.stripeCheckoutRequest, input.stripeCheckoutRequest),
          isNull(transactions.stripeCheckoutSessionId),
          isNull(transactions.stripeCheckoutUrl),
          isNull(transactions.stripeCheckoutIncidentSessionId),
        ),
      )
      .returning({ id: transactions.id }),
  );

  if (updated.length !== 1) {
    return yield* failCheckoutSessionIncident(
      input,
      'The unbound payment-session incident no longer matched its exact transaction claim',
    );
  }
});
