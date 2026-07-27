import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { Effect, Schema } from 'effect';
import Stripe from 'stripe';

const stripeAccountLookupFailureDetails = {
  message: 'Stripe account could not be verified',
  reason:
    'Confirm that the account ID exists and is connected to this Stripe platform, then retry. No settings were changed.',
} as const;

const stripeAccountNotReadyDetails = {
  message: 'Stripe account is not ready for payments',
  reason:
    'Complete Stripe onboarding and enable both charges and payouts for this account, then retry. No settings were changed.',
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

export const validateStripePaymentAccount = Effect.fn(
  'validateStripePaymentAccount',
)(function* (stripe: StripePaymentAccountClient, stripeAccountId: string) {
  const response = yield* Effect.tryPromise({
    catch: (error) => error,
    try: () => Promise.resolve(stripe.accounts.retrieve(stripeAccountId)),
  }).pipe(
    Effect.catch((error) =>
      error instanceof Stripe.errors.StripeInvalidRequestError
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
