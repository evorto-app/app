import { describe, expect, it } from 'vitest';

import { registrationOptionsState } from './event-details.component';

describe('registrationOptionsState', () => {
  it('shows available registration options when at least one option is visible', () => {
    expect(
      registrationOptionsState({
        registrationOptions: [{}],
        registrationOptionsHiddenByEligibility: false,
      }),
    ).toBe('visible');
  });

  it('shows an explicit ineligible state when every option is hidden by role eligibility', () => {
    expect(
      registrationOptionsState({
        registrationOptions: [],
        registrationOptionsHiddenByEligibility: true,
      }),
    ).toBe('hiddenByEligibility');
  });

  it('keeps optionless events distinct from role-ineligible events', () => {
    expect(
      registrationOptionsState({
        registrationOptions: [],
        registrationOptionsHiddenByEligibility: false,
      }),
    ).toBe('none');
  });
});
