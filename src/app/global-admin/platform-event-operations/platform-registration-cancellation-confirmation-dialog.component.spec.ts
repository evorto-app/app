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
  checkInTimingIssue: false,
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
      canConfirm: true,
      title: "Cancel Alex Able's registration?",
    });
    expect(copy.impact).toContain('the attendee place, 2 guest places');
    expect(copy.impact).toContain(
      'every remaining included, free, or purchased add-on unit',
    );
    expect(copy.impact).toContain(
      'Existing check-in and fulfillment history stays recorded',
    );
    expect(copy.refund).toContain('1250 minor currency units');
    expect(copy.refund).toContain('immutable original Stripe payment records');
    expect(copy.refund).toContain('excludes payment fees');
  });

  it('explains a free cancellation without inventing a refund', () => {
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
    ).toBe(
      'No successful paid acquisition is recorded, so no refund is required.',
    );
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
    expect(copy.refund).toContain('Paid event transactions are Stripe-only');
  });
});
