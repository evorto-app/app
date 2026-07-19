import { describe, expect, it } from 'vitest';

import { normalizeStripeCheckoutUrl } from './stripe-checkout-url';

describe('normalizeStripeCheckoutUrl', () => {
  it('normalizes an exact Stripe Checkout URL', () => {
    expect(
      normalizeStripeCheckoutUrl(
        'https://checkout.stripe.com/c/pay/cs_test_123?prefilled_email=person%40example.org',
      ),
    ).toBe(
      'https://checkout.stripe.com/c/pay/cs_test_123?prefilled_email=person%40example.org',
    );
  });

  it.each([
    null,
    undefined,
    '',
    'not a URL',
    'javascript:alert(document.domain)',
    '//checkout.stripe.com/c/pay/cs_test_123',
    'http://checkout.stripe.com/c/pay/cs_test_123',
    'https://checkout.stripe.com.evil.example/c/pay/cs_test_123',
    'https://checkout.stripe.com@evil.example/c/pay/cs_test_123',
    'https://person@checkout.stripe.com/c/pay/cs_test_123',
    'https://person:secret@checkout.stripe.com/c/pay/cs_test_123',
    'https://checkout.stripe.com:444/c/pay/cs_test_123',
  ])('rejects an unsafe checkout destination: %s', (value) => {
    expect(normalizeStripeCheckoutUrl(value)).toBeNull();
  });
});
