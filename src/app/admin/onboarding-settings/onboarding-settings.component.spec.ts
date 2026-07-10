import { describe, expect, it } from 'vitest';

import {
  onboardingOptionsFromText,
  onboardingPublishNotice,
} from './onboarding-settings.component';

describe('tenant onboarding settings', () => {
  it('trims, removes empty lines, and de-duplicates selection options', () => {
    expect(
      onboardingOptionsFromText(' Student \n\nVolunteer\nStudent\n'),
    ).toEqual(['Student', 'Volunteer']);
  });

  it('tells the publishing administrator exactly who must re-accept', () => {
    expect(
      onboardingPublishNotice({
        affectedUsers: 12,
        policyChanged: true,
        policyVersion: 3,
        questionsChanged: false,
      }),
    ).toBe(
      'Privacy policy version 3 published. 12 tenant users must accept it before continuing.',
    );
  });

  it('explains changed question enforcement without claiming a policy change', () => {
    expect(
      onboardingPublishNotice({
        affectedUsers: 0,
        policyChanged: false,
        policyVersion: 3,
        questionsChanged: true,
      }),
    ).toBe(
      'Onboarding questions updated. Tenant users with missing answers will be prompted before continuing.',
    );
  });
});
