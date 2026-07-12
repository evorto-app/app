import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { type PlatformAuditSnapshot } from '@shared/platform-audit';
import {
  type PlatformTemplatesCreateInput,
  type PlatformTemplatesUpdateInput,
} from '@shared/rpc-contracts/app-rpcs/platform-events.rpcs';
import { type TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';
import { and, asc, eq } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  eventTemplateCategories,
  eventTemplates,
} from '../../../../../db/schema';
import { ensureStripeForPaidEventConfiguration } from '../../../../payments/paid-event-configuration';
import { lockTenantRoleGraph } from '../../../../roles/tenant-role-graph';
import { lockTenantCurrencyForFinancialConfiguration } from '../../../../tenant-currency-integrity';
import {
  providePlatformOperation,
  resolvePlatformMutation,
  resolvePlatformRead,
  writePlatformAudit,
} from '../shared/platform-operation.service';
import {
  loadTemplateGraphDetail,
  templateGraphNotFoundError,
} from '../templates/template-graph.query';
import { TemplateGraphService } from '../templates/template-graph.service';

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
      includedQuantity: Schema.Number,
      optionalPurchaseQuantity: Schema.Number,
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
              yield* ensureStripeForPaidEventConfiguration(
                transaction,
                targetTenantId,
                {
                  addOns: templateInput.addOns,
                  registrationOptions: templateInput.registrationOptions,
                },
              );
              yield* lockTenantRoleGraph(transaction, targetTenantId).pipe(
                Effect.orDie,
              );
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
              const after = yield* loadTemplateGraphDetail(
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
          loadTemplateGraphDetail(
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
              yield* ensureStripeForPaidEventConfiguration(
                transaction,
                targetTenantId,
                {
                  addOns: templateInput.addOns,
                  registrationOptions: templateInput.registrationOptions,
                },
              );
              yield* lockTenantRoleGraph(transaction, targetTenantId).pipe(
                Effect.orDie,
              );
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
                return yield* Effect.fail(
                  templateGraphNotFoundError(templateId),
                );
              }
              const before = yield* loadTemplateGraphDetail(
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
              const after = yield* loadTemplateGraphDetail(
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
