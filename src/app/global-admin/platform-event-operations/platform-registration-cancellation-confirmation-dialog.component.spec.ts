import { describe, expect, it } from 'vitest';

import type { PlatformRegistrationDetailRecord } from '../../../shared/rpc-contracts/app-rpcs/platform-events.rpcs';

import { platformRegistrationCancellationConfirmationCopy } from './platform-registration-cancellation-confirmation-dialog.component';

const registration = (
  refund: PlatformRegistrationDetailRecord['cancellation']['refund'],
): PlatformRegistrationDetailRecord => ({
  allowCheckIn: true,
  attendee: {
    email: 'alex@example.test',
    firstName: 'Alex',
    id: 'user-1',
    lastName: 'Able',
  },
  attendeeCheckedIn: false,
  cancellation: {
    available: true,
    blockedReason: null,
    deadline: '2030-01-01T00:00:00.000Z',
    deadlinePassed: false,
    refund,
  },
  checkedInGuestCount: 0,
  checkInTime: null,
  checkInTimingIssue: null,
  currency: 'EUR',
  event: {
    id: 'event-1',
    start: '2030-01-02T00:00:00.000Z',
    title: 'Weekend trip',
  },
  guestCount: 2,
  id: 'registration-1',
  manualApprovalAvailable: false,
  paymentPending: false,
  registrationMode: 'fcfs',
  registrationOptionTitle: 'Participant',
  registrationStatusIssue: false,
  remainingGuestCount: 2,
  status: 'CONFIRMED',
});

describe('platformRegistrationCancellationConfirmationCopy', () => {
  it('describes the whole affected registration and exact Stripe reconciliation', () => {
    const copy = platformRegistrationCancellationConfirmationCopy({
      reason: 'Duplicate registration',
      registration: registration({
        amount: 1250,
        feesIncluded: false,
        method: 'stripe',
        required: true,
      }),
    });

    expect(copy).toMatchObject({
      actionLabel: 'Cancel ticket',
      canConfirm: true,
      dismissLabel: 'Go back',
      title: "Cancel Alex Able's ticket?",
    });
    expect(copy.impact).toContain(
      "Alex Able's entire ticket: the attendee place, 2 guest places",
    );
    expect(copy.impact).toContain(
      'every remaining included, free, or purchased add-on item',
    );
    expect(copy.impact).toContain(
      'Existing check-in and add-on handout history stays recorded',
    );
    expect(copy.refund).toContain('12,50');
    expect(copy.refund).toContain('original payment');
    expect(copy.refund).toContain(
      'organization cancellation rules exclude payment fees',
    );
  });

  it('explains a free ticket cancellation without inventing a refund', () => {
    expect(
      platformRegistrationCancellationConfirmationCopy({
        reason: 'Participant request',
        registration: registration({
          amount: null,
          feesIncluded: false,
          method: null,
          required: false,
        }),
      }).refund,
    ).toBe('No completed payment needs to be refunded.');
  });

  it('fails closed when a paid event transaction is not Stripe-backed', () => {
    const copy = platformRegistrationCancellationConfirmationCopy({
      reason: 'Legacy record',
      registration: registration({
        amount: 1250,
        feesIncluded: true,
        method: 'cash',
        required: true,
      }),
    });

    expect(copy.canConfirm).toBe(false);
    expect(copy).toMatchObject({
      actionLabel: 'Cancel ticket',
      dismissLabel: 'Go back',
      refund:
        'This ticket could not be matched to its original payment. The ticket was not cancelled, the attendee keeps their place, and no refund was started. Review the payment before trying again.',
      title: 'Ticket could not be cancelled for Alex Able',
    });
    expect(copy.refund).toContain(
      'The ticket was not cancelled, the attendee keeps their place, and no refund was started',
    );
  });

  it.each([
    [
      'PENDING',
      false,
      'Withdraw application',
      "Withdraw Alex Able's application?",
    ],
    ['PENDING', true, 'Cancel sign-up', "Cancel Alex Able's pending sign-up?"],
    [
      'WAITLIST',
      false,
      'Remove from waitlist',
      'Remove Alex Able from the waitlist?',
    ],
  ] as const)(
    'uses status-specific copy for %s',
    (status, paymentPending, actionLabel, title) => {
      const copy = platformRegistrationCancellationConfirmationCopy({
        reason: 'Participant request',
        registration: {
          ...registration({
            amount: null,
            feesIncluded: false,
            method: null,
            required: false,
          }),
          paymentPending,
          status,
        },
      });

      expect(copy).toMatchObject({ actionLabel, canConfirm: true, title });
      expect(copy.impact).not.toContain('entire ticket');
    },
  );

  it('blocks a contradictory refund instead of hiding the mismatch', () => {
    const copy = platformRegistrationCancellationConfirmationCopy({
      reason: 'Review',
      registration: {
        ...registration({
          amount: 1250,
          feesIncluded: false,
          method: 'stripe',
          required: true,
        }),
        status: 'WAITLIST',
      },
    });

    expect(copy.canConfirm).toBe(false);
    expect(copy.refund).toContain('does not match this sign-up status');
  });
});
