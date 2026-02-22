 

import type { Headers } from '@effect/platform';

import {
  and,
  arrayOverlaps,
  eq,
  exists,
  gt,
  inArray,
  not,
} from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { groupBy } from 'es-toolkit';
import { DateTime } from 'luxon';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrations,
  templateRegistrationOptionDiscounts,
  transactions,
} from '../../../../../db/schema';
import { type Permission } from '../../../../../shared/permissions/permissions';
import { ConfigPermissions } from '../../../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import { Tenant } from '../../../../../types/custom/tenant';
import { User } from '../../../../../types/custom/user';
import { stripe } from '../../../../stripe-client';
import {
  isMeaningfulRichTextHtml,
  sanitizeOptionalRichTextHtml,
  sanitizeRichTextHtml,
} from '../../../../utils/rich-text-sanitize';
import { validateTaxRate } from '../../../../utils/validate-tax-rate';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../../rpc-context-headers';
import { mapEventRegistrationErrorToRpc } from '../shared/rpc-error-mappers';
import { EventRegistrationService } from './events/event-registration.service';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.pipe(Effect.flatMap((database) => operation(database).pipe(Effect.orDie)));

const decodeHeaderJson = <A, I>(
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
) => Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

const getEsnCardDiscountedPriceByOptionId = (
  discounts: readonly {
    discountedPrice: number;
    discountType: string;
    registrationOptionId: string;
  }[],
) => {
  const map = new Map<string, number>();
  for (const discount of discounts) {
    if (discount.discountType !== 'esnCard') {
      continue;
    }

    const current = map.get(discount.registrationOptionId);
    if (current === undefined || discount.discountedPrice < current) {
      map.set(discount.registrationOptionId, discount.discountedPrice);
    }
  }

  return map;
};

const isEsnCardEnabled = (providers: unknown) => {
  if (!providers || typeof providers !== 'object') {
    return false;
  }

  const esnCard = (
    providers as {
      esnCard?: {
        status?: unknown;
      };
    }
  ).esnCard;

  return esnCard?.status === 'enabled';
};

const canEditEvent = ({
  creatorId,
  permissions,
  userId,
}: {
  creatorId: string;
  permissions: readonly string[];
  userId: string;
}) => creatorId === userId || permissions.includes('events:editAll');

const EDITABLE_EVENT_STATUSES = ['DRAFT', 'REJECTED'] as const;

type EventRegistrationOptionDiscountInsert =
  typeof eventRegistrationOptionDiscounts.$inferInsert;

const ensureAuthenticated = (
  headers: Headers.Headers,
): Effect.Effect<void, 'UNAUTHORIZED'> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail('UNAUTHORIZED' as const);

const ensurePermission = (
  headers: Headers.Headers,
  permission: Permission,
): Effect.Effect<void, 'FORBIDDEN' | 'UNAUTHORIZED'> =>
  Effect.gen(function* () {
    yield* ensureAuthenticated(headers);
    const currentPermissions = decodeHeaderJson(
      headers[RPC_CONTEXT_HEADERS.PERMISSIONS],
      ConfigPermissions,
    );

    if (!currentPermissions.includes(permission)) {
      return yield* Effect.fail('FORBIDDEN' as const);
    }
  });

const decodeUserHeader = (headers: Headers.Headers) =>
  Effect.sync(() =>
    decodeHeaderJson(headers[RPC_CONTEXT_HEADERS.USER], Schema.NullOr(User)),
  );

const requireUserHeader = (
  headers: Headers.Headers,
): Effect.Effect<User, 'UNAUTHORIZED'> =>
  Effect.gen(function* () {
    const user = yield* decodeUserHeader(headers);
    if (!user) {
      return yield* Effect.fail('UNAUTHORIZED' as const);
    }
    return user;
  });

export const eventHandlers = {
    'events.cancelPendingRegistration': ({ registrationId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const registration = yield* databaseEffect((database) =>
          database.query.eventRegistrations.findFirst({
            columns: {
              id: true,
              registrationOptionId: true,
            },
            where: {
              id: registrationId,
              status: 'PENDING',
              tenantId: tenant.id,
              userId: user.id,
            },
            with: {
              registrationOption: {
                columns: {
                  reservedSpots: true,
                },
              },
              transactions: {
                columns: {
                  id: true,
                  method: true,
                  status: true,
                  stripeCheckoutSessionId: true,
                },
              },
            },
          }),
        );

        if (!registration) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        yield* databaseEffect((database) =>
          database.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(eventRegistrations)
                .set({
                  status: 'CANCELLED',
                })
                .where(eq(eventRegistrations.id, registration.id));

              const reservedSpots =
                registration.registrationOption?.reservedSpots;
              if (reservedSpots === undefined) {
                return yield* Effect.fail(
                  new Error('Registration option missing'),
                );
              }

              yield* tx
                .update(eventRegistrationOptions)
                .set({
                  reservedSpots: reservedSpots - 1,
                })
                .where(
                  eq(
                    eventRegistrationOptions.id,
                    registration.registrationOptionId,
                  ),
                );

              const transaction = registration.transactions.find(
                (currentTransaction) =>
                  currentTransaction.status === 'pending' &&
                  currentTransaction.method === 'stripe',
              );

              if (!transaction) {
                return;
              }

              yield* tx
                .update(transactions)
                .set({
                  status: 'cancelled',
                })
                .where(eq(transactions.id, transaction.id));

              const stripeCheckoutSessionId = transaction.stripeCheckoutSessionId;
              if (!stripeCheckoutSessionId) {
                return;
              }

              const stripeAccount = tenant.stripeAccountId;
              if (!stripeAccount) {
                return yield* Effect.fail(new Error('Stripe account not found'));
              }
              yield* Effect.tryPromise(() =>
                stripe.checkout.sessions.expire(
                  stripeCheckoutSessionId,
                  undefined,
                  {
                    stripeAccount,
                  },
                ),
              ).pipe(Effect.catchAll(() => Effect.void));
            }),
          ),
        ).pipe(Effect.mapError(() => 'INTERNAL_SERVER_ERROR' as const));
      }),
    'events.canOrganize': ({ eventId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

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
    'events.create': (input, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'events:create');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const start = new Date(input.start);
        const end = new Date(input.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const sanitizedDescription = sanitizeRichTextHtml(input.description);
        if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
          return yield* Effect.fail('BAD_REQUEST' as const);
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
          if (
            Number.isNaN(option.closeRegistrationTime.getTime()) ||
            Number.isNaN(option.openRegistrationTime.getTime())
          ) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          const validation = yield* databaseEffect((database) =>
            validateTaxRate(database, {
              isPaid: option.isPaid,
              stripeTaxRateId: option.stripeTaxRateId ?? null,
              tenantId: tenant.id,
            }),
          );
          if (!validation.success) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }
        }

        const templateDefaults = yield* databaseEffect((database) =>
          database.query.eventTemplates.findFirst({
            columns: { unlisted: true },
            where: { id: input.templateId },
          }),
        );

        const events = yield* databaseEffect((database) =>
          database
            .insert(eventInstances)
            .values({
              creatorId: user.id,
              description: sanitizedDescription,
              end,
              icon: input.icon,
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
          return yield* Effect.fail('INTERNAL_SERVER_ERROR' as const);
        }

        const createdOptions = yield* databaseEffect((database) =>
          database
            .insert(eventRegistrationOptions)
            .values(
              sanitizedRegistrationOptions.map((option) => ({
                closeRegistrationTime: option.closeRegistrationTime,
                description: option.description,
                eventId: event.id,
                isPaid: option.isPaid,
                openRegistrationTime: option.openRegistrationTime,
                organizingRegistration: option.organizingRegistration,
                price: option.price,
                registeredDescription: option.registeredDescription,
                registrationMode: option.registrationMode,
                roleIds: [...option.roleIds],
                spots: option.spots,
                stripeTaxRateId: option.stripeTaxRateId ?? null,
                title: option.title,
              })),
            )
            .returning({
              id: eventRegistrationOptions.id,
              organizingRegistration:
                eventRegistrationOptions.organizingRegistration,
              title: eventRegistrationOptions.title,
            }),
        );

        const tenantTemplateOptions = yield* databaseEffect((database) =>
          database.query.templateRegistrationOptions.findMany({
            columns: {
              id: true,
              organizingRegistration: true,
              title: true,
            },
            where: { templateId: input.templateId },
          }),
        );
        if (tenantTemplateOptions.length > 0) {
          const templateDiscounts = yield* databaseEffect((database) =>
          database
              .select({
                discountedPrice: templateRegistrationOptionDiscounts.discountedPrice,
                discountType: templateRegistrationOptionDiscounts.discountType,
                registrationOptionId:
                  templateRegistrationOptionDiscounts.registrationOptionId,
              })
              .from(templateRegistrationOptionDiscounts)
              .where(
                inArray(
                  templateRegistrationOptionDiscounts.registrationOptionId,
                  tenantTemplateOptions.map((option) => option.id),
                ),
              ),
          );
          if (templateDiscounts.length > 0) {
            const registrationOptionKey = (
              title: string,
              organizing: boolean,
            ) => `${title}__${organizing ? '1' : '0'}`;
            const templateOptionByKey = new Map(
              tenantTemplateOptions.map((option) => [
                registrationOptionKey(
                  option.title,
                  option.organizingRegistration,
                ),
                option,
              ]),
            );
            const discountInserts: EventRegistrationOptionDiscountInsert[] = [];
            for (const createdOption of createdOptions) {
              const sourceTemplateOption = templateOptionByKey.get(
                registrationOptionKey(
                  createdOption.title,
                  createdOption.organizingRegistration,
                ),
              );
              if (!sourceTemplateOption) {
                continue;
              }
              for (const discount of templateDiscounts) {
                if (discount.registrationOptionId !== sourceTemplateOption.id) {
                  continue;
                }
                discountInserts.push({
                  discountedPrice: discount.discountedPrice,
                  discountType: discount.discountType,
                  registrationOptionId: createdOption.id,
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
        }

        return {
          id: event.id,
        };
      }),
    'events.eventList': (input, options) =>
      Effect.gen(function* () {
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* decodeUserHeader(options.headers);
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
    'events.findOne': ({ id }, options) =>
      Effect.gen(function* () {
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* decodeUserHeader(options.headers);

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
    'events.findOneForEdit': ({ id }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

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
    'events.getOrganizeOverview': ({ eventId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );

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
    'events.getPendingReviews': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'events:review');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );

        const pendingReviews = yield* databaseEffect((database) =>
          database.query.eventInstances.findMany({
            columns: {
              id: true,
              start: true,
              title: true,
            },
            orderBy: { start: 'desc' },
            where: { status: 'PENDING_REVIEW', tenantId: tenant.id },
          }),
        );

        return pendingReviews.map((event) => ({
          id: event.id,
          start: event.start.toISOString(),
          title: event.title,
        }));
      }),
    'events.getRegistrationStatus': ({ eventId }, options) =>
      Effect.gen(function* () {
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* decodeUserHeader(options.headers);
        if (!user) {
          return {
            isRegistered: false,
            registrations: [],
          };
        }

        const registrations = yield* databaseEffect((database) =>
          database.query.eventRegistrations.findMany({
            columns: {
              appliedDiscountedPrice: true,
              appliedDiscountType: true,
              basePriceAtRegistration: true,
              discountAmount: true,
              id: true,
              registrationOptionId: true,
              status: true,
            },
            where: {
              eventId,
              status: {
                NOT: 'CANCELLED',
              },
              tenantId: tenant.id,
              userId: user.id,
            },
            with: {
              registrationOption: {
                columns: {
                  price: true,
                  registeredDescription: true,
                  title: true,
                },
              },
              transactions: {
                columns: {
                  amount: true,
                  method: true,
                  status: true,
                  stripeCheckoutUrl: true,
                  type: true,
                },
              },
            },
          }),
        );

        const registrationSummaries = registrations.map((registration) => {
          const registrationOption = registration.registrationOption;
          if (!registrationOption) {
            throw new Error(
              `Registration option missing for registration ${registration.id}`,
            );
          }

          const registrationTransaction = registration.transactions.find(
            (transaction) =>
              transaction.type === 'registration' &&
              transaction.amount < registrationOption.price,
          );

          const discountedPrice =
            registration.appliedDiscountedPrice ??
            registrationTransaction?.amount ??
            undefined;
          const appliedDiscountType =
            registration.appliedDiscountType ??
            (discountedPrice === undefined ? undefined : ('esnCard' as const));
          const basePriceAtRegistration =
            registration.basePriceAtRegistration ??
            (discountedPrice === undefined
              ? undefined
              : registrationOption.price);
          const discountAmount =
            registration.discountAmount ??
            (discountedPrice === undefined
              ? undefined
              : registrationOption.price - discountedPrice);

          return {
            appliedDiscountedPrice: discountedPrice,
            appliedDiscountType,
            basePriceAtRegistration,
            checkoutUrl: registration.transactions.find(
              (transaction) =>
                transaction.method === 'stripe' &&
                transaction.type === 'registration',
            )?.stripeCheckoutUrl,
            discountAmount,
            id: registration.id,
            paymentPending: registration.transactions.some(
              (transaction) =>
                transaction.status === 'pending' &&
                transaction.type === 'registration',
            ),
            registeredDescription: registrationOption.registeredDescription,
            registrationOptionId: registration.registrationOptionId,
            registrationOptionTitle: registrationOption.title,
            status: registration.status,
          };
        });

        return {
          isRegistered: registrations.length > 0,
          registrations: registrationSummaries,
        };
      }),
    'events.registerForEvent': ({ eventId, registrationOptionId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        return yield* EventRegistrationService.registerForEvent({
          eventId,
          headers: options.headers,
          registrationOptionId,
          tenant: {
            currency: tenant.currency,
            id: tenant.id,
            stripeAccountId: tenant.stripeAccountId,
          },
          user: {
            email: user.email,
            id: user.id,
          },
        }).pipe(
          Effect.catchAll((error) =>
            Effect.fail(mapEventRegistrationErrorToRpc(error)),
          ),
        );
      }),
    'events.registrationScanned': ({ registrationId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const registration = yield* databaseEffect((database) =>
          database.query.eventRegistrations.findFirst({
            columns: {
              appliedDiscountedPrice: true,
              appliedDiscountType: true,
              status: true,
              userId: true,
            },
            where: { id: registrationId, tenantId: tenant.id },
            with: {
              event: {
                columns: {
                  start: true,
                  title: true,
                },
              },
              registrationOption: {
                columns: {
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
                  firstName: true,
                  lastName: true,
                },
              },
            },
          }),
        );
        if (!registration || !registration.user || !registration.event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const sameUserIssue = registration.userId === user.id;
        const registrationStatusIssue = registration.status !== 'CONFIRMED';
        const allowCheckin = !registrationStatusIssue && !sameUserIssue;
        const discountedTransaction = registration.transactions.find(
          (transaction) =>
            transaction.amount < registration.registrationOption.price,
        );
        const appliedDiscountedPrice =
          registration.appliedDiscountedPrice ??
          discountedTransaction?.amount ??
          null;
        const appliedDiscountType =
          registration.appliedDiscountType ??
          (appliedDiscountedPrice === null ? null : ('esnCard' as const));

        return {
          allowCheckin,
          appliedDiscountType,
          event: {
            start: registration.event.start.toISOString(),
            title: registration.event.title,
          },
          registrationOption: {
            title: registration.registrationOption.title,
          },
          registrationStatusIssue,
          sameUserIssue,
          user: {
            firstName: registration.user.firstName,
            lastName: registration.user.lastName,
          },
        };
      }),
    'events.reviewEvent': ({ approved, comment, eventId }, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'events:review');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const reviewedEvents = yield* databaseEffect((database) =>
          database
            .update(eventInstances)
            .set({
              reviewedAt: new Date(),
              reviewedBy: user.id,
              status: approved ? 'APPROVED' : 'REJECTED',
              statusComment: comment || null,
            })
            .where(
              and(
                eq(eventInstances.id, eventId),
                eq(eventInstances.tenantId, tenant.id),
                eq(eventInstances.status, 'PENDING_REVIEW'),
              ),
            )
            .returning({
              id: eventInstances.id,
            }),
        );
        if (reviewedEvents.length > 0) {
          return;
        }

        const event = yield* databaseEffect((database) =>
          database.query.eventInstances.findFirst({
            columns: { id: true },
            where: {
              id: eventId,
              tenantId: tenant.id,
            },
          }),
        );
        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        return yield* Effect.fail('CONFLICT' as const);
      }),
    'events.submitForReview': ({ eventId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const event = yield* databaseEffect((database) =>
          database.query.eventInstances.findFirst({
            columns: {
              creatorId: true,
              id: true,
              status: true,
            },
            where: {
              id: eventId,
              tenantId: tenant.id,
            },
          }),
        );
        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        if (
          !canEditEvent({
            creatorId: event.creatorId,
            permissions: user.permissions,
            userId: user.id,
          })
        ) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }
        if (event.status !== 'DRAFT' && event.status !== 'REJECTED') {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const submittedEvents = yield* databaseEffect((database) =>
          database
            .update(eventInstances)
            .set({
              reviewedAt: null,
              reviewedBy: null,
              status: 'PENDING_REVIEW',
              statusComment: null,
            })
            .where(
              and(
                eq(eventInstances.id, eventId),
                eq(eventInstances.tenantId, tenant.id),
                inArray(eventInstances.status, ['DRAFT', 'REJECTED']),
              ),
            )
            .returning({
              id: eventInstances.id,
            }),
        );
        if (submittedEvents.length > 0) {
          return;
        }

        return yield* Effect.fail('CONFLICT' as const);
      }),
    'events.update': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const start = new Date(input.start);
        const end = new Date(input.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const sanitizedDescription = sanitizeRichTextHtml(input.description);
        if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
          return yield* Effect.fail('BAD_REQUEST' as const);
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
          return yield* Effect.fail('NOT_FOUND' as const);
        }
        if (
          !canEditEvent({
            creatorId: event.creatorId,
            permissions: user.permissions,
            userId: user.id,
          })
        ) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }
        if (
          !EDITABLE_EVENT_STATUSES.includes(
            event.status as (typeof EDITABLE_EVENT_STATUSES)[number],
          )
        ) {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const esnCardEnabledForTenant = isEsnCardEnabled(
          tenant.discountProviders ?? null,
        );

        for (const option of sanitizedRegistrationOptions) {
          if (
            Number.isNaN(option.closeRegistrationTime.getTime()) ||
            Number.isNaN(option.openRegistrationTime.getTime())
          ) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          const validation = yield* databaseEffect((database) =>
            validateTaxRate(database, {
              isPaid: option.isPaid,
              stripeTaxRateId: option.stripeTaxRateId ?? null,
              tenantId: tenant.id,
            }),
          );
          if (!validation.success) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          if (
            option.esnCardDiscountedPrice !== null &&
            option.esnCardDiscountedPrice > option.price
          ) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          if (
            option.esnCardDiscountedPrice !== null &&
            !esnCardEnabledForTenant &&
            option.isPaid
          ) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          if (option.spots < 0) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }
        }

        const updatedEvent = yield* databaseEffect((database) =>
          database.transaction((tx) =>
            Effect.gen(function* () {
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
                    inArray(eventInstances.status, [
                      ...EDITABLE_EVENT_STATUSES,
                    ]),
                  ),
                )
                .returning({
                  id: eventInstances.id,
                });
              const eventRow = updatedEvents[0];
              if (!eventRow) {
                return yield* Effect.fail('CONFLICT' as const);
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
                if (!existingRegistrationOptionIds.has(option.id)) {
                  return yield* Effect.fail('BAD_REQUEST' as const);
                }
              }

              for (const option of sanitizedRegistrationOptions) {
                yield* tx
                  .update(eventRegistrationOptions)
                  .set({
                    closeRegistrationTime: option.closeRegistrationTime,
                    description: option.description,
                    isPaid: option.isPaid,
                    openRegistrationTime: option.openRegistrationTime,
                    organizingRegistration: option.organizingRegistration,
                    price: option.price,
                    registeredDescription: option.registeredDescription,
                    registrationMode: option.registrationMode,
                    roleIds: [...option.roleIds],
                    spots: option.spots,
                    stripeTaxRateId: option.stripeTaxRateId ?? null,
                    title: option.title,
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
          Effect.catchAll((error) =>
            error === 'BAD_REQUEST' || error === 'CONFLICT'
              ? Effect.fail(error)
              : Effect.fail('INTERNAL_SERVER_ERROR' as const),
          ),
        );

        return {
          id: updatedEvent.id,
        };
      }),
    'events.updateListing': ({ eventId, unlisted }, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'events:changeListing');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );

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
