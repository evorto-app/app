import { TRPCError } from '@trpc/server';
import { and, arrayOverlaps, eq, inArray } from 'drizzle-orm';
import { Schema } from 'effect';
import { groupBy } from 'es-toolkit';
import { DateTime } from 'luxon';
import consola from 'consola';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { validateTaxRate } from '../../utils/validate-tax-rate';
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
      Schema.standardSchemaV1(
        Schema.Struct({
          description: Schema.NonEmptyString,
          end: Schema.ValidDateFromSelf,
          icon: Schema.Struct({
            iconColor: Schema.Number,
            iconName: Schema.NonEmptyString,
          }),
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
              stripeTaxRateId: Schema.optional(
                Schema.NullOr(Schema.NonEmptyString),
              ),
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
      // Validate tax rates for all registration options before proceeding
      for (const [index, option] of input.registrationOptions.entries()) {
        const validation = await validateTaxRate({
          isPaid: option.isPaid,
          stripeTaxRateId: option.stripeTaxRateId ?? null,
          tenantId: ctx.tenant.id,
        });

        if (!validation.success) {
          consola.error(`Registration option ${index} tax rate validation failed:`, validation.error);
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Registration option "${option.title}": ${validation.error.message}`,
          });
        }
      }

      const templateDefaults = await database.query.eventTemplates.findFirst({
        columns: { unlisted: true },
        where: { id: input.templateId },
      });
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
          unlisted: templateDefaults?.unlisted ?? false,
        })
        .returning()
        .then((result) => result[0]);

      if (!event) {
        throw new Error('Failed to create event');
      }

      const createdOptions = await database
        .insert(schema.eventRegistrationOptions)
        .values(
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
            stripeTaxRateId: option.stripeTaxRateId ?? null,
            title: option.title,
          })),
        )
        .returning();

      // Copy discounts from template registration options to event options
      const templateOptions =
        await database.query.templateRegistrationOptions.findMany({
          where: { templateId: input.templateId },
        });
      if (templateOptions.length > 0) {
        const templateDiscounts = await database
          .select()
          .from(schema.templateRegistrationOptionDiscounts)
          .where(
            inArray(
              schema.templateRegistrationOptionDiscounts.registrationOptionId,
              templateOptions.map((t) => t.id),
            ),
          );
        if (templateDiscounts.length > 0) {
          const key = (title: string, organizing: boolean) =>
            `${title}__${organizing ? '1' : '0'}`;
          const tMap = new Map(
            templateOptions.map((t) => [
              key(t.title, t.organizingRegistration),
              t,
            ]),
          );
          const inserts: {
            discountedPrice: number;
            discountType: any;
            registrationOptionId: string;
          }[] = [];
          for (const event_ of createdOptions) {
            const t = tMap.get(
              key(event_.title, event_.organizingRegistration),
            );
            if (!t) continue;
            for (const d of templateDiscounts) {
              if (d.registrationOptionId === t.id) {
                inserts.push({
                  discountedPrice: d.discountedPrice,
                  discountType: d.discountType as any,
                  registrationOptionId: event_.id,
                });
              }
            }
          }
          if (inserts.length > 0) {
            await database
              .insert(schema.eventRegistrationOptionDiscounts)
              .values(inserts as any);
          }
        }
      }

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
      Schema.standardSchemaV1(Schema.Struct({ id: Schema.NonEmptyString })),
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

  findOneForEdit: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(Schema.Struct({ id: Schema.NonEmptyString })),
    )
    .query(async ({ ctx, input }) => {
      const event = await database.query.eventInstances.findFirst({
        where: { id: input.id, tenantId: ctx.tenant.id },
        with: {
          registrationOptions: true, // Return ALL registration options for editing
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

  getOrganizeOverview: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({ eventId: Schema.NonEmptyString }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const registrations = await database
        .select({
          checkInTime: schema.eventRegistrations.checkInTime,
          organizingRegistration:
            schema.eventRegistrationOptions.organizingRegistration,
          registrationOptionId: schema.eventRegistrations.registrationOptionId,
          registrationOptionTitle: schema.eventRegistrationOptions.title,
          userEmail: schema.users.email,
          userFirstName: schema.users.firstName,
          userId: schema.users.id,
          userLastName: schema.users.lastName,
        })
        .from(schema.eventRegistrations)
        .innerJoin(
          schema.eventRegistrationOptions,
          eq(
            schema.eventRegistrations.registrationOptionId,
            schema.eventRegistrationOptions.id,
          ),
        )
        .innerJoin(
          schema.users,
          eq(schema.eventRegistrations.userId, schema.users.id),
        )
        .where(
          and(
            eq(schema.eventRegistrations.eventId, input.eventId),
            eq(schema.eventRegistrations.tenantId, ctx.tenant.id),
            eq(schema.eventRegistrations.status, 'CONFIRMED'),
          ),
        );

      // Group by registration option and sort
      const groupedRegistrations = groupBy(
        registrations,
        (reg) => reg.registrationOptionId,
      );

      // Sort registration options: organizing first, then by title
      const sortedOptions = Object.entries(groupedRegistrations).sort(
        ([, regsA], [, regsB]) => {
          // First sort by organizing registration (true first)
          if (
            regsA[0].organizingRegistration !== regsB[0].organizingRegistration
          ) {
            return regsB[0].organizingRegistration ? 1 : -1;
          }
          // Then sort by title
          return regsA[0].registrationOptionTitle.localeCompare(
            regsB[0].registrationOptionTitle,
          );
        },
      );

      return sortedOptions.map(([optionId, regs]) => {
        // Sort users within each option: not checked in first, then by name
        const sortedUsers = regs
          .sort((a, b) => {
            // First: not checked in users first (checkInTime === null)
            if ((a.checkInTime === null) !== (b.checkInTime === null)) {
              return a.checkInTime === null ? -1 : 1;
            }
            // Then by first name
            const firstNameCompare = a.userFirstName.localeCompare(
              b.userFirstName,
            );
            if (firstNameCompare !== 0) return firstNameCompare;
            // Finally by last name
            return a.userLastName.localeCompare(b.userLastName);
          })
          .map((reg) => ({
            checkedIn: reg.checkInTime !== null,
            checkInTime: reg.checkInTime,
            email: reg.userEmail,
            firstName: reg.userFirstName,
            lastName: reg.userLastName,
            userId: reg.userId,
          }));

        return {
          organizingRegistration: regs[0].organizingRegistration,
          registrationOptionId: optionId,
          registrationOptionTitle: regs[0].registrationOptionTitle,
          users: sortedUsers,
        };
      });
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
      Schema.standardSchemaV1(
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
      Schema.standardSchemaV1(
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
      Schema.standardSchemaV1(
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
      Schema.standardSchemaV1(
        Schema.Struct({
          description: Schema.NonEmptyString,
          end: Schema.ValidDateFromSelf,
          eventId: Schema.NonEmptyString,
          icon: Schema.Struct({
            iconColor: Schema.Number,
            iconName: Schema.NonEmptyString,
          }),
          location: Schema.NullOr(Schema.Any),
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

      return (
        await database
          .update(schema.eventInstances)
          .set({
            description: input.description,
            end: input.end,
            icon: input.icon,
            location: input.location,
            start: input.start,
            title: input.title,
          })
          .where(
            and(
              eq(schema.eventInstances.id, input.eventId),
              eq(schema.eventInstances.tenantId, ctx.tenant.id),
            ),
          )
          .returning()
      )[0];
    }),

  updateListing: authenticatedProcedure
    .meta({
      requiredPermissions: ['events:changeListing'],
    })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          eventId: Schema.NonEmptyString,
          unlisted: Schema.Boolean,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      await database
        .update(schema.eventInstances)
        .set({ unlisted: input.unlisted })
        .where(
          and(
            eq(schema.eventInstances.tenantId, ctx.tenant.id),
            eq(schema.eventInstances.id, input.eventId),
          ),
        );
    }),
});
