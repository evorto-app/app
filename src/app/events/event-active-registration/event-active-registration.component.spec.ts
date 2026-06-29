import { describe, expect, it } from 'vitest';

import { registrationCancellationCopy } from './event-active-registration.component';

describe('registrationCancellationCopy', () => {
  it('describes pending payment cancellation as releasing the reserved spot', () => {
    expect(
      registrationCancellationCopy({
        cancellationClosed: false,
        paymentPending: true,
        status: 'PENDING',
      }),
    ).toEqual({
      buttonLabel: 'Cancel registration',
      canCancel: true,
      helperText:
        'This cancels the pending registration and releases the reserved spot. It does not complete a payment.',
    });
  });

  it('describes confirmed cancellation without promising automatic refunds', () => {
    expect(
      registrationCancellationCopy({
        cancellationClosed: false,
        paymentPending: false,
        status: 'CONFIRMED',
      }),
    ).toEqual({
      buttonLabel: 'Cancel registration',
      canCancel: true,
      helperText:
        'This cancels your confirmed registration and releases your spot. Paid-registration refunds are not automatic yet.',
    });
  });

  it('describes waitlist cancellation as leaving the waitlist', () => {
    expect(
      registrationCancellationCopy({
        cancellationClosed: true,
        paymentPending: false,
        status: 'CONFIRMED',
      }),
    ).toEqual({
      buttonLabel: 'Cancel registration',
      canCancel: false,
      helperText:
        'Registration can no longer be cancelled because the event has already started.',
    });
  });

  it('still allows waitlist cancellation after registration cancellation closes', () => {
    expect(
      registrationCancellationCopy({
        cancellationClosed: true,
        paymentPending: false,
        status: 'WAITLIST',
      }),
    ).toEqual({
      buttonLabel: 'Leave waitlist',
      canCancel: true,
      helperText:
        'This removes you from the waitlist and releases your waitlist spot.',
    });
  });

  it('does not expose cancellation copy for already-cancelled registrations', () => {
    expect(
      registrationCancellationCopy({
        cancellationClosed: false,
        paymentPending: false,
        status: 'CANCELLED',
      }),
    ).toBeNull();
  });
});
