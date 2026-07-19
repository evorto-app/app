import { describe, expect, it } from '@effect/vitest';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Cause } from 'effect';
import { SqlError, UniqueViolation } from 'effect/unstable/sql/SqlError';

import { activeEventRegistrationUniqueIndexName } from '../../../../../db/schema';
import { isActiveRegistrationUniqueViolation } from './active-registration-constraint';

const activeRegistrationViolation = () =>
  new SqlError({
    reason: new UniqueViolation({
      cause: new Error('duplicate active registration'),
      constraint: activeEventRegistrationUniqueIndexName,
    }),
  });

describe('active registration constraint', () => {
  it('recognizes a bare SQL unique violation', () => {
    expect(
      isActiveRegistrationUniqueViolation(activeRegistrationViolation()),
    ).toBe(true);
  });

  it('recognizes the Effect Drizzle query wrapper used by inserts and updates', () => {
    expect(
      isActiveRegistrationUniqueViolation(
        new EffectDrizzleQueryError({
          cause: Cause.fail(activeRegistrationViolation()),
          params: ['tenant-1', 'event-1', 'user-1'],
          query: 'insert into event_registrations ...',
        }),
      ),
    ).toBe(true);
  });

  it('does not misclassify another unique constraint', () => {
    expect(
      isActiveRegistrationUniqueViolation(
        new SqlError({
          reason: new UniqueViolation({
            cause: new Error('duplicate email'),
            constraint: 'users_email_unique',
          }),
        }),
      ),
    ).toBe(false);
  });
});
