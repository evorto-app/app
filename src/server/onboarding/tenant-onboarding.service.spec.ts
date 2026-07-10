import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import {
  normalizeTenantOnboardingQuestions,
  normalizeTenantPrivacyPolicy,
  onboardingQuestionsMatch,
  tenantOnboardingCompleteFromRecords,
} from './tenant-onboarding.service';

describe('tenant onboarding validation', () => {
  it.effect('normalizes policy text and canonicalizes an HTTPS URL', () =>
    Effect.gen(function* () {
      const policy = yield* normalizeTenantPrivacyPolicy({
        privacyPolicyText: '  Current tenant policy  ',
        privacyPolicyUrl: ' https://section.example.org/privacy ',
      });

      expect(policy).toEqual({
        privacyPolicyText: 'Current tenant policy',
        privacyPolicyUrl: 'https://section.example.org/privacy',
      });
    }),
  );

  it.effect('requires actual policy content before publication', () =>
    Effect.gen(function* () {
      const error = yield* normalizeTenantPrivacyPolicy({
        privacyPolicyText: ' ',
        privacyPolicyUrl: '',
      }).pipe(Effect.flip);

      expect(error._tag).toBe('TenantOnboardingConfigurationError');
      expect(error.message).toContain('privacy policy text');
    }),
  );

  it.effect('rejects non-http policy links', () =>
    Effect.gen(function* () {
      const error = yield* normalizeTenantPrivacyPolicy({
        privacyPolicyText: '',
        privacyPolicyUrl: 'file:///tmp/privacy.html',
      }).pipe(Effect.flip);

      expect(error._tag).toBe('TenantOnboardingValidationError');
      expect(error.field).toBe('privacyPolicyUrl');
    }),
  );

  it.effect('trims prompts and de-duplicates selection options', () =>
    Effect.gen(function* () {
      const questions = yield* normalizeTenantOnboardingQuestions([
        {
          options: [' Student ', 'Volunteer', 'Student'],
          prompt: '  How are you joining? ',
          type: 'selection',
        },
        {
          options: [],
          prompt: 'Anything we should know?',
          type: 'shortText',
        },
      ]);

      expect(questions).toEqual([
        {
          options: ['Student', 'Volunteer'],
          prompt: 'How are you joining?',
          type: 'selection',
        },
        {
          options: [],
          prompt: 'Anything we should know?',
          type: 'shortText',
        },
      ]);
    }),
  );

  it.effect('requires at least two selection options', () =>
    Effect.gen(function* () {
      const error = yield* normalizeTenantOnboardingQuestions([
        {
          options: ['Only option'],
          prompt: 'Choose one',
          type: 'selection',
        },
      ]).pipe(Effect.flip);

      expect(error._tag).toBe('TenantOnboardingValidationError');
      expect(error.field).toBe('questions.0.options');
    }),
  );

  it('compares ordered immutable question versions exactly', () => {
    const current = [
      {
        options: ['Student', 'Volunteer'],
        prompt: 'How are you joining?',
        type: 'selection' as const,
      },
    ];

    expect(onboardingQuestionsMatch(current, current)).toBe(true);
    expect(
      onboardingQuestionsMatch(current, [
        {
          ...current[0],
          options: ['Volunteer', 'Student'],
        },
      ]),
    ).toBe(false);
  });

  it('requires the current policy and an answer for every active question', () => {
    expect(
      tenantOnboardingCompleteFromRecords({
        answeredQuestionIds: new Set(['question-1', 'question-2']),
        currentPolicyExists: true,
        policyAccepted: true,
        questionIds: ['question-1', 'question-2'],
      }),
    ).toBe(true);
    expect(
      tenantOnboardingCompleteFromRecords({
        answeredQuestionIds: new Set(['question-1']),
        currentPolicyExists: true,
        policyAccepted: true,
        questionIds: ['question-1', 'question-2'],
      }),
    ).toBe(false);
    expect(
      tenantOnboardingCompleteFromRecords({
        answeredQuestionIds: new Set(),
        currentPolicyExists: false,
        policyAccepted: false,
        questionIds: [],
      }),
    ).toBe(false);
  });
});
