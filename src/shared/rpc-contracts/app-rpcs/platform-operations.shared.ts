import { Schema } from 'effect';

import { BadRequestForbiddenOrUnauthorizedRpcError } from '../../errors/rpc-errors';

export const PlatformOperationRpcError =
  BadRequestForbiddenOrUnauthorizedRpcError;

export type PlatformOperationRpcError =
  BadRequestForbiddenOrUnauthorizedRpcError;

const stripeAccountIdentifierPattern = /(?:^|\W)acct_[A-Za-z0-9]+(?:$|\W)/u;

export const PlatformOperationReason = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(500),
  Schema.makeFilter((value) =>
    stripeAccountIdentifierPattern.test(value)
      ? 'The reason must not include a payment account identifier'
      : undefined,
  ),
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
