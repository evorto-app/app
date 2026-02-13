import { iconSchema } from '@shared/types/icon';
import { TRPCError } from '@trpc/server';
import consola from 'consola';
import { and, eq, inArray } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import {
  isMeaningfulRichTextHtml,
  sanitizeOptionalRichTextHtml,
  sanitizeRichTextHtml,
} from '../../utils/rich-text-sanitize';
import { validateTaxRate } from '../../utils/validate-tax-rate';
import {
  authenticatedProcedure,
  router,
} from '../trpc-server';
import { cancelPendingRegistrationProcedure } from './cancel-pending-registration.procedure';
import { eventListProcedure } from './event-list.procedure';
import { registerForEventProcedure } from './register-for-event.procedure';
import { registrationScannedProcedure } from './registration-scanned.procedure';

type EventRegistrationOptionDiscountInsert =
  typeof schema.eventRegistrationOptionDiscounts.$inferInsert;

const isEsnCardEnabled = (providers: unknown) => {
  if (!providers || typeof providers !== 'object') {
    return false;
  }
  const esnCard = (
    providers as {
      esnCard?: {
        status?: unknown;
      };
    }
  ).esnCard;
  return esnCard?.status === 'enabled';
};

const EDITABLE_EVENT_STATUSES = ['DRAFT', 'REJECTED'] as const;

const isEditableEventStatus = (
  status: (typeof schema.eventReviewStatus.enumValues)[number],
): status is (typeof EDITABLE_EVENT_STATUSES)[number] =>
  EDITABLE_EVENT_STATUSES.includes(
    status as (typeof EDITABLE_EVENT_STATUSES)[number],
  );

const canEditEvent = ({
  creatorId,
  permissions,
  userId,
}: {
  creatorId: string;
  permissions: readonly string[];
  userId: string;
}) => creatorId === userId || permissions.includes('events:editAll');

export const eventRouter = router({
  cancelPendingRegistration: cancelPendingRegistrationProcedure,

  create: authenticatedProcedure
    .meta({ requiredPermissions: ['events:create'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          description: Schema.NonEmptyString,
          end: Schema.ValidDateFromSelf,
          icon: iconSchema,
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
              roleIds: Schema.mutable(Schema.Array(Schema.NonEmptyString)),
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
      const sanitizedDescription = sanitizeRichTextHtml(input.description);
      if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Event description cannot be empty',
        });
      }

      const sanitizedRegistrationOptions = input.registrationOptions.map(
        (option) => ({
          ...option,
          description: sanitizeOptionalRichTextHtml(option.description),
          registeredDescription: sanitizeOptionalRichTextHtml(
            option.registeredDescription,
          ),
        }),
      );

      // Validate tax rates for all registration options before proceeding
      for (const [index, option] of sanitizedRegistrationOptions.entries()) {
        const validation = await validateTaxRate({
          isPaid: option.isPaid,
          // eslint-disable-next-line unicorn/no-null
          stripeTaxRateId: option.stripeTaxRateId ?? null,
          tenantId: ctx.tenant.id,
        });

        if (!validation.success) {
          consola.error(
            `Registration option ${index} tax rate validation failed:`,
            validation.error,
          );
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
          description: sanitizedDescription,
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
          sanitizedRegistrationOptions.map((option) => ({
            closeRegistrationTime: option.closeRegistrationTime,
            description: option.description,
            eventId: event.id,
            isPaid: option.isPaid,
            openRegistrationTime: option.openRegistrationTime,
            organizingRegistration: option.organizingRegistration,
            price: option.price,
            registeredDescription: option.registeredDescription,
            registrationMode: option.registrationMode,
            roleIds: option.roleIds,
            spots: option.spots,
            // eslint-disable-next-line unicorn/no-null
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
          const inserts: EventRegistrationOptionDiscountInsert[] = [];
          for (const event_ of createdOptions) {
            const t = tMap.get(
              key(event_.title, event_.organizingRegistration),
            );
            if (!t) continue;
            for (const d of templateDiscounts) {
              if (d.registrationOptionId === t.id) {
                inserts.push({
                  discountedPrice: d.discountedPrice,
                  discountType: d.discountType,
                  registrationOptionId: event_.id,
                });
              }
            }
          }
          if (inserts.length > 0) {
            await database
              .insert(schema.eventRegistrationOptionDiscounts)
              .values(inserts);
          }
        }
      }

      return event;
    }),

  findMany: eventListProcedure.query(async ({ ctx: { events } }) => {
    return events;
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
      const [reviewedEvent] = await database
        .update(schema.eventInstances)
        .set({
          reviewedAt: new Date(),
          reviewedBy: ctx.user.id,
          status: input.approved ? 'APPROVED' : 'REJECTED',
          // eslint-disable-next-line unicorn/no-null
          statusComment: input.comment || null,
        })
        .where(
          and(
            eq(schema.eventInstances.id, input.eventId),
            eq(schema.eventInstances.tenantId, ctx.tenant.id),
            eq(schema.eventInstances.status, 'PENDING_REVIEW'),
          ),
        )
        .returning();

      if (reviewedEvent) {
        return reviewedEvent;
      }

      const event = await database.query.eventInstances.findFirst({
        columns: { id: true },
        where: {
          id: input.eventId,
          tenantId: ctx.tenant.id,
        },
      });
      if (!event) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Event with id ${input.eventId} not found`,
        });
      }
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'Event is no longer pending review. Refresh and try again before reviewing.',
      });
    }),

  submitForReview: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          eventId: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const event = await database.query.eventInstances.findFirst({
        columns: {
          creatorId: true,
          id: true,
          status: true,
        },
        where: {
          id: input.eventId,
          tenantId: ctx.tenant.id,
        },
      });
      if (!event) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Event with id ${input.eventId} not found`,
        });
      }
      if (
        !canEditEvent({
          creatorId: event.creatorId,
          permissions: ctx.user.permissions,
          userId: ctx.user.id,
        })
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `User is not allowed to submit event with id ${input.eventId} for review`,
        });
      }
      if (!isEditableEventStatus(event.status)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Event status changed. Refresh and try again.',
        });
      }

      const [submittedEvent] = await database
        .update(schema.eventInstances)
        .set({
          // eslint-disable-next-line unicorn/no-null
          reviewedAt: null,
          // eslint-disable-next-line unicorn/no-null
          reviewedBy: null,
          status: 'PENDING_REVIEW',
          // eslint-disable-next-line unicorn/no-null
          statusComment: null,
        })
        .where(
          and(
            eq(schema.eventInstances.id, input.eventId),
            eq(schema.eventInstances.tenantId, ctx.tenant.id),
            inArray(schema.eventInstances.status, EDITABLE_EVENT_STATUSES),
          ),
        )
        .returning();
      if (!submittedEvent) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Event status changed. Refresh and try again.',
        });
      }
      return submittedEvent;
    }),

  update: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          description: Schema.NonEmptyString,
          end: Schema.ValidDateFromSelf,
          eventId: Schema.NonEmptyString,
          icon: iconSchema,
          location: Schema.NullOr(Schema.Any),
          registrationOptions: Schema.Array(
            Schema.Struct({
              closeRegistrationTime: Schema.ValidDateFromSelf,
              description: Schema.NullOr(Schema.NonEmptyString),
              esnCardDiscountedPrice: Schema.optional(
                Schema.NullOr(Schema.Number.pipe(Schema.nonNegative())),
              ),
              id: Schema.NonEmptyString,
              isPaid: Schema.Boolean,
              openRegistrationTime: Schema.ValidDateFromSelf,
              organizingRegistration: Schema.Boolean,
              price: Schema.Number.pipe(Schema.nonNegative()),
              registeredDescription: Schema.NullOr(Schema.NonEmptyString),
              registrationMode: Schema.Literal('fcfs', 'random', 'application'),
              roleIds: Schema.mutable(Schema.Array(Schema.NonEmptyString)),
              spots: Schema.Number.pipe(Schema.nonNegative()),
              stripeTaxRateId: Schema.optional(
                Schema.NullOr(Schema.NonEmptyString),
              ),
              title: Schema.NonEmptyString,
            }),
          ),
          start: Schema.ValidDateFromSelf,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const sanitizedDescription = sanitizeRichTextHtml(input.description);
      if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Event description cannot be empty',
        });
      }
      const sanitizedRegistrationOptions = input.registrationOptions.map(
        (option) => ({
          ...option,
          description: sanitizeOptionalRichTextHtml(option.description),
          esnCardDiscountedPrice:
            option.esnCardDiscountedPrice === undefined
              ? null
              : option.esnCardDiscountedPrice,
          registeredDescription: sanitizeOptionalRichTextHtml(
            option.registeredDescription,
          ),
        }),
      );

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
      if (
        !canEditEvent({
          creatorId: event.creatorId,
          permissions: ctx.user.permissions,
          userId: ctx.user.id,
        })
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'User is not allowed to edit this event',
        });
      }
      if (!isEditableEventStatus(event.status)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'Event is locked for editing. Only draft or rejected events can be edited.',
        });
      }

      const esnCardEnabledForTenant = isEsnCardEnabled(
        ctx.tenant.discountProviders ?? null,
      );

      for (const [index, option] of sanitizedRegistrationOptions.entries()) {
        const validation = await validateTaxRate({
          isPaid: option.isPaid,
          // eslint-disable-next-line unicorn/no-null
          stripeTaxRateId: option.stripeTaxRateId ?? null,
          tenantId: ctx.tenant.id,
        });
        if (!validation.success) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Registration option "${option.title}": ${validation.error.message}`,
          });
        }

        if (
          option.esnCardDiscountedPrice !== null &&
          option.esnCardDiscountedPrice > option.price
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Registration option "${option.title}": ESNcard discounted price cannot be greater than the base price`,
          });
        }

        if (
          option.esnCardDiscountedPrice !== null &&
          !esnCardEnabledForTenant &&
          option.isPaid
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Registration option "${option.title}": ESNcard provider is disabled for this tenant`,
          });
        }

        if (option.spots < 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Registration option at index ${index} has invalid spots`,
          });
        }
      }

      const updatedEvent = await database.transaction(async (tx) => {
        const [eventRow] = await tx
          .update(schema.eventInstances)
          .set({
            description: sanitizedDescription,
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
              inArray(schema.eventInstances.status, EDITABLE_EVENT_STATUSES),
            ),
          )
          .returning();
        if (!eventRow) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Event status changed. Refresh and try again.',
          });
        }

        const existingRegistrationOptions =
          await tx.query.eventRegistrationOptions.findMany({
            where: {
              eventId: input.eventId,
            },
          });
        const existingRegistrationOptionIds = new Set(
          existingRegistrationOptions.map((option) => option.id),
        );
        for (const option of sanitizedRegistrationOptions) {
          if (!existingRegistrationOptionIds.has(option.id)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Registration option "${option.title}" is not part of this event`,
            });
          }
        }

        await Promise.all(
          sanitizedRegistrationOptions.map((option) =>
            tx
              .update(schema.eventRegistrationOptions)
              .set({
                closeRegistrationTime: option.closeRegistrationTime,
                description: option.description,
                isPaid: option.isPaid,
                openRegistrationTime: option.openRegistrationTime,
                organizingRegistration: option.organizingRegistration,
                price: option.price,
                registeredDescription: option.registeredDescription,
                registrationMode: option.registrationMode,
                roleIds: option.roleIds,
                spots: option.spots,
                // eslint-disable-next-line unicorn/no-null
                stripeTaxRateId: option.stripeTaxRateId ?? null,
                title: option.title,
              })
              .where(
                and(
                  eq(schema.eventRegistrationOptions.eventId, input.eventId),
                  eq(schema.eventRegistrationOptions.id, option.id),
                ),
              ),
          ),
        );

        const existingEsnDiscounts =
          sanitizedRegistrationOptions.length === 0
            ? []
            : await tx
                .select()
                .from(schema.eventRegistrationOptionDiscounts)
                .where(
                  and(
                    eq(
                      schema.eventRegistrationOptionDiscounts.discountType,
                      'esnCard',
                    ),
                    inArray(
                      schema.eventRegistrationOptionDiscounts.registrationOptionId,
                      sanitizedRegistrationOptions.map((option) => option.id),
                    ),
                  ),
                );
        const existingEsnDiscountByRegistrationOptionId = new Map(
          existingEsnDiscounts.map((discount) => [
            discount.registrationOptionId,
            discount,
          ]),
        );

        for (const option of sanitizedRegistrationOptions) {
          const existingDiscount = existingEsnDiscountByRegistrationOptionId.get(
            option.id,
          );
          const shouldPersistDiscount =
            esnCardEnabledForTenant &&
            option.isPaid &&
            option.esnCardDiscountedPrice !== null;

          if (!shouldPersistDiscount) {
            if (existingDiscount) {
              await tx
                .delete(schema.eventRegistrationOptionDiscounts)
                .where(
                  eq(
                    schema.eventRegistrationOptionDiscounts.id,
                    existingDiscount.id,
                  ),
                );
            }
            continue;
          }

          const discountedPrice = option.esnCardDiscountedPrice;
          if (discountedPrice === null) {
            continue;
          }

          if (existingDiscount) {
            await tx
              .update(schema.eventRegistrationOptionDiscounts)
              .set({
                discountedPrice,
              })
              .where(
                eq(schema.eventRegistrationOptionDiscounts.id, existingDiscount.id),
              );
            continue;
          }

          await tx.insert(schema.eventRegistrationOptionDiscounts).values({
            discountedPrice,
            discountType: 'esnCard',
            registrationOptionId: option.id,
          });
        }

        return eventRow;
      });
      return updatedEvent;
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
