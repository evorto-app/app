import { describe, expect, it } from 'vitest';

import {
  registrationOptionAudienceCopy,
  registrationOptionAvailability,
  registrationOptionAvailableSpots,
  registrationOptionCanJoinWaitlist,
  registrationOptionIsFull,
} from './event-registration-option.component';

describe('registrationOptionAudienceCopy', () => {
  it('keeps participant options on registration copy', () => {
    expect(
      registrationOptionAudienceCopy({ organizingRegistration: false }),
    ).toEqual({
      actionSuffix: 'register',
      helperText: 'Use this option when you are attending the event.',
      label: 'Participant option',
      primaryAction: 'Register',
    });
  });

  it('uses distinct organizer/helper signup copy', () => {
    expect(
      registrationOptionAudienceCopy({ organizingRegistration: true }),
    ).toEqual({
      actionSuffix: 'sign up as organizer/helper',
      helperText: 'Use this option when you are helping run the event.',
      label: 'Organizer/helper option',
      primaryAction: 'Sign up as organizer/helper',
    });
  });
});

describe('registrationOptionIsFull', () => {
  it('treats confirmed plus reserved spots as unavailable capacity', () => {
    expect(
      registrationOptionIsFull({
        confirmedSpots: 8,
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(true);
  });

  it('keeps registration available when any spot remains', () => {
    expect(
      registrationOptionIsFull({
        confirmedSpots: 7,
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(false);
  });
});

describe('registrationOptionCanJoinWaitlist', () => {
  it('allows waitlist joining for full participant first-come options', () => {
    expect(
      registrationOptionCanJoinWaitlist({
        confirmedSpots: 8,
        organizingRegistration: false,
        registrationMode: 'fcfs',
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(true);
  });

  it('does not offer waitlists for organizer/helper options', () => {
    expect(
      registrationOptionCanJoinWaitlist({
        confirmedSpots: 8,
        organizingRegistration: true,
        registrationMode: 'fcfs',
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(false);
  });

  it('keeps normal registration primary while spots remain', () => {
    expect(
      registrationOptionCanJoinWaitlist({
        confirmedSpots: 7,
        organizingRegistration: false,
        registrationMode: 'fcfs',
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(false);
  });
});

describe('registrationOptionAvailableSpots', () => {
  it('subtracts confirmed and reserved spots from total capacity', () => {
    expect(
      registrationOptionAvailableSpots({
        confirmedSpots: 3,
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(5);
  });

  it('never returns negative available capacity', () => {
    expect(
      registrationOptionAvailableSpots({
        confirmedSpots: 10,
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(0);
  });
});

describe('registrationOptionAvailability', () => {
  const currentTime = new Date('2026-09-15T12:00:00.000Z');

  it('blocks direct registration before the option opens', () => {
    expect(
      registrationOptionAvailability(
        {
          closeRegistrationTime: '2026-09-20T12:00:00.000Z',
          openRegistrationTime: '2026-09-16T12:00:00.000Z',
        },
        currentTime,
      ),
    ).toBe('tooEarly');
  });

  it('blocks direct registration after the option closes', () => {
    expect(
      registrationOptionAvailability(
        {
          closeRegistrationTime: '2026-09-14T12:00:00.000Z',
          openRegistrationTime: '2026-09-10T12:00:00.000Z',
        },
        currentTime,
      ),
    ).toBe('tooLate');
  });

  it('keeps direct registration open inside the registration window', () => {
    expect(
      registrationOptionAvailability(
        {
          closeRegistrationTime: '2026-09-20T12:00:00.000Z',
          openRegistrationTime: '2026-09-10T12:00:00.000Z',
        },
        currentTime,
      ),
    ).toBe('open');
  });
});
