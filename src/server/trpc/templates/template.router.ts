import { and, eq, inArray } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import {
  eventTemplates,
  templateRegistrationOptions,
} from '../../../db/schema';
import { authenticatedProcedure, router } from '../trpc-server';

const registrationOptionSchema = Schema.Struct({
  closeRegistrationOffset: Schema.Number.pipe(Schema.nonNegative()),
  isPaid: Schema.Boolean,
  openRegistrationOffset: Schema.Number.pipe(Schema.nonNegative()),
  price: Schema.Number.pipe(Schema.nonNegative()),
  registrationMode: Schema.Literal('fcfs', 'random', 'application'),
  roleIds: Schema.mutable(Schema.Array(Schema.NonEmptyString)),
  spots: Schema.Positive,
});

export const templateRouter = router({
  createSimpleTemplate: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          categoryId: Schema.NonEmptyString,
          description: Schema.NonEmptyString,
          icon: Schema.NonEmptyString,
          organizerRegistration: registrationOptionSchema,
          participantRegistration: registrationOptionSchema,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
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
          templateId,
          title: 'Participant registration',
        });

        return templateResponse[0];
      });

      return template;
    }),
  findMany: authenticatedProcedure.query(async ({ ctx }) => {
    return await database.query.eventTemplates.findMany({
      where: eq(eventTemplates.tenantId, ctx.tenant.id),
    });
  }),
  findOne: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString })),
    )
    .query(async ({ ctx, input }) => {
      const template = await database.query.eventTemplates.findFirst({
        where: and(
          eq(schema.eventTemplates.id, input.id),
          eq(schema.eventTemplates.tenantId, ctx.tenant.id),
        ),
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
        where: and(
          eq(schema.roles.tenantId, ctx.tenant.id),
          inArray(schema.roles.id, combinedRegistrationOptionRoleIds),
        ),
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
      where: eq(eventTemplates.tenantId, ctx.tenant.id),
      with: {
        templates: {
          orderBy: (templates, { asc }) => [asc(templates.createdAt)],
        },
      },
    });
  }),
  updateSimpleTemplate: authenticatedProcedure
    .input(
      Schema.decodeUnknownSync(
        Schema.Struct({
          categoryId: Schema.NonEmptyString,
          description: Schema.NonEmptyString,
          icon: Schema.NonEmptyString,
          id: Schema.NonEmptyString,
          organizerRegistration: registrationOptionSchema,
          participantRegistration: registrationOptionSchema,
          title: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      return await database.transaction(async (tx) => {
        const template = await tx
          .update(eventTemplates)
          .set({
            categoryId: input.categoryId,
            description: input.description,
            icon: input.icon,
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
