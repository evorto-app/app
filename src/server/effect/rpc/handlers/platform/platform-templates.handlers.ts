import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { type PlatformAuditSnapshot } from '@shared/platform-audit';
import {
  type PlatformTemplatesCreateInput,
  type PlatformTemplatesUpdateInput,
} from '@shared/rpc-contracts/app-rpcs/platform-events.rpcs';
import { type TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  addonToTemplateRegistrationOptions,
  eventTemplateCategories,
  eventTemplates,
  roles,
  templateEventAddons,
  templateRegistrationOptionDiscounts,
  templateRegistrationOptions,
  templateRegistrationQuestions,
} from '../../../../../db/schema';
import { lockTenantCurrencyForFinancialConfiguration } from '../../../../tenant-currency-integrity';
import {
  providePlatformOperation,
  resolvePlatformMutation,
  resolvePlatformRead,
  writePlatformAudit,
} from '../shared/platform-operation.service';
import { TemplateGraphService } from '../templates/template-graph.service';

type DatabaseReader = Pick<DatabaseClient, 'select'>;

const PlatformTemplateAuditRegistrationOption = Schema.Struct({
  cancellationDeadlineHoursBeforeStart: Schema.NullOr(Schema.Number),
  closeRegistrationOffset: Schema.Number,
  esnCardDiscountedPrice: Schema.NullOr(Schema.Number),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  openRegistrationOffset: Schema.Number,
  organizingRegistration: Schema.Boolean,
  price: Schema.Number,
  refundFeesOnCancellation: Schema.NullOr(Schema.Boolean),
  registrationMode: Schema.Literals(['application', 'fcfs', 'random']),
  roleIds: Schema.Array(Schema.NonEmptyString),
  spots: Schema.Number,
  stripeTaxRateId: Schema.NullOr(Schema.String),
  title: Schema.NonEmptyString,
  transferDeadlineHoursBeforeStart: Schema.NullOr(Schema.Number),
});

const PlatformTemplateAuditAddon = Schema.Struct({
  allowMultiple: Schema.Boolean,
  allowPurchaseBeforeEvent: Schema.Boolean,
  allowPurchaseDuringEvent: Schema.Boolean,
  allowPurchaseDuringRegistration: Schema.Boolean,
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  maxQuantityPerUser: Schema.Number,
  price: Schema.Number,
  registrationOptions: Schema.Array(
    Schema.Struct({
      quantity: Schema.Number,
      registrationOptionId: Schema.NonEmptyString,
    }),
  ),
  stripeTaxRateId: Schema.NullOr(Schema.String),
  title: Schema.NonEmptyString,
  totalAvailableQuantity: Schema.Number,
});

const PlatformTemplateAuditQuestion = Schema.Struct({
  id: Schema.NonEmptyString,
  registrationOptionId: Schema.NonEmptyString,
  required: Schema.Boolean,
  sortOrder: Schema.Number,
  title: Schema.NonEmptyString,
});

const PlatformTemplateAuditState = Schema.Struct({
  addOns: Schema.Array(PlatformTemplateAuditAddon),
  categoryId: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  locationName: Schema.NullOr(Schema.String),
  planningTips: Schema.NullOr(Schema.String),
  questions: Schema.Array(PlatformTemplateAuditQuestion),
  registrationOptions: Schema.Array(PlatformTemplateAuditRegistrationOption),
  simpleModeEnabled: Schema.Boolean,
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

const templateNotFound = (templateId: string) =>
  new RpcBadRequestError({
    message: `Template ${templateId} was not found for the target tenant`,
    reason: 'templateNotFound',
  });

export const loadPlatformTemplateDetail = Effect.fn(
  'PlatformTemplates.loadPlatformTemplateDetail',
)(function* (
  database: DatabaseReader,
  targetTenantId: string,
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
        eq(eventTemplates.tenantId, targetTenantId),
      ),
    )
    .limit(1)
    .pipe(Effect.orDie);
  const template = templates[0];
  if (!template) {
    return yield* Effect.fail(templateNotFound(templateId));
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
        eq(eventTemplates.tenantId, targetTenantId),
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
          .where(
            and(eq(roles.tenantId, targetTenantId), inArray(roles.id, roleIds)),
          )
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
              eq(eventTemplates.tenantId, targetTenantId),
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
        eq(eventTemplates.tenantId, targetTenantId),
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
        eq(eventTemplates.tenantId, targetTenantId),
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
              eq(eventTemplates.tenantId, targetTenantId),
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

export const platformTemplateAuditSnapshot = (
  template: TemplateGraphRecord,
): PlatformAuditSnapshot => ({
  resourceId: template.id,
  resourceType: 'template',
  state: Schema.decodeUnknownSync(PlatformTemplateAuditState)({
    addOns: template.addOns.map((addOn) => ({
      allowMultiple: addOn.allowMultiple,
      allowPurchaseBeforeEvent: addOn.allowPurchaseBeforeEvent,
      allowPurchaseDuringEvent: addOn.allowPurchaseDuringEvent,
      allowPurchaseDuringRegistration: addOn.allowPurchaseDuringRegistration,
      id: addOn.id,
      isPaid: addOn.isPaid,
      maxQuantityPerUser: addOn.maxQuantityPerUser,
      price: addOn.price,
      registrationOptions: addOn.registrationOptions,
      stripeTaxRateId: addOn.stripeTaxRateId,
      title: addOn.title,
      totalAvailableQuantity: addOn.totalAvailableQuantity,
    })),
    categoryId: template.categoryId,
    description: template.description,
    id: template.id,
    locationName: template.location?.name ?? null,
    planningTips: template.planningTips,
    questions: template.questions.map((question) => ({
      id: question.id,
      registrationOptionId: question.registrationOptionId,
      required: question.required,
      sortOrder: question.sortOrder,
      title: question.title,
    })),
    registrationOptions: template.registrationOptions.map((option) => ({
      cancellationDeadlineHoursBeforeStart:
        option.cancellationDeadlineHoursBeforeStart,
      closeRegistrationOffset: option.closeRegistrationOffset,
      esnCardDiscountedPrice: option.esnCardDiscountedPrice,
      id: option.id,
      isPaid: option.isPaid,
      openRegistrationOffset: option.openRegistrationOffset,
      organizingRegistration: option.organizingRegistration,
      price: option.price,
      refundFeesOnCancellation: option.refundFeesOnCancellation,
      registrationMode: option.registrationMode,
      roleIds: option.roleIds,
      spots: option.spots,
      stripeTaxRateId: option.stripeTaxRateId,
      title: option.title,
      transferDeadlineHoursBeforeStart: option.transferDeadlineHoursBeforeStart,
    })),
    simpleModeEnabled: template.simpleModeEnabled,
    title: template.title,
    unlisted: template.unlisted,
  }),
});

export const platformTemplateHandlers = {
  'platform.templates.create': (
    input: PlatformTemplatesCreateInput,
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformMutation(input);
      const { reason: _reason, targetTenantId, ...templateInput } = input;

      return yield* providePlatformOperation(
        databaseEffect((database) =>
          database.transaction((transaction) => {
            const transactionalDatabase = Object.assign(transaction, {
              $client: database.$client,
            });
            return Effect.gen(function* () {
              yield* lockTenantCurrencyForFinancialConfiguration(
                transaction,
                targetTenantId,
                operation.targetTenant.currency,
              );
              const created = yield* TemplateGraphService.createTemplate({
                esnCardEnabled:
                  operation.targetTenant.discountProviders?.esnCard?.status ===
                  'enabled',
                input: templateInput,
                tenantId: targetTenantId,
              }).pipe(Effect.provideService(Database, transactionalDatabase));
              const after = yield* loadPlatformTemplateDetail(
                transaction,
                targetTenantId,
                created.id,
              );
              yield* writePlatformAudit(transaction, {
                action: 'template.create',
                after: platformTemplateAuditSnapshot(after),
                before: null,
              });
              return after;
            });
          }),
        ),
        operation,
        ['templates:create'],
      );
    }),
  'platform.templates.findOne': (
    input: { targetTenantId: string; templateId: string },
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformRead(input.targetTenantId);
      return yield* providePlatformOperation(
        databaseEffect((database) =>
          loadPlatformTemplateDetail(
            database,
            input.targetTenantId,
            input.templateId,
          ),
        ),
        operation,
        [],
      );
    }),
  'platform.templates.formOptions': (
    input: { targetTenantId: string },
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformRead(input.targetTenantId);
      const categories = yield* providePlatformOperation(
        databaseEffect((database) =>
          database
            .select({
              id: eventTemplateCategories.id,
              title: eventTemplateCategories.title,
            })
            .from(eventTemplateCategories)
            .where(eq(eventTemplateCategories.tenantId, input.targetTenantId))
            .orderBy(asc(eventTemplateCategories.title)),
        ),
        operation,
        [],
      );

      return {
        categories,
        esnCardEnabled:
          operation.targetTenant.discountProviders?.esnCard?.status ===
          'enabled',
      };
    }),
  'platform.templates.list': (
    input: { targetTenantId: string },
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformRead(input.targetTenantId);
      return yield* providePlatformOperation(
        databaseEffect((database) =>
          database
            .select({
              categoryTitle: eventTemplateCategories.title,
              icon: eventTemplates.icon,
              id: eventTemplates.id,
              title: eventTemplates.title,
            })
            .from(eventTemplates)
            .innerJoin(
              eventTemplateCategories,
              eq(eventTemplateCategories.id, eventTemplates.categoryId),
            )
            .where(
              and(
                eq(eventTemplates.tenantId, input.targetTenantId),
                eq(eventTemplateCategories.tenantId, input.targetTenantId),
              ),
            )
            .orderBy(
              asc(eventTemplateCategories.title),
              asc(eventTemplates.title),
            ),
        ),
        operation,
        [],
      );
    }),
  'platform.templates.update': (
    input: PlatformTemplatesUpdateInput,
    _options: unknown,
  ) =>
    Effect.gen(function* () {
      const operation = yield* resolvePlatformMutation(input);
      const {
        reason: _reason,
        targetTenantId,
        templateId,
        ...templateInput
      } = input;

      return yield* providePlatformOperation(
        databaseEffect((database) =>
          database.transaction((transaction) => {
            const transactionalDatabase = Object.assign(transaction, {
              $client: database.$client,
            });
            return Effect.gen(function* () {
              const lockedTemplates = yield* transaction
                .select({ id: eventTemplates.id })
                .from(eventTemplates)
                .where(
                  and(
                    eq(eventTemplates.id, templateId),
                    eq(eventTemplates.tenantId, targetTenantId),
                  ),
                )
                .for('update')
                .pipe(Effect.orDie);
              if (lockedTemplates.length === 0) {
                return yield* Effect.fail(templateNotFound(templateId));
              }
              const before = yield* loadPlatformTemplateDetail(
                transaction,
                targetTenantId,
                templateId,
              );
              yield* TemplateGraphService.updateTemplate({
                before,
                esnCardEnabled:
                  operation.targetTenant.discountProviders?.esnCard?.status ===
                  'enabled',
                input: templateInput,
                templateId,
                tenantId: targetTenantId,
              }).pipe(Effect.provideService(Database, transactionalDatabase));
              const after = yield* loadPlatformTemplateDetail(
                transaction,
                targetTenantId,
                templateId,
              );
              yield* writePlatformAudit(transaction, {
                action: 'template.update',
                after: platformTemplateAuditSnapshot(after),
                before: platformTemplateAuditSnapshot(before),
              });
              return after;
            });
          }),
        ),
        operation,
        ['templates:editAll'],
      );
    }),
};
