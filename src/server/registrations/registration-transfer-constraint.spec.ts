import { activeRegistrationTransferSourceUniqueIndexName } from '@db/schema';
import { describe, expect, it } from '@effect/vitest';
import { SqlError, UniqueViolation } from 'effect/unstable/sql/SqlError';

import { isActiveRegistrationTransferUniqueViolation } from './registration-transfer-constraint';

describe('registration transfer constraints', () => {
  it('recognizes the one-active-offer source constraint', () => {
    expect(
      isActiveRegistrationTransferUniqueViolation(
        new SqlError({
          reason: new UniqueViolation({
            cause: new Error('duplicate'),
            constraint: activeRegistrationTransferSourceUniqueIndexName,
          }),
        }),
      ),
    ).toBe(true);
  });

  it('does not swallow unrelated database errors', () => {
    expect(isActiveRegistrationTransferUniqueViolation(new Error('boom'))).toBe(
      false,
    );
  });
});
