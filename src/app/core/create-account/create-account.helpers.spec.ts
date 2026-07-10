import { describe, expect, it } from 'vitest';

import {
  createAccountErrorMessage,
  createAccountModelFromAuthData,
  createAccountModelFromRequirements,
  createAccountPayloadFromModel,
  createAccountSubmitDisabled,
  isAuthEmailVerifiedForAccountCreation,
} from './create-account.helpers';

const emptyModel = () => ({
  acceptedPrivacyPolicy: false,
  answers: [] as { questionId: string; value: string }[],
  communicationEmail: '',
  firstName: '',
  lastName: '',
  policyVersionId: '',
});

describe('createAccountModelFromAuthData', () => {
  it('prefills account fields from trimmed Auth0 data', () => {
    expect(
      createAccountModelFromAuthData(emptyModel(), {
        email: ' alice@example.com ',
        family_name: ' Doe ',
        given_name: ' Alice ',
        sub: 'auth0|alice',
      }),
    ).toEqual({
      acceptedPrivacyPolicy: false,
      answers: [],
      communicationEmail: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Doe',
      policyVersionId: '',
    });
  });

  it('preserves existing form values when Auth0 data is missing or blank', () => {
    expect(
      createAccountModelFromAuthData(
        {
          ...emptyModel(),
          communicationEmail: 'notify@example.com',
          firstName: 'Manual',
          lastName: 'Name',
        },
        {
          email: '',
          family_name: null,
          given_name: ' ',
        },
      ),
    ).toEqual({
      acceptedPrivacyPolicy: false,
      answers: [],
      communicationEmail: 'notify@example.com',
      firstName: 'Manual',
      lastName: 'Name',
      policyVersionId: '',
    });
  });
});

describe('createAccountModelFromRequirements', () => {
  it('prefills an existing profile and the current question answers', () => {
    expect(
      createAccountModelFromRequirements(emptyModel(), {
        complete: false,
        hasMembership: true,
        policy: {
          id: 'policy-2',
          privacyPolicyText: 'Current policy',
          privacyPolicyUrl: null,
          version: 2,
        },
        profile: {
          communicationEmail: 'notify@example.org',
          firstName: 'Alex',
          lastName: 'Morgan',
        },
        questions: [
          {
            answer: 'Exchange student',
            id: 'question-1',
            options: [],
            prompt: 'Why are you joining?',
            type: 'shortText',
          },
        ],
        tenantId: 'tenant-1',
        tenantName: 'Example Section',
      }),
    ).toEqual({
      acceptedPrivacyPolicy: false,
      answers: [{ questionId: 'question-1', value: 'Exchange student' }],
      communicationEmail: 'notify@example.org',
      firstName: 'Alex',
      lastName: 'Morgan',
      policyVersionId: 'policy-2',
    });
  });
});

describe('createAccountPayloadFromModel', () => {
  it('trims account creation fields before submitting them', () => {
    expect(
      createAccountPayloadFromModel({
        acceptedPrivacyPolicy: true,
        answers: [{ questionId: 'question-1', value: ' Student ' }],
        communicationEmail: ' notify@example.com ',
        firstName: ' Alice ',
        lastName: ' Doe ',
        policyVersionId: 'policy-2',
      }),
    ).toEqual({
      acceptedPrivacyPolicy: true,
      answers: [{ questionId: 'question-1', value: 'Student' }],
      communicationEmail: 'notify@example.com',
      firstName: 'Alice',
      lastName: 'Doe',
      policyVersionId: 'policy-2',
    });
  });
});

describe('isAuthEmailVerifiedForAccountCreation', () => {
  it('shows the account form only for explicitly verified Auth0 emails', () => {
    expect(
      isAuthEmailVerifiedForAccountCreation({ email_verified: true }),
    ).toBe(true);
    expect(
      isAuthEmailVerifiedForAccountCreation({ email_verified: false }),
    ).toBe(false);
    expect(
      isAuthEmailVerifiedForAccountCreation({ email_verified: null }),
    ).toBe(false);
    expect(isAuthEmailVerifiedForAccountCreation({})).toBe(false);
  });
});

describe('createAccountErrorMessage', () => {
  it('uses the domain error message when account creation fails', () => {
    expect(
      createAccountErrorMessage({
        _tag: 'TenantOnboardingRequirementsChangedError',
        message: 'Requirements changed; review and submit again',
      }),
    ).toBe('Requirements changed; review and submit again');
  });

  it('falls back to account creation copy for unknown failures', () => {
    expect(createAccountErrorMessage(null)).toBe(
      'Failed to complete tenant setup',
    );
  });
});

describe('createAccountSubmitDisabled', () => {
  it('keeps account creation disabled while invalid, submitting, or awaiting the mutation', () => {
    expect(
      createAccountSubmitDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      createAccountSubmitDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      createAccountSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      createAccountSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});
