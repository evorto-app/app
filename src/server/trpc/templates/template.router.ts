import { iconSchema } from '@shared/types/icon';
import { TRPCError } from '@trpc/server';
import consola from 'consola';
import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import {
  eventTemplates,
  templateRegistrationOptions,
} from '../../../db/schema';
import { EventLocation } from '../../../types/location';
import {
  isMeaningfulRichTextHtml,
  sanitizeRichTextHtml,
} from '../../utils/rich-text-sanitize';
import { validateTaxRate } from '../../utils/validate-tax-rate';
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
          icon: iconSchema,
          location: Schema.NullOr(EventLocation),
          organizerRegistration: registrationOptionSchema,
          participantRegistration: registrationOptionSchema,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const sanitizedDescription = sanitizeRichTextHtml(input.description);
      if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Template description cannot be empty',
        });
      }

      // Validate tax rates for both registration options before proceeding
      const organizerValidation = await validateTaxRate({
        isPaid: input.organizerRegistration.isPaid,
        // eslint-disable-next-line unicorn/no-null
        stripeTaxRateId: input.organizerRegistration.stripeTaxRateId ?? null,
        tenantId: ctx.tenant.id,
      });

      if (!organizerValidation.success) {
        consola.error(
          'Organizer registration tax rate validation failed:',
          organizerValidation.error,
        );
        throw new Error(
          `Organizer registration: ${organizerValidation.error.message}`,
        );
      }

      const participantValidation = await validateTaxRate({
        isPaid: input.participantRegistration.isPaid,
        // eslint-disable-next-line unicorn/no-null
        stripeTaxRateId: input.participantRegistration.stripeTaxRateId ?? null,
        tenantId: ctx.tenant.id,
      });

      if (!participantValidation.success) {
        consola.error(
          'Participant registration tax rate validation failed:',
          participantValidation.error,
        );
        throw new Error(
          `Participant registration: ${participantValidation.error.message}`,
        );
      }

      const templateResponse = await database
        .insert(eventTemplates)
        .values({
          categoryId: input.categoryId,
          description: sanitizedDescription,
          icon: input.icon,
          location: input.location,
          simpleModeEnabled: true,
          tenantId: ctx.tenant.id,
          title: input.title,
        })
        .returning();
      const templateId = templateResponse[0].id;

      // Create organizer registration option
      await database.insert(templateRegistrationOptions).values({
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
        // eslint-disable-next-line unicorn/no-null
        stripeTaxRateId: input.organizerRegistration.stripeTaxRateId ?? null,
        templateId,
        title: 'Organizer registration',
      });

      // Create participant registration option
      await database.insert(templateRegistrationOptions).values({
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
        stripeTaxRateId:
          // eslint-disable-next-line unicorn/no-null
          input.participantRegistration.stripeTaxRateId ?? null,
        templateId,
        title: 'Participant registration',
      });

      return templateResponse[0];
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
  updateSimpleTemplate: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          categoryId: Schema.NonEmptyString,
          description: Schema.NonEmptyString,
          icon: iconSchema,
          id: Schema.NonEmptyString,
          location: Schema.NullOr(EventLocation),
          organizerRegistration: registrationOptionSchema,
          participantRegistration: registrationOptionSchema,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const sanitizedDescription = sanitizeRichTextHtml(input.description);
      if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Template description cannot be empty',
        });
      }

      // Validate tax rates for both registration options before proceeding
      const organizerValidation = await validateTaxRate({
        isPaid: input.organizerRegistration.isPaid,
        // eslint-disable-next-line unicorn/no-null
        stripeTaxRateId: input.organizerRegistration.stripeTaxRateId ?? null,
        tenantId: ctx.tenant.id,
      });

      if (!organizerValidation.success) {
        consola.error(
          'Organizer registration tax rate validation failed:',
          organizerValidation.error,
        );
        throw new Error(
          `Organizer registration: ${organizerValidation.error.message}`,
        );
      }

      const participantValidation = await validateTaxRate({
        isPaid: input.participantRegistration.isPaid,
        // eslint-disable-next-line unicorn/no-null
        stripeTaxRateId: input.participantRegistration.stripeTaxRateId ?? null,
        tenantId: ctx.tenant.id,
      });

      if (!participantValidation.success) {
        consola.error(
          'Participant registration tax rate validation failed:',
          participantValidation.error,
        );
        throw new Error(
          `Participant registration: ${participantValidation.error.message}`,
        );
      }

      const template = await database
        .update(eventTemplates)
        .set({
          categoryId: input.categoryId,
          description: sanitizedDescription,
          icon: input.icon,
          location: input.location,
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
      await database
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
            // eslint-disable-next-line unicorn/no-null
            input.organizerRegistration.stripeTaxRateId ?? null,
        })
        .where(
          and(
            eq(templateRegistrationOptions.templateId, input.id),
            eq(templateRegistrationOptions.organizingRegistration, true),
          ),
        );

      // Update participant registration option
      await database
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
            // eslint-disable-next-line unicorn/no-null
            input.participantRegistration.stripeTaxRateId ?? null,
        })
        .where(
          and(
            eq(templateRegistrationOptions.templateId, input.id),
            eq(templateRegistrationOptions.organizingRegistration, false),
          ),
        );

      return template[0];
    }),
});
