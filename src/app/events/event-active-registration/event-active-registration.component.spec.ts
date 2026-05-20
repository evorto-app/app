import { describe, expect, it } from 'vitest';

import {
  registrationCancellationActionDisabled,
  registrationCancellationCopy,
  registrationDeferredActionCopy,
  registrationTransferActionCopy,
  registrationTransferActionDisabled,
} from './event-active-registration.component';
import { normalizeRegistrationTransferTargetEmail } from './event-registration-transfer-dialog.component';

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
        'This cancels your confirmed registration and releases your spot. If this was paid, Evorto creates a pending manual refund record for organizers; Stripe refunds are not automatic yet.',
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
        'This cancels your confirmed registration and releases all selected spots. If this was paid, Evorto creates a pending manual refund record for organizers; Stripe refunds are not automatic yet.',
    });
  });

  it('exposes a leave-waitlist action for waitlisted registrations', () => {
    expect(
      registrationCancellationCopy({
        guestCount: 0,
        paymentPending: false,
        status: 'WAITLIST',
      }),
    ).toEqual({
      buttonLabel: 'Leave waitlist',
      helperText:
        'This removes your waitlist registration and releases your waitlist position.',
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
  it('does not show deferred transfer copy for confirmed registrations', () => {
    expect(registrationDeferredActionCopy({ status: 'CONFIRMED' })).toBeNull();
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

describe('registrationTransferActionCopy', () => {
  it('exposes self-service transfer for eligible confirmed registrations', () => {
    expect(
      registrationTransferActionCopy({
        status: 'CONFIRMED',
        transferAvailable: true,
      }),
    ).toEqual({
      buttonLabel: 'Transfer registration',
      helperText:
        'You can transfer this unpaid registration to another eligible tenant member by email.',
    });
  });

  it('keeps paid or otherwise blocked confirmed transfers honest', () => {
    expect(
      registrationTransferActionCopy({
        status: 'CONFIRMED',
        transferAvailable: false,
      }),
    ).toEqual({
      buttonLabel: 'Transfer unavailable',
      helperText:
        'Self-service transfer is only available for unpaid, not-yet-checked-in registrations before the event starts. Paid registration transfer and resale are not automatic yet.',
    });
  });

  it('does not expose transfer actions for pending or waitlist registrations', () => {
    expect(
      registrationTransferActionCopy({
        status: 'PENDING',
        transferAvailable: false,
      }),
    ).toBeNull();
    expect(
      registrationTransferActionCopy({
        status: 'WAITLIST',
        transferAvailable: false,
      }),
    ).toBeNull();
  });
});

describe('active registration action guards', () => {
  it('disables cancellation while cancellation or transfer writes are pending', () => {
    expect(
      registrationCancellationActionDisabled({
        cancellationPending: true,
        transferPending: false,
      }),
    ).toBe(true);
    expect(
      registrationCancellationActionDisabled({
        cancellationPending: false,
        transferPending: true,
      }),
    ).toBe(true);
  });

  it('allows cancellation only when no active registration action write is pending', () => {
    expect(
      registrationCancellationActionDisabled({
        cancellationPending: false,
        transferPending: false,
      }),
    ).toBe(false);
  });

  it('disables transfer when unavailable or when cancellation or transfer writes are pending', () => {
    expect(
      registrationTransferActionDisabled({
        cancellationPending: false,
        transferAvailable: false,
        transferPending: false,
      }),
    ).toBe(true);
    expect(
      registrationTransferActionDisabled({
        cancellationPending: true,
        transferAvailable: true,
        transferPending: false,
      }),
    ).toBe(true);
    expect(
      registrationTransferActionDisabled({
        cancellationPending: false,
        transferAvailable: true,
        transferPending: true,
      }),
    ).toBe(true);
  });

  it('allows transfer only when available and no active registration action write is pending', () => {
    expect(
      registrationTransferActionDisabled({
        cancellationPending: false,
        transferAvailable: true,
        transferPending: false,
      }),
    ).toBe(false);
  });
});

describe('normalizeRegistrationTransferTargetEmail', () => {
  it('normalizes participant-entered target emails before submit', () => {
    expect(
      normalizeRegistrationTransferTargetEmail(' Target@Example.COM '),
    ).toBe('target@example.com');
  });
});
