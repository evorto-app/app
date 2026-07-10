import type {
  TemplateGraphAddonInput,
  TemplateGraphInput,
  TemplateGraphQuestionInput,
  TemplateGraphRecord,
  TemplateGraphRegistrationOptionInput,
} from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { and, eq, inArray } from 'drizzle-orm';
import { Context, Effect } from 'effect';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  addonToTemplateRegistrationOptions,
  eventTemplateCategories,
  eventTemplates,
  templateEventAddons,
  templateRegistrationOptionDiscounts,
  templateRegistrationOptions,
  templateRegistrationQuestions,
} from '../../../../../db/schema';
import {
  lockTenantRoleGraph,
  tenantRoleIdsExist,
} from '../../../../roles/tenant-role-graph';
import {
  isMeaningfulRichTextHtml,
  sanitizeOptionalRichTextHtml,
  sanitizeRichTextHtml,
} from '../../../../utils/rich-text-sanitize';
import { validateTaxRate } from '../../../../utils/validate-tax-rate';

interface CreateTemplateGraphArguments {
  esnCardEnabled: boolean;
  input: TemplateGraphInput;
  tenantId: string;
}

type TemplateAddonInsert = typeof templateEventAddons.$inferInsert;
type TemplateAddonMappingInsert =
  typeof addonToTemplateRegistrationOptions.$inferInsert;

type TemplateGraphValidationInput = Omit<
  TemplateGraphInput,
  'registrationOptions'
> & {
  readonly registrationOptions: readonly TemplateGraphValidationRegistrationOption[];
};
type TemplateGraphValidationRegistrationOption = Omit<
  TemplateGraphRegistrationOptionInput,
  'registrationMode'
> & {
  readonly registrationMode: string;
};
type TemplateOptionInsert = typeof templateRegistrationOptions.$inferInsert;

type TemplateQuestionInsert = typeof templateRegistrationQuestions.$inferInsert;

interface UpdateTemplateGraphArguments extends CreateTemplateGraphArguments {
  before: TemplateGraphRecord;
  templateId: string;
}

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

const invalidGraph = (message: string, reason: string) =>
  new RpcBadRequestError({ message, reason });

const hasDuplicates = (values: readonly string[]): boolean =>
  new Set(values).size !== values.length;

const hasSimpleRegistrationOptionShape = (
  options: readonly { organizingRegistration: boolean }[],
): boolean =>
  options.length === 2 &&
  options.filter((option) => option.organizingRegistration).length === 1;

const invalidInteger = (value: number): boolean => !Number.isInteger(value);

const invalidOptionalInteger = (value: null | number): boolean =>
  value !== null && invalidInteger(value);

const validateSubmittedIds = (
  submittedIds: readonly (string | undefined)[],
  existingIds: ReadonlySet<string> | undefined,
  resourceName: string,
): null | RpcBadRequestError => {
  const presentIds = submittedIds.filter(
    (id): id is string => id !== undefined,
  );
  if (hasDuplicates(presentIds)) {
    return invalidGraph(
      `${resourceName} IDs must be unique`,
      'duplicateTemplateGraphId',
    );
  }
  if (!existingIds && presentIds.length > 0) {
    return invalidGraph(
      `New ${resourceName} records cannot include persisted IDs`,
      'unexpectedTemplateGraphId',
    );
  }
  if (existingIds && presentIds.some((id) => !existingIds.has(id))) {
    return invalidGraph(
      `${resourceName} does not belong to the target template`,
      'templateGraphIdMismatch',
    );
  }
  return null;
};

const validateRegistrationOption = (
  option: TemplateGraphValidationRegistrationOption,
  esnCardEnabled: boolean,
): null | RpcBadRequestError => {
  if (
    option.registrationMode !== 'application' &&
    option.registrationMode !== 'fcfs'
  ) {
    return invalidGraph(
      'Random template allocation is deferred and unsupported for the relaunch',
      'unsupportedTemplateRegistrationMode',
    );
  }
  if (
    !option.title.trim() ||
    invalidInteger(option.closeRegistrationOffset) ||
    invalidInteger(option.openRegistrationOffset) ||
    invalidInteger(option.price) ||
    invalidInteger(option.spots) ||
    invalidOptionalInteger(option.cancellationDeadlineHoursBeforeStart) ||
    invalidOptionalInteger(option.transferDeadlineHoursBeforeStart) ||
    option.openRegistrationOffset < option.closeRegistrationOffset
  ) {
    return invalidGraph(
      'Template registration option values are invalid',
      'invalidTemplateRegistrationOption',
    );
  }
  if (
    option.esnCardDiscountedPrice !== null &&
    (invalidInteger(option.esnCardDiscountedPrice) ||
      !option.isPaid ||
      !esnCardEnabled ||
      option.esnCardDiscountedPrice > option.price)
  ) {
    return invalidGraph(
      'Template registration option ESNcard discount is invalid',
      'invalidTemplateRegistrationDiscount',
    );
  }
  return null;
};

const validateAddon = (
  addOn: TemplateGraphAddonInput,
  optionKeys: ReadonlySet<string>,
): null | RpcBadRequestError => {
  if (addOn.isPaid && addOn.price <= 0) {
    return invalidGraph(
      'Paid template add-ons require a positive price',
      'paidTemplateAddonRequiresPositivePrice',
    );
  }

  const mappedKeys = addOn.registrationOptions.map(
    (mapping) => mapping.registrationOptionKey,
  );
  if (
    !addOn.title.trim() ||
    (!addOn.allowPurchaseBeforeEvent &&
      !addOn.allowPurchaseDuringEvent &&
      !addOn.allowPurchaseDuringRegistration) ||
    invalidInteger(addOn.maxQuantityPerUser) ||
    invalidInteger(addOn.price) ||
    invalidInteger(addOn.totalAvailableQuantity) ||
    hasDuplicates(mappedKeys) ||
    addOn.registrationOptions.some(
      (mapping) =>
        !optionKeys.has(mapping.registrationOptionKey) ||
        invalidInteger(mapping.includedQuantity) ||
        mapping.includedQuantity < 0 ||
        invalidInteger(mapping.optionalPurchaseQuantity) ||
        mapping.optionalPurchaseQuantity < 0 ||
        mapping.includedQuantity + mapping.optionalPurchaseQuantity === 0 ||
        mapping.includedQuantity + mapping.optionalPurchaseQuantity >
          addOn.totalAvailableQuantity ||
        mapping.optionalPurchaseQuantity > addOn.maxQuantityPerUser,
    )
  ) {
    return invalidGraph(
      'Template add-on configuration is invalid',
      'invalidTemplateAddon',
    );
  }
  return null;
};

const validateQuestion = (
  question: TemplateGraphQuestionInput,
  optionKeys: ReadonlySet<string>,
): null | RpcBadRequestError => {
  if (
    !question.title.trim() ||
    !optionKeys.has(question.registrationOptionKey) ||
    invalidInteger(question.sortOrder)
  ) {
    return invalidGraph(
      'Template registration question is invalid',
      'invalidTemplateQuestion',
    );
  }
  return null;
};

export const validateTemplateGraphStructure = ({
  before,
  esnCardEnabled,
  input,
}: {
  before?: TemplateGraphRecord;
  esnCardEnabled: boolean;
  input: TemplateGraphValidationInput;
}): null | RpcBadRequestError => {
  if (
    before?.registrationOptions.some(
      (option) => option.registrationMode === 'random',
    )
  ) {
    return invalidGraph(
      'Random template allocation is deferred and unsupported for the relaunch',
      'unsupportedTemplateRegistrationMode',
    );
  }

  const sanitizedDescription = sanitizeRichTextHtml(input.description);
  if (!input.title.trim() || !isMeaningfulRichTextHtml(sanitizedDescription)) {
    return invalidGraph(
      'Template title and description are required',
      'invalidTemplateDetails',
    );
  }

  const optionKeys = input.registrationOptions.map((option) => option.key);
  const addOnKeys = input.addOns.map((addOn) => addOn.key);
  const questionKeys = input.questions.map((question) => question.key);
  if (
    hasDuplicates(optionKeys) ||
    hasDuplicates(addOnKeys) ||
    hasDuplicates(questionKeys)
  ) {
    return invalidGraph(
      'Template graph keys must be unique within each resource type',
      'duplicateTemplateGraphKey',
    );
  }

  const idError =
    validateSubmittedIds(
      input.registrationOptions.map((option) => option.id),
      before
        ? new Set(before.registrationOptions.map((option) => option.id))
        : undefined,
      'registration option',
    ) ??
    validateSubmittedIds(
      input.addOns.map((addOn) => addOn.id),
      before ? new Set(before.addOns.map((addOn) => addOn.id)) : undefined,
      'add-on',
    ) ??
    validateSubmittedIds(
      input.questions.map((question) => question.id),
      before
        ? new Set(before.questions.map((question) => question.id))
        : undefined,
      'question',
    );
  if (idError) return idError;

  if (before && before.simpleModeEnabled !== input.simpleModeEnabled) {
    const submittedOptionIds = new Set(
      input.registrationOptions.flatMap((option) =>
        option.id === undefined ? [] : [option.id],
      ),
    );
    if (
      before.registrationOptions.some(
        (option) => !submittedOptionIds.has(option.id),
      )
    ) {
      return invalidGraph(
        'Changing template configuration mode must preserve every existing registration option ID',
        'templateModeTransitionMustPreserveOptionIds',
      );
    }
    if (
      input.simpleModeEnabled &&
      !hasSimpleRegistrationOptionShape(before.registrationOptions)
    ) {
      return invalidGraph(
        'Save the advanced template with exactly one organizer option and one participant option before switching to simple configuration',
        'templateAdvancedToSimpleRequiresPersistedSimpleShape',
      );
    }
  }

  if (
    input.simpleModeEnabled &&
    !hasSimpleRegistrationOptionShape(input.registrationOptions)
  ) {
    return invalidGraph(
      'Simple template configuration requires exactly one organizer option and one participant option',
      'invalidSimpleTemplateConfiguration',
    );
  }

  for (const option of input.registrationOptions) {
    const error = validateRegistrationOption(option, esnCardEnabled);
    if (error) return error;
  }
  const optionKeySet = new Set(optionKeys);
  for (const addOn of input.addOns) {
    const error = validateAddon(addOn, optionKeySet);
    if (error) return error;
  }
  for (const question of input.questions) {
    const error = validateQuestion(question, optionKeySet);
    if (error) return error;
  }
  return null;
};

const optionValues = (
  option: TemplateGraphRegistrationOptionInput,
  templateId: string,
): TemplateOptionInsert => ({
  cancellationDeadlineHoursBeforeStart:
    option.cancellationDeadlineHoursBeforeStart,
  closeRegistrationOffset: option.closeRegistrationOffset,
  description: sanitizeOptionalRichTextHtml(option.description),
  isPaid: option.isPaid,
  openRegistrationOffset: option.openRegistrationOffset,
  organizingRegistration: option.organizingRegistration,
  price: option.isPaid ? option.price : 0,
  refundFeesOnCancellation: option.refundFeesOnCancellation,
  registeredDescription: sanitizeOptionalRichTextHtml(
    option.registeredDescription,
  ),
  registrationMode: option.registrationMode,
  roleIds: [...option.roleIds],
  spots: option.spots,
  stripeTaxRateId: option.isPaid ? option.stripeTaxRateId : null,
  templateId,
  title: option.title.trim(),
  transferDeadlineHoursBeforeStart: option.transferDeadlineHoursBeforeStart,
});

const addOnValues = (
  addOn: TemplateGraphAddonInput,
  templateId: string,
): TemplateAddonInsert => ({
  allowMultiple: addOn.allowMultiple,
  allowPurchaseBeforeEvent: addOn.allowPurchaseBeforeEvent,
  allowPurchaseDuringEvent: addOn.allowPurchaseDuringEvent,
  allowPurchaseDuringRegistration: addOn.allowPurchaseDuringRegistration,
  description: addOn.description?.trim() || null,
  isPaid: addOn.isPaid,
  maxQuantityPerUser: addOn.maxQuantityPerUser,
  price: addOn.isPaid ? addOn.price : 0,
  stripeTaxRateId: addOn.isPaid ? addOn.stripeTaxRateId : null,
  templateId,
  title: addOn.title.trim(),
  totalAvailableQuantity: addOn.totalAvailableQuantity,
});

const questionValues = (
  question: TemplateGraphQuestionInput,
  registrationOptionId: string,
  templateId: string,
): TemplateQuestionInsert => ({
  description: question.description?.trim() || null,
  registrationOptionId,
  required: question.required,
  sortOrder: question.sortOrder,
  templateId,
  title: question.title.trim(),
});

export class TemplateGraphService extends Context.Service<TemplateGraphService>()(
  '@server/effect/rpc/handlers/templates/TemplateGraphService',
  {
    make: Effect.sync(() => {
      const validateDatabaseReferences = Effect.fn(
        'TemplateGraphService.validateDatabaseReferences',
      )(function* ({
        input,
        tenantId,
      }: {
        input: TemplateGraphInput;
        tenantId: string;
      }) {
        yield* databaseEffect((database) =>
          lockTenantRoleGraph(database, tenantId),
        );
        const categoryFound = yield* databaseEffect((database) =>
          database
            .select({ id: eventTemplateCategories.id })
            .from(eventTemplateCategories)
            .where(
              and(
                eq(eventTemplateCategories.id, input.categoryId),
                eq(eventTemplateCategories.tenantId, tenantId),
              ),
            )
            .limit(1),
        );
        if (categoryFound.length === 0) {
          return yield* invalidGraph(
            'Template category does not belong to the target tenant',
            'templateCategoryNotFound',
          );
        }

        const roleIds = input.registrationOptions.flatMap(
          (option) => option.roleIds,
        );
        const rolesExist = yield* databaseEffect((database) =>
          tenantRoleIdsExist(database, tenantId, roleIds),
        );
        if (!rolesExist) {
          return yield* invalidGraph(
            'Registration option role does not belong to the target tenant',
            'templateRoleNotFound',
          );
        }

        for (const option of input.registrationOptions) {
          const validation = yield* databaseEffect((database) =>
            validateTaxRate(database, {
              isPaid: option.isPaid,
              stripeTaxRateId: option.stripeTaxRateId,
              tenantId,
            }),
          );
          if (!validation.success) {
            return yield* invalidGraph(
              'Registration option tax rate is invalid for the target tenant',
              'invalidTemplateRegistrationTaxRate',
            );
          }
        }
        for (const addOn of input.addOns) {
          const validation = yield* databaseEffect((database) =>
            validateTaxRate(database, {
              isPaid: addOn.isPaid,
              stripeTaxRateId: addOn.stripeTaxRateId,
              tenantId,
            }),
          );
          if (!validation.success) {
            return yield* invalidGraph(
              'Add-on tax rate is invalid for the target tenant',
              'invalidTemplateAddonTaxRate',
            );
          }
        }
      });

      const writeRegistrationOptions = Effect.fn(
        'TemplateGraphService.writeRegistrationOptions',
      )(function* ({
        before,
        input,
        templateId,
      }: {
        before?: TemplateGraphRecord;
        input: TemplateGraphInput;
        templateId: string;
      }) {
        const idsByKey = new Map<string, string>();
        for (const option of input.registrationOptions) {
          const values = optionValues(option, templateId);
          const existingOptionId = option.id;
          const rows = existingOptionId
            ? yield* databaseEffect((database) =>
                database
                  .update(templateRegistrationOptions)
                  .set(values)
                  .where(
                    and(
                      eq(templateRegistrationOptions.id, existingOptionId),
                      eq(templateRegistrationOptions.templateId, templateId),
                    ),
                  )
                  .returning({ id: templateRegistrationOptions.id }),
              )
            : yield* databaseEffect((database) =>
                database
                  .insert(templateRegistrationOptions)
                  .values(values)
                  .returning({ id: templateRegistrationOptions.id }),
              );
          const optionId = rows[0]?.id;
          if (!optionId) {
            return yield* Effect.die(
              new Error('Template registration option write returned no ID'),
            );
          }
          idsByKey.set(option.key, optionId);

          yield* databaseEffect((database) =>
            database
              .delete(templateRegistrationOptionDiscounts)
              .where(
                and(
                  eq(
                    templateRegistrationOptionDiscounts.registrationOptionId,
                    optionId,
                  ),
                  eq(
                    templateRegistrationOptionDiscounts.discountType,
                    'esnCard',
                  ),
                ),
              ),
          );
          const esnCardDiscountedPrice = option.esnCardDiscountedPrice;
          if (esnCardDiscountedPrice !== null) {
            yield* databaseEffect((database) =>
              database.insert(templateRegistrationOptionDiscounts).values({
                discountedPrice: esnCardDiscountedPrice,
                discountType: 'esnCard',
                registrationOptionId: optionId,
              }),
            );
          }
        }

        const submittedIds = new Set(
          input.registrationOptions.flatMap((option) =>
            option.id ? [option.id] : [],
          ),
        );
        const removedIds = (before?.registrationOptions ?? [])
          .map((option) => option.id)
          .filter((id) => !submittedIds.has(id));
        return { idsByKey, removedIds };
      });

      const writeAddOns = Effect.fn('TemplateGraphService.writeAddOns')(
        function* ({
          before,
          input,
          optionIdsByKey,
          templateId,
        }: {
          before?: TemplateGraphRecord;
          input: TemplateGraphInput;
          optionIdsByKey: ReadonlyMap<string, string>;
          templateId: string;
        }) {
          const submittedIds = new Set(
            input.addOns.flatMap((addOn) => (addOn.id ? [addOn.id] : [])),
          );
          const removedIds = (before?.addOns ?? [])
            .map((addOn) => addOn.id)
            .filter((id) => !submittedIds.has(id));
          if (removedIds.length > 0) {
            yield* databaseEffect((database) =>
              database
                .delete(addonToTemplateRegistrationOptions)
                .where(
                  inArray(
                    addonToTemplateRegistrationOptions.addonId,
                    removedIds,
                  ),
                ),
            );
            yield* databaseEffect((database) =>
              database
                .delete(templateEventAddons)
                .where(
                  and(
                    eq(templateEventAddons.templateId, templateId),
                    inArray(templateEventAddons.id, removedIds),
                  ),
                ),
            );
          }

          for (const addOn of input.addOns) {
            const values = addOnValues(addOn, templateId);
            const existingAddOnId = addOn.id;
            const rows = existingAddOnId
              ? yield* databaseEffect((database) =>
                  database
                    .update(templateEventAddons)
                    .set(values)
                    .where(
                      and(
                        eq(templateEventAddons.id, existingAddOnId),
                        eq(templateEventAddons.templateId, templateId),
                      ),
                    )
                    .returning({ id: templateEventAddons.id }),
                )
              : yield* databaseEffect((database) =>
                  database
                    .insert(templateEventAddons)
                    .values(values)
                    .returning({ id: templateEventAddons.id }),
                );
            const addOnId = rows[0]?.id;
            if (!addOnId) {
              return yield* Effect.die(
                new Error('Template add-on write returned no ID'),
              );
            }
            yield* databaseEffect((database) =>
              database
                .delete(addonToTemplateRegistrationOptions)
                .where(eq(addonToTemplateRegistrationOptions.addonId, addOnId)),
            );
            if (addOn.registrationOptions.length > 0) {
              const mappings: TemplateAddonMappingInsert[] = [];
              for (const mapping of addOn.registrationOptions) {
                const registrationOptionId = optionIdsByKey.get(
                  mapping.registrationOptionKey,
                );
                if (!registrationOptionId) {
                  return yield* Effect.die(
                    new Error('Validated template option key is missing'),
                  );
                }
                mappings.push({
                  addonId: addOnId,
                  includedQuantity: mapping.includedQuantity,
                  optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
                  registrationOptionId,
                  templateId,
                });
              }
              yield* databaseEffect((database) =>
                database
                  .insert(addonToTemplateRegistrationOptions)
                  .values(mappings),
              );
            }
          }
        },
      );

      const writeQuestions = Effect.fn('TemplateGraphService.writeQuestions')(
        function* ({
          before,
          input,
          optionIdsByKey,
          templateId,
        }: {
          before?: TemplateGraphRecord;
          input: TemplateGraphInput;
          optionIdsByKey: ReadonlyMap<string, string>;
          templateId: string;
        }) {
          const submittedIds = new Set(
            input.questions.flatMap((question) =>
              question.id ? [question.id] : [],
            ),
          );
          const removedIds = (before?.questions ?? [])
            .map((question) => question.id)
            .filter((id) => !submittedIds.has(id));
          if (removedIds.length > 0) {
            yield* databaseEffect((database) =>
              database
                .delete(templateRegistrationQuestions)
                .where(
                  and(
                    eq(templateRegistrationQuestions.templateId, templateId),
                    inArray(templateRegistrationQuestions.id, removedIds),
                  ),
                ),
            );
          }

          for (const question of input.questions) {
            const registrationOptionId = optionIdsByKey.get(
              question.registrationOptionKey,
            );
            if (!registrationOptionId) {
              return yield* Effect.die(
                new Error('Validated template question option key is missing'),
              );
            }
            const values = questionValues(
              question,
              registrationOptionId,
              templateId,
            );
            const existingQuestionId = question.id;
            const rows = existingQuestionId
              ? yield* databaseEffect((database) =>
                  database
                    .update(templateRegistrationQuestions)
                    .set(values)
                    .where(
                      and(
                        eq(
                          templateRegistrationQuestions.id,
                          existingQuestionId,
                        ),
                        eq(
                          templateRegistrationQuestions.templateId,
                          templateId,
                        ),
                      ),
                    )
                    .returning({ id: templateRegistrationQuestions.id }),
                )
              : yield* databaseEffect((database) =>
                  database
                    .insert(templateRegistrationQuestions)
                    .values(values)
                    .returning({ id: templateRegistrationQuestions.id }),
                );
            if (!rows[0]) {
              return yield* Effect.die(
                new Error('Template question write returned no ID'),
              );
            }
          }
        },
      );

      const removeRegistrationOptions = Effect.fn(
        'TemplateGraphService.removeRegistrationOptions',
      )(function* (templateId: string, removedIds: readonly string[]) {
        if (removedIds.length === 0) return;
        yield* databaseEffect((database) =>
          database
            .delete(templateRegistrationOptionDiscounts)
            .where(
              inArray(
                templateRegistrationOptionDiscounts.registrationOptionId,
                removedIds,
              ),
            ),
        );
        yield* databaseEffect((database) =>
          database
            .delete(templateRegistrationOptions)
            .where(
              and(
                eq(templateRegistrationOptions.templateId, templateId),
                inArray(templateRegistrationOptions.id, removedIds),
              ),
            ),
        );
      });

      const writeChildren = Effect.fn('TemplateGraphService.writeChildren')(
        function* ({
          before,
          input,
          templateId,
        }: {
          before?: TemplateGraphRecord;
          input: TemplateGraphInput;
          templateId: string;
        }) {
          const options = yield* writeRegistrationOptions({
            ...(before && { before }),
            input,
            templateId,
          });
          yield* writeAddOns({
            ...(before && { before }),
            input,
            optionIdsByKey: options.idsByKey,
            templateId,
          });
          yield* writeQuestions({
            ...(before && { before }),
            input,
            optionIdsByKey: options.idsByKey,
            templateId,
          });
          yield* removeRegistrationOptions(templateId, options.removedIds);
        },
      );

      const validate = Effect.fn('TemplateGraphService.validate')(function* ({
        before,
        esnCardEnabled,
        input,
        tenantId,
      }: {
        before?: TemplateGraphRecord;
        esnCardEnabled: boolean;
        input: TemplateGraphInput;
        tenantId: string;
      }) {
        const structuralError = validateTemplateGraphStructure({
          ...(before && { before }),
          esnCardEnabled,
          input,
        });
        if (structuralError) return yield* structuralError;
        yield* validateDatabaseReferences({ input, tenantId });
      });

      const createTemplate = Effect.fn('TemplateGraphService.createTemplate')(
        function* ({
          esnCardEnabled,
          input,
          tenantId,
        }: CreateTemplateGraphArguments) {
          yield* validate({ esnCardEnabled, input, tenantId });
          const description = sanitizeRichTextHtml(input.description);
          const rows = yield* databaseEffect((database) =>
            database
              .insert(eventTemplates)
              .values({
                categoryId: input.categoryId,
                description,
                icon: input.icon,
                location: input.location,
                planningTips: input.planningTips?.trim() || null,
                simpleModeEnabled: input.simpleModeEnabled,
                tenantId,
                title: input.title.trim(),
                unlisted: input.unlisted,
              })
              .returning({ id: eventTemplates.id }),
          );
          const templateId = rows[0]?.id;
          if (!templateId) {
            return yield* Effect.die(
              new Error('Template write returned no ID'),
            );
          }
          yield* writeChildren({ input, templateId });
          return { id: templateId };
        },
      );

      const updateTemplate = Effect.fn('TemplateGraphService.updateTemplate')(
        function* ({
          before,
          esnCardEnabled,
          input,
          templateId,
          tenantId,
        }: UpdateTemplateGraphArguments) {
          yield* validate({ before, esnCardEnabled, input, tenantId });
          const rows = yield* databaseEffect((database) =>
            database
              .update(eventTemplates)
              .set({
                categoryId: input.categoryId,
                description: sanitizeRichTextHtml(input.description),
                icon: input.icon,
                location: input.location,
                planningTips: input.planningTips?.trim() || null,
                simpleModeEnabled: input.simpleModeEnabled,
                title: input.title.trim(),
                unlisted: input.unlisted,
              })
              .where(
                and(
                  eq(eventTemplates.id, templateId),
                  eq(eventTemplates.tenantId, tenantId),
                ),
              )
              .returning({ id: eventTemplates.id }),
          );
          if (!rows[0]) {
            return yield* invalidGraph(
              'Template was not found for the target tenant',
              'templateNotFound',
            );
          }
          yield* writeChildren({ before, input, templateId });
          return { id: templateId };
        },
      );

      return { createTemplate, updateTemplate };
    }),
  },
) {
  static readonly createTemplate = (input: CreateTemplateGraphArguments) =>
    TemplateGraphService.make.pipe(
      Effect.flatMap((service) => service.createTemplate(input)),
    );

  static readonly updateTemplate = (input: UpdateTemplateGraphArguments) =>
    TemplateGraphService.make.pipe(
      Effect.flatMap((service) => service.updateTemplate(input)),
    );
}
