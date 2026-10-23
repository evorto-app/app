import { describe, expect, it } from '@effect/vitest';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Cause } from 'effect';
import { SqlError, UniqueViolation } from 'effect/sql/SqlError';

import { activeEventRegistrationUniqueIndexName } from './schema';
import { isUniqueConstraintViolation } from './sql-error';

const uniqueViolation = new SqlError({
  reason: new UniqueViolation({
    cause: { code: '23505' },
    constraint: activeEventRegistrationUniqueIndexName,
    message: 'duplicate key value violates unique constraint',
    operation: 'INSERT',
  }),
});

describe('database constraint error classification', () => {
  it('recognizes direct Effect SQL unique violations', () => {
    expect(
      isUniqueConstraintViolation(
        uniqueViolation,
        activeEventRegistrationUniqueIndexName,
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
        activeEventRegistrationUniqueIndexName,
      ),
    ).toBe(true);
    expect(
      isUniqueConstraintViolation(drizzleError, 'another_constraint'),
    ).toBe(false);
  });

  it.each([
    ['an unrelated error', new Error('unrelated')],
    ['a SQL-shaped object', { reason: uniqueViolation.reason }],
    ['a defect', Cause.die(uniqueViolation)],
    ['an interruption', Cause.interrupt()],
    [
      'a conflict accompanied by a defect',
      Cause.combine(
        Cause.fail(uniqueViolation),
        Cause.die(new Error('unexpected')),
      ),
    ],
  ])('does not hide %s as a recoverable conflict', (_, cause) => {
    const error = new EffectDrizzleQueryError({
      cause,
      params: [],
      query: 'INSERT ...',
    });
    expect(
      isUniqueConstraintViolation(
        error,
        activeEventRegistrationUniqueIndexName,
      ),
    ).toBe(false);
  });
});
