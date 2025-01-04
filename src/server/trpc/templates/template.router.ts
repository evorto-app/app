import { eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { eventTemplates } from '../../../db/schema';
import { authenticatedProcedure, router } from '../trpc-server';

export const templateRouter = router({
  create: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          categoryId: Schema.NonEmptyString,
          description: Schema.NonEmptyString,
          icon: Schema.NonEmptyString,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      return await database.insert(eventTemplates).values({
        tenantId: ctx.tenant.id,
        ...input,
      });
    }),
  findMany: authenticatedProcedure.query(async ({ ctx }) => {
    return await database.query.eventTemplates.findMany({
      where: eq(eventTemplates.tenantId, ctx.tenant.id),
    });
  }),
  groupedByCategory: authenticatedProcedure.query(async ({ ctx }) => {
    return await database.query.eventTemplateCategories.findMany({
      where: eq(eventTemplates.tenantId, ctx.tenant.id),
      with: {
        templates: true,
      },
    });
  }),
});
