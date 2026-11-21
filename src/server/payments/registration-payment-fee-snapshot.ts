import type Stripe from 'stripe';

export interface RegistrationPaymentFeeSnapshot {
  readonly appFee: number;
  readonly grossAmount: number;
  readonly stripeChargeId: string;
  readonly stripeFee: number;
  readonly stripeNetAmount: number;
}

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
