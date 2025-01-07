import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import {
  authenticatedProcedure,
  publicProcedure,
  router,
} from '../trpc-server';

export const eventRouter = router({
  create: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          description: Schema.NonEmptyString,
          icon: Schema.NonEmptyString,
          templateId: Schema.NonEmptyString,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      return await database
        .insert(schema.eventInstances)
        .values({
          tenantId: ctx.tenant.id,
          ...input,
        })
        .returning()
        .then((result) => result[0]);
    }),
  findMany: publicProcedure.query(async ({ ctx }) => {
    return await database.query.eventInstances.findMany({
      where: eq(schema.eventInstances.tenantId, ctx.tenant.id),
    });
  }),
  findOne: publicProcedure
    .input(
      Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString })),
    )
    .query(async ({ ctx, input }) => {
      const event = await database.query.eventInstances.findFirst({
        where: and(
          eq(schema.eventInstances.id, input.id),
          eq(schema.eventInstances.tenantId, ctx.tenant.id),
        ),
      });
      if (!event) {
        throw new Error('Event not found');
      }
      return event;
    }),
});
