import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import {
  normalizeOnboardingProfile,
  validateOnboardingAnswers,
  verifiedOnboardingIdentity,
} from './onboarding.handlers';

describe('tenant onboarding completion validation', () => {
  it('accepts only an authenticated identity with an explicitly verified email', () => {
    expect(
      verifiedOnboardingIdentity({
        email: ' member@example.org ',
        email_verified: true,
        sub: ' auth0|member ',
      }),
    ).toEqual({
      auth0Id: 'auth0|member',
      email: 'member@example.org',
    });
    expect(
      verifiedOnboardingIdentity({
        email: 'member@example.org',
        email_verified: false,
        sub: 'auth0|member',
      }),
    ).toBeUndefined();
    expect(
      verifiedOnboardingIdentity({
        email: 'member@example.org',
        sub: 'auth0|member',
      }),
    ).toBeUndefined();
  });

  it.effect('normalizes a valid global profile', () =>
    Effect.gen(function* () {
      expect(
        yield* normalizeOnboardingProfile({
          communicationEmail: ' notify@example.org ',
          firstName: ' Member ',
          lastName: ' Example ',
        }),
      ).toEqual({
        communicationEmail: 'notify@example.org',
        firstName: 'Member',
        lastName: 'Example',
      });
    }),
  );

  it.effect('rejects missing, duplicate, and unexpected answers', () =>
    Effect.gen(function* () {
      const questions = [
        {
          id: 'question-1',
          options: ['Student', 'Volunteer'],
          prompt: 'How are you joining?',
          type: 'selection' as const,
        },
      ];
      const missing = yield* validateOnboardingAnswers([], questions).pipe(
        Effect.flip,
      );
      expect(missing._tag).toBe('TenantOnboardingValidationError');

      const duplicate = yield* validateOnboardingAnswers(
        [
          { questionId: 'question-1', value: 'Student' },
          { questionId: 'question-1', value: 'Volunteer' },
        ],
        questions,
      ).pipe(Effect.flip);
      expect(duplicate._tag).toBe('TenantOnboardingValidationError');

      const unexpected = yield* validateOnboardingAnswers(
        [{ questionId: 'retired-question', value: 'Student' }],
        questions,
      ).pipe(Effect.flip);
      expect(unexpected._tag).toBe('TenantOnboardingRequirementsChangedError');
    }),
  );

  it.effect('requires a current selection option and bounds short text', () =>
    Effect.gen(function* () {
      const invalidSelection = yield* validateOnboardingAnswers(
        [{ questionId: 'question-1', value: 'Other' }],
        [
          {
            id: 'question-1',
            options: ['Student', 'Volunteer'],
            prompt: 'How are you joining?',
            type: 'selection',
          },
        ],
      ).pipe(Effect.flip);
      expect(invalidSelection._tag).toBe('TenantOnboardingValidationError');

      const longText = yield* validateOnboardingAnswers(
        [{ questionId: 'question-2', value: 'a'.repeat(251) }],
        [
          {
            id: 'question-2',
            options: [],
            prompt: 'What should we know?',
            type: 'shortText',
          },
        ],
      ).pipe(Effect.flip);
      expect(longText._tag).toBe('TenantOnboardingValidationError');
    }),
  );
});
