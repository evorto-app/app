import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { User } from '../../../types/custom/user';
import {
  UsersEventSummaryRecord,
  UsersFindManyInput,
  UsersUpdateProfileInput,
} from './users.rpcs';

describe('users RPC input schemas', () => {
  it('accepts only bounded integer tenant-user pages', () => {
    expect(
      Schema.decodeUnknownSync(UsersFindManyInput)({
        limit: 100,
        offset: 0,
      }),
    ).toEqual({ limit: 100, offset: 0 });

    for (const input of [
      { limit: 0, offset: 0 },
      { limit: 101, offset: 0 },
      { limit: 10.5, offset: 0 },
      { limit: 10, offset: -1 },
      { limit: 10, offset: 0.5 },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(UsersFindManyInput)(input),
      ).toThrow();
    }
  });

  it('canonicalizes valid profile contact and payout input', () => {
    expect(
      Schema.decodeUnknownSync(UsersUpdateProfileInput)({
        communicationEmail: ' Finance@Example.COM ',
        firstName: 'Alice',
        iban: ' nl91 abna 0417 1643 00 ',
        lastName: 'Doe',
        paypalEmail: ' Payout@Example.COM ',
      }),
    ).toEqual({
      communicationEmail: 'finance@example.com',
      firstName: 'Alice',
      iban: 'NL91ABNA0417164300',
      lastName: 'Doe',
      paypalEmail: 'payout@example.com',
    });
  });

  it('rejects malformed profile contact and payout input', () => {
    expect(() =>
      Schema.decodeUnknownSync(UsersUpdateProfileInput)({
        communicationEmail: 'finance',
        firstName: 'Alice',
        lastName: 'Doe',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(UsersUpdateProfileInput)({
        communicationEmail: 'finance@example.com',
        firstName: 'Alice',
        iban: 'DE88370400440532013000',
        lastName: 'Doe',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(UsersUpdateProfileInput)({
        communicationEmail: 'finance@example.com',
        firstName: 'Alice',
        lastName: 'Doe',
        paypalEmail: 'payout',
      }),
    ).toThrow();
  });

  it('rejects non-canonical profile details read from persistence', () => {
    const storedUser = {
      auth0Id: 'auth0|user-1',
      communicationEmail: 'finance@example.com',
      email: 'login@example.com',
      firstName: 'Alice',
      homeTenantId: null,
      homeTenantName: null,
      iban: 'NL91ABNA0417164300',
      id: 'user-1',
      lastName: 'Doe',
      paypalEmail: 'payout@example.com',
      permissions: [],
      roleIds: [],
    };

    expect(() => Schema.decodeUnknownSync(User)(storedUser)).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(User)({
        ...storedUser,
        communicationEmail: ' Finance@Example.COM ',
      }),
    ).toThrow();
    const { communicationEmail: _communicationEmail, ...missingEmail } =
      storedUser;
    expect(() => Schema.decodeUnknownSync(User)(missingEmail)).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(User)({
        ...storedUser,
        iban: 'DE88370400440532013000',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(User)({
        ...storedUser,
        paypalEmail: 'Payout@Example.COM',
      }),
    ).toThrow();
  });

  it('carries purchased add-ons on profile event summaries', () => {
    expect(() =>
      Schema.decodeUnknownSync(UsersEventSummaryRecord)({
        addonPurchases: [
          {
            currency: 'EUR',
            purchasedQuantity: 2,
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
