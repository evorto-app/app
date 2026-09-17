import { describe, expect, it } from 'vitest';

import {
  normalizeStripeCheckoutUrl,
  stripeCheckoutUrlMatchesSession,
} from './stripe-checkout-url';

const sessionId = 'cs_test_123';
const checkoutUrl =
  'https://checkout.stripe.com/c/pay/cs_test_123?prefilled_email=person%40example.org';

describe('normalizeStripeCheckoutUrl', () => {
  it('normalizes an exact Stripe Checkout URL', () => {
    expect(normalizeStripeCheckoutUrl(checkoutUrl)).toBe(checkoutUrl);
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

describe('stripeCheckoutUrlMatchesSession', () => {
  it('requires the exact session ID as the final path segment', () => {
    expect(stripeCheckoutUrlMatchesSession(checkoutUrl, sessionId)).toBe(true);
  });

  it.each([
    [
      'wrong host',
      'https://checkout.stripe.com.evil.example/c/pay/cs_test_123',
    ],
    [
      'credentials',
      'https://person:secret@checkout.stripe.com/c/pay/cs_test_123',
    ],
    ['port', 'https://checkout.stripe.com:444/c/pay/cs_test_123'],
    ['prefix', 'https://checkout.stripe.com/c/pay/prefix-cs_test_123'],
    ['suffix', 'https://checkout.stripe.com/c/pay/cs_test_123-suffix'],
    [
      'intermediate segment',
      'https://checkout.stripe.com/c/pay/cs_test_123/continue',
    ],
    ['encoded ID', 'https://checkout.stripe.com/c/pay/%63s_test_123'],
  ])('rejects a URL with a %s mismatch', (_name, value) => {
    expect(stripeCheckoutUrlMatchesSession(value, sessionId)).toBe(false);
  });
});
