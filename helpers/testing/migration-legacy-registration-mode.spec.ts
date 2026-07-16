import { describe, expect, it } from 'vitest';

import { legacyParticipantRegistrationMode } from '../../migration/legacy-registration-mode';

describe('legacyParticipantRegistrationMode', () => {
  it('preserves deferred Stripe payment as manual approval', () => {
    expect(
      legacyParticipantRegistrationMode({
        deferredPayment: true,
        registrationMode: 'STRIPE',
      }),
    ).toBe('application');
  });

  it('maps ordinary internal registration to first come, first served', () => {
    expect(
      legacyParticipantRegistrationMode({
        deferredPayment: false,
        registrationMode: 'ONLINE',
      }),
    ).toBe('fcfs');
    expect(
      legacyParticipantRegistrationMode({
        deferredPayment: false,
        registrationMode: 'STRIPE',
      }),
    ).toBe('fcfs');
  });

  it('blocks external and non-Stripe deferred registration', () => {
    expect(() =>
      legacyParticipantRegistrationMode({
        deferredPayment: false,
        registrationMode: 'EXTERNAL',
      }),
    ).toThrow('no target representation');
    expect(() =>
      legacyParticipantRegistrationMode({
        deferredPayment: true,
        registrationMode: 'ONLINE',
      }),
    ).toThrow('only representable for Stripe');
  });
});
