import { sql } from 'drizzle-orm';
import { Effect } from 'effect';

import { type DatabaseClient } from '../../db';

export const userDiscountCardLockStatement = (
  userId: string,
  mode: 'exclusive' | 'shared',
) => {
  const key = `evorto:user-discount-cards:${userId}`;
  return mode === 'exclusive'
    ? sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    : sql`select pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
};

export const lockUserDiscountCards = Effect.fn('UserDiscountCards.lock')(
  function* (
    database: Pick<DatabaseClient, 'execute'>,
    userId: string,
    mode: 'exclusive' | 'shared',
  ) {
    yield* database
      .execute(userDiscountCardLockStatement(userId, mode))
      .pipe(Effect.asVoid);
  },
);
