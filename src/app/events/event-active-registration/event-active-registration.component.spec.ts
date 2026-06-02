import '@angular/compiler';
import { describe, expect, it } from 'vitest';

import {
  registrationCancellationActionDisabled,
  registrationCancellationCopy,
  registrationDeferredActionCopy,
  registrationPaidTransferCodeActionCopy,
  registrationPaidTransferCodeActionDisabled,
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

  it('describes confirmed cancellation with Stripe refund fallback handling', () => {
    expect(
      registrationCancellationCopy({
        guestCount: 0,
        paymentPending: false,
        status: 'CONFIRMED',
      }),
    ).toEqual({
      buttonLabel: 'Cancel registration',
      helperText:
        'This cancels your confirmed registration and releases your spot. If this was paid, Evorto submits a Stripe refund when the original payment reference is available; otherwise it creates a pending manual refund record for organizers.',
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
        'This cancels your confirmed registration and releases all selected spots. If this was paid, Evorto submits a Stripe refund when the original payment reference is available; otherwise it creates a pending manual refund record for organizers.',
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
        paidTransferCodeAvailable: false,
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
        paidTransferCodeAvailable: false,
        status: 'CONFIRMED',
        transferAvailable: false,
      }),
    ).toEqual({
      buttonLabel: 'Transfer unavailable',
      helperText:
        'Self-service unpaid transfer is only available for not-yet-checked-in registrations before the event starts. Paid transfer is available through eligible transfer codes; refund completion still needs organizer follow-up.',
    });
  });

  it('does not expose transfer actions for pending or waitlist registrations', () => {
    expect(
      registrationTransferActionCopy({
        paidTransferCodeAvailable: false,
        status: 'PENDING',
        transferAvailable: false,
      }),
    ).toBeNull();
    expect(
      registrationTransferActionCopy({
        paidTransferCodeAvailable: false,
        status: 'WAITLIST',
        transferAvailable: false,
      }),
    ).toBeNull();
  });

  it('defers to paid transfer-code creation for eligible paid registrations', () => {
    expect(
      registrationTransferActionCopy({
        paidTransferCodeAvailable: true,
        status: 'CONFIRMED',
        transferAvailable: false,
      }),
    ).toBeNull();
  });
});

describe('registrationPaidTransferCodeActionCopy', () => {
  it('exposes transfer-code creation for eligible paid confirmed registrations', () => {
    expect(
      registrationPaidTransferCodeActionCopy({
        paidTransferCodeAvailable: true,
        status: 'CONFIRMED',
      }),
    ).toEqual({
      buttonLabel: 'Create transfer code',
      helperText:
        'Create a 24-hour transfer code and link for this paid registration. The replacement participant can start checkout from the link; refund completion still needs organizer follow-up.',
    });
  });

  it('does not expose paid transfer-code creation when unavailable', () => {
    expect(
      registrationPaidTransferCodeActionCopy({
        paidTransferCodeAvailable: false,
        status: 'CONFIRMED',
      }),
    ).toBeNull();
    expect(
      registrationPaidTransferCodeActionCopy({
        paidTransferCodeAvailable: true,
        status: 'PENDING',
      }),
    ).toBeNull();
  });
});

describe('active registration action guards', () => {
  it('disables cancellation while cancellation or transfer writes are pending', () => {
    expect(
      registrationCancellationActionDisabled({
        cancellationPending: true,
        transferCodePending: false,
        transferPending: false,
      }),
    ).toBe(true);
    expect(
      registrationCancellationActionDisabled({
        cancellationPending: false,
        transferCodePending: false,
        transferPending: true,
      }),
    ).toBe(true);
    expect(
      registrationCancellationActionDisabled({
        cancellationPending: false,
        transferCodePending: true,
        transferPending: false,
      }),
    ).toBe(true);
  });

  it('allows cancellation only when no active registration action write is pending', () => {
    expect(
      registrationCancellationActionDisabled({
        cancellationPending: false,
        transferCodePending: false,
        transferPending: false,
      }),
    ).toBe(false);
  });

  it('disables transfer when unavailable or when cancellation or transfer writes are pending', () => {
    expect(
      registrationTransferActionDisabled({
        cancellationPending: false,
        transferAvailable: false,
        transferCodePending: false,
        transferPending: false,
      }),
    ).toBe(true);
    expect(
      registrationTransferActionDisabled({
        cancellationPending: true,
        transferAvailable: true,
        transferCodePending: false,
        transferPending: false,
      }),
    ).toBe(true);
    expect(
      registrationTransferActionDisabled({
        cancellationPending: false,
        transferAvailable: true,
        transferCodePending: false,
        transferPending: true,
      }),
    ).toBe(true);
    expect(
      registrationTransferActionDisabled({
        cancellationPending: false,
        transferAvailable: true,
        transferCodePending: true,
        transferPending: false,
      }),
    ).toBe(true);
  });

  it('allows transfer only when available and no active registration action write is pending', () => {
    expect(
      registrationTransferActionDisabled({
        cancellationPending: false,
        transferAvailable: true,
        transferCodePending: false,
        transferPending: false,
      }),
    ).toBe(false);
  });

  it('disables paid transfer-code creation when unavailable or while another action is pending', () => {
    expect(
      registrationPaidTransferCodeActionDisabled({
        cancellationPending: false,
        paidTransferCodeAvailable: false,
        transferCodePending: false,
        transferPending: false,
      }),
    ).toBe(true);
    expect(
      registrationPaidTransferCodeActionDisabled({
        cancellationPending: true,
        paidTransferCodeAvailable: true,
        transferCodePending: false,
        transferPending: false,
      }),
    ).toBe(true);
    expect(
      registrationPaidTransferCodeActionDisabled({
        cancellationPending: false,
        paidTransferCodeAvailable: true,
        transferCodePending: true,
        transferPending: false,
      }),
    ).toBe(true);
    expect(
      registrationPaidTransferCodeActionDisabled({
        cancellationPending: false,
        paidTransferCodeAvailable: true,
        transferCodePending: false,
        transferPending: true,
      }),
    ).toBe(true);
  });

  it('allows paid transfer-code creation only when available and no active registration action write is pending', () => {
    expect(
      registrationPaidTransferCodeActionDisabled({
        cancellationPending: false,
        paidTransferCodeAvailable: true,
        transferCodePending: false,
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
