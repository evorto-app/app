import type {
  PlatformAuditSnapshot,
  PlatformTenantAuditAction,
} from '@shared/platform-audit';
import type {
  GlobalAdminPlatformAuditCursor,
  GlobalAdminTenantWriteInput,
} from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { activeRegistrationTransferStatuses } from '@shared/registration-transfer';
import {
  GlobalAdminEmailOutboxOverview,
  GlobalAdminPlatformAuditPage,
  GlobalAdminPlatformAuditRecord,
  GlobalAdminPlatformAuditSnapshot,
  type GlobalAdminPlatformAuditSnapshot as GlobalAdminPlatformAuditSnapshotType,
  GlobalAdminPlatformAuditState,
  GlobalAdminTenantRecord,
  type GlobalAdminTenantRecord as GlobalAdminTenantRecordType,
  GlobalAdminTenantUrlMigrationBlockedError,
} from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import { normalizeTenantDomain } from '@shared/tenant-origin';
import {
  PlatformTenantSettingsSnapshot,
  platformTenantSettingsSnapshot,
  tenantSettingsConflict,
  TenantSettingsConflictError,
} from '@shared/tenant-settings-snapshot';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  lt,
  or,
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
} from '../../../../db/schema';
import { PlatformAdministratorAuthority } from '../../../../types/custom/platform-authority';
import {
  emailOutboxAbandonedSendingPredicate,
  emailOutboxOverviewOrderBy,
} from '../../../notifications/email-outbox-lease';
import { normalizeTenantPrivacyPolicy } from '../../../onboarding/tenant-onboarding.service';
import { tenantHasPendingStripeObligations } from '../../../payments/pending-stripe-obligations';
import {
  tenantCurrencyChangeBlockedErrorDetails,
  tenantHasCurrencyDependentData,
} from '../../../tenant-currency-integrity';
import { richTextToPlainText } from '../../../utils/rich-text-sanitize';
import { isUniqueConstraintViolation } from './events/database-constraint-errors';
import { RpcAccess } from './shared/rpc-access.service';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

// PostgreSQL names the schema's unnamed column UNIQUE constraint.
const tenantDomainUniqueConstraint = 'tenants_domain_key';

const tenantDomainAlreadyExists = (domain: string) =>
  new RpcBadRequestError({
    message: 'Organization domain already exists',
    reason: domain,
  });

const databaseEffectWithTenantDomainError = <A>(
  domain: string,
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, RpcBadRequestError, Database> =>
  Database.use((database) =>
    operation(database).pipe(
      Effect.catch((error) =>
        isUniqueConstraintViolation(error, tenantDomainUniqueConstraint)
          ? Effect.fail(tenantDomainAlreadyExists(domain))
          : Effect.die(error),
      ),
    ),
  );

const databaseEffectWithTenantUpdateError = <A>(
  domain: string,
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<
  A,
  | GlobalAdminTenantUrlMigrationBlockedError
  | RpcBadRequestError
  | TenantSettingsConflictError,
  Database
> =>
  Database.use((database) =>
    operation(database).pipe(
      Effect.catch((error) =>
        isUniqueConstraintViolation(error, tenantDomainUniqueConstraint)
          ? Effect.fail(tenantDomainAlreadyExists(domain))
          : error instanceof GlobalAdminTenantUrlMigrationBlockedError ||
              error instanceof TenantSettingsConflictError ||
              error instanceof RpcBadRequestError
            ? Effect.fail(error)
            : Effect.die(error),
      ),
    ),
  );

export const GLOBAL_ADMIN_PLATFORM_AUDIT_PAGE_SIZE = 50;

const platformAuditCursorPredicate = (
  cursor: GlobalAdminPlatformAuditCursor | null,
) => {
  if (!cursor) return;

  const createdAt = sql`${cursor.createdAt}::timestamp`;
  return or(
    lt(platformAuditEntries.createdAt, createdAt),
    and(
      eq(platformAuditEntries.createdAt, createdAt),
      gt(platformAuditEntries.id, cursor.id),
    ),
  );
};

const requirePlatformAdministrator = Effect.fn(
  'GlobalAdmin.requirePlatformAdministrator',
)(function* (): Effect.fn.Return<
  PlatformAdministratorAuthority,
  RpcForbiddenError | RpcUnauthorizedError,
  RpcAccess
> {
  yield* RpcAccess.ensureAuthenticated();
  const { platformAuthority: authority } = yield* RpcAccess.current();

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

const PersistedGlobalAdminTaxRateAuditRecord = Schema.Struct({
  active: Schema.Boolean,
  country: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  inclusive: Schema.Boolean,
  percentage: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.String),
  stripeTaxRateId: Schema.NonEmptyString,
});

const PersistedGlobalAdminTaxRateAuditState = Schema.Struct({
  rates: Schema.Array(PersistedGlobalAdminTaxRateAuditRecord),
});

const PersistedGlobalAdminRoleAssignmentAuditState = Schema.Struct({
  roleIds: Schema.Array(Schema.NonEmptyString),
});

const PersistedGlobalAdminPlatformAuditState = Schema.Struct({
  addOns: Schema.optional(Schema.Array(Schema.Unknown)),
  alcoholAmount: Schema.optional(Schema.Number),
  amount: Schema.optional(Schema.Number),
  attendeeCheckedIn: GlobalAdminPlatformAuditState.fields.attendeeCheckedIn,
  checkedInGuestCount: GlobalAdminPlatformAuditState.fields.checkedInGuestCount,
  currency: GlobalAdminPlatformAuditState.fields.currency,
  defaultOrganizerRole:
    GlobalAdminPlatformAuditState.fields.defaultOrganizerRole,
  defaultUserRole: GlobalAdminPlatformAuditState.fields.defaultUserRole,
  depositAmount: Schema.optional(Schema.Number),
  description: GlobalAdminPlatformAuditState.fields.description,
  displayInHub: GlobalAdminPlatformAuditState.fields.displayInHub,
  domain: GlobalAdminPlatformAuditState.fields.domain,
  guestCount: GlobalAdminPlatformAuditState.fields.guestCount,
  locationName: GlobalAdminPlatformAuditState.fields.locationName,
  name: GlobalAdminPlatformAuditState.fields.name,
  paymentsConfigured: GlobalAdminPlatformAuditState.fields.paymentsConfigured,
  permissions: GlobalAdminPlatformAuditState.fields.permissions,
  questions: Schema.optional(Schema.Array(Schema.Unknown)),
  rates: Schema.optional(Schema.Array(PersistedGlobalAdminTaxRateAuditRecord)),
  receiptCount: GlobalAdminPlatformAuditState.fields.receiptCount,
  registrationOptions: Schema.optional(Schema.Array(Schema.Unknown)),
  remainingGuestCount: GlobalAdminPlatformAuditState.fields.remainingGuestCount,
  roleIds: Schema.optional(
    PersistedGlobalAdminRoleAssignmentAuditState.fields.roleIds,
  ),
  simpleModeEnabled: GlobalAdminPlatformAuditState.fields.simpleModeEnabled,
  sortOrder: GlobalAdminPlatformAuditState.fields.sortOrder,
  status: GlobalAdminPlatformAuditState.fields.status,
  taxAmount: Schema.optional(Schema.Number),
  theme: GlobalAdminPlatformAuditState.fields.theme,
  timezone: GlobalAdminPlatformAuditState.fields.timezone,
  title: GlobalAdminPlatformAuditState.fields.title,
  totalAmount: Schema.optional(Schema.Number),
  transferStatus: GlobalAdminPlatformAuditState.fields.transferStatus,
  unlisted: GlobalAdminPlatformAuditState.fields.unlisted,
});

type PlatformAuditChangeSummary = Pick<
  GlobalAdminPlatformAuditSnapshotType['state'],
  | 'roleAddedCount'
  | 'roleRemovedCount'
  | 'taxRateAddedCount'
  | 'taxRateUnchangedCount'
  | 'taxRateUpdatedCount'
>;

const toGlobalAdminPlatformAuditSnapshot = (
  snapshot: PlatformAuditSnapshot,
  changeSummary: PlatformAuditChangeSummary = {},
): GlobalAdminPlatformAuditSnapshotType => {
  const state = Schema.decodeUnknownSync(
    PersistedGlobalAdminPlatformAuditState,
  )(snapshot.state);

  return Schema.decodeUnknownSync(GlobalAdminPlatformAuditSnapshot)({
    resourceType: snapshot.resourceType,
    state: {
      addOnCount: state.addOns?.length,
      attendeeCheckedIn: state.attendeeCheckedIn,
      checkedInGuestCount: state.checkedInGuestCount,
      currency: state.currency,
      defaultOrganizerRole: state.defaultOrganizerRole,
      defaultUserRole: state.defaultUserRole,
      description:
        state.description == null
          ? state.description
          : richTextToPlainText(state.description) ||
            'The description contains no words',
      displayInHub: state.displayInHub,
      domain: state.domain,
      guestCount: state.guestCount,
      locationName: state.locationName,
      name: state.name,
      paymentsConfigured: state.paymentsConfigured,
      permissions: state.permissions,
      questionCount: state.questions?.length,
      receiptCount: state.receiptCount,
      registrationOptionCount: state.registrationOptions?.length,
      remainingGuestCount: state.remainingGuestCount,
      roleCount: state.roleIds?.length,
      simpleModeEnabled: state.simpleModeEnabled,
      sortOrder: state.sortOrder,
      status: state.status,
      ...changeSummary,
      taxRateCount: state.rates?.length,
      theme: state.theme,
      timezone: state.timezone,
      title: state.title,
      transferStatus: state.transferStatus,
      unlisted: state.unlisted,
    },
  });
};

const taxRateMetadataMatches = (
  left: Schema.Schema.Type<typeof PersistedGlobalAdminTaxRateAuditRecord>,
  right: Schema.Schema.Type<typeof PersistedGlobalAdminTaxRateAuditRecord>,
): boolean =>
  left.active === right.active &&
  left.country === right.country &&
  left.displayName === right.displayName &&
  left.inclusive === right.inclusive &&
  left.percentage === right.percentage &&
  left.state === right.state;

const taxRateImportAuditSummary = (
  before: PlatformAuditSnapshot,
  after: PlatformAuditSnapshot,
): PlatformAuditChangeSummary => {
  if (
    before.resourceType !== 'taxRateBatch' ||
    after.resourceType !== 'taxRateBatch'
  ) {
    throw new Error('Tax-rate imports require tax-rate batch snapshots');
  }

  const beforeRates = Schema.decodeUnknownSync(
    PersistedGlobalAdminTaxRateAuditState,
  )(before.state).rates;
  const afterRates = Schema.decodeUnknownSync(
    PersistedGlobalAdminTaxRateAuditState,
  )(after.state).rates;
  const beforeRatesById = new Map(
    beforeRates.map((rate) => [rate.stripeTaxRateId, rate]),
  );
  let addedCount = 0;
  let unchangedCount = 0;
  let updatedCount = 0;
  for (const rate of afterRates) {
    const previousRate = beforeRatesById.get(rate.stripeTaxRateId);
    if (!previousRate) {
      addedCount += 1;
    } else if (taxRateMetadataMatches(previousRate, rate)) {
      unchangedCount += 1;
    } else {
      updatedCount += 1;
    }
  }

  return {
    ...(addedCount > 0 && { taxRateAddedCount: addedCount }),
    ...(unchangedCount > 0 && { taxRateUnchangedCount: unchangedCount }),
    ...(updatedCount > 0 && { taxRateUpdatedCount: updatedCount }),
  };
};

const roleAssignmentAuditSummary = (
  before: PlatformAuditSnapshot,
  after: PlatformAuditSnapshot,
) => {
  if (
    before.resourceType !== 'userRoleAssignment' ||
    after.resourceType !== 'userRoleAssignment'
  ) {
    throw new Error('Role assignments require member role snapshots');
  }

  const beforeRoleIds = new Set(
    Schema.decodeUnknownSync(PersistedGlobalAdminRoleAssignmentAuditState)(
      before.state,
    ).roleIds,
  );
  const afterRoleIds = new Set(
    Schema.decodeUnknownSync(PersistedGlobalAdminRoleAssignmentAuditState)(
      after.state,
    ).roleIds,
  );
  return {
    roleAddedCount: [...afterRoleIds].filter((id) => !beforeRoleIds.has(id))
      .length,
    roleRemovedCount: [...beforeRoleIds].filter((id) => !afterRoleIds.has(id))
      .length,
  };
};

const toGlobalAdminPlatformAuditRecord = (entry: {
  action: PlatformTenantAuditAction;
  actorEmail: null | string;
  after: null | PlatformAuditSnapshot;
  before: null | PlatformAuditSnapshot;
  createdAt: Date;
  id: string;
  reason: string;
  targetTenantName: null | string;
}) => {
  let changeSummary: PlatformAuditChangeSummary = {};
  if (entry.action === 'taxRates.import') {
    if (entry.before === null || entry.after === null) {
      throw new Error(
        'Tax-rate import audits require before and after snapshots',
      );
    }
    changeSummary = taxRateImportAuditSummary(entry.before, entry.after);
  } else if (entry.action === 'user.assignRoles') {
    if (entry.before === null || entry.after === null) {
      throw new Error(
        'Role assignment audits require before and after snapshots',
      );
    }
    changeSummary = roleAssignmentAuditSummary(entry.before, entry.after);
  }

  return Schema.decodeUnknownSync(GlobalAdminPlatformAuditRecord)({
    action: entry.action,
    actorEmail: entry.actorEmail,
    after:
      entry.after === null
        ? null
        : toGlobalAdminPlatformAuditSnapshot(entry.after, changeSummary),
    before:
      entry.before === null
        ? null
        : toGlobalAdminPlatformAuditSnapshot(entry.before),
    createdAt: entry.createdAt.toISOString(),
    id: entry.id,
    reason: entry.reason,
    targetTenantName: entry.targetTenantName,
  });
};

const toGlobalAdminTenantRecord = (tenant: {
  currency: string;
  domain: string;
  id: string;
  name: string;
  stripeAccountId: null | string;
  theme: string;
  timezone: string;
}): GlobalAdminTenantRecordType => {
  return Schema.decodeUnknownSync(GlobalAdminTenantRecord)({
    ...tenant,
    paymentsConfigured: !!tenant.stripeAccountId,
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
    name: tenant.name,
    ...privacyPolicy,
    paymentsConfigured: tenant.paymentsConfigured,
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
  name: true,
  stripeAccountId: true,
  theme: true,
  timezone: true,
} as const;

const globalAdminTenantReturningColumns = {
  currency: tenants.currency,
  domain: tenants.domain,
  id: tenants.id,
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

const emailDeliveryRecordIncomplete = (row: {
  deliveryUnknownAt: Date | null;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
  status:
    'deliveryUnknown' | 'failed' | 'queued' | 'sending' | 'sent' | 'suppressed';
  suppressedAt: Date | null;
}): boolean => {
  if (row.status === 'deliveryUnknown') {
    return row.deliveryUnknownAt === null || row.lastAttemptAt === null;
  }
  if (row.status === 'suppressed') {
    return row.suppressedAt === null || row.lastAttemptAt === null;
  }
  if (row.status === 'sent') {
    return row.sentAt === null || row.lastAttemptAt === null;
  }
  return (
    (row.status === 'failed' || row.status === 'sending') &&
    row.lastAttemptAt === null
  );
};

export const readGlobalAdminPlatformAuditPage = (
  cursor: GlobalAdminPlatformAuditCursor | null,
) =>
  Effect.gen(function* () {
    const entries = yield* databaseEffect((database) =>
      database
        .select({
          action: platformAuditEntries.action,
          actorEmail: platformAuditEntries.actorEmail,
          after: platformAuditEntries.after,
          before: platformAuditEntries.before,
          createdAt: platformAuditEntries.createdAt,
          cursorCreatedAt: sql<string>`to_char(${platformAuditEntries.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          id: platformAuditEntries.id,
          reason: platformAuditEntries.reason,
          targetTenantName: tenants.name,
        })
        .from(platformAuditEntries)
        .leftJoin(tenants, eq(platformAuditEntries.targetTenantId, tenants.id))
        .where(platformAuditCursorPredicate(cursor))
        .orderBy(
          desc(platformAuditEntries.createdAt),
          asc(platformAuditEntries.id),
        )
        .limit(GLOBAL_ADMIN_PLATFORM_AUDIT_PAGE_SIZE + 1),
    );

    const pageEntries = entries.slice(0, GLOBAL_ADMIN_PLATFORM_AUDIT_PAGE_SIZE);
    const items = pageEntries.map((entry) =>
      toGlobalAdminPlatformAuditRecord(entry),
    );
    const lastEntry = pageEntries.at(-1);

    return Schema.decodeUnknownSync(GlobalAdminPlatformAuditPage)({
      items,
      nextCursor:
        entries.length > GLOBAL_ADMIN_PLATFORM_AUDIT_PAGE_SIZE && lastEntry
          ? {
              createdAt: lastEntry.cursorCreatedAt,
              id: lastEntry.id,
            }
          : null,
    });
  });

export const globalAdminHandlers = {
  'globalAdmin.emailOutbox.findOverview': (_payload, _options) =>
    Effect.gen(function* () {
      yield* requirePlatformAdministrator();
      const [statusCounts, staleSendingRows, itemRows] = yield* databaseEffect(
        (database) =>
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
              .where(emailOutboxAbandonedSendingPredicate()),
            database
              .select({
                deliveryUnknownAt: emailOutbox.deliveryUnknownAt,
                id: emailOutbox.id,
                kind: emailOutbox.kind,
                lastAttemptAt: emailOutbox.lastAttemptAt,
                recipient: emailOutbox.toEmail,
                sentAt: emailOutbox.sentAt,
                status: emailOutbox.status,
                subject: emailOutbox.subject,
                suppressedAt: emailOutbox.suppressedAt,
                tenantDomain: tenants.domain,
                tenantName: tenants.name,
                tenantTimezone: tenants.timezone,
              })
              .from(emailOutbox)
              .innerJoin(tenants, eq(emailOutbox.tenantId, tenants.id))
              .where(
                inArray(emailOutbox.status, [
                  'queued',
                  'sending',
                  'sent',
                  'failed',
                  'deliveryUnknown',
                  'suppressed',
                ]),
              )
              .orderBy(...emailOutboxOverviewOrderBy())
              .limit(100),
          ]),
      );
      const summary = {
        deliveryUnknown: 0,
        failed: 0,
        queued: 0,
        sending: 0,
        sent: 0,
        staleSending: staleSendingRows[0]?.total ?? 0,
        suppressed: 0,
      };
      for (const row of statusCounts) {
        summary[row.status] = row.total;
      }

      return Schema.decodeUnknownSync(GlobalAdminEmailOutboxOverview)({
        items: itemRows.map((row) => ({
          id: row.id,
          kind: row.kind,
          lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
          recipient: row.recipient,
          recordIncomplete: emailDeliveryRecordIncomplete(row),
          status: row.status,
          subject: row.subject,
          tenantDomain: row.tenantDomain,
          tenantName: row.tenantName,
          tenantTimezone: row.tenantTimezone,
        })),
        summary,
      });
    }),
  'globalAdmin.platformAudit.findMany': (input, _options) =>
    Effect.gen(function* () {
      yield* requirePlatformAdministrator();
      return yield* readGlobalAdminPlatformAuditPage(input.cursor);
    }),
  'globalAdmin.tenants.create': (input, _options) =>
    Effect.gen(function* () {
      const authority = yield* requirePlatformAdministrator();
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
          tenantDomainAlreadyExists(tenantInput.domain),
        );
      }

      return yield* databaseEffectWithTenantDomainError(
        tenantInput.domain,
        (database) =>
          database.transaction((transaction) =>
            Effect.gen(function* () {
              const createdTenants = yield* transaction
                .insert(tenants)
                .values({
                  ...tenantInput,
                  stripeAccountId: null,
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
  'globalAdmin.tenants.findMany': (_payload, _options) =>
    Effect.gen(function* () {
      yield* requirePlatformAdministrator();
      const allTenants = yield* databaseEffect((database) =>
        database.query.tenants.findMany({
          columns: globalAdminTenantColumns,
          orderBy: (table, { asc }) => [asc(table.name)],
        }),
      );

      return allTenants.map((tenant) => toGlobalAdminTenantRecord(tenant));
    }),
  'globalAdmin.tenants.findOne': (input, _options) =>
    Effect.gen(function* () {
      yield* requirePlatformAdministrator();
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
  'globalAdmin.tenants.update': (input, _options) =>
    Effect.gen(function* () {
      const authority = yield* requirePlatformAdministrator();
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
          tenantDomainAlreadyExists(tenantInput.domain),
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
      return yield* databaseEffectWithTenantUpdateError(
        tenantInput.domain,
        (database) =>
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

              if (
                !Schema.toEquivalence(PlatformTenantSettingsSnapshot)(
                  input.expectedSettings,
                  platformTenantSettingsSnapshot(beforeTenant),
                )
              ) {
                return yield* tenantSettingsConflict();
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
                .set(tenantInput)
                .where(eq(tenants.id, id))
                .returning(globalAdminTenantReturningColumns);
              const updatedTenant = updatedTenants[0];
              if (!updatedTenant) {
                return yield* Effect.die(
                  new Error('Tenant update returned no rows'),
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
