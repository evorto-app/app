import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  onboardingOptionsFromText,
  onboardingOptionsValidationMessage,
  onboardingPublishNotice,
} from './onboarding-settings.component';

const template = readFileSync(
  nodePath.join(
    process.cwd(),
    'src/app/admin/onboarding-settings/onboarding-settings.component.html',
  ),
  'utf8',
);

describe('tenant onboarding settings', () => {
  it('trims, removes empty lines, and de-duplicates selection options', () => {
    expect(
      onboardingOptionsFromText(' Student \n\nVolunteer\nStudent\n'),
    ).toEqual(['Student', 'Volunteer']);
  });

  it('uses the same option count and length limits as the server', () => {
    expect(onboardingOptionsValidationMessage('One\nTwo')).toBeUndefined();
    expect(onboardingOptionsValidationMessage('Only one')).toBe(
      'Selection questions require between 2 and 20 options.',
    );
    expect(
      onboardingOptionsValidationMessage(
        Array.from({ length: 21 }, (_, index) => `Option ${index + 1}`).join(
          '\n',
        ),
      ),
    ).toBe('Selection questions require between 2 and 20 options.');
    expect(onboardingOptionsValidationMessage(`${'x'.repeat(81)}\nTwo`)).toBe(
      'Selection options must be no longer than 80 characters.',
    );
  });

  it('explains accepted policy links and selection limits in the form', () => {
    expect(template).toContain('an external HTTP or HTTPS link');
    expect(template).toContain('2 to 20 unique options, up to 80 characters');
    expect(template).toContain('question.optionsText().errors()');
    expect(template).toContain('<mat-error>{{ error.message }}</mat-error>');
  });

  it('renders every blocking policy and question prompt error inline', () => {
    expect(template).toContain(
      'error of settingsForm.privacyPolicyText().errors()',
    );
    expect(template).toContain('error of question.prompt().errors()');
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
      'Privacy policy version 3 published. 12 members must accept it before continuing.',
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
      'Onboarding questions updated. Members with missing answers will be prompted before continuing.',
    );
  });
});
