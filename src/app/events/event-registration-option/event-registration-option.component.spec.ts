import { describe, expect, it } from 'vitest';

import { registrationOptionAudienceCopy } from './event-registration-option.component';

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
