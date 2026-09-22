import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { Effect, Schema } from 'effect';
import Stripe from 'stripe';

const stripeAccountLookupFailureDetails = {
  message: 'The payment account could not be verified.',
  reason:
    'Check that the payment account is connected to Evorto, then try again. No settings were changed.',
} as const;

const stripeAccountNotReadyDetails = {
  message: 'The payment account is not ready to receive payments.',
  reason:
    'Finish setting up the payment account so it can receive payments and send payouts, then try again. No settings were changed.',
} as const;

const StripePaymentAccount = Schema.Struct({
  charges_enabled: Schema.Boolean,
  details_submitted: Schema.Boolean,
  id: Schema.NonEmptyString,
  object: Schema.Literal('account'),
  payouts_enabled: Schema.Boolean,
});

export interface StripePaymentAccountClient {
  readonly accounts: {
    readonly retrieve: (stripeAccountId: string) => PromiseLike<unknown>;
  };
}

const isDefinitiveMissingStripeAccount = (
  error: unknown,
): error is Stripe.errors.StripeInvalidRequestError =>
  error instanceof Stripe.errors.StripeInvalidRequestError &&
  error.statusCode === 404 &&
  error.code === 'resource_missing';

export const validateStripePaymentAccount = Effect.fn(
  'validateStripePaymentAccount',
)(function* (stripe: StripePaymentAccountClient, stripeAccountId: string) {
  const response = yield* Effect.tryPromise({
    catch: (error) => error,
    try: () => Promise.resolve(stripe.accounts.retrieve(stripeAccountId)),
  }).pipe(
    Effect.catch((error) =>
      isDefinitiveMissingStripeAccount(error)
        ? Effect.fail(new RpcBadRequestError(stripeAccountLookupFailureDetails))
        : Effect.die(error),
    ),
  );
  const account = yield* Schema.decodeUnknownEffect(StripePaymentAccount)(
    response,
  ).pipe(
    Effect.mapError(
      () =>
        new Error(
          'Stripe account response did not match the expected account shape',
        ),
    ),
    Effect.orDie,
  );

  if (account.id !== stripeAccountId) {
    return yield* Effect.die(
      new Error('Stripe account response ID did not match the requested ID'),
    );
  }
  if (
    !account.details_submitted ||
    !account.charges_enabled ||
    !account.payouts_enabled
  ) {
    return yield* new RpcBadRequestError(stripeAccountNotReadyDetails);
  }
});
