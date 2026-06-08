import { describe, expect, it } from 'vitest';

import { registrationCancellationCopy } from './event-active-registration.component';

describe('registrationCancellationCopy', () => {
  it('describes pending payment cancellation as releasing the reserved spot', () => {
    expect(
      registrationCancellationCopy({
        paymentPending: true,
        status: 'PENDING',
      }),
    ).toEqual({
      buttonLabel: 'Cancel registration',
      helperText:
        'This cancels the pending registration and releases the reserved spot. It does not complete a payment.',
    });
  });

  it('describes confirmed cancellation without promising automatic refunds', () => {
    expect(
      registrationCancellationCopy({
        paymentPending: false,
        status: 'CONFIRMED',
      }),
    ).toEqual({
      buttonLabel: 'Cancel registration',
      helperText:
        'This cancels your confirmed registration and releases your spot. Paid-registration refunds are not automatic yet.',
    });
  });

  it('describes waitlist cancellation as leaving the waitlist', () => {
    expect(
      registrationCancellationCopy({
        paymentPending: false,
        status: 'WAITLIST',
      }),
    ).toEqual({
      buttonLabel: 'Leave waitlist',
      helperText:
        'This removes you from the waitlist and releases your waitlist spot.',
    });
  });

  it('does not expose cancellation copy for already-cancelled registrations', () => {
    expect(
      registrationCancellationCopy({
        paymentPending: false,
        status: 'CANCELLED',
      }),
    ).toBeNull();
  });
});
