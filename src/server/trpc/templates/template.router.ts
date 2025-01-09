import { and, eq } from 'drizzle-orm';
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
  findOne: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString })),
    )
    .query(async ({ ctx, input }) => {
      const template = await database.query.eventTemplates.findFirst({
        where: and(
          eq(eventTemplates.id, input.id),
          eq(eventTemplates.tenantId, ctx.tenant.id),
        ),
      });
      if (!template) {
        throw new Error('Template not found');
      }
      return template;
    }),
  groupedByCategory: authenticatedProcedure.query(async ({ ctx }) => {
    return await database.query.eventTemplateCategories.findMany({
      orderBy: (categories, { asc }) => [asc(categories.title)],
      where: eq(eventTemplates.tenantId, ctx.tenant.id),
      with: {
        templates: {
          orderBy: (templates, { asc }) => [asc(templates.createdAt)],
        },
      },
    });
  }),
  update: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          categoryId: Schema.NonEmptyString,
          description: Schema.NonEmptyString,
          icon: Schema.NonEmptyString,
          id: Schema.NonEmptyString,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      return await database
        .update(eventTemplates)
        .set({
          categoryId: input.categoryId,
          description: input.description,
          icon: input.icon,
          title: input.title,
        })
        .where(
          and(
            eq(eventTemplates.id, input.id),
            eq(eventTemplates.tenantId, ctx.tenant.id),
          ),
        )
        .returning()
        .then((rows) => rows[0]);
    }),
});
