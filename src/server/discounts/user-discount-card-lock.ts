import { sql } from 'drizzle-orm';
import { Effect } from 'effect';

import { type DatabaseClient } from '../../db';

export const lockUserDiscountCards = Effect.fn('UserDiscountCards.lock')(
  function* (
    database: Pick<DatabaseClient, 'execute'>,
    userId: string,
    mode: 'exclusive' | 'shared',
  ) {
    const key = `evorto:user-discount-cards:${userId}`;
    yield* database
      .execute(
        mode === 'exclusive'
          ? sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
          : sql`select pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`,
      )
      .pipe(Effect.asVoid);
  },
);
