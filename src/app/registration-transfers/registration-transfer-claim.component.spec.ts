import { describe, expect, it } from 'vitest';

import {
  registrationTransferCheckoutUrl,
  registrationTransferStatusCopy,
} from './registration-transfer-claim.component';

describe('registrationTransferCheckoutUrl', () => {
  it('accepts only an exact HTTPS Stripe Checkout host', () => {
    expect(
      registrationTransferCheckoutUrl(
        'https://checkout.stripe.com/c/pay/cs_test_123',
      ),
    ).toBe('https://checkout.stripe.com/c/pay/cs_test_123');
    expect(
      registrationTransferCheckoutUrl(
        'https://checkout.stripe.com.evil.example/cs_test_123',
      ),
    ).toBeUndefined();
    expect(
      registrationTransferCheckoutUrl('javascript:alert(document.domain)'),
    ).toBeUndefined();
  });
});

describe('registrationTransferStatusCopy', () => {
  it('explains paid-recipient compensation without suggesting another payment', () => {
    const pending = registrationTransferStatusCopy('compensation_pending');
    const failed = registrationTransferStatusCopy('compensation_failed');
    const completed = registrationTransferStatusCopy('compensated');

    expect(pending?.body).toContain('full refund');
    expect(pending?.body).toContain('including the platform fee');
    expect(failed?.body).toContain('must requeue the existing refund');
    expect(completed?.body).toContain('was refunded');
    for (const copy of [pending, failed, completed]) {
      expect(copy?.body).toContain('Do not pay or claim again');
    }
  });

  it('keeps recipient ownership truthful while a source refund is pending', () => {
    expect(registrationTransferStatusCopy('refund_pending')).toEqual({
      body: 'Your registration is confirmed and the previous owner was cancelled. Their refund is queued and may finish asynchronously.',
      title: 'Transfer complete — refund processing',
      tone: 'success',
    });
  });

  it('directs failed refunds to operator recovery without asking the participant to retry', () => {
    const copy = registrationTransferStatusCopy('refund_failed');

    expect(copy?.title).toBe('Transfer complete — refund needs attention');
    expect(copy?.body).toContain('You do not need to pay or claim again');
    expect(copy?.body).toContain(
      'finance or platform administrator must safely requeue the existing refund',
    );
  });

  it('states that an expired Checkout preserves the source registration', () => {
    expect(registrationTransferStatusCopy('expired')?.body).toContain(
      'previous owner kept their confirmed registration',
    );
  });
});
