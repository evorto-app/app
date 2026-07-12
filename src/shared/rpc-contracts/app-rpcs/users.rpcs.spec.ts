import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { UsersEventSummaryRecord, UsersUpdateProfileInput } from './users.rpcs';

describe('users RPC input schemas', () => {
  it('rejects invalid profile notification email addresses', () => {
    expect(() =>
      Schema.decodeUnknownSync(UsersUpdateProfileInput)({
        communicationEmail: 'finance',
        firstName: 'Alice',
        lastName: 'Doe',
      }),
    ).toThrow();
  });

  it('carries purchased add-ons on profile event summaries', () => {
    expect(() =>
      Schema.decodeUnknownSync(UsersEventSummaryRecord)({
        addonPurchases: [
          {
            quantity: 2,
            title: 'Workshop kit',
            unitPrice: 500,
          },
        ],
        checkInTime: null,
        checkoutUrl: null,
        description: null,
        end: '2026-03-01T11:00:00.000Z',
        eventId: 'event-1',
        guestCount: 0,
        organizingRegistration: false,
        paymentState: 'recorded',
        refunds: [],
        registrationId: 'registration-1',
        registrationOptionTitle: 'Participant',
        start: '2026-03-01T10:00:00.000Z',
        status: 'CONFIRMED',
        title: 'Event',
      }),
    ).not.toThrow();
  });

  it('carries participant-safe refund progress for cancelled registrations', () => {
    expect(() =>
      Schema.decodeUnknownSync(UsersEventSummaryRecord)({
        addonPurchases: [],
        checkInTime: null,
        checkoutUrl: null,
        description: null,
        end: '2026-03-01T11:00:00.000Z',
        eventId: 'event-1',
        guestCount: 0,
        organizingRegistration: false,
        paymentState: 'recorded',
        refunds: [
          {
            amount: 2500,
            currency: 'EUR',
            source: 'registration',
            state: 'retrying',
            updatedAt: '2026-03-01T10:05:00.000Z',
          },
          {
            amount: 500,
            currency: 'EUR',
            source: 'addon',
            state: 'actionRequired',
            updatedAt: '2026-03-01T10:06:00.000Z',
          },
        ],
        registrationId: 'registration-1',
        registrationOptionTitle: 'Participant',
        start: '2026-03-01T10:00:00.000Z',
        status: 'CANCELLED',
        title: 'Event',
      }),
    ).not.toThrow();
  });
});
