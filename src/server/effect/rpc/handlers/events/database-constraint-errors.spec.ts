import { describe, expect, it } from '@effect/vitest';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Cause } from 'effect';
import { SqlError, UniqueViolation } from 'effect/unstable/sql/SqlError';

import {
  ACTIVE_REGISTRATION_UNIQUE_CONSTRAINT,
  isUniqueConstraintViolation,
} from './database-constraint-errors';

const uniqueViolation = new SqlError({
  reason: new UniqueViolation({
    cause: { code: '23505' },
    constraint: ACTIVE_REGISTRATION_UNIQUE_CONSTRAINT,
    message: 'duplicate key value violates unique constraint',
    operation: 'INSERT',
  }),
});

describe('database constraint error classification', () => {
  it('recognizes direct Effect SQL unique violations', () => {
    expect(
      isUniqueConstraintViolation(
        uniqueViolation,
        ACTIVE_REGISTRATION_UNIQUE_CONSTRAINT,
      ),
    ).toBe(true);
  });

  it('recognizes unique violations wrapped by Drizzle query errors', () => {
    const drizzleError = new EffectDrizzleQueryError({
      cause: Cause.fail(uniqueViolation),
      params: [],
      query: 'INSERT INTO event_registrations ...',
    });

    expect(
      isUniqueConstraintViolation(
        drizzleError,
        ACTIVE_REGISTRATION_UNIQUE_CONSTRAINT,
      ),
    ).toBe(true);
    expect(
      isUniqueConstraintViolation(drizzleError, 'another_constraint'),
    ).toBe(false);
  });
});
