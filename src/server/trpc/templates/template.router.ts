import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';
import consola from 'consola';

import { database } from '../../../db';
import {
  eventTemplates,
  templateRegistrationOptions,
} from '../../../db/schema';
import { computeIconSourceColor } from '../../utils/icon-color';
import { validateTaxRate } from '../../utils/validate-tax-rate';
import { TaxRateLogger, createLogContext } from '../../utils/tax-rate-logging';
import { authenticatedProcedure, router } from '../trpc-server';

const registrationOptionSchema = Schema.Struct({
  closeRegistrationOffset: Schema.Number.pipe(Schema.nonNegative()),
  isPaid: Schema.Boolean,
  openRegistrationOffset: Schema.Number.pipe(Schema.nonNegative()),
  price: Schema.Number.pipe(Schema.nonNegative()),
  registrationMode: Schema.Literal('fcfs', 'random', 'application'),
  roleIds: Schema.mutable(Schema.Array(Schema.NonEmptyString)),
  spots: Schema.Positive,
  stripeTaxRateId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
});

export const templateRouter = router({
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
      // Validate tax rates for both registration options before proceeding
      const organizerValidation = await validateTaxRate({
        isPaid: input.organizerRegistration.isPaid,
        stripeTaxRateId: input.organizerRegistration.stripeTaxRateId ?? null,
        tenantId: ctx.tenant.id,
      });

      if (!organizerValidation.success) {
        consola.error('Organizer registration tax rate validation failed:', organizerValidation.error);
        throw new Error(`Organizer registration: ${organizerValidation.error.message}`);
      }

      const participantValidation = await validateTaxRate({
        isPaid: input.participantRegistration.isPaid,
        stripeTaxRateId: input.participantRegistration.stripeTaxRateId ?? null,
        tenantId: ctx.tenant.id,
      });

      if (!participantValidation.success) {
        consola.error('Participant registration tax rate validation failed:', participantValidation.error);
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

        // Create organizer registration option
        await tx.insert(templateRegistrationOptions).values({
          closeRegistrationOffset:
            input.organizerRegistration.closeRegistrationOffset,
          isPaid: input.organizerRegistration.isPaid,
          openRegistrationOffset:
            input.organizerRegistration.openRegistrationOffset,
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
          closeRegistrationOffset:
            input.participantRegistration.closeRegistrationOffset,
          isPaid: input.participantRegistration.isPaid,
          openRegistrationOffset:
            input.participantRegistration.openRegistrationOffset,
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
    .input(
      Schema.standardSchemaV1(Schema.Struct({ id: Schema.NonEmptyString })),
    )
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
      const combinedRegistrationOptionRoleIds =
        template.registrationOptions.flatMap((option) => option.roleIds);
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
      // Validate tax rates for both registration options before proceeding
      const organizerValidation = await validateTaxRate({
        isPaid: input.organizerRegistration.isPaid,
        stripeTaxRateId: input.organizerRegistration.stripeTaxRateId ?? null,
        tenantId: ctx.tenant.id,
      });

      if (!organizerValidation.success) {
        consola.error('Organizer registration tax rate validation failed:', organizerValidation.error);
        throw new Error(`Organizer registration: ${organizerValidation.error.message}`);
      }

      const participantValidation = await validateTaxRate({
        isPaid: input.participantRegistration.isPaid,
        stripeTaxRateId: input.participantRegistration.stripeTaxRateId ?? null,
        tenantId: ctx.tenant.id,
      });

      if (!participantValidation.success) {
        consola.error('Participant registration tax rate validation failed:', participantValidation.error);
        throw new Error(`Participant registration: ${participantValidation.error.message}`);
      }

      return await database.transaction(async (tx) => {
        const iconColor =
          input.icon.iconColor ??
          (await computeIconSourceColor(input.icon.iconName));
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
        await tx
          .update(templateRegistrationOptions)
          .set({
            closeRegistrationOffset:
              input.organizerRegistration.closeRegistrationOffset,
            isPaid: input.organizerRegistration.isPaid,
            openRegistrationOffset:
              input.organizerRegistration.openRegistrationOffset,
            price: input.organizerRegistration.price,
            registrationMode: input.organizerRegistration.registrationMode,
            roleIds: input.organizerRegistration.roleIds,
            spots: input.organizerRegistration.spots,
            stripeTaxRateId:
              input.organizerRegistration.stripeTaxRateId ?? null,
          })
          .where(
            and(
              eq(templateRegistrationOptions.templateId, input.id),
              eq(templateRegistrationOptions.organizingRegistration, true),
            ),
          );

        // Update participant registration option
        await tx
          .update(templateRegistrationOptions)
          .set({
            closeRegistrationOffset:
              input.participantRegistration.closeRegistrationOffset,
            isPaid: input.participantRegistration.isPaid,
            openRegistrationOffset:
              input.participantRegistration.openRegistrationOffset,
            price: input.participantRegistration.price,
            registrationMode: input.participantRegistration.registrationMode,
            roleIds: input.participantRegistration.roleIds,
            spots: input.participantRegistration.spots,
            stripeTaxRateId:
              input.participantRegistration.stripeTaxRateId ?? null,
          })
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
