import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { relations } from '../../../src/db/relations';
import { userDiscountCards } from '../../../src/db/schema';

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
    restore: async (cleanupDatabase: TestDatabase) => {
      await cleanupDatabase.transaction(async (transaction) => {
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
            throw new Error('The original discount card could not be restored');
          }
        }
      });
    },
  };
};
