import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import { transactions } from '@db/schema';
import { assert, describe, expect, it, vi } from '@effect/vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Effect, Ref } from 'effect';

import { StripeClient } from '../stripe-client';
import { createRegistrationDatabaseTestLayer } from '../testing/registration-database';
import {
  createRejectingStripeClient,
  stripeRefundResponse,
} from '../testing/stripe-test-fixtures';
import {
  launchRegistrationRefundWorker,
  normalizeRegistrationRefundBatchSize,
  persistedRegistrationRefundStatus,
  processRegistrationRefundClaim,
  reconcileProviderRegistrationRefundWebhook,
  reconcileRegistrationRefundWebhook,
  registrationProviderRefundOperationKey,
  registrationProviderRefundPersistence,
  registrationRefundAmbiguousRecoveryPredicate,
  registrationRefundAmbiguousRecoveryUpdate,
  registrationRefundClaimablePredicate,
  registrationRefundClaimAttempts,
  registrationRefundClaimInsert,
  registrationRefundIdempotencyKey,
  registrationRefundMatchesPersistedClaim,
  registrationRefundRequeueEligibility,
  registrationRefundRetryDelayMs,
  registrationRefundSourcePaymentPredicate,
  registrationRefundStatusCanAdvance,
  registrationRefundStatusUpdate,
} from './registration-refund';

const dialect = new PgDialect();
const normalizeSql = (statement: string): string =>
  statement.replaceAll(/\s+/g, ' ').trim();

type RefundFixtureRow = Pick<
  typeof transactions.$inferSelect,
  | 'amount'
  | 'currency'
  | 'eventId'
  | 'eventRegistrationId'
  | 'id'
  | 'manuallyCreated'
  | 'method'
  | 'refundOperationKey'
  | 'sourceTransactionId'
  | 'status'
  | 'stripeAccountId'
  | 'stripeRefundApplicationFee'
  | 'stripeRefundAttempts'
  | 'stripeRefundClaimLeaseExpiresAt'
  | 'stripeRefundClaimLeaseId'
  | 'stripeRefundGeneration'
  | 'stripeRefundHistory'
  | 'stripeRefundId'
  | 'stripeRefundLastError'
  | 'stripeRefundLastRequeueReason'
  | 'stripeRefundMaxAttempts'
  | 'stripeRefundNextAttemptAt'
  | 'stripeRefundRequeuedAt'
  | 'stripeRefundStatus'
  | 'targetUserId'
  | 'tenantId'
  | 'type'
>;

type RefundSourceFixtureRow = Pick<
  typeof transactions.$inferSelect,
  | 'amount'
  | 'currency'
  | 'eventId'
  | 'eventRegistrationId'
  | 'id'
  | 'status'
  | 'stripeAccountId'
  | 'stripeChargeId'
  | 'stripePaymentIntentId'
  | 'targetUserId'
  | 'tenantId'
>;

const refundFixtureRow = (
  overrides: Partial<RefundFixtureRow>,
): RefundFixtureRow => ({
  amount: -1000,
  currency: 'EUR',
  eventId: 'event-1',
  eventRegistrationId: 'registration-1',
  id: 'refund-claim-1',
  manuallyCreated: false,
  method: 'stripe',
  refundOperationKey: 'registration-transfer-source:transfer-1:source-1',
  sourceTransactionId: 'source-1',
  status: 'pending',
  stripeAccountId: 'acct_1',
  stripeRefundApplicationFee: false,
  stripeRefundAttempts: 0,
  stripeRefundClaimLeaseExpiresAt: null,
  stripeRefundClaimLeaseId: null,
  stripeRefundGeneration: 0,
  stripeRefundHistory: [],
  stripeRefundId: null,
  stripeRefundLastError: null,
  stripeRefundLastRequeueReason: null,
  stripeRefundMaxAttempts: 8,
  stripeRefundNextAttemptAt: new Date('2026-07-14T12:00:00.000Z'),
  stripeRefundRequeuedAt: null,
  stripeRefundStatus: null,
  targetUserId: 'attendee-1',
  tenantId: 'tenant-1',
  type: 'refund',
  ...overrides,
});

const refundSourceFixtureRow = (
  overrides: Partial<RefundSourceFixtureRow> = {},
): RefundSourceFixtureRow => ({
  amount: 1200,
  currency: 'EUR',
  eventId: 'event-1',
  eventRegistrationId: 'registration-1',
  id: 'source-1',
  status: 'successful',
  stripeAccountId: 'acct_1',
  stripeChargeId: 'ch_source',
  stripePaymentIntentId: 'pi_source',
  targetUserId: 'attendee-1',
  tenantId: 'tenant-1',
  ...overrides,
});

const refundFixtureString = (value: unknown): string => {
  if (typeof value !== 'string')
    throw new TypeError('Expected a SQL string parameter');
  return value;
};
const refundFixtureNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError('Expected an integer SQL parameter');
  }
  return value;
};
const refundFixtureDate = (value: unknown): Date => {
  const text = refundFixtureString(value);
  const date = new Date(text);
  assert.strictEqual(date.toISOString(), text);
  return date;
};
const refundFixtureStatus = (value: unknown): RefundFixtureRow['status'] => {
  if (value !== 'pending' && value !== 'successful' && value !== 'cancelled') {
    throw new TypeError('Unexpected transaction status parameter');
  }
  return value;
};
const refundFixtureStripeStatus = (
  value: unknown,
): RefundFixtureRow['stripeRefundStatus'] => {
  if (
    value !== null &&
    value !== 'pending' &&
    value !== 'requires_action' &&
    value !== 'succeeded' &&
    value !== 'failed' &&
    value !== 'canceled'
  ) {
    throw new TypeError('Unexpected Stripe refund status parameter');
  }
  return value;
};

const providerRefundFields = [
  'amount',
  'currency',
  'eventId',
  'eventRegistrationId',
  'id',
  'manuallyCreated',
  'method',
  'refundOperationKey',
  'sourceTransactionId',
  'status',
  'stripeAccountId',
  'stripeRefundAttempts',
  'stripeRefundClaimLeaseExpiresAt',
  'stripeRefundClaimLeaseId',
  'stripeRefundGeneration',
  'stripeRefundHistory',
  'stripeRefundId',
  'stripeRefundLastError',
  'stripeRefundMaxAttempts',
  'stripeRefundNextAttemptAt',
  'stripeRefundStatus',
  'targetUserId',
  'tenantId',
  'type',
] as const satisfies readonly (keyof RefundFixtureRow)[];
const internalRefundFields = [
  'amount',
  'currency',
  'eventRegistrationId',
  'id',
  'refundOperationKey',
  'sourceTransactionId',
  'stripeAccountId',
  'stripeRefundAttempts',
  'stripeRefundGeneration',
  'stripeRefundHistory',
  'stripeRefundId',
  'stripeRefundMaxAttempts',
  'stripeRefundStatus',
  'tenantId',
] as const satisfies readonly (keyof RefundFixtureRow)[];
const workerRefundFields = [
  'amount',
  'currency',
  'eventRegistrationId',
  'id',
  'refundOperationKey',
  'sourceTransactionId',
  'stripeAccountId',
  'stripeRefundApplicationFee',
  'stripeRefundAttempts',
  'stripeRefundGeneration',
  'stripeRefundId',
  'stripeRefundMaxAttempts',
  'tenantId',
] as const satisfies readonly (keyof RefundFixtureRow)[];
const fixtureRefundValues = (
  row: RefundFixtureRow,
  fields: readonly (keyof RefundFixtureRow)[],
) =>
  fields.map((field) => {
    const value = row[field];
    return value instanceof Date ? value.toISOString().replace('Z', '') : value;
  });

const providerSourceSql =
  'select "amount", "currency", "eventId", "eventRegistrationId", "id", "status", "stripe_account_id", "stripeChargeId", "stripePaymentIntentId", "targetUserId", "tenantId" from "transactions" where (((("transactions"."stripeChargeId" = $1) or ("transactions"."stripePaymentIntentId" = $2))) and ("transactions"."method" = $3) and ("transactions"."type" in ($4, $5))) order by "transactions"."id" for update';
const providerRefundSql =
  'select "amount", "currency", "eventId", "eventRegistrationId", "id", "manuallyCreated", "method", "refund_operation_key", "source_transaction_id", "status", "stripe_account_id", "stripe_refund_attempts", "stripe_refund_claim_lease_expires_at"::text, "stripe_refund_claim_lease_id", "stripe_refund_generation", "stripe_refund_history", "stripe_refund_id", "stripe_refund_last_error", "stripe_refund_max_attempts", "stripe_refund_next_attempt_at"::text, "stripe_refund_status", "targetUserId", "tenantId", "type" from "transactions" where (("transactions"."source_transaction_id" = $1) and ("transactions"."tenantId" = $2) and ("transactions"."type" = $3)) order by "transactions"."id" for update';
const internalRefundProjection =
  'select "amount", "currency", "eventRegistrationId", "id", "refund_operation_key", "source_transaction_id", "stripe_account_id", "stripe_refund_attempts", "stripe_refund_generation", "stripe_refund_history", "stripe_refund_id", "stripe_refund_max_attempts", "stripe_refund_status", "tenantId" from "transactions" where ';
const workerRefundProjection =
  '"amount", "currency", "eventRegistrationId", "id", "refund_operation_key", "source_transaction_id", "stripe_account_id", "stripe_refund_application_fee", "stripe_refund_attempts", "stripe_refund_generation", "stripe_refund_id", "stripe_refund_max_attempts", "tenantId"';
const persistedSourceWhere =
  ' from "transactions" where (("transactions"."id" = $1) and ("transactions"."eventRegistrationId" = $2) and ("transactions"."method" = $3) and ("transactions"."status" = $4) and ("transactions"."stripe_account_id" = $5) and ("transactions"."tenantId" = $6) and ("transactions"."type" in ($7, $8)))';
const providerRefundInsertSql =
  'insert into "transactions" ("createdAt", "id", "updatedAt", "tenantId", "amount", "appFee", "comment", "currency", "eventId", "eventRegistrationId", "executiveUserId", "manuallyCreated", "method", "refund_operation_key", "source_transaction_id", "status", "stripe_account_id", "stripeChargeId", "stripe_checkout_cancellation_requested_at", "stripe_checkout_incident_session_id", "stripe_checkout_reconcile_attempts", "stripe_checkout_reconcile_last_error", "stripe_checkout_reconcile_lease_expires_at", "stripe_checkout_reconcile_lease_id", "stripe_checkout_reconcile_next_at", "stripe_checkout_request", "stripeCheckoutSessionId", "stripeCheckoutUrl", "stripeFee", "stripe_net_amount", "stripePaymentIntentId", "stripe_refund_application_fee", "stripe_refund_attempts", "stripe_refund_claim_lease_expires_at", "stripe_refund_claim_lease_id", "stripe_refund_generation", "stripe_refund_history", "stripe_refund_id", "stripe_refund_last_error", "stripe_refund_last_requeue_reason", "stripe_refund_max_attempts", "stripe_refund_next_attempt_at", "stripe_refund_requeued_at", "stripe_refund_status", "targetUserId", "type") values (default, $1, default, $2, $3, default, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, default, default, default, default, default, default, default, default, default, default, default, default, default, default, $15, default, $16, $17, default, default, $18, $19, default, default, $20, default, $21, $22, $23) on conflict do nothing returning "id"';
const compensationRefundLookupSql =
  'select "registration_transfers"."id", "registration_transfers"."status", "registration_transfers"."tenantId" from "registration_transfers" inner join "transactions" on (("transactions"."id" = "registration_transfers"."compensation_refund_transaction_id") and ("transactions"."tenantId" = "registration_transfers"."tenantId") and ("transactions"."type" = $1)) where (("registration_transfers"."compensation_refund_transaction_id" = $2) and ("transactions"."id" = $3)) for update';
const sourceRefundLookupSql =
  'select "registration_transfers"."id", "registration_transfers"."status", "registration_transfers"."tenantId" from "registration_transfer_refund_plan_items" inner join "registration_transfers" on (("registration_transfers"."id" = "registration_transfer_refund_plan_items"."transfer_id") and ("registration_transfers"."tenantId" = "registration_transfer_refund_plan_items"."tenant_id")) inner join "transactions" on (("transactions"."id" = "registration_transfer_refund_plan_items"."refund_transaction_id") and ("transactions"."tenantId" = "registration_transfer_refund_plan_items"."tenant_id") and ("transactions"."type" = $1)) where (("registration_transfer_refund_plan_items"."refund_transaction_id" = $2) and ("transactions"."id" = $3)) for update';

const createRefundDatabaseFixture = ({
  rows = [],
  source = refundSourceFixtureRow(),
}: { rows?: RefundFixtureRow[]; source?: RefundSourceFixtureRow } = {}) => {
  let transactionOpen = false;
  let insertCount = 0;
  let updateCount = 0;
  let finalUpdate: Partial<RefundFixtureRow> | undefined;
  let releaseUpdate: Partial<RefundFixtureRow> | undefined;
  let leaseId: string | undefined;
  const transactionCommands: string[] = [];
  const rowById = (id: string) => {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`Unexpected refund fixture row: ${id}`);
    return row;
  };
  const executeValues: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      const sql = normalizeSql(statement);
      const releaseAttempt = sql.startsWith(
        'update "transactions" set "updatedAt" = $1, "stripe_refund_claim_lease_expires_at" = $2, "stripe_refund_claim_lease_id" = $3, "stripe_refund_last_error" = $4, "stripe_refund_next_attempt_at" = $5 where ',
      );
      assert.strictEqual(
        transactionOpen,
        !releaseAttempt,
        'Only failed-worker lease release is outside a transaction',
      );
      if (sql === providerSourceSql) {
        assert.deepEqual(parameters, [
          'ch_source',
          'pi_source',
          'stripe',
          'registration',
          'addon',
        ]);
        return [
          [
            source.amount,
            source.currency,
            source.eventId,
            source.eventRegistrationId,
            source.id,
            source.status,
            source.stripeAccountId,
            source.stripeChargeId,
            source.stripePaymentIntentId,
            source.targetUserId,
            source.tenantId,
          ],
        ];
      }
      if (sql === providerRefundSql) {
        assert.deepEqual(parameters, [source.id, source.tenantId, 'refund']);
        return rows.map((row) =>
          fixtureRefundValues(row, providerRefundFields),
        );
      }
      if (sql.startsWith(internalRefundProjection)) {
        const metadataLookup = parameters.length === 4;
        assert.strictEqual(
          sql,
          internalRefundProjection +
            (metadataLookup
              ? '(((("transactions"."id" = $1) or ("transactions"."stripe_refund_id" = $2))) and ("transactions"."method" = $3) and ("transactions"."type" = $4)) for update'
              : '(("transactions"."stripe_refund_id" = $1) and ("transactions"."method" = $2) and ("transactions"."type" = $3)) for update'),
        );
        const refundId = refundFixtureString(
          parameters[metadataLookup ? 1 : 0],
        );
        const claimId = metadataLookup
          ? refundFixtureString(parameters[0])
          : undefined;
        assert.deepEqual(parameters, [
          ...(claimId ? [claimId] : []),
          refundId,
          'stripe',
          'refund',
        ]);
        return rows
          .filter(
            (row) => row.id === claimId || row.stripeRefundId === refundId,
          )
          .map((row) => fixtureRefundValues(row, internalRefundFields));
      }
      const workerSourceProjection =
        'select "eventRegistrationId", "id", "stripe_account_id", "stripeChargeId", "stripePaymentIntentId"';
      const webhookSourceProjection =
        'select "eventRegistrationId", "stripe_account_id", "stripeChargeId", "stripePaymentIntentId"';
      if (
        sql === workerSourceProjection + persistedSourceWhere ||
        sql === webhookSourceProjection + persistedSourceWhere
      ) {
        assert.deepEqual(parameters, [
          source.id,
          source.eventRegistrationId,
          'stripe',
          'successful',
          source.stripeAccountId,
          source.tenantId,
          'registration',
          'addon',
        ]);
        return [
          [
            source.eventRegistrationId,
            ...(sql.startsWith(workerSourceProjection) ? [source.id] : []),
            source.stripeAccountId,
            source.stripeChargeId,
            source.stripePaymentIntentId,
          ],
        ];
      }
      if (
        sql === compensationRefundLookupSql ||
        sql === sourceRefundLookupSql
      ) {
        const id = refundFixtureString(parameters[1]);
        rowById(id);
        assert.deepEqual(parameters, ['refund', id, id]);
        return [];
      }
      if (sql === providerRefundInsertSql) {
        const id = refundFixtureString(parameters[0]);
        const refundId = refundFixtureString(parameters[17]);
        const amount = refundFixtureNumber(parameters[2]);
        const status = refundFixtureStatus(parameters[12]);
        const stripeStatus = refundFixtureStripeStatus(parameters[20]);
        assert.lengthOf(id, 20);
        assert.isBelow(amount, 0);
        assert.deepEqual(parameters, [
          id,
          source.tenantId,
          amount,
          'Ticket refund',
          source.currency,
          source.eventId,
          source.eventRegistrationId,
          null,
          false,
          'stripe',
          registrationProviderRefundOperationKey(refundId),
          source.id,
          status,
          source.stripeAccountId,
          false,
          null,
          null,
          refundId,
          null,
          null,
          stripeStatus,
          source.targetUserId,
          'refund',
        ]);
        const row = refundFixtureRow({
          amount,
          currency: source.currency,
          eventId: source.eventId,
          eventRegistrationId: source.eventRegistrationId,
          id,
          refundOperationKey: registrationProviderRefundOperationKey(refundId),
          sourceTransactionId: source.id,
          status,
          stripeAccountId: source.stripeAccountId,
          stripeRefundId: refundId,
          stripeRefundNextAttemptAt: null,
          stripeRefundStatus: stripeStatus,
          targetUserId: source.targetUserId,
          tenantId: source.tenantId,
        });
        rows.push(row);
        insertCount += 1;
        return [[id]];
      }
      if (
        sql.startsWith(
          'update "transactions" set "updatedAt" = $1, "stripe_refund_attempts" = case ',
        )
      ) {
        refundFixtureDate(parameters[0]);
        const expiresAt = refundFixtureDate(parameters[1]);
        leaseId = refundFixtureString(parameters[2]);
        assert.lengthOf(leaseId, 20);
        assert.isNull(parameters[3]);
        const id = refundFixtureString(parameters[4]);
        const now = new Date(expiresAt.getTime() - 10 * 60 * 1000);
        const predicate = dialect.sqlToQuery(
          registrationRefundClaimablePredicate(now),
        );
        const whereSql = predicate.sql.replaceAll(
          /\$(\d+)/g,
          (_, index: string) => `$${Number(index) + 5}`,
        );
        assert.strictEqual(
          sql,
          'update "transactions" set "updatedAt" = $1, "stripe_refund_attempts" = case when "transactions"."stripe_refund_claim_lease_id" is null then "transactions"."stripe_refund_attempts" + 1 else "transactions"."stripe_refund_attempts" end, "stripe_refund_claim_lease_expires_at" = $2, "stripe_refund_claim_lease_id" = $3, "stripe_refund_last_error" = $4 where (("transactions"."id" = $5) and (' +
            normalizeSql(whereSql) +
            ')) returning ' +
            workerRefundProjection,
        );
        assert.deepEqual(parameters.slice(5), predicate.params);
        const row = rowById(id);
        assert.strictEqual(row.method, 'stripe');
        assert.strictEqual(row.status, 'pending');
        assert.strictEqual(row.type, 'refund');
        assert.isNull(row.stripeRefundClaimLeaseId);
        assert.isNull(row.stripeRefundClaimLeaseExpiresAt);
        if (!row.stripeRefundNextAttemptAt)
          throw new Error('Expected a scheduled refund claim');
        assert.isAtMost(row.stripeRefundNextAttemptAt.getTime(), now.getTime());
        assert.isBelow(row.stripeRefundAttempts, row.stripeRefundMaxAttempts);
        row.stripeRefundAttempts += 1;
        row.stripeRefundClaimLeaseExpiresAt = expiresAt;
        row.stripeRefundClaimLeaseId = leaseId;
        return [fixtureRefundValues(row, workerRefundFields)];
      }
      if (sql.startsWith('update "transactions" set ')) {
        const setEnd = sql.indexOf(' where ');
        const assignments = sql
          .slice('update "transactions" set '.length, setEnd)
          .split(', ');
        const columns = assignments.map((assignment, index) => {
          const match = /^"([^"]+)" = \$(\d+)$/.exec(assignment);
          if (!match?.[1] || Number(match[2]) !== index + 1)
            throw new Error('Unexpected refund UPDATE assignment');
          return match[1];
        });
        const statusColumns = [
          'updatedAt',
          'status',
          'stripe_refund_claim_lease_expires_at',
          'stripe_refund_claim_lease_id',
          'stripe_refund_id',
          'stripe_refund_last_error',
          'stripe_refund_next_attempt_at',
          'stripe_refund_status',
        ];
        const releaseColumns = [
          'updatedAt',
          'stripe_refund_claim_lease_expires_at',
          'stripe_refund_claim_lease_id',
          'stripe_refund_last_error',
          'stripe_refund_next_attempt_at',
        ];
        const holdColumns = [
          'updatedAt',
          'stripe_refund_last_error',
          'stripe_refund_next_attempt_at',
        ];
        const rebaseColumns = [
          'updatedAt',
          'amount',
          'status',
          'stripe_refund_attempts',
          'stripe_refund_claim_lease_expires_at',
          'stripe_refund_claim_lease_id',
          'stripe_refund_generation',
          'stripe_refund_history',
          'stripe_refund_id',
          'stripe_refund_last_error',
          'stripe_refund_last_requeue_reason',
          'stripe_refund_next_attempt_at',
          'stripe_refund_requeued_at',
          'stripe_refund_status',
        ];
        const adoptColumns = [
          'updatedAt',
          'status',
          'stripe_refund_application_fee',
          'stripe_refund_claim_lease_expires_at',
          'stripe_refund_claim_lease_id',
          'stripe_refund_history',
          'stripe_refund_id',
          'stripe_refund_last_error',
          'stripe_refund_next_attempt_at',
          'stripe_refund_status',
        ];
        assert.isTrue(
          [
            statusColumns,
            holdColumns,
            rebaseColumns,
            adoptColumns,
            releaseColumns,
          ].some((expected) => expected.join(',') === columns.join(',')),
          'Unexpected refund UPDATE column set/order',
        );
        const id = refundFixtureString(parameters[columns.length]);
        const row = rowById(id);
        const first = columns.length + 1;
        const singleWhere = ` where "transactions"."id" = $${first}`;
        const guardedWhere = ` where (("transactions"."id" = $${first}) and ("transactions"."status" = $${first + 1}) and (("transactions"."stripe_refund_claim_lease_expires_at" is null)) and (("transactions"."stripe_refund_claim_lease_id" is null))) returning "id"`;
        const providerWhere = ` where (("transactions"."id" = $${first}) and ("transactions"."stripe_refund_id" = $${first + 1})) returning "id"`;
        const leaseWhere = ` where (("transactions"."id" = $${first}) and ("transactions"."stripe_refund_claim_lease_id" = $${first + 1})) returning "id"`;
        const suffix = sql.slice(setEnd);
        switch (suffix) {
          case guardedWhere: {
            assert.deepEqual(parameters.slice(columns.length), [id, 'pending']);
            assert.strictEqual(row.status, 'pending');
            assert.isNull(row.stripeRefundClaimLeaseExpiresAt);
            assert.isNull(row.stripeRefundClaimLeaseId);

            break;
          }
          case providerWhere: {
            assert.deepEqual(parameters.slice(columns.length), [
              id,
              row.stripeRefundId,
            ]);
            break;
          }
          case singleWhere: {
            assert.deepEqual(parameters.slice(columns.length), [id]);
            break;
          }
          default: {
            if (
              suffix === leaseWhere ||
              (releaseAttempt &&
                suffix === leaseWhere.replace(' returning "id"', ''))
            ) {
              assert.deepEqual(parameters.slice(columns.length), [id, leaseId]);
              assert.strictEqual(row.stripeRefundClaimLeaseId, leaseId);
            } else
              throw new Error('Unexpected refund UPDATE ownership predicate');
          }
        }
        const values: Partial<RefundFixtureRow> = {};
        for (const [index, column] of columns.entries()) {
          const value = parameters[index];
          switch (column) {
            case 'amount': {
              values.amount = refundFixtureNumber(value);
              break;
            }
            case 'status': {
              values.status = refundFixtureStatus(value);
              break;
            }
            case 'stripe_refund_application_fee': {
              assert.isFalse(value);
              values.stripeRefundApplicationFee = false;
              break;
            }
            case 'stripe_refund_attempts': {
              values.stripeRefundAttempts = refundFixtureNumber(value);
              break;
            }
            case 'stripe_refund_claim_lease_expires_at': {
              assert.isNull(value);
              values.stripeRefundClaimLeaseExpiresAt = null;
              break;
            }
            case 'stripe_refund_claim_lease_id': {
              assert.isNull(value);
              values.stripeRefundClaimLeaseId = null;
              break;
            }
            case 'stripe_refund_generation': {
              values.stripeRefundGeneration = refundFixtureNumber(value);
              break;
            }
            case 'stripe_refund_history': {
              assert.strictEqual(value, '[]');
              values.stripeRefundHistory = [];
              break;
            }
            case 'stripe_refund_id': {
              values.stripeRefundId =
                value === null ? null : refundFixtureString(value);
              break;
            }
            case 'stripe_refund_last_error': {
              values.stripeRefundLastError =
                value === null ? null : refundFixtureString(value);
              break;
            }
            case 'stripe_refund_last_requeue_reason': {
              values.stripeRefundLastRequeueReason = refundFixtureString(value);
              break;
            }
            case 'stripe_refund_next_attempt_at': {
              values.stripeRefundNextAttemptAt =
                value === null ? null : refundFixtureDate(value);
              break;
            }
            case 'stripe_refund_requeued_at': {
              values.stripeRefundRequeuedAt = refundFixtureDate(value);
              break;
            }
            case 'stripe_refund_status': {
              values.stripeRefundStatus = refundFixtureStripeStatus(value);
              break;
            }
            case 'updatedAt': {
              refundFixtureDate(value);
              break;
            }
            default: {
              throw new Error(`Unexpected refund UPDATE column: ${column}`);
            }
          }
        }
        Object.assign(row, values);
        if (releaseAttempt) releaseUpdate = values;
        else finalUpdate = values;
        updateCount += 1;
        return suffix === singleWhere || releaseAttempt ? [] : [[id]];
      }
      throw new Error(`Unexpected refund fixture SQL: ${statement}`);
    });
  const layer = createRegistrationDatabaseTestLayer({
    executeValues,
    transactionControl: (command) =>
      Effect.sync(() => {
        assert.strictEqual(transactionOpen, command !== 'BEGIN');
        transactionOpen = command === 'BEGIN';
        transactionCommands.push(command);
      }),
  });
  return {
    assertClosed() {
      assert.isFalse(transactionOpen);
      assert.notInclude(transactionCommands, 'ROLLBACK');
    },
    get finalUpdate() {
      return finalUpdate;
    },
    get insertCount() {
      return insertCount;
    },
    layer,
    get providerRefund() {
      return rows.find((row) =>
        row.refundOperationKey?.startsWith('stripe-provider-refund:'),
      );
    },
    get releaseUpdate() {
      return releaseUpdate;
    },
    transactionCommands,
    get updateCount() {
      return updateCount;
    },
  };
};

describe('registration refund claims', () => {
  it.effect('starts the worker in the enabled production/default mode', () =>
    Effect.gen(function* () {
      const workerRan = yield* Ref.make(false);
      const result = yield* launchRegistrationRefundWorker(
        'enabled',
        Ref.set(workerRan, true),
      );
      yield* Effect.yieldNow;

      expect(result).toBe('started');
      expect(yield* Ref.get(workerRan)).toBe(true);
    }),
  );

  it.effect('does not start the worker in validated Playwright mode', () =>
    Effect.gen(function* () {
      const workerRan = yield* Ref.make(false);
      const result = yield* launchRegistrationRefundWorker(
        'disabledForPlaywright',
        Ref.set(workerRan, true),
      );
      yield* Effect.yieldNow;

      expect(result).toBe('disabledForPlaywright');
      expect(yield* Ref.get(workerRan)).toBe(false);
    }),
  );

  it('persists a null executive for platform-owned claims', () => {
    expect(
      registrationRefundClaimInsert(
        'refund-1',
        {
          amount: 1000,
          applicationFeeRefunded: false,
          currency: 'EUR',
          eventId: 'event-1',
          eventRegistrationId: 'registration-1',
          operationKey: 'platform-refund:refund-1',
          sourceTransactionId: 'source-1',
          stripeAccountId: 'acct_1',
          targetUserId: 'attendee-1',
          tenantId: 'tenant-1',
        },
        'platform-refund:refund-1',
        new Date('2026-07-10T12:00:00.000Z'),
      ),
    ).toEqual(
      expect.objectContaining({
        comment: 'Ticket refund',
        executiveUserId: null,
      }),
    );
  });

  it('uses the durable claim generation as the stable Stripe idempotency key', () => {
    expect(registrationRefundIdempotencyKey('refund-claim-1')).toBe(
      'registration-refund:refund-claim-1',
    );
    expect(registrationRefundIdempotencyKey('refund-claim-1', 1)).toBe(
      'registration-refund:refund-claim-1:generation:1',
    );
  });

  it('builds a deterministic, non-automatically-retried provider refund record', () => {
    const source = {
      amount: 1200,
      currency: 'EUR' as const,
      eventId: 'event-1',
      eventRegistrationId: 'registration-1',
      id: 'source-1',
      stripeAccountId: 'acct_1',
      targetUserId: 'attendee-1',
      tenantId: 'tenant-1',
    };
    const operationKey = registrationProviderRefundOperationKey('re_external');

    expect(operationKey).toHaveLength(87);
    expect(registrationProviderRefundOperationKey('re_external')).toBe(
      operationKey,
    );
    expect(
      registrationProviderRefundPersistence(
        { amount: 400, id: 're_external', status: 'succeeded' },
        source,
        'refund-1',
      ),
    ).toEqual(
      expect.objectContaining({
        amount: -400,
        comment: 'Ticket refund',
        eventRegistrationId: 'registration-1',
        manuallyCreated: false,
        refundOperationKey: operationKey,
        sourceTransactionId: 'source-1',
        status: 'successful',
        stripeAccountId: 'acct_1',
        stripeRefundId: 're_external',
        stripeRefundNextAttemptAt: null,
        stripeRefundStatus: 'succeeded',
        tenantId: 'tenant-1',
      }),
    );
    expect(
      registrationProviderRefundPersistence(
        { amount: 400, id: 're_external', status: 'failed' },
        source,
        'refund-1',
      ),
    ).toMatchObject({ status: 'cancelled', stripeRefundStatus: 'failed' });
  });

  it.effect(
    'resumes a valid metadata-less provider refund without exhausting it',
    () =>
      Effect.gen(function* () {
        const refundId = 're_provider_pending';
        const refundClaimId = 'provider-refund-claim-1';
        const claimedRow = {
          amount: -400,
          currency: 'EUR' as const,
          eventRegistrationId: 'registration-1',
          id: refundClaimId,
          refundOperationKey: registrationProviderRefundOperationKey(refundId),
          sourceTransactionId: 'source-1',
          stripeAccountId: 'acct_1',
          stripeRefundApplicationFee: false,
          stripeRefundAttempts: 1,
          stripeRefundGeneration: 0,
          stripeRefundId: refundId,
          stripeRefundMaxAttempts: 8,
          tenantId: 'tenant-1',
        };
        const source = {
          eventRegistrationId: 'registration-1',
          id: 'source-1',
          stripeAccountId: 'acct_1',
          stripeChargeId: 'ch_source',
          stripePaymentIntentId: 'pi_source',
        };
        const fixture = createRefundDatabaseFixture({
          rows: [
            refundFixtureRow({
              ...claimedRow,
              stripeRefundAttempts: 0,
              stripeRefundNextAttemptAt: new Date(0),
            }),
          ],
          source: refundSourceFixtureRow(source),
        });
        const stripe = createRejectingStripeClient();
        const retrieve = vi.spyOn(stripe.refunds, 'retrieve').mockResolvedValue(
          stripeRefundResponse({
            amount: 400,
            charge: 'ch_source',
            currency: 'eur',
            id: refundId,
            metadata: {},
            payment_intent: 'pi_source',
            status: 'succeeded',
          }),
        );

        const result = yield* processRegistrationRefundClaim(
          refundClaimId,
        ).pipe(
          Effect.provideService(StripeClient, stripe),
          Effect.provide(fixture.layer),
        );

        expect(result).toEqual({ refundId, status: 'processed' });
        expect(retrieve).toHaveBeenCalledOnce();
        assert.deepEqual(retrieve.mock.calls, [
          [refundId, undefined, { stripeAccount: 'acct_1' }],
        ]);
        expect(fixture.releaseUpdate).toBeUndefined();
        expect(fixture.finalUpdate).toMatchObject({
          status: 'successful',
          stripeRefundId: refundId,
          stripeRefundLastError: null,
          stripeRefundNextAttemptAt: null,
          stripeRefundStatus: 'succeeded',
        });
        fixture.assertClosed();
      }),
  );

  it.effect(
    'reconciles one metadata-less provider refund monotonically and rejects ownership mismatches',
    () =>
      Effect.gen(function* () {
        const source = {
          amount: 1200,
          currency: 'EUR' as const,
          eventId: 'event-1',
          eventRegistrationId: 'registration-1',
          id: 'source-1',
          status: 'successful' as const,
          stripeAccountId: 'acct_1',
          stripeChargeId: 'ch_source',
          stripePaymentIntentId: 'pi_source',
          targetUserId: 'attendee-1',
          tenantId: 'tenant-1',
        };
        const fixture = createRefundDatabaseFixture({ source });
        const layer = fixture.layer;
        const refund = stripeRefundResponse({
          amount: 400,
          charge: 'ch_source',
          currency: 'eur',
          id: 're_external',
          metadata: {},
          object: 'refund',
          payment_intent: 'pi_source',
          status: 'pending',
        });

        yield* Effect.gen(function* () {
          expect(
            yield* reconcileProviderRegistrationRefundWebhook(refund, 'acct_1'),
          ).toEqual({ status: 'reconciled' });
          expect(fixture.insertCount).toBe(1);
          expect(fixture.providerRefund).toMatchObject({
            sourceTransactionId: 'source-1',
            stripeRefundStatus: 'pending',
          });

          expect(
            yield* reconcileProviderRegistrationRefundWebhook(
              stripeRefundResponse({ ...refund, status: 'succeeded' }),
              'acct_1',
            ),
          ).toEqual({ status: 'reconciled' });
          expect(fixture.updateCount).toBe(1);
          expect(fixture.providerRefund).toMatchObject({
            status: 'successful',
            stripeRefundStatus: 'succeeded',
          });

          expect(
            yield* reconcileProviderRegistrationRefundWebhook(refund, 'acct_1'),
          ).toEqual({ status: 'reconciled' });
          expect(fixture.updateCount).toBe(1);

          for (const [candidate, account] of [
            [{ ...refund, amount: 1201 }, 'acct_1'],
            [{ ...refund, currency: 'usd' }, 'acct_1'],
            [refund, 'acct_foreign'],
          ] as const) {
            expect(
              yield* reconcileProviderRegistrationRefundWebhook(
                candidate,
                account,
              ),
            ).toEqual({ status: 'rejected' });
          }
          expect(fixture.insertCount).toBe(1);
          expect(fixture.updateCount).toBe(1);
        }).pipe(Effect.provide(layer));
        fixture.assertClosed();
      }),
  );

  it.effect(
    'defers a provider refund until its exact pending source payment is finalized',
    () =>
      Effect.gen(function* () {
        const source = {
          amount: 1200,
          currency: 'EUR' as const,
          eventId: 'event-1',
          eventRegistrationId: 'registration-1',
          id: 'source-1',
          status: 'pending' as const,
          stripeAccountId: 'acct_1',
          stripeChargeId: 'ch_source',
          stripePaymentIntentId: 'pi_source',
          targetUserId: 'attendee-1',
          tenantId: 'tenant-1',
        };
        const fixture = createRefundDatabaseFixture({ source });
        const layer = fixture.layer;

        yield* Effect.gen(function* () {
          expect(
            yield* reconcileProviderRegistrationRefundWebhook(
              stripeRefundResponse({
                amount: 400,
                charge: 'ch_source',
                currency: 'eur',
                id: 're_external_pending_source',
                metadata: {},
                object: 'refund',
                payment_intent: 'pi_source',
                status: 'succeeded',
              }),
              'acct_1',
            ),
          ).toEqual({ status: 'deferred' });
          expect(fixture.insertCount).toBe(0);
        }).pipe(Effect.provide(layer));
        fixture.assertClosed();
      }),
  );

  it.effect(
    'rebases an attempted internal claim after a successful partial provider refund',
    () =>
      Effect.gen(function* () {
        const source = {
          amount: 1000,
          currency: 'EUR' as const,
          eventId: 'event-1',
          eventRegistrationId: 'registration-1',
          id: 'source-1',
          status: 'successful' as const,
          stripeAccountId: 'acct_1',
          stripeChargeId: 'ch_source',
          stripePaymentIntentId: 'pi_source',
          targetUserId: 'attendee-1',
          tenantId: 'tenant-1',
        };
        const claim = refundFixtureRow({
          amount: -1000,
          currency: 'EUR',
          eventId: 'event-1',
          eventRegistrationId: 'registration-1',
          id: 'refund-claim-1',
          manuallyCreated: false,
          method: 'stripe',
          refundOperationKey:
            'registration-transfer-source:transfer-1:source-1',
          sourceTransactionId: 'source-1',
          status: 'pending',
          stripeAccountId: 'acct_1',
          stripeRefundAttempts: 1,
          stripeRefundClaimLeaseExpiresAt: null,
          stripeRefundClaimLeaseId: null,
          stripeRefundGeneration: 0,
          stripeRefundHistory: [],
          stripeRefundId: null,
          stripeRefundLastError: null,
          stripeRefundMaxAttempts: 8,
          stripeRefundNextAttemptAt: new Date('2026-07-14T12:00:00.000Z'),
          stripeRefundStatus: null,
          targetUserId: 'attendee-1',
          tenantId: 'tenant-1',
          type: 'refund',
        });
        const fixture = createRefundDatabaseFixture({ rows: [claim], source });
        const layer = fixture.layer;

        yield* Effect.gen(function* () {
          expect(
            yield* reconcileProviderRegistrationRefundWebhook(
              stripeRefundResponse({
                amount: 400,
                charge: 'ch_source',
                currency: 'eur',
                id: 're_external_partial',
                metadata: {},
                object: 'refund',
                payment_intent: 'pi_source',
                status: 'pending',
              }),
              'acct_1',
            ),
          ).toEqual({ status: 'deferred' });
          expect(fixture.providerRefund).toBeUndefined();
          expect(claim).toMatchObject({
            stripeRefundLastError:
              'Waiting for Stripe provider refund re_external_partial to reach a terminal state',
            stripeRefundNextAttemptAt: null,
          });

          expect(
            yield* reconcileProviderRegistrationRefundWebhook(
              stripeRefundResponse({
                amount: 400,
                charge: 'ch_source',
                currency: 'eur',
                id: 're_external_partial',
                metadata: {},
                object: 'refund',
                payment_intent: 'pi_source',
                status: 'succeeded',
              }),
              'acct_1',
            ),
          ).toEqual({ status: 'reconciled' });
          expect(fixture.providerRefund).toMatchObject({
            amount: -400,
            stripeRefundId: 're_external_partial',
            stripeRefundStatus: 'succeeded',
          });
          expect(claim).toMatchObject({
            amount: -600,
            status: 'pending',
            stripeRefundAttempts: 0,
            stripeRefundClaimLeaseId: null,
            stripeRefundGeneration: 1,
            stripeRefundId: null,
            stripeRefundStatus: null,
          });

          expect(
            yield* reconcileProviderRegistrationRefundWebhook(
              stripeRefundResponse({
                amount: 400,
                charge: 'ch_source',
                currency: 'eur',
                id: 're_external_partial',
                metadata: {},
                object: 'refund',
                payment_intent: 'pi_source',
                status: 'succeeded',
              }),
              'acct_1',
            ),
          ).toEqual({ status: 'reconciled' });
          expect(claim).toMatchObject({ amount: -600, status: 'pending' });
        }).pipe(Effect.provide(layer));
        fixture.assertClosed();
      }),
  );

  it.effect(
    'adopts an exact successful provider refund into the internal claim',
    () =>
      Effect.gen(function* () {
        const source = {
          amount: 1000,
          currency: 'EUR' as const,
          eventId: 'event-1',
          eventRegistrationId: 'registration-1',
          id: 'source-1',
          status: 'successful' as const,
          stripeAccountId: 'acct_1',
          stripeChargeId: 'ch_source',
          stripePaymentIntentId: 'pi_source',
          targetUserId: 'attendee-1',
          tenantId: 'tenant-1',
        };
        const claim = refundFixtureRow({
          amount: -1000,
          currency: 'EUR',
          eventId: 'event-1',
          eventRegistrationId: 'registration-1',
          id: 'refund-claim-1',
          manuallyCreated: false,
          method: 'stripe',
          refundOperationKey:
            'registration-transfer-source:transfer-1:source-1',
          sourceTransactionId: 'source-1',
          status: 'pending',
          stripeAccountId: 'acct_1',
          stripeRefundAttempts: 0,
          stripeRefundClaimLeaseExpiresAt: null,
          stripeRefundClaimLeaseId: null,
          stripeRefundGeneration: 0,
          stripeRefundHistory: [],
          stripeRefundId: null,
          stripeRefundLastError: null,
          stripeRefundMaxAttempts: 8,
          stripeRefundNextAttemptAt: new Date('2026-07-14T12:00:00.000Z'),
          stripeRefundStatus: null,
          targetUserId: 'attendee-1',
          tenantId: 'tenant-1',
          type: 'refund',
        });
        const fixture = createRefundDatabaseFixture({ rows: [claim], source });
        const layer = fixture.layer;

        yield* Effect.gen(function* () {
          expect(
            yield* reconcileProviderRegistrationRefundWebhook(
              stripeRefundResponse({
                amount: 1000,
                charge: 'ch_source',
                currency: 'eur',
                id: 're_external_full',
                metadata: {},
                object: 'refund',
                payment_intent: 'pi_source',
                status: 'succeeded',
              }),
              'acct_1',
            ),
          ).toEqual({ status: 'reconciled' });
          expect(fixture.insertCount).toBe(0);
          expect(claim).toMatchObject({
            status: 'successful',
            stripeRefundId: 're_external_full',
            stripeRefundNextAttemptAt: null,
            stripeRefundStatus: 'succeeded',
          });
        }).pipe(Effect.provide(layer));
        fixture.assertClosed();
      }),
  );

  it.effect(
    'reconciles an internal refund by its persisted Stripe ID after metadata is cleared',
    () =>
      Effect.gen(function* () {
        const claim = refundFixtureRow({
          amount: -1000,
          currency: 'EUR' as const,
          eventRegistrationId: 'registration-1',
          id: 'refund-claim-1',
          refundOperationKey:
            'registration-transfer-source:transfer-1:source-1',
          sourceTransactionId: 'source-1',
          stripeAccountId: 'acct_1',
          stripeRefundAttempts: 1,
          stripeRefundGeneration: 0,
          stripeRefundHistory: [],
          stripeRefundId: 're_internal',
          stripeRefundMaxAttempts: 8,
          stripeRefundStatus: 'pending' as const,
          tenantId: 'tenant-1',
        });
        const source = {
          eventRegistrationId: 'registration-1',
          stripeAccountId: 'acct_1',
          stripeChargeId: 'ch_source',
          stripePaymentIntentId: 'pi_source',
        };
        const fixture = createRefundDatabaseFixture({
          rows: [claim],
          source: refundSourceFixtureRow(source),
        });
        const layer = fixture.layer;

        yield* Effect.gen(function* () {
          expect(
            yield* reconcileRegistrationRefundWebhook(
              stripeRefundResponse({
                amount: 1000,
                charge: 'ch_source',
                currency: 'eur',
                id: 're_internal',
                metadata: {},
                object: 'refund',
                payment_intent: 'pi_source',
                status: 'succeeded',
              }),
              'acct_1',
            ),
          ).toEqual({ status: 'reconciled' });
          expect(fixture.finalUpdate).toMatchObject({
            status: 'successful',
            stripeRefundId: 're_internal',
            stripeRefundStatus: 'succeeded',
          });
        }).pipe(Effect.provide(layer));
        fixture.assertClosed();
      }),
  );

  it.effect(
    'prefers a persisted provider refund ID over unrelated claim-like metadata',
    () =>
      Effect.gen(function* () {
        const claimCandidate = refundFixtureRow({
          amount: -1000,
          currency: 'EUR' as const,
          eventRegistrationId: 'registration-1',
          id: 'refund-claim-1',
          refundOperationKey:
            'registration-transfer-source:transfer-1:source-1',
          sourceTransactionId: 'source-1',
          stripeAccountId: 'acct_1',
          stripeRefundAttempts: 0,
          stripeRefundGeneration: 0,
          stripeRefundHistory: [],
          stripeRefundId: null,
          stripeRefundMaxAttempts: 8,
          stripeRefundStatus: null,
          tenantId: 'tenant-1',
        });
        const providerCandidate = {
          ...claimCandidate,
          amount: -400,
          id: 'provider-ledger-1',
          refundOperationKey:
            registrationProviderRefundOperationKey('re_provider'),
          stripeRefundId: 're_provider',
          stripeRefundStatus: 'succeeded' as const,
        };
        const fixture = createRefundDatabaseFixture({
          rows: [claimCandidate, providerCandidate],
        });
        const layer = fixture.layer;

        yield* Effect.gen(function* () {
          expect(
            yield* reconcileRegistrationRefundWebhook(
              stripeRefundResponse({
                amount: 400,
                charge: 'ch_source',
                currency: 'eur',
                id: 're_provider',
                metadata: { refundClaimId: 'refund-claim-1' },
                object: 'refund',
                payment_intent: 'pi_source',
                status: 'succeeded',
              }),
              'acct_1',
            ),
          ).toEqual({ status: 'notClaim' });
        }).pipe(Effect.provide(layer));
        fixture.assertClosed();
      }),
  );

  it('only creates a new refund generation for a known terminal Stripe refund', () => {
    const base = {
      attempts: 8,
      leaseExpiresAt: null,
      leaseId: null,
      maxAttempts: 8,
      nextAttemptAt: null,
      refundId: 're_failed',
      status: 'pending' as const,
      stripeRefundStatus: 'failed' as const,
    };
    expect(registrationRefundRequeueEligibility(base)).toBe('newGeneration');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        refundId: null,
      }),
    ).toBe('ambiguous');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        refundId: null,
        stripeRefundStatus: null,
      }),
    ).toBe('ambiguous');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        status: 'successful',
        stripeRefundStatus: 'succeeded',
      }),
    ).toBe('succeeded');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        leaseId: 'lease-active',
      }),
    ).toBe('ambiguous');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        leaseExpiresAt: new Date('2026-07-10T12:10:00.000Z'),
        leaseId: 'lease-active',
        refundId: null,
        stripeRefundStatus: null,
      }),
    ).toBe('active');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        attempts: 1,
        nextAttemptAt: new Date('2026-07-10T12:10:00.000Z'),
        refundId: null,
        stripeRefundStatus: null,
      }),
    ).toBe('active');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        nextAttemptAt: new Date('2026-07-10T12:10:00.000Z'),
        refundId: null,
        stripeRefundStatus: 'pending',
      }),
    ).toBe('ambiguous');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        attempts: 1,
        refundId: null,
        stripeRefundStatus: null,
      }),
    ).toBe('ambiguous');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        attempts: 0,
        refundId: null,
        stripeRefundStatus: null,
      }),
    ).toBe('resumeGeneration');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        refundId: 're_processing',
        stripeRefundStatus: 'pending',
      }),
    ).toBe('resumeGeneration');
  });

  it('bounds worker batch sizes and exponential retry delays', () => {
    expect(normalizeRegistrationRefundBatchSize()).toBe(25);
    expect(normalizeRegistrationRefundBatchSize(0)).toBe(1);
    expect(normalizeRegistrationRefundBatchSize(12.9)).toBe(12);
    expect(normalizeRegistrationRefundBatchSize(1000)).toBe(100);
    expect(normalizeRegistrationRefundBatchSize(NaN)).toBe(25);

    expect(registrationRefundRetryDelayMs(1)).toBe(1000);
    expect(registrationRefundRetryDelayMs(4)).toBe(8000);
    expect(registrationRefundRetryDelayMs(100)).toBe(30 * 60 * 1000);
  });

  it('maps only Stripe refund states that can be persisted', () => {
    expect(persistedRegistrationRefundStatus('requires_action')).toBe(
      'requires_action',
    );
    expect(persistedRegistrationRefundStatus('succeeded')).toBe('succeeded');
    expect(persistedRegistrationRefundStatus('future_status')).toBe('pending');
    expect(persistedRegistrationRefundStatus(null)).toBe('pending');
  });

  it('stops polling non-terminal provider states when retry budget is exhausted', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    expect(
      registrationRefundStatusUpdate(
        { id: 're_pending', status: 'pending' },
        now,
        8,
        8,
      ),
    ).toMatchObject({
      stripeRefundLastError:
        'Stripe refund remained pending after maximum processing attempts',
      stripeRefundNextAttemptAt: null,
      stripeRefundStatus: 'pending',
    });
    expect(
      registrationRefundStatusUpdate(
        { id: 're_pending', status: 'pending' },
        now,
        7,
        8,
      ).stripeRefundNextAttemptAt,
    ).toEqual(new Date('2026-07-10T12:01:00.000Z'));
  });

  it('does not let stale pending events downgrade terminal refund outcomes', () => {
    expect(registrationRefundStatusCanAdvance(null, 'pending')).toBe(true);
    expect(registrationRefundStatusCanAdvance('pending', 'succeeded')).toBe(
      true,
    );
    expect(
      registrationRefundStatusCanAdvance('requires_action', 'canceled'),
    ).toBe(true);
    expect(registrationRefundStatusCanAdvance('succeeded', 'pending')).toBe(
      false,
    );
    expect(registrationRefundStatusCanAdvance('failed', 'pending')).toBe(false);
    expect(registrationRefundStatusCanAdvance('canceled', 'canceled')).toBe(
      true,
    );
  });

  it('accepts refund reconciliation only for exact claim metadata and source ownership', () => {
    const refund = stripeRefundResponse({
      amount: 1000,
      charge: null,
      currency: 'eur',
      metadata: {
        refundClaimId: 'refund-1',
        refundGeneration: '0',
        registrationId: 'registration-1',
        sourceTransactionId: 'source-1',
        tenantId: 'tenant-1',
      },
      payment_intent: 'pi_1',
    });
    const expected = {
      amount: 1000,
      currency: 'EUR',
      refundClaimId: 'refund-1',
      refundGeneration: 0,
      registrationId: 'registration-1',
      sourceTransactionId: 'source-1',
      stripeReference: { paymentIntent: 'pi_1' },
      tenantId: 'tenant-1',
    } as const;

    expect(registrationRefundMatchesPersistedClaim(refund, expected)).toBe(
      true,
    );
    expect(
      registrationRefundMatchesPersistedClaim(
        { ...refund, amount: 999 },
        expected,
      ),
    ).toBe(false);
    expect(
      registrationRefundMatchesPersistedClaim(
        { ...refund, payment_intent: 'pi_other' },
        expected,
      ),
    ).toBe(false);
    expect(
      registrationRefundMatchesPersistedClaim(refund, {
        ...expected,
        refundGeneration: 1,
      }),
    ).toBe(false);
  });

  it('accepts exact registration or add-on Stripe sources without weakening ownership', () => {
    const predicate = registrationRefundSourcePaymentPredicate({
      eventRegistrationId: 'registration-1',
      sourceTransactionId: 'source-1',
      stripeAccountId: 'acct_1',
      tenantId: 'tenant-1',
    });
    assert.isDefined(predicate);
    const query = dialect.sqlToQuery(predicate);
    const statement = normalizeSql(query.sql);

    expect(statement).toContain('"transactions"."eventRegistrationId" =');
    expect(statement).toContain('"transactions"."stripe_account_id" =');
    expect(statement).toContain('"transactions"."type" in');
    expect(query.params).toEqual([
      'source-1',
      'registration-1',
      'stripe',
      'successful',
      'acct_1',
      'tenant-1',
      'registration',
      'addon',
    ]);
  });

  it('only retries recent id-less refund requests while known refunds remain retrievable', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const claimablePredicate = registrationRefundClaimablePredicate(now);
    assert.isDefined(claimablePredicate);
    const claimable = dialect.sqlToQuery(claimablePredicate);
    const statement = normalizeSql(claimable.sql);

    expect(statement).toContain(
      '"transactions"."stripe_refund_attempts" < "transactions"."stripe_refund_max_attempts"',
    );
    expect(statement).toContain(
      '"transactions"."stripe_refund_claim_lease_id" is not null',
    );
    expect(statement).toContain(
      '"transactions"."stripe_refund_claim_lease_expires_at" <=',
    );
    expect(statement).toContain(
      '"transactions"."stripe_refund_id" is not null',
    );
    expect(statement).toContain('"transactions"."stripe_refund_id" is null');
    expect(statement).toContain(
      '"transactions"."stripe_refund_claim_lease_expires_at" >',
    );
    expect(statement).toContain(
      '"transactions"."stripe_refund_next_attempt_at" >',
    );
    expect(statement).toContain(
      'coalesce("transactions"."stripe_refund_requeued_at", "transactions"."createdAt") >',
    );
    expect(statement).toContain('"transactions"."stripe_refund_attempts" =');
    expect(statement).toContain('"transactions"."stripe_refund_attempts" >');
    expect(claimable.params).toContain('2026-07-09T14:00:00.000Z');

    const ambiguousPredicate =
      registrationRefundAmbiguousRecoveryPredicate(now);
    assert.isDefined(ambiguousPredicate);
    const ambiguous = dialect.sqlToQuery(ambiguousPredicate);
    const ambiguousStatement = normalizeSql(ambiguous.sql);
    expect(ambiguousStatement).toContain(
      '"transactions"."stripe_refund_id" is null',
    );
    expect(ambiguousStatement).toContain(
      '"transactions"."stripe_refund_claim_lease_expires_at" <=',
    );
    expect(ambiguousStatement).toContain(
      '"transactions"."stripe_refund_next_attempt_at" <=',
    );
    expect(ambiguousStatement).toContain(
      'coalesce("transactions"."stripe_refund_requeued_at", "transactions"."createdAt") <=',
    );
    expect(ambiguousStatement).toContain(
      '"transactions"."stripe_refund_attempts" =',
    );
    expect(ambiguousStatement).toContain(
      '"transactions"."stripe_refund_attempts" >',
    );
    expect(ambiguous.params).toContain('2026-07-09T14:00:00.000Z');
    expect(registrationRefundAmbiguousRecoveryUpdate()).toEqual({
      stripeRefundClaimLeaseExpiresAt: null,
      stripeRefundClaimLeaseId: null,
      stripeRefundLastError:
        'Automatic recovery stopped because the prior Stripe refund attempt is too old to retry safely without a persisted refund ID; reconcile the claim with Stripe manually',
      stripeRefundNextAttemptAt: null,
    });

    const attempts = dialect.sqlToQuery(registrationRefundClaimAttempts());
    expect(normalizeSql(attempts.sql)).toBe(
      'case when "transactions"."stripe_refund_claim_lease_id" is null then "transactions"."stripe_refund_attempts" + 1 else "transactions"."stripe_refund_attempts" end',
    );
  });
});
