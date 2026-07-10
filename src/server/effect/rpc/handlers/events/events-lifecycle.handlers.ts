import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  EventConflictError,
  EventNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import { and, eq, inArray, TransactionRollbackError } from 'drizzle-orm';
import { Context, Effect, Option } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database } from '../../../../../db';
import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestions,
  templateEventAddons,
  templateRegistrationOptionDiscounts,
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
import { RpcAccess } from '../shared/rpc-access.service';
import {
  canEditEvent,
  databaseEffect,
  type EventRegistrationOptionDiscountInsert,
  isEsnCardEnabled,
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

const validateCopiedTemplateDiscount = ({
  discount,
  esnCardEnabledForTenant,
  option,
}: {
  discount: {
    discountedPrice: number;
    discountType: string;
  };
  esnCardEnabledForTenant: boolean;
  option: {
    isPaid: boolean;
    price: number;
  };
}): null | RpcBadRequestError => {
  if (discount.discountType !== 'esnCard') {
    return null;
  }

  if (!option.isPaid) {
    return null;
  }

  if (esnCardEnabledForTenant && discount.discountedPrice > option.price) {
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
          message: 'Event creator attribution tenant mismatch',
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
          message: 'Registration option role not found for this tenant',
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
      database.query.eventTemplates.findFirst({
        columns: { unlisted: true },
        where: { id: input.templateId, tenantId: tenant.id },
      }),
    );
    if (!templateDefaults) {
      return yield* Effect.fail(invalidTemplateError());
    }

    const sourceTemplateOptionIds = [
      ...new Set(
        sanitizedRegistrationOptions
          .map((option) => option.sourceTemplateRegistrationOptionId)
          .filter((id): id is string => id !== undefined),
      ),
    ];
    const tenantTemplateOptions = yield* databaseEffect((database) =>
      database.query.templateRegistrationOptions.findMany({
        columns: {
          id: true,
        },
        where: { templateId: input.templateId },
      }),
    );
    const validTemplateOptionIds = new Set(
      tenantTemplateOptions.map((option) => option.id),
    );
    for (const sourceTemplateOptionId of sourceTemplateOptionIds) {
      if (!validTemplateOptionIds.has(sourceTemplateOptionId)) {
        return yield* Effect.fail(
          invalidSourceTemplateRegistrationOptionError(),
        );
      }
    }

    const templateDiscounts =
      sourceTemplateOptionIds.length > 0
        ? yield* databaseEffect((database) =>
            database
              .select({
                discountedPrice:
                  templateRegistrationOptionDiscounts.discountedPrice,
                discountType: templateRegistrationOptionDiscounts.discountType,
                registrationOptionId:
                  templateRegistrationOptionDiscounts.registrationOptionId,
              })
              .from(templateRegistrationOptionDiscounts)
              .where(
                inArray(
                  templateRegistrationOptionDiscounts.registrationOptionId,
                  sourceTemplateOptionIds,
                ),
              ),
          )
        : [];
    const templateAddons =
      sourceTemplateOptionIds.length > 0
        ? yield* databaseEffect((database) =>
            database.query.templateEventAddons.findMany({
              where: {
                templateId: input.templateId,
              },
            }),
          )
        : [];
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
    const addonIds = templateAddons.map((addOn) => addOn.id);
    const templateAddonRegistrationOptions =
      addonIds.length === 0
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
    const templateAddonsToCopy: TemplateAddonCopyRecord[] = templateAddons
      .map((addOn) => ({
        ...addOn,
        registrationOptions: templateAddonRegistrationOptions
          .filter((option) => option.addonId === addOn.id)
          .map((option) => ({
            includedQuantity: option.includedQuantity,
            optionalPurchaseQuantity: option.optionalPurchaseQuantity,
            registrationOptionId: option.registrationOptionId,
          })),
      }))
      .filter((addOn) => addOn.registrationOptions.length > 0);
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
      if (!option.sourceTemplateRegistrationOptionId) {
        continue;
      }

      const copiedDiscounts = templateDiscounts.filter(
        (discount) =>
          discount.registrationOptionId ===
          option.sourceTemplateRegistrationOptionId,
      );
      for (const discount of copiedDiscounts) {
        const validationError = validateCopiedTemplateDiscount({
          discount,
          esnCardEnabledForTenant,
          option,
        });
        if (validationError) {
          return yield* Effect.fail(validationError);
        }
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
          start,
          templateId: input.templateId,
          tenantId: tenant.id,
          title: input.title,
          unlisted: templateDefaults?.unlisted ?? false,
        })
        .returning({
          id: eventInstances.id,
        }),
    );
    const event = events[0];
    if (!event) {
      return yield* Effect.fail(
        new RpcInternalServerError({ message: 'Internal server error' }),
      );
    }

    const createdOptions = yield* databaseEffect((database) =>
      database
        .insert(eventRegistrationOptions)
        .values(
          sanitizedRegistrationOptions.map((option) => ({
            cancellationDeadlineHoursBeforeStart:
              option.cancellationDeadlineHoursBeforeStart,
            closeRegistrationTime: option.closeRegistrationTime,
            description: option.description,
            eventId: event.id,
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
        )
        .returning({
          id: eventRegistrationOptions.id,
        }),
    );

    if (templateDiscounts.length > 0) {
      const createdOptionSources = createdOptions.map(
        (createdOption, index) => ({
          createdOptionId: createdOption.id,
          isPaid: sanitizedRegistrationOptions[index]?.isPaid ?? false,
          sourceTemplateOptionId:
            sanitizedRegistrationOptions[index]
              ?.sourceTemplateRegistrationOptionId,
        }),
      );
      const discountInserts: EventRegistrationOptionDiscountInsert[] = [];
      for (const createdOptionSource of createdOptionSources) {
        if (
          !createdOptionSource.sourceTemplateOptionId ||
          !createdOptionSource.isPaid
        ) {
          continue;
        }

        for (const discount of templateDiscounts) {
          if (
            discount.registrationOptionId !==
            createdOptionSource.sourceTemplateOptionId
          ) {
            continue;
          }
          if (discount.discountType === 'esnCard' && !esnCardEnabledForTenant) {
            continue;
          }
          discountInserts.push({
            discountedPrice: discount.discountedPrice,
            discountType: discount.discountType,
            registrationOptionId: createdOptionSource.createdOptionId,
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
    }

    if (templateAddonsToCopy.length > 0) {
      const createdOptionSources = createdOptions.map(
        (createdOption, index) => ({
          createdOptionId: createdOption.id,
          sourceTemplateOptionId:
            sanitizedRegistrationOptions[index]
              ?.sourceTemplateRegistrationOptionId,
        }),
      );
      const createdOptionIdBySourceTemplateOptionId = new Map(
        createdOptionSources
          .filter(
            (
              option,
            ): option is {
              createdOptionId: string;
              sourceTemplateOptionId: string;
            } => option.sourceTemplateOptionId !== undefined,
          )
          .map((option) => [
            option.sourceTemplateOptionId,
            option.createdOptionId,
          ]),
      );

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
            new RpcInternalServerError({ message: 'Internal server error' }),
          );
        }

        const registrationOptionInserts = addOn.registrationOptions
          .map((registrationOption) => {
            const eventRegistrationOptionId =
              createdOptionIdBySourceTemplateOptionId.get(
                registrationOption.registrationOptionId,
              );
            return eventRegistrationOptionId
              ? {
                  addonId: insertedAddon.id,
                  eventId: event.id,
                  includedQuantity: registrationOption.includedQuantity,
                  optionalPurchaseQuantity:
                    registrationOption.optionalPurchaseQuantity,
                  registrationOptionId: eventRegistrationOptionId,
                }
              : null;
          })
          .filter((insert) => insert !== null);
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
      const createdOptionSources = createdOptions.map(
        (createdOption, index) => ({
          createdOptionId: createdOption.id,
          sourceTemplateOptionId:
            sanitizedRegistrationOptions[index]
              ?.sourceTemplateRegistrationOptionId,
        }),
      );
      const createdOptionIdBySourceTemplateOptionId = new Map(
        createdOptionSources
          .filter(
            (
              option,
            ): option is {
              createdOptionId: string;
              sourceTemplateOptionId: string;
            } => option.sourceTemplateOptionId !== undefined,
          )
          .map((option) => [
            option.sourceTemplateOptionId,
            option.createdOptionId,
          ]),
      );
      const questionInserts = templateQuestions
        .map((question) => {
          const registrationOptionId =
            createdOptionIdBySourceTemplateOptionId.get(
              question.registrationOptionId,
            );

          return registrationOptionId
            ? buildEventQuestionInsert({
                eventId: event.id,
                question,
                registrationOptionId,
              })
            : null;
        })
        .filter(
          (insert): insert is typeof eventRegistrationQuestions.$inferInsert =>
            insert !== null,
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
