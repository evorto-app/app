import { Schema } from 'effect';

import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '../../errors/rpc-errors';

export class TenantOnboardingConfigurationError extends Schema.TaggedError<TenantOnboardingConfigurationError>()(
  'TenantOnboardingConfigurationError',
  {
    message: Schema.String,
  },
) {}

export class TenantOnboardingRequirementsChangedError extends Schema.TaggedError<TenantOnboardingRequirementsChangedError>()(
  'TenantOnboardingRequirementsChangedError',
  {
    message: Schema.String,
  },
) {}

export class TenantOnboardingValidationError extends Schema.TaggedError<TenantOnboardingValidationError>()(
  'TenantOnboardingValidationError',
  {
    field: Schema.String,
    message: Schema.String,
  },
) {}

export const TenantOnboardingCompleteError = Schema.Union([
  RpcUnauthorizedError,
  TenantOnboardingConfigurationError,
  TenantOnboardingRequirementsChangedError,
  TenantOnboardingValidationError,
]);
export type TenantOnboardingCompleteError = Schema.Schema.Type<
  typeof TenantOnboardingCompleteError
>;

export const TenantOnboardingAdminError = Schema.Union([
  RpcForbiddenError,
  RpcUnauthorizedError,
  TenantOnboardingConfigurationError,
  TenantOnboardingValidationError,
]);
export type TenantOnboardingAdminError = Schema.Schema.Type<
  typeof TenantOnboardingAdminError
>;
