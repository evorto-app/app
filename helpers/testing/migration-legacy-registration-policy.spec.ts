import { describe, expect, it } from 'vitest';

import {
  assertLegacyDeregistrationSupported,
  legacyRegistrationPolicy,
} from '../../migration/legacy-registration-policy';

const defaultInput = {
  context: 'Legacy event event-1',
  eventSettings: null,
  registrationMode: 'STRIPE',
  registrationType: 'participants' as const,
  tenantSettings: {},
};

const participantSettings = ({
  cancellationDays,
  moveDays,
  refundFees = true,
}: {
  readonly cancellationDays: number;
  readonly moveDays: number;
  readonly refundFees?: boolean;
}) => ({
  deRegistrationPossible: true,
  minimumDaysForDeRegistration: cancellationDays,
  minimumDaysForMove: moveDays,
  movePossible: true,
  refundFeesOnDeRegistration: refundFees,
  refundFeesOnMove: refundFees,
});

describe('legacy registration policy mapping', () => {
  it('blocks the legacy event-level disable flag', () => {
    expect(() =>
      assertLegacyDeregistrationSupported(true, 'Legacy event event-1'),
    ).toThrow('disables de-registration at event level');
    expect(() =>
      assertLegacyDeregistrationSupported(false, 'Legacy event event-1'),
    ).not.toThrow();
  });

  it('uses a complete event-level participant override before tenant settings', () => {
    expect(
      legacyRegistrationPolicy({
        ...defaultInput,
        eventSettings: {
          organizers: {},
          participants: participantSettings({
            cancellationDays: 2,
            moveDays: 3,
            refundFees: false,
          }),
        },
        tenantSettings: {
          deRegistrationOptions: {
            paid: {
              participants: participantSettings({
                cancellationDays: 30,
                moveDays: 20,
              }),
            },
          },
        },
      }),
    ).toEqual({
      cancellationDeadlineHoursBeforeStart: 48,
      refundFeesOnCancellation: false,
      transferDeadlineHoursBeforeStart: 72,
    });
  });

  it('treats an empty event-level object as schema defaults, not tenant fallback', () => {
    expect(
      legacyRegistrationPolicy({
        ...defaultInput,
        eventSettings: {},
        tenantSettings: {
          deRegistrationOptions: {
            paid: {
              participants: participantSettings({
                cancellationDays: 30,
                moveDays: 20,
              }),
            },
          },
        },
      }),
    ).toEqual({
      cancellationDeadlineHoursBeforeStart: 120,
      refundFeesOnCancellation: true,
      transferDeadlineHoursBeforeStart: 0,
    });
  });

  it('selects the tenant paid or free fallback from the registration mode', () => {
    const tenantSettings = {
      deRegistrationOptions: {
        free: {
          participants: participantSettings({
            cancellationDays: 1,
            moveDays: 2,
          }),
        },
        paid: {
          participants: participantSettings({
            cancellationDays: 4,
            moveDays: 5,
          }),
        },
      },
    };

    expect(
      legacyRegistrationPolicy({ ...defaultInput, tenantSettings }),
    ).toMatchObject({
      cancellationDeadlineHoursBeforeStart: 96,
      transferDeadlineHoursBeforeStart: 120,
    });
    expect(
      legacyRegistrationPolicy({
        ...defaultInput,
        registrationMode: 'ONLINE',
        tenantSettings,
      }),
    ).toMatchObject({
      cancellationDeadlineHoursBeforeStart: 24,
      transferDeadlineHoursBeforeStart: 48,
    });
  });

  it('maps organizer cancellation policy without a transfer deadline', () => {
    expect(
      legacyRegistrationPolicy({
        ...defaultInput,
        registrationType: 'organizers',
        tenantSettings: {
          deRegistrationOptions: {
            paid: {
              organizers: {
                deRegistrationPossible: true,
                minimumDaysForDeRegistration: 2,
                refundFeesOnDeRegistration: false,
              },
            },
          },
        },
      }),
    ).toEqual({
      cancellationDeadlineHoursBeforeStart: 48,
      refundFeesOnCancellation: false,
      transferDeadlineHoursBeforeStart: null,
    });
  });

  it('applies the legacy schema defaults when tenant policy fields are absent', () => {
    expect(legacyRegistrationPolicy(defaultInput)).toEqual({
      cancellationDeadlineHoursBeforeStart: 120,
      refundFeesOnCancellation: true,
      transferDeadlineHoursBeforeStart: 0,
    });
  });

  it.each([
    [
      {
        participants: {
          ...participantSettings({ cancellationDays: 1, moveDays: 2 }),
          deRegistrationPossible: false,
        },
      },
      'disables participants de-registration',
    ],
    [
      {
        participants: {
          ...participantSettings({ cancellationDays: 1, moveDays: 2 }),
          movePossible: false,
        },
      },
      'disables participant moves',
    ],
    [
      {
        participants: {
          ...participantSettings({ cancellationDays: 1, moveDays: 2 }),
          refundFeesOnMove: false,
        },
      },
      'different participant refund policies',
    ],
  ])(
    'blocks participant policy that cannot be represented',
    (policy, message) => {
      expect(() =>
        legacyRegistrationPolicy({
          ...defaultInput,
          eventSettings: policy,
        }),
      ).toThrow(message);
    },
  );

  it('blocks disabled organizer de-registration', () => {
    expect(() =>
      legacyRegistrationPolicy({
        ...defaultInput,
        eventSettings: {
          organizers: { deRegistrationPossible: false },
        },
        registrationType: 'organizers',
      }),
    ).toThrow('disables organizers de-registration');
  });

  it.each([
    [[], 'invalid shape'],
    [{ participants: null }, 'invalid shape'],
    [
      { participants: { minimumDaysForMove: null } },
      'minimumDaysForMove must be a nonnegative safe integer',
    ],
    [
      {
        participants: {
          ...participantSettings({ cancellationDays: 1, moveDays: 2 }),
          movePossible: 'yes',
        },
      },
      'movePossible must be a boolean',
    ],
    [
      {
        participants: participantSettings({
          cancellationDays: -1,
          moveDays: 2,
        }),
      },
      'minimumDaysForDeRegistration must be a nonnegative safe integer',
    ],
    [
      {
        participants: participantSettings({
          cancellationDays: 0.5,
          moveDays: 2,
        }),
      },
      'minimumDaysForDeRegistration must be a nonnegative safe integer',
    ],
    [
      {
        participants: participantSettings({
          cancellationDays: 1,
          moveDays: Number.MAX_SAFE_INTEGER,
        }),
      },
      'minimumDaysForMove cannot be represented as target integer hours',
    ],
    [
      {
        participants: participantSettings({
          cancellationDays: 1,
          moveDays: 100_000_000,
        }),
      },
      'minimumDaysForMove cannot be represented as target integer hours',
    ],
  ])('blocks malformed event-level policy %o', (policy, message) => {
    expect(() =>
      legacyRegistrationPolicy({
        ...defaultInput,
        eventSettings: policy,
      }),
    ).toThrow(message);
  });

  it('validates both halves of a legacy event config like the source schema', () => {
    expect(() =>
      legacyRegistrationPolicy({
        ...defaultInput,
        eventSettings: {
          organizers: { minimumDaysForDeRegistration: 'five' },
          participants: participantSettings({
            cancellationDays: 1,
            moveDays: 2,
          }),
        },
      }),
    ).toThrow('organizers.minimumDaysForDeRegistration');
  });

  it('blocks malformed tenant fallback and unsupported registration modes', () => {
    expect(() =>
      legacyRegistrationPolicy({ ...defaultInput, tenantSettings: null }),
    ).toThrow('settings has an invalid shape');
    expect(() =>
      legacyRegistrationPolicy({
        ...defaultInput,
        registrationMode: 'EXTERNAL',
      }),
    ).toThrow('unsupported registration mode EXTERNAL');
  });
});
