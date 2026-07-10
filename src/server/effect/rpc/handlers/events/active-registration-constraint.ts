import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Cause, Option } from 'effect';
import { SqlError, UniqueViolation } from 'effect/unstable/sql/SqlError';

import { activeEventRegistrationUniqueIndexName } from '../../../../../db/schema';

const sqlErrorFromUnknown = (error: unknown): SqlError | undefined => {
  if (error instanceof SqlError) {
    return error;
  }
  if (
    !(error instanceof EffectDrizzleQueryError) ||
    !Cause.isCause(error.cause)
  ) {
    return undefined;
  }

  const wrappedError = Option.getOrUndefined(
    Cause.findErrorOption(error.cause),
  );
  return wrappedError instanceof SqlError ? wrappedError : undefined;
};

export const isActiveRegistrationUniqueViolation = (
  error: unknown,
): boolean => {
  const sqlError = sqlErrorFromUnknown(error);
  return (
    sqlError?.reason instanceof UniqueViolation &&
    sqlError.reason.constraint === activeEventRegistrationUniqueIndexName
  );
};
