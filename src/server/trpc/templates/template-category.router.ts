import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { eventTemplateCategories } from '../../../db/schema';
import { authenticatedProcedure, router } from '../trpc-server';

export const templateCategoryRouter = router({
  create: authenticatedProcedure
    .meta({ requiredPermissions: ['templates:manageCategories'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          icon: Schema.Union(
            Schema.Struct({
              iconColor: Schema.Number,
              iconName: Schema.NonEmptyString,
            }),
            Schema.NonEmptyString,
          ),
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const icon =
        typeof input.icon === 'string' ? { iconColor: 0, iconName: input.icon } : input.icon;
      return await database.insert(eventTemplateCategories).values({
        icon,
        tenantId: ctx.tenant.id,
        title: input.title,
      });
    }),
  findMany: authenticatedProcedure.query(async ({ ctx }) => {
    return await database.query.eventTemplateCategories.findMany({
      where: { tenantId: ctx.tenant.id },
    });
  }),
  update: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          id: Schema.NonEmptyString,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .meta({ requiredPermissions: ['templates:manageCategories'] })
    .mutation(async ({ ctx, input }) => {
      return await database
        .update(eventTemplateCategories)
        .set({
          title: input.title,
        })
        .where(
          and(
            eq(eventTemplateCategories.tenantId, ctx.tenant.id),
            eq(eventTemplateCategories.id, input.id),
          ),
        )
        .returning()
        .then((result) => result[0]);
    }),
});
