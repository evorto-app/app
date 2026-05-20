import { and, eq, inArray } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  addonToTemplateRegistrationOptions,
  eventTemplates,
  templateEventAddons,
  templateRegistrationOptionDiscounts,
  templateRegistrationOptions,
  templateRegistrationQuestions,
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
  Database.use((database) => operation(database).pipe(Effect.orDie));

type AddonToTemplateRegistrationOptionInsert =
  typeof addonToTemplateRegistrationOptions.$inferInsert;
interface CreateSimpleTemplateArguments {
  esnCardEnabled: boolean;
  input: CreateSimpleTemplateInput;
  tenantId: string;
}
type CreateSimpleTemplateInput = Parameters<
  AppRpcHandlers['templates.createSimpleTemplate']
>[0];
type EventTemplateInsert = typeof eventTemplates.$inferInsert;
type SimpleTemplateAddonInput = NonNullable<
  CreateSimpleTemplateInput['addOns']
>[number];
type SimpleTemplateQuestionInput = NonNullable<
  CreateSimpleTemplateInput['questions']
>[number];
type SimpleTemplateRegistrationInput =
  CreateSimpleTemplateInput['organizerRegistration'];
type SimpleTemplateValidationInput = Pick<
  CreateSimpleTemplateInput,
  | 'addOns'
  | 'categoryId'
  | 'description'
  | 'organizerRegistration'
  | 'participantRegistration'
  | 'questions'
>;
type TemplateEventAddonInsert = typeof templateEventAddons.$inferInsert;
type TemplateRegistrationOptionDiscountInsert =
  typeof templateRegistrationOptionDiscounts.$inferInsert;
type TemplateRegistrationOptionInsert =
  typeof templateRegistrationOptions.$inferInsert;
type TemplateRegistrationQuestionInsert =
  typeof templateRegistrationQuestions.$inferInsert;

interface UpdateSimpleTemplateArguments {
  esnCardEnabled: boolean;
  input: UpdateSimpleTemplateInput;
  tenantId: string;
}
type UpdateSimpleTemplateInput = Parameters<
  AppRpcHandlers['templates.updateSimpleTemplate']
>[0];

export const buildTemplateInsertValues = ({
  input,
  sanitizedDescription,
  tenantId,
}: {
  input: CreateSimpleTemplateInput;
  sanitizedDescription: string;
  tenantId: string;
}): EventTemplateInsert => {
  return {
    categoryId: input.categoryId,
    description: sanitizedDescription,
    icon: input.icon,
    location: input.location,
    planningTips: input.planningTips?.trim() || null,
    simpleModeEnabled: true,
    tenantId,
    title: input.title,
  };
};

const optionalRichTextOrNull = (
  value: null | string | undefined,
): null | string => {
  if (!value) {
    return null;
  }

  const sanitized = sanitizeRichTextHtml(value);
  return isMeaningfulRichTextHtml(sanitized) ? sanitized : null;
};

export const buildRegistrationOptionInsert = ({
  input,
  organizingRegistration,
  templateId,
}: {
  input: SimpleTemplateRegistrationInput;
  organizingRegistration: boolean;
  templateId: string;
}): TemplateRegistrationOptionInsert => {
  return {
    closeRegistrationOffset: input.closeRegistrationOffset,
    description: optionalRichTextOrNull(input.description),
    isPaid: input.isPaid,
    openRegistrationOffset: input.openRegistrationOffset,
    organizingRegistration,
    price: input.price,
    registeredDescription: optionalRichTextOrNull(input.registeredDescription),
    registrationMode: input.registrationMode,
    roleIds: [...input.roleIds],
    spots: input.spots,
    stripeTaxRateId: input.stripeTaxRateId ?? null,
    templateId,
    title: input.title.trim(),
  };
};

export const buildTemplateOptionDiscountInsert = ({
  input,
  registrationOptionId,
}: {
  input: SimpleTemplateRegistrationInput;
  registrationOptionId: string;
}): null | TemplateRegistrationOptionDiscountInsert => {
  if (
    !input.isPaid ||
    input.esnCardDiscountedPrice === undefined ||
    input.esnCardDiscountedPrice === null
  ) {
    return null;
  }

  return {
    discountedPrice: input.esnCardDiscountedPrice,
    discountType: 'esnCard',
    registrationOptionId,
  };
};

export const buildTemplateAddonInsert = ({
  addon,
  templateId,
}: {
  addon: SimpleTemplateAddonInput;
  templateId: string;
}): TemplateEventAddonInsert => ({
  allowMultiple: addon.allowMultiple,
  allowPurchaseBeforeEvent: addon.allowPurchaseBeforeEvent,
  allowPurchaseDuringEvent: addon.allowPurchaseDuringEvent,
  allowPurchaseDuringRegistration: addon.allowPurchaseDuringRegistration,
  description: addon.description?.trim() || null,
  isPaid: addon.isPaid,
  maxQuantityPerUser: addon.maxQuantityPerUser,
  price: addon.isPaid ? addon.price : 0,
  stripeTaxRateId: addon.isPaid ? (addon.stripeTaxRateId ?? null) : null,
  templateId,
  title: addon.title.trim(),
  totalAvailableQuantity: addon.totalAvailableQuantity,
});

export const buildTemplateAddonRegistrationOptionInsert = ({
  addon,
  addonId,
  organizerRegistrationOptionId,
  participantRegistrationOptionId,
}: {
  addon: SimpleTemplateAddonInput;
  addonId: string;
  organizerRegistrationOptionId: string;
  participantRegistrationOptionId: string;
}): AddonToTemplateRegistrationOptionInsert => ({
  addonId,
  quantity: addon.quantity,
  registrationOptionId:
    addon.registrationOptionKind === 'organizer'
      ? organizerRegistrationOptionId
      : participantRegistrationOptionId,
});

export const buildTemplateQuestionInsert = ({
  organizerRegistrationOptionId,
  participantRegistrationOptionId,
  question,
  sortOrder,
  templateId,
}: {
  organizerRegistrationOptionId: string;
  participantRegistrationOptionId: string;
  question: SimpleTemplateQuestionInput;
  sortOrder: number;
  templateId: string;
}): TemplateRegistrationQuestionInsert => ({
  description: question.description?.trim() || null,
  registrationOptionId:
    question.registrationOptionKind === 'organizer'
      ? organizerRegistrationOptionId
      : participantRegistrationOptionId,
  required: question.required,
  sortOrder,
  templateId,
  title: question.title.trim(),
});

export const requireSimpleTemplateRegistrationOptionIds = ({
  organizerRegistrationOptionId,
  participantRegistrationOptionId,
}: {
  organizerRegistrationOptionId: string | undefined;
  participantRegistrationOptionId: string | undefined;
}) => {
  if (!organizerRegistrationOptionId || !participantRegistrationOptionId) {
    return Effect.fail(
      new TemplateSimpleInternalError({
        message: 'Template add-on registration option lookup failed',
      }),
    );
  }

  return Effect.succeed({
    organizerRegistrationOptionId,
    participantRegistrationOptionId,
  });
};

const validateRegistrationOffsetOrdering = ({
  kind,
  registration,
}: {
  kind: 'organizer' | 'participant';
  registration: SimpleTemplateRegistrationInput;
}) => {
  if (
    registration.openRegistrationOffset < registration.closeRegistrationOffset
  ) {
    return Effect.fail(
      new TemplateSimpleBadRequestError({
        message: `${kind} registration must open before it closes`,
      }),
    );
  }

  return Effect.void;
};

const collectRegistrationRoleIds = (
  input: SimpleTemplateValidationInput,
): string[] => [
  ...new Set([
    ...input.organizerRegistration.roleIds,
    ...input.participantRegistration.roleIds,
  ]),
];

const validateRegistrationDiscount = ({
  esnCardEnabled,
  kind,
  registration,
}: {
  esnCardEnabled: boolean;
  kind: 'organizer' | 'participant';
  registration: SimpleTemplateRegistrationInput;
}) => {
  const discountedPrice = registration.esnCardDiscountedPrice;
  if (discountedPrice === undefined || discountedPrice === null) {
    return Effect.void;
  }

  if (!registration.isPaid) {
    return Effect.fail(
      new TemplateSimpleBadRequestError({
        message: `${kind} registration ESNcard discount requires paid registration`,
      }),
    );
  }

  if (!esnCardEnabled) {
    return Effect.fail(
      new TemplateSimpleBadRequestError({
        message: `${kind} registration ESNcard discounts are not enabled`,
      }),
    );
  }

  if (discountedPrice > registration.price) {
    return Effect.fail(
      new TemplateSimpleBadRequestError({
        message: `${kind} registration ESNcard discount cannot exceed price`,
      }),
    );
  }

  return Effect.void;
};

const validateTemplateAddon = ({
  addon,
}: {
  addon: SimpleTemplateAddonInput;
}) => {
  if (!addon.title.trim()) {
    return Effect.fail(
      new TemplateSimpleBadRequestError({
        message: 'Template add-on title is required',
      }),
    );
  }

  if (
    !addon.allowPurchaseBeforeEvent &&
    !addon.allowPurchaseDuringEvent &&
    !addon.allowPurchaseDuringRegistration
  ) {
    return Effect.fail(
      new TemplateSimpleBadRequestError({
        message: 'Template add-on must allow at least one purchase window',
      }),
    );
  }

  if (addon.quantity > addon.totalAvailableQuantity) {
    return Effect.fail(
      new TemplateSimpleBadRequestError({
        message: 'Template add-on registration quantity exceeds total quantity',
      }),
    );
  }

  if (addon.maxQuantityPerUser > addon.totalAvailableQuantity) {
    return Effect.fail(
      new TemplateSimpleBadRequestError({
        message: 'Template add-on user quantity exceeds total quantity',
      }),
    );
  }

  return Effect.void;
};

const validateTemplateQuestion = ({
  question,
}: {
  question: SimpleTemplateQuestionInput;
}) => {
  if (!question.title.trim()) {
    return Effect.fail(
      new TemplateSimpleBadRequestError({
        message: 'Template question title is required',
      }),
    );
  }

  return Effect.void;
};

export class SimpleTemplateService extends Context.Service<SimpleTemplateService>()(
  '@server/effect/rpc/handlers/templates/SimpleTemplateService',
  {
    make: Effect.sync(() => {
      const validateSimpleTemplateInput = Effect.fn(
        'SimpleTemplateService.validateSimpleTemplateInput',
      )(function* ({
        esnCardEnabled,
        input,
        tenantId,
      }: {
        esnCardEnabled: boolean;
        input: SimpleTemplateValidationInput;
        tenantId: string;
      }) {
        const validateRegistrationTaxRate = Effect.fn(
          'SimpleTemplateService.validateSimpleTemplateInput.validateRegistrationTaxRate',
        )(function* ({
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

          yield* Effect.logError(
            `${kind} registration tax rate validation failed`,
          ).pipe(
            Effect.annotateLogs({
              error: validation.error,
            }),
          );
          return yield* Effect.fail(
            new TemplateSimpleBadRequestError({
              message: `${kind} registration tax rate validation failed`,
            }),
          );
        });

        const validateTemplateCategory = Effect.fn(
          'SimpleTemplateService.validateSimpleTemplateInput.validateTemplateCategory',
        )(function* () {
          const category = yield* databaseEffect((database) =>
            database.query.eventTemplateCategories.findFirst({
              columns: {
                id: true,
              },
              where: {
                id: input.categoryId,
                tenantId,
              },
            }),
          );

          if (!category) {
            return yield* Effect.fail(
              new TemplateSimpleBadRequestError({
                message: 'Template category does not exist for this tenant',
              }),
            );
          }
        });

        const validateRegistrationRoles = Effect.fn(
          'SimpleTemplateService.validateSimpleTemplateInput.validateRegistrationRoles',
        )(function* () {
          const roleIds = collectRegistrationRoleIds(input);
          if (roleIds.length === 0) {
            return;
          }

          const tenantRoles = yield* databaseEffect((database) =>
            database.query.roles.findMany({
              columns: {
                id: true,
              },
              where: {
                id: {
                  in: roleIds,
                },
                tenantId,
              },
            }),
          );

          if (tenantRoles.length !== roleIds.length) {
            return yield* Effect.fail(
              new TemplateSimpleBadRequestError({
                message: 'Registration role does not exist for this tenant',
              }),
            );
          }
        });

        const sanitizedDescription = sanitizeRichTextHtml(input.description);
        if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
          return yield* Effect.fail(
            new TemplateSimpleBadRequestError({
              message: 'Description is not meaningful rich text',
            }),
          );
        }

        yield* validateRegistrationOffsetOrdering({
          kind: 'organizer',
          registration: input.organizerRegistration,
        });
        yield* validateRegistrationOffsetOrdering({
          kind: 'participant',
          registration: input.participantRegistration,
        });

        yield* validateTemplateCategory();
        yield* validateRegistrationRoles();

        yield* validateRegistrationTaxRate({
          kind: 'organizer',
          registration: input.organizerRegistration,
        });
        yield* validateRegistrationTaxRate({
          kind: 'participant',
          registration: input.participantRegistration,
        });
        yield* validateRegistrationDiscount({
          esnCardEnabled,
          kind: 'organizer',
          registration: input.organizerRegistration,
        });
        yield* validateRegistrationDiscount({
          esnCardEnabled,
          kind: 'participant',
          registration: input.participantRegistration,
        });
        for (const addon of input.addOns ?? []) {
          yield* validateTemplateAddon({ addon });
          const validation = yield* databaseEffect((database) =>
            validateTaxRate(database, {
              isPaid: addon.isPaid,
              stripeTaxRateId: addon.stripeTaxRateId ?? null,
              tenantId,
            }),
          );
          if (!validation.success) {
            yield* Effect.logError(
              'template add-on tax rate validation failed',
            ).pipe(
              Effect.annotateLogs({
                error: validation.error,
              }),
            );
            return yield* Effect.fail(
              new TemplateSimpleBadRequestError({
                message: 'Template add-on tax rate validation failed',
              }),
            );
          }
        }
        for (const question of input.questions ?? []) {
          yield* validateTemplateQuestion({ question });
        }

        return { sanitizedDescription };
      });

      const replaceTemplateAddons = Effect.fn(
        'SimpleTemplateService.replaceTemplateAddons',
      )(function* ({
        addOns,
        organizerRegistrationOptionId,
        participantRegistrationOptionId,
        templateId,
      }: {
        addOns: readonly SimpleTemplateAddonInput[];
        organizerRegistrationOptionId: string;
        participantRegistrationOptionId: string;
        templateId: string;
      }) {
        const existingAddOns = yield* databaseEffect((database) =>
          database.query.templateEventAddons.findMany({
            columns: {
              id: true,
            },
            where: {
              templateId,
            },
          }),
        );
        const existingAddOnIds = existingAddOns.map((addon) => addon.id);
        if (existingAddOnIds.length > 0) {
          yield* databaseEffect((database) =>
            database
              .delete(addonToTemplateRegistrationOptions)
              .where(
                inArray(
                  addonToTemplateRegistrationOptions.addonId,
                  existingAddOnIds,
                ),
              ),
          );
          yield* databaseEffect((database) =>
            database
              .delete(templateEventAddons)
              .where(inArray(templateEventAddons.id, existingAddOnIds)),
          );
        }

        if (addOns.length === 0) {
          return;
        }

        for (const addon of addOns) {
          const insertedAddOns = yield* databaseEffect((database) =>
            database
              .insert(templateEventAddons)
              .values(buildTemplateAddonInsert({ addon, templateId }))
              .returning({
                id: templateEventAddons.id,
              }),
          );
          const insertedAddOn = insertedAddOns[0];
          if (!insertedAddOn) {
            return yield* Effect.fail(
              new TemplateSimpleInternalError({
                message: 'Template add-on insert failed',
              }),
            );
          }

          yield* databaseEffect((database) =>
            database.insert(addonToTemplateRegistrationOptions).values(
              buildTemplateAddonRegistrationOptionInsert({
                addon,
                addonId: insertedAddOn.id,
                organizerRegistrationOptionId,
                participantRegistrationOptionId,
              }),
            ),
          );
        }
      });

      const replaceTemplateQuestions = Effect.fn(
        'SimpleTemplateService.replaceTemplateQuestions',
      )(function* ({
        organizerRegistrationOptionId,
        participantRegistrationOptionId,
        questions,
        templateId,
      }: {
        organizerRegistrationOptionId: string;
        participantRegistrationOptionId: string;
        questions: readonly SimpleTemplateQuestionInput[];
        templateId: string;
      }) {
        yield* databaseEffect((database) =>
          database
            .delete(templateRegistrationQuestions)
            .where(eq(templateRegistrationQuestions.templateId, templateId)),
        );

        if (questions.length === 0) {
          return;
        }

        yield* databaseEffect((database) =>
          database.insert(templateRegistrationQuestions).values(
            questions.map((question, index) =>
              buildTemplateQuestionInsert({
                organizerRegistrationOptionId,
                participantRegistrationOptionId,
                question,
                sortOrder: index,
                templateId,
              }),
            ),
          ),
        );
      });

      const createSimpleTemplate = Effect.fn(
        'SimpleTemplateService.createSimpleTemplate',
      )(function* ({
        esnCardEnabled,
        input,
        tenantId,
      }: CreateSimpleTemplateArguments) {
        const { sanitizedDescription } = yield* validateSimpleTemplateInput({
          esnCardEnabled,
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

        const createdRegistrationOptions = yield* databaseEffect((database) =>
          database
            .insert(templateRegistrationOptions)
            .values(registrationOptionInserts)
            .returning({
              id: templateRegistrationOptions.id,
              organizingRegistration:
                templateRegistrationOptions.organizingRegistration,
            }),
        );
        const discountInserts = createdRegistrationOptions
          .map((option) =>
            buildTemplateOptionDiscountInsert({
              input: option.organizingRegistration
                ? input.organizerRegistration
                : input.participantRegistration,
              registrationOptionId: option.id,
            }),
          )
          .filter(
            (discount): discount is TemplateRegistrationOptionDiscountInsert =>
              discount !== null,
          );
        if (discountInserts.length > 0) {
          yield* databaseEffect((database) =>
            database
              .insert(templateRegistrationOptionDiscounts)
              .values(discountInserts),
          );
        }
        const organizerRegistrationOptionId = createdRegistrationOptions.find(
          (option) => option.organizingRegistration,
        )?.id;
        const participantRegistrationOptionId = createdRegistrationOptions.find(
          (option) => !option.organizingRegistration,
        )?.id;
        if (input.addOns) {
          const optionIds = yield* requireSimpleTemplateRegistrationOptionIds({
            organizerRegistrationOptionId,
            participantRegistrationOptionId,
          });
          yield* replaceTemplateAddons({
            addOns: input.addOns,
            organizerRegistrationOptionId:
              optionIds.organizerRegistrationOptionId,
            participantRegistrationOptionId:
              optionIds.participantRegistrationOptionId,
            templateId: template.id,
          });
        }
        if (input.questions) {
          const optionIds = yield* requireSimpleTemplateRegistrationOptionIds({
            organizerRegistrationOptionId,
            participantRegistrationOptionId,
          });
          yield* replaceTemplateQuestions({
            organizerRegistrationOptionId:
              optionIds.organizerRegistrationOptionId,
            participantRegistrationOptionId:
              optionIds.participantRegistrationOptionId,
            questions: input.questions,
            templateId: template.id,
          });
        }

        return { id: template.id };
      });

      const updateSimpleTemplate = Effect.fn(
        'SimpleTemplateService.updateSimpleTemplate',
      )(function* ({
        esnCardEnabled,
        input,
        tenantId,
      }: UpdateSimpleTemplateArguments) {
        const { sanitizedDescription } = yield* validateSimpleTemplateInput({
          esnCardEnabled,
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
              planningTips: input.planningTips?.trim() || null,
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

        const updatedOrganizerOptions = yield* databaseEffect((database) =>
          database
            .update(templateRegistrationOptions)
            .set({
              closeRegistrationOffset:
                input.organizerRegistration.closeRegistrationOffset,
              description: optionalRichTextOrNull(
                input.organizerRegistration.description,
              ),
              isPaid: input.organizerRegistration.isPaid,
              openRegistrationOffset:
                input.organizerRegistration.openRegistrationOffset,
              price: input.organizerRegistration.price,
              registeredDescription: optionalRichTextOrNull(
                input.organizerRegistration.registeredDescription,
              ),
              registrationMode: input.organizerRegistration.registrationMode,
              roleIds: input.organizerRegistration.roleIds,
              spots: input.organizerRegistration.spots,
              stripeTaxRateId:
                input.organizerRegistration.stripeTaxRateId ?? null,
              title: input.organizerRegistration.title.trim(),
            })
            .where(
              and(
                eq(templateRegistrationOptions.templateId, input.id),
                eq(templateRegistrationOptions.organizingRegistration, true),
              ),
            )
            .returning({
              id: templateRegistrationOptions.id,
            }),
        );

        const updatedParticipantOptions = yield* databaseEffect((database) =>
          database
            .update(templateRegistrationOptions)
            .set({
              closeRegistrationOffset:
                input.participantRegistration.closeRegistrationOffset,
              description: optionalRichTextOrNull(
                input.participantRegistration.description,
              ),
              isPaid: input.participantRegistration.isPaid,
              openRegistrationOffset:
                input.participantRegistration.openRegistrationOffset,
              price: input.participantRegistration.price,
              registeredDescription: optionalRichTextOrNull(
                input.participantRegistration.registeredDescription,
              ),
              registrationMode: input.participantRegistration.registrationMode,
              roleIds: input.participantRegistration.roleIds,
              spots: input.participantRegistration.spots,
              stripeTaxRateId:
                input.participantRegistration.stripeTaxRateId ?? null,
              title: input.participantRegistration.title.trim(),
            })
            .where(
              and(
                eq(templateRegistrationOptions.templateId, input.id),
                eq(templateRegistrationOptions.organizingRegistration, false),
              ),
            )
            .returning({
              id: templateRegistrationOptions.id,
            }),
        );

        const optionDiscounts = [
          {
            input: input.organizerRegistration,
            optionId: updatedOrganizerOptions[0]?.id,
          },
          {
            input: input.participantRegistration,
            optionId: updatedParticipantOptions[0]?.id,
          },
        ];

        for (const optionDiscount of optionDiscounts) {
          if (!optionDiscount.optionId) {
            continue;
          }

          yield* databaseEffect((database) =>
            database
              .delete(templateRegistrationOptionDiscounts)
              .where(
                and(
                  eq(
                    templateRegistrationOptionDiscounts.registrationOptionId,
                    optionDiscount.optionId,
                  ),
                  eq(
                    templateRegistrationOptionDiscounts.discountType,
                    'esnCard',
                  ),
                ),
              ),
          );

          const discountInsert = buildTemplateOptionDiscountInsert({
            input: optionDiscount.input,
            registrationOptionId: optionDiscount.optionId,
          });
          if (!discountInsert) {
            continue;
          }

          yield* databaseEffect((database) =>
            database
              .insert(templateRegistrationOptionDiscounts)
              .values(discountInsert),
          );
        }
        const organizerRegistrationOptionId = updatedOrganizerOptions[0]?.id;
        const participantRegistrationOptionId =
          updatedParticipantOptions[0]?.id;
        if (input.addOns) {
          const optionIds = yield* requireSimpleTemplateRegistrationOptionIds({
            organizerRegistrationOptionId,
            participantRegistrationOptionId,
          });
          yield* replaceTemplateAddons({
            addOns: input.addOns,
            organizerRegistrationOptionId:
              optionIds.organizerRegistrationOptionId,
            participantRegistrationOptionId:
              optionIds.participantRegistrationOptionId,
            templateId: template.id,
          });
        }
        if (input.questions) {
          const optionIds = yield* requireSimpleTemplateRegistrationOptionIds({
            organizerRegistrationOptionId,
            participantRegistrationOptionId,
          });
          yield* replaceTemplateQuestions({
            organizerRegistrationOptionId:
              optionIds.organizerRegistrationOptionId,
            participantRegistrationOptionId:
              optionIds.participantRegistrationOptionId,
            questions: input.questions,
            templateId: template.id,
          });
        }

        return { id: template.id };
      });

      return {
        createSimpleTemplate,
        updateSimpleTemplate,
      } as const;
    }),
  },
) {
  static readonly Default = Layer.effect(
    SimpleTemplateService,
    SimpleTemplateService.make,
  );

  static readonly createSimpleTemplate = (
    input: CreateSimpleTemplateArguments,
  ) =>
    SimpleTemplateService.use((service) => service.createSimpleTemplate(input));

  static readonly updateSimpleTemplate = (
    input: UpdateSimpleTemplateArguments,
  ) =>
    SimpleTemplateService.use((service) => service.updateSimpleTemplate(input));
}
