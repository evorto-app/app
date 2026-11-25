/**
 * Stripe Connect application fee for a gross charge in the smallest currency
 * unit. The rate comes from `stripeApplicationFeeRateConfig`; each transaction
 * stores the fee it was charged, so a rate change affects only new payments.
 */
export const applicationFeeAmount = (amountCents: number, rate: number) =>
  Math.round(amountCents * rate);
