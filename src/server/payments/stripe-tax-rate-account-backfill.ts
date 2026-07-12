import type Stripe from 'stripe';

import { Database, type DatabaseClient } from '@db/index';
import { tenants, tenantStripeTaxRates } from '@db/schema';
import { and, asc, count, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

import { StripeClient } from '../stripe-client';

const backfillFailureReasons = [
  'databaseReadFailed',
  'databaseWriteFailed',
  'missingStripeAccount',
  'missingTenant',
  'providerRequestFailed',
  'providerResponseInvalid',
  'providerTaxRateMismatch',
  'remainingLegacyRows',
  'rowAccountConflict',
  'rowChanged',
  'tenantAccountChanged',
] as const;

interface BackfillFailureContext {
  readonly cause?: unknown;
  readonly remainingCount?: number;
  readonly rowId?: string;
  readonly stripeTaxRateId?: string;
  readonly tenantId?: string;
}

type BackfillFailureReason = (typeof backfillFailureReasons)[number];

export class StripeTaxRateAccountBackfillError extends Schema.TaggedErrorClass<StripeTaxRateAccountBackfillError>()(
  'StripeTaxRateAccountBackfillError',
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    reason: Schema.Literals(backfillFailureReasons),
    remainingCount: Schema.optional(Schema.Number),
    rowId: Schema.optional(Schema.String),
    stripeTaxRateId: Schema.optional(Schema.String),
    tenantId: Schema.optional(Schema.String),
  },
) {}

const backfillFailure = (
  reason: BackfillFailureReason,
  message: string,
  context: BackfillFailureContext = {},
) =>
  new StripeTaxRateAccountBackfillError({
    ...(context.cause !== undefined && { cause: context.cause }),
    message,
    reason,
    ...(context.remainingCount !== undefined && {
      remainingCount: context.remainingCount,
    }),
    ...(context.rowId !== undefined && { rowId: context.rowId }),
    ...(context.stripeTaxRateId !== undefined && {
      stripeTaxRateId: context.stripeTaxRateId,
    }),
    ...(context.tenantId !== undefined && { tenantId: context.tenantId }),
  });

export interface LegacyStripeTaxRateRow {
  readonly active: boolean;
  readonly capturedStripeAccountId: null | string;
  readonly country: null | string;
  readonly displayName: null | string;
  readonly id: string;
  readonly inclusive: boolean;
  readonly percentage: null | string;
  readonly state: null | string;
  readonly stripeTaxRateId: string;
  readonly tenantExists: boolean;
  readonly tenantId: string;
}

export interface StripeTaxRateAccountBackfillOperations {
  readonly commitVerifiedSnapshot: (
    row: LegacyStripeTaxRateRow,
    stripeAccountId: string,
    snapshot: VerifiedStripeTaxRateSnapshot,
  ) => Effect.Effect<
    StripeTaxRateBackfillCommitOutcome,
    StripeTaxRateAccountBackfillError
  >;
  readonly installRolloutGuards: () => Effect.Effect<
    void,
    StripeTaxRateAccountBackfillError
  >;
  readonly listLegacyRows: () => Effect.Effect<
    readonly LegacyStripeTaxRateRow[],
    StripeTaxRateAccountBackfillError
  >;
  readonly retrieveStripeTaxRate: (
    stripeAccountId: string,
    stripeTaxRateId: string,
  ) => Effect.Effect<unknown, StripeTaxRateAccountBackfillError>;
}

export interface StripeTaxRateAccountBackfillSummary {
  readonly alreadyBackfilled: number;
  readonly removed: number;
  readonly scanned: number;
  readonly updated: number;
}

export type StripeTaxRateBackfillCommitOutcome =
  'alreadyBackfilled' | 'removed' | 'updated';

export interface VerifiedStripeTaxRateSnapshot {
  readonly active: boolean;
  readonly country: null | string;
  readonly displayName: string;
  readonly inclusive: boolean;
  readonly percentage: string;
  readonly state: null | string;
  readonly stripeTaxRateId: string;
}

const StripeTaxRateProviderResponse = Schema.Struct({
  active: Schema.Boolean,
  country: Schema.NullOr(Schema.String),
  display_name: Schema.String,
  id: Schema.NonEmptyString,
  inclusive: Schema.Boolean,
  percentage: Schema.Number,
  state: Schema.NullOr(Schema.String),
});

export const verifyStripeTaxRateBackfillSnapshot = Effect.fn(
  'verifyStripeTaxRateBackfillSnapshot',
)(function* (row: LegacyStripeTaxRateRow, response: unknown) {
  const providerRate = yield* Schema.decodeUnknownEffect(
    StripeTaxRateProviderResponse,
  )(response).pipe(
    Effect.mapError((cause) =>
      backfillFailure(
        'providerResponseInvalid',
        'Stripe returned an invalid tax-rate response; the account backfill was stopped',
        {
          cause,
          rowId: row.id,
          stripeTaxRateId: row.stripeTaxRateId,
          tenantId: row.tenantId,
        },
      ),
    ),
  );

  if (providerRate.id !== row.stripeTaxRateId) {
    return yield* backfillFailure(
      'providerTaxRateMismatch',
      'Stripe returned a different tax rate than the requested legacy row; the account backfill was stopped',
      {
        rowId: row.id,
        stripeTaxRateId: row.stripeTaxRateId,
        tenantId: row.tenantId,
      },
    );
  }

  if (
    !Number.isFinite(providerRate.percentage) ||
    providerRate.percentage < 0 ||
    providerRate.percentage > 100
  ) {
    return yield* backfillFailure(
      'providerResponseInvalid',
      'Stripe returned an invalid tax-rate percentage; the account backfill was stopped',
      {
        rowId: row.id,
        stripeTaxRateId: row.stripeTaxRateId,
        tenantId: row.tenantId,
      },
    );
  }

  return {
    active: providerRate.active,
    country: providerRate.country,
    displayName: providerRate.display_name,
    inclusive: providerRate.inclusive,
    percentage: String(providerRate.percentage),
    state: providerRate.state,
    stripeTaxRateId: providerRate.id,
  } satisfies VerifiedStripeTaxRateSnapshot;
});

export const executeStripeTaxRateAccountBackfill = Effect.fn(
  'executeStripeTaxRateAccountBackfill',
)(function* (operations: StripeTaxRateAccountBackfillOperations) {
  const legacyRows = yield* operations.listLegacyRows();
  const outcomes = yield* Effect.forEach(
    legacyRows,
    (row) =>
      Effect.gen(function* () {
        if (!row.tenantExists) {
          return yield* backfillFailure(
            'missingTenant',
            'A legacy Stripe tax-rate row has no tenant; the account backfill was stopped',
            {
              rowId: row.id,
              stripeTaxRateId: row.stripeTaxRateId,
              tenantId: row.tenantId,
            },
          );
        }

        const stripeAccountId = row.capturedStripeAccountId;
        if (!stripeAccountId) {
          return yield* backfillFailure(
            'missingStripeAccount',
            'A tenant with legacy Stripe tax-rate metadata has no connected Stripe account; the account backfill was stopped',
            {
              rowId: row.id,
              stripeTaxRateId: row.stripeTaxRateId,
              tenantId: row.tenantId,
            },
          );
        }

        const providerResponse = yield* operations.retrieveStripeTaxRate(
          stripeAccountId,
          row.stripeTaxRateId,
        );
        const snapshot = yield* verifyStripeTaxRateBackfillSnapshot(
          row,
          providerResponse,
        );

        return yield* operations.commitVerifiedSnapshot(
          row,
          stripeAccountId,
          snapshot,
        );
      }),
    { concurrency: 1 },
  );

  yield* operations.installRolloutGuards();

  let alreadyBackfilled = 0;
  let removed = 0;
  let updated = 0;
  for (const outcome of outcomes) {
    if (outcome === 'alreadyBackfilled') {
      alreadyBackfilled += 1;
    } else if (outcome === 'removed') {
      removed += 1;
    } else {
      updated += 1;
    }
  }

  return {
    alreadyBackfilled,
    removed,
    scanned: outcomes.length,
    updated,
  } satisfies StripeTaxRateAccountBackfillSummary;
});

const rowFailureContext = (row: LegacyStripeTaxRateRow) => ({
  rowId: row.id,
  stripeTaxRateId: row.stripeTaxRateId,
  tenantId: row.tenantId,
});

const preserveBackfillError = (
  error: unknown,
  reason: BackfillFailureReason,
  message: string,
  context: BackfillFailureContext = {},
) =>
  error instanceof StripeTaxRateAccountBackfillError
    ? error
    : backfillFailure(reason, message, { ...context, cause: error });

export const lockTenantsForStripeTaxRateRolloutSql =
  'LOCK TABLE public.tenants IN SHARE ROW EXCLUSIVE MODE';

export const lockTaxRatesForStripeTaxRateRolloutSql =
  'LOCK TABLE public.tenant_stripe_tax_rates IN SHARE ROW EXCLUSIVE MODE';

export const requireOwnedStripeTaxRateFunctionSql = `
CREATE OR REPLACE FUNCTION public.evorto_require_owned_tenant_stripe_tax_rate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW."stripeAccountId" IS NULL THEN
    RAISE EXCEPTION 'tenant Stripe tax-rate rows require an owning account'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$`;

export const dropRequireOwnedStripeTaxRateTriggerSql = `
DROP TRIGGER IF EXISTS tenant_stripe_tax_rates_require_owned_account
ON public.tenant_stripe_tax_rates`;

export const createRequireOwnedStripeTaxRateTriggerSql = `
CREATE TRIGGER tenant_stripe_tax_rates_require_owned_account
BEFORE INSERT OR UPDATE ON public.tenant_stripe_tax_rates
FOR EACH ROW
EXECUTE FUNCTION public.evorto_require_owned_tenant_stripe_tax_rate()`;

export const requireTaxRateCleanupBeforeAccountChangeFunctionSql = `
CREATE OR REPLACE FUNCTION public.evorto_require_tax_rate_cleanup_before_account_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW."stripeAccountId" IS DISTINCT FROM OLD."stripeAccountId"
    AND EXISTS (
      SELECT 1
      FROM public.tenant_stripe_tax_rates
      WHERE "tenantId" = OLD.id
    )
  THEN
    RAISE EXCEPTION 'tenant tax-rate metadata must be removed before changing its Stripe account'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$`;

export const dropRequireTaxRateCleanupBeforeAccountChangeTriggerSql = `
DROP TRIGGER IF EXISTS tenants_require_tax_rate_cleanup_before_account_change
ON public.tenants`;

export const createRequireTaxRateCleanupBeforeAccountChangeTriggerSql = `
CREATE TRIGGER tenants_require_tax_rate_cleanup_before_account_change
BEFORE UPDATE OF "stripeAccountId" ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.evorto_require_tax_rate_cleanup_before_account_change()`;

const countInvalidAccountBindings = (
  database: Pick<DatabaseClient, 'select'>,
) =>
  database
    .select({ count: count() })
    .from(tenantStripeTaxRates)
    .leftJoin(tenants, eq(tenants.id, tenantStripeTaxRates.tenantId))
    .where(
      or(
        isNull(tenantStripeTaxRates.stripeAccountId),
        isNull(tenants.id),
        isNull(tenants.stripeAccountId),
        ne(tenantStripeTaxRates.stripeAccountId, tenants.stripeAccountId),
      ),
    );

const makeStripeTaxRateAccountBackfillOperations = (
  database: DatabaseClient,
  stripe: Stripe,
): StripeTaxRateAccountBackfillOperations => ({
  commitVerifiedSnapshot: Effect.fn(
    'StripeTaxRateAccountBackfill.commitVerifiedSnapshot',
  )(
    (
      row: LegacyStripeTaxRateRow,
      stripeAccountId: string,
      snapshot: VerifiedStripeTaxRateSnapshot,
    ) =>
      database
        .transaction((transaction) =>
          Effect.gen(function* () {
            const lockedTenants = yield* transaction
              .select({
                id: tenants.id,
                stripeAccountId: tenants.stripeAccountId,
              })
              .from(tenants)
              .where(eq(tenants.id, row.tenantId))
              .for('update');
            const lockedTenant = lockedTenants[0];
            if (!lockedTenant) {
              return yield* backfillFailure(
                'missingTenant',
                'The tenant disappeared while its Stripe tax rate was being backfilled; deployment is blocked',
                rowFailureContext(row),
              );
            }

            const lockedRows = yield* transaction
              .select({
                stripeAccountId: tenantStripeTaxRates.stripeAccountId,
                stripeTaxRateId: tenantStripeTaxRates.stripeTaxRateId,
              })
              .from(tenantStripeTaxRates)
              .where(
                and(
                  eq(tenantStripeTaxRates.id, row.id),
                  eq(tenantStripeTaxRates.tenantId, row.tenantId),
                ),
              )
              .for('update');
            const lockedRow = lockedRows[0];
            if (!lockedRow) return 'removed';

            if (lockedTenant.stripeAccountId !== stripeAccountId) {
              return yield* backfillFailure(
                'tenantAccountChanged',
                'The tenant Stripe account changed during tax-rate verification; deployment is blocked until the backfill is retried',
                rowFailureContext(row),
              );
            }
            if (lockedRow.stripeTaxRateId !== snapshot.stripeTaxRateId) {
              return yield* backfillFailure(
                'rowChanged',
                'The legacy Stripe tax-rate row changed during provider verification; deployment is blocked until the backfill is retried',
                rowFailureContext(row),
              );
            }
            const providerOwnedMetadata = {
              active: snapshot.active,
              country: snapshot.country,
              displayName: snapshot.displayName,
              inclusive: snapshot.inclusive,
              percentage: snapshot.percentage,
              state: snapshot.state,
            };
            if (lockedRow.stripeAccountId !== null) {
              if (lockedRow.stripeAccountId !== stripeAccountId) {
                return yield* backfillFailure(
                  'rowAccountConflict',
                  'The Stripe tax-rate row was assigned to a different account during backfill; deployment is blocked',
                  rowFailureContext(row),
                );
              }

              const refreshedRows = yield* transaction
                .update(tenantStripeTaxRates)
                .set(providerOwnedMetadata)
                .where(
                  and(
                    eq(tenantStripeTaxRates.id, row.id),
                    eq(tenantStripeTaxRates.tenantId, row.tenantId),
                    eq(
                      tenantStripeTaxRates.stripeTaxRateId,
                      snapshot.stripeTaxRateId,
                    ),
                    eq(tenantStripeTaxRates.stripeAccountId, stripeAccountId),
                  ),
                )
                .returning({ id: tenantStripeTaxRates.id });
              if (refreshedRows.length !== 1) {
                return yield* backfillFailure(
                  'databaseWriteFailed',
                  'The concurrently owned Stripe tax-rate row was not refreshed exactly once; deployment is blocked',
                  rowFailureContext(row),
                );
              }
              return 'alreadyBackfilled';
            }

            const updatedRows = yield* transaction
              .update(tenantStripeTaxRates)
              .set({
                ...providerOwnedMetadata,
                stripeAccountId,
              })
              .where(
                and(
                  eq(tenantStripeTaxRates.id, row.id),
                  eq(tenantStripeTaxRates.tenantId, row.tenantId),
                  eq(
                    tenantStripeTaxRates.stripeTaxRateId,
                    snapshot.stripeTaxRateId,
                  ),
                  isNull(tenantStripeTaxRates.stripeAccountId),
                ),
              )
              .returning({ id: tenantStripeTaxRates.id });
            if (updatedRows.length !== 1) {
              return yield* backfillFailure(
                'databaseWriteFailed',
                'The verified Stripe tax-rate row was not updated exactly once; deployment is blocked',
                rowFailureContext(row),
              );
            }

            return 'updated';
          }),
        )
        .pipe(
          Effect.mapError((error) =>
            preserveBackfillError(
              error,
              'databaseWriteFailed',
              'The verified Stripe tax-rate update failed; deployment is blocked',
              rowFailureContext(row),
            ),
          ),
        ),
  ),
  installRolloutGuards: Effect.fn(
    'StripeTaxRateAccountBackfill.installRolloutGuards',
  )(() =>
    database
      .transaction((transaction) =>
        Effect.gen(function* () {
          yield* transaction.execute(
            sql.raw(lockTenantsForStripeTaxRateRolloutSql),
          );
          yield* transaction.execute(
            sql.raw(lockTaxRatesForStripeTaxRateRolloutSql),
          );

          const beforeGuardRows =
            yield* countInvalidAccountBindings(transaction);
          const invalidCount = beforeGuardRows[0]?.count ?? 0;
          if (invalidCount > 0) {
            return yield* backfillFailure(
              'remainingLegacyRows',
              'Stripe tax-rate rows remain unowned, disconnected, or assigned to a stale tenant account; deployment is blocked',
              { remainingCount: invalidCount },
            );
          }

          yield* transaction.execute(
            sql.raw(requireOwnedStripeTaxRateFunctionSql),
          );
          yield* transaction.execute(
            sql.raw(dropRequireOwnedStripeTaxRateTriggerSql),
          );
          yield* transaction.execute(
            sql.raw(createRequireOwnedStripeTaxRateTriggerSql),
          );
          yield* transaction.execute(
            sql.raw(requireTaxRateCleanupBeforeAccountChangeFunctionSql),
          );
          yield* transaction.execute(
            sql.raw(dropRequireTaxRateCleanupBeforeAccountChangeTriggerSql),
          );
          yield* transaction.execute(
            sql.raw(createRequireTaxRateCleanupBeforeAccountChangeTriggerSql),
          );

          const afterGuardRows =
            yield* countInvalidAccountBindings(transaction);
          const invalidAfterGuardCount = afterGuardRows[0]?.count ?? 0;
          if (invalidAfterGuardCount > 0) {
            return yield* backfillFailure(
              'remainingLegacyRows',
              'The Stripe tax-rate account invariant changed while rollout guards were installed; deployment is blocked',
              { remainingCount: invalidAfterGuardCount },
            );
          }
        }),
      )
      .pipe(
        Effect.mapError((error) =>
          preserveBackfillError(
            error,
            'databaseWriteFailed',
            'The temporary Stripe tax-rate rollout guards could not be installed; deployment is blocked',
          ),
        ),
      ),
  ),
  listLegacyRows: () =>
    database
      .select({
        active: tenantStripeTaxRates.active,
        capturedStripeAccountId: tenants.stripeAccountId,
        country: tenantStripeTaxRates.country,
        displayName: tenantStripeTaxRates.displayName,
        id: tenantStripeTaxRates.id,
        inclusive: tenantStripeTaxRates.inclusive,
        percentage: tenantStripeTaxRates.percentage,
        state: tenantStripeTaxRates.state,
        stripeTaxRateId: tenantStripeTaxRates.stripeTaxRateId,
        tenantId: tenantStripeTaxRates.tenantId,
        tenantRecordId: tenants.id,
      })
      .from(tenantStripeTaxRates)
      .leftJoin(tenants, eq(tenants.id, tenantStripeTaxRates.tenantId))
      .where(isNull(tenantStripeTaxRates.stripeAccountId))
      .orderBy(asc(tenantStripeTaxRates.tenantId), asc(tenantStripeTaxRates.id))
      .pipe(
        Effect.map((rows) =>
          rows.map(({ tenantRecordId, ...row }) => ({
            ...row,
            tenantExists: tenantRecordId !== null,
          })),
        ),
        Effect.mapError((cause) =>
          backfillFailure(
            'databaseReadFailed',
            'Legacy Stripe tax-rate rows could not be read; deployment is blocked',
            { cause },
          ),
        ),
      ),
  retrieveStripeTaxRate: (stripeAccountId, stripeTaxRateId) =>
    Effect.tryPromise({
      catch: (cause) =>
        backfillFailure(
          'providerRequestFailed',
          'Stripe could not verify a legacy tax rate through the tenant account; deployment is blocked',
          { cause, stripeTaxRateId },
        ),
      try: () =>
        stripe.taxRates.retrieve(stripeTaxRateId, undefined, {
          stripeAccount: stripeAccountId,
        }),
    }),
});

export const runStripeTaxRateAccountBackfill = Effect.fn(
  'runStripeTaxRateAccountBackfill',
)(function* () {
  const database = yield* Database;
  const stripe = yield* StripeClient;

  return yield* executeStripeTaxRateAccountBackfill(
    makeStripeTaxRateAccountBackfillOperations(database, stripe),
  );
});
