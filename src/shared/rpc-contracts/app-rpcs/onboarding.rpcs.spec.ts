import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  TenantOnboardingAdminQuestionInput,
  TenantOnboardingAdminSettings,
  TenantOnboardingAnswerInput,
  TenantOnboardingProfileRecord,
  TenantOnboardingQuestionRecord,
  TenantOnboardingQuestionType,
  TenantOnboardingRequirements,
  TenantOnboardingRequirementsRecord,
  TenantPrivacyPolicyVersionRecord,
} from './onboarding.rpcs';

const validRequirementsRecord = {
  complete: false,
  hasMembership: true,
  policy: {
    id: 'policy-2',
    privacyPolicyText: 'Current policy',
    privacyPolicyUrl: null,
    version: 2,
  },
  profile: {
    communicationEmail: 'member@example.org',
    firstName: 'Member',
    lastName: 'Example',
  },
  questions: [
    {
      answer: 'Student',
      id: 'question-1',
      options: ['Student', 'Volunteer'],
      prompt: 'How are you joining?',
      type: 'selection',
    },
  ],
  tenantId: 'tenant-1',
  tenantName: 'Example Section',
} satisfies Parameters<typeof TenantOnboardingRequirementsRecord.make>[0];

describe('tenant onboarding RPC schemas', () => {
  it('encodes schema-backed requirements for RPC transport', () => {
    const rpcSuccess = TenantOnboardingRequirementsRecord.make({
      ...validRequirementsRecord,
      policy: TenantPrivacyPolicyVersionRecord.make(
        validRequirementsRecord.policy,
      ),
      profile: TenantOnboardingProfileRecord.make(
        validRequirementsRecord.profile,
      ),
      questions: validRequirementsRecord.questions.map((question) =>
        TenantOnboardingQuestionRecord.make(question),
      ),
    });

    expect(
      Schema.encodeUnknownSync(TenantOnboardingRequirements.successSchema)(
        rpcSuccess,
      ),
    ).toEqual(validRequirementsRecord);
  });

  it('encodes schema-backed admin settings for RPC transport', () => {
    const rpcSuccess = {
      policy: TenantPrivacyPolicyVersionRecord.make(
        validRequirementsRecord.policy,
      ),
      questions: validRequirementsRecord.questions.map((question) =>
        TenantOnboardingQuestionRecord.make(question),
      ),
    };

    expect(
      Schema.encodeUnknownSync(TenantOnboardingAdminSettings.successSchema)(
        rpcSuccess,
      ),
    ).toEqual({
      policy: validRequirementsRecord.policy,
      questions: validRequirementsRecord.questions,
    });
  });

  it('keeps question types limited to short text and selection', () => {
    expect(
      Schema.decodeUnknownSync(TenantOnboardingQuestionType)('shortText'),
    ).toBe('shortText');
    expect(
      Schema.decodeUnknownSync(TenantOnboardingQuestionType)('selection'),
    ).toBe('selection');
    expect(() =>
      Schema.decodeUnknownSync(TenantOnboardingQuestionType)('checkbox'),
    ).toThrow();
  });

  it('requires stable question identifiers at the completion boundary', () => {
    expect(() =>
      Schema.decodeUnknownSync(TenantOnboardingAnswerInput)({
        questionId: '',
        value: 'Student',
      }),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(TenantOnboardingAnswerInput)({
        questionId: 'question-1',
        value: 'Student',
      }),
    ).toEqual({ questionId: 'question-1', value: 'Student' });
  });

  it('decodes current policy, profile, questions, and existing answers together', () => {
    expect(
      Schema.decodeUnknownSync(TenantOnboardingRequirementsRecord)(
        validRequirementsRecord,
      ),
    ).toMatchObject({
      hasMembership: true,
      policy: { version: 2 },
      questions: [{ answer: 'Student', type: 'selection' }],
    });
  });

  it('retains options on admin question inputs for server validation', () => {
    expect(
      Schema.decodeUnknownSync(TenantOnboardingAdminQuestionInput)({
        options: ['Student', 'Volunteer'],
        prompt: 'How are you joining?',
        type: 'selection',
      }),
    ).toEqual({
      options: ['Student', 'Volunteer'],
      prompt: 'How are you joining?',
      type: 'selection',
    });
  });
});
