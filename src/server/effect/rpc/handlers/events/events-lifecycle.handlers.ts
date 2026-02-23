import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import {
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  templateRegistrationOptionDiscounts,
} from '../../../../../db/schema';
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
  EDITABLE_EVENT_STATUSES,
  type EventRegistrationOptionDiscountInsert,
  isEsnCardEnabled,
} from './events.shared';

export const eventLifecycleHandlers = {
'events.create': (input, _options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensurePermission('events:create');
        const { tenant } = yield* RpcAccess.current();
        const user = yield* RpcAccess.requireUser();

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
'events.update': (input, _options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensureAuthenticated();
        const { tenant } = yield* RpcAccess.current();
        const user = yield* RpcAccess.requireUser();

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
