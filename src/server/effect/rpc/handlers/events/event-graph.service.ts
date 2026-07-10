import type { EventGraphEditRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';

import type { DatabaseClient } from '../../../../../db';
import type { AppRpcHandlers } from '../shared/handler-types';

import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventRegistrationAddonPurchases,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestionAnswers,
  eventRegistrationQuestions,
  eventRegistrations,
} from '../../../../../db/schema';
import {
  lockTenantRoleGraph,
  tenantRoleIdsExist,
} from '../../../../roles/tenant-role-graph';
import { sanitizeOptionalRichTextHtml } from '../../../../utils/rich-text-sanitize';
import { validateTaxRate } from '../../../../utils/validate-tax-rate';

export type EventGraphUpdateInput = Parameters<
  AppRpcHandlers['events.updateGraph']
>[0];

const invalidGraph = (message: string, reason: string) =>
  new RpcBadRequestError({ message, reason });

const hasDuplicates = (values: readonly string[]): boolean =>
  new Set(values).size !== values.length;

const hasSimpleRegistrationOptionShape = (
  options: readonly { organizingRegistration: boolean }[],
): boolean =>
  options.length === 2 &&
  options.filter((option) => option.organizingRegistration).length === 1;

const isInvalidInteger = (value: number): boolean =>
  !Number.isInteger(value) || value < 0;

const validateSubmittedIds = (
  submittedIds: readonly (string | undefined)[],
  existingIds: ReadonlySet<string>,
  resourceName: string,
): null | RpcBadRequestError => {
  const ids = submittedIds.filter((id): id is string => id !== undefined);
  if (hasDuplicates(ids)) {
    return invalidGraph(
      `${resourceName} IDs must be unique`,
      'duplicateEventGraphId',
    );
  }
  if (ids.some((id) => !existingIds.has(id))) {
    return invalidGraph(
      `${resourceName} does not belong to the target event`,
      'eventGraphIdMismatch',
    );
  }
  return null;
};

export const validateEventGraphStructure = ({
  before,
  input,
}: {
  before: EventGraphEditRecord;
  input: Pick<
    EventGraphUpdateInput,
    'addOns' | 'questions' | 'registrationOptions' | 'simpleModeEnabled'
  >;
}): null | RpcBadRequestError => {
  if (
    before.registrationOptions.some(
      (option) => option.registrationMode === 'random',
    )
  ) {
    return invalidGraph(
      'Random allocation is legacy-readable but cannot be written',
      'unsupportedEventRegistrationMode',
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
      'Event graph keys must be unique within each resource type',
      'duplicateEventGraphKey',
    );
  }

  const idError =
    validateSubmittedIds(
      input.registrationOptions.map((option) => option.id),
      new Set(before.registrationOptions.map((option) => option.id)),
      'Registration option',
    ) ??
    validateSubmittedIds(
      input.addOns.map((addOn) => addOn.id),
      new Set(before.addOns.map((addOn) => addOn.id)),
      'Add-on',
    ) ??
    validateSubmittedIds(
      input.questions.map((question) => question.id),
      new Set(before.questions.map((question) => question.id)),
      'Question',
    );
  if (idError) return idError;

  if (before.simpleModeEnabled !== input.simpleModeEnabled) {
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
        'Changing event configuration mode must preserve every existing registration option ID',
        'eventModeTransitionMustPreserveOptionIds',
      );
    }
    if (
      input.simpleModeEnabled &&
      !hasSimpleRegistrationOptionShape(before.registrationOptions)
    ) {
      return invalidGraph(
        'Save the advanced event with exactly one organizing and one non-organizing registration option before switching to simple mode',
        'eventAdvancedToSimpleRequiresPersistedSimpleShape',
      );
    }
  }

  if (
    input.simpleModeEnabled &&
    !hasSimpleRegistrationOptionShape(input.registrationOptions)
  ) {
    return invalidGraph(
      'Simple mode requires exactly one organizing and one non-organizing registration option',
      'simpleEventGraphRequiresTwoOptions',
    );
  }

  for (const option of input.registrationOptions) {
    const open = new Date(option.openRegistrationTime);
    const close = new Date(option.closeRegistrationTime);
    if (
      !option.title.trim() ||
      Number.isNaN(open.getTime()) ||
      Number.isNaN(close.getTime()) ||
      close < open ||
      isInvalidInteger(option.price) ||
      isInvalidInteger(option.spots) ||
      (option.cancellationDeadlineHoursBeforeStart !== null &&
        isInvalidInteger(option.cancellationDeadlineHoursBeforeStart)) ||
      (option.transferDeadlineHoursBeforeStart !== null &&
        isInvalidInteger(option.transferDeadlineHoursBeforeStart))
    ) {
      return invalidGraph(
        'Event registration option values are invalid',
        'invalidEventRegistrationOption',
      );
    }
    if (
      option.registrationMode !== 'application' &&
      option.registrationMode !== 'fcfs'
    ) {
      return invalidGraph(
        'Random allocation is legacy-readable but cannot be written',
        'unsupportedEventRegistrationMode',
      );
    }
  }

  const optionKeySet = new Set(optionKeys);
  for (const addOn of input.addOns) {
    if (addOn.isPaid && addOn.price <= 0) {
      return invalidGraph(
        'Paid event add-ons require a positive price',
        'paidEventAddonRequiresPositivePrice',
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
      isInvalidInteger(addOn.maxQuantityPerUser) ||
      addOn.maxQuantityPerUser === 0 ||
      isInvalidInteger(addOn.price) ||
      isInvalidInteger(addOn.totalAvailableQuantity) ||
      hasDuplicates(mappedKeys) ||
      addOn.registrationOptions.some(
        (mapping) =>
          !optionKeySet.has(mapping.registrationOptionKey) ||
          isInvalidInteger(mapping.includedQuantity) ||
          isInvalidInteger(mapping.optionalPurchaseQuantity) ||
          mapping.includedQuantity + mapping.optionalPurchaseQuantity === 0 ||
          mapping.includedQuantity + mapping.optionalPurchaseQuantity >
            addOn.totalAvailableQuantity ||
          mapping.optionalPurchaseQuantity > addOn.maxQuantityPerUser,
      )
    ) {
      return invalidGraph(
        'Event add-on configuration is invalid',
        'invalidEventAddon',
      );
    }
  }

  for (const question of input.questions) {
    if (
      !question.title.trim() ||
      !optionKeySet.has(question.registrationOptionKey) ||
      isInvalidInteger(question.sortOrder)
    ) {
      return invalidGraph(
        'Event registration question is invalid',
        'invalidEventQuestion',
      );
    }
  }

  return null;
};

const ensureNoRemovedOptionRegistrations = Effect.fn(
  'Events.ensureNoRemovedOptionRegistrations',
)(function* (
  database: DatabaseClient,
  eventId: string,
  removedOptionIds: readonly string[],
) {
  if (removedOptionIds.length === 0) return;
  const registrations = yield* database
    .select({ id: eventRegistrations.id })
    .from(eventRegistrations)
    .where(
      and(
        eq(eventRegistrations.eventId, eventId),
        inArray(eventRegistrations.registrationOptionId, [...removedOptionIds]),
      ),
    )
    .limit(1)
    .pipe(Effect.orDie);
  if (registrations.length > 0) {
    return yield* Effect.fail(
      invalidGraph(
        'Registration options with registrations cannot be removed',
        'eventRegistrationOptionInUse',
      ),
    );
  }
});

const ensureNoRemovedAddOnPurchases = Effect.fn(
  'Events.ensureNoRemovedAddOnPurchases',
)(function* (
  database: DatabaseClient,
  eventId: string,
  removedAddOnIds: readonly string[],
) {
  if (removedAddOnIds.length === 0) return;
  const purchases = yield* database
    .select({ id: eventRegistrationAddonPurchases.id })
    .from(eventRegistrationAddonPurchases)
    .where(
      and(
        eq(eventRegistrationAddonPurchases.eventId, eventId),
        inArray(eventRegistrationAddonPurchases.addonId, [...removedAddOnIds]),
      ),
    )
    .limit(1)
    .pipe(Effect.orDie);
  if (purchases.length > 0) {
    return yield* Effect.fail(
      invalidGraph(
        'Purchased event add-ons cannot be removed',
        'eventAddonInUse',
      ),
    );
  }
});

const ensureNoQuestionAnswers = Effect.fn('Events.ensureNoQuestionAnswers')(
  function* (database: DatabaseClient, removedQuestionIds: readonly string[]) {
    if (removedQuestionIds.length === 0) return;
    const answers = yield* database
      .select({ id: eventRegistrationQuestionAnswers.id })
      .from(eventRegistrationQuestionAnswers)
      .where(
        inArray(eventRegistrationQuestionAnswers.questionId, [
          ...removedQuestionIds,
        ]),
      )
      .limit(1)
      .pipe(Effect.orDie);
    if (answers.length > 0) {
      return yield* Effect.fail(
        invalidGraph(
          'Answered event questions cannot be changed or removed',
          'eventQuestionInUse',
        ),
      );
    }
  },
);

const mappingKey = (addOnId: string, optionId: string): string =>
  `${addOnId}:${optionId}`;

export const updateEventGraph = Effect.fn('Events.updateEventGraph')(
  function* ({
    before,
    database,
    esnCardEnabled,
    input,
    tenantId,
  }: {
    before: EventGraphEditRecord;
    database: DatabaseClient;
    esnCardEnabled: boolean;
    input: EventGraphUpdateInput;
    tenantId: string;
  }) {
    const structureError = validateEventGraphStructure({ before, input });
    if (structureError) return yield* Effect.fail(structureError);

    yield* lockTenantRoleGraph(database, tenantId).pipe(Effect.orDie);
    const rolesExist = yield* tenantRoleIdsExist(
      database,
      tenantId,
      input.registrationOptions.flatMap((option) => option.roleIds),
    ).pipe(Effect.orDie);
    if (!rolesExist) {
      return yield* Effect.fail(
        invalidGraph(
          'Registration option role not found for this tenant',
          'registrationRoleNotFound',
        ),
      );
    }

    for (const option of input.registrationOptions) {
      const taxRate = yield* validateTaxRate(database, {
        isPaid: option.isPaid,
        stripeTaxRateId: option.stripeTaxRateId,
        tenantId,
      });
      if (!taxRate.success) {
        return yield* Effect.fail(
          invalidGraph(
            'Registration option tax rate is invalid',
            'invalidEventRegistrationOptionTaxRate',
          ),
        );
      }
      if (
        option.esnCardDiscountedPrice !== null &&
        (!option.isPaid ||
          !esnCardEnabled ||
          option.esnCardDiscountedPrice > option.price)
      ) {
        return yield* Effect.fail(
          invalidGraph(
            'Registration option ESNcard discount is invalid',
            'invalidEventRegistrationDiscount',
          ),
        );
      }
    }
    for (const addOn of input.addOns) {
      const taxRate = yield* validateTaxRate(database, {
        isPaid: addOn.isPaid,
        stripeTaxRateId: addOn.stripeTaxRateId,
        tenantId,
      });
      if (!taxRate.success) {
        return yield* Effect.fail(
          invalidGraph(
            'Event add-on tax rate is invalid',
            'invalidEventAddonTaxRate',
          ),
        );
      }
    }

    const submittedOptionIds = new Set(
      input.registrationOptions.flatMap((option) =>
        option.id ? [option.id] : [],
      ),
    );
    const removedOptionIds = before.registrationOptions
      .map((option) => option.id)
      .filter((id) => !submittedOptionIds.has(id));
    yield* ensureNoRemovedOptionRegistrations(
      database,
      input.eventId,
      removedOptionIds,
    );

    const optionIdByKey = new Map<string, string>();
    for (const option of input.registrationOptions) {
      const values = {
        cancellationDeadlineHoursBeforeStart:
          option.cancellationDeadlineHoursBeforeStart,
        closeRegistrationTime: new Date(option.closeRegistrationTime),
        description: sanitizeOptionalRichTextHtml(option.description),
        isPaid: option.isPaid,
        openRegistrationTime: new Date(option.openRegistrationTime),
        organizingRegistration: option.organizingRegistration,
        price: option.isPaid ? option.price : 0,
        refundFeesOnCancellation: option.refundFeesOnCancellation,
        registeredDescription: sanitizeOptionalRichTextHtml(
          option.registeredDescription,
        ),
        registrationMode: option.registrationMode,
        roleIds: [...new Set(option.roleIds)],
        spots: option.spots,
        stripeTaxRateId: option.isPaid ? option.stripeTaxRateId : null,
        title: option.title.trim(),
        transferDeadlineHoursBeforeStart:
          option.transferDeadlineHoursBeforeStart,
      };
      const optionId = option.id
        ? yield* database
            .update(eventRegistrationOptions)
            .set(values)
            .where(
              and(
                eq(eventRegistrationOptions.eventId, input.eventId),
                eq(eventRegistrationOptions.id, option.id),
              ),
            )
            .returning({ id: eventRegistrationOptions.id })
            .pipe(
              Effect.orDie,
              Effect.map((rows) => rows[0]?.id),
            )
        : yield* database
            .insert(eventRegistrationOptions)
            .values({ ...values, eventId: input.eventId })
            .returning({ id: eventRegistrationOptions.id })
            .pipe(
              Effect.orDie,
              Effect.map((rows) => rows[0]?.id),
            );
      if (!optionId) {
        return yield* Effect.die(
          new Error('Event registration option write returned no id'),
        );
      }
      optionIdByKey.set(option.key, optionId);

      yield* database
        .delete(eventRegistrationOptionDiscounts)
        .where(
          and(
            eq(eventRegistrationOptionDiscounts.registrationOptionId, optionId),
            eq(eventRegistrationOptionDiscounts.discountType, 'esnCard'),
          ),
        )
        .pipe(Effect.orDie);
      if (option.esnCardDiscountedPrice !== null) {
        yield* database
          .insert(eventRegistrationOptionDiscounts)
          .values({
            discountedPrice: option.esnCardDiscountedPrice,
            discountType: 'esnCard',
            registrationOptionId: optionId,
          })
          .pipe(Effect.orDie);
      }
    }

    const submittedAddOnIds = new Set(
      input.addOns.flatMap((addOn) => (addOn.id ? [addOn.id] : [])),
    );
    const removedAddOnIds = before.addOns
      .map((addOn) => addOn.id)
      .filter((id) => !submittedAddOnIds.has(id));
    yield* ensureNoRemovedAddOnPurchases(
      database,
      input.eventId,
      removedAddOnIds,
    );
    if (removedAddOnIds.length > 0) {
      yield* database
        .delete(addonToEventRegistrationOptions)
        .where(
          and(
            eq(addonToEventRegistrationOptions.eventId, input.eventId),
            inArray(addonToEventRegistrationOptions.addonId, removedAddOnIds),
          ),
        )
        .pipe(Effect.orDie);
      yield* database
        .delete(eventAddons)
        .where(
          and(
            eq(eventAddons.eventId, input.eventId),
            inArray(eventAddons.id, removedAddOnIds),
          ),
        )
        .pipe(Effect.orDie);
    }

    for (const addOn of input.addOns) {
      const values = {
        allowMultiple: addOn.allowMultiple,
        allowPurchaseBeforeEvent: addOn.allowPurchaseBeforeEvent,
        allowPurchaseDuringEvent: addOn.allowPurchaseDuringEvent,
        allowPurchaseDuringRegistration: addOn.allowPurchaseDuringRegistration,
        description: addOn.description?.trim() || null,
        isPaid: addOn.isPaid,
        maxQuantityPerUser: addOn.maxQuantityPerUser,
        price: addOn.isPaid ? addOn.price : 0,
        stripeTaxRateId: addOn.isPaid ? addOn.stripeTaxRateId : null,
        title: addOn.title.trim(),
        totalAvailableQuantity: addOn.totalAvailableQuantity,
      };
      let addOnId: string | undefined;
      if (addOn.id) {
        const beforeAddOn = before.addOns.find(
          (existing) => existing.id === addOn.id,
        );
        if (!beforeAddOn) {
          return yield* Effect.die(
            new Error('Validated event add-on is missing from prior graph'),
          );
        }
        addOnId = yield* database
          .update(eventAddons)
          .set(values)
          .where(
            and(
              eq(eventAddons.eventId, input.eventId),
              eq(eventAddons.id, addOn.id),
              eq(
                eventAddons.totalAvailableQuantity,
                beforeAddOn.totalAvailableQuantity,
              ),
            ),
          )
          .returning({ id: eventAddons.id })
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows[0]?.id),
          );
        if (!addOnId) {
          return yield* Effect.fail(
            invalidGraph(
              'Add-on stock changed while this event was being edited. Reload and try again.',
              'eventAddonStockConflict',
            ),
          );
        }
      } else {
        addOnId = yield* database
          .insert(eventAddons)
          .values({ ...values, eventId: input.eventId })
          .returning({ id: eventAddons.id })
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows[0]?.id),
          );
      }
      if (!addOnId) {
        return yield* Effect.die(
          new Error('Event add-on write returned no id'),
        );
      }

      const existingMappings = addOn.id
        ? (before.addOns
            .find((existing) => existing.id === addOn.id)
            ?.registrationOptions.map((mapping) => ({
              includedQuantity: mapping.includedQuantity,
              optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
              registrationOptionId: mapping.registrationOptionId,
            })) ?? [])
        : [];
      const submittedMappings: {
        includedQuantity: number;
        optionalPurchaseQuantity: number;
        registrationOptionId: string;
      }[] = [];
      for (const mapping of addOn.registrationOptions) {
        const registrationOptionId = optionIdByKey.get(
          mapping.registrationOptionKey,
        );
        if (!registrationOptionId) {
          return yield* Effect.die(
            new Error('Validated add-on mapping target is missing'),
          );
        }
        submittedMappings.push({
          includedQuantity: mapping.includedQuantity,
          optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
          registrationOptionId,
        });
      }
      const submittedMappingKeys = new Set(
        submittedMappings.map((mapping) =>
          mappingKey(addOnId, mapping.registrationOptionId),
        ),
      );
      const removedMappings = existingMappings.filter(
        (mapping) =>
          !submittedMappingKeys.has(
            mappingKey(addOnId, mapping.registrationOptionId),
          ),
      );
      for (const removedMapping of removedMappings) {
        const purchases = yield* database
          .select({ id: eventRegistrationAddonPurchases.id })
          .from(eventRegistrationAddonPurchases)
          .where(
            and(
              eq(eventRegistrationAddonPurchases.eventId, input.eventId),
              eq(eventRegistrationAddonPurchases.addonId, addOnId),
              eq(
                eventRegistrationAddonPurchases.registrationOptionId,
                removedMapping.registrationOptionId,
              ),
            ),
          )
          .limit(1)
          .pipe(Effect.orDie);
        if (purchases.length > 0) {
          return yield* Effect.fail(
            invalidGraph(
              'Purchased add-on mappings cannot be removed',
              'eventAddonMappingInUse',
            ),
          );
        }
        yield* database
          .delete(addonToEventRegistrationOptions)
          .where(
            and(
              eq(addonToEventRegistrationOptions.eventId, input.eventId),
              eq(addonToEventRegistrationOptions.addonId, addOnId),
              eq(
                addonToEventRegistrationOptions.registrationOptionId,
                removedMapping.registrationOptionId,
              ),
            ),
          )
          .pipe(Effect.orDie);
      }
      const existingMappingKeys = new Set(
        existingMappings.map((mapping) =>
          mappingKey(addOnId, mapping.registrationOptionId),
        ),
      );
      for (const mapping of submittedMappings) {
        const key = mappingKey(addOnId, mapping.registrationOptionId);
        if (existingMappingKeys.has(key)) {
          yield* database
            .update(addonToEventRegistrationOptions)
            .set({
              includedQuantity: mapping.includedQuantity,
              optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
            })
            .where(
              and(
                eq(addonToEventRegistrationOptions.eventId, input.eventId),
                eq(addonToEventRegistrationOptions.addonId, addOnId),
                eq(
                  addonToEventRegistrationOptions.registrationOptionId,
                  mapping.registrationOptionId,
                ),
              ),
            )
            .pipe(Effect.orDie);
        } else {
          yield* database
            .insert(addonToEventRegistrationOptions)
            .values({
              addonId: addOnId,
              eventId: input.eventId,
              ...mapping,
            })
            .pipe(Effect.orDie);
        }
      }
    }

    const submittedQuestionIds = new Set(
      input.questions.flatMap((question) => (question.id ? [question.id] : [])),
    );
    const removedQuestionIds = before.questions
      .map((question) => question.id)
      .filter((id) => !submittedQuestionIds.has(id));
    yield* ensureNoQuestionAnswers(database, removedQuestionIds);
    if (removedQuestionIds.length > 0) {
      yield* database
        .delete(eventRegistrationQuestions)
        .where(
          and(
            eq(eventRegistrationQuestions.eventId, input.eventId),
            inArray(eventRegistrationQuestions.id, removedQuestionIds),
          ),
        )
        .pipe(Effect.orDie);
    }
    for (const question of input.questions) {
      const registrationOptionId = optionIdByKey.get(
        question.registrationOptionKey,
      );
      if (!registrationOptionId) {
        return yield* Effect.die(
          new Error('Validated question target is missing'),
        );
      }
      const values = {
        description: question.description?.trim() || null,
        registrationOptionId,
        required: question.required,
        sortOrder: question.sortOrder,
        title: question.title.trim(),
      };
      if (question.id) {
        const beforeQuestion = before.questions.find(
          (existing) => existing.id === question.id,
        );
        if (!beforeQuestion) {
          return yield* Effect.die(
            new Error('Validated event question is missing from prior graph'),
          );
        }
        const questionChanged =
          (beforeQuestion.description ?? '') !== (values.description ?? '') ||
          beforeQuestion.registrationOptionId !== values.registrationOptionId ||
          beforeQuestion.required !== values.required ||
          beforeQuestion.sortOrder !== values.sortOrder ||
          beforeQuestion.title !== values.title;
        if (questionChanged) {
          yield* ensureNoQuestionAnswers(database, [question.id]);
        }
        yield* database
          .update(eventRegistrationQuestions)
          .set(values)
          .where(
            and(
              eq(eventRegistrationQuestions.eventId, input.eventId),
              eq(eventRegistrationQuestions.id, question.id),
            ),
          )
          .pipe(Effect.orDie);
      } else {
        yield* database
          .insert(eventRegistrationQuestions)
          .values({ ...values, eventId: input.eventId })
          .pipe(Effect.orDie);
      }
    }

    if (removedOptionIds.length > 0) {
      yield* database
        .delete(eventRegistrationOptionDiscounts)
        .where(
          inArray(
            eventRegistrationOptionDiscounts.registrationOptionId,
            removedOptionIds,
          ),
        )
        .pipe(Effect.orDie);
      yield* database
        .delete(eventRegistrationOptions)
        .where(
          and(
            eq(eventRegistrationOptions.eventId, input.eventId),
            inArray(eventRegistrationOptions.id, removedOptionIds),
          ),
        )
        .pipe(Effect.orDie);
    }
  },
);
