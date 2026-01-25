import consola from 'consola';
import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { createId } from '../../../db/create-id';
import {
  eventInstances,
  eventRegistrationOptions,
  eventTemplates,
  templateRegistrationOptions,
} from '../../../db/schema';
import { computeIconSourceColor } from '../../utils/icon-color';
import { createLogContext, TaxRateLogger } from '../../utils/tax-rate-logging';
import { validateDiscountConfiguration } from '../../utils/validate-discounts';
import { validateTaxRate } from '../../utils/validate-tax-rate';
import { authenticatedProcedure, router } from '../trpc-server';

const discountSchema = Schema.Struct({
  discountedPrice: Schema.Number.pipe(Schema.nonNegative()),
  discountType: Schema.Literal('esnCard'),
});

const registrationOptionSchema = Schema.Struct({
  closeRegistrationOffset: Schema.Number.pipe(Schema.nonNegative()),
  discounts: Schema.optional(Schema.Array(discountSchema)),
  isPaid: Schema.Boolean,
  openRegistrationOffset: Schema.Number.pipe(Schema.nonNegative()),
  price: Schema.Number.pipe(Schema.nonNegative()),
  registrationMode: Schema.Literal('fcfs', 'random', 'application'),
  roleIds: Schema.mutable(Schema.Array(Schema.NonEmptyString)),
  spots: Schema.Positive,
  stripeTaxRateId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
});

export const templateRouter = router({
  createEventFromTemplate: authenticatedProcedure
    .meta({ requiredPermissions: ['events:create'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          description: Schema.optional(Schema.NonEmptyString),
          end: Schema.ValidDateFromSelf,
          start: Schema.ValidDateFromSelf,
          templateId: Schema.NonEmptyString,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      return database.transaction(async (tx) => {
        // Get the template with its registration options
        const template = await tx.query.eventTemplates.findFirst({
          where: { id: input.templateId, tenantId: ctx.tenant.id },
          with: {
            registrationOptions: true,
          },
        });

        if (!template) {
          throw new Error('Template not found');
        }

        // Create the event instance
        const event = await tx
          .insert(eventInstances)
          .values({
            creatorId: ctx.user.id,
            description: input.description || template.description,
            end: input.end,
            icon: template.icon,
            location: template.location,
            start: input.start,
            templateId: template.id,
            tenantId: ctx.tenant.id,
            title: input.title,
          })
          .returning()
          .then((result) => result[0]);

        // Duplicate each template registration option to event registration options
        for (const templateOption of template.registrationOptions) {
          await tx.insert(eventRegistrationOptions).values({
            closeRegistrationTime: new Date(
              input.start.getTime() + templateOption.closeRegistrationOffset * 60 * 60 * 1000,
            ),
            description: templateOption.description,
            // Copy discounts JSON array from template to event
            discounts: templateOption.discounts,
            eventId: event.id,
            isPaid: templateOption.isPaid,
            // Calculate registration times based on offsets
            openRegistrationTime: new Date(
              input.start.getTime() + templateOption.openRegistrationOffset * 60 * 60 * 1000,
            ),
            organizingRegistration: templateOption.organizingRegistration,
            price: templateOption.price,
            registeredDescription: templateOption.registeredDescription,
            registrationMode: templateOption.registrationMode,
            roleIds: templateOption.roleIds,
            spots: templateOption.spots,
            stripeTaxRateId: templateOption.stripeTaxRateId,
            title: templateOption.title,
          });
        }

        consola.info(
          `Created event ${event.id} from template ${template.id} with ${template.registrationOptions.length} registration options`,
        );

        return event;
      });
    }),

  createSimpleTemplate: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          categoryId: Schema.NonEmptyString,
          description: Schema.NonEmptyString,
          icon: Schema.Struct({
            iconColor: Schema.Number,
            iconName: Schema.NonEmptyString,
          }),
          organizerRegistration: registrationOptionSchema,
          participantRegistration: registrationOptionSchema,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      validateDiscountConfiguration({
        discounts: input.organizerRegistration.discounts,
        isPaid: input.organizerRegistration.isPaid,
        price: input.organizerRegistration.price,
        title: 'Organizer registration',
      });
      validateDiscountConfiguration({
        discounts: input.participantRegistration.discounts,
        isPaid: input.participantRegistration.isPaid,
        price: input.participantRegistration.price,
        title: 'Participant registration',
      });

      // Validate tax rates for both registration options before proceeding
      const organizerValidation = await validateTaxRate({
        isPaid: input.organizerRegistration.isPaid,
        stripeTaxRateId: input.organizerRegistration.stripeTaxRateId ?? null,
        tenantId: ctx.tenant.id,
      });

      if (!organizerValidation.success) {
        consola.error(
          'Organizer registration tax rate validation failed:',
          organizerValidation.error,
        );
        throw new Error(`Organizer registration: ${organizerValidation.error.message}`);
      }

      const participantValidation = await validateTaxRate({
        isPaid: input.participantRegistration.isPaid,
        stripeTaxRateId: input.participantRegistration.stripeTaxRateId ?? null,
        tenantId: ctx.tenant.id,
      });

      if (!participantValidation.success) {
        consola.error(
          'Participant registration tax rate validation failed:',
          participantValidation.error,
        );
        throw new Error(`Participant registration: ${participantValidation.error.message}`);
      }

      const template = await database.transaction(async (tx) => {
        const templateResponse = await tx
          .insert(eventTemplates)
          .values({
            categoryId: input.categoryId,
            description: input.description,
            icon: input.icon,
            simpleModeEnabled: true,
            tenantId: ctx.tenant.id,
            title: input.title,
          })
          .returning();
        const templateId = templateResponse[0].id;

        const organizerDiscounts = input.organizerRegistration.discounts
          ? input.organizerRegistration.discounts.map((discount) => ({ ...discount }))
          : null;
        const participantDiscounts = input.participantRegistration.discounts
          ? input.participantRegistration.discounts.map((discount) => ({ ...discount }))
          : null;

        // Create organizer registration option
        await tx.insert(templateRegistrationOptions).values({
          closeRegistrationOffset: input.organizerRegistration.closeRegistrationOffset,
          discounts: organizerDiscounts,
          isPaid: input.organizerRegistration.isPaid,
          openRegistrationOffset: input.organizerRegistration.openRegistrationOffset,
          organizingRegistration: true,
          price: input.organizerRegistration.price,
          registrationMode: input.organizerRegistration.registrationMode,
          roleIds: input.organizerRegistration.roleIds,
          spots: input.organizerRegistration.spots,
          stripeTaxRateId: input.organizerRegistration.stripeTaxRateId ?? null,
          templateId,
          title: 'Organizer registration',
        });

        // Create participant registration option
        await tx.insert(templateRegistrationOptions).values({
          closeRegistrationOffset: input.participantRegistration.closeRegistrationOffset,
          discounts: participantDiscounts,
          isPaid: input.participantRegistration.isPaid,
          openRegistrationOffset: input.participantRegistration.openRegistrationOffset,
          organizingRegistration: false,
          price: input.participantRegistration.price,
          registrationMode: input.participantRegistration.registrationMode,
          roleIds: input.participantRegistration.roleIds,
          spots: input.participantRegistration.spots,
          stripeTaxRateId: input.participantRegistration.stripeTaxRateId ?? null,
          templateId,
          title: 'Participant registration',
        });

        return templateResponse[0];
      });

      return template;
    }),
  findMany: authenticatedProcedure.query(async ({ ctx }) => {
    return await database.query.eventTemplates.findMany({
      where: { tenantId: ctx.tenant.id },
    });
  }),
  findOne: authenticatedProcedure
    .input(Schema.standardSchemaV1(Schema.Struct({ id: Schema.NonEmptyString })))
    .query(async ({ ctx, input }) => {
      const template = await database.query.eventTemplates.findFirst({
        where: { id: input.id, tenantId: ctx.tenant.id },
        with: {
          registrationOptions: true,
        },
      });
      if (!template) {
        throw new Error('Template not found');
      }
      const combinedRegistrationOptionRoleIds = template.registrationOptions.flatMap(
        (option) => option.roleIds,
      );
      const roles = await database.query.roles.findMany({
        where: {
          id: { in: combinedRegistrationOptionRoleIds },
          tenantId: ctx.tenant.id,
        },
      });
      return {
        ...template,
        registrationOptions: template.registrationOptions.map((option) => ({
          ...option,
          roles: roles.filter((role) => option.roleIds.includes(role.id)),
        })),
      };
    }),
  groupedByCategory: authenticatedProcedure.query(async ({ ctx }) => {
    return await database.query.eventTemplateCategories.findMany({
      orderBy: (categories, { asc }) => [asc(categories.title)],
      where: { tenantId: ctx.tenant.id },
      with: {
        templates: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }),
  updateSimpleTemplate: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          categoryId: Schema.NonEmptyString,
          description: Schema.NonEmptyString,
          icon: Schema.Struct({
            iconColor: Schema.optional(Schema.Number),
            iconName: Schema.NonEmptyString,
          }),
          id: Schema.NonEmptyString,
          organizerRegistration: registrationOptionSchema,
          participantRegistration: registrationOptionSchema,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      validateDiscountConfiguration({
        discounts: input.organizerRegistration.discounts,
        isPaid: input.organizerRegistration.isPaid,
        price: input.organizerRegistration.price,
        title: 'Organizer registration',
      });
      validateDiscountConfiguration({
        discounts: input.participantRegistration.discounts,
        isPaid: input.participantRegistration.isPaid,
        price: input.participantRegistration.price,
        title: 'Participant registration',
      });

      // Validate tax rates for both registration options before proceeding
      const organizerValidation = await validateTaxRate({
        isPaid: input.organizerRegistration.isPaid,
        stripeTaxRateId: input.organizerRegistration.stripeTaxRateId ?? null,
        tenantId: ctx.tenant.id,
      });

      if (!organizerValidation.success) {
        consola.error(
          'Organizer registration tax rate validation failed:',
          organizerValidation.error,
        );
        throw new Error(`Organizer registration: ${organizerValidation.error.message}`);
      }

      const participantValidation = await validateTaxRate({
        isPaid: input.participantRegistration.isPaid,
        stripeTaxRateId: input.participantRegistration.stripeTaxRateId ?? null,
        tenantId: ctx.tenant.id,
      });

      if (!participantValidation.success) {
        consola.error(
          'Participant registration tax rate validation failed:',
          participantValidation.error,
        );
        throw new Error(`Participant registration: ${participantValidation.error.message}`);
      }

      return await database.transaction(async (tx) => {
        const iconColor =
          input.icon.iconColor ?? (await computeIconSourceColor(input.icon.iconName));
        const template = await tx
          .update(eventTemplates)
          .set({
            categoryId: input.categoryId,
            description: input.description,
            icon: { iconColor: iconColor!, iconName: input.icon.iconName },
            title: input.title,
          })
          .where(
            and(
              eq(eventTemplates.id, input.id),
              eq(eventTemplates.tenantId, ctx.tenant.id),
              eq(eventTemplates.simpleModeEnabled, true),
            ),
          )
          .returning();

        // Update organizer registration option
        const organizerHasDiscounts = Object.prototype.hasOwnProperty.call(
          input.organizerRegistration,
          'discounts',
        );
        const organizerDiscounts =
          input.organizerRegistration.discounts && input.organizerRegistration.discounts.length > 0
            ? input.organizerRegistration.discounts.map((discount) => ({ ...discount }))
            : null;
        const organizerUpdate = {
          closeRegistrationOffset: input.organizerRegistration.closeRegistrationOffset,
          isPaid: input.organizerRegistration.isPaid,
          openRegistrationOffset: input.organizerRegistration.openRegistrationOffset,
          price: input.organizerRegistration.price,
          registrationMode: input.organizerRegistration.registrationMode,
          roleIds: input.organizerRegistration.roleIds,
          spots: input.organizerRegistration.spots,
          stripeTaxRateId: input.organizerRegistration.stripeTaxRateId ?? null,
          ...(organizerHasDiscounts ? { discounts: organizerDiscounts } : {}),
        };

        await tx
          .update(templateRegistrationOptions)
          .set(organizerUpdate)
          .where(
            and(
              eq(templateRegistrationOptions.templateId, input.id),
              eq(templateRegistrationOptions.organizingRegistration, true),
            ),
          );

        // Update participant registration option
        const participantHasDiscounts = Object.prototype.hasOwnProperty.call(
          input.participantRegistration,
          'discounts',
        );
        const participantDiscounts =
          input.participantRegistration.discounts &&
          input.participantRegistration.discounts.length > 0
            ? input.participantRegistration.discounts.map((discount) => ({ ...discount }))
            : null;
        const participantUpdate = {
          closeRegistrationOffset: input.participantRegistration.closeRegistrationOffset,
          isPaid: input.participantRegistration.isPaid,
          openRegistrationOffset: input.participantRegistration.openRegistrationOffset,
          price: input.participantRegistration.price,
          registrationMode: input.participantRegistration.registrationMode,
          roleIds: input.participantRegistration.roleIds,
          spots: input.participantRegistration.spots,
          stripeTaxRateId: input.participantRegistration.stripeTaxRateId ?? null,
          ...(participantHasDiscounts ? { discounts: participantDiscounts } : {}),
        };

        await tx
          .update(templateRegistrationOptions)
          .set(participantUpdate)
          .where(
            and(
              eq(templateRegistrationOptions.templateId, input.id),
              eq(templateRegistrationOptions.organizingRegistration, false),
            ),
          );

        return template[0];
      });
    }),
});
