import { and, count, desc, eq, not } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { authenticatedProcedure, router } from '../trpc-server';

export const financeRouter = router({
  transactions: router({
    findMany: authenticatedProcedure
      .input(
        Schema.standardSchemaV1(
          Schema.Struct({
            limit: Schema.Number,
            offset: Schema.Number,
            // search: Schema.optional(Schema.NonEmptyString),
          }),
        ),
      )
      .query(async ({ ctx, input }) => {
        const transactionCountResult = await database
          .select({ count: count() })
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.tenantId, ctx.tenant.id),
              not(eq(schema.transactions.status, 'cancelled')),
            ),
          );
        const total = transactionCountResult[0].count;

        const transactions = await database
          .select()
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.tenantId, ctx.tenant.id),
              not(eq(schema.transactions.status, 'cancelled')),
            ),
          )
          .limit(input.limit)
          .offset(input.offset)
          .orderBy(desc(schema.transactions.createdAt));

        return { data: transactions, total };
      }),
  }),
});
