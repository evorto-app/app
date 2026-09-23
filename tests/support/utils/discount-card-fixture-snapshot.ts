import { and, DrizzleQueryError, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DatabaseError } from 'pg';

import { relations } from '../../../src/db/relations';
import { userDiscountCards } from '../../../src/db/schema';
import { userDiscountCardLockStatement } from '../../../src/server/discounts/user-discount-card-lock';

type TestDatabase = NodePgDatabase<typeof relations>;

// The caller must own the account fixture lease from capture through restore.
export const captureDiscountCardFixtureSnapshot = async (
  database: TestDatabase,
  userId: string,
) => {
  const owner = and(
    eq(userDiscountCards.userId, userId),
    eq(userDiscountCards.type, 'esnCard'),
  );
  const [original] = await database
    .select({
      id: userDiscountCards.id,
      // Keep this opaque and in memory. Date and JSON parsing in JavaScript
      // would lose timestamp microseconds and large metadata numbers.
      row: sql<string>`row_to_json(${userDiscountCards})::text`,
    })
    .from(userDiscountCards)
    .where(owner);

  return {
    originalCardId: original?.id,
    restore: async () => {
      try {
        await database.transaction(async (transaction) => {
          await transaction.execute(
            userDiscountCardLockStatement(userId, 'exclusive'),
          );
          // Remove by owner/type: the test may have removed and re-added the card.
          await transaction.delete(userDiscountCards).where(owner);
          if (original) {
            // The table's composite type restores every persisted field without
            // reinterpreting timestamps or opaque metadata in JavaScript.
            const result = await transaction.execute(sql`
              insert into ${userDiscountCards}
              select * from jsonb_populate_record(
                null::${userDiscountCards}, ${original.row}::jsonb
              )
            `);
            if (result.rowCount !== 1) {
              throw new Error(
                'The original discount card could not be restored',
              );
            }
          }
        });
      } catch (error) {
        const driverError =
          error instanceof DrizzleQueryError ? error.cause : error;
        const cause =
          driverError instanceof DatabaseError
            ? { code: driverError.code, constraint: driverError.constraint }
            : undefined;
        // Query parameters and driver details can contain the entire private
        // snapshot. Preserve diagnostic identifiers without retaining that error.
        // eslint-disable-next-line preserve-caught-error -- The raw cause retains the private snapshot.
        throw new Error('Card fixture restoration failed', { cause });
      }
    },
  };
};
