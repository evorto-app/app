import { describe, expect, it } from '@effect/vitest';
import { defaultStripeApplicationFeeRate } from '@server/config/stripe-config';

import { applicationFeeAmount } from './application-fee';

describe('applicationFeeAmount', () => {
  it('keeps the default rate rounding for existing charge amounts', () => {
    expect(
      [0, 1, 99, 1000, 12_345].map((amountCents) =>
        applicationFeeAmount(amountCents, defaultStripeApplicationFeeRate),
      ),
    ).toEqual([0, 0, 3, 35, 432]);
  });

  it('applies a configured rate', () => {
    expect(applicationFeeAmount(12_345, 0)).toBe(0);
    expect(applicationFeeAmount(12_345, 0.05)).toBe(617);
  });
});
