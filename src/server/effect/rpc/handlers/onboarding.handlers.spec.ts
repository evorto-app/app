import { describe, expect, it, layer } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../db';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';
import {
  normalizeOnboardingProfile,
  onboardingHandlers,
  validateOnboardingAnswers,
  verifiedOnboardingIdentity,
} from './onboarding.handlers';
import { RpcAccess } from './shared/rpc-access.service';

const missingSubjectContextLayer = Layer.mergeAll(
  Layer.mock(Database)({}),
  Layer.succeed(RpcRequestContext, {
    authData: {},
    authenticated: true,
    permissions: [],
    tenant: {
      currency: 'EUR',
      defaultLocation: null,
      discountProviders: {
        esnCard: {
          config: {},
          status: 'disabled',
        },
      },
      domain: 'tenant.example.com',
      id: 'tenant-1',
      name: 'Tenant',
      receiptSettings: {
        allowOther: false,
        receiptCountries: ['NL'],
      },
      stripeAccountId: null,
      theme: 'evorto',
      timezone: 'Europe/Berlin',
    },
    user: null,
    userAssigned: false,
  } satisfies RpcRequestContextShape),
  RpcAccess.Default,
);

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
          communicationEmail: 'notify@example.org',
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

  it.effect(
    'rejects a non-canonical communication email at the service boundary',
    () =>
      Effect.gen(function* () {
        const error = yield* normalizeOnboardingProfile({
          communicationEmail: ' Notify@Example.ORG ',
          firstName: 'Member',
          lastName: 'Example',
        }).pipe(Effect.flip);

        expect(error._tag).toBe('TenantOnboardingValidationError');
        expect(error.field).toBe('communicationEmail');
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

describe('tenant onboarding authorization', () => {
  layer(missingSubjectContextLayer)((it) => {
    it.effect(
      'returns the same explicit unauthorized outcome for status and requirements when sub is missing',
      () =>
        Effect.gen(function* () {
          const requirementsError = yield* onboardingHandlers[
            'onboarding.requirements'
          ]().pipe(Effect.flip);
          const statusError = yield* onboardingHandlers[
            'onboarding.status'
          ]().pipe(Effect.flip);

          const expectedError = {
            _tag: 'RpcUnauthorizedError',
            message:
              'Your sign-in details are incomplete. Sign out and sign in again.',
          };
          expect(requirementsError).toMatchObject(expectedError);
          expect(statusError).toMatchObject(expectedError);
        }),
    );
  });
});
