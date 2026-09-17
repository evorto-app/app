import { Schema } from 'effect';

import { BadRequestForbiddenOrUnauthorizedRpcError } from '../../errors/rpc-errors';

export const PlatformOperationRpcError =
  BadRequestForbiddenOrUnauthorizedRpcError;

export type PlatformOperationRpcError =
  BadRequestForbiddenOrUnauthorizedRpcError;

const paymentAccountIdentifierPattern =
  /(?:^|[^A-Za-z0-9_])acct_[A-Za-z0-9_]+(?:$|[^A-Za-z0-9_])/u;

export const PlatformOperationReason = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(500),
  Schema.makeFilter((value) =>
    paymentAccountIdentifierPattern.test(value)
      ? 'Remove the payment account number from the reason.'
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
