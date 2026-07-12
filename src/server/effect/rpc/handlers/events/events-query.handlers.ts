import { RpcForbiddenError } from '@shared/errors/rpc-errors';
import {
  includesPermission,
  type Permission,
} from '@shared/permissions/permissions';
import {
  EventConflictError,
  EventNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import {
  and,
  arrayOverlaps,
  asc,
  eq,
  exists,
  gt,
  inArray,
  not,
  or,
  sql,
} from 'drizzle-orm';
import { Effect } from 'effect';
import { groupBy } from 'es-toolkit';
import { DateTime } from 'luxon';

import type { AppRpcHandlers } from '../shared/handler-types';

import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestions,
  eventRegistrations,
  tenantStripeTaxRates,
} from '../../../../../db/schema';
import { RpcAccess } from '../shared/rpc-access.service';
import { loadEventGraphDetail } from './event-graph.loader';
import {
  canEditEvent,
  databaseEffect,
  getEsnCardDiscountedPriceByOptionId,
  isEsnCardEnabled,
} from './events.shared';

export const eventOrganizeCapabilities = ({
  confirmedOrganizerRegistration,
  permissions,
}: {
  confirmedOrganizerRegistration: boolean;
  permissions: readonly Permission[];
}) => {
  const canManageRegistrations =
    includesPermission('events:organizeAll', permissions) ||
    confirmedOrganizerRegistration;

  return {
    canApproveRegistrations: canManageRegistrations,
    canCancelRegistrations:
      canManageRegistrations &&
      includesPermission('events:cancelRegistrations', permissions),
    canTransferRegistrations: canManageRegistrations,
    canViewOverview:
      canManageRegistrations ||
      includesPermission('finance:manageReceipts', permissions),
  };
};

export const organizeOverviewAccessAllowed = (input: {
  confirmedOrganizerRegistration: boolean;
  permissions: readonly Permission[];
}): boolean => eventOrganizeCapabilities(input).canViewOverview;

const canOrganizeEvent = Effect.fn('Events.canOrganizeEvent')(function* ({
  eventId,
  permissions,
  tenantId,
  userId,
}: {
  eventId: string;
  permissions: readonly Permission[];
  tenantId: string;
  userId: string;
}) {
  if (
    organizeOverviewAccessAllowed({
      confirmedOrganizerRegistration: false,
      permissions,
    })
  ) {
    return true;
  }

  const registrations = yield* databaseEffect((database) =>
    database
      .select({
        id: eventRegistrations.id,
      })
      .from(eventRegistrations)
      .innerJoin(
        eventRegistrationOptions,
        eq(
          eventRegistrations.registrationOptionId,
          eventRegistrationOptions.id,
        ),
      )
      .where(
        and(
          eq(eventRegistrations.tenantId, tenantId),
          eq(eventRegistrations.eventId, eventId),
          eq(eventRegistrations.userId, userId),
          eq(eventRegistrations.status, 'CONFIRMED'),
          eq(eventRegistrationOptions.organizingRegistration, true),
        ),
      )
      .limit(1),
  );

  return organizeOverviewAccessAllowed({
    confirmedOrganizerRegistration: registrations.length > 0,
    permissions,
  });
});

export const organizerRegistrationApprovalState = ({
  registrationMode,
  registrationStatus,
  transactions,
}: {
  registrationMode: 'application' | 'fcfs' | 'random';
  registrationStatus: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
  transactions: readonly {
    status: string;
    stripeCheckoutSessionId: null | string;
    type: string;
  }[];
}) => {
  const pendingRegistrationPayment = transactions.find(
    (transaction) =>
      transaction.type === 'registration' && transaction.status === 'pending',
  );
  const paymentSetupRequired =
    pendingRegistrationPayment?.stripeCheckoutSessionId === null;

  return {
    manualApprovalAvailable:
      registrationStatus === 'PENDING' &&
      registrationMode === 'application' &&
      (!pendingRegistrationPayment || paymentSetupRequired),
    paymentPending: pendingRegistrationPayment !== undefined,
    paymentSetupRequired,
  };
};

const canInspectTenantEvents = (permissions: readonly Permission[]): boolean =>
  includesPermission('globalAdmin:manageTenants', permissions);

export const groupEventsByTenantDay = <EventRecord extends { start: string }>(
  events: readonly EventRecord[],
  timezone: string,
): { day: string; events: EventRecord[] }[] => {
  const groupedEvents = new Map<
    string,
    { day: string; events: EventRecord[] }
  >();

  for (const event of events) {
    const tenantStart = DateTime.fromISO(event.start, { zone: timezone });
    const dayKey = tenantStart.toISODate();
    if (!tenantStart.isValid || dayKey === null) {
      throw new Error(`Invalid event start instant: ${event.start}`);
    }

    const currentGroup = groupedEvents.get(dayKey);
    if (currentGroup) {
      currentGroup.events.push(event);
      continue;
    }

    groupedEvents.set(dayKey, {
      day: tenantStart.startOf('day').toJSDate().toISOString(),
      events: [event],
    });
  }

  return [...groupedEvents.values()];
};

export const eventQueryHandlers = {
  'events.canOrganize': ({ eventId }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();

      return yield* canOrganizeEvent({
        eventId,
        permissions: user.permissions,
        tenantId: tenant.id,
        userId: user.id,
      });
    }),
  'events.eventList': (input, _options) =>
    Effect.gen(function* () {
      const { tenant } = yield* RpcAccess.current();
      const { user } = yield* RpcAccess.current();
      const userPermissions = user?.permissions ?? [];
      const canInspectAllTenantEvents = canInspectTenantEvents(userPermissions);

      if (user?.id !== input.userId) {
        yield* Effect.logWarning(
          'Supplied query parameter userId does not match authenticated user',
        ).pipe(
          Effect.annotateLogs({
            actualUserId: user?.id ?? null,
            suppliedUserId: input.userId,
          }),
        );
      }

      const isOnlyApprovedStatus =
        input.status.length === 1 && input.status[0] === 'APPROVED';
      if (
        !isOnlyApprovedStatus &&
        !canInspectAllTenantEvents &&
        !includesPermission('events:seeDrafts', userPermissions)
      ) {
        return yield* Effect.fail(
          new RpcForbiddenError({
            message: 'Forbidden',
            permission: 'events:seeDrafts',
          }),
        );
      }

      if (
        input.includeUnlisted &&
        !canInspectAllTenantEvents &&
        !includesPermission('events:seeUnlisted', userPermissions)
      ) {
        return yield* Effect.fail(
          new RpcForbiddenError({
            message: 'Forbidden',
            permission: 'events:seeUnlisted',
          }),
        );
      }

      const rolesToFilterBy = canInspectAllTenantEvents
        ? []
        : (user?.roleIds ??
          (yield* databaseEffect((database) =>
            database.query.roles
              .findMany({
                columns: { id: true },
                where: {
                  defaultUserRole: true,
                  tenantId: tenant.id,
                },
              })
              .pipe(
                Effect.map((roleRecords) => roleRecords.map((role) => role.id)),
              ),
          )));
      const roleFilters =
        rolesToFilterBy.length > 0 ? [...rolesToFilterBy] : [''];
      const startAfter = new Date(input.startAfter);

      const selectedEvents = yield* databaseEffect((database) =>
        database
          .select({
            creatorId: eventInstances.creatorId,
            icon: eventInstances.icon,
            id: eventInstances.id,
            start: eventInstances.start,
            status: eventInstances.status,
            title: eventInstances.title,
            unlisted: eventInstances.unlisted,
            userRegistered: exists(
              database
                .select()
                .from(eventRegistrations)
                .where(
                  and(
                    eq(eventRegistrations.eventId, eventInstances.id),
                    eq(eventRegistrations.userId, user?.id ?? ''),
                    not(eq(eventRegistrations.status, 'CANCELLED')),
                  ),
                ),
            ),
          })
          .from(eventInstances)
          .where(
            and(
              gt(eventInstances.start, startAfter),
              eq(eventInstances.tenantId, tenant.id),
              inArray(eventInstances.status, [...input.status]),
              ...(input.includeUnlisted
                ? []
                : [eq(eventInstances.unlisted, false)]),
              ...(canInspectAllTenantEvents
                ? []
                : [
                    exists(
                      database
                        .select()
                        .from(eventRegistrationOptions)
                        .where(
                          and(
                            eq(
                              eventRegistrationOptions.eventId,
                              eventInstances.id,
                            ),
                            or(
                              sql`cardinality(${eventRegistrationOptions.roleIds}) = 0`,
                              arrayOverlaps(
                                eventRegistrationOptions.roleIds,
                                roleFilters,
                              ),
                            ),
                          ),
                        ),
                    ),
                  ]),
            ),
          )
          .limit(input.limit)
          .offset(input.offset)
          .orderBy(eventInstances.start),
      );

      const eventRecords = selectedEvents.map((event) => ({
        icon: event.icon,
        id: event.id,
        start: event.start.toISOString(),
        status: event.status,
        title: event.title,
        unlisted: event.unlisted,
        userIsCreator: event.creatorId === (user?.id ?? 'not'),
        userRegistered: Boolean(event.userRegistered),
      }));

      return groupEventsByTenantDay(eventRecords, tenant.timezone);
    }),
  'events.findGraphForEdit': ({ id }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      const event = yield* databaseEffect((database) =>
        database.query.eventInstances.findFirst({
          columns: {
            creatorId: true,
            status: true,
          },
          where: { id, tenantId: tenant.id },
        }),
      );
      if (!event) {
        return yield* Effect.fail(
          new EventNotFoundError({ id, message: 'Event not found' }),
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
            message: 'Event cannot be edited in its current state',
          }),
        );
      }

      const graph = yield* databaseEffect((database) =>
        loadEventGraphDetail(database, tenant.id, id),
      );
      if (!graph) {
        return yield* Effect.fail(
          new EventNotFoundError({ id, message: 'Event not found' }),
        );
      }
      return graph;
    }),
  'events.findOne': ({ id }, _options) =>
    Effect.gen(function* () {
      const { tenant } = yield* RpcAccess.current();
      const { user } = yield* RpcAccess.current();
      const userPermissions = user?.permissions ?? [];
      const canInspectAllTenantEvents = canInspectTenantEvents(userPermissions);

      const rolesToFilterBy = canInspectAllTenantEvents
        ? []
        : (user?.roleIds ??
          (yield* databaseEffect((database) =>
            database.query.roles
              .findMany({
                columns: { id: true },
                where: {
                  defaultUserRole: true,
                  tenantId: tenant.id,
                },
              })
              .pipe(
                Effect.map((roleRecords) => roleRecords.map((role) => role.id)),
              ),
          )));

      const event = yield* databaseEffect((database) =>
        database.query.eventInstances.findFirst({
          columns: {
            creatorId: true,
            description: true,
            end: true,
            icon: true,
            id: true,
            location: true,
            start: true,
            status: true,
            statusComment: true,
            title: true,
            unlisted: true,
          },
          where: { id, tenantId: tenant.id },
          with: {
            registrationOptions: {
              columns: {
                checkedInSpots: true,
                closeRegistrationTime: true,
                confirmedSpots: true,
                description: true,
                eventId: true,
                id: true,
                isPaid: true,
                openRegistrationTime: true,
                organizingRegistration: true,
                price: true,
                registeredDescription: true,
                registrationMode: true,
                reservedSpots: true,
                roleIds: true,
                spots: true,
                stripeTaxRateId: true,
                title: true,
              },
              where: canInspectAllTenantEvents
                ? undefined
                : {
                    RAW: (table) =>
                      sql`cardinality(${table.roleIds}) = 0 or ${arrayOverlaps(
                        table.roleIds,
                        [...rolesToFilterBy],
                      )}`,
                  },
            },
            reviewer: {
              columns: {
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
      );
      if (!event) {
        return yield* Effect.fail(
          new EventNotFoundError({ id, message: 'Event not found' }),
        );
      }

      const canSeeDrafts =
        canInspectAllTenantEvents ||
        (user && includesPermission('events:seeDrafts', user.permissions));
      const canReviewEvents =
        user && includesPermission('events:review', user.permissions);
      const canEditEvent_ = user
        ? canEditEvent({
            creatorId: event.creatorId,
            permissions: user.permissions,
            userId: user.id,
          })
        : false;
      if (
        event.status !== 'APPROVED' &&
        !canSeeDrafts &&
        !canReviewEvents &&
        !canEditEvent_
      ) {
        return yield* Effect.fail(
          new EventNotFoundError({ id, message: 'Event not found' }),
        );
      }

      const hasAnyRegistrationOption =
        event.registrationOptions.length > 0
          ? true
          : Boolean(
              yield* databaseEffect((database) =>
                database.query.eventRegistrationOptions.findFirst({
                  columns: {
                    id: true,
                  },
                  where: {
                    eventId: event.id,
                  },
                }),
              ),
            );
      const isRegistrationOptionsHiddenByEligibility =
        Boolean(user) &&
        event.registrationOptions.length === 0 &&
        hasAnyRegistrationOption;

      const registrationOptionIds = event.registrationOptions.map(
        (registrationOption) => registrationOption.id,
      );
      const eventAddOnRows =
        registrationOptionIds.length === 0
          ? []
          : yield* databaseEffect((database) =>
              database
                .select({
                  allowMultiple: eventAddons.allowMultiple,
                  allowPurchaseBeforeEvent:
                    eventAddons.allowPurchaseBeforeEvent,
                  allowPurchaseDuringEvent:
                    eventAddons.allowPurchaseDuringEvent,
                  allowPurchaseDuringRegistration:
                    eventAddons.allowPurchaseDuringRegistration,
                  description: eventAddons.description,
                  id: eventAddons.id,
                  includedQuantity:
                    addonToEventRegistrationOptions.includedQuantity,
                  isPaid: eventAddons.isPaid,
                  maxQuantityPerUser: eventAddons.maxQuantityPerUser,
                  optionalPurchaseQuantity:
                    addonToEventRegistrationOptions.optionalPurchaseQuantity,
                  price: eventAddons.price,
                  registrationOptionId:
                    addonToEventRegistrationOptions.registrationOptionId,
                  stripeTaxRateId: eventAddons.stripeTaxRateId,
                  title: eventAddons.title,
                  totalAvailableQuantity: eventAddons.totalAvailableQuantity,
                })
                .from(eventAddons)
                .innerJoin(
                  addonToEventRegistrationOptions,
                  eq(addonToEventRegistrationOptions.addonId, eventAddons.id),
                )
                .where(
                  and(
                    eq(eventAddons.eventId, event.id),
                    inArray(
                      addonToEventRegistrationOptions.registrationOptionId,
                      registrationOptionIds,
                    ),
                  ),
                ),
            );
      const eventQuestionRows =
        registrationOptionIds.length === 0
          ? []
          : yield* databaseEffect((database) =>
              database
                .select({
                  description: eventRegistrationQuestions.description,
                  id: eventRegistrationQuestions.id,
                  registrationOptionId:
                    eventRegistrationQuestions.registrationOptionId,
                  required: eventRegistrationQuestions.required,
                  sortOrder: eventRegistrationQuestions.sortOrder,
                  title: eventRegistrationQuestions.title,
                })
                .from(eventRegistrationQuestions)
                .where(
                  and(
                    eq(eventRegistrationQuestions.eventId, event.id),
                    inArray(
                      eventRegistrationQuestions.registrationOptionId,
                      registrationOptionIds,
                    ),
                  ),
                )
                .orderBy(
                  asc(eventRegistrationQuestions.sortOrder),
                  asc(eventRegistrationQuestions.id),
                ),
            );
      const registrationOptionTaxRateIds = [
        ...new Set(
          event.registrationOptions
            .map((registrationOption) => registrationOption.stripeTaxRateId)
            .filter((id): id is string => typeof id === 'string'),
        ),
      ];
      const addOnTaxRateIds = [
        ...new Set(
          eventAddOnRows
            .map((addOn) => addOn.stripeTaxRateId)
            .filter((id): id is string => typeof id === 'string'),
        ),
      ];
      const taxRateIds = [
        ...new Set([...registrationOptionTaxRateIds, ...addOnTaxRateIds]),
      ];
      const optionDiscounts =
        registrationOptionIds.length === 0
          ? []
          : yield* databaseEffect((database) =>
              database
                .select({
                  discountedPrice:
                    eventRegistrationOptionDiscounts.discountedPrice,
                  discountType: eventRegistrationOptionDiscounts.discountType,
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
                      registrationOptionIds,
                    ),
                  ),
                ),
            );
      const taxRates =
        taxRateIds.length === 0
          ? []
          : yield* databaseEffect((database) =>
              database
                .select({
                  displayName: tenantStripeTaxRates.displayName,
                  percentage: tenantStripeTaxRates.percentage,
                  stripeTaxRateId: tenantStripeTaxRates.stripeTaxRateId,
                })
                .from(tenantStripeTaxRates)
                .where(
                  and(
                    eq(tenantStripeTaxRates.tenantId, tenant.id),
                    eq(
                      tenantStripeTaxRates.stripeAccountId,
                      tenant.stripeAccountId ?? '',
                    ),
                    inArray(tenantStripeTaxRates.stripeTaxRateId, taxRateIds),
                  ),
                ),
            );
      const taxRateByStripeId = new Map(
        taxRates.map((taxRate) => [taxRate.stripeTaxRateId, taxRate]),
      );
      const esnCardDiscountedPriceByOptionId =
        getEsnCardDiscountedPriceByOptionId(optionDiscounts);
      const questionsByRegistrationOptionId = groupBy(
        eventQuestionRows.toSorted((left, right) => {
          if (left.sortOrder !== right.sortOrder) {
            return left.sortOrder - right.sortOrder;
          }

          return left.title.localeCompare(right.title);
        }),
        (question) => question.registrationOptionId,
      );
      const addOnsById = new Map<
        string,
        {
          allowMultiple: boolean;
          allowPurchaseBeforeEvent: boolean;
          allowPurchaseDuringEvent: boolean;
          allowPurchaseDuringRegistration: boolean;
          description: null | string;
          id: string;
          isPaid: boolean;
          maxQuantityPerUser: number;
          price: number;
          registrationOptions: {
            includedQuantity: number;
            optionalPurchaseQuantity: number;
            registrationOptionId: string;
          }[];
          stripeTaxRateId: null | string;
          taxRateDisplayName: null | string;
          taxRatePercentage: null | string;
          title: string;
          totalAvailableQuantity: number;
        }
      >();
      for (const addOn of eventAddOnRows) {
        const taxRate = addOn.stripeTaxRateId
          ? taxRateByStripeId.get(addOn.stripeTaxRateId)
          : undefined;
        const current = addOnsById.get(addOn.id) ?? {
          allowMultiple: addOn.allowMultiple,
          allowPurchaseBeforeEvent: addOn.allowPurchaseBeforeEvent,
          allowPurchaseDuringEvent: addOn.allowPurchaseDuringEvent,
          allowPurchaseDuringRegistration:
            addOn.allowPurchaseDuringRegistration,
          description: addOn.description ?? null,
          id: addOn.id,
          isPaid: addOn.isPaid,
          maxQuantityPerUser: addOn.maxQuantityPerUser,
          price: addOn.price,
          registrationOptions: [],
          stripeTaxRateId: addOn.stripeTaxRateId ?? null,
          taxRateDisplayName: taxRate?.displayName ?? null,
          taxRatePercentage: taxRate?.percentage ?? null,
          title: addOn.title,
          totalAvailableQuantity: addOn.totalAvailableQuantity,
        };
        current.registrationOptions.push({
          includedQuantity: addOn.includedQuantity,
          optionalPurchaseQuantity: addOn.optionalPurchaseQuantity,
          registrationOptionId: addOn.registrationOptionId,
        });
        addOnsById.set(addOn.id, current);
      }

      const esnCardIsEnabledForTenant = isEsnCardEnabled(
        tenant.discountProviders ?? null,
      );
      let isUserCanUseEsnCardDiscount = false;

      if (user && esnCardIsEnabledForTenant) {
        const cards = yield* databaseEffect((database) =>
          database.query.userDiscountCards.findMany({
            columns: {
              validTo: true,
            },
            where: {
              status: 'verified',
              tenantId: tenant.id,
              type: 'esnCard',
              userId: user.id,
            },
          }),
        );
        isUserCanUseEsnCardDiscount = cards.some(
          (card) => !card.validTo || card.validTo > event.start,
        );
      }

      return {
        addOns: [...addOnsById.values()],
        creatorId: event.creatorId,
        description: event.description,
        end: event.end.toISOString(),
        icon: event.icon,
        id: event.id,
        location: event.location ?? null,
        registrationOptions: event.registrationOptions.map(
          (registrationOption) => {
            const esnCardDiscountedPrice =
              esnCardDiscountedPriceByOptionId.get(registrationOption.id) ??
              null;
            const userIsEligibleForEsnCardDiscount =
              registrationOption.isPaid &&
              esnCardDiscountedPrice !== null &&
              esnCardIsEnabledForTenant &&
              isUserCanUseEsnCardDiscount;
            const effectivePrice = userIsEligibleForEsnCardDiscount
              ? Math.min(registrationOption.price, esnCardDiscountedPrice)
              : registrationOption.price;
            const discountApplied =
              userIsEligibleForEsnCardDiscount &&
              effectivePrice < registrationOption.price;
            const taxRate = registrationOption.stripeTaxRateId
              ? taxRateByStripeId.get(registrationOption.stripeTaxRateId)
              : undefined;

            return {
              appliedDiscountType: discountApplied
                ? ('esnCard' as const)
                : null,
              checkedInSpots: registrationOption.checkedInSpots,
              closeRegistrationTime:
                registrationOption.closeRegistrationTime.toISOString(),
              confirmedSpots: registrationOption.confirmedSpots,
              description: registrationOption.description ?? null,
              discountApplied,
              effectivePrice,
              esnCardDiscountedPrice: discountApplied
                ? esnCardDiscountedPrice
                : null,
              eventId: registrationOption.eventId,
              id: registrationOption.id,
              isPaid: registrationOption.isPaid,
              openRegistrationTime:
                registrationOption.openRegistrationTime.toISOString(),
              organizingRegistration: registrationOption.organizingRegistration,
              price: registrationOption.price,
              questions: (
                questionsByRegistrationOptionId[registrationOption.id] ?? []
              ).map((question) => ({
                description: question.description ?? null,
                id: question.id,
                required: question.required,
                sortOrder: question.sortOrder,
                title: question.title,
              })),
              registeredDescription:
                registrationOption.registeredDescription ?? null,
              registrationMode: registrationOption.registrationMode,
              reservedSpots: registrationOption.reservedSpots,
              roleIds: [...registrationOption.roleIds],
              spots: registrationOption.spots,
              stripeTaxRateId: registrationOption.stripeTaxRateId ?? null,
              taxRateDisplayName: taxRate?.displayName ?? null,
              taxRatePercentage: taxRate?.percentage ?? null,
              title: registrationOption.title,
            };
          },
        ),
        registrationOptionsHiddenByEligibility:
          isRegistrationOptionsHiddenByEligibility,
        reviewer: event.reviewer,
        start: event.start.toISOString(),
        status: event.status,
        statusComment: event.statusComment ?? null,
        title: event.title,
        unlisted: event.unlisted,
      };
    }),
  'events.findOneForEdit': ({ id }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();

      const event = yield* databaseEffect((database) =>
        database.query.eventInstances.findFirst({
          columns: {
            creatorId: true,
            description: true,
            end: true,
            icon: true,
            id: true,
            location: true,
            start: true,
            status: true,
            title: true,
          },
          where: { id, tenantId: tenant.id },
          with: {
            registrationOptions: {
              columns: {
                cancellationDeadlineHoursBeforeStart: true,
                closeRegistrationTime: true,
                description: true,
                id: true,
                isPaid: true,
                openRegistrationTime: true,
                organizingRegistration: true,
                price: true,
                refundFeesOnCancellation: true,
                registeredDescription: true,
                registrationMode: true,
                roleIds: true,
                spots: true,
                stripeTaxRateId: true,
                title: true,
                transferDeadlineHoursBeforeStart: true,
              },
            },
          },
        }),
      );

      if (!event) {
        return yield* Effect.fail(
          new EventNotFoundError({ id, message: 'Event not found' }),
        );
      }

      const canEdit =
        event.creatorId === user.id ||
        includesPermission('events:editAll', user.permissions);
      if (!canEdit) {
        return yield* Effect.fail(
          new RpcForbiddenError({ message: 'Forbidden' }),
        );
      }

      if (event.status !== 'DRAFT') {
        return yield* Effect.fail(
          new EventConflictError({
            message: 'Event cannot be edited in its current state',
          }),
        );
      }

      const registrationOptionIds = event.registrationOptions.map(
        (option) => option.id,
      );
      const optionDiscounts =
        registrationOptionIds.length === 0
          ? []
          : yield* databaseEffect((database) =>
              database
                .select({
                  discountedPrice:
                    eventRegistrationOptionDiscounts.discountedPrice,
                  discountType: eventRegistrationOptionDiscounts.discountType,
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
                      [...registrationOptionIds],
                    ),
                  ),
                ),
            );
      const esnCardDiscountedPriceByOptionId =
        getEsnCardDiscountedPriceByOptionId(optionDiscounts);

      return {
        description: event.description,
        end: event.end.toISOString(),
        icon: event.icon,
        id: event.id,
        location: event.location ?? null,
        registrationOptions: event.registrationOptions.map((option) => ({
          cancellationDeadlineHoursBeforeStart:
            option.cancellationDeadlineHoursBeforeStart,
          closeRegistrationTime: option.closeRegistrationTime.toISOString(),
          description: option.description ?? null,
          esnCardDiscountedPrice:
            esnCardDiscountedPriceByOptionId.get(option.id) ?? undefined,
          id: option.id,
          isPaid: option.isPaid,
          openRegistrationTime: option.openRegistrationTime.toISOString(),
          organizingRegistration: option.organizingRegistration,
          price: option.price,
          refundFeesOnCancellation: option.refundFeesOnCancellation,
          registeredDescription: option.registeredDescription ?? null,
          registrationMode: option.registrationMode,
          roleIds: [...option.roleIds],
          spots: option.spots,
          stripeTaxRateId: option.stripeTaxRateId ?? null,
          title: option.title,
          transferDeadlineHoursBeforeStart:
            option.transferDeadlineHoursBeforeStart,
        })),
        start: event.start.toISOString(),
        title: event.title,
      };
    }),
  'events.getOrganizeOverview': ({ eventId }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();

      const canOrganize = yield* canOrganizeEvent({
        eventId,
        permissions: user.permissions,
        tenantId: tenant.id,
        userId: user.id,
      });
      if (!canOrganize) {
        return yield* Effect.fail(
          new RpcForbiddenError({
            message: 'Organizer access required',
            permission: 'events:organizeAll',
          }),
        );
      }

      const registrationOptionAggregates = yield* databaseEffect((database) =>
        database
          .select({
            checkedInSpots: eventRegistrationOptions.checkedInSpots,
            confirmedSpots: eventRegistrationOptions.confirmedSpots,
            spots: eventRegistrationOptions.spots,
          })
          .from(eventRegistrationOptions)
          .innerJoin(
            eventInstances,
            and(
              eq(eventInstances.id, eventRegistrationOptions.eventId),
              eq(eventInstances.tenantId, tenant.id),
            ),
          )
          .where(eq(eventRegistrationOptions.eventId, eventId)),
      );

      const registrations = yield* databaseEffect((database) =>
        database.query.eventRegistrations.findMany({
          columns: {
            appliedDiscountedPrice: true,
            appliedDiscountType: true,
            basePriceAtRegistration: true,
            checkInTime: true,
            discountAmount: true,
            id: true,
            registrationOptionId: true,
            status: true,
          },
          where: {
            eventId,
            status: { NOT: 'CANCELLED' },
            tenantId: tenant.id,
          },
          with: {
            addonPurchases: {
              columns: {
                quantity: true,
                unitPrice: true,
              },
              with: {
                addOn: {
                  columns: {
                    title: true,
                  },
                },
              },
            },
            registrationOption: {
              columns: {
                id: true,
                organizingRegistration: true,
                price: true,
                registrationMode: true,
                title: true,
              },
            },
            transactions: {
              columns: {
                amount: true,
                status: true,
                stripeCheckoutSessionId: true,
                type: true,
              },
              where: {
                type: 'registration',
              },
            },
            user: {
              columns: {
                email: true,
                firstName: true,
                id: true,
                lastName: true,
              },
            },
          },
        }),
      );
      const registrationsWithRelations = registrations.filter(
        (registration) =>
          registration.registrationOption &&
          registration.user &&
          (registration.status === 'CONFIRMED' ||
            (registration.status === 'PENDING' &&
              registration.registrationOption.registrationMode ===
                'application')),
      );
      const capabilities = eventOrganizeCapabilities({
        confirmedOrganizerRegistration: registrationsWithRelations.some(
          (registration) =>
            registration.status === 'CONFIRMED' &&
            registration.user.id === user.id &&
            registration.registrationOption.organizingRegistration,
        ),
        permissions: user.permissions,
      });

      type Registration = (typeof registrationsWithRelations)[number];
      const groupedRegistrations = groupBy(
        registrationsWithRelations,
        (registration) => registration.registrationOptionId,
      ) as Record<string, Registration[]>;

      const sortedOptions = (
        Object.entries(groupedRegistrations) as [string, Registration[]][]
      ).toSorted(([, registrationsA], [, registrationsB]) => {
        if (
          registrationsA[0].registrationOption.organizingRegistration !==
          registrationsB[0].registrationOption.organizingRegistration
        ) {
          return registrationsB[0].registrationOption.organizingRegistration
            ? 1
            : -1;
        }

        return registrationsA[0].registrationOption.title.localeCompare(
          registrationsB[0].registrationOption.title,
        );
      });

      const registrationOptions = sortedOptions.map(
        ([registrationOptionId, registrationRows]) => {
          const sortedUsers = registrationRows
            .toSorted((registrationA, registrationB) => {
              if (
                (registrationA.checkInTime === null) !==
                (registrationB.checkInTime === null)
              ) {
                return registrationA.checkInTime === null ? -1 : 1;
              }

              const firstNameCompare =
                registrationA.user.firstName.localeCompare(
                  registrationB.user.firstName,
                );
              if (firstNameCompare !== 0) {
                return firstNameCompare;
              }

              return registrationA.user.lastName.localeCompare(
                registrationB.user.lastName,
              );
            })
            .map((registration) => {
              const registrationOption = registration.registrationOption;
              const approvalState = organizerRegistrationApprovalState({
                registrationMode: registrationOption.registrationMode,
                registrationStatus: registration.status,
                transactions: registration.transactions,
              });
              const discountedPriceFromTransaction =
                registration.transactions.find(
                  (transaction) =>
                    transaction.amount < registrationOption.price,
                )?.amount;
              const appliedDiscountedPrice =
                registration.appliedDiscountedPrice ??
                discountedPriceFromTransaction ??
                null;
              const appliedDiscountType =
                registration.appliedDiscountType ??
                (appliedDiscountedPrice === null ? null : ('esnCard' as const));
              const basePriceAtRegistration =
                registration.basePriceAtRegistration ??
                (appliedDiscountedPrice === null
                  ? null
                  : registrationOption.price);
              const discountAmount =
                registration.discountAmount ??
                (appliedDiscountedPrice === null
                  ? null
                  : registrationOption.price - appliedDiscountedPrice);

              return {
                addonPurchases: registration.addonPurchases.flatMap(
                  (purchase) =>
                    purchase.addOn
                      ? [
                          {
                            quantity: purchase.quantity,
                            title: purchase.addOn.title,
                            unitPrice: purchase.unitPrice,
                          },
                        ]
                      : [],
                ),
                appliedDiscountedPrice,
                appliedDiscountType,
                basePriceAtRegistration,
                checkedIn: registration.checkInTime !== null,
                checkInTime: registration.checkInTime?.toISOString() ?? null,
                discountAmount,
                email: registration.user.email,
                firstName: registration.user.firstName,
                lastName: registration.user.lastName,
                ...approvalState,
                registrationId: registration.id,
                status: registration.status,
                userId: registration.user.id,
              };
            });

          return {
            canApproveRegistrations: capabilities.canApproveRegistrations,
            canCancelRegistrations: capabilities.canCancelRegistrations,
            canTransferRegistrations: capabilities.canTransferRegistrations,
            organizingRegistration:
              registrationRows[0].registrationOption.organizingRegistration,
            registrationOptionId,
            registrationOptionTitle:
              registrationRows[0].registrationOption.title,
            users: sortedUsers,
          };
        },
      );
      const stats = { capacity: 0, checkedIn: 0, registered: 0 };
      for (const option of registrationOptionAggregates) {
        stats.capacity += option.spots;
        stats.checkedIn += option.checkedInSpots;
        stats.registered += option.confirmedSpots;
      }

      return {
        registrationOptions,
        stats,
      };
    }),
} satisfies Partial<AppRpcHandlers>;
