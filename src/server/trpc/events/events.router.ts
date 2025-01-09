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
          registrationOptions: Schema.Array(
            Schema.Struct({
              closeRegistrationOffset: Schema.Number.pipe(Schema.nonNegative()),
              description: Schema.NullOr(Schema.NonEmptyString),
              isPaid: Schema.Boolean,
              openRegistrationOffset: Schema.Number.pipe(Schema.nonNegative()),
              organizingRegistration: Schema.Boolean,
              price: Schema.Number.pipe(Schema.nonNegative()),
              registeredDescription: Schema.NullOr(Schema.NonEmptyString),
              registrationMode: Schema.Literal('fcfs', 'random', 'application'),
              spots: Schema.Number.pipe(Schema.nonNegative()),
              title: Schema.NonEmptyString,
            }),
          ),
          startTime: Schema.Date,
          templateId: Schema.NonEmptyString,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const event = await database
        .insert(schema.eventInstances)
        .values({
          description: input.description,
          icon: input.icon,
          startTime: input.startTime,
          templateId: input.templateId,
          tenantId: ctx.tenant.id,
          title: input.title,
        })
        .returning()
        .then((result) => result[0]);

      if (!event) {
        throw new Error('Failed to create event');
      }

      await database.insert(schema.eventRegistrationOptions).values(
        input.registrationOptions.map((option) => ({
          closeRegistrationOffset: option.closeRegistrationOffset,
          description: option.description,
          eventId: event.id,
          isPaid: option.isPaid,
          openRegistrationOffset: option.openRegistrationOffset,
          organizingRegistration: option.organizingRegistration,
          price: option.price,
          registeredDescription: option.registeredDescription,
          registrationMode: option.registrationMode,
          spots: option.spots,
          title: option.title,
        })),
      );

      return event;
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
