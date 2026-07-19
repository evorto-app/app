import Stripe from 'stripe';

import { deriveRegistrationPaymentFeeSnapshot } from '@server/payments/registration-payment-fee-snapshot';

const settlementPollIntervalsMs = [250, 500, 1_000, 2_000, 4_000, 4_000];

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export interface SettledStripeTestPayment {
  readonly chargeId: string;
  readonly paymentIntentId: string;
}

/**
 * Creates a real test-mode connected-account payment and waits until Stripe's
 * balance transaction is available. Signed webhook tests can then exercise the
 * production fee/ownership reconciliation without inventing a charge id that
 * Stripe cannot resolve.
 */
export const createSettledStripeTestPayment = async (input: {
  readonly amount: number;
  readonly applicationFeeAmount: null | number;
  readonly currency: string;
  readonly stripeAccountId: string;
  readonly transactionId: string;
}): Promise<SettledStripeTestPayment> => {
  const stripeApiKey = process.env['STRIPE_API_KEY']?.trim();
  if (!stripeApiKey) {
    throw new Error(
      'STRIPE_API_KEY is required for settled registration payment tests',
    );
  }
  if (!/^[rs]k_test_/u.test(stripeApiKey)) {
    throw new Error(
      'Settled registration payment tests require an explicit Stripe test-mode API key',
    );
  }
  const applicationFeeAmount = input.applicationFeeAmount ?? 0;
  if (
    !Number.isSafeInteger(input.amount) ||
    input.amount <= 0 ||
    !Number.isSafeInteger(applicationFeeAmount) ||
    applicationFeeAmount < 0 ||
    applicationFeeAmount >= input.amount
  ) {
    throw new Error('Expected valid settled registration payment amounts');
  }

  const stripe = new Stripe(stripeApiKey, {
    apiVersion: '2026-06-24.dahlia',
  });
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: input.amount,
      ...(applicationFeeAmount > 0 && {
        application_fee_amount: applicationFeeAmount,
      }),
      confirm: true,
      currency: input.currency.toLowerCase(),
      metadata: {
        evortoE2eTransactionId: input.transactionId,
      },
      payment_method: 'pm_card_visa',
      payment_method_types: ['card'],
    },
    {
      idempotencyKey: `evorto-e2e-registration-payment:${input.transactionId}`,
      stripeAccount: input.stripeAccountId,
    },
  );
  if (paymentIntent.status !== 'succeeded') {
    throw new Error(
      `Expected Stripe test payment to succeed, received ${paymentIntent.status}`,
    );
  }
  const chargeId =
    typeof paymentIntent.latest_charge === 'string'
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id;
  if (!chargeId) {
    throw new Error('Expected Stripe test payment to expose its charge');
  }

  for (const interval of settlementPollIntervalsMs) {
    const charge = await stripe.charges.retrieve(
      chargeId,
      { expand: ['balance_transaction'] },
      { stripeAccount: input.stripeAccountId },
    );
    const snapshot = deriveRegistrationPaymentFeeSnapshot({
      charge,
      expectedCurrency: input.currency,
      expectedGrossAmount: input.amount,
      expectedPaymentIntentId: paymentIntent.id,
    });
    if (snapshot) {
      return { chargeId, paymentIntentId: paymentIntent.id };
    }
    await delay(interval);
  }

  throw new Error(
    'Stripe test payment did not expose a settled balance transaction in time',
  );
};
