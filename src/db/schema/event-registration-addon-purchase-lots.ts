import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventRegistrationAddonPurchases } from './event-registration-addon-purchases';
import { currencyEnum } from './tenants';
import { transactions } from './transactions';

/**
 * Immutable commercial terms for one optional add-on purchase. Fulfillment and
 * refund counters advance in place, while price, tax, currency, source and the
 * reconciled Stripe allocation never change after they are finalized.
 */
export const eventRegistrationAddonPurchaseLots = pgTable(
  'event_registration_addon_purchase_lots',
  {
    applicationFeeAmount: integer('application_fee_amount'),
    baseAmount: integer('base_amount').notNull(),
    cancelledQuantity: integer('cancelled_quantity').notNull().default(0),
    createdAt: timestamp().notNull().defaultNow(),
    currency: currencyEnum().notNull(),
    eventId: varchar({ length: 20 }).notNull(),
    grossAmount: integer('gross_amount'),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    netAmount: integer('net_amount'),
    paymentAllocationFinalizedAt: timestamp('payment_allocation_finalized_at'),
    purchaseId: varchar({ length: 20 }).notNull(),
    quantity: integer().notNull(),
    redeemedQuantity: integer('redeemed_quantity').notNull().default(0),
    refundAllocatedApplicationFeeAmount: integer(
      'refund_allocated_application_fee_amount',
    )
      .notNull()
      .default(0),
    refundAllocatedGrossAmount: integer('refund_allocated_gross_amount')
      .notNull()
      .default(0),
    refundAllocatedNetAmount: integer('refund_allocated_net_amount')
      .notNull()
      .default(0),
    refundAllocatedQuantity: integer('refund_allocated_quantity')
      .notNull()
      .default(0),
    registrationId: varchar({ length: 20 }).notNull(),
    registrationOptionId: varchar('registration_option_id', {
      length: 20,
    }).notNull(),
    sourceLineKey: varchar('source_line_key', { length: 100 }).notNull(),
    sourceTransactionId: varchar('source_transaction_id', { length: 20 }),
    stripeFeeAmount: integer('stripe_fee_amount'),
    taxAmount: integer('tax_amount'),
    taxRateDisplayName: text('tax_rate_name'),
    taxRateInclusive: boolean('tax_rate_inclusive'),
    taxRatePercentage: text('tax_rate_percentage'),
    tenantId: varchar({ length: 20 }).notNull(),
    unitPrice: integer('unit_price').notNull(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      'event_registration_addon_purchase_lots_source_line_key_nonblank',
      sql`length(trim(${table.sourceLineKey})) BETWEEN 1 AND 100`,
    ),
    check(
      'event_registration_addon_purchase_lots_quantity_positive',
      sql`${table.quantity} > 0 AND ${table.unitPrice} >= 0 AND ${table.baseAmount} = ${table.unitPrice} * ${table.quantity}`,
    ),
    check(
      'event_registration_addon_purchase_lots_fulfillment_bounds',
      sql`${table.redeemedQuantity} >= 0 AND ${table.cancelledQuantity} >= 0 AND ${table.redeemedQuantity} + ${table.cancelledQuantity} <= ${table.quantity}`,
    ),
    check(
      'event_registration_addon_purchase_lots_refund_bounds',
      sql`${table.refundAllocatedQuantity} >= 0 AND ${table.refundAllocatedQuantity} <= ${table.cancelledQuantity} AND ${table.refundAllocatedGrossAmount} >= 0 AND ${table.refundAllocatedNetAmount} >= 0 AND ${table.refundAllocatedApplicationFeeAmount} >= 0`,
    ),
    check(
      'event_registration_addon_purchase_lots_payment_allocation_shape',
      sql`(
        (${table.sourceTransactionId} IS NULL AND ${table.paymentAllocationFinalizedAt} IS NULL AND ${table.taxAmount} IS NULL AND ${table.grossAmount} IS NULL AND ${table.netAmount} IS NULL AND ${table.stripeFeeAmount} IS NULL AND ${table.applicationFeeAmount} IS NULL)
        OR
        (${table.sourceTransactionId} IS NULL AND ${table.paymentAllocationFinalizedAt} IS NOT NULL AND ${table.baseAmount} = 0 AND ${table.taxAmount} = 0 AND ${table.grossAmount} = 0 AND ${table.netAmount} = 0 AND ${table.stripeFeeAmount} = 0 AND ${table.applicationFeeAmount} = 0)
        OR
        (${table.sourceTransactionId} IS NOT NULL AND (
          (${table.paymentAllocationFinalizedAt} IS NULL AND ${table.taxAmount} IS NULL AND ${table.grossAmount} IS NULL AND ${table.netAmount} IS NULL AND ${table.stripeFeeAmount} IS NULL AND ${table.applicationFeeAmount} IS NULL)
          OR
          (${table.paymentAllocationFinalizedAt} IS NOT NULL AND ${table.taxAmount} >= 0 AND ${table.grossAmount} >= ${table.baseAmount} AND ${table.netAmount} >= 0 AND ${table.stripeFeeAmount} >= 0 AND ${table.applicationFeeAmount} >= 0 AND ${table.netAmount} + ${table.stripeFeeAmount} + ${table.applicationFeeAmount} = ${table.grossAmount})
        ))
      )`,
    ),
    check(
      'event_registration_addon_purchase_lots_refund_allocation_bounds',
      sql`(${table.grossAmount} IS NULL OR ${table.refundAllocatedGrossAmount} <= ${table.grossAmount}) AND (${table.netAmount} IS NULL OR ${table.refundAllocatedNetAmount} <= ${table.netAmount}) AND (${table.applicationFeeAmount} IS NULL OR ${table.refundAllocatedApplicationFeeAmount} <= ${table.applicationFeeAmount})`,
    ),
    foreignKey({
      columns: [
        table.purchaseId,
        table.eventId,
        table.registrationId,
        table.registrationOptionId,
        table.tenantId,
      ],
      foreignColumns: [
        eventRegistrationAddonPurchases.id,
        eventRegistrationAddonPurchases.eventId,
        eventRegistrationAddonPurchases.registrationId,
        eventRegistrationAddonPurchases.registrationOptionId,
        eventRegistrationAddonPurchases.tenantId,
      ],
      name: 'event_registration_addon_purchase_lots_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.sourceTransactionId, table.tenantId],
      foreignColumns: [transactions.id, transactions.tenantId],
      name: 'event_registration_addon_purchase_lots_source_tenant_fk',
    }),
    index('event_registration_addon_purchase_lots_purchase_idx').on(
      table.purchaseId,
      table.createdAt,
    ),
    unique('event_registration_addon_purchase_lots_id_tenant_unique').on(
      table.id,
      table.tenantId,
    ),
    unique('event_registration_addon_purchase_lots_owner_unique').on(
      table.id,
      table.purchaseId,
      table.tenantId,
    ),
    unique(
      'event_registration_addon_purchase_lots_registration_owner_uniqu',
    ).on(table.id, table.registrationId, table.tenantId),
    uniqueIndex('event_registration_addon_purchase_lots_source_line_unique')
      .on(table.tenantId, table.sourceTransactionId, table.sourceLineKey)
      .where(sql`${table.sourceTransactionId} IS NOT NULL`),
  ],
);
