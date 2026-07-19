import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { type TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';

import type { DatabaseClient } from '../../../../../db';

import {
  addonToTemplateRegistrationOptions,
  eventTemplates,
  roles,
  templateEventAddons,
  templateRegistrationOptionDiscounts,
  templateRegistrationOptions,
  templateRegistrationQuestions,
} from '../../../../../db/schema';

type TemplateGraphReader = Pick<DatabaseClient, 'select'>;

export const templateGraphNotFoundError = (templateId: string) =>
  new RpcBadRequestError({
    message: `Template ${templateId} was not found for the target tenant`,
    reason: 'templateNotFound',
  });

export const loadTemplateGraphDetail = Effect.fn(
  'Templates.loadTemplateGraphDetail',
)(function* (
  database: TemplateGraphReader,
  tenantId: string,
  templateId: string,
) {
  const templates = yield* database
    .select({
      categoryId: eventTemplates.categoryId,
      description: eventTemplates.description,
      icon: eventTemplates.icon,
      id: eventTemplates.id,
      location: eventTemplates.location,
      planningTips: eventTemplates.planningTips,
      simpleModeEnabled: eventTemplates.simpleModeEnabled,
      title: eventTemplates.title,
      unlisted: eventTemplates.unlisted,
    })
    .from(eventTemplates)
    .where(
      and(
        eq(eventTemplates.id, templateId),
        eq(eventTemplates.tenantId, tenantId),
      ),
    )
    .limit(1)
    .pipe(Effect.orDie);
  const template = templates[0];
  if (!template) {
    return yield* Effect.fail(templateGraphNotFoundError(templateId));
  }

  const registrationOptions = yield* database
    .select({
      cancellationDeadlineHoursBeforeStart:
        templateRegistrationOptions.cancellationDeadlineHoursBeforeStart,
      closeRegistrationOffset:
        templateRegistrationOptions.closeRegistrationOffset,
      description: templateRegistrationOptions.description,
      id: templateRegistrationOptions.id,
      isPaid: templateRegistrationOptions.isPaid,
      openRegistrationOffset:
        templateRegistrationOptions.openRegistrationOffset,
      organizingRegistration:
        templateRegistrationOptions.organizingRegistration,
      price: templateRegistrationOptions.price,
      refundFeesOnCancellation:
        templateRegistrationOptions.refundFeesOnCancellation,
      registeredDescription: templateRegistrationOptions.registeredDescription,
      registrationMode: templateRegistrationOptions.registrationMode,
      roleIds: templateRegistrationOptions.roleIds,
      spots: templateRegistrationOptions.spots,
      stripeTaxRateId: templateRegistrationOptions.stripeTaxRateId,
      title: templateRegistrationOptions.title,
      transferDeadlineHoursBeforeStart:
        templateRegistrationOptions.transferDeadlineHoursBeforeStart,
    })
    .from(templateRegistrationOptions)
    .innerJoin(
      eventTemplates,
      eq(eventTemplates.id, templateRegistrationOptions.templateId),
    )
    .where(
      and(
        eq(eventTemplates.id, templateId),
        eq(eventTemplates.tenantId, tenantId),
      ),
    )
    .pipe(Effect.orDie);
  const registrationOptionIds = registrationOptions.map((option) => option.id);
  const roleIds = [
    ...new Set(registrationOptions.flatMap((option) => option.roleIds)),
  ];
  const tenantRoles =
    roleIds.length === 0
      ? []
      : yield* database
          .select({ id: roles.id, name: roles.name })
          .from(roles)
          .where(and(eq(roles.tenantId, tenantId), inArray(roles.id, roleIds)))
          .pipe(Effect.orDie);
  const rolesById = new Map(tenantRoles.map((role) => [role.id, role]));

  const optionDiscounts =
    registrationOptionIds.length === 0
      ? []
      : yield* database
          .select({
            discountedPrice:
              templateRegistrationOptionDiscounts.discountedPrice,
            registrationOptionId:
              templateRegistrationOptionDiscounts.registrationOptionId,
          })
          .from(templateRegistrationOptionDiscounts)
          .innerJoin(
            templateRegistrationOptions,
            eq(
              templateRegistrationOptions.id,
              templateRegistrationOptionDiscounts.registrationOptionId,
            ),
          )
          .innerJoin(
            eventTemplates,
            eq(eventTemplates.id, templateRegistrationOptions.templateId),
          )
          .where(
            and(
              eq(eventTemplates.id, templateId),
              eq(eventTemplates.tenantId, tenantId),
              eq(templateRegistrationOptionDiscounts.discountType, 'esnCard'),
            ),
          )
          .pipe(Effect.orDie);
  const esnDiscountByOptionId = new Map(
    optionDiscounts.map((discount) => [
      discount.registrationOptionId,
      discount.discountedPrice,
    ]),
  );

  const questions = yield* database
    .select({
      description: templateRegistrationQuestions.description,
      id: templateRegistrationQuestions.id,
      registrationOptionId: templateRegistrationQuestions.registrationOptionId,
      required: templateRegistrationQuestions.required,
      sortOrder: templateRegistrationQuestions.sortOrder,
      title: templateRegistrationQuestions.title,
    })
    .from(templateRegistrationQuestions)
    .innerJoin(
      eventTemplates,
      eq(eventTemplates.id, templateRegistrationQuestions.templateId),
    )
    .where(
      and(
        eq(eventTemplates.id, templateId),
        eq(eventTemplates.tenantId, tenantId),
      ),
    )
    .orderBy(asc(templateRegistrationQuestions.sortOrder))
    .pipe(Effect.orDie);

  const addOns = yield* database
    .select({
      allowMultiple: templateEventAddons.allowMultiple,
      allowPurchaseBeforeEvent: templateEventAddons.allowPurchaseBeforeEvent,
      allowPurchaseDuringEvent: templateEventAddons.allowPurchaseDuringEvent,
      allowPurchaseDuringRegistration:
        templateEventAddons.allowPurchaseDuringRegistration,
      description: templateEventAddons.description,
      id: templateEventAddons.id,
      isPaid: templateEventAddons.isPaid,
      maxQuantityPerUser: templateEventAddons.maxQuantityPerUser,
      price: templateEventAddons.price,
      stripeTaxRateId: templateEventAddons.stripeTaxRateId,
      title: templateEventAddons.title,
      totalAvailableQuantity: templateEventAddons.totalAvailableQuantity,
    })
    .from(templateEventAddons)
    .innerJoin(
      eventTemplates,
      eq(eventTemplates.id, templateEventAddons.templateId),
    )
    .where(
      and(
        eq(eventTemplates.id, templateId),
        eq(eventTemplates.tenantId, tenantId),
      ),
    )
    .orderBy(asc(templateEventAddons.createdAt))
    .pipe(Effect.orDie);
  const addOnIds = addOns.map((addOn) => addOn.id);
  const addOnRegistrationOptions =
    addOnIds.length === 0
      ? []
      : yield* database
          .select({
            addonId: addonToTemplateRegistrationOptions.addonId,
            includedQuantity:
              addonToTemplateRegistrationOptions.includedQuantity,
            optionalPurchaseQuantity:
              addonToTemplateRegistrationOptions.optionalPurchaseQuantity,
            registrationOptionId:
              addonToTemplateRegistrationOptions.registrationOptionId,
          })
          .from(addonToTemplateRegistrationOptions)
          .innerJoin(
            templateEventAddons,
            eq(
              templateEventAddons.id,
              addonToTemplateRegistrationOptions.addonId,
            ),
          )
          .innerJoin(
            eventTemplates,
            eq(eventTemplates.id, templateEventAddons.templateId),
          )
          .where(
            and(
              eq(eventTemplates.id, templateId),
              eq(eventTemplates.tenantId, tenantId),
              inArray(addonToTemplateRegistrationOptions.addonId, addOnIds),
            ),
          )
          .pipe(Effect.orDie);
  const addOnRegistrationOptionsByAddonId = new Map<
    string,
    {
      includedQuantity: number;
      optionalPurchaseQuantity: number;
      registrationOptionId: string;
    }[]
  >();
  for (const registrationOption of addOnRegistrationOptions) {
    const current =
      addOnRegistrationOptionsByAddonId.get(registrationOption.addonId) ?? [];
    current.push({
      includedQuantity: registrationOption.includedQuantity,
      optionalPurchaseQuantity: registrationOption.optionalPurchaseQuantity,
      registrationOptionId: registrationOption.registrationOptionId,
    });
    addOnRegistrationOptionsByAddonId.set(registrationOption.addonId, current);
  }

  return {
    addOns: addOns.map((addOn) => ({
      ...addOn,
      description: addOn.description ?? null,
      registrationOptions:
        addOnRegistrationOptionsByAddonId.get(addOn.id) ?? [],
      stripeTaxRateId: addOn.stripeTaxRateId ?? null,
    })),
    categoryId: template.categoryId,
    description: template.description,
    icon: template.icon,
    id: template.id,
    location: template.location ?? null,
    planningTips: template.planningTips?.trim() || null,
    questions: questions.map((question) => ({
      ...question,
      description: question.description ?? null,
    })),
    registrationOptions: registrationOptions.map((option) => ({
      ...option,
      description: option.description ?? null,
      esnCardDiscountedPrice: esnDiscountByOptionId.get(option.id) ?? null,
      registeredDescription: option.registeredDescription ?? null,
      roles: option.roleIds.flatMap((roleId) => {
        const role = rolesById.get(roleId);
        return role ? [role] : [];
      }),
      stripeTaxRateId: option.stripeTaxRateId ?? null,
    })),
    simpleModeEnabled: template.simpleModeEnabled,
    title: template.title,
    unlisted: template.unlisted,
  } satisfies TemplateGraphRecord;
});
