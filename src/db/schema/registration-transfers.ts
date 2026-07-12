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
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventAddons } from './event-addons';
import { eventInstances } from './event-instances';
import { eventRegistrationAddonPurchaseLots } from './event-registration-addon-purchase-lots';
import { eventRegistrationAddonPurchases } from './event-registration-addon-purchases';
import { eventRegistrationOptions } from './event-registration-options';
import { eventRegistrationQuestions } from './event-registration-questions';
import { eventRegistrations } from './event-registrations';
import { discountTypes } from './global-enums';
import { modelOfTenant } from './model';
import { currencyEnum, tenants } from './tenants';
import { transactions, transactionType } from './transactions';
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
    'ownership_transferred',
    'refund_queued',
    'refund_completed',
    'refund_failed',
    'refund_requeued',
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
    compensationRefundTransactionId: varchar(
      'compensation_refund_transaction_id',
      { length: 20 },
    ).references(() => transactions.id),
    compensationStartedAt: timestamp('compensation_started_at'),
    completedAt: timestamp('completed_at'),
    eventId: varchar('event_id', { length: 20 })
      .notNull()
      .references(() => eventInstances.id),
    expiredAt: timestamp('expired_at'),
    expiresAt: timestamp('expires_at').notNull(),
    lastError: text('last_error'),
    ownershipTransferredAt: timestamp('ownership_transferred_at'),
    recipientAppliedDiscountedPrice: integer(
      'recipient_applied_discounted_price',
    ),
    recipientAppliedDiscountType: discountTypes(
      'recipient_applied_discount_type',
    ),
    recipientBasePrice: integer('recipient_base_price'),
    recipientCheckoutTransactionId: varchar(
      'recipient_checkout_transaction_id',
      { length: 20 },
    ).references(() => transactions.id),
    recipientConfirmedAt: timestamp('recipient_confirmed_at'),
    recipientDiscountAmount: integer('recipient_discount_amount'),
    recipientRegistrationId: varchar('recipient_registration_id', {
      length: 20,
    }).references(() => eventRegistrations.id),
    recipientSpotCount: integer('recipient_spot_count'),
    recipientStripeTaxRateId: varchar('recipient_tax_rate_id'),
    recipientTaxRateDisplayName: text('recipient_tax_rate_name'),
    recipientTaxRateInclusive: boolean('recipient_tax_rate_inclusive'),
    recipientTaxRatePercentage: text('recipient_tax_rate_percentage'),
    recipientUserId: varchar('recipient_user_id', { length: 20 }).references(
      () => users.id,
    ),
    refundCompletedAt: timestamp('refund_completed_at'),
    registrationOptionId: varchar('registration_option_id', { length: 20 })
      .notNull()
      .references(() => eventRegistrationOptions.id),
    reservedAdditionalSpots: integer('reserved_additional_spots')
      .notNull()
      .default(0),
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
    byRecipientRegistration: index(
      'registration_transfers_recipient_registration_idx',
    ).on(
      table.tenantId,
      table.recipientRegistrationId,
      table.ownershipTransferredAt,
    ),
    byTenantEvent: index('registration_transfers_tenant_event_idx').on(
      table.tenantId,
      table.eventId,
    ),
    compensationRefundTenant: foreignKey({
      columns: [table.compensationRefundTransactionId, table.tenantId],
      foreignColumns: [transactions.id, transactions.tenantId],
      name: 'registration_transfers_compensation_refund_tenant_fk',
    }),
    optionEvent: foreignKey({
      columns: [table.registrationOptionId, table.eventId],
      foreignColumns: [
        eventRegistrationOptions.id,
        eventRegistrationOptions.eventId,
      ],
      name: 'registration_transfers_option_event_fk',
    }),
    recipientCheckoutTenant: foreignKey({
      columns: [table.recipientCheckoutTransactionId, table.tenantId],
      foreignColumns: [transactions.id, transactions.tenantId],
      name: 'registration_transfers_recipient_checkout_tenant_fk',
    }),
    recipientRegistrationTenant: foreignKey({
      columns: [table.recipientRegistrationId, table.tenantId],
      foreignColumns: [eventRegistrations.id, eventRegistrations.tenantId],
      name: 'registration_transfers_recipient_registration_tenant_fk',
    }),
    recipientSpotCountPositive: check(
      'registration_transfers_recipient_spot_count_positive',
      sql`${table.recipientSpotCount} IS NULL OR ${table.recipientSpotCount} > 0`,
    ),
    recipientUsesSourceRegistration: check(
      'registration_transfers_recipient_is_source_registration',
      sql`${table.recipientRegistrationId} IS NULL OR ${table.recipientRegistrationId} = ${table.sourceRegistrationId}`,
    ),
    recipientUsesSourceSpots: check(
      'registration_transfers_recipient_preserves_spots',
      sql`${table.recipientSpotCount} IS NULL OR ${table.recipientSpotCount} = ${table.sourceSpotCount}`,
    ),
    reservedAdditionalSpotsNonnegative: check(
      'registration_transfers_reserved_spots_nonnegative',
      sql`${table.reservedAdditionalSpots} = 0`,
    ),
    sourceRegistrationTenant: foreignKey({
      columns: [table.sourceRegistrationId, table.tenantId],
      foreignColumns: [eventRegistrations.id, eventRegistrations.tenantId],
      name: 'registration_transfers_source_registration_tenant_fk',
    }),
    sourceSpotCountPositive: check(
      'registration_transfers_source_spot_count_positive',
      sql`${table.sourceSpotCount} > 0`,
    ),
    tenantIdentity: unique('registration_transfers_id_tenant_unique').on(
      table.id,
      table.tenantId,
    ),
  }),
);

export const registrationTransferBundleAddonPurchases = pgTable(
  'registration_transfer_bundle_addon_purchases',
  {
    addonId: varchar('addon_id', { length: 20 }).notNull(),
    cancelledQuantity: integer('cancelled_quantity').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    eventId: varchar('event_id', { length: 20 }).notNull(),
    includedQuantity: integer('included_quantity').notNull(),
    purchasedQuantity: integer('purchased_quantity').notNull(),
    quantity: integer('quantity').notNull(),
    recipientStripeTaxRateId: varchar('recipient_tax_rate_id'),
    recipientTaxRateDisplayName: text('recipient_tax_rate_name'),
    recipientTaxRateInclusive: boolean('recipient_tax_rate_inclusive'),
    recipientTaxRatePercentage: text('recipient_tax_rate_percentage'),
    recipientUnitPrice: integer('recipient_unit_price'),
    redeemedQuantity: integer('redeemed_quantity').notNull(),
    refundAllocatedPurchasedQuantity: integer(
      'refund_allocated_purchased_quantity',
    ).notNull(),
    registrationOptionId: varchar('registration_option_id', {
      length: 20,
    }).notNull(),
    sourcePurchaseId: varchar('source_purchase_id', { length: 20 }).notNull(),
    taxRateDisplayName: text('tax_rate_name'),
    taxRateInclusive: boolean('tax_rate_inclusive'),
    taxRatePercentage: text('tax_rate_percentage'),
    tenantId: varchar('tenant_id', { length: 20 })
      .notNull()
      .references(() => tenants.id),
    transferId: varchar('transfer_id', { length: 20 }).notNull(),
    unitPrice: integer('unit_price').notNull(),
  },
  (table) => ({
    addonEvent: foreignKey({
      columns: [table.addonId, table.eventId],
      foreignColumns: [eventAddons.id, eventAddons.eventId],
      name: 'registration_transfer_bundle_addon_event_fk',
    }),
    bySourcePurchase: index(
      'registration_transfer_bundle_source_purchase_idx',
    ).on(table.tenantId, table.sourcePurchaseId),
    fulfillmentBounds: check(
      'registration_transfer_bundle_fulfillment_bounds',
      sql`${table.redeemedQuantity} >= 0 AND ${table.cancelledQuantity} >= 0 AND ${table.redeemedQuantity} + ${table.cancelledQuantity} <= ${table.quantity}`,
    ),
    grantBreakdown: check(
      'registration_transfer_bundle_grant_breakdown',
      sql`${table.quantity} > 0 AND ${table.includedQuantity} >= 0 AND ${table.purchasedQuantity} >= 0 AND ${table.quantity} = ${table.includedQuantity} + ${table.purchasedQuantity}`,
    ),
    oneAddonPerTransfer: unique('registration_transfer_bundle_addon_unique').on(
      table.transferId,
      table.addonId,
    ),
    onePurchasePerTransfer: unique(
      'registration_transfer_bundle_purchase_unique',
    ).on(table.transferId, table.sourcePurchaseId),
    priceNonnegative: check(
      'registration_transfer_bundle_price_nonnegative',
      sql`${table.unitPrice} >= 0`,
    ),
    purchaseTenant: foreignKey({
      columns: [table.sourcePurchaseId, table.tenantId],
      foreignColumns: [
        eventRegistrationAddonPurchases.id,
        eventRegistrationAddonPurchases.tenantId,
      ],
      name: 'registration_transfer_bundle_purchase_tenant_fk',
    }),
    recipientTermsShape: check(
      'registration_transfer_bundle_recipient_terms_shape',
      sql`(
        ${table.recipientUnitPrice} IS NULL AND ${table.recipientStripeTaxRateId} IS NULL AND ${table.recipientTaxRateDisplayName} IS NULL AND ${table.recipientTaxRateInclusive} IS NULL AND ${table.recipientTaxRatePercentage} IS NULL
      ) OR (
        ${table.recipientUnitPrice} >= 0 AND (
          (${table.recipientStripeTaxRateId} IS NULL AND ${table.recipientTaxRateDisplayName} IS NULL AND ${table.recipientTaxRateInclusive} IS NULL AND ${table.recipientTaxRatePercentage} IS NULL)
          OR
          (${table.recipientStripeTaxRateId} IS NOT NULL AND ${table.recipientTaxRateDisplayName} IS NOT NULL AND ${table.recipientTaxRateInclusive} IS NOT NULL AND ${table.recipientTaxRatePercentage} IS NOT NULL)
        )
      )`,
    ),
    refundBounds: check(
      'registration_transfer_bundle_refund_bounds',
      sql`${table.refundAllocatedPurchasedQuantity} >= 0 AND ${table.refundAllocatedPurchasedQuantity} <= ${table.purchasedQuantity} AND ${table.refundAllocatedPurchasedQuantity} <= ${table.cancelledQuantity}`,
    ),
    transferTenant: foreignKey({
      columns: [table.transferId, table.tenantId],
      foreignColumns: [
        registrationTransfers.id,
        registrationTransfers.tenantId,
      ],
      name: 'registration_transfer_bundle_transfer_tenant_fk',
    }).onDelete('cascade'),
  }),
);

/** Exact purchase-lot membership sealed when the ownership bundle is offered. */
export const registrationTransferBundleAddonPurchaseLots = pgTable(
  'registration_transfer_bundle_addon_purchase_lots',
  {
    cancelledQuantity: integer('cancelled_quantity').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    quantity: integer('quantity').notNull(),
    redeemedQuantity: integer('redeemed_quantity').notNull(),
    refundAllocatedQuantity: integer('refund_allocated_quantity').notNull(),
    sourcePurchaseId: varchar('source_purchase_id', { length: 20 }).notNull(),
    sourcePurchaseLotId: varchar('source_purchase_lot_id', {
      length: 20,
    }).notNull(),
    sourceTransactionId: varchar('source_transaction_id', { length: 20 }),
    tenantId: varchar('tenant_id', { length: 20 })
      .notNull()
      .references(() => tenants.id),
    transferId: varchar('transfer_id', { length: 20 }).notNull(),
  },
  (table) => ({
    fulfillmentBounds: check(
      'registration_transfer_bundle_addon_lot_fulfillment_bounds',
      sql`${table.quantity} > 0 AND ${table.redeemedQuantity} >= 0 AND ${table.cancelledQuantity} >= 0 AND ${table.redeemedQuantity} + ${table.cancelledQuantity} <= ${table.quantity} AND ${table.refundAllocatedQuantity} >= 0 AND ${table.refundAllocatedQuantity} <= ${table.cancelledQuantity}`,
    ),
    lotOwner: foreignKey({
      columns: [
        table.sourcePurchaseLotId,
        table.sourcePurchaseId,
        table.tenantId,
      ],
      foreignColumns: [
        eventRegistrationAddonPurchaseLots.id,
        eventRegistrationAddonPurchaseLots.purchaseId,
        eventRegistrationAddonPurchaseLots.tenantId,
      ],
      name: 'registration_transfer_bundle_addon_lot_owner_fk',
    }),
    sourceTransactionTenant: foreignKey({
      columns: [table.sourceTransactionId, table.tenantId],
      foreignColumns: [transactions.id, transactions.tenantId],
      name: 'registration_transfer_bundle_addon_lot_source_fk',
    }),
    transferLotUnique: unique(
      'registration_transfer_bundle_addon_lot_unique',
    ).on(table.transferId, table.sourcePurchaseLotId),
    transferPurchase: foreignKey({
      columns: [table.transferId, table.sourcePurchaseId],
      foreignColumns: [
        registrationTransferBundleAddonPurchases.transferId,
        registrationTransferBundleAddonPurchases.sourcePurchaseId,
      ],
      name: 'registration_transfer_bundle_addon_lot_purchase_fk',
    }).onDelete('cascade'),
    transferTenant: foreignKey({
      columns: [table.transferId, table.tenantId],
      foreignColumns: [
        registrationTransfers.id,
        registrationTransfers.tenantId,
      ],
      name: 'registration_transfer_bundle_addon_lot_transfer_fk',
    }).onDelete('cascade'),
  }),
);

export const registrationTransferRefundPlanItems = pgTable(
  'registration_transfer_refund_plan_items',
  {
    applicationFeeRefunded: boolean('application_fee_refunded')
      .notNull()
      .default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    currency: currencyEnum('currency').notNull(),
    id: varchar('id', { length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    operationKey: varchar('operation_key', { length: 100 }).notNull(),
    originalAmount: integer('original_amount').notNull(),
    priorRefundedAmount: integer('prior_refunded_amount').notNull(),
    refundAmountDue: integer('refund_amount_due').notNull(),
    refundTransactionId: varchar('refund_transaction_id', { length: 20 }),
    sourceRegistrationId: varchar('source_registration_id', {
      length: 20,
    }).notNull(),
    sourceTransactionId: varchar('source_transaction_id', {
      length: 20,
    }).notNull(),
    sourceTransactionType: transactionType('source_transaction_type').notNull(),
    stripeAccountId: varchar('stripe_account_id', { length: 255 }).notNull(),
    tenantId: varchar('tenant_id', { length: 20 })
      .notNull()
      .references(() => tenants.id),
    transferId: varchar('transfer_id', { length: 20 }).notNull(),
  },
  (table) => ({
    amountShape: check(
      'registration_transfer_refund_plan_amount_shape',
      sql`${table.originalAmount} > 0 AND ${table.priorRefundedAmount} >= 0 AND ${table.refundAmountDue} >= 0 AND ${table.originalAmount} = ${table.priorRefundedAmount} + ${table.refundAmountDue}`,
    ),
    applicationFeeShape: check(
      'registration_transfer_refund_plan_application_fee_shape',
      sql`${table.applicationFeeRefunded} IS TRUE`,
    ),
    byTransfer: index('registration_transfer_refund_plan_transfer_idx').on(
      table.tenantId,
      table.transferId,
    ),
    operationKeyShape: check(
      'registration_transfer_refund_plan_operation_key_nonblank',
      sql`length(trim(${table.operationKey})) BETWEEN 1 AND 100`,
    ),
    planSourceIdentity: unique(
      'registration_transfer_refund_plan_id_source_tenant_unique',
    ).on(table.id, table.sourceTransactionId, table.tenantId),
    planTenantIdentity: unique(
      'registration_transfer_refund_plan_id_tenant_unique',
    ).on(table.id, table.tenantId),
    refundTenant: foreignKey({
      columns: [table.refundTransactionId, table.tenantId],
      foreignColumns: [transactions.id, transactions.tenantId],
      name: 'registration_transfer_refund_plan_refund_tenant_fk',
    }),
    sourceRegistrationTenant: foreignKey({
      columns: [table.sourceRegistrationId, table.tenantId],
      foreignColumns: [eventRegistrations.id, eventRegistrations.tenantId],
      name: 'registration_transfer_refund_plan_registration_tenant_fk',
    }),
    sourceTransactionTenant: foreignKey({
      columns: [table.sourceTransactionId, table.tenantId],
      foreignColumns: [transactions.id, transactions.tenantId],
      name: 'registration_transfer_refund_plan_source_tenant_fk',
    }),
    sourceTypeShape: check(
      'registration_transfer_refund_plan_source_type_shape',
      sql`${table.sourceTransactionType} IN ('registration', 'addon')`,
    ),
    transferSourceUnique: unique(
      'registration_transfer_refund_plan_source_unique',
    ).on(table.transferId, table.sourceTransactionId),
    transferTenant: foreignKey({
      columns: [table.transferId, table.tenantId],
      foreignColumns: [
        registrationTransfers.id,
        registrationTransfers.tenantId,
      ],
      name: 'registration_transfer_refund_plan_transfer_tenant_fk',
    }),
    uniqueRefund: uniqueIndex('registration_transfer_refund_plan_refund_unique')
      .on(table.refundTransactionId)
      .where(sql`${table.refundTransactionId} IS NOT NULL`),
  }),
);

export const registrationTransferAnswers = pgTable(
  'registration_transfer_answers',
  {
    answer: text('answer').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    id: varchar('id', { length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    questionId: varchar('question_id', { length: 20 })
      .notNull()
      .references(() => eventRegistrationQuestions.id),
    tenantId: varchar('tenant_id', { length: 20 })
      .notNull()
      .references(() => tenants.id),
    transferId: varchar('transfer_id', { length: 20 }).notNull(),
  },
  (table) => ({
    transferQuestionUnique: unique(
      'registration_transfer_answers_question_unique',
    ).on(table.transferId, table.questionId),
    transferTenant: foreignKey({
      columns: [table.transferId, table.tenantId],
      foreignColumns: [
        registrationTransfers.id,
        registrationTransfers.tenantId,
      ],
      name: 'registration_transfer_answers_transfer_tenant_fk',
    }).onDelete('cascade'),
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
    transferId: varchar('transfer_id', { length: 20 }).notNull(),
  },
  (table) => ({
    byTransfer: index('registration_transfer_events_transfer_idx').on(
      table.transferId,
      table.createdAt,
    ),
    transferTenant: foreignKey({
      columns: [table.transferId, table.tenantId],
      foreignColumns: [
        registrationTransfers.id,
        registrationTransfers.tenantId,
      ],
      name: 'registration_transfer_events_transfer_tenant_fk',
    }).onDelete('cascade'),
  }),
);
