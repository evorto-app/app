import { TRPCError } from '@trpc/server';
import { and, arrayOverlaps, eq, inArray } from 'drizzle-orm';
import { Schema } from 'effect';
import { groupBy } from 'es-toolkit';
import { DateTime } from 'luxon';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import {
  authenticatedProcedure,
  publicProcedure,
  router,
} from '../trpc-server';
import { cancelPendingRegistrationProcedure } from './cancel-pending-registration.procedure';
import { eventListProcedure } from './event-list.procedure';
import { registerForEventProcedure } from './register-for-event.procedure';
import { registrationScannedProcedure } from './registration-scanned.procedure';

export const eventRouter = router({
  cancelPendingRegistration: cancelPendingRegistrationProcedure,

  create: authenticatedProcedure
    .meta({ requiredPermissions: ['events:create'] })
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
          creatorId: ctx.user.id,
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

  eventList: eventListProcedure.query(async ({ ctx: { events } }) => {
    const groupedEvents = groupBy(events, (event) =>
      DateTime.fromJSDate(event.start).toFormat('yyyy-MM-dd'),
    );
    return Object.entries(groupedEvents).map(([date, events]) => ({
      day: DateTime.fromFormat(date, 'yyyy-MM-dd').toJSDate(),
      events,
    }));
  }),

  findMany: eventListProcedure.query(async ({ ctx: { events } }) => {
    return events;
  }),

  findOne: publicProcedure
    .input(
      Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString })),
    )
    .query(async ({ ctx, input }) => {
      const event = await database.query.eventInstances.findFirst({
        where: { id: input.id, tenantId: ctx.tenant.id },
        with: {
          registrationOptions: true,
          reviewer: {
            columns: {
              firstName: true,
              lastName: true,
            },
          },
        },
      });
      if (!event) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Event with id ${input.id} not found`,
        });
      }
      return event;
    }),

  findOnePublic: publicProcedure
    .input(
      Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString })),
    )
    .query(async ({ ctx, input }) => {
      const rolesToFilterBy = (ctx.user?.roleIds ??
        (await database.query.roles
          .findMany({
            columns: { id: true },
            where: { defaultUserRole: true, tenantId: ctx.tenant.id },
          })
          .then((roles) => roles.map((role) => role.id))) ??
        []) as string[];
      const event = await database.query.eventInstances.findFirst({
        where: { id: input.id, tenantId: ctx.tenant.id },
        with: {
          registrationOptions: {
            where: {
              RAW: (table) => arrayOverlaps(table.roleIds, rolesToFilterBy),
            },
          },
          reviewer: {
            columns: {
              firstName: true,
              lastName: true,
            },
          },
        },
      });
      if (!event) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Event with id ${input.id} not found`,
        });
      }
      return event;
    }),

  getPendingReviews: authenticatedProcedure
    .meta({ requiredPermissions: ['events:review'] })
    .query(async ({ ctx }) => {
      return database.query.eventInstances.findMany({
        orderBy: { start: 'desc' },
        where: { status: 'PENDING_REVIEW', tenantId: ctx.tenant.id },
        with: {
          registrationOptions: true,
          template: true,
        },
      });
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
        where: {
          eventId: input.eventId,
          status: { NOT: 'CANCELLED' },
          tenantId: ctx.tenant.id,
          userId: ctx.user.id,
        },
        with: {
          registrationOption: true,
          transactions: true,
        },
      });

      return {
        isRegistered: registrations.length > 0,
        registrations: registrations.map((reg) => ({
          checkoutUrl: reg.transactions.find(
            (transaction) =>
              transaction.method === 'stripe' &&
              transaction.type === 'registration',
          )?.stripeCheckoutUrl,
          id: reg.id,
          paymentPending: reg.transactions.some(
            (transaction) =>
              transaction.status === 'pending' &&
              transaction.type === 'registration',
          ),
          // TODO: Fix once drizzle fixes this type
          registeredDescription: reg.registrationOption!.registeredDescription,
          registrationOptionId: reg.registrationOptionId,
          // TODO: Fix once drizzle fixes this type
          registrationOptionTitle: reg.registrationOption!.title,
          status: reg.status,
        })),
      };
    }),

  registerForEvent: registerForEventProcedure,

  registrationScanned: registrationScannedProcedure,

  reviewEvent: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          approved: Schema.Boolean,
          comment: Schema.optional(Schema.NonEmptyString),
          eventId: Schema.NonEmptyString,
        }),
      ),
    )
    .meta({ requiredPermissions: ['events:review'] })
    .mutation(async ({ ctx, input }) => {
      return database
        .update(schema.eventInstances)
        .set({
          reviewedAt: new Date(),
          reviewedBy: ctx.user.id,
          status: input.approved ? 'APPROVED' : 'REJECTED',
          statusComment: input.comment || null,
        })
        .where(
          and(
            eq(schema.eventInstances.id, input.eventId),
            eq(schema.eventInstances.tenantId, ctx.tenant.id),
            eq(schema.eventInstances.status, 'PENDING_REVIEW'),
          ),
        )
        .returning()
        .then((result) => result[0]);
    }),

  submitForReview: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          eventId: Schema.NonEmptyString,
        }),
      ),
    )
    // .meta({ requiredPermissions: ['events:edit'] })
    .mutation(async ({ ctx, input }) => {
      return await database
        .update(schema.eventInstances)
        .set({
          reviewedAt: null,
          reviewedBy: null,
          status: 'PENDING_REVIEW',
          statusComment: null,
        })
        .where(
          and(
            eq(schema.eventInstances.id, input.eventId),
            eq(schema.eventInstances.tenantId, ctx.tenant.id),
            inArray(schema.eventInstances.status, ['DRAFT', 'REJECTED']),
          ),
        )
        .returning()
        .then((result) => result[0]);
    }),

  update: authenticatedProcedure
    // .meta({ requiredPermissions: ['events:edit'] })
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          description: Schema.NonEmptyString,
          end: Schema.ValidDateFromSelf,
          eventId: Schema.NonEmptyString,
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
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      // Check if event is in a state that allows editing
      const event = await database.query.eventInstances.findFirst({
        where: {
          id: input.eventId,
          tenantId: ctx.tenant.id,
        },
      });

      if (!event) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Event not found',
        });
      }

      if (event.status !== 'DRAFT') {
        //TODO: Check this for correctness
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Event cannot be edited in its current state',
        });
      }

      // Update the event
      const updatedEvent = await database
        .update(schema.eventInstances)
        .set({
          description: input.description,
          end: input.end,
          icon: input.icon,
          start: input.start,
          title: input.title,
        })
        .where(
          and(
            eq(schema.eventInstances.id, input.eventId),
            eq(schema.eventInstances.tenantId, ctx.tenant.id),
          ),
        )
        .returning();

      // Delete existing registration options and recreate them
      await database.delete(schema.eventRegistrationOptions).where(
        eq(schema.eventRegistrationOptions.eventId, input.eventId),
      );

      // Insert new registration options
      await database.insert(schema.eventRegistrationOptions).values(
        input.registrationOptions.map((option) => ({
          closeRegistrationTime: option.closeRegistrationTime,
          description: option.description,
          eventId: input.eventId,
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

      return updatedEvent;
    }),

  updateVisibility: authenticatedProcedure
    .meta({
      requiredPermissions: ['events:changeVisibility'],
    })
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          eventId: Schema.NonEmptyString,
          visibility: Schema.Literal(...schema.eventVisibility.enumValues),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      await database
        .update(schema.eventInstances)
        .set({ visibility: input.visibility })
        .where(
          and(
            eq(schema.eventInstances.tenantId, ctx.tenant.id),
            eq(schema.eventInstances.id, input.eventId),
          ),
        );
    }),
});
