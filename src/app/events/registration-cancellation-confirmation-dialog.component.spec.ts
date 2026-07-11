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
      confirmLabel: 'Confirm cancellation',
      impact:
        'This immediately cancels your confirmed registration and releases its reserved capacity. If a payment exists, Evorto starts the applicable refund workflow, which may still require operator follow-up. This action cannot be undone.',
      title: 'Cancel your registration?',
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
    expect(copy.impact).toContain('does not release confirmed capacity');
    expect(copy.impact).not.toContain('reserved capacity');
  });

  it('explains capacity release for a pending payment reservation', () => {
    expect(
      registrationCancellationConfirmationCopy({
        actor: 'participant',
        paymentPending: true,
        status: 'PENDING',
      }).impact,
    ).toContain('releases its reserved capacity');
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
      confirmLabel: 'Confirm cancellation',
      title: "Cancel Alex Able's registration?",
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
    ).toBe("Cancel this participant's registration?");
  });
});
