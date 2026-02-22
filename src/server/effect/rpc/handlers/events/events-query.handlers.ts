import {
  and,
  arrayOverlaps,
  eq,
  exists,
  gt,
  inArray,
  not,
} from 'drizzle-orm';
import { Effect } from 'effect';
import { groupBy } from 'es-toolkit';
import { DateTime } from 'luxon';

import type { AppRpcHandlers } from '../shared/handler-types';

import {
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrations,
} from '../../../../../db/schema';
import { RpcAccess } from '../shared/rpc-access.service';
import {
  canEditEvent,
  databaseEffect,
  getEsnCardDiscountedPriceByOptionId,
  isEsnCardEnabled,
} from './events.shared';

export const eventQueryHandlers = {
'events.canOrganize': ({ eventId }, _options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensureAuthenticated();
        const { tenant } = yield* RpcAccess.current();
        const user = yield* RpcAccess.requireUser();

        if (
          user.permissions.includes('events:organizeAll') ||
          user.permissions.includes('finance:manageReceipts')
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
                eq(eventRegistrations.tenantId, tenant.id),
                eq(eventRegistrations.eventId, eventId),
                eq(eventRegistrations.userId, user.id),
                eq(eventRegistrations.status, 'CONFIRMED'),
                eq(eventRegistrationOptions.organizingRegistration, true),
              ),
            )
            .limit(1),
        );

        return registrations.length > 0;
      }),
'events.eventList': (input, _options) =>
      Effect.gen(function* () {
        const { tenant } = yield* RpcAccess.current();
        const { user } = yield* RpcAccess.current();
        const userPermissions = user?.permissions ?? [];

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

        const onlyApprovedStatus =
          input.status.length === 1 && input.status[0] === 'APPROVED';
        if (
          !onlyApprovedStatus &&
          !userPermissions.includes('events:seeDrafts')
        ) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        if (
          input.includeUnlisted &&
          !userPermissions.includes('events:seeUnlisted')
        ) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        const rolesToFilterBy =
          user?.roleIds ??
          (yield* databaseEffect((database) =>
            database.query.roles
              .findMany({
                columns: { id: true },
                where: {
                  defaultUserRole: true,
                  tenantId: tenant.id,
                },
              })
              .pipe(Effect.map((roleRecords) => roleRecords.map((role) => role.id))),
          ));
        const roleFilters =
          rolesToFilterBy.length > 0 ? [...rolesToFilterBy] : [''];

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
                gt(eventInstances.start, new Date(input.startAfter)),
                eq(eventInstances.tenantId, tenant.id),
                inArray(eventInstances.status, [...input.status]),
                ...(input.includeUnlisted
                  ? []
                  : [eq(eventInstances.unlisted, false)]),
                exists(
                  database
                    .select()
                    .from(eventRegistrationOptions)
                    .where(
                      and(
                        eq(eventRegistrationOptions.eventId, eventInstances.id),
                        arrayOverlaps(
                          eventRegistrationOptions.roleIds,
                          roleFilters,
                        ),
                      ),
                    ),
                ),
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

        const groupedEvents = new Map<string, typeof eventRecords>();

        for (const event of eventRecords) {
          const day = DateTime.fromISO(event.start).toFormat('yyyy-MM-dd');
          const currentEvents = groupedEvents.get(day) ?? [];
          currentEvents.push(event);
          groupedEvents.set(day, currentEvents);
        }

        return [...groupedEvents.entries()].map(([day, events]) => ({
          day: DateTime.fromFormat(day, 'yyyy-MM-dd').toJSDate().toISOString(),
          events,
        }));
      }),
'events.findOne': ({ id }, _options) =>
      Effect.gen(function* () {
        const { tenant } = yield* RpcAccess.current();
        const { user } = yield* RpcAccess.current();

        const rolesToFilterBy =
          user?.roleIds ??
          (yield* databaseEffect((database) =>
            database.query.roles
              .findMany({
                columns: { id: true },
                where: {
                  defaultUserRole: true,
                  tenantId: tenant.id,
                },
              })
              .pipe(Effect.map((roleRecords) => roleRecords.map((role) => role.id))),
          ));

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
                  roleIds: true,
                  spots: true,
                  stripeTaxRateId: true,
                  title: true,
                },
                where: {
                  RAW: (table) =>
                    arrayOverlaps(table.roleIds, [...rolesToFilterBy]),
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
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const canSeeDrafts = user?.permissions.includes('events:seeDrafts');
        const canReviewEvents = user?.permissions.includes('events:review');
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
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const registrationOptionIds = event.registrationOptions.map(
          (registrationOption) => registrationOption.id,
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
                        registrationOptionIds,
                      ),
                    ),
                  ),
              );
        const esnCardDiscountedPriceByOptionId =
          getEsnCardDiscountedPriceByOptionId(optionDiscounts);

        const esnCardIsEnabledForTenant = isEsnCardEnabled(
          tenant.discountProviders ?? null,
        );
        let userCanUseEsnCardDiscount = false;

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
          userCanUseEsnCardDiscount = cards.some(
            (card) => !card.validTo || card.validTo > event.start,
          );
        }

        return {
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
                userCanUseEsnCardDiscount;
              const effectivePrice = userIsEligibleForEsnCardDiscount
                ? Math.min(registrationOption.price, esnCardDiscountedPrice)
                : registrationOption.price;
              const discountApplied =
                userIsEligibleForEsnCardDiscount &&
                effectivePrice < registrationOption.price;

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
                organizingRegistration:
                  registrationOption.organizingRegistration,
                price: registrationOption.price,
                registeredDescription:
                  registrationOption.registeredDescription ?? null,
                registrationMode: registrationOption.registrationMode,
                roleIds: [...registrationOption.roleIds],
                spots: registrationOption.spots,
                stripeTaxRateId: registrationOption.stripeTaxRateId ?? null,
                title: registrationOption.title,
              };
            },
          ),
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
                  closeRegistrationTime: true,
                  description: true,
                  id: true,
                  isPaid: true,
                  openRegistrationTime: true,
                  organizingRegistration: true,
                  price: true,
                  registeredDescription: true,
                  registrationMode: true,
                  roleIds: true,
                  spots: true,
                  stripeTaxRateId: true,
                  title: true,
                },
              },
            },
          }),
        );

        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const canEdit =
          event.creatorId === user.id ||
          user.permissions.includes('events:editAll');
        if (!canEdit) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        if (event.status !== 'DRAFT' && event.status !== 'REJECTED') {
          return yield* Effect.fail('CONFLICT' as const);
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
            closeRegistrationTime: option.closeRegistrationTime.toISOString(),
            description: option.description ?? null,
            esnCardDiscountedPrice:
              esnCardDiscountedPriceByOptionId.get(option.id) ?? undefined,
            id: option.id,
            isPaid: option.isPaid,
            openRegistrationTime: option.openRegistrationTime.toISOString(),
            organizingRegistration: option.organizingRegistration,
            price: option.price,
            registeredDescription: option.registeredDescription ?? null,
            registrationMode: option.registrationMode,
            roleIds: [...option.roleIds],
            spots: option.spots,
            stripeTaxRateId: option.stripeTaxRateId ?? null,
            title: option.title,
          })),
          start: event.start.toISOString(),
          title: event.title,
        };
      }),
'events.getOrganizeOverview': ({ eventId }, _options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensureAuthenticated();
        const { tenant } = yield* RpcAccess.current();

        const registrations = yield* databaseEffect((database) =>
          database.query.eventRegistrations.findMany({
            columns: {
              appliedDiscountedPrice: true,
              appliedDiscountType: true,
              basePriceAtRegistration: true,
              checkInTime: true,
              discountAmount: true,
              registrationOptionId: true,
            },
            where: {
              eventId,
              status: 'CONFIRMED',
              tenantId: tenant.id,
            },
            with: {
              registrationOption: {
                columns: {
                  id: true,
                  organizingRegistration: true,
                  price: true,
                  title: true,
                },
              },
              transactions: {
                columns: {
                  amount: true,
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
            registration.registrationOption && registration.user,
        );

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

        return sortedOptions.map(([registrationOptionId, registrationRows]) => {
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
                appliedDiscountedPrice,
                appliedDiscountType,
                basePriceAtRegistration,
                checkedIn: registration.checkInTime !== null,
                checkInTime: registration.checkInTime?.toISOString() ?? null,
                discountAmount,
                email: registration.user.email,
                firstName: registration.user.firstName,
                lastName: registration.user.lastName,
                userId: registration.user.id,
              };
            });

          return {
            organizingRegistration:
              registrationRows[0].registrationOption.organizingRegistration,
            registrationOptionId,
            registrationOptionTitle:
              registrationRows[0].registrationOption.title,
            users: sortedUsers,
          };
        });
      }),
} satisfies Partial<AppRpcHandlers>;
