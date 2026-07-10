import {
  TemplateSimpleBadRequestError,
  TemplateSimpleInternalError,
  TemplateSimpleNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/templates.errors';
import { inArray } from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import {
  addonToTemplateRegistrationOptions,
  eventTemplates,
  templateRegistrationOptionDiscounts,
} from '../../../../db/schema';
import { lockTenantCurrencyForFinancialConfiguration } from '../../../tenant-currency-integrity';
import { RpcAccess } from './shared/rpc-access.service';
import { SimpleTemplateService } from './templates/simple-template.service';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

const isExpectedTemplateWriteError = (
  error: unknown,
): error is
  | TemplateSimpleBadRequestError
  | TemplateSimpleInternalError
  | TemplateSimpleNotFoundError =>
  error instanceof TemplateSimpleBadRequestError ||
  error instanceof TemplateSimpleInternalError ||
  error instanceof TemplateSimpleNotFoundError;

export const normalizeTemplateFindOneRecord = (
  template: {
    addOns: readonly {
      allowMultiple: boolean;
      allowPurchaseBeforeEvent: boolean;
      allowPurchaseDuringEvent: boolean;
      allowPurchaseDuringRegistration: boolean;
      description: null | string;
      id: string;
      isPaid: boolean;
      maxQuantityPerUser: number;
      price: number;
      stripeTaxRateId: null | string;
      title: string;
      totalAvailableQuantity: number;
    }[];
    categoryId: string;
    description: string;
    icon: typeof eventTemplates.$inferSelect.icon;
    id: string;
    location: typeof eventTemplates.$inferSelect.location;
    planningTips: null | string;
    questions: readonly {
      description: null | string;
      id: string;
      registrationOptionId: string;
      required: boolean;
      sortOrder: number;
      title: string;
    }[];
    registrationOptions: readonly {
      cancellationDeadlineHoursBeforeStart: null | number;
      closeRegistrationOffset: number;
      description: null | string;
      id: string;
      isPaid: boolean;
      openRegistrationOffset: number;
      organizingRegistration: boolean;
      price: number;
      refundFeesOnCancellation: boolean | null;
      registeredDescription: null | string;
      registrationMode: 'application' | 'fcfs' | 'random';
      roleIds: string[];
      spots: number;
      stripeTaxRateId: null | string;
      title: string;
      transferDeadlineHoursBeforeStart: null | number;
    }[];
    title: string;
  },
  rolesById: ReadonlyMap<string, { id: string; name: string }>,
  esnDiscountByOptionId: ReadonlyMap<string, number>,
  addonRegistrationOptionsByAddonId: ReadonlyMap<
    string,
    {
      includedQuantity: number;
      optionalPurchaseQuantity: number;
      registrationOptionId: string;
    }[]
  >,
): {
  addOns: {
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
    title: string;
    totalAvailableQuantity: number;
  }[];
  categoryId: string;
  description: string;
  icon: typeof eventTemplates.$inferSelect.icon;
  id: string;
  location: null | typeof eventTemplates.$inferSelect.location;
  planningTips: null | string;
  questions: {
    description: null | string;
    id: string;
    registrationOptionId: string;
    required: boolean;
    sortOrder: number;
    title: string;
  }[];
  registrationOptions: {
    cancellationDeadlineHoursBeforeStart: null | number;
    closeRegistrationOffset: number;
    description: null | string;
    esnCardDiscountedPrice: null | number;
    id: string;
    isPaid: boolean;
    openRegistrationOffset: number;
    organizingRegistration: boolean;
    price: number;
    refundFeesOnCancellation: boolean | null;
    registeredDescription: null | string;
    registrationMode: 'application' | 'fcfs' | 'random';
    roleIds: string[];
    roles: { id: string; name: string }[];
    spots: number;
    stripeTaxRateId: null | string;
    title: string;
    transferDeadlineHoursBeforeStart: null | number;
  }[];
  title: string;
} => ({
  addOns: template.addOns.map((addOn) => ({
    allowMultiple: addOn.allowMultiple,
    allowPurchaseBeforeEvent: addOn.allowPurchaseBeforeEvent,
    allowPurchaseDuringEvent: addOn.allowPurchaseDuringEvent,
    allowPurchaseDuringRegistration: addOn.allowPurchaseDuringRegistration,
    description: addOn.description ?? null,
    id: addOn.id,
    isPaid: addOn.isPaid,
    maxQuantityPerUser: addOn.maxQuantityPerUser,
    price: addOn.price,
    registrationOptions: addonRegistrationOptionsByAddonId.get(addOn.id) ?? [],
    stripeTaxRateId: addOn.stripeTaxRateId ?? null,
    title: addOn.title,
    totalAvailableQuantity: addOn.totalAvailableQuantity,
  })),
  categoryId: template.categoryId,
  description: template.description,
  icon: template.icon,
  id: template.id,
  location: template.location ?? null,
  planningTips: template.planningTips?.trim() || null,
  questions: template.questions.map((question) => ({
    description: question.description ?? null,
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
    description: option.description ?? null,
    esnCardDiscountedPrice: esnDiscountByOptionId.get(option.id) ?? null,
    id: option.id,
    isPaid: option.isPaid,
    openRegistrationOffset: option.openRegistrationOffset,
    organizingRegistration: option.organizingRegistration,
    price: option.price,
    refundFeesOnCancellation: option.refundFeesOnCancellation,
    registeredDescription: option.registeredDescription ?? null,
    registrationMode: option.registrationMode,
    roleIds: option.roleIds,
    roles: option.roleIds.flatMap((roleId) => {
      const role = rolesById.get(roleId);
      return role ? [{ id: role.id, name: role.name }] : [];
    }),
    spots: option.spots,
    stripeTaxRateId: option.stripeTaxRateId ?? null,
    title: option.title,
    transferDeadlineHoursBeforeStart: option.transferDeadlineHoursBeforeStart,
  })),
  title: template.title,
});

export const templateHandlers = {
  'templates.createSimpleTemplate': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:create');
      const { tenant } = yield* RpcAccess.current();

      return yield* Database.use((database) =>
        database
          .transaction((transaction) => {
            const transactionalDatabase = Object.assign(transaction, {
              $client: database.$client,
            });
            return Effect.gen(function* () {
              yield* lockTenantCurrencyForFinancialConfiguration(
                transaction,
                tenant.id,
                tenant.currency,
              ).pipe(
                Effect.catchTag('RpcBadRequestError', (error) =>
                  Effect.fail(
                    new TemplateSimpleBadRequestError({
                      message: `${error.message}. ${error.reason ?? ''}`.trim(),
                    }),
                  ),
                ),
              );
              return yield* SimpleTemplateService.createSimpleTemplate({
                esnCardEnabled:
                  tenant.discountProviders?.esnCard?.status === 'enabled',
                input,
                tenantId: tenant.id,
              }).pipe(Effect.provideService(Database, transactionalDatabase));
            });
          })
          .pipe(
            Effect.catch((error) =>
              isExpectedTemplateWriteError(error)
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
      );
    }),
  'templates.findOne': ({ id }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:view');
      const { tenant } = yield* RpcAccess.current();
      const template = yield* databaseEffect((database) =>
        database.query.eventTemplates.findFirst({
          columns: {
            categoryId: true,
            description: true,
            icon: true,
            id: true,
            location: true,
            planningTips: true,
            title: true,
          },
          where: {
            id,
            tenantId: tenant.id,
          },
          with: {
            questions: {
              columns: {
                description: true,
                id: true,
                registrationOptionId: true,
                required: true,
                sortOrder: true,
                title: true,
              },
              orderBy: { sortOrder: 'asc' },
            },
            registrationOptions: {
              columns: {
                cancellationDeadlineHoursBeforeStart: true,
                closeRegistrationOffset: true,
                description: true,
                id: true,
                isPaid: true,
                openRegistrationOffset: true,
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
      if (!template) {
        return yield* Effect.fail(
          new TemplateSimpleNotFoundError({ message: 'Template not found' }),
        );
      }

      const combinedRegistrationOptionRoleIds =
        template.registrationOptions.flatMap((option) => option.roleIds);
      const templateRoles =
        combinedRegistrationOptionRoleIds.length > 0
          ? yield* databaseEffect((database) =>
              database.query.roles.findMany({
                columns: {
                  id: true,
                  name: true,
                },
                where: {
                  id: {
                    in: combinedRegistrationOptionRoleIds,
                  },
                  tenantId: tenant.id,
                },
              }),
            )
          : [];
      const rolesById = new Map(
        templateRoles.map((role) => [
          role.id,
          { id: role.id, name: role.name },
        ]),
      );
      const templateRegistrationOptionIds = template.registrationOptions.map(
        (option) => option.id,
      );
      const optionDiscounts =
        templateRegistrationOptionIds.length > 0
          ? yield* databaseEffect((database) =>
              database
                .select({
                  discountedPrice:
                    templateRegistrationOptionDiscounts.discountedPrice,
                  registrationOptionId:
                    templateRegistrationOptionDiscounts.registrationOptionId,
                })
                .from(templateRegistrationOptionDiscounts)
                .where(
                  inArray(
                    templateRegistrationOptionDiscounts.registrationOptionId,
                    templateRegistrationOptionIds,
                  ),
                ),
            )
          : [];
      const esnDiscountByOptionId = new Map(
        optionDiscounts.map((discount) => [
          discount.registrationOptionId,
          discount.discountedPrice,
        ]),
      );
      const addOns = yield* databaseEffect((database) =>
        database.query.templateEventAddons.findMany({
          columns: {
            allowMultiple: true,
            allowPurchaseBeforeEvent: true,
            allowPurchaseDuringEvent: true,
            allowPurchaseDuringRegistration: true,
            description: true,
            id: true,
            isPaid: true,
            maxQuantityPerUser: true,
            price: true,
            stripeTaxRateId: true,
            title: true,
            totalAvailableQuantity: true,
          },
          orderBy: { createdAt: 'asc' },
          where: {
            templateId: id,
          },
        }),
      );
      const addOnIds = addOns.map((addOn) => addOn.id);
      const addonRegistrationOptions =
        addOnIds.length > 0
          ? yield* databaseEffect((database) =>
              database
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
                .where(
                  inArray(addonToTemplateRegistrationOptions.addonId, addOnIds),
                ),
            )
          : [];
      const addonRegistrationOptionsByAddonId = new Map<
        string,
        {
          includedQuantity: number;
          optionalPurchaseQuantity: number;
          registrationOptionId: string;
        }[]
      >();
      for (const addonRegistrationOption of addonRegistrationOptions) {
        const existing =
          addonRegistrationOptionsByAddonId.get(
            addonRegistrationOption.addonId,
          ) ?? [];
        existing.push({
          includedQuantity: addonRegistrationOption.includedQuantity,
          optionalPurchaseQuantity:
            addonRegistrationOption.optionalPurchaseQuantity,
          registrationOptionId: addonRegistrationOption.registrationOptionId,
        });
        addonRegistrationOptionsByAddonId.set(
          addonRegistrationOption.addonId,
          existing,
        );
      }

      return normalizeTemplateFindOneRecord(
        { ...template, addOns },
        rolesById,
        esnDiscountByOptionId,
        addonRegistrationOptionsByAddonId,
      );
    }),
  'templates.groupedByCategory': (_payload, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:view');
      const { tenant } = yield* RpcAccess.current();
      const templateCategories = yield* databaseEffect((database) =>
        database.query.eventTemplateCategories.findMany({
          columns: {
            icon: true,
            id: true,
            title: true,
          },
          orderBy: (categories, { asc }) => [asc(categories.title)],
          where: { tenantId: tenant.id },
          with: {
            templates: {
              columns: {
                icon: true,
                id: true,
                title: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        }),
      );

      return templateCategories.map((templateCategory) => ({
        icon: templateCategory.icon,
        id: templateCategory.id,
        templates: templateCategory.templates.map((template) => ({
          icon: template.icon,
          id: template.id,
          title: template.title,
        })),
        title: templateCategory.title,
      }));
    }),
  'templates.updateSimpleTemplate': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('templates:editAll');
      const { tenant } = yield* RpcAccess.current();

      return yield* Database.use((database) =>
        database
          .transaction((transaction) => {
            const transactionalDatabase = Object.assign(transaction, {
              $client: database.$client,
            });
            return SimpleTemplateService.updateSimpleTemplate({
              esnCardEnabled:
                tenant.discountProviders?.esnCard?.status === 'enabled',
              input,
              tenantId: tenant.id,
            }).pipe(Effect.provideService(Database, transactionalDatabase));
          })
          .pipe(
            Effect.catch((error) =>
              isExpectedTemplateWriteError(error)
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
      );
    }),
} satisfies Partial<AppRpcHandlers>;
