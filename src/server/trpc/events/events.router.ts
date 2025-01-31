import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { PermissionSchema } from '../../../shared/permissions/permissions';
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
          end: Schema.ValidDateFromSelf,
          icon: Schema.NonEmptyString,
          registrationOptions: Schema.Array(
            Schema.Struct({
              closeRegistrationTime: Schema.ValidDateFromSelf,
              description: Schema.NullOr(Schema.NonEmptyString),
              isPaid: Schema.Boolean,
              openRegistrationTime: Schema.ValidDateFromSelf,
              organizingRegistration: Schema.Boolean,
              price: Schema.Number.pipe(Schema.nonNegative()),
              registeredDescription: Schema.NullOr(Schema.NonEmptyString),
              registrationMode: Schema.Literal('fcfs', 'random', 'application'),
              spots: Schema.Number.pipe(Schema.nonNegative()),
              title: Schema.NonEmptyString,
            }),
          ),
          start: Schema.ValidDateFromSelf,
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
          end: input.end,
          icon: input.icon,
          start: input.start,
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
          closeRegistrationTime: option.closeRegistrationTime,
          description: option.description,
          eventId: event.id,
          isPaid: option.isPaid,
          openRegistrationTime: option.openRegistrationTime,
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

  eventList: publicProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          authenticated: Schema.optionalWith(Schema.Boolean, {
            default: () => false,
          }),
          permissions: Schema.optionalWith(Schema.Array(PermissionSchema), {
            default: () => [],
          }),
          roleIds: Schema.optionalWith(Schema.Array(Schema.NonEmptyString), {
            default: () => [],
          }),
        }),
      ),
    )
    .query(async ({ ctx, input: { authenticated, permissions, roleIds } }) => {
      if (ctx.authentication.isAuthenticated !== authenticated) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Supplied query parameter authenticated (${authenticated}) does not match the actual state (${ctx.authentication.isAuthenticated})!`,
        });
      }
      if (
        !permissions.every((permission) =>
          ctx.user?.permissions?.includes(permission),
        )
      ) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Supplied query parameter permissions (${permissions}) does not match the actual state (${ctx.user?.permissions})!`,
        });
      }

      if (!roleIds.every((id) => ctx.user?.roleIds?.includes(id))) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Supplied query parameter roleIds (${roleIds}) does not match the actual state (${ctx.user?.roleIds})!`,
        });
      }
      const queryResult = await database
        .select()
        .from(schema.eventInstances)
        .execute();
      return queryResult;
    }),

  findMany: publicProcedure.query(async ({ ctx }) => {
    return database.query.eventInstances.findMany({
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
        with: {
          registrationOptions: true,
        },
      });
      if (!event) {
        throw new Error('Event not found');
      }
      return event;
    }),

  getRegistrationStatus: publicProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({ eventId: Schema.NonEmptyString }),
      ),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user) {
        return {
          isRegistered: false,
          registrations: [],
        };
      }
      const registrations = await database.query.eventRegistrations.findMany({
        where: and(
          eq(schema.eventRegistrations.eventId, input.eventId),
          eq(schema.eventRegistrations.userId, ctx.user.id),
        ),
        with: {
          registrationOption: true,
        },
      });

      return {
        isRegistered: registrations.length > 0,
        registrations: registrations.map((reg) => ({
          id: reg.id,
          registrationOptionId: reg.registrationOptionId,
          registrationOptionTitle: reg.registrationOption.title,
          status: reg.status,
        })),
      };
    }),

  registerForEvent: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          eventId: Schema.NonEmptyString,
          registrationOptionId: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const registration = await database.transaction(async (tx) => {
        // Check if user is already registered for this event
        const existingRegistration =
          await tx.query.eventRegistrations.findFirst({
            where: and(
              eq(schema.eventRegistrations.eventId, input.eventId),
              eq(schema.eventRegistrations.userId, ctx.user.id),
            ),
          });
        if (existingRegistration) {
          throw new Error('User is already registered for this event');
        }

        // Check if event is full
        const registrationOption =
          await tx.query.eventRegistrationOptions.findFirst({
            where: and(
              eq(
                schema.eventRegistrationOptions.id,
                input.registrationOptionId,
              ),
              eq(schema.eventRegistrationOptions.eventId, input.eventId),
            ),
          });
        if (!registrationOption) {
          throw new Error('Registration option not found');
        }
        if (registrationOption.confirmedSpots >= registrationOption.spots) {
          throw new Error('Event is full');
        }

        // Register user for event
        const userRegistration = await tx
          .insert(schema.eventRegistrations)
          .values({
            eventId: input.eventId,
            registrationOptionId: input.registrationOptionId,
            status: 'CONFIRMED',
            userId: ctx.user.id,
          })
          .returning()
          .then((result) => result[0]);

        // Update registration option
        await tx
          .update(schema.eventRegistrationOptions)
          .set({
            confirmedSpots: registrationOption.confirmedSpots + 1,
          })
          .where(
            and(
              eq(
                schema.eventRegistrationOptions.id,
                input.registrationOptionId,
              ),
              eq(schema.eventRegistrationOptions.eventId, input.eventId),
            ),
          );

        return userRegistration;
      });

      return registration;
    }),
});
