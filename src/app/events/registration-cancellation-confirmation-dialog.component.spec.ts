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
      confirmLabel: 'Cancel ticket',
      dismissLabel: 'Go back',
      impact:
        'This immediately cancels your ticket and releases the places it reserved. If a refund applies, it will be requested and may take time to appear. You do not need to pay or sign up again. This action cannot be undone.',
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
      confirmLabel: 'Leave waitlist',
      dismissLabel: 'Stay on waitlist',
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
    expect(copy.impact).not.toContain('places held for it');
  });

  it('explains capacity release for a pending payment reservation', () => {
    expect(
      registrationCancellationConfirmationCopy({
        actor: 'participant',
        paymentPending: true,
        status: 'PENDING',
      }).impact,
    ).toContain('releases the places held for it');
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
      confirmLabel: 'Cancel ticket',
      dismissLabel: 'Go back',
      title: "Cancel Alex Able's ticket?",
    });
  });

  it('distinguishes organizer waitlist removal from ticket cancellation', () => {
    expect(
      registrationCancellationConfirmationCopy({
        actor: 'organizer',
        participantName: 'Alex Able',
        paymentPending: false,
        status: 'WAITLIST',
      }),
    ).toEqual({
      confirmLabel: 'Remove from waitlist',
      dismissLabel: 'Keep on waitlist',
      impact:
        'This immediately removes Alex Able from the waitlist and gives up their current position. It does not cancel a confirmed ticket or start a refund. This action cannot be undone.',
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
    ).toBe("Withdraw this attendee's application?");
  });
});
