import type { EventGraphEditRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { and, asc, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';

import type { DatabaseClient } from '../../../../../db';

import {
  addonToEventRegistrationOptions,
  eventAddons,
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrationQuestions,
} from '../../../../../db/schema';

export const loadEventGraphDetail = Effect.fn('Events.loadEventGraphDetail')(
  function* (
    database: DatabaseClient,
    tenantId: string,
    eventId: string,
  ): Effect.fn.Return<EventGraphEditRecord | null> {
    const events = yield* database
      .select({
        description: eventInstances.description,
        end: eventInstances.end,
        icon: eventInstances.icon,
        id: eventInstances.id,
        location: eventInstances.location,
        simpleModeEnabled: eventInstances.simpleModeEnabled,
        start: eventInstances.start,
        title: eventInstances.title,
      })
      .from(eventInstances)
      .where(
        and(
          eq(eventInstances.id, eventId),
          eq(eventInstances.tenantId, tenantId),
        ),
      )
      .limit(1)
      .pipe(Effect.orDie);
    const event = events[0];
    if (!event) return null;

    const registrationOptions = yield* database
      .select({
        cancellationDeadlineHoursBeforeStart:
          eventRegistrationOptions.cancellationDeadlineHoursBeforeStart,
        closeRegistrationTime: eventRegistrationOptions.closeRegistrationTime,
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
          eq(eventRegistrationOptions.eventId, eventId),
          eq(eventInstances.tenantId, tenantId),
        ),
      )
      .orderBy(asc(eventRegistrationOptions.createdAt))
      .pipe(Effect.orDie);
    const optionIds = registrationOptions.map((option) => option.id);
    const discounts =
      optionIds.length === 0
        ? []
        : yield* database
            .select({
              discountedPrice: eventRegistrationOptionDiscounts.discountedPrice,
              registrationOptionId:
                eventRegistrationOptionDiscounts.registrationOptionId,
            })
            .from(eventRegistrationOptionDiscounts)
            .where(
              and(
                eq(eventRegistrationOptionDiscounts.discountType, 'esnCard'),
                inArray(
                  eventRegistrationOptionDiscounts.registrationOptionId,
                  optionIds,
                ),
              ),
            )
            .pipe(Effect.orDie);
    const discountByOptionId = new Map(
      discounts.map((discount) => [
        discount.registrationOptionId,
        discount.discountedPrice,
      ]),
    );

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
          eq(eventAddons.eventId, eventId),
          eq(eventInstances.tenantId, tenantId),
        ),
      )
      .orderBy(asc(eventAddons.createdAt))
      .pipe(Effect.orDie);
    const addOnIds = addOns.map((addOn) => addOn.id);
    const mappings =
      addOnIds.length === 0
        ? []
        : yield* database
            .select({
              addonId: addonToEventRegistrationOptions.addonId,
              includedQuantity:
                addonToEventRegistrationOptions.includedQuantity,
              optionalPurchaseQuantity:
                addonToEventRegistrationOptions.optionalPurchaseQuantity,
              registrationOptionId:
                addonToEventRegistrationOptions.registrationOptionId,
            })
            .from(addonToEventRegistrationOptions)
            .where(
              and(
                eq(addonToEventRegistrationOptions.eventId, eventId),
                inArray(addonToEventRegistrationOptions.addonId, addOnIds),
              ),
            )
            .pipe(Effect.orDie);
    const mappingsByAddOnId = new Map<
      string,
      {
        includedQuantity: number;
        optionalPurchaseQuantity: number;
        registrationOptionId: string;
      }[]
    >();
    for (const mapping of mappings) {
      const current = mappingsByAddOnId.get(mapping.addonId) ?? [];
      current.push({
        includedQuantity: mapping.includedQuantity,
        optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
        registrationOptionId: mapping.registrationOptionId,
      });
      mappingsByAddOnId.set(mapping.addonId, current);
    }

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
          eq(eventRegistrationQuestions.eventId, eventId),
          eq(eventInstances.tenantId, tenantId),
        ),
      )
      .orderBy(asc(eventRegistrationQuestions.sortOrder))
      .pipe(Effect.orDie);

    return {
      addOns: addOns.map((addOn) => ({
        ...addOn,
        description: addOn.description ?? null,
        registrationOptions: mappingsByAddOnId.get(addOn.id) ?? [],
        stripeTaxRateId: addOn.stripeTaxRateId ?? null,
      })),
      description: event.description,
      end: event.end.toISOString(),
      icon: event.icon,
      id: event.id,
      location: event.location ?? null,
      questions: questions.map((question) => ({
        ...question,
        description: question.description ?? null,
      })),
      registrationOptions: registrationOptions.map((option) => ({
        ...option,
        closeRegistrationTime: option.closeRegistrationTime.toISOString(),
        description: option.description ?? null,
        esnCardDiscountedPrice: discountByOptionId.get(option.id) ?? null,
        openRegistrationTime: option.openRegistrationTime.toISOString(),
        registeredDescription: option.registeredDescription ?? null,
        roleIds: [...option.roleIds],
        stripeTaxRateId: option.stripeTaxRateId ?? null,
      })),
      simpleModeEnabled: event.simpleModeEnabled,
      start: event.start.toISOString(),
      title: event.title,
    };
  },
);
