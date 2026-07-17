import type {
  PlatformAuditSnapshot,
  PlatformTenantAuditAction,
} from '@shared/platform-audit';
import type { GlobalAdminTenantWriteInput } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import type { Headers } from 'effect/unstable/http';

import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { activeRegistrationTransferStatuses } from '@shared/registration-transfer';
import {
  GlobalAdminEmailOutboxOverview,
  GlobalAdminPlatformAuditRecord,
  GlobalAdminTenantRecord,
  type GlobalAdminTenantRecord as GlobalAdminTenantRecordType,
  GlobalAdminTenantUrlMigrationBlockedError,
} from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import { normalizeTenantDomain } from '@shared/tenant-origin';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { createHash } from 'node:crypto';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import {
  emailOutbox,
  platformAuditEntries,
  registrationTransfers,
  tenantPrivacyPolicyVersions,
  tenants,
  tenantStripeTaxRates,
} from '../../../../db/schema';
import { PlatformAdministratorAuthority } from '../../../../types/custom/platform-authority';
import { TENANT_FORMATTING_LOCALE } from '../../../../types/custom/tenant';
import { emailOutboxStaleSendingPredicate } from '../../../notifications/email-outbox-lease';
import { normalizeTenantPrivacyPolicy } from '../../../onboarding/tenant-onboarding.service';
import {
  stripeAccountRemovalBlockedByPaidConfigurationErrorDetails,
  stripeAccountRemovalBlockedByTaxConfigurationErrorDetails,
  tenantHasPaidEventConfiguration,
  tenantHasStripeTaxRateConfiguration,
} from '../../../payments/paid-event-configuration';
import { tenantHasPendingStripeObligations } from '../../../payments/pending-stripe-obligations';
import {
  applyStripeTaxRateAccountRotation,
  fetchStripeTaxRateAccountRotationTargetRates,
  planStripeTaxRateAccountRotation,
  type StripeTaxRateAccountRotationPlan,
  type StripeTaxRateAccountRotationTargetRate,
} from '../../../payments/stripe-tax-rate-account-rotation';
import { StripeClient } from '../../../stripe-client';
import {
  tenantCurrencyChangeBlockedErrorDetails,
  tenantHasCurrencyDependentData,
} from '../../../tenant-currency-integrity';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

const databaseEffectWithTenantUpdateError = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<
  A,
  GlobalAdminTenantUrlMigrationBlockedError | RpcBadRequestError,
  Database
> =>
  Database.use((database) =>
    operation(database).pipe(
      Effect.catch((error) =>
        error instanceof GlobalAdminTenantUrlMigrationBlockedError ||
        error instanceof RpcBadRequestError
          ? Effect.fail(error)
          : Effect.die(error),
      ),
    ),
  );

const ensureAuthenticated = (
  headers: Headers.Headers,
): Effect.Effect<void, RpcUnauthorizedError> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail(
        new RpcUnauthorizedError({ message: 'Authentication required' }),
      );

const decodeHeaderJson = <S extends Schema.ConstraintDecoder<unknown>>(
  value: string | undefined,
  schema: S,
): S['Type'] =>
  Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

const requirePlatformAdministrator = Effect.fn(
  'GlobalAdmin.requirePlatformAdministrator',
)(function* (
  headers: Headers.Headers,
): Effect.fn.Return<
  PlatformAdministratorAuthority,
  RpcForbiddenError | RpcUnauthorizedError
> {
  yield* ensureAuthenticated(headers);
  const authority = yield* Effect.try({
    catch: () =>
      new RpcForbiddenError({
        message: 'Platform administrator authority required',
      }),
    try: () =>
      decodeHeaderJson(
        headers[RPC_CONTEXT_HEADERS.PLATFORM_AUTHORITY],
        Schema.NullOr(PlatformAdministratorAuthority),
      ),
  });

  if (!authority) {
    return yield* new RpcForbiddenError({
      message: 'Platform administrator authority required',
    });
  }

  return authority;
});

const normalizeAuditReason = (reason: string) =>
  Effect.try({
    catch: () =>
      new RpcBadRequestError({
        message: 'A reason is required for platform changes',
      }),
    try: () => {
      const normalizedReason = reason.trim();
      if (!normalizedReason || normalizedReason.length > 500) {
        throw new Error('Invalid platform audit reason');
      }

      return normalizedReason;
    },
  });

const toGlobalAdminPlatformAuditRecord = (entry: {
  action: PlatformTenantAuditAction;
  actorEmail: null | string;
  actorId: string;
  after: null | PlatformAuditSnapshot;
  before: null | PlatformAuditSnapshot;
  createdAt: Date;
  id: string;
  reason: string;
  targetTenantId: string;
  targetTenantName: null | string;
}) =>
  Schema.decodeUnknownSync(GlobalAdminPlatformAuditRecord)({
    ...entry,
    createdAt: entry.createdAt.toISOString(),
  });

const toGlobalAdminTenantRecord = (tenant: {
  currency: string;
  domain: string;
  id: string;
  locale: string;
  name: string;
  stripeAccountId: null | string;
  theme: string;
  timezone: string;
}): GlobalAdminTenantRecordType => {
  return Schema.decodeUnknownSync(GlobalAdminTenantRecord)({
    ...tenant,
    stripeConnected: !!tenant.stripeAccountId,
  });
};

const toPlatformTenantAuditSnapshot = (
  tenant: GlobalAdminTenantRecordType,
  privacyPolicy?: {
    privacyPolicyDigestSha256: string;
    privacyPolicyVersionId: string;
  },
): PlatformAuditSnapshot => ({
  resourceId: tenant.id,
  resourceType: 'tenant',
  state: {
    currency: tenant.currency,
    domain: tenant.domain,
    id: tenant.id,
    locale: tenant.locale,
    name: tenant.name,
    ...privacyPolicy,
    stripeAccountId: tenant.stripeAccountId,
    stripeConnected: tenant.stripeConnected,
    theme: tenant.theme,
    timezone: tenant.timezone,
  },
});

export const tenantPrivacyPolicyDigest = (policy: {
  privacyPolicyText: null | string;
  privacyPolicyUrl: null | string;
}): string =>
  createHash('sha256')
    .update(
      JSON.stringify([policy.privacyPolicyText, policy.privacyPolicyUrl]),
      'utf8',
    )
    .digest('hex');

const normalizeTenantWriteInput = (
  input: GlobalAdminTenantWriteInput,
): GlobalAdminTenantWriteInput => {
  const name = input.name.trim();
  if (!name) {
    throw new Error('Tenant name is required');
  }

  const domain = normalizeTenantDomain(input.domain);

  return {
    currency: input.currency,
    domain,
    name,
    stripeAccountId: input.stripeAccountId?.trim() || undefined,
    theme: input.theme,
    timezone: input.timezone,
  };
};

const normalizeTenantWritePayload = (input: GlobalAdminTenantWriteInput) =>
  Effect.try({
    catch: (error) =>
      new RpcBadRequestError({
        message: 'Invalid tenant settings',
        reason: error instanceof Error ? error.message : String(error),
      }),
    try: () => normalizeTenantWriteInput(input),
  });

const globalAdminTenantColumns = {
  currency: true,
  domain: true,
  id: true,
  locale: true,
  name: true,
  stripeAccountId: true,
  theme: true,
  timezone: true,
} as const;

const globalAdminTenantReturningColumns = {
  currency: tenants.currency,
  domain: tenants.domain,
  id: tenants.id,
  locale: tenants.locale,
  name: tenants.name,
  stripeAccountId: tenants.stripeAccountId,
  theme: tenants.theme,
  timezone: tenants.timezone,
} as const;

const tenantHasActiveRegistrationTransfers = Effect.fn(
  'GlobalAdmin.tenantHasActiveRegistrationTransfers',
)(function* (database: Pick<DatabaseClient, 'select'>, tenantId: string) {
  const activeTransfers = yield* database
    .select({ id: registrationTransfers.id })
    .from(registrationTransfers)
    .where(
      and(
        eq(registrationTransfers.tenantId, tenantId),
        inArray(registrationTransfers.status, [
          ...activeRegistrationTransferStatuses,
        ]),
      ),
    )
    .limit(1);

  return activeTransfers.length > 0;
});

const tenantUrlMigrationBlockedReason = ({
  activeRegistrationTransfers,
  pendingStripeObligations,
}: {
  activeRegistrationTransfers: boolean;
  pendingStripeObligations: boolean;
}): string => {
  if (activeRegistrationTransfers && pendingStripeObligations) {
    return "Complete or cancel every pending Stripe Checkout or refund and every active registration transfer before changing the organization's public URL.";
  }
  if (pendingStripeObligations) {
    return "Complete or cancel every pending Stripe Checkout or refund before changing the organization's public URL.";
  }

  return "Complete or cancel every active registration transfer before changing the organization's public URL.";
};

export const globalAdminHandlers = {
  'globalAdmin.emailOutbox.findOverview': (_payload, options) =>
    Effect.gen(function* () {
      yield* requirePlatformAdministrator(options.headers);
      const now = new Date();
      const [
        statusCounts,
        waitingForRetryRows,
        staleSendingRows,
        exhaustedRows,
        itemRows,
      ] = yield* databaseEffect((database) =>
        Effect.all([
          database
            .select({
              status: emailOutbox.status,
              total: count(),
            })
            .from(emailOutbox)
            .groupBy(emailOutbox.status),
          database
            .select({
              total: count(),
            })
            .from(emailOutbox)
            .where(
              and(
                inArray(emailOutbox.status, ['queued', 'failed']),
                isNull(emailOutbox.exhaustedAt),
                lte(emailOutbox.nextAttemptAt, now),
                sql`${emailOutbox.attempts} < ${emailOutbox.maxAttempts}`,
              ),
            ),
          database
            .select({
              total: count(),
            })
            .from(emailOutbox)
            .where(emailOutboxStaleSendingPredicate()),
          database
            .select({
              total: count(),
            })
            .from(emailOutbox)
            .where(isNotNull(emailOutbox.exhaustedAt)),
          database
            .select({
              attempts: emailOutbox.attempts,
              createdAt: emailOutbox.createdAt,
              deliveryUnknownAt: emailOutbox.deliveryUnknownAt,
              exhaustedAt: emailOutbox.exhaustedAt,
              id: emailOutbox.id,
              kind: emailOutbox.kind,
              lastAttemptAt: emailOutbox.lastAttemptAt,
              lastError: emailOutbox.lastError,
              maxAttempts: emailOutbox.maxAttempts,
              nextAttemptAt: emailOutbox.nextAttemptAt,
              provider: emailOutbox.provider,
              providerMessageId: emailOutbox.providerMessageId,
              recipient: emailOutbox.toEmail,
              sentAt: emailOutbox.sentAt,
              status: emailOutbox.status,
              subject: emailOutbox.subject,
              suppressedAt: emailOutbox.suppressedAt,
              tenantDomain: tenants.domain,
              tenantId: emailOutbox.tenantId,
              tenantName: tenants.name,
              tenantTimezone: tenants.timezone,
              updatedAt: emailOutbox.updatedAt,
            })
            .from(emailOutbox)
            .innerJoin(tenants, eq(emailOutbox.tenantId, tenants.id))
            .where(
              inArray(emailOutbox.status, [
                'queued',
                'sending',
                'failed',
                'deliveryUnknown',
                'suppressed',
              ]),
            )
            .orderBy(desc(emailOutbox.updatedAt))
            .limit(100),
        ]),
      );
      const summary = {
        deliveryUnknown: 0,
        exhausted: exhaustedRows[0]?.total ?? 0,
        failed: 0,
        queued: 0,
        sending: 0,
        sent: 0,
        staleSending: staleSendingRows[0]?.total ?? 0,
        suppressed: 0,
        waitingForRetry: waitingForRetryRows[0]?.total ?? 0,
      };
      for (const row of statusCounts) {
        summary[row.status] = row.total;
      }

      return Schema.decodeUnknownSync(GlobalAdminEmailOutboxOverview)({
        items: itemRows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          deliveryUnknownAt: row.deliveryUnknownAt?.toISOString() ?? null,
          exhaustedAt: row.exhaustedAt?.toISOString() ?? null,
          lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
          nextAttemptAt: row.nextAttemptAt.toISOString(),
          sentAt: row.sentAt?.toISOString() ?? null,
          suppressedAt: row.suppressedAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        })),
        summary,
      });
    }),
  'globalAdmin.platformAudit.findMany': (_payload, options) =>
    Effect.gen(function* () {
      yield* requirePlatformAdministrator(options.headers);
      const entries = yield* databaseEffect((database) =>
        database
          .select({
            action: platformAuditEntries.action,
            actorEmail: platformAuditEntries.actorEmail,
            actorId: platformAuditEntries.actorId,
            after: platformAuditEntries.after,
            before: platformAuditEntries.before,
            createdAt: platformAuditEntries.createdAt,
            id: platformAuditEntries.id,
            reason: platformAuditEntries.reason,
            targetTenantId: platformAuditEntries.targetTenantId,
            targetTenantName: tenants.name,
          })
          .from(platformAuditEntries)
          .leftJoin(
            tenants,
            eq(platformAuditEntries.targetTenantId, tenants.id),
          )
          .orderBy(desc(platformAuditEntries.createdAt))
          .limit(100),
      );

      return entries.map((entry) => toGlobalAdminPlatformAuditRecord(entry));
    }),
  'globalAdmin.tenants.create': (input, options) =>
    Effect.gen(function* () {
      const authority = yield* requirePlatformAdministrator(options.headers);
      const tenantInput = yield* normalizeTenantWritePayload(input.tenant);
      const reason = yield* normalizeAuditReason(input.reason);
      const initialPrivacyPolicy = yield* normalizeTenantPrivacyPolicy(
        input.initialPrivacyPolicy,
      ).pipe(
        Effect.mapError(
          (error) => new RpcBadRequestError({ message: error.message }),
        ),
      );
      const existingDomainTenant = yield* databaseEffect((database) =>
        database.query.tenants.findFirst({
          columns: {
            id: true,
          },
          where: {
            domain: tenantInput.domain,
          },
        }),
      );
      if (existingDomainTenant) {
        return yield* Effect.fail(
          new RpcBadRequestError({
            message: 'Organization domain already exists',
            reason: tenantInput.domain,
          }),
        );
      }

      return yield* databaseEffect((database) =>
        database.transaction((transaction) =>
          Effect.gen(function* () {
            const createdTenants = yield* transaction
              .insert(tenants)
              .values({
                ...tenantInput,
                locale: TENANT_FORMATTING_LOCALE,
                privacyPolicyText: initialPrivacyPolicy.privacyPolicyText,
                privacyPolicyUrl: initialPrivacyPolicy.privacyPolicyUrl,
                stripeAccountId: tenantInput.stripeAccountId ?? null,
              })
              .returning(globalAdminTenantReturningColumns);
            const createdTenant = createdTenants[0];
            if (!createdTenant) {
              return yield* Effect.die(
                new Error('Tenant creation returned no rows'),
              );
            }

            const after = toGlobalAdminTenantRecord(createdTenant);
            const createdPolicies = yield* transaction
              .insert(tenantPrivacyPolicyVersions)
              .values({
                createdByUserId: null,
                privacyPolicyText: initialPrivacyPolicy.privacyPolicyText,
                privacyPolicyUrl: initialPrivacyPolicy.privacyPolicyUrl,
                tenantId: after.id,
                version: 1,
              })
              .returning({ id: tenantPrivacyPolicyVersions.id });
            const createdPolicy = createdPolicies[0];
            if (!createdPolicy) {
              return yield* Effect.die(
                new Error('Initial privacy policy creation returned no row'),
              );
            }
            yield* transaction.insert(platformAuditEntries).values({
              action: 'tenant.create',
              actorEmail: authority.actorEmail,
              actorId: authority.actorId,
              after: toPlatformTenantAuditSnapshot(after, {
                privacyPolicyDigestSha256:
                  tenantPrivacyPolicyDigest(initialPrivacyPolicy),
                privacyPolicyVersionId: createdPolicy.id,
              }),
              before: null,
              reason,
              targetTenantId: after.id,
            });

            return after;
          }),
        ),
      );
    }),
  'globalAdmin.tenants.findMany': (_payload, options) =>
    Effect.gen(function* () {
      yield* requirePlatformAdministrator(options.headers);
      const allTenants = yield* databaseEffect((database) =>
        database.query.tenants.findMany({
          columns: globalAdminTenantColumns,
          orderBy: (table, { asc }) => [asc(table.name)],
        }),
      );

      return allTenants.map((tenant) => toGlobalAdminTenantRecord(tenant));
    }),
  'globalAdmin.tenants.findOne': (input, options) =>
    Effect.gen(function* () {
      yield* requirePlatformAdministrator(options.headers);
      const tenant = yield* databaseEffect((database) =>
        database.query.tenants.findFirst({
          columns: globalAdminTenantColumns,
          where: {
            id: input.id,
          },
        }),
      );

      return tenant ? toGlobalAdminTenantRecord(tenant) : null;
    }),
  'globalAdmin.tenants.update': (input, options) =>
    Effect.gen(function* () {
      const authority = yield* requirePlatformAdministrator(options.headers);
      const { id } = input;
      const tenantInput = yield* normalizeTenantWritePayload(input.tenant);
      const reason = yield* normalizeAuditReason(input.reason);
      const existingDomainTenant = yield* databaseEffect((database) =>
        database.query.tenants.findFirst({
          columns: {
            id: true,
          },
          where: {
            domain: tenantInput.domain,
          },
        }),
      );
      if (existingDomainTenant && existingDomainTenant.id !== id) {
        return yield* Effect.fail(
          new RpcBadRequestError({
            message: 'Organization domain already exists',
            reason: tenantInput.domain,
          }),
        );
      }

      const targetTenant = yield* databaseEffect((database) =>
        database.query.tenants.findFirst({
          columns: { id: true, stripeAccountId: true },
          where: { id },
        }),
      );
      if (!targetTenant) {
        return yield* Effect.fail(
          new RpcBadRequestError({ message: 'Tenant not found' }),
        );
      }
      const nextStripeAccountId = tenantInput.stripeAccountId ?? null;
      let stripeTaxRateRotationTargets: readonly StripeTaxRateAccountRotationTargetRate[] =
        [];
      if (
        targetTenant.stripeAccountId &&
        nextStripeAccountId &&
        targetTenant.stripeAccountId !== nextStripeAccountId
      ) {
        const stripe = yield* StripeClient;
        stripeTaxRateRotationTargets =
          yield* fetchStripeTaxRateAccountRotationTargetRates(
            stripe,
            nextStripeAccountId,
          );
      }

      return yield* databaseEffectWithTenantUpdateError((database) =>
        database.transaction((transaction) =>
          Effect.gen(function* () {
            const beforeRows = yield* transaction
              .select(globalAdminTenantReturningColumns)
              .from(tenants)
              .where(eq(tenants.id, id))
              .for('update');
            const beforeTenant = beforeRows[0];
            if (!beforeTenant) {
              return yield* Effect.die(
                new Error('Tenant disappeared during platform update'),
              );
            }

            const tenantPublicUrlChanged =
              beforeTenant.domain !== tenantInput.domain;
            if (tenantPublicUrlChanged) {
              // The tenant row is the serialization lock shared with Checkout
              // and transfer-offer creation. Keep these existence reads
              // unlocked: transfer claim flows lock transfer rows before the
              // tenant, so reversing that order here would invite deadlocks.
              const pendingStripeObligations =
                yield* tenantHasPendingStripeObligations(transaction, id);
              const activeRegistrationTransfers =
                yield* tenantHasActiveRegistrationTransfers(transaction, id);
              if (pendingStripeObligations || activeRegistrationTransfers) {
                return yield* new GlobalAdminTenantUrlMigrationBlockedError({
                  activeRegistrationTransfers,
                  message:
                    'Organization public URL cannot change while issued links are active',
                  pendingStripeObligations,
                  reason: tenantUrlMigrationBlockedReason({
                    activeRegistrationTransfers,
                    pendingStripeObligations,
                  }),
                  tenantId: id,
                });
              }
            }

            let rotationPlan: StripeTaxRateAccountRotationPlan | undefined;
            if (beforeTenant.stripeAccountId !== nextStripeAccountId) {
              const hasPendingStripeObligations =
                yield* tenantHasPendingStripeObligations(transaction, id);
              if (hasPendingStripeObligations) {
                return yield* new RpcBadRequestError({
                  message:
                    'Stripe account cannot change while registration Checkouts or refunds are pending',
                  reason:
                    'Complete or cancel every pending Checkout and refund before changing the connected account.',
                });
              }

              if (nextStripeAccountId === null) {
                const hasPaidEventConfiguration =
                  yield* tenantHasPaidEventConfiguration(transaction, id);
                if (hasPaidEventConfiguration) {
                  return yield* new RpcBadRequestError(
                    stripeAccountRemovalBlockedByPaidConfigurationErrorDetails,
                  );
                }
                const hasStripeTaxRateConfiguration =
                  yield* tenantHasStripeTaxRateConfiguration(transaction, id);
                if (hasStripeTaxRateConfiguration) {
                  return yield* new RpcBadRequestError(
                    stripeAccountRemovalBlockedByTaxConfigurationErrorDetails,
                  );
                }
              } else if (beforeTenant.stripeAccountId) {
                rotationPlan = yield* planStripeTaxRateAccountRotation(
                  transaction,
                  {
                    sourceStripeAccountId: beforeTenant.stripeAccountId,
                    targetRates: stripeTaxRateRotationTargets,
                    targetStripeAccountId: nextStripeAccountId,
                    tenantId: id,
                  },
                );
              } else {
                const hasStripeTaxRateConfiguration =
                  yield* tenantHasStripeTaxRateConfiguration(transaction, id);
                if (hasStripeTaxRateConfiguration) {
                  return yield* new RpcBadRequestError(
                    stripeAccountRemovalBlockedByTaxConfigurationErrorDetails,
                  );
                }
              }

              yield* transaction
                .delete(tenantStripeTaxRates)
                .where(eq(tenantStripeTaxRates.tenantId, id));
            }

            if (beforeTenant.currency !== tenantInput.currency) {
              const hasCurrencyDependentData =
                yield* tenantHasCurrencyDependentData(transaction, id);
              if (hasCurrencyDependentData) {
                return yield* new RpcBadRequestError(
                  tenantCurrencyChangeBlockedErrorDetails,
                );
              }
            }

            const updatedTenants = yield* transaction
              .update(tenants)
              .set({
                ...tenantInput,
                locale: TENANT_FORMATTING_LOCALE,
                stripeAccountId: nextStripeAccountId,
              })
              .where(eq(tenants.id, id))
              .returning(globalAdminTenantReturningColumns);
            const updatedTenant = updatedTenants[0];
            if (!updatedTenant) {
              return yield* Effect.die(
                new Error('Tenant update returned no rows'),
              );
            }
            if (rotationPlan) {
              // Source metadata was removed with the old account; restore
              // only the provider-verified target-account matches.
              yield* applyStripeTaxRateAccountRotation(
                transaction,
                rotationPlan,
              );
            }

            const before = toGlobalAdminTenantRecord(beforeTenant);
            const after = toGlobalAdminTenantRecord(updatedTenant);
            yield* transaction.insert(platformAuditEntries).values({
              action: 'tenant.update',
              actorEmail: authority.actorEmail,
              actorId: authority.actorId,
              after: toPlatformTenantAuditSnapshot(after),
              before: toPlatformTenantAuditSnapshot(before),
              reason,
              targetTenantId: id,
            });

            return after;
          }),
        ),
      );
    }),
} satisfies Partial<AppRpcHandlers>;
