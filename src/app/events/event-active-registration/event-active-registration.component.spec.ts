import '@angular/compiler';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  recipientTransferCheckoutPending,
  registrationCancellationActionDisabled,
  registrationCancellationCopy,
  registrationDeferredActionCopy,
  registrationTransferActionCopy,
  registrationTransferActionDisabled,
} from './event-active-registration.component';

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(process.cwd(), sourcePath), 'utf8');

describe('registrationCancellationCopy', () => {
  it('describes pending payment cancellation as releasing the reserved spot', () => {
    expect(
      registrationCancellationCopy({
        activeTransfer: null,
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
        activeTransfer: null,
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

  it('describes pending manual application cancellation without reserved capacity copy', () => {
    expect(
      registrationCancellationCopy({
        activeTransfer: null,
        guestCount: 0,
        paymentPending: false,
        status: 'PENDING',
      }),
    ).toEqual({
      buttonLabel: 'Cancel registration',
      helperText:
        'This withdraws your pending application before organizer approval.',
    });
  });

  it('describes confirmed cancellation with Stripe refund fallback handling', () => {
    expect(
      registrationCancellationCopy({
        activeTransfer: null,
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
        activeTransfer: null,
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
        activeTransfer: null,
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
        activeTransfer: null,
        guestCount: 0,
        paymentPending: false,
        status: 'CANCELLED',
      }),
    ).toBeNull();
  });

  it('does not expose generic cancellation for a recipient transfer Checkout', () => {
    const registration = {
      activeTransfer: {
        registrationSide: 'recipient' as const,
        status: 'checkout_pending' as const,
      },
      guestCount: 1,
      paymentPending: true,
      status: 'PENDING' as const,
    };

    expect(recipientTransferCheckoutPending(registration)).toBe(true);
    expect(registrationCancellationCopy(registration)).toBeNull();
  });
});

describe('active registration payment template', () => {
  it('explains the transient state before a pending Checkout URL is available', () => {
    const template = readSource(
      'src/app/events/event-active-registration/event-active-registration.component.html',
    );

    expect(template).toContain('@if (registration.checkoutUrl)');
    expect(template).toContain('Your payment link is being prepared.');
    expect(template).toContain(
      'Your registration is not confirmed until payment succeeds.',
    );
    expect(template).toContain('role="status"');
  });

  it('routes recipient transfer cancellation through the transfer mutation', () => {
    const template = readSource(
      'src/app/events/event-active-registration/event-active-registration.component.html',
    );
    const recipientBranch = template.slice(
      template.indexOf('@if (recipientTransferCheckoutPending(registration))'),
      template.indexOf(
        '@else if (cancellationCopy(registration); as cancellation)',
      ),
    );

    expect(recipientBranch).toContain('Cancel pending transfer payment');
    expect(recipientBranch).toContain('cancelTransfer(');
    expect(recipientBranch).not.toContain('cancelRegistration(');
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
      buttonLabel: 'Create transfer link',
      helperText:
        'Create a private link and code for one eligible tenant member. They review the current questions, add-ons, discount, and price before claiming it.',
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
        'Transfer is available only for confirmed, not-yet-checked-in registrations before the configured transfer deadline.',
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

describe('registration transfer offer dialog', () => {
  it('shows both private credentials and keeps the source active until recipient confirmation', () => {
    const template = readSource(
      'src/app/events/event-active-registration/event-registration-transfer-dialog.component.html',
    );

    expect(template).toContain('Claim link');
    expect(template).toContain('Manual claim code');
    expect(template).toContain('do not post these credentials');
    expect(template).toContain('publicly.');
    expect(template).toContain('Your registration');
    expect(template).toContain(
      'stays active until the recipient is confirmed.',
    );
  });
});
