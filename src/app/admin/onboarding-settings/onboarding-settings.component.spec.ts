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
      'Add between 2 and 20 choices.',
    );
    expect(
      onboardingOptionsValidationMessage(
        Array.from({ length: 21 }, (_, index) => `Option ${index + 1}`).join(
          '\n',
        ),
      ),
    ).toBe('Add between 2 and 20 choices.');
    expect(onboardingOptionsValidationMessage(`${'x'.repeat(81)}\nTwo`)).toBe(
      'Each choice must be 80 characters or fewer.',
    );
  });

  it('explains accepted policy links and selection limits in the form', () => {
    expect(template).toContain('link to it on another website');
    expect(template).toContain('2 to 20 different choices');
    expect(template).toContain('placeholder="Choice one&#10;Choice two"');
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
      'Privacy policy updated. 12 members must accept the new policy before continuing.',
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
      'Questions updated. Members who have not answered them will be asked before continuing.',
    );
  });
});
