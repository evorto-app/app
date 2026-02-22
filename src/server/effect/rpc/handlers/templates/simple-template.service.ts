import { and, eq } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-orm/effect-schema';
import { Effect } from 'effect';
import { Schema } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  eventTemplates,
  templateRegistrationOptions,
} from '../../../../../db/schema';
import {
  isMeaningfulRichTextHtml,
  sanitizeRichTextHtml,
} from '../../../../utils/rich-text-sanitize';
import { validateTaxRate } from '../../../../utils/validate-tax-rate';
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
type SimpleTemplateRegistrationInput =
  CreateSimpleTemplateInput['organizerRegistration'];
type SimpleTemplateValidationInput = Pick<
  CreateSimpleTemplateInput,
  'description' | 'organizerRegistration' | 'participantRegistration'
>;
type TemplateRegistrationOptionInsert =
  typeof templateRegistrationOptions.$inferInsert;
type UpdateSimpleTemplateInput = Parameters<
  AppRpcHandlers['templates.updateSimpleTemplate']
>[0];

const buildTemplateInsertValues = ({
  input,
  sanitizedDescription,
  tenantId,
}: {
  input: CreateSimpleTemplateInput;
  sanitizedDescription: string;
  tenantId: string;
}): EventTemplateInsert => {
  const templateInsertCore = Schema.decodeUnknownSync(EventTemplateInsertCoreSchema)({
    categoryId: input.categoryId,
    description: sanitizedDescription,
    simpleModeEnabled: true,
    tenantId,
    title: input.title,
  });

  return {
    ...templateInsertCore,
    icon: input.icon,
    location: input.location,
  };
};

const buildRegistrationOptionInsert = ({
  input,
  organizingRegistration,
  templateId,
}: {
  input: SimpleTemplateRegistrationInput;
  organizingRegistration: boolean;
  templateId: string;
}): TemplateRegistrationOptionInsert => {
  const insertCore = Schema.decodeUnknownSync(TemplateRegistrationOptionInsertSchema)({
    closeRegistrationOffset: input.closeRegistrationOffset,
    isPaid: input.isPaid,
    openRegistrationOffset: input.openRegistrationOffset,
    organizingRegistration,
    price: input.price,
    registrationMode: input.registrationMode,
    roleIds: input.roleIds,
    spots: input.spots,
    stripeTaxRateId: input.stripeTaxRateId ?? null,
    templateId,
    title: organizingRegistration
      ? 'Organizer registration'
      : 'Participant registration',
  });

  return {
    ...insertCore,
    roleIds: [...(insertCore.roleIds ?? [])],
  };
};

export class SimpleTemplateService extends Effect.Service<SimpleTemplateService>()(
  '@server/effect/rpc/handlers/templates/SimpleTemplateService',
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
          const validateRegistrationTaxRate = Effect.fn(
            'SimpleTemplateService.validateSimpleTemplateInput.validateRegistrationTaxRate',
          )(
            function* ({
              kind,
              registration,
            }: {
              kind: 'organizer' | 'participant';
              registration: SimpleTemplateRegistrationInput;
            }) {
              const validation = yield* databaseEffect((database) =>
                validateTaxRate(database, {
                  isPaid: registration.isPaid,
                  stripeTaxRateId: registration.stripeTaxRateId ?? null,
                  tenantId,
                }),
              );
              if (validation.success) {
                return;
              }

              yield* Effect.logError(`${kind} registration tax rate validation failed`).pipe(
                Effect.annotateLogs({
                  error: validation.error,
                }),
              );
              return yield* Effect.fail(
                new TemplateSimpleBadRequestError({
                  message: `${kind} registration tax rate validation failed`,
                }),
              );
            },
          );

          const sanitizedDescription = sanitizeRichTextHtml(input.description);
          if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
            return yield* Effect.fail(
              new TemplateSimpleBadRequestError({
                message: 'Description is not meaningful rich text',
              }),
            );
          }

          yield* validateRegistrationTaxRate({
            kind: 'organizer',
            registration: input.organizerRegistration,
          });
          yield* validateRegistrationTaxRate({
            kind: 'participant',
            registration: input.participantRegistration,
          });

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
          const templateInsertValues = buildTemplateInsertValues({
            input,
            sanitizedDescription,
            tenantId,
          });

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
          const organizerRegistrationInsert = buildRegistrationOptionInsert({
            input: input.organizerRegistration,
            organizingRegistration: true,
            templateId: template.id,
          });
          const participantRegistrationInsert = buildRegistrationOptionInsert({
            input: input.participantRegistration,
            organizingRegistration: false,
            templateId: template.id,
          });
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
