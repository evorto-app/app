import { eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { eventTemplateCategories } from '../../../db/schema';
import { authenticatedProcedure, router } from '../trpc-server';

export const templateCategoryRouter = router({
  create: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          icon: Schema.NonEmptyString,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      return await database.insert(eventTemplateCategories).values({
        tenantId: ctx.tenant.id,
        ...input,
      });
    }),
  findMany: authenticatedProcedure.query(async ({ ctx }) => {
    return await database.query.eventTemplateCategories.findMany({
      where: { tenantId: ctx.tenant.id },
    });
  }),
  update: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(Schema.Struct({ title: Schema.NonEmptyString })),
    )
    .mutation(async ({ ctx, input }) => {
      return await database
        .update(eventTemplateCategories)
        .set({
          title: input.title,
        })
        .where(eq(eventTemplateCategories.tenantId, ctx.tenant.id))
        .returning()
        .then((result) => result[0]);
    }),
});
