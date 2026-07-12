import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { type Permission } from '@shared/permissions/permissions';
import {
  type PlatformAuditSnapshot,
  type PlatformTenantAuditAction,
} from '@shared/platform-audit';
import {
  isWritableRegistrationMode,
  requireWritableRegistrationMode,
} from '@shared/registration-modes';
import {
  PlatformEventAddonRecord,
  type PlatformEventDetailRecord,
  PlatformEventQuestionRecord,
  PlatformEventRegistrationOptionRecord,
  type PlatformEventsCreateInput,
  type PlatformEventsReviewInput,
  type PlatformEventsUpdateInput,
  type PlatformEventsUpdateListingInput,
} from '@shared/rpc-contracts/app-rpcs/platform-events.rpcs';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { DateTime, Effect, Schema } from 'effect';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventInstances,
  eventRegistrationAddonPurchases,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestionAnswers,
  eventRegistrationQuestions,
  eventRegistrations,
  eventTemplates,
  roles,
  tenantStripeTaxRates,
  users,
  usersToTenants,
} from '../../../../../db/schema';
import {
  ensureStripeForPaidEventConfiguration,
  ensureStripeForStoredEventConfiguration,
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
import {
  createEventGraph,
  EventCreationAttribution,
} from '../events/events-lifecycle.handlers';
import {
  providePlatformOperation,
  resolvePlatformMutation,
  resolvePlatformRead,
  writePlatformAudit,
} from '../shared/platform-operation.service';
import { loadTemplateGraphDetail } from '../templates/template-graph.query';

type DatabaseReader = Pick<DatabaseClient, 'select'>;
type PlatformEventAddonMapping =
  PlatformEventDetailRecord['addOns'][number]['registrationOptions'][number];

interface PlatformEventMutationTarget {
  readonly eventId: string;
  readonly reason: string;
  readonly targetTenantId: string;
}

const hasSimplePlatformEventShape = (
  options: readonly { organizingRegistration: boolean }[],
): boolean =>
  options.length === 2 &&
  options.filter((option) => option.organizingRegistration).length === 1;

export const platformEventGraphCompatibilityError = ({
  before,
  input,
}: {
  before: Pick<PlatformEventDetailRecord, 'simpleModeEnabled'>;
  input: Pick<PlatformEventsUpdateInput, 'addOns' | 'registrationOptions'>;
}): null | RpcBadRequestError => {
  if (
    before.simpleModeEnabled &&
    !hasSimplePlatformEventShape(input.registrationOptions)
  ) {
    return new RpcBadRequestError({
      message:
        'Simple event configuration requires exactly one organizing and one non-organizing registration option',
      reason: 'simpleEventGraphRequiresTwoOptions',
    });
  }

  if (input.addOns.some((addOn) => addOn.isPaid && addOn.price <= 0)) {
    return new RpcBadRequestError({
      message: 'Paid event add-ons require a positive price',
      reason: 'paidEventAddonRequiresPositivePrice',
    });
  }

  return null;
};

export const planPlatformEventAddonMappingChanges = (
  existing: readonly PlatformEventAddonMapping[],
  submitted: readonly PlatformEventAddonMapping[],
): {
  added: PlatformEventAddonMapping[];
  removed: PlatformEventAddonMapping[];
  retained: PlatformEventAddonMapping[];
} => {
  const existingOptionIds = new Set(
    existing.map((mapping) => mapping.registrationOptionId),
  );
  const submittedOptionIds = new Set(
    submitted.map((mapping) => mapping.registrationOptionId),
  );

  return {
    added: submitted.filter(
      (mapping) => !existingOptionIds.has(mapping.registrationOptionId),
    ),
    removed: existing.filter(
      (mapping) => !submittedOptionIds.has(mapping.registrationOptionId),
    ),
    retained: submitted.filter((mapping) =>
      existingOptionIds.has(mapping.registrationOptionId),
    ),
  };
};

export const platformEventAddonMappingRemovalError = (
  hasPurchases: boolean,
): null | RpcBadRequestError =>
  hasPurchases
    ? new RpcBadRequestError({
        message: 'Purchased add-on mappings cannot be removed',
        reason: 'eventAddonMappingInUse',
      })
    : null;

const PlatformEventAuditState = Schema.Struct({
  addOns: Schema.Array(PlatformEventAddonRecord),
  creatorId: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  end: Schema.NonEmptyString,
  iconColor: Schema.Number,
  iconName: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  locationName: Schema.NullOr(Schema.String),
  questions: Schema.Array(PlatformEventQuestionRecord),
  registrationCount: Schema.Number,
  registrationOptions: Schema.Array(PlatformEventRegistrationOptionRecord),
  reviewedAt: Schema.NullOr(Schema.NonEmptyString),
  simpleModeEnabled: Schema.Boolean,
  start: Schema.NonEmptyString,
  status: Schema.Literals(['APPROVED', 'DRAFT', 'PENDING_REVIEW']),
  statusComment: Schema.NullOr(Schema.String),
  title: Schema.NonEmptyString,
  unlisted: Schema.Boolean,
});

const databaseEffect = <A, R>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, R>,
): Effect.Effect<A, RpcBadRequestError, Database | R> =>
  Database.use((database) =>
    operation(database).pipe(
      Effect.catch((error) =>
        error instanceof RpcBadRequestError
          ? Effect.fail(error)
          : Effect.die(error),
      ),
    ),
  );

const eventNotFound = (eventId: string) =>
  new RpcBadRequestError({
    message: `Event ${eventId} was not found for the target tenant`,
    reason: 'eventNotFound',
  });

export const loadPlatformEventDetail = Effect.fn(
  'PlatformEvents.loadPlatformEventDetail',
)(function* (
  database: DatabaseReader,
  targetTenantId: string,
  eventId: string,
) {
  const eventRows = yield* database
    .select({
      creatorEmail: users.email,
      creatorFirstName: users.firstName,
      creatorId: users.id,
      creatorLastName: users.lastName,
      description: eventInstances.description,
      end: eventInstances.end,
      icon: eventInstances.icon,
      id: eventInstances.id,
      location: eventInstances.location,
      reviewedAt: eventInstances.reviewedAt,
      simpleModeEnabled: eventInstances.simpleModeEnabled,
      start: eventInstances.start,
      status: eventInstances.status,
      statusComment: eventInstances.statusComment,
      title: eventInstances.title,
      unlisted: eventInstances.unlisted,
    })
    .from(eventInstances)
    .innerJoin(users, eq(users.id, eventInstances.creatorId))
    .where(
      and(
        eq(eventInstances.id, eventId),
        eq(eventInstances.tenantId, targetTenantId),
      ),
    )
    .limit(1)
    .pipe(Effect.orDie);
  const event = eventRows[0];
  if (!event) {
    return yield* Effect.fail(eventNotFound(eventId));
  }

  const registrationOptions = yield* database
    .select({
      cancellationDeadlineHoursBeforeStart:
        eventRegistrationOptions.cancellationDeadlineHoursBeforeStart,
      checkedInSpots: eventRegistrationOptions.checkedInSpots,
      closeRegistrationTime: eventRegistrationOptions.closeRegistrationTime,
      confirmedSpots: eventRegistrationOptions.confirmedSpots,
      description: eventRegistrationOptions.description,
      id: eventRegistrationOptions.id,
      isPaid: eventRegistrationOptions.isPaid,
      openRegistrationTime: eventRegistrationOptions.openRegistrationTime,
      organizingRegistration: eventRegistrationOptions.organizingRegistration,
      price: eventRegistrationOptions.price,
      refundFeesOnCancellation:
        eventRegistrationOptions.refundFeesOnCancellation,
      registeredDescription: eventRegistrationOptions.registeredDescription,
      registrationMode: eventRegistrationOptions.registrationMode,
      roleIds: eventRegistrationOptions.roleIds,
      spots: eventRegistrationOptions.spots,
      stripeTaxRateId: eventRegistrationOptions.stripeTaxRateId,
      title: eventRegistrationOptions.title,
      transferDeadlineHoursBeforeStart:
        eventRegistrationOptions.transferDeadlineHoursBeforeStart,
    })
    .from(eventRegistrationOptions)
    .innerJoin(
      eventInstances,
      eq(eventInstances.id, eventRegistrationOptions.eventId),
    )
    .where(
      and(
        eq(eventInstances.id, eventId),
        eq(eventInstances.tenantId, targetTenantId),
      ),
    )
    .pipe(Effect.orDie);
  const registrationOptionIds = registrationOptions.map((option) => option.id);
  const optionDiscounts =
    registrationOptionIds.length === 0
      ? []
      : yield* database
          .select({
            discountedPrice: eventRegistrationOptionDiscounts.discountedPrice,
            registrationOptionId:
              eventRegistrationOptionDiscounts.registrationOptionId,
          })
          .from(eventRegistrationOptionDiscounts)
          .innerJoin(
            eventRegistrationOptions,
            eq(
              eventRegistrationOptions.id,
              eventRegistrationOptionDiscounts.registrationOptionId,
            ),
          )
          .innerJoin(
            eventInstances,
            eq(eventInstances.id, eventRegistrationOptions.eventId),
          )
          .where(
            and(
              eq(eventInstances.id, eventId),
              eq(eventInstances.tenantId, targetTenantId),
              eq(eventRegistrationOptionDiscounts.discountType, 'esnCard'),
              inArray(
                eventRegistrationOptionDiscounts.registrationOptionId,
                registrationOptionIds,
              ),
            ),
          )
          .pipe(Effect.orDie);
  const discountByOptionId = new Map(
    optionDiscounts.map((discount) => [
      discount.registrationOptionId,
      discount.discountedPrice,
    ]),
  );
  const questions = yield* database
    .select({
      description: eventRegistrationQuestions.description,
      id: eventRegistrationQuestions.id,
      registrationOptionId: eventRegistrationQuestions.registrationOptionId,
      required: eventRegistrationQuestions.required,
      sortOrder: eventRegistrationQuestions.sortOrder,
      title: eventRegistrationQuestions.title,
    })
    .from(eventRegistrationQuestions)
    .innerJoin(
      eventInstances,
      eq(eventInstances.id, eventRegistrationQuestions.eventId),
    )
    .where(
      and(
        eq(eventInstances.id, eventId),
        eq(eventInstances.tenantId, targetTenantId),
      ),
    )
    .orderBy(asc(eventRegistrationQuestions.sortOrder))
    .pipe(Effect.orDie);
  const addOns = yield* database
    .select({
      allowMultiple: eventAddons.allowMultiple,
      allowPurchaseBeforeEvent: eventAddons.allowPurchaseBeforeEvent,
      allowPurchaseDuringEvent: eventAddons.allowPurchaseDuringEvent,
      allowPurchaseDuringRegistration:
        eventAddons.allowPurchaseDuringRegistration,
      description: eventAddons.description,
      id: eventAddons.id,
      isPaid: eventAddons.isPaid,
      maxQuantityPerUser: eventAddons.maxQuantityPerUser,
      price: eventAddons.price,
      stripeTaxRateId: eventAddons.stripeTaxRateId,
      title: eventAddons.title,
      totalAvailableQuantity: eventAddons.totalAvailableQuantity,
    })
    .from(eventAddons)
    .innerJoin(eventInstances, eq(eventInstances.id, eventAddons.eventId))
    .where(
      and(
        eq(eventInstances.id, eventId),
        eq(eventInstances.tenantId, targetTenantId),
      ),
    )
    .orderBy(asc(eventAddons.createdAt))
    .pipe(Effect.orDie);
  const addOnIds = addOns.map((addOn) => addOn.id);
  const addOnRegistrationOptions =
    addOnIds.length === 0
      ? []
      : yield* database
          .select({
            addonId: addonToEventRegistrationOptions.addonId,
            includedQuantity: addonToEventRegistrationOptions.includedQuantity,
            optionalPurchaseQuantity:
              addonToEventRegistrationOptions.optionalPurchaseQuantity,
            registrationOptionId:
              addonToEventRegistrationOptions.registrationOptionId,
          })
          .from(addonToEventRegistrationOptions)
          .innerJoin(
            eventAddons,
            eq(eventAddons.id, addonToEventRegistrationOptions.addonId),
          )
          .innerJoin(eventInstances, eq(eventInstances.id, eventAddons.eventId))
          .where(
            and(
              eq(eventInstances.id, eventId),
              eq(eventInstances.tenantId, targetTenantId),
              inArray(addonToEventRegistrationOptions.addonId, addOnIds),
            ),
          )
          .pipe(Effect.orDie);
  const addOnOptionsById = new Map<
    string,
    {
      includedQuantity: number;
      optionalPurchaseQuantity: number;
      registrationOptionId: string;
    }[]
  >();
  for (const option of addOnRegistrationOptions) {
    const current = addOnOptionsById.get(option.addonId) ?? [];
    current.push({
      includedQuantity: option.includedQuantity,
      optionalPurchaseQuantity: option.optionalPurchaseQuantity,
      registrationOptionId: option.registrationOptionId,
    });
    addOnOptionsById.set(option.addonId, current);
  }
  const registrationCounts = yield* database
    .select({ total: count() })
    .from(eventRegistrations)
    .innerJoin(
      eventInstances,
      eq(eventInstances.id, eventRegistrations.eventId),
    )
    .where(
      and(
        eq(eventInstances.id, eventId),
        eq(eventInstances.tenantId, targetTenantId),
        eq(eventRegistrations.tenantId, targetTenantId),
      ),
    )
    .pipe(Effect.orDie);

  return {
    addOns: addOns.map((addOn) => ({
      ...addOn,
      description: addOn.description ?? null,
      registrationOptions: addOnOptionsById.get(addOn.id) ?? [],
      stripeTaxRateId: addOn.stripeTaxRateId ?? null,
    })),
    creator: {
      email: event.creatorEmail,
      firstName: event.creatorFirstName,
      id: event.creatorId,
      lastName: event.creatorLastName,
    },
    description: event.description,
    end: event.end.toISOString(),
    icon: event.icon,
    id: event.id,
    location: event.location ?? null,
    questions: questions.map((question) => ({
      ...question,
      description: question.description ?? null,
    })),
    registrationCount: registrationCounts[0]?.total ?? 0,
    registrationOptions: registrationOptions.map((option) => ({
      ...option,
      closeRegistrationTime: option.closeRegistrationTime.toISOString(),
      description: option.description ?? null,
      esnCardDiscountedPrice: discountByOptionId.get(option.id) ?? null,
      openRegistrationTime: option.openRegistrationTime.toISOString(),
      registeredDescription: option.registeredDescription ?? null,
      stripeTaxRateId: option.stripeTaxRateId ?? null,
    })),
    reviewedAt: event.reviewedAt?.toISOString() ?? null,
    simpleModeEnabled: event.simpleModeEnabled,
    start: event.start.toISOString(),
    status: event.status,
    statusComment: event.statusComment ?? null,
    title: event.title,
    unlisted: event.unlisted,
  } satisfies PlatformEventDetailRecord;
});

export const platformEventAuditSnapshot = (
  event: PlatformEventDetailRecord,
): PlatformAuditSnapshot => ({
  resourceId: event.id,
  resourceType: 'event',
  state: Schema.decodeUnknownSync(PlatformEventAuditState)({
    addOns: event.addOns,
    creatorId: event.creator.id,
    description: event.description,
    end: event.end,
    iconColor: event.icon.iconColor,
    iconName: event.icon.iconName,
    id: event.id,
    locationName: event.location?.name ?? null,
    questions: event.questions,
    registrationCount: event.registrationCount,
    registrationOptions: event.registrationOptions,
    reviewedAt: event.reviewedAt,
    simpleModeEnabled: event.simpleModeEnabled,
    start: event.start,
    status: event.status,
    statusComment: event.statusComment,
    title: event.title,
    unlisted: event.unlisted,
  }),
});

export const platformEventStateError = (
  actual: PlatformEventDetailRecord['status'],
  expected: PlatformEventDetailRecord['status'],
  message: string,
): null | RpcBadRequestError =>
  actual === expected
    ? null
    : new RpcBadRequestError({
        message,
        reason: 'eventStateConflict',
      });

export const platformUnsupportedRegistrationModeError = (
  registrationModes: readonly ('application' | 'fcfs' | 'random')[],
): null | RpcBadRequestError =>
  registrationModes.some((mode) => !isWritableRegistrationMode(mode))
    ? new RpcBadRequestError({
        message:
          'Random allocation is unsupported; replace it with first-come-first-served or manual approval',
        reason: 'unsupportedRegistrationMode',
      })
    : null;

export const validatePlatformEventCreateReferences = ({
  creatorMembershipFound,
  registrationModes,
  templateFound,
}: {
  creatorMembershipFound: boolean;
  registrationModes: readonly ('application' | 'fcfs' | 'random')[];
  templateFound: boolean;
}) => {
  if (!creatorMembershipFound) {
    return Effect.fail(
      new RpcBadRequestError({
        message: 'The selected creator is not a member of the target tenant',
        reason: 'creatorMembershipNotFound',
      }),
    );
  }
  if (!templateFound) {
    return Effect.fail(
      new RpcBadRequestError({
        message: 'Template not found for the target tenant',
        reason: 'templateNotFound',
      }),
    );
  }
  const modeError = platformUnsupportedRegistrationModeError(registrationModes);
  if (modeError) return Effect.fail(modeError);

  return Effect.void;
};

const updatePlatformEventGraph = Effect.fn(
  'PlatformEvents.updatePlatformEventGraph',
)(function* (
  database: DatabaseClient,
  input: PlatformEventsUpdateInput,
  before: PlatformEventDetailRecord,
  esnCardEnabled: boolean,
) {
  const compatibilityError = platformEventGraphCompatibilityError({
    before,
    input,
  });
  if (compatibilityError) return yield* Effect.fail(compatibilityError);

  const existingOptionIds = new Set(
    before.registrationOptions.map((option) => option.id),
  );
  const submittedOptionIds = new Set(
    input.registrationOptions.map((option) => option.id),
  );
  if (
    input.registrationOptions.length !== submittedOptionIds.size ||
    existingOptionIds.size !== submittedOptionIds.size ||
    [...existingOptionIds].some((id) => !submittedOptionIds.has(id))
  ) {
    return yield* Effect.fail(
      new RpcBadRequestError({
        message:
          'Platform event updates must preserve the registration-option identity set',
        reason: 'registrationOptionMismatch',
      }),
    );
  }

  yield* lockTenantRoleGraph(database, input.targetTenantId).pipe(Effect.orDie);
  const roleIds = input.registrationOptions.flatMap((option) => option.roleIds);
  const rolesExist = yield* tenantRoleIdsExist(
    database,
    input.targetTenantId,
    roleIds,
  ).pipe(Effect.orDie);
  if (!rolesExist) {
    return yield* Effect.fail(
      new RpcBadRequestError({
        message: 'Registration option role not found for the target tenant',
        reason: 'registrationRoleNotFound',
      }),
    );
  }

  for (const option of input.registrationOptions) {
    const openRegistrationTime = new Date(option.openRegistrationTime);
    const closeRegistrationTime = new Date(option.closeRegistrationTime);
    if (
      !option.title.trim() ||
      Number.isNaN(openRegistrationTime.getTime()) ||
      Number.isNaN(closeRegistrationTime.getTime()) ||
      closeRegistrationTime < openRegistrationTime ||
      !Number.isInteger(option.spots) ||
      option.spots < 0
    ) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'Registration option dates or capacity are invalid',
          reason: 'invalidRegistrationOption',
        }),
      );
    }
    const taxValidation = yield* validateTaxRate(database, {
      isPaid: option.isPaid,
      stripeTaxRateId: option.stripeTaxRateId,
      tenantId: input.targetTenantId,
    });
    if (!taxValidation.success) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'Registration option tax rate is invalid',
          reason: 'invalidRegistrationOptionTaxRate',
        }),
      );
    }
    if (
      option.esnCardDiscountedPrice !== null &&
      (!option.isPaid ||
        !esnCardEnabled ||
        option.esnCardDiscountedPrice > option.price)
    ) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'Registration option ESNcard discount is invalid',
          reason: 'invalidRegistrationOptionDiscount',
        }),
      );
    }

    yield* database
      .update(eventRegistrationOptions)
      .set({
        cancellationDeadlineHoursBeforeStart:
          option.cancellationDeadlineHoursBeforeStart,
        closeRegistrationTime,
        description: sanitizeOptionalRichTextHtml(option.description),
        isPaid: option.isPaid,
        openRegistrationTime,
        organizingRegistration: option.organizingRegistration,
        price: option.price,
        refundFeesOnCancellation: option.refundFeesOnCancellation,
        registeredDescription: sanitizeOptionalRichTextHtml(
          option.registeredDescription,
        ),
        registrationMode: option.registrationMode,
        roleIds: [...new Set(option.roleIds)],
        spots: option.spots,
        stripeTaxRateId: option.stripeTaxRateId,
        title: option.title.trim(),
        transferDeadlineHoursBeforeStart:
          option.transferDeadlineHoursBeforeStart,
      })
      .where(
        and(
          eq(eventRegistrationOptions.eventId, input.eventId),
          eq(eventRegistrationOptions.id, option.id),
        ),
      )
      .pipe(Effect.orDie);

    yield* database
      .delete(eventRegistrationOptionDiscounts)
      .where(
        and(
          eq(eventRegistrationOptionDiscounts.registrationOptionId, option.id),
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
          registrationOptionId: option.id,
        })
        .pipe(Effect.orDie);
    }
  }

  const existingAddOnIds = new Set(before.addOns.map((addOn) => addOn.id));
  const submittedExistingAddOnIds = new Set(
    input.addOns.flatMap((addOn) => (addOn.id ? [addOn.id] : [])),
  );
  const submittedAddOnIdCount = input.addOns.filter((addOn) => addOn.id).length;
  if (
    submittedExistingAddOnIds.size !== submittedAddOnIdCount ||
    [...submittedExistingAddOnIds].some((id) => !existingAddOnIds.has(id))
  ) {
    return yield* Effect.fail(
      new RpcBadRequestError({
        message: 'Event add-on does not belong to the target event',
        reason: 'eventAddonMismatch',
      }),
    );
  }
  const removedAddOnIds: string[] = [];
  for (const id of existingAddOnIds) {
    if (!submittedExistingAddOnIds.has(id)) removedAddOnIds.push(id);
  }
  if (removedAddOnIds.length > 0) {
    const purchases = yield* database
      .select({ id: eventRegistrationAddonPurchases.id })
      .from(eventRegistrationAddonPurchases)
      .innerJoin(
        eventAddons,
        eq(eventAddons.id, eventRegistrationAddonPurchases.addonId),
      )
      .innerJoin(eventInstances, eq(eventInstances.id, eventAddons.eventId))
      .where(
        and(
          eq(eventInstances.id, input.eventId),
          eq(eventInstances.tenantId, input.targetTenantId),
          inArray(eventRegistrationAddonPurchases.addonId, removedAddOnIds),
        ),
      )
      .limit(1)
      .pipe(Effect.orDie);
    if (purchases.length > 0) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'Purchased event add-ons cannot be removed',
          reason: 'eventAddonInUse',
        }),
      );
    }
    yield* database
      .delete(addonToEventRegistrationOptions)
      .where(inArray(addonToEventRegistrationOptions.addonId, removedAddOnIds))
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
    const mappedRegistrationOptionIds = addOn.registrationOptions.map(
      (option) => option.registrationOptionId,
    );
    if (
      !addOn.title.trim() ||
      (!addOn.allowPurchaseBeforeEvent &&
        !addOn.allowPurchaseDuringEvent &&
        !addOn.allowPurchaseDuringRegistration) ||
      addOn.registrationOptions.some(
        (option) => !existingOptionIds.has(option.registrationOptionId),
      ) ||
      new Set(mappedRegistrationOptionIds).size !==
        mappedRegistrationOptionIds.length
    ) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'Event add-on configuration is invalid',
          reason: 'invalidEventAddon',
        }),
      );
    }
    const taxValidation = yield* validateTaxRate(database, {
      isPaid: addOn.isPaid,
      stripeTaxRateId: addOn.stripeTaxRateId,
      tenantId: input.targetTenantId,
    });
    if (!taxValidation.success) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'Event add-on tax rate is invalid',
          reason: 'invalidEventAddonTaxRate',
        }),
      );
    }
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
    const addOnId = addOn.id
      ? yield* database
          .update(eventAddons)
          .set(values)
          .where(
            and(
              eq(eventAddons.eventId, input.eventId),
              eq(eventAddons.id, addOn.id),
            ),
          )
          .returning({ id: eventAddons.id })
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows[0]?.id),
          )
      : yield* database
          .insert(eventAddons)
          .values({ ...values, eventId: input.eventId })
          .returning({ id: eventAddons.id })
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows[0]?.id),
          );
    if (!addOnId) {
      return yield* Effect.die(new Error('Event add-on write returned no id'));
    }

    const existingMappings = addOn.id
      ? (before.addOns.find((existing) => existing.id === addOn.id)
          ?.registrationOptions ?? [])
      : [];
    const mappingChanges = planPlatformEventAddonMappingChanges(
      existingMappings,
      addOn.registrationOptions,
    );
    for (const removedMapping of mappingChanges.removed) {
      const purchases = yield* database
        .select({ id: eventRegistrationAddonPurchases.id })
        .from(eventRegistrationAddonPurchases)
        .where(
          and(
            eq(eventRegistrationAddonPurchases.eventId, input.eventId),
            eq(eventRegistrationAddonPurchases.tenantId, input.targetTenantId),
            eq(eventRegistrationAddonPurchases.addonId, addOnId),
            eq(
              eventRegistrationAddonPurchases.registrationOptionId,
              removedMapping.registrationOptionId,
            ),
          ),
        )
        .limit(1)
        .pipe(Effect.orDie);
      const removalError = platformEventAddonMappingRemovalError(
        purchases.length > 0,
      );
      if (removalError) return yield* Effect.fail(removalError);

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
    for (const mapping of mappingChanges.retained) {
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
    }
    if (mappingChanges.added.length > 0) {
      yield* database
        .insert(addonToEventRegistrationOptions)
        .values(
          mappingChanges.added.map((mapping) => ({
            addonId: addOnId,
            eventId: input.eventId,
            includedQuantity: mapping.includedQuantity,
            optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
            registrationOptionId: mapping.registrationOptionId,
          })),
        )
        .pipe(Effect.orDie);
    }
  }

  const existingQuestionIds = new Set(
    before.questions.map((question) => question.id),
  );
  const submittedExistingQuestionIds = new Set(
    input.questions.flatMap((question) => (question.id ? [question.id] : [])),
  );
  const submittedQuestionIdCount = input.questions.filter(
    (question) => question.id,
  ).length;
  if (
    submittedExistingQuestionIds.size !== submittedQuestionIdCount ||
    [...submittedExistingQuestionIds].some((id) => !existingQuestionIds.has(id))
  ) {
    return yield* Effect.fail(
      new RpcBadRequestError({
        message: 'Event question does not belong to the target event',
        reason: 'eventQuestionMismatch',
      }),
    );
  }
  const removedQuestionIds: string[] = [];
  for (const id of existingQuestionIds) {
    if (!submittedExistingQuestionIds.has(id)) removedQuestionIds.push(id);
  }
  if (removedQuestionIds.length > 0) {
    const answers = yield* database
      .select({ id: eventRegistrationQuestionAnswers.id })
      .from(eventRegistrationQuestionAnswers)
      .innerJoin(
        eventRegistrationQuestions,
        eq(
          eventRegistrationQuestions.id,
          eventRegistrationQuestionAnswers.questionId,
        ),
      )
      .innerJoin(
        eventInstances,
        eq(eventInstances.id, eventRegistrationQuestions.eventId),
      )
      .where(
        and(
          eq(eventInstances.id, input.eventId),
          eq(eventInstances.tenantId, input.targetTenantId),
          inArray(
            eventRegistrationQuestionAnswers.questionId,
            removedQuestionIds,
          ),
        ),
      )
      .limit(1)
      .pipe(Effect.orDie);
    if (answers.length > 0) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'Answered event questions cannot be removed',
          reason: 'eventQuestionInUse',
        }),
      );
    }
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
    if (
      !question.title.trim() ||
      !existingOptionIds.has(question.registrationOptionId) ||
      !Number.isInteger(question.sortOrder)
    ) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'Event registration question is invalid',
          reason: 'invalidEventQuestion',
        }),
      );
    }
    const values = {
      description: question.description?.trim() || null,
      registrationOptionId: question.registrationOptionId,
      required: question.required,
      sortOrder: question.sortOrder,
      title: question.title.trim(),
    };
    if (question.id) {
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
});

const runEventMutation = <A extends PlatformEventMutationTarget>(
  input: A,
  allowedPermission: Permission,
  action: PlatformTenantAuditAction,
  mutate: (
    database: DatabaseClient,
    before: PlatformEventDetailRecord,
    esnCardEnabled: boolean,
  ) => Effect.Effect<void, RpcBadRequestError>,
  beforeEventLock?: (
    database: DatabaseClient,
  ) => Effect.Effect<void, RpcBadRequestError>,
) =>
  Effect.gen(function* () {
    const operation = yield* resolvePlatformMutation(input);

    return yield* providePlatformOperation(
      databaseEffect((database) =>
        database.transaction((transaction) =>
          Effect.gen(function* () {
            const transactionalDatabase = Object.assign(transaction, {
              $client: database.$client,
            });
            if (beforeEventLock) {
              yield* beforeEventLock(transactionalDatabase);
            }
            const lockedEvents = yield* transaction
              .select({ id: eventInstances.id })
              .from(eventInstances)
              .where(
                and(
                  eq(eventInstances.id, input.eventId),
                  eq(eventInstances.tenantId, input.targetTenantId),
                ),
              )
              .for('update')
              .pipe(Effect.orDie);
            if (lockedEvents.length === 0) {
              return yield* Effect.fail(eventNotFound(input.eventId));
            }

            const before = yield* loadPlatformEventDetail(
              transactionalDatabase,
              input.targetTenantId,
              input.eventId,
            );
            yield* mutate(
              transactionalDatabase,
              before,
              operation.targetTenant.discountProviders?.esnCard?.status ===
                'enabled',
            );
            const after = yield* loadPlatformEventDetail(
              transactionalDatabase,
              input.targetTenantId,
              input.eventId,
            );
            yield* writePlatformAudit(transactionalDatabase, {
              action,
              after: platformEventAuditSnapshot(after),
              before: platformEventAuditSnapshot(before),
            });

            return after;
          }),
        ),
      ),
      operation,
      [allowedPermission],
    );
  });

export const platformEventHandlers = {
  'platform.events.create': (
    input: PlatformEventsCreateInput,
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformMutation(input);

      return yield* providePlatformOperation(
        databaseEffect((database) =>
          database.transaction((transaction) => {
            const transactionalDatabase = Object.assign(transaction, {
              $client: database.$client,
            });
            return Effect.gen(function* () {
              yield* lockTenantStripeAccount(
                transaction,
                input.targetTenantId,
              ).pipe(Effect.orDie);
              yield* lockTenantRoleGraph(
                transaction,
                input.targetTenantId,
              ).pipe(Effect.orDie);
              const creatorMemberships = yield* transaction
                .select({ id: users.id })
                .from(usersToTenants)
                .innerJoin(users, eq(users.id, usersToTenants.userId))
                .where(
                  and(
                    eq(usersToTenants.tenantId, input.targetTenantId),
                    eq(usersToTenants.userId, input.creatorUserId),
                  ),
                )
                .for('share')
                .pipe(Effect.orDie);
              if (creatorMemberships.length === 0) {
                yield* validatePlatformEventCreateReferences({
                  creatorMembershipFound: false,
                  registrationModes: [],
                  templateFound: true,
                });
                return yield* Effect.die(
                  new Error(
                    'Missing creator membership validation unexpectedly succeeded',
                  ),
                );
              }

              const lockedTemplates = yield* transaction
                .select({ id: eventTemplates.id })
                .from(eventTemplates)
                .where(
                  and(
                    eq(eventTemplates.id, input.templateId),
                    eq(eventTemplates.tenantId, input.targetTenantId),
                  ),
                )
                .for('share')
                .pipe(Effect.orDie);
              if (lockedTemplates.length === 0) {
                yield* validatePlatformEventCreateReferences({
                  creatorMembershipFound: true,
                  registrationModes: [],
                  templateFound: false,
                });
                return yield* Effect.die(
                  new Error(
                    'Missing event template validation unexpectedly succeeded',
                  ),
                );
              }

              const template = yield* loadTemplateGraphDetail(
                transaction,
                input.targetTenantId,
                input.templateId,
              );
              yield* validatePlatformEventCreateReferences({
                creatorMembershipFound: true,
                registrationModes: template.registrationOptions.map(
                  (option) => option.registrationMode,
                ),
                templateFound: true,
              });

              const start = new Date(input.start);
              const end = new Date(input.end);
              if (
                Number.isNaN(start.getTime()) ||
                Number.isNaN(end.getTime()) ||
                end <= start
              ) {
                return yield* Effect.fail(
                  new RpcBadRequestError({
                    message: 'Event end must be after its start',
                    reason: 'invalidDates',
                  }),
                );
              }
              const registrationOptions = template.registrationOptions.map(
                (option) => ({
                  cancellationDeadlineHoursBeforeStart:
                    option.cancellationDeadlineHoursBeforeStart,
                  closeRegistrationTime: new Date(
                    start.getTime() -
                      option.closeRegistrationOffset * 60 * 60 * 1000,
                  ).toISOString(),
                  description: option.description,
                  isPaid: option.isPaid,
                  openRegistrationTime: new Date(
                    start.getTime() -
                      option.openRegistrationOffset * 60 * 60 * 1000,
                  ).toISOString(),
                  organizingRegistration: option.organizingRegistration,
                  price: option.price,
                  refundFeesOnCancellation: option.refundFeesOnCancellation,
                  registeredDescription: option.registeredDescription,
                  registrationMode: requireWritableRegistrationMode(
                    option.registrationMode,
                  ),
                  roleIds: option.roleIds,
                  sourceTemplateRegistrationOptionId: option.id,
                  spots: option.spots,
                  stripeTaxRateId: option.stripeTaxRateId,
                  title: option.title,
                  transferDeadlineHoursBeforeStart:
                    option.transferDeadlineHoursBeforeStart,
                }),
              );
              const created = yield* createEventGraph({
                description: input.description,
                end: input.end,
                icon: template.icon,
                location: template.location,
                registrationOptions,
                start: input.start,
                templateId: input.templateId,
                title: input.title,
              }).pipe(
                Effect.provideService(Database, transactionalDatabase),
                Effect.provideService(
                  EventCreationAttribution,
                  EventCreationAttribution.of({
                    creatorUserId: input.creatorUserId,
                    targetTenantId: input.targetTenantId,
                  }),
                ),
              );
              const after = yield* loadPlatformEventDetail(
                transaction,
                input.targetTenantId,
                created.id,
              );
              yield* writePlatformAudit(transaction, {
                action: 'event.create',
                after: platformEventAuditSnapshot(after),
                before: null,
              });
              return after;
            });
          }),
        ),
        operation,
        ['events:create'],
      );
    }),
  'platform.events.findOne': (
    input: { eventId: string; targetTenantId: string },
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformRead(input.targetTenantId);
      return yield* providePlatformOperation(
        databaseEffect((database) =>
          loadPlatformEventDetail(
            database,
            input.targetTenantId,
            input.eventId,
          ),
        ),
        operation,
        [],
      );
    }),
  'platform.events.formOptions': (
    input: { targetTenantId: string },
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformRead(input.targetTenantId);
      return yield* providePlatformOperation(
        databaseEffect((database) =>
          Effect.all({
            creators: database
              .select({
                email: users.email,
                firstName: users.firstName,
                id: users.id,
                lastName: users.lastName,
              })
              .from(usersToTenants)
              .innerJoin(users, eq(users.id, usersToTenants.userId))
              .where(eq(usersToTenants.tenantId, input.targetTenantId))
              .orderBy(asc(users.lastName), asc(users.firstName)),
            esnCardEnabled: Effect.succeed(
              operation.targetTenant.discountProviders?.esnCard?.status ===
                'enabled',
            ),
            roles: database
              .select({ id: roles.id, name: roles.name })
              .from(roles)
              .where(eq(roles.tenantId, input.targetTenantId))
              .orderBy(asc(roles.sortOrder), asc(roles.name)),
            taxRates: database
              .select({
                displayName: tenantStripeTaxRates.displayName,
                percentage: tenantStripeTaxRates.percentage,
                stripeTaxRateId: tenantStripeTaxRates.stripeTaxRateId,
              })
              .from(tenantStripeTaxRates)
              .where(
                and(
                  eq(tenantStripeTaxRates.tenantId, input.targetTenantId),
                  eq(
                    tenantStripeTaxRates.stripeAccountId,
                    operation.targetTenant.stripeAccountId ?? '',
                  ),
                  eq(tenantStripeTaxRates.active, true),
                  eq(tenantStripeTaxRates.inclusive, true),
                ),
              )
              .orderBy(
                asc(tenantStripeTaxRates.displayName),
                asc(tenantStripeTaxRates.stripeTaxRateId),
              ),
            templates: database
              .select({ id: eventTemplates.id, title: eventTemplates.title })
              .from(eventTemplates)
              .where(eq(eventTemplates.tenantId, input.targetTenantId))
              .orderBy(asc(eventTemplates.title)),
          }),
        ),
        operation,
        [],
      );
    }),
  'platform.events.list': (
    input: { targetTenantId: string },
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformRead(input.targetTenantId);
      return yield* providePlatformOperation(
        databaseEffect((database) =>
          database
            .select({
              end: eventInstances.end,
              id: eventInstances.id,
              start: eventInstances.start,
              status: eventInstances.status,
              title: eventInstances.title,
              unlisted: eventInstances.unlisted,
            })
            .from(eventInstances)
            .where(eq(eventInstances.tenantId, input.targetTenantId))
            .orderBy(desc(eventInstances.start))
            .pipe(
              Effect.map((events) =>
                events.map((event) => ({
                  ...event,
                  end: event.end.toISOString(),
                  start: event.start.toISOString(),
                })),
              ),
            ),
        ),
        operation,
        [],
      );
    }),
  'platform.events.review': (
    input: PlatformEventsReviewInput,
    _options: unknown,
  ) => {
    const comment = input.comment?.trim() || null;
    if (!input.approved && !comment) {
      return Effect.fail(
        new RpcBadRequestError({
          message: 'Feedback is required when returning an event to draft',
          reason: 'reviewFeedbackRequired',
        }),
      );
    }

    return runEventMutation(
      input,
      'events:review',
      'event.review',
      (database, before) => {
        const stateError = platformEventStateError(
          before.status,
          'PENDING_REVIEW',
          'Only pending events can be reviewed',
        );
        if (stateError) {
          return Effect.fail(stateError);
        }

        return Effect.gen(function* () {
          const reviewedAt = yield* DateTime.nowAsDate;
          const updatedEvents = yield* database
            .update(eventInstances)
            .set({
              reviewedAt,
              reviewedBy: null,
              status: input.approved ? 'APPROVED' : 'DRAFT',
              statusComment: comment,
            })
            .where(
              and(
                eq(eventInstances.id, input.eventId),
                eq(eventInstances.tenantId, input.targetTenantId),
                eq(eventInstances.status, 'PENDING_REVIEW'),
              ),
            )
            .returning({ id: eventInstances.id })
            .pipe(Effect.orDie);
          if (updatedEvents.length === 0) {
            return yield* Effect.fail(
              new RpcBadRequestError({
                message: 'Event review preconditions changed',
                reason: 'eventStateConflict',
              }),
            );
          }
        });
      },
      input.approved
        ? (database) =>
            ensureStripeForStoredEventConfiguration(
              database,
              input.targetTenantId,
              input.eventId,
            )
        : undefined,
    );
  },
  'platform.events.submitForReview': (
    input: PlatformEventMutationTarget,
    _options: unknown,
  ) =>
    runEventMutation(
      input,
      'events:editAll',
      'event.submitForReview',
      (database, before) => {
        const stateError = platformEventStateError(
          before.status,
          'DRAFT',
          'Only draft events can be submitted for review',
        );
        if (stateError) {
          return Effect.fail(stateError);
        }

        return database
          .update(eventInstances)
          .set({
            reviewedAt: null,
            reviewedBy: null,
            status: 'PENDING_REVIEW',
            statusComment: null,
          })
          .where(
            and(
              eq(eventInstances.id, input.eventId),
              eq(eventInstances.tenantId, input.targetTenantId),
              eq(eventInstances.status, 'DRAFT'),
            ),
          )
          .returning({ id: eventInstances.id })
          .pipe(
            Effect.orDie,
            Effect.flatMap((updatedEvents) =>
              updatedEvents.length > 0
                ? Effect.void
                : Effect.fail(
                    new RpcBadRequestError({
                      message: 'Event review submission preconditions changed',
                      reason: 'eventStateConflict',
                    }),
                  ),
            ),
          );
      },
    ),
  'platform.events.update': (
    input: PlatformEventsUpdateInput,
    _options: unknown,
  ) => {
    const modeError = platformUnsupportedRegistrationModeError(
      input.registrationOptions.map((option) => option.registrationMode),
    );
    if (modeError) return Effect.fail(modeError);
    const title = input.title.trim();
    const start = new Date(input.start);
    const end = new Date(input.end);
    const sanitizedDescription = sanitizeRichTextHtml(input.description);
    if (!title) {
      return Effect.fail(
        new RpcBadRequestError({
          message: 'Event title is required',
          reason: 'eventTitleRequired',
        }),
      );
    }
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      return Effect.fail(
        new RpcBadRequestError({
          message: 'Event end must be after its start',
          reason: 'invalidDates',
        }),
      );
    }
    if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
      return Effect.fail(
        new RpcBadRequestError({
          message: 'Event description is required',
          reason: 'invalidDescription',
        }),
      );
    }

    return runEventMutation(
      input,
      'events:editAll',
      'event.update',
      (database, before, esnCardEnabled) => {
        const stateError = platformEventStateError(
          before.status,
          'DRAFT',
          'Only draft events can be updated',
        );
        if (stateError) {
          return Effect.fail(stateError);
        }

        return Effect.gen(function* () {
          const updatedEvents = yield* database
            .update(eventInstances)
            .set({
              description: sanitizedDescription,
              end,
              icon: input.icon,
              location: input.location,
              start,
              title,
            })
            .where(
              and(
                eq(eventInstances.id, input.eventId),
                eq(eventInstances.tenantId, input.targetTenantId),
                eq(eventInstances.status, 'DRAFT'),
              ),
            )
            .returning({ id: eventInstances.id })
            .pipe(Effect.orDie);
          if (updatedEvents.length === 0) {
            return yield* Effect.fail(
              new RpcBadRequestError({
                message: 'Event update preconditions changed',
                reason: 'eventStateConflict',
              }),
            );
          }
          yield* updatePlatformEventGraph(
            database,
            input,
            before,
            esnCardEnabled,
          );
        });
      },
      (database) =>
        ensureStripeForPaidEventConfiguration(database, input.targetTenantId, {
          addOns: input.addOns,
          registrationOptions: input.registrationOptions,
        }),
    );
  },
  'platform.events.updateListing': (
    input: PlatformEventsUpdateListingInput,
    _options: unknown,
  ) =>
    runEventMutation(
      input,
      'events:changeListing',
      'event.updateListing',
      (database) =>
        database
          .update(eventInstances)
          .set({ unlisted: input.unlisted })
          .where(
            and(
              eq(eventInstances.id, input.eventId),
              eq(eventInstances.tenantId, input.targetTenantId),
            ),
          )
          .returning({ id: eventInstances.id })
          .pipe(
            Effect.orDie,
            Effect.flatMap((updatedEvents) =>
              updatedEvents.length > 0
                ? Effect.void
                : Effect.fail(eventNotFound(input.eventId)),
            ),
          ),
    ),
};
