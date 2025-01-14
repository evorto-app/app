import { eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { tenants } from '../../../db/schema';
import {
  authenticatedProcedure,
  publicProcedure,
  router,
} from '../trpc-server';

export const tenantRouter = router({
  findMany: publicProcedure.query(async () => {
    throw new Error('Not implemented');
    return await database.query.tenants.findMany();
  }),
  updateSelf: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          currency: Schema.Literal('EUR', 'CZK', 'AUD'),
          locale: Schema.Literal('en-AU', 'en-GB', 'en-US'),
          name: Schema.NonEmptyString,
          timezone: Schema.Literal(
            'Europe/Prague',
            'Europe/Berlin',
            'Australia/Brisbane',
          ),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      return await database
        .update(tenants)
        .set({
          currency: input.currency,
          locale: input.locale,
          name: input.name,
          timezone: input.timezone,
        })
        .where(eq(tenants.id, ctx.tenant.id))
        .returning();
    }),
});
