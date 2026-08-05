import { MAX_STRIPE_CHECKOUT_LINE_ITEMS } from '@shared/registration-quantity-limits';
import { describe, expect, it } from 'vitest';

import { registrationCheckoutHasTooManyLines } from './registration-checkout-lines';

describe('registration Checkout line limits', () => {
  it('accepts Stripe line capacity and rejects the next line', () => {
    expect(
      registrationCheckoutHasTooManyLines(
        Array.from({ length: MAX_STRIPE_CHECKOUT_LINE_ITEMS }),
      ),
    ).toBe(false);
    expect(
      registrationCheckoutHasTooManyLines(
        Array.from({ length: MAX_STRIPE_CHECKOUT_LINE_ITEMS + 1 }),
      ),
    ).toBe(true);
  });
});
