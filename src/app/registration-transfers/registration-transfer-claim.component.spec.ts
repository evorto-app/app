import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  registrationTransferCheckoutUrl,
  registrationTransferClaimPayload,
  registrationTransferStatusCopy,
} from './registration-transfer-claim.component';

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(process.cwd(), sourcePath), 'utf8');

describe('registrationTransferClaimPayload', () => {
  it('submits only recipient answers and the claim credential', () => {
    const payload = registrationTransferClaimPayload({
      answers: [
        {
          answer: 'No accessibility needs',
          questionId: 'question-1',
        },
      ],
      credential: 'claim-token',
    });

    expect(payload).toEqual({
      answers: [
        {
          answer: 'No accessibility needs',
          questionId: 'question-1',
        },
      ],
      credential: 'claim-token',
    });
    expect(payload).not.toHaveProperty('addOns');
    expect(payload).not.toHaveProperty('guestCount');
  });
});

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

describe('registration transfer bundle review template', () => {
  it('renders preserved check-in and add-on fulfillment history', () => {
    const template = readSource(
      'src/app/registration-transfers/registration-transfer-claim.component.html',
    );

    expect(template).toContain('Registration check-in');
    expect(template).toContain('claim.bundle.checkInTime | date: "medium"');
    expect(template).toContain('{{ claim.bundle.checkedInGuestCount }} of');
    expect(template).toContain('Available to use');
    expect(template).toContain('{{ addOn.remainingQuantity }}');
    expect(template).toContain('Redeemed');
    expect(template).toContain('{{ addOn.redeemedQuantity }}');
    expect(template).toContain('Cancelled');
    expect(template).toContain('{{ addOn.cancelledQuantity }}');
    expect(template).toContain(
      'existing check-in and use history\n            transfer together',
    );
  });

  it('gives an invalid manual code a security-neutral recovery action', () => {
    const template = readSource(
      'src/app/registration-transfers/registration-transfer-claim.component.html',
    );

    expect(template).toContain('role="alert"');
    expect(template).toContain(
      'We could not open a transfer with this code. Check the complete code and',
    );
    expect(template).not.toContain('errorMessage(claimQuery.error()');
    expect(template).toContain('routerLink="/registration-transfers"');
    expect(template).toContain('Enter another code');
  });
});

describe('registrationTransferStatusCopy', () => {
  it('explains paid-recipient compensation without suggesting another payment', () => {
    const pending = registrationTransferStatusCopy('compensation_pending', {
      state: 'processing',
    });
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
    expect(
      registrationTransferStatusCopy('refund_pending', { state: 'processing' }),
    ).toEqual({
      body: 'The fixed registration bundle now belongs to you. The previous owner refund is queued and may finish asynchronously.',
      title: 'Transfer complete — refund processing',
      tone: 'success',
    });
  });

  it('distinguishes provider action and stopped refund work from processing', () => {
    const actionRequired = registrationTransferStatusCopy(
      'compensation_pending',
      { state: 'actionRequired' },
    );
    const stopped = registrationTransferStatusCopy('refund_pending', {
      state: 'needsAttention',
    });

    expect(actionRequired?.title).toBe(
      'Transfer stopped — refund action required',
    );
    expect(actionRequired?.body).toContain('Do not pay or claim again');
    expect(actionRequired?.body).not.toContain('is processing');
    expect(stopped?.title).toBe('Transfer complete — refund needs attention');
    expect(stopped?.body).toContain('processing stopped');
  });

  it('fails closed when a pending transfer has no refund projection', () => {
    const copy = registrationTransferStatusCopy('refund_pending', null);

    expect(copy?.tone).toBe('error');
    expect(copy?.title).toContain('needs attention');
  });

  it('directs failed refunds to operator recovery without asking the participant to retry', () => {
    const copy = registrationTransferStatusCopy('refund_failed');

    expect(copy?.title).toBe('Transfer complete — refund needs attention');
    expect(copy?.body).toContain('You do not need to pay or claim again');
    expect(copy?.body).toContain(
      'a platform administrator must safely requeue the existing refund',
    );
  });

  it('states that an expired Checkout preserves the source registration', () => {
    expect(registrationTransferStatusCopy('expired')?.body).toContain(
      'previous owner kept their confirmed registration',
    );
  });
});
