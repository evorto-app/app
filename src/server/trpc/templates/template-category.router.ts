import { eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { eventTemplateCategories } from '../../../db/schema';
import { publicProcedure, router } from '../trpc-server';

export const templateCategoryRouter = router({
  create: publicProcedure
    .input(
      Schema.decodeUnknownSync(Schema.Struct({ title: Schema.NonEmptyString })),
    )
    .mutation(async ({ ctx, input }) => {
      return await database.insert(eventTemplateCategories).values({
        icon: '',
        tenantId: ctx.tenant.id,
        title: input.title,
      });
    }),
  findMany: publicProcedure.query(async ({ ctx }) => {
    return await database.query.eventTemplateCategories.findMany({
      where: eq(eventTemplateCategories.tenantId, ctx.tenant.id),
    });
  }),
  update: publicProcedure
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
