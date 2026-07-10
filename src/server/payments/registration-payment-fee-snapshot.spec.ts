import type Stripe from 'stripe';

import { describe, expect, it } from '@effect/vitest';

import { deriveRegistrationPaymentFeeSnapshot } from './registration-payment-fee-snapshot';

const charge = {
  amount: 10_000,
  balance_transaction: {
    amount: 10_000,
    currency: 'eur',
    fee_details: [
      { amount: 350, type: 'application_fee' },
      { amount: 175, type: 'stripe_fee' },
    ],
    net: 9475,
  },
  captured: true,
  currency: 'eur',
  id: 'ch_123',
  paid: true,
  payment_intent: 'pi_123',
} as Stripe.Charge;

describe('registration payment fee snapshots', () => {
  it('derives fee and net fields while retaining the immutable gross', () => {
    expect(
      deriveRegistrationPaymentFeeSnapshot({
        charge,
        expectedCurrency: 'EUR',
        expectedGrossAmount: 10_000,
        expectedPaymentIntentId: 'pi_123',
      }),
    ).toEqual({
      appFee: 350,
      grossAmount: 10_000,
      stripeChargeId: 'ch_123',
      stripeFee: 175,
      stripeNetAmount: 9475,
    });
  });

  it('rejects charge ownership, currency, and gross mismatches', () => {
    expect(
      deriveRegistrationPaymentFeeSnapshot({
        charge,
        expectedCurrency: 'CZK',
        expectedGrossAmount: 10_000,
        expectedPaymentIntentId: 'pi_123',
      }),
    ).toBeUndefined();
    expect(
      deriveRegistrationPaymentFeeSnapshot({
        charge,
        expectedCurrency: 'EUR',
        expectedGrossAmount: 9000,
        expectedPaymentIntentId: 'pi_123',
      }),
    ).toBeUndefined();
    expect(
      deriveRegistrationPaymentFeeSnapshot({
        charge,
        expectedCurrency: 'EUR',
        expectedGrossAmount: 10_000,
        expectedPaymentIntentId: 'pi_other',
      }),
    ).toBeUndefined();
  });
});
