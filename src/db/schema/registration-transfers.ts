import { registrationTransferStatuses } from '@shared/registration-transfer';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventInstances } from './event-instances';
import { eventRegistrationOptions } from './event-registration-options';
import { eventRegistrations } from './event-registrations';
import { modelOfTenant } from './model';
import { tenants } from './tenants';
import { transactions } from './transactions';
import { users } from './users';

export const registrationTransferStatus = pgEnum(
  'registration_transfer_status',
  registrationTransferStatuses,
);

export const registrationTransferEventType = pgEnum(
  'registration_transfer_event_type',
  [
    'created',
    'claimed',
    'checkout_expired',
    'checkout_started',
    'checkout_retried',
    'recipient_confirmed',
    'source_cancelled',
    'refund_queued',
    'refund_completed',
    'refund_failed',
    'refund_requeued',
    'recipient_cancelled',
    'compensation_queued',
    'compensation_completed',
    'compensation_failed',
    'compensation_requeued',
    'cancelled',
    'expired',
  ],
);

export const activeRegistrationTransferSourceUniqueIndexName =
  'registration_transfers_active_source_unique';
export const registrationTransferExpiryIndexName =
  'registration_transfers_expiry_idx';

export const registrationTransfers = pgTable(
  'registration_transfers',
  {
    ...modelOfTenant,
    cancelledAt: timestamp('cancelled_at'),
    claimCodeHash: varchar('claim_code_hash', { length: 64 })
      .notNull()
      .unique(),
    claimTokenHash: varchar('claim_token_hash', { length: 64 })
      .notNull()
      .unique(),
    compensatedAt: timestamp('compensated_at'),
    compensationStartedAt: timestamp('compensation_started_at'),
    completedAt: timestamp('completed_at'),
    eventId: varchar('event_id', { length: 20 })
      .notNull()
      .references(() => eventInstances.id),
    expiredAt: timestamp('expired_at'),
    expiresAt: timestamp('expires_at').notNull(),
    lastError: text('last_error'),
    recipientCheckoutTransactionId: varchar(
      'recipient_checkout_transaction_id',
      { length: 20 },
    ).references(() => transactions.id),
    recipientConfirmedAt: timestamp('recipient_confirmed_at'),
    recipientRegistrationId: varchar('recipient_registration_id', {
      length: 20,
    })
      .unique()
      .references(() => eventRegistrations.id),
    recipientSpotCount: integer('recipient_spot_count'),
    recipientUserId: varchar('recipient_user_id', { length: 20 }).references(
      () => users.id,
    ),
    refundCompletedAt: timestamp('refund_completed_at'),
    refundTransactionId: varchar('refund_transaction_id', {
      length: 20,
    }).references(() => transactions.id),
    registrationOptionId: varchar('registration_option_id', { length: 20 })
      .notNull()
      .references(() => eventRegistrationOptions.id),
    reservedAdditionalSpots: integer('reserved_additional_spots')
      .notNull()
      .default(0),
    sourceCancelledAt: timestamp('source_cancelled_at'),
    sourcePaymentTransactionId: varchar('source_payment_transaction_id', {
      length: 20,
    }).references(() => transactions.id),
    sourceRefundAmount: integer('source_refund_amount'),
    sourceRefundApplicationFee: boolean('source_refund_application_fee')
      .notNull()
      .default(false),
    sourceRegistrationId: varchar('source_registration_id', { length: 20 })
      .notNull()
      .references(() => eventRegistrations.id),
    sourceSpotCount: integer('source_spot_count').notNull(),
    sourceUserId: varchar('source_user_id', { length: 20 })
      .notNull()
      .references(() => users.id),
    status: registrationTransferStatus().notNull().default('open'),
  },
  (table) => ({
    activeSource: uniqueIndex(activeRegistrationTransferSourceUniqueIndexName)
      .on(table.sourceRegistrationId)
      .where(
        sql`${table.status} IN ('open', 'checkout_pending', 'refund_pending', 'refund_failed')`,
      ),
    byExpiry: index(registrationTransferExpiryIndexName).on(
      table.status,
      table.expiresAt,
    ),
    byRecipient: index('registration_transfers_recipient_idx').on(
      table.tenantId,
      table.recipientUserId,
    ),
    byTenantEvent: index('registration_transfers_tenant_event_idx').on(
      table.tenantId,
      table.eventId,
    ),
    optionEvent: foreignKey({
      columns: [table.registrationOptionId, table.eventId],
      foreignColumns: [
        eventRegistrationOptions.id,
        eventRegistrationOptions.eventId,
      ],
      name: 'registration_transfers_option_event_fk',
    }),
    recipientSpotCountPositive: check(
      'registration_transfers_recipient_spot_count_positive',
      sql`${table.recipientSpotCount} IS NULL OR ${table.recipientSpotCount} > 0`,
    ),
    reservedAdditionalSpotsNonnegative: check(
      'registration_transfers_reserved_spots_nonnegative',
      sql`${table.reservedAdditionalSpots} >= 0`,
    ),
    sourceRefundAmountNonnegative: check(
      'registration_transfers_source_refund_nonnegative',
      sql`${table.sourceRefundAmount} IS NULL OR ${table.sourceRefundAmount} >= 0`,
    ),
    sourceSpotCountPositive: check(
      'registration_transfers_source_spot_count_positive',
      sql`${table.sourceSpotCount} > 0`,
    ),
  }),
);

export const registrationTransferEvents = pgTable(
  'registration_transfer_events',
  {
    actorUserId: varchar('actor_user_id', { length: 20 }).references(
      () => users.id,
    ),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    eventType: registrationTransferEventType('event_type').notNull(),
    fromStatus: registrationTransferStatus('from_status'),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    reason: text(),
    tenantId: varchar('tenant_id', { length: 20 })
      .notNull()
      .references(() => tenants.id),
    toStatus: registrationTransferStatus('to_status').notNull(),
    transferId: varchar('transfer_id', { length: 20 })
      .notNull()
      .references(() => registrationTransfers.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    byTransfer: index('registration_transfer_events_transfer_idx').on(
      table.transferId,
      table.createdAt,
    ),
  }),
);
