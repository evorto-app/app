import type { TenantOnboardingRequirementsRecord } from '@shared/rpc-contracts/app-rpcs/onboarding.rpcs';
import type { UsersAuthData } from '@shared/rpc-contracts/app-rpcs/users.rpcs';

import { TenantOnboardingRequirementsChangedError } from '@shared/rpc-contracts/app-rpcs/onboarding.errors';
import { Schema } from 'effect';

import { getErrorMessage } from '../error-message';

export interface CreateAccountModel {
  acceptedPrivacyPolicy: boolean;
  answers: { questionId: string; value: string }[];
  communicationEmail: string;
  firstName: string;
  lastName: string;
  policyVersionId: string;
}

const trimmedOrUndefined = (value: null | string | undefined) =>
  value?.trim() || undefined;

export const createAccountModelFromAuthData = (
  current: CreateAccountModel,
  authData: UsersAuthData,
): CreateAccountModel => ({
  ...current,
  communicationEmail:
    trimmedOrUndefined(authData.email) ?? current.communicationEmail,
  firstName: trimmedOrUndefined(authData.given_name) ?? current.firstName,
  lastName: trimmedOrUndefined(authData.family_name) ?? current.lastName,
});

export const createAccountModelFromRequirements = (
  current: CreateAccountModel,
  requirements: TenantOnboardingRequirementsRecord,
): CreateAccountModel => ({
  acceptedPrivacyPolicy: false,
  answers: requirements.questions.map((question) => ({
    questionId: question.id,
    value: question.answer ?? '',
  })),
  communicationEmail:
    requirements.profile?.communicationEmail ?? current.communicationEmail,
  firstName: requirements.profile?.firstName ?? current.firstName,
  lastName: requirements.profile?.lastName ?? current.lastName,
  policyVersionId: requirements.policy?.id ?? '',
});

export const mergeCreateAccountModelWithChangedRequirements = (
  current: CreateAccountModel,
  requirements: TenantOnboardingRequirementsRecord,
): CreateAccountModel => {
  const currentAnswers = new Map(
    current.answers.map((answer) => [answer.questionId, answer.value]),
  );
  const policyVersionId = requirements.policy?.id ?? '';

  return {
    ...current,
    acceptedPrivacyPolicy:
      current.policyVersionId === policyVersionId
        ? current.acceptedPrivacyPolicy
        : false,
    answers: requirements.questions.map((question) => ({
      questionId: question.id,
      value: currentAnswers.get(question.id) ?? question.answer ?? '',
    })),
    policyVersionId,
  };
};

export const isTenantOnboardingRequirementsChangedError = Schema.is(
  TenantOnboardingRequirementsChangedError,
);

export const isAuthEmailVerifiedForAccountCreation = (
  authData: UsersAuthData,
): boolean => authData.email_verified === true;

export const createAccountPayloadFromModel = (
  model: CreateAccountModel,
): CreateAccountModel => ({
  acceptedPrivacyPolicy: model.acceptedPrivacyPolicy,
  answers: model.answers.map((answer) => ({
    questionId: answer.questionId,
    value: answer.value.trim(),
  })),
  communicationEmail: model.communicationEmail.trim(),
  firstName: model.firstName.trim(),
  lastName: model.lastName.trim(),
  policyVersionId: model.policyVersionId,
});

export const createAccountSubmitDisabled = ({
  formInvalid,
  formSubmitting,
  mutationPending,
}: {
  formInvalid: boolean;
  formSubmitting: boolean;
  mutationPending: boolean;
}): boolean => formInvalid || formSubmitting || mutationPending;

export const createAccountErrorMessage = (error: unknown): string =>
  getErrorMessage(error, 'Failed to complete organization setup');
