import { and, eq } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-orm/effect-schema';
import { Effect } from 'effect';
import { Schema } from 'effect';

import type { AppRpcHandlers } from '../../shared/handler-types';

import { Database, type DatabaseClient } from '../../../../../../db';
import {
  eventTemplates,
  templateRegistrationOptions,
} from '../../../../../../db/schema';
import {
  isMeaningfulRichTextHtml,
  sanitizeRichTextHtml,
} from '../../../../../utils/rich-text-sanitize';
import { validateTaxRate } from '../../../../../utils/validate-tax-rate';
import {
  TemplateSimpleBadRequestError,
  TemplateSimpleInternalError,
  TemplateSimpleNotFoundError,
} from './templates.errors';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.pipe(Effect.flatMap((database) => operation(database).pipe(Effect.orDie)));

const EventTemplateInsertCoreSchema = createInsertSchema(eventTemplates).pick(
  'categoryId',
  'description',
  'simpleModeEnabled',
  'tenantId',
  'title',
);
const TemplateRegistrationOptionInsertSchema =
  createInsertSchema(templateRegistrationOptions).pick(
    'closeRegistrationOffset',
    'isPaid',
    'openRegistrationOffset',
    'organizingRegistration',
    'price',
    'registrationMode',
    'roleIds',
    'spots',
    'stripeTaxRateId',
    'templateId',
    'title',
  );

type CreateSimpleTemplateInput = Parameters<
  AppRpcHandlers['templates.createSimpleTemplate']
>[0];
type EventTemplateInsert = typeof eventTemplates.$inferInsert;
type SimpleTemplateValidationInput = Pick<
  CreateSimpleTemplateInput,
  'description' | 'organizerRegistration' | 'participantRegistration'
>;
type TemplateRegistrationOptionInsert =
  typeof templateRegistrationOptions.$inferInsert;
type UpdateSimpleTemplateInput = Parameters<
  AppRpcHandlers['templates.updateSimpleTemplate']
>[0];

export class SimpleTemplateService extends Effect.Service<SimpleTemplateService>()(
  '@server/effect/rpc/handlers/domains/templates/SimpleTemplateService',
  {
    accessors: true,
    effect: Effect.sync(() => {
      const validateSimpleTemplateInput = Effect.fn(
        'SimpleTemplateService.validateSimpleTemplateInput',
      )(
        function* ({
          input,
          tenantId,
        }: {
          input: SimpleTemplateValidationInput;
          tenantId: string;
        }) {
          const sanitizedDescription = sanitizeRichTextHtml(input.description);
          if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
            return yield* Effect.fail(
              new TemplateSimpleBadRequestError({
                message: 'Description is not meaningful rich text',
              }),
            );
          }

          const organizerValidation = yield* databaseEffect((database) =>
            validateTaxRate(database, {
              isPaid: input.organizerRegistration.isPaid,
              stripeTaxRateId: input.organizerRegistration.stripeTaxRateId ?? null,
              tenantId,
            }),
          );
          if (!organizerValidation.success) {
            yield* Effect.logError('Organizer registration tax rate validation failed').pipe(
              Effect.annotateLogs({
                error: organizerValidation.error,
              }),
            );
            return yield* Effect.fail(
              new TemplateSimpleBadRequestError({
                message: 'Organizer registration tax rate validation failed',
              }),
            );
          }

          const participantValidation = yield* databaseEffect((database) =>
            validateTaxRate(database, {
              isPaid: input.participantRegistration.isPaid,
              stripeTaxRateId:
                input.participantRegistration.stripeTaxRateId ?? null,
              tenantId,
            }),
          );
          if (!participantValidation.success) {
            yield* Effect.logError('Participant registration tax rate validation failed').pipe(
              Effect.annotateLogs({
                error: participantValidation.error,
              }),
            );
            return yield* Effect.fail(
              new TemplateSimpleBadRequestError({
                message: 'Participant registration tax rate validation failed',
              }),
            );
          }

          return { sanitizedDescription };
        },
      );

      const createSimpleTemplate = Effect.fn(
        'SimpleTemplateService.createSimpleTemplate',
      )(
        function* ({
          input,
          tenantId,
        }: {
          input: CreateSimpleTemplateInput;
          tenantId: string;
        }) {
          const { sanitizedDescription } = yield* validateSimpleTemplateInput({
            input,
            tenantId,
          });
          const templateInsertCore = Schema.decodeUnknownSync(
            EventTemplateInsertCoreSchema,
          )({
            categoryId: input.categoryId,
            description: sanitizedDescription,
            simpleModeEnabled: true,
            tenantId,
            title: input.title,
          });
          const templateInsertValues: EventTemplateInsert = {
            ...templateInsertCore,
            icon: input.icon,
            location: input.location,
          };

          const templateResponse = yield* databaseEffect((database) =>
            database
              .insert(eventTemplates)
              .values(templateInsertValues)
              .returning({
                id: eventTemplates.id,
              }),
          );

          const template = templateResponse[0];
          if (!template) {
            return yield* Effect.fail(
              new TemplateSimpleInternalError({
                message: 'Template insert failed',
              }),
            );
          }
          const organizerRegistrationInsertCore = Schema.decodeUnknownSync(
            TemplateRegistrationOptionInsertSchema,
          )({
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
            templateId: template.id,
            title: 'Organizer registration',
          });
          const participantRegistrationInsertCore = Schema.decodeUnknownSync(
            TemplateRegistrationOptionInsertSchema,
          )({
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
            templateId: template.id,
            title: 'Participant registration',
          });
          const organizerRegistrationInsert: TemplateRegistrationOptionInsert = {
            ...organizerRegistrationInsertCore,
            roleIds: [...(organizerRegistrationInsertCore.roleIds ?? [])],
          };
          const participantRegistrationInsert: TemplateRegistrationOptionInsert = {
            ...participantRegistrationInsertCore,
            roleIds: [...(participantRegistrationInsertCore.roleIds ?? [])],
          };
          const registrationOptionInserts: TemplateRegistrationOptionInsert[] = [
            organizerRegistrationInsert,
            participantRegistrationInsert,
          ];

          yield* databaseEffect((database) =>
            database
              .insert(templateRegistrationOptions)
              .values(registrationOptionInserts),
          );

          return { id: template.id };
        },
      );

      const updateSimpleTemplate = Effect.fn(
        'SimpleTemplateService.updateSimpleTemplate',
      )(
        function* ({
          input,
          tenantId,
        }: {
          input: UpdateSimpleTemplateInput;
          tenantId: string;
        }) {
          const { sanitizedDescription } = yield* validateSimpleTemplateInput({
            input,
            tenantId,
          });

          const updatedTemplate = yield* databaseEffect((database) =>
            database
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
                  eq(eventTemplates.tenantId, tenantId),
                  eq(eventTemplates.simpleModeEnabled, true),
                ),
              )
              .returning({
                id: eventTemplates.id,
              }),
          );

          const template = updatedTemplate[0];
          if (!template) {
            return yield* Effect.fail(
              new TemplateSimpleNotFoundError({ message: 'Template not found' }),
            );
          }

          yield* databaseEffect((database) =>
            database
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
              ),
          );

          yield* databaseEffect((database) =>
            database
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
              ),
          );

          return { id: template.id };
        },
      );

      return {
        createSimpleTemplate,
        updateSimpleTemplate,
      } as const;
    }),
  },
) {}
