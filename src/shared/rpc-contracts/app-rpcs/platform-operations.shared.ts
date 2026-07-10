import { Schema } from 'effect';

import { BadRequestForbiddenOrUnauthorizedRpcError } from '../../errors/rpc-errors';

export const PlatformOperationRpcError =
  BadRequestForbiddenOrUnauthorizedRpcError;

export type PlatformOperationRpcError =
  BadRequestForbiddenOrUnauthorizedRpcError;

export const PlatformOperationReason = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(500),
);

export class PlatformTenantMutationContext extends Schema.Class<PlatformTenantMutationContext>(
  'PlatformTenantMutationContext',
)({
  reason: PlatformOperationReason,
  targetTenantId: Schema.NonEmptyString,
}) {}

export class PlatformTenantTarget extends Schema.Class<PlatformTenantTarget>(
  'PlatformTenantTarget',
)({
  targetTenantId: Schema.NonEmptyString,
}) {}
