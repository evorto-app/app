import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  UsersCreateAccountInput,
  UsersEventSummaryRecord,
  UsersUpdateProfileInput,
} from './users.rpcs';

describe('users RPC input schemas', () => {
  it('accepts account-creation notification email addresses', () => {
    expect(
      Schema.decodeUnknownSync(UsersCreateAccountInput)({
        communicationEmail: 'notify@example.com',
        firstName: 'Alice',
        lastName: 'Doe',
      }),
    ).toEqual({
      communicationEmail: 'notify@example.com',
      firstName: 'Alice',
      lastName: 'Doe',
    });
  });

  it('rejects invalid account-creation notification email addresses', () => {
    expect(() =>
      Schema.decodeUnknownSync(UsersCreateAccountInput)({
        communicationEmail: 'not-an-email',
        firstName: 'Alice',
        lastName: 'Doe',
      }),
    ).toThrow();
  });

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
        paymentState: 'recorded',
        registrationId: 'registration-1',
        registrationOptionTitle: 'Participant',
        start: '2026-03-01T10:00:00.000Z',
        status: 'CONFIRMED',
        title: 'Event',
      }),
    ).not.toThrow();
  });
});
