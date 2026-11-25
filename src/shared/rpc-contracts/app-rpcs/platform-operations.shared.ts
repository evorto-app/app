import { Schema } from 'effect';

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
