import { describe, expect, it } from 'vitest';

import { registrationCancellationConfirmationCopy } from './registration-cancellation-confirmation-dialog.component';

describe('registrationCancellationConfirmationCopy', () => {
  it('makes confirmed participant cancellation and refund follow-up explicit', () => {
    expect(
      registrationCancellationConfirmationCopy({
        actor: 'participant',
        paymentPending: false,
        status: 'CONFIRMED',
      }),
    ).toEqual({
      cancelLabel: 'Go back',
      confirmLabel: 'Cancel ticket',
      impact:
        'This immediately cancels your ticket and releases your place. If a refund applies, it will be requested and may take time to appear. Do not pay or sign up again to retry it. This action cannot be undone.',
      title: 'Cancel your ticket?',
    });
  });

  it('distinguishes leaving a waitlist from cancelling a ticket', () => {
    expect(
      registrationCancellationConfirmationCopy({
        actor: 'participant',
        paymentPending: false,
        status: 'WAITLIST',
      }),
    ).toMatchObject({
      cancelLabel: 'Stay on waitlist',
      confirmLabel: 'Leave waitlist',
      title: 'Leave the waitlist?',
    });
  });

  it('does not claim that an unapproved application consumed capacity', () => {
    const copy = registrationCancellationConfirmationCopy({
      actor: 'participant',
      paymentPending: false,
      status: 'PENDING',
    });

    expect(copy.impact).toContain('withdraws your pending application');
    expect(copy.impact).toContain('does not affect any confirmed places');
    expect(copy.impact).not.toContain('reserved capacity');
  });

  it('explains capacity release for a pending payment reservation', () => {
    expect(
      registrationCancellationConfirmationCopy({
        actor: 'participant',
        paymentPending: true,
        status: 'PENDING',
      }).impact,
    ).toContain('releases the place being held for you');
  });

  it('names the participant in organizer cancellation context', () => {
    expect(
      registrationCancellationConfirmationCopy({
        actor: 'organizer',
        participantName: 'Alex Able',
        paymentPending: false,
        status: 'CONFIRMED',
      }),
    ).toMatchObject({
      cancelLabel: 'Go back',
      confirmLabel: 'Cancel ticket',
      title: "Cancel Alex Able's ticket?",
    });
  });

  it('explains organizer waitlist removal without implying a ticket or refund', () => {
    expect(
      registrationCancellationConfirmationCopy({
        actor: 'organizer',
        participantName: 'Alex Able',
        paymentPending: false,
        status: 'WAITLIST',
      }),
    ).toEqual({
      cancelLabel: 'Go back',
      confirmLabel: 'Remove from waitlist',
      impact:
        'This immediately removes Alex Able from the waitlist. No confirmed place is released and no refund is started. This action cannot be undone.',
      title: 'Remove Alex Able from the waitlist?',
    });
  });

  it('falls back to a safe generic organizer subject', () => {
    expect(
      registrationCancellationConfirmationCopy({
        actor: 'organizer',
        participantName: ' '.repeat(3),
        paymentPending: false,
        status: 'PENDING',
      }).title,
    ).toBe("Withdraw this participant's application?");
  });
});
