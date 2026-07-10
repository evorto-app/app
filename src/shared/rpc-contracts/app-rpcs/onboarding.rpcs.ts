import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { literalUnion } from '@shared/schema-utilities';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { RpcUnauthorizedError } from '../../errors/rpc-errors';
import {
  TenantOnboardingAdminError,
  TenantOnboardingCompleteError,
} from './onboarding.errors';

export const TenantOnboardingQuestionType = literalUnion(
  'selection',
  'shortText',
);
export type TenantOnboardingQuestionType = Schema.Schema.Type<
  typeof TenantOnboardingQuestionType
>;

export class TenantOnboardingProfileRecord extends Schema.Class<TenantOnboardingProfileRecord>(
  'TenantOnboardingProfileRecord',
)({
  communicationEmail: Schema.NonEmptyString,
  firstName: Schema.NonEmptyString,
  lastName: Schema.NonEmptyString,
}) {}

export class TenantOnboardingQuestionRecord extends Schema.Class<TenantOnboardingQuestionRecord>(
  'TenantOnboardingQuestionRecord',
)({
  answer: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  options: Schema.Array(Schema.NonEmptyString),
  prompt: Schema.NonEmptyString,
  type: TenantOnboardingQuestionType,
}) {}

export class TenantPrivacyPolicyVersionRecord extends Schema.Class<TenantPrivacyPolicyVersionRecord>(
  'TenantPrivacyPolicyVersionRecord',
)({
  id: Schema.NonEmptyString,
  privacyPolicyText: Schema.NullOr(Schema.String),
  privacyPolicyUrl: Schema.NullOr(Schema.String),
  version: Schema.Number,
}) {}

export class TenantOnboardingRequirementsRecord extends Schema.Class<TenantOnboardingRequirementsRecord>(
  'TenantOnboardingRequirementsRecord',
)({
  complete: Schema.Boolean,
  hasMembership: Schema.Boolean,
  policy: Schema.NullOr(TenantPrivacyPolicyVersionRecord),
  profile: Schema.NullOr(TenantOnboardingProfileRecord),
  questions: Schema.Array(TenantOnboardingQuestionRecord),
  tenantId: Schema.NonEmptyString,
  tenantName: Schema.NonEmptyString,
}) {}

export const TenantOnboardingStatus = asRpcQuery(
  Rpc.make('onboarding.status', {
    error: RpcUnauthorizedError,
    payload: Schema.Void,
    success: Schema.Struct({
      complete: Schema.Boolean,
    }),
  }),
);

export const TenantOnboardingRequirements = asRpcQuery(
  Rpc.make('onboarding.requirements', {
    error: RpcUnauthorizedError,
    payload: Schema.Void,
    success: TenantOnboardingRequirementsRecord,
  }),
);

export const TenantOnboardingAnswerInput = Schema.Struct({
  questionId: Schema.NonEmptyString,
  value: Schema.String,
});

export const TenantOnboardingComplete = asRpcMutation(
  Rpc.make('onboarding.complete', {
    error: TenantOnboardingCompleteError,
    payload: Schema.Struct({
      acceptedPrivacyPolicy: Schema.Boolean,
      answers: Schema.Array(TenantOnboardingAnswerInput),
      communicationEmail: Schema.NonEmptyString,
      firstName: Schema.NonEmptyString,
      lastName: Schema.NonEmptyString,
      policyVersionId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const TenantOnboardingAdminQuestionInput = Schema.Struct({
  options: Schema.Array(Schema.String),
  prompt: Schema.String,
  type: TenantOnboardingQuestionType,
});

export const TenantOnboardingAdminSettings = asRpcQuery(
  Rpc.make('onboarding.adminSettings', {
    error: TenantOnboardingAdminError,
    payload: Schema.Void,
    success: Schema.Struct({
      policy: Schema.NullOr(TenantPrivacyPolicyVersionRecord),
      questions: Schema.Array(TenantOnboardingQuestionRecord),
    }),
  }),
);

export const TenantOnboardingPublishSettings = asRpcMutation(
  Rpc.make('onboarding.publishSettings', {
    error: TenantOnboardingAdminError,
    payload: Schema.Struct({
      privacyPolicyText: Schema.String,
      privacyPolicyUrl: Schema.String,
      questions: Schema.Array(TenantOnboardingAdminQuestionInput),
    }),
    success: Schema.Struct({
      affectedUsers: Schema.Number,
      policyChanged: Schema.Boolean,
      policyVersion: Schema.Number,
      questionsChanged: Schema.Boolean,
    }),
  }),
);

export class OnboardingRpcs extends RpcGroup.make(
  TenantOnboardingAdminSettings,
  TenantOnboardingComplete,
  TenantOnboardingPublishSettings,
  TenantOnboardingRequirements,
  TenantOnboardingStatus,
) {}
