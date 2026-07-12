import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { Schema } from 'effect';

import { eventInstances } from './event-instances';
import { eventRegistrations } from './event-registrations';
import { modelOfTenant } from './model';
import { currencyEnum } from './tenants';
import { users } from './users';

export const transactionStatus = pgEnum('transaction_status', [
  'pending',
  'successful',
  'cancelled',
]);

export const transactionMethod = pgEnum('transaction_method', [
  'stripe',
  'transfer',
  'paypal',
  'cash',
]);

export const transactionType = pgEnum('transaction_type', [
  'addon',
  'registration',
  'refund',
  'other',
]);

export const stripeRefundStatus = pgEnum('stripe_refund_status', [
  'pending',
  'requires_action',
  'succeeded',
  'failed',
  'canceled',
]);

export const RegistrationCheckoutLineItemSnapshotSchema = Schema.Struct({
  addonId: Schema.optional(Schema.String),
  allocationKey: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Literals(['addon', 'registration'])),
  name: Schema.String,
  quantity: Schema.Number,
  taxRateId: Schema.optional(Schema.String),
  unitAmount: Schema.Number,
});

export type RegistrationCheckoutLineItemSnapshot = Schema.Schema.Type<
  typeof RegistrationCheckoutLineItemSnapshotSchema
>;

export const RegistrationCheckoutSnapshotSchema = Schema.Struct({
  customerEmail: Schema.String,
  eventTitle: Schema.String,
  eventUrl: Schema.String,
  expiresAt: Schema.Number,
  lineItems: Schema.Array(RegistrationCheckoutLineItemSnapshotSchema),
  notificationEmail: Schema.String,
});

export type RegistrationCheckoutSnapshot = Schema.Schema.Type<
  typeof RegistrationCheckoutSnapshotSchema
>;

export interface RegistrationRefundAttemptHistory {
  readonly closedAt: string;
  readonly generation: number;
  readonly reason: string;
  readonly refundId: string;
  readonly status: 'canceled' | 'failed';
}

export const pendingRegistrationTransactionUniqueIndexName =
  'transactions_pending_registration_unique';
export const paidEventTransactionMethodCheckName =
  'transactions_paid_event_method_stripe';
export const registrationRefundOperationUniqueIndexName =
  'transactions_registration_refund_operation_unique';

export const transactions = pgTable(
  'transactions',
  {
    ...modelOfTenant,
    amount: integer().notNull(),
    appFee: integer(),
    comment: text(),
    currency: currencyEnum().notNull(),
    eventId: varchar({ length: 20 }),
    eventRegistrationId: varchar({ length: 20 }),
    executiveUserId: varchar({ length: 20 }).references(() => users.id),
    manuallyCreated: boolean().default(false),
    method: transactionMethod().notNull(),
    refundOperationKey: varchar('refund_operation_key', { length: 100 }),
    sourceTransactionId: varchar('source_transaction_id', {
      length: 20,
    }),
    status: transactionStatus().notNull(),
    stripeAccountId: varchar('stripe_account_id', { length: 255 }),
    stripeChargeId: varchar().unique(),
    stripeCheckoutCancellationRequestedAt: timestamp(
      'stripe_checkout_cancellation_requested_at',
    ),
    stripeCheckoutReconcileAttempts: integer(
      'stripe_checkout_reconcile_attempts',
    )
      .notNull()
      .default(0),
    stripeCheckoutReconcileLastError: text(
      'stripe_checkout_reconcile_last_error',
    ),
    stripeCheckoutReconcileLeaseExpiresAt: timestamp(
      'stripe_checkout_reconcile_lease_expires_at',
    ),
    stripeCheckoutReconcileLeaseId: text('stripe_checkout_reconcile_lease_id'),
    stripeCheckoutReconcileNextAt: timestamp(
      'stripe_checkout_reconcile_next_at',
    ),
    stripeCheckoutRequest: jsonb(
      'stripe_checkout_request',
    ).$type<RegistrationCheckoutSnapshot>(),
    stripeCheckoutSessionId: varchar().unique(),
    stripeCheckoutUrl: varchar().unique(),
    stripeFee: integer(),
    stripeNetAmount: integer('stripe_net_amount'),
    stripePaymentIntentId: varchar().unique(),
    stripeRefundApplicationFee: boolean('stripe_refund_application_fee'),
    stripeRefundAttempts: integer('stripe_refund_attempts')
      .notNull()
      .default(0),
    stripeRefundClaimLeaseExpiresAt: timestamp(
      'stripe_refund_claim_lease_expires_at',
    ),
    stripeRefundClaimLeaseId: text('stripe_refund_claim_lease_id'),
    stripeRefundGeneration: integer('stripe_refund_generation')
      .notNull()
      .default(0),
    stripeRefundHistory: jsonb('stripe_refund_history')
      .$type<readonly RegistrationRefundAttemptHistory[]>()
      .notNull()
      .default([]),
    stripeRefundId: varchar('stripe_refund_id', { length: 255 }).unique(),
    stripeRefundLastError: text('stripe_refund_last_error'),
    stripeRefundLastRequeueReason: text('stripe_refund_last_requeue_reason'),
    stripeRefundMaxAttempts: integer('stripe_refund_max_attempts')
      .notNull()
      .default(8),
    stripeRefundNextAttemptAt: timestamp('stripe_refund_next_attempt_at'),
    stripeRefundRequeuedAt: timestamp('stripe_refund_requeued_at'),
    stripeRefundStatus: stripeRefundStatus('stripe_refund_status'),
    targetUserId: varchar({ length: 20 }).references(() => users.id),
    type: transactionType().notNull(),
  },
  (table) => ({
    eventTenant: foreignKey({
      columns: [table.eventId, table.tenantId],
      foreignColumns: [eventInstances.id, eventInstances.tenantId],
      name: 'transactions_event_tenant_fk',
    }),
    onePendingPaymentPerRegistration: uniqueIndex(
      pendingRegistrationTransactionUniqueIndexName,
    )
      .on(table.eventRegistrationId)
      .where(
        sql`${table.status} = 'pending' AND ${table.type} = 'registration' AND ${table.eventRegistrationId} IS NOT NULL`,
      ),
    oneRefundClaimPerSourceOperation: uniqueIndex(
      registrationRefundOperationUniqueIndexName,
    )
      .on(table.tenantId, table.sourceTransactionId, table.refundOperationKey)
      .where(
        sql`${table.type} = 'refund' AND ${table.sourceTransactionId} IS NOT NULL AND ${table.refundOperationKey} IS NOT NULL`,
      ),
    paidEventTransactionMethod: check(
      paidEventTransactionMethodCheckName,
      sql`${table.type} NOT IN ('registration', 'addon') OR ${table.method} = 'stripe'`,
    ),
    refundOperationShape: check(
      'transactions_refund_operation_shape',
      sql`(
        (${table.type} <> 'refund' AND ${table.sourceTransactionId} IS NULL AND ${table.refundOperationKey} IS NULL AND ${table.stripeRefundApplicationFee} IS NULL)
        OR
        (${table.type} = 'refund' AND ${table.amount} < 0 AND (
          (${table.sourceTransactionId} IS NULL AND ${table.refundOperationKey} IS NULL AND ${table.stripeRefundApplicationFee} IS NULL AND ${table.manuallyCreated} IS TRUE)
          OR
          (${table.sourceTransactionId} IS NOT NULL AND length(trim(${table.refundOperationKey})) BETWEEN 1 AND 100)
        ))
      )`,
    ),
    refundRetryIndex: index('transactions_refund_retry_idx').on(
      table.type,
      table.status,
      table.stripeRefundNextAttemptAt,
    ),
    registrationEvent: foreignKey({
      columns: [table.eventRegistrationId, table.eventId],
      foreignColumns: [eventRegistrations.id, eventRegistrations.eventId],
      name: 'transactions_registration_event_fk',
    }),
    registrationIdentity: unique(
      'transactions_id_registration_tenant_unique',
    ).on(table.id, table.eventRegistrationId, table.tenantId),
    registrationLookupIndex: index(
      'transactions_tenant_event_registration_type_idx',
    )
      .on(table.tenantId, table.eventRegistrationId, table.type)
      .where(sql`${table.eventRegistrationId} IS NOT NULL`),
    registrationTenant: foreignKey({
      columns: [table.eventRegistrationId, table.tenantId],
      foreignColumns: [eventRegistrations.id, eventRegistrations.tenantId],
      name: 'transactions_registration_tenant_fk',
    }),
    sourceTenant: foreignKey({
      columns: [table.sourceTransactionId, table.tenantId],
      foreignColumns: [table.id, table.tenantId],
      name: 'transactions_source_tenant_fk',
    }),
    stripeCheckoutReconcileIndex: index(
      'transactions_checkout_reconcile_idx',
    ).on(table.type, table.status, table.stripeCheckoutReconcileNextAt),
    tenantIdentity: unique('transactions_id_tenant_unique').on(
      table.id,
      table.tenantId,
    ),
  }),
);
