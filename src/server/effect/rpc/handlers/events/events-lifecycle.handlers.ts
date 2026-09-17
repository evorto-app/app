import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { MAX_EVENT_ADDON_TYPES } from '@shared/registration-quantity-limits';
import { MAX_REGISTRATION_QUESTIONS } from '@shared/registration-question-limits';
import {
  EventConflictError,
  EventNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import { and, eq, inArray, TransactionRollbackError } from 'drizzle-orm';
import { Context, Effect, Option } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database } from '../../../../../db';
import { createId } from '../../../../../db/create-id';
import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestions,
  eventTemplates,
  templateEventAddons,
  templateRegistrationQuestions,
} from '../../../../../db/schema';
import {
  ensureStripeForPaidEventConfiguration,
  eventConfigurationHasPaidItems,
  stripeRequiredForPaidEventConfigurationError,
} from '../../../../payments/paid-event-configuration';
import { lockTenantStripeAccount } from '../../../../payments/pending-stripe-obligations';
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
import { RpcAccess } from '../shared/rpc-access.service';
import { loadEventGraphDetail } from './event-graph.loader';
import { updateEventGraph } from './event-graph.service';
import {
  canEditEvent,
  databaseEffect,
  type EventRegistrationOptionDiscountInsert,
  isEsnCardEnabled,
  registrationOptionPriceError,
} from './events.shared';

const isTransactionRollbackError = (
  error: unknown,
): error is TransactionRollbackError =>
  error instanceof TransactionRollbackError;

const invalidEventDatesError = () =>
  new RpcBadRequestError({
    message: 'Invalid start/end date',
    reason: 'invalidDates',
  });

const invalidEventDescriptionError = () =>
  new RpcBadRequestError({
    message: 'Event description must contain meaningful content',
    reason: 'invalidDescription',
  });

const invalidRegistrationOptionTimesError = () =>
  new RpcBadRequestError({
    message: 'Registration option has invalid open/close times',
    reason: 'invalidRegistrationOptionTimes',
  });

const invalidSourceTemplateRegistrationOptionError = () =>
  new RpcBadRequestError({
    message: 'Registration option does not belong to the selected template',
    reason: 'templateRegistrationOptionMismatch',
  });

const unsupportedSourceTemplateRegistrationModeError = () =>
  new RpcBadRequestError({
    message:
      'Random allocation is unavailable. An authorized template editor must choose First come, first served or Manual approval before anyone can create an event from this template.',
    reason: 'unsupportedTemplateRegistrationMode',
  });

const invalidTemplateError = () =>
  new RpcBadRequestError({
    message: 'Template does not exist for this tenant',
    reason: 'templateNotFound',
  });

const validateEventDateRange = (start: Date, end: Date) => {
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start
  ) {
    return invalidEventDatesError();
  }

  return null;
};

const validateRegistrationOptionDateRange = (option: {
  closeRegistrationTime: Date;
  openRegistrationTime: Date;
}) => {
  if (
    Number.isNaN(option.closeRegistrationTime.getTime()) ||
    Number.isNaN(option.openRegistrationTime.getTime()) ||
    option.closeRegistrationTime < option.openRegistrationTime
  ) {
    return invalidRegistrationOptionTimesError();
  }

  return null;
};

const invalidRegistrationOptionTaxRateError = () =>
  new RpcBadRequestError({
    message: 'Registration option has an invalid tax rate',
    reason: 'invalidRegistrationOptionTaxRate',
  });

const invalidCopiedTemplateAddonTaxRateError = () =>
  new RpcBadRequestError({
    message: 'Template add-on has an invalid tax rate',
    reason: 'invalidTemplateAddonTaxRate',
  });

const invalidEsnCardDiscountPriceError = () =>
  new RpcBadRequestError({
    message: 'ESN card discount cannot exceed the registration price',
    reason: 'esnDiscountExceedsPrice',
  });

const unavailableEsnCardDiscountError = () =>
  new RpcBadRequestError({
    message: 'ESN card discounts are not enabled for this tenant',
    reason: 'esnDiscountUnavailable',
  });

const invalidRegistrationOptionSpotsError = () =>
  new RpcBadRequestError({
    message: 'Registration option spots must not be negative',
    reason: 'negativeSpots',
  });

export const templateOptionSnapshotIsComplete = (
  submittedOptionIds: readonly (string | undefined)[],
  templateOptionIds: readonly string[],
): boolean => {
  const presentSubmittedIds = submittedOptionIds.filter(
    (id): id is string => id !== undefined,
  );
  const submittedIdSet = new Set(presentSubmittedIds);
  const templateIdSet = new Set(templateOptionIds);
  return (
    presentSubmittedIds.length === submittedOptionIds.length &&
    submittedIdSet.size === presentSubmittedIds.length &&
    templateIdSet.size === templateOptionIds.length &&
    submittedIdSet.size === templateIdSet.size &&
    [...submittedIdSet].every((id) => templateIdSet.has(id))
  );
};

export const simpleEventOptionShapeIsValid = (
  options: readonly { organizingRegistration: boolean }[],
): boolean =>
  options.length === 2 &&
  options.filter((option) => option.organizingRegistration).length === 1;

export interface EventCreationAttributionShape {
  readonly creatorUserId: string;
  readonly targetTenantId: string;
}

type EventCreateInput = Parameters<AppRpcHandlers['events.create']>[0];
type TemplateAddonCopyRecord = typeof templateEventAddons.$inferSelect & {
  registrationOptions: {
    includedQuantity: number;
    optionalPurchaseQuantity: number;
    registrationOptionId: string;
  }[];
};
type TemplateQuestionCopyRecord =
  typeof templateRegistrationQuestions.$inferSelect;

export class EventCreationAttribution extends Context.Service<
  EventCreationAttribution,
  EventCreationAttributionShape
>()('@server/effect/rpc/handlers/events/EventCreationAttribution') {}

const validateEventCreatePreflight = (
  input: EventCreateInput,
): null | RpcBadRequestError => {
  const eventDateRangeError = validateEventDateRange(
    new Date(input.start),
    new Date(input.end),
  );
  if (eventDateRangeError) {
    return eventDateRangeError;
  }
  if (!isMeaningfulRichTextHtml(sanitizeRichTextHtml(input.description))) {
    return invalidEventDescriptionError();
  }

  for (const option of input.registrationOptions) {
    const priceError = registrationOptionPriceError(option);
    if (priceError) return priceError;
    if (!Number.isInteger(option.spots) || option.spots < 0) {
      return invalidRegistrationOptionSpotsError();
    }
    const registrationDateRangeError = validateRegistrationOptionDateRange({
      closeRegistrationTime: new Date(option.closeRegistrationTime),
      openRegistrationTime: new Date(option.openRegistrationTime),
    });
    if (registrationDateRangeError) {
      return registrationDateRangeError;
    }
  }

  return null;
};

export const buildEventAddonInsert = ({
  addOn,
  eventId,
}: {
  addOn: TemplateAddonCopyRecord;
  eventId: string;
}): typeof eventAddons.$inferInsert => ({
  allowMultiple: addOn.allowMultiple,
  allowPurchaseBeforeEvent: addOn.allowPurchaseBeforeEvent,
  allowPurchaseDuringEvent: addOn.allowPurchaseDuringEvent,
  allowPurchaseDuringRegistration: addOn.allowPurchaseDuringRegistration,
  description: addOn.description,
  eventId,
  isPaid: addOn.isPaid,
  maxQuantityPerUser: addOn.maxQuantityPerUser,
  price: addOn.price,
  stripeTaxRateId: addOn.stripeTaxRateId,
  title: addOn.title,
  totalAvailableQuantity: addOn.totalAvailableQuantity,
});

export const buildEventQuestionInsert = ({
  eventId,
  question,
  registrationOptionId,
}: {
  eventId: string;
  question: TemplateQuestionCopyRecord;
  registrationOptionId: string;
}): typeof eventRegistrationQuestions.$inferInsert => ({
  description: question.description,
  eventId,
  registrationOptionId,
  required: question.required,
  sortOrder: question.sortOrder,
  sourceTemplateQuestionId: question.id,
  title: question.title,
});

export const requireCreatedEventOption = <CreatedOption>(
  createdOptionBySourceTemplateOptionId: ReadonlyMap<string, CreatedOption>,
  sourceTemplateOptionId: string,
  mappingKind: 'add-on' | 'discount' | 'question',
): CreatedOption => {
  const createdOption = createdOptionBySourceTemplateOptionId.get(
    sourceTemplateOptionId,
  );
  if (!createdOption) {
    throw new Error(
      `Template ${mappingKind} mapping references missing registration option ${sourceTemplateOptionId}`,
    );
  }
  return createdOption;
};

export const requireTemplateAddonMappingTarget = (
  templateAddonIds: ReadonlySet<string>,
  templateAddonId: string,
): void => {
  if (!templateAddonIds.has(templateAddonId)) {
    throw new Error(
      `Template add-on mapping references missing add-on ${templateAddonId}`,
    );
  }
};

const validateEventCreateDiscount = ({
  esnCardEnabledForTenant,
  option,
}: {
  esnCardEnabledForTenant: boolean;
  option: {
    esnCardDiscountedPrice: null | number;
    isPaid: boolean;
    price: number;
  };
}): null | RpcBadRequestError => {
  if (option.esnCardDiscountedPrice === null) {
    return null;
  }

  if (!option.isPaid) {
    return new RpcBadRequestError({
      message: 'ESNcard discounts require a paid sign-up choice.',
      reason: 'esnDiscountRequiresPaidOption',
    });
  }

  if (!esnCardEnabledForTenant) {
    return unavailableEsnCardDiscountError();
  }

  if (option.esnCardDiscountedPrice > option.price) {
    return invalidEsnCardDiscountPriceError();
  }

  return null;
};

export const createEventGraph = (input: EventCreateInput) =>
  Effect.gen(function* () {
    yield* RpcAccess.ensurePermission('events:create');
    const { tenant } = yield* RpcAccess.current();
    const attribution = yield* Effect.serviceOption(EventCreationAttribution);
    const creatorId = Option.isSome(attribution)
      ? attribution.value.creatorUserId
      : (yield* RpcAccess.requireUser()).id;
    if (
      Option.isSome(attribution) &&
      attribution.value.targetTenantId !== tenant.id
    ) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message:
            'The selected creator is no longer a member of this organization.',
          reason: 'creatorTenantMismatch',
        }),
      );
    }

    const start = new Date(input.start);
    const end = new Date(input.end);
    const eventDateRangeError = validateEventDateRange(start, end);
    if (eventDateRangeError) {
      return yield* Effect.fail(eventDateRangeError);
    }

    const sanitizedDescription = sanitizeRichTextHtml(input.description);
    if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
      return yield* Effect.fail(invalidEventDescriptionError());
    }

    const sanitizedRegistrationOptions = input.registrationOptions.map(
      (option) => ({
        ...option,
        closeRegistrationTime: new Date(option.closeRegistrationTime),
        description: sanitizeOptionalRichTextHtml(option.description),
        openRegistrationTime: new Date(option.openRegistrationTime),
        registeredDescription: sanitizeOptionalRichTextHtml(
          option.registeredDescription,
        ),
      }),
    );
    for (const option of sanitizedRegistrationOptions) {
      const priceError = registrationOptionPriceError(option);
      if (priceError) return yield* Effect.fail(priceError);
    }
    const lockedStripeAccountId = yield* Database.use((database) =>
      lockTenantStripeAccount(database, tenant.id).pipe(Effect.orDie),
    );
    const hasPaidRegistrationOptions = eventConfigurationHasPaidItems({
      addOns: [],
      registrationOptions: sanitizedRegistrationOptions,
    });
    if (hasPaidRegistrationOptions && !lockedStripeAccountId) {
      return yield* Effect.fail(stripeRequiredForPaidEventConfigurationError());
    }

    const registrationRoleIds = sanitizedRegistrationOptions.flatMap(
      (option) => option.roleIds,
    );
    const registrationRolesExist = yield* Database.use((database) =>
      Effect.gen(function* () {
        yield* lockTenantRoleGraph(database, tenant.id);
        return yield* tenantRoleIdsExist(
          database,
          tenant.id,
          registrationRoleIds,
        );
      }).pipe(Effect.orDie),
    );
    if (!registrationRolesExist) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message:
            'One selected sign-up role is no longer available in this organization.',
          reason: 'registrationRoleNotFound',
        }),
      );
    }

    for (const option of sanitizedRegistrationOptions) {
      if (!Number.isInteger(option.spots) || option.spots < 0) {
        return yield* Effect.fail(invalidRegistrationOptionSpotsError());
      }

      const registrationOptionDateRangeError =
        validateRegistrationOptionDateRange(option);
      if (registrationOptionDateRangeError) {
        return yield* Effect.fail(registrationOptionDateRangeError);
      }

      const validation = yield* databaseEffect((database) =>
        validateTaxRate(database, {
          isPaid: option.isPaid,
          stripeTaxRateId: option.stripeTaxRateId ?? null,
          tenantId: tenant.id,
        }),
      );
      if (!validation.success) {
        return yield* Effect.fail(invalidRegistrationOptionTaxRateError());
      }
    }

    const templateDefaults = yield* databaseEffect((database) =>
      database
        .select({
          simpleModeEnabled: eventTemplates.simpleModeEnabled,
        })
        .from(eventTemplates)
        .where(
          and(
            eq(eventTemplates.id, input.templateId),
            eq(eventTemplates.tenantId, tenant.id),
          ),
        )
        .limit(1)
        .for('share')
        .pipe(Effect.map((rows) => rows[0])),
    );
    if (!templateDefaults) {
      return yield* Effect.fail(invalidTemplateError());
    }
    if (
      templateDefaults.simpleModeEnabled &&
      !simpleEventOptionShapeIsValid(sanitizedRegistrationOptions)
    ) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message:
            'Choose exactly one organizer sign-up choice and one attendee sign-up choice for this event.',
          reason: 'invalidSimpleEventConfiguration',
        }),
      );
    }

    const submittedSourceTemplateOptionIds = sanitizedRegistrationOptions.map(
      (option) => option.sourceTemplateRegistrationOptionId,
    );
    const tenantTemplateOptions = yield* databaseEffect((database) =>
      database.query.templateRegistrationOptions.findMany({
        columns: {
          id: true,
          registrationMode: true,
        },
        where: { templateId: input.templateId },
      }),
    );
    if (
      tenantTemplateOptions.some(
        (option) => option.registrationMode === 'random',
      )
    ) {
      return yield* Effect.fail(
        unsupportedSourceTemplateRegistrationModeError(),
      );
    }
    const templateOptionIds = tenantTemplateOptions.map((option) => option.id);
    if (
      !templateOptionSnapshotIsComplete(
        submittedSourceTemplateOptionIds,
        templateOptionIds,
      )
    ) {
      return yield* Effect.fail(invalidSourceTemplateRegistrationOptionError());
    }
    const sourceTemplateOptionIds = submittedSourceTemplateOptionIds.filter(
      (id): id is string => id !== undefined,
    );
    const createdOptionPlans = sanitizedRegistrationOptions.map((option) => {
      const sourceTemplateOptionId = option.sourceTemplateRegistrationOptionId;
      if (!sourceTemplateOptionId) {
        throw new Error(
          'Validated event option is missing its source template option',
        );
      }
      return {
        createdOptionId: createId(),
        isPaid: option.isPaid,
        option,
        sourceTemplateOptionId,
      };
    });
    const createdOptionBySourceTemplateOptionId = new Map(
      createdOptionPlans.map((plan) => [plan.sourceTemplateOptionId, plan]),
    );
    if (
      createdOptionBySourceTemplateOptionId.size !== createdOptionPlans.length
    ) {
      throw new Error('Event option copy plan contains duplicate source IDs');
    }

    const templateAddons = yield* databaseEffect((database) =>
      database.query.templateEventAddons.findMany({
        where: {
          templateId: input.templateId,
        },
      }),
    );
    const templateQuestions =
      sourceTemplateOptionIds.length > 0
        ? yield* databaseEffect((database) =>
            database.query.templateRegistrationQuestions.findMany({
              where: {
                registrationOptionId: {
                  in: sourceTemplateOptionIds,
                },
                templateId: input.templateId,
              },
            }),
          )
        : [];
    if (templateAddons.length > MAX_EVENT_ADDON_TYPES) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: `An event can have at most ${MAX_EVENT_ADDON_TYPES} add-on types.`,
          reason: 'eventAddonTypeLimitExceeded',
        }),
      );
    }
    if (templateQuestions.length > MAX_REGISTRATION_QUESTIONS) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: `An event can have at most ${MAX_REGISTRATION_QUESTIONS} sign-up questions.`,
          reason: 'eventQuestionLimitExceeded',
        }),
      );
    }
    const addonIds = templateAddons.map((addOn) => addOn.id);
    const templateAddonRegistrationOptions =
      addonIds.length === 0 || sourceTemplateOptionIds.length === 0
        ? []
        : yield* databaseEffect((database) =>
            database.query.addonToTemplateRegistrationOptions.findMany({
              where: {
                addonId: {
                  in: addonIds,
                },
                registrationOptionId: {
                  in: sourceTemplateOptionIds,
                },
              },
            }),
          );
    const templateAddonIdSet = new Set(addonIds);
    for (const mapping of templateAddonRegistrationOptions) {
      requireTemplateAddonMappingTarget(templateAddonIdSet, mapping.addonId);
      requireCreatedEventOption(
        createdOptionBySourceTemplateOptionId,
        mapping.registrationOptionId,
        'add-on',
      );
    }
    for (const question of templateQuestions) {
      requireCreatedEventOption(
        createdOptionBySourceTemplateOptionId,
        question.registrationOptionId,
        'question',
      );
    }
    const templateAddonsToCopy: TemplateAddonCopyRecord[] = templateAddons.map(
      (addOn) => ({
        ...addOn,
        registrationOptions: templateAddonRegistrationOptions
          .filter((option) => option.addonId === addOn.id)
          .map((option) => ({
            includedQuantity: option.includedQuantity,
            optionalPurchaseQuantity: option.optionalPurchaseQuantity,
            registrationOptionId: option.registrationOptionId,
          })),
      }),
    );
    if (
      !hasPaidRegistrationOptions &&
      !lockedStripeAccountId &&
      eventConfigurationHasPaidItems({
        addOns: templateAddonsToCopy,
        registrationOptions: [],
      })
    ) {
      return yield* Effect.fail(stripeRequiredForPaidEventConfigurationError());
    }
    for (const addOn of templateAddonsToCopy) {
      const validation = yield* databaseEffect((database) =>
        validateTaxRate(database, {
          isPaid: addOn.isPaid,
          stripeTaxRateId: addOn.stripeTaxRateId ?? null,
          tenantId: tenant.id,
        }),
      );
      if (!validation.success) {
        return yield* Effect.fail(invalidCopiedTemplateAddonTaxRateError());
      }
    }
    const esnCardEnabledForTenant = isEsnCardEnabled(
      tenant.discountProviders ?? null,
    );
    for (const option of sanitizedRegistrationOptions) {
      const validationError = validateEventCreateDiscount({
        esnCardEnabledForTenant,
        option,
      });
      if (validationError) {
        return yield* Effect.fail(validationError);
      }
    }

    const events = yield* databaseEffect((database) =>
      database
        .insert(eventInstances)
        .values({
          creatorId,
          description: sanitizedDescription,
          end,
          icon: input.icon,
          location: input.location ?? null,
          simpleModeEnabled: templateDefaults.simpleModeEnabled,
          start,
          templateId: input.templateId,
          tenantId: tenant.id,
          title: input.title,
        })
        .returning({
          id: eventInstances.id,
        }),
    );
    const event = events[0];
    if (!event) {
      return yield* Effect.fail(
        new RpcInternalServerError({
          message: 'The event could not be saved. Try again.',
        }),
      );
    }

    if (createdOptionPlans.length > 0) {
      yield* databaseEffect((database) =>
        database.insert(eventRegistrationOptions).values(
          createdOptionPlans.map(({ createdOptionId, option }) => ({
            cancellationDeadlineHoursBeforeStart:
              option.cancellationDeadlineHoursBeforeStart,
            closeRegistrationTime: option.closeRegistrationTime,
            description: option.description,
            eventId: event.id,
            id: createdOptionId,
            isPaid: option.isPaid,
            openRegistrationTime: option.openRegistrationTime,
            organizingRegistration: option.organizingRegistration,
            price: option.price,
            refundFeesOnCancellation: option.refundFeesOnCancellation,
            registeredDescription: option.registeredDescription,
            registrationMode: option.registrationMode,
            roleIds: [...option.roleIds],
            spots: option.spots,
            stripeTaxRateId: option.stripeTaxRateId ?? null,
            title: option.title,
            transferDeadlineHoursBeforeStart:
              option.transferDeadlineHoursBeforeStart,
          })),
        ),
      );
    }

    const discountInserts: EventRegistrationOptionDiscountInsert[] = [];
    for (const { createdOptionId, option } of createdOptionPlans) {
      if (option.esnCardDiscountedPrice !== null) {
        discountInserts.push({
          discountedPrice: option.esnCardDiscountedPrice,
          discountType: 'esnCard',
          eventId: event.id,
          registrationOptionId: createdOptionId,
        });
      }
    }
    if (discountInserts.length > 0) {
      yield* databaseEffect((database) =>
        database
          .insert(eventRegistrationOptionDiscounts)
          .values(discountInserts),
      );
    }

    if (templateAddonsToCopy.length > 0) {
      for (const addOn of templateAddonsToCopy) {
        const insertedAddons = yield* databaseEffect((database) =>
          database
            .insert(eventAddons)
            .values(buildEventAddonInsert({ addOn, eventId: event.id }))
            .returning({ id: eventAddons.id }),
        );
        const insertedAddon = insertedAddons[0];
        if (!insertedAddon) {
          return yield* Effect.fail(
            new RpcInternalServerError({
              message: 'The event could not be saved. Try again.',
            }),
          );
        }

        const registrationOptionInserts = addOn.registrationOptions.map(
          (registrationOption) => ({
            addonId: insertedAddon.id,
            eventId: event.id,
            includedQuantity: registrationOption.includedQuantity,
            optionalPurchaseQuantity:
              registrationOption.optionalPurchaseQuantity,
            registrationOptionId: requireCreatedEventOption(
              createdOptionBySourceTemplateOptionId,
              registrationOption.registrationOptionId,
              'add-on',
            ).createdOptionId,
          }),
        );
        if (registrationOptionInserts.length > 0) {
          yield* databaseEffect((database) =>
            database
              .insert(addonToEventRegistrationOptions)
              .values(registrationOptionInserts),
          );
        }
      }
    }

    if (templateQuestions.length > 0) {
      const questionInserts = templateQuestions.map((question) =>
        buildEventQuestionInsert({
          eventId: event.id,
          question,
          registrationOptionId: requireCreatedEventOption(
            createdOptionBySourceTemplateOptionId,
            question.registrationOptionId,
            'question',
          ).createdOptionId,
        }),
      );

      if (questionInserts.length > 0) {
        yield* databaseEffect((database) =>
          database.insert(eventRegistrationQuestions).values(questionInserts),
        );
      }
    }

    return {
      id: event.id,
    };
  });

const isExpectedEventCreateError = (
  error: unknown,
): error is
  | RpcBadRequestError
  | RpcForbiddenError
  | RpcInternalServerError
  | RpcUnauthorizedError =>
  error instanceof RpcBadRequestError ||
  error instanceof RpcForbiddenError ||
  error instanceof RpcInternalServerError ||
  error instanceof RpcUnauthorizedError;

export const eventLifecycleHandlers = {
  'events.create': (input, _options) => {
    const preflightError = validateEventCreatePreflight(input);
    if (preflightError) {
      return Effect.fail(preflightError);
    }

    return Database.use((database) =>
      database
        .transaction((transaction) => {
          const transactionalDatabase = Object.assign(transaction, {
            $client: database.$client,
          });
          return createEventGraph(input).pipe(
            Effect.provideService(Database, transactionalDatabase),
          );
        })
        .pipe(
          Effect.catch((error) =>
            isExpectedEventCreateError(error)
              ? Effect.fail(error)
              : Effect.die(error),
          ),
        ),
    );
  },
  'events.update': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();

      const start = new Date(input.start);
      const end = new Date(input.end);
      const eventDateRangeError = validateEventDateRange(start, end);
      if (eventDateRangeError) {
        return yield* Effect.fail(eventDateRangeError);
      }

      const sanitizedDescription = sanitizeRichTextHtml(input.description);
      if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
        return yield* Effect.fail(invalidEventDescriptionError());
      }
      const sanitizedRegistrationOptions = input.registrationOptions.map(
        (option) => ({
          ...option,
          closeRegistrationTime: new Date(option.closeRegistrationTime),
          description: sanitizeOptionalRichTextHtml(option.description),
          esnCardDiscountedPrice:
            option.esnCardDiscountedPrice === undefined
              ? null
              : option.esnCardDiscountedPrice,
          openRegistrationTime: new Date(option.openRegistrationTime),
          registeredDescription: sanitizeOptionalRichTextHtml(
            option.registeredDescription,
          ),
        }),
      );

      for (const option of sanitizedRegistrationOptions) {
        const priceError = registrationOptionPriceError(option);
        if (priceError) return yield* Effect.fail(priceError);
        if (!Number.isInteger(option.spots) || option.spots < 0) {
          return yield* Effect.fail(invalidRegistrationOptionSpotsError());
        }

        const registrationOptionDateRangeError =
          validateRegistrationOptionDateRange(option);
        if (registrationOptionDateRangeError) {
          return yield* Effect.fail(registrationOptionDateRangeError);
        }
      }

      const event = yield* databaseEffect((database) =>
        database.query.eventInstances.findFirst({
          columns: {
            creatorId: true,
            simpleModeEnabled: true,
            status: true,
          },
          where: {
            id: input.eventId,
            tenantId: tenant.id,
          },
        }),
      );
      if (!event) {
        return yield* Effect.fail(
          new EventNotFoundError({
            id: input.eventId,
            message: 'Event not found',
          }),
        );
      }
      if (
        !canEditEvent({
          creatorId: event.creatorId,
          permissions: user.permissions,
          userId: user.id,
        })
      ) {
        return yield* Effect.fail(
          new RpcForbiddenError({ message: 'Forbidden' }),
        );
      }
      if (event.status !== 'DRAFT') {
        return yield* Effect.fail(
          new EventConflictError({
            message: 'Event cannot be updated in its current state',
          }),
        );
      }
      if (
        event.simpleModeEnabled &&
        !simpleEventOptionShapeIsValid(sanitizedRegistrationOptions)
      ) {
        return yield* Effect.fail(
          new RpcBadRequestError({
            message:
              'Simple event configuration requires exactly one organizer option and one participant option',
            reason: 'invalidSimpleEventConfiguration',
          }),
        );
      }

      const esnCardEnabledForTenant = isEsnCardEnabled(
        tenant.discountProviders ?? null,
      );

      for (const option of sanitizedRegistrationOptions) {
        const validation = yield* databaseEffect((database) =>
          validateTaxRate(database, {
            isPaid: option.isPaid,
            stripeTaxRateId: option.stripeTaxRateId ?? null,
            tenantId: tenant.id,
          }),
        );
        if (!validation.success) {
          return yield* Effect.fail(invalidRegistrationOptionTaxRateError());
        }

        if (
          option.esnCardDiscountedPrice !== null &&
          option.esnCardDiscountedPrice > option.price
        ) {
          return yield* Effect.fail(invalidEsnCardDiscountPriceError());
        }

        if (
          option.esnCardDiscountedPrice !== null &&
          !esnCardEnabledForTenant &&
          option.isPaid
        ) {
          return yield* Effect.fail(unavailableEsnCardDiscountError());
        }
      }

      let transactionFailure: EventConflictError | null | RpcBadRequestError =
        null;
      const updatedEvent = yield* databaseEffect((database) =>
        database.transaction((tx) =>
          Effect.gen(function* () {
            const transactionalDatabase = Object.assign(tx, {
              $client: database.$client,
            });
            if (
              eventConfigurationHasPaidItems({
                addOns: [],
                registrationOptions: sanitizedRegistrationOptions,
              })
            ) {
              const stripeAccountId = yield* lockTenantStripeAccount(
                tx,
                tenant.id,
              );
              if (!stripeAccountId) {
                transactionFailure =
                  stripeRequiredForPaidEventConfigurationError();
                yield* tx.rollback();
              }
            }
            for (const option of sanitizedRegistrationOptions) {
              const validation = yield* validateTaxRate(transactionalDatabase, {
                isPaid: option.isPaid,
                stripeTaxRateId: option.stripeTaxRateId ?? null,
                tenantId: tenant.id,
              });
              if (!validation.success) {
                transactionFailure = invalidRegistrationOptionTaxRateError();
                yield* tx.rollback();
              }
            }
            yield* lockTenantRoleGraph(tx, tenant.id);
            const registrationRolesExist = yield* tenantRoleIdsExist(
              tx,
              tenant.id,
              sanitizedRegistrationOptions.flatMap((option) => option.roleIds),
            );
            if (!registrationRolesExist) {
              transactionFailure = new RpcBadRequestError({
                message: 'Registration option role not found for this tenant',
                reason: 'registrationRoleNotFound',
              });
              yield* tx.rollback();
            }

            const updatedEvents = yield* tx
              .update(eventInstances)
              .set({
                description: sanitizedDescription,
                end,
                icon: input.icon,
                location: input.location,
                start,
                title: input.title,
              })
              .where(
                and(
                  eq(eventInstances.id, input.eventId),
                  eq(eventInstances.tenantId, tenant.id),
                  eq(eventInstances.status, 'DRAFT'),
                ),
              )
              .returning({
                id: eventInstances.id,
              });
            const eventRow = updatedEvents[0];
            if (!eventRow) {
              transactionFailure = new EventConflictError({
                message: 'Event update conflict',
              });
              yield* tx.rollback();
            }

            const existingRegistrationRows =
              yield* tx.query.eventRegistrationOptions.findMany({
                columns: {
                  id: true,
                },
                where: {
                  eventId: input.eventId,
                },
              });
            const existingRegistrationOptionIds = new Set(
              existingRegistrationRows.map((option) => option.id),
            );
            for (const option of sanitizedRegistrationOptions) {
              if (existingRegistrationOptionIds.has(option.id)) {
                continue;
              }

              transactionFailure = new RpcBadRequestError({
                message: 'Registration option does not belong to event',
                reason: 'registrationOptionMismatch',
              });
              yield* tx.rollback();
            }

            for (const option of sanitizedRegistrationOptions) {
              yield* tx
                .update(eventRegistrationOptions)
                .set({
                  cancellationDeadlineHoursBeforeStart:
                    option.cancellationDeadlineHoursBeforeStart,
                  closeRegistrationTime: option.closeRegistrationTime,
                  description: option.description,
                  isPaid: option.isPaid,
                  openRegistrationTime: option.openRegistrationTime,
                  organizingRegistration: option.organizingRegistration,
                  price: option.price,
                  refundFeesOnCancellation: option.refundFeesOnCancellation,
                  registeredDescription: option.registeredDescription,
                  registrationMode: option.registrationMode,
                  roleIds: [...option.roleIds],
                  spots: option.spots,
                  stripeTaxRateId: option.stripeTaxRateId ?? null,
                  title: option.title,
                  transferDeadlineHoursBeforeStart:
                    option.transferDeadlineHoursBeforeStart,
                })
                .where(
                  and(
                    eq(eventRegistrationOptions.eventId, input.eventId),
                    eq(eventRegistrationOptions.id, option.id),
                  ),
                );
            }

            const existingEsnDiscounts =
              sanitizedRegistrationOptions.length === 0
                ? []
                : yield* tx
                    .select({
                      id: eventRegistrationOptionDiscounts.id,
                      registrationOptionId:
                        eventRegistrationOptionDiscounts.registrationOptionId,
                    })
                    .from(eventRegistrationOptionDiscounts)
                    .where(
                      and(
                        eq(
                          eventRegistrationOptionDiscounts.discountType,
                          'esnCard',
                        ),
                        inArray(
                          eventRegistrationOptionDiscounts.registrationOptionId,
                          sanitizedRegistrationOptions.map(
                            (registrationOption) => registrationOption.id,
                          ),
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
              const existingDiscount =
                existingEsnDiscountByRegistrationOptionId.get(option.id);
              const shouldPersistDiscount =
                esnCardEnabledForTenant &&
                option.isPaid &&
                option.esnCardDiscountedPrice !== null;

              if (!shouldPersistDiscount) {
                if (existingDiscount) {
                  yield* tx
                    .delete(eventRegistrationOptionDiscounts)
                    .where(
                      eq(
                        eventRegistrationOptionDiscounts.id,
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
                yield* tx
                  .update(eventRegistrationOptionDiscounts)
                  .set({
                    discountedPrice,
                  })
                  .where(
                    eq(
                      eventRegistrationOptionDiscounts.id,
                      existingDiscount.id,
                    ),
                  );
                continue;
              }

              yield* tx.insert(eventRegistrationOptionDiscounts).values({
                discountedPrice,
                discountType: 'esnCard',
                eventId: input.eventId,
                registrationOptionId: option.id,
              });
            }

            return eventRow;
          }),
        ),
      ).pipe(
        Effect.catchDefect((defect) => {
          if (!isTransactionRollbackError(defect)) {
            return Effect.die(defect);
          }

          {
            const failure = transactionFailure;
            return failure === null
              ? Effect.die(
                  new Error(
                    'Transaction rollback triggered without a tracked failure',
                  ),
                )
              : Effect.fail(failure);
          }
        }),
      );
      if (!updatedEvent) {
        return yield* Effect.die(
          new Error('Event update returned no updated row'),
        );
      }

      return {
        id: updatedEvent.id,
      };
    }),
  'events.updateGraph': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      const start = new Date(input.start);
      const end = new Date(input.end);
      const eventDateRangeError = validateEventDateRange(start, end);
      if (eventDateRangeError) return yield* Effect.fail(eventDateRangeError);
      const title = input.title.trim();
      if (!title) {
        return yield* Effect.fail(
          new RpcBadRequestError({
            message: 'Event title is required',
            reason: 'eventTitleRequired',
          }),
        );
      }
      const sanitizedDescription = sanitizeRichTextHtml(input.description);
      if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
        return yield* Effect.fail(invalidEventDescriptionError());
      }

      const event = yield* databaseEffect((database) =>
        database.query.eventInstances.findFirst({
          columns: { creatorId: true, status: true },
          where: { id: input.eventId, tenantId: tenant.id },
        }),
      );
      if (!event) {
        return yield* Effect.fail(
          new EventNotFoundError({
            id: input.eventId,
            message: 'Event not found',
          }),
        );
      }
      if (
        !canEditEvent({
          creatorId: event.creatorId,
          permissions: user.permissions,
          userId: user.id,
        })
      ) {
        return yield* Effect.fail(
          new RpcForbiddenError({ message: 'Forbidden' }),
        );
      }
      if (event.status !== 'DRAFT') {
        return yield* Effect.fail(
          new EventConflictError({
            message: 'Event cannot be updated in its current state',
          }),
        );
      }

      const esnCardEnabled = isEsnCardEnabled(tenant.discountProviders ?? null);
      return yield* Database.use((database) =>
        database
          .transaction((transaction) => {
            const transactionalDatabase = Object.assign(transaction, {
              $client: database.$client,
            });
            return Effect.gen(function* () {
              yield* ensureStripeForPaidEventConfiguration(
                transactionalDatabase,
                tenant.id,
                {
                  addOns: input.addOns,
                  registrationOptions: input.registrationOptions,
                },
              );
              const lockedEvents = yield* transaction
                .select({ id: eventInstances.id })
                .from(eventInstances)
                .where(
                  and(
                    eq(eventInstances.id, input.eventId),
                    eq(eventInstances.tenantId, tenant.id),
                    eq(eventInstances.status, 'DRAFT'),
                  ),
                )
                .for('update')
                .pipe(Effect.orDie);
              if (lockedEvents.length === 0) {
                return yield* Effect.fail(
                  new EventConflictError({
                    message: 'Event update preconditions changed',
                  }),
                );
              }
              const before = yield* loadEventGraphDetail(
                transactionalDatabase,
                tenant.id,
                input.eventId,
              );
              if (!before) {
                return yield* Effect.fail(
                  new EventNotFoundError({
                    id: input.eventId,
                    message: 'Event not found',
                  }),
                );
              }
              const updated = yield* transaction
                .update(eventInstances)
                .set({
                  description: sanitizedDescription,
                  end,
                  icon: input.icon,
                  location: input.location,
                  simpleModeEnabled: input.simpleModeEnabled,
                  start,
                  title,
                })
                .where(
                  and(
                    eq(eventInstances.id, input.eventId),
                    eq(eventInstances.tenantId, tenant.id),
                    eq(eventInstances.status, 'DRAFT'),
                  ),
                )
                .returning({ id: eventInstances.id })
                .pipe(Effect.orDie);
              const updatedEvent = updated[0];
              if (!updatedEvent) {
                return yield* Effect.fail(
                  new EventConflictError({ message: 'Event update conflict' }),
                );
              }
              yield* updateEventGraph({
                before,
                database: transactionalDatabase,
                esnCardEnabled,
                input,
                tenantId: tenant.id,
              });
              return { id: updatedEvent.id };
            });
          })
          .pipe(Effect.catchTag('SqlError', Effect.die)),
      );
    }),
  'events.updateListing': ({ eventId, unlisted }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('events:changeListing');
      const { tenant } = yield* RpcAccess.current();

      yield* databaseEffect((database) =>
        database
          .update(eventInstances)
          .set({ unlisted })
          .where(
            and(
              eq(eventInstances.tenantId, tenant.id),
              eq(eventInstances.id, eventId),
            ),
          ),
      );
    }),
} satisfies Partial<AppRpcHandlers>;
