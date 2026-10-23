import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Cause } from 'effect';
import { isSqlError, type SqlError } from 'effect/sql/SqlError';

export const findSqlError = (error: unknown): SqlError | undefined => {
  if (isSqlError(error)) {
    return error;
  }
  if (
    !(error instanceof EffectDrizzleQueryError) ||
    !Cause.isCause(error.cause) ||
    error.cause.reasons.length !== 1
  ) {
    return undefined;
  }

  const reason = error.cause.reasons[0];
  return reason && Cause.isFailReason(reason) && isSqlError(reason.error)
    ? reason.error
    : undefined;
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
