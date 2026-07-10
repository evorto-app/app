import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Cause } from 'effect';
import { isSqlError, type SqlError } from 'effect/unstable/sql/SqlError';

export const ACTIVE_REGISTRATION_UNIQUE_CONSTRAINT =
  'event_registrations_active_user_event_unique';
export const PENDING_REGISTRATION_TRANSACTION_UNIQUE_CONSTRAINT =
  'transactions_pending_registration_unique';

const findSqlError = (error: unknown): SqlError | undefined => {
  if (isSqlError(error)) {
    return error;
  }
  if (
    !(error instanceof EffectDrizzleQueryError) ||
    !Cause.isCause(error.cause)
  ) {
    return undefined;
  }

  for (const reason of error.cause.reasons) {
    if (Cause.isFailReason(reason) && isSqlError(reason.error)) {
      return reason.error;
    }
  }
  return undefined;
};

export const isUniqueConstraintViolation = (
  error: unknown,
  constraint: string,
): boolean => {
  const sqlError = findSqlError(error);
  return (
    sqlError?.reason._tag === 'UniqueViolation' &&
    sqlError.reason.constraint === constraint
  );
};
