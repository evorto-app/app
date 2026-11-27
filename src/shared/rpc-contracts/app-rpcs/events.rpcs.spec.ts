import { describe, expect, it } from '@effect/vitest';
import { Schema } from 'effect';

import { EventsCheckInRegistration } from './events.rpcs';

const decodeCheckIn = Schema.decodeUnknownSync(
  EventsCheckInRegistration.payloadSchema,
);

const checkInPayload = (operationKey: string) => ({
  expectedAttendeeCheckedIn: false,
  expectedCheckedInGuestCount: 0,
  guestCheckInCount: 1,
  operationKey,
  registrationId: 'registration-1',
});

describe('check-in RPC payload', () => {
  it('accepts a printable operation key', () => {
    expect(decodeCheckIn(checkInPayload('operation-1'))).toMatchObject({
      operationKey: 'operation-1',
    });
  });

  it.each(['abc\u{0}def', '\u{0}', 'tab\there', 'line\nbreak', 'del\u{7F}'])(
    'rejects an operation key with control characters %j',
    (operationKey) => {
      expect(() => decodeCheckIn(checkInPayload(operationKey))).toThrow();
    },
  );

  it('requires the attendee state the helper saw', () => {
    const { expectedAttendeeCheckedIn: _omitted, ...payload } =
      checkInPayload('operation-1');
    expect(() => decodeCheckIn(payload)).toThrow();
  });
});
