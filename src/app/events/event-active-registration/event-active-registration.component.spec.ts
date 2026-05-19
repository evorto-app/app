import { describe, expect, it } from 'vitest';

import {
  registrationCancellationCopy,
  registrationDeferredActionCopy,
} from './event-active-registration.component';

describe('registrationCancellationCopy', () => {
  it('describes pending payment cancellation as releasing the reserved spot', () => {
    expect(
      registrationCancellationCopy({
        guestCount: 0,
        paymentPending: true,
        status: 'PENDING',
      }),
    ).toEqual({
      buttonLabel: 'Cancel registration',
      helperText:
        'This cancels the pending registration and releases the reserved spot. It does not complete a payment.',
    });
  });

  it('describes guest cancellation as releasing every selected spot', () => {
    expect(
      registrationCancellationCopy({
        guestCount: 2,
        paymentPending: true,
        status: 'PENDING',
      }),
    ).toEqual({
      buttonLabel: 'Cancel registration',
      helperText:
        'This cancels the pending registration and releases all selected spots. It does not complete a payment.',
    });
  });

  it('describes confirmed cancellation without promising automatic refunds', () => {
    expect(
      registrationCancellationCopy({
        guestCount: 0,
        paymentPending: false,
        status: 'CONFIRMED',
      }),
    ).toEqual({
      buttonLabel: 'Cancel registration',
      helperText:
        'This cancels your confirmed registration and releases your spot. Paid-registration refunds are not automatic yet.',
    });
  });

  it('describes confirmed guest cancellation as releasing every selected spot', () => {
    expect(
      registrationCancellationCopy({
        guestCount: 1,
        paymentPending: false,
        status: 'CONFIRMED',
      }),
    ).toEqual({
      buttonLabel: 'Cancel registration',
      helperText:
        'This cancels your confirmed registration and releases all selected spots. Paid-registration refunds are not automatic yet.',
    });
  });

  it('describes waitlist cancellation as leaving the waitlist', () => {
    expect(
      registrationCancellationCopy({
        guestCount: 0,
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
        guestCount: 0,
        paymentPending: false,
        status: 'CANCELLED',
      }),
    ).toBeNull();
  });
});

describe('registrationDeferredActionCopy', () => {
  it('keeps transfer and resale visibly unavailable for confirmed registrations', () => {
    expect(registrationDeferredActionCopy({ status: 'CONFIRMED' })).toBe(
      'Transfer/resale is not implemented yet. Contact the organizers if someone else should take your spot.',
    );
  });

  it('keeps transfer and resale unavailable for pending or waitlist registrations', () => {
    expect(registrationDeferredActionCopy({ status: 'PENDING' })).toBe(
      'Transfer/resale is not available for pending registrations.',
    );
    expect(registrationDeferredActionCopy({ status: 'WAITLIST' })).toBe(
      'Transfer/resale is not available for waitlist registrations.',
    );
  });

  it('does not show deferred transfer copy after cancellation', () => {
    expect(registrationDeferredActionCopy({ status: 'CANCELLED' })).toBeNull();
  });
});
