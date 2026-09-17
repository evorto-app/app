import { expect, it } from '@effect/vitest';
import { Cause, Effect, Exit } from 'effect';
import Stripe from 'stripe';

import {
  type StripePaymentAccountClient,
  validateStripePaymentAccount,
} from './stripe-payment-account-validation';

const stripeClient = (
  retrieve: (stripeAccountId: string) => PromiseLike<unknown>,
): StripePaymentAccountClient => ({
  accounts: { retrieve },
});

const readyAccount = (stripeAccountId: string) => ({
  charges_enabled: true,
  details_submitted: true,
  id: stripeAccountId,
  object: 'account',
  payouts_enabled: true,
});

it.effect(
  'maps a definitive invalid Stripe account response to bad request',
  () =>
    Effect.gen(function* () {
      const error = yield* validateStripePaymentAccount(
        stripeClient(() =>
          Promise.reject(
            new Stripe.errors.StripeInvalidRequestError({
              code: 'resource_missing',
              headers: {},
              message: 'No such connected account',
              requestId: 'req_missing_account',
              statusCode: 404,
              type: 'invalid_request_error',
            }),
          ),
        ),
        'acct_missing',
      ).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: 'RpcBadRequestError',
        message: 'The payment account could not be verified.',
        reason:
          'Check that the payment account is connected to Evorto, then try again. No settings were changed.',
      });
    }),
);

it.effect('keeps other invalid Stripe requests in the defect channel', () =>
  Effect.gen(function* () {
    const providerFailure = new Stripe.errors.StripeInvalidRequestError({
      code: 'parameter_unknown',
      headers: {},
      message: 'Unexpected parameter',
      requestId: 'req_invalid_contract',
      statusCode: 400,
      type: 'invalid_request_error',
    });
    const exit = yield* validateStripePaymentAccount(
      stripeClient(() => Promise.reject(providerFailure)),
      'acct_target',
    ).pipe(Effect.exit);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBe(providerFailure);
    }
  }),
);

it.effect('keeps generic provider failures in the defect channel', () =>
  Effect.gen(function* () {
    const providerFailure = new Error('Stripe connection failed');
    const exit = yield* validateStripePaymentAccount(
      stripeClient(() => Promise.reject(providerFailure)),
      'acct_target',
    ).pipe(Effect.exit);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBe(providerFailure);
    }
  }),
);

it.effect('keeps malformed provider responses in the defect channel', () =>
  Effect.gen(function* () {
    const exit = yield* validateStripePaymentAccount(
      stripeClient(() => Promise.resolve({ id: 'acct_target' })),
      'acct_target',
    ).pipe(Effect.exit);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toMatchObject({
        message:
          'Stripe account response did not match the expected account shape',
      });
    }
  }),
);

it.effect('keeps a mismatched provider account ID in the defect channel', () =>
  Effect.gen(function* () {
    const exit = yield* validateStripePaymentAccount(
      stripeClient(() => Promise.resolve(readyAccount('acct_other'))),
      'acct_target',
    ).pipe(Effect.exit);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toMatchObject({
        message: 'Stripe account response ID did not match the requested ID',
      });
    }
  }),
);
