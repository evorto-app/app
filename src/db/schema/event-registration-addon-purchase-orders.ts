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
import { addonToEventRegistrationOptions } from './event-addons';
import { eventRegistrations } from './event-registrations';
import { currencyEnum } from './tenants';
import { transactions } from './transactions';
import { users } from './users';

export const eventRegistrationAddonPurchaseOrderStatus = pgEnum(
  'event_registration_addon_purchase_order_status',
  ['pending_payment', 'completed', 'expired'],
);

export const eventRegistrationAddonPurchaseOrderWindow = pgEnum(
  'event_registration_addon_purchase_order_window',
  ['before_event', 'during_event'],
);

export const eventRegistrationAddonPurchaseOrderOperationUniqueIndexName =
  'event_registration_addon_purchase_orders_operation_unique';
export const pendingEventRegistrationAddonPurchaseOrderUniqueIndexName =
  'event_registration_addon_purchase_orders_pending_registration_unique';

/**
 * Durable intent and stock reservation for an optional add-on bought after the
 * registration itself. A pending paid order is deliberately not a fulfillment
 * entitlement: the aggregate purchase and immutable lot are created only when
 * Checkout completes. The preallocated purchase identifiers make completion
 * deterministic and replay-safe.
 */
export const eventRegistrationAddonPurchaseOrders = pgTable(
  'event_registration_addon_purchase_orders',
  {
    addonId: varchar('addon_id', { length: 20 }).notNull(),
    applicationFeeAmount: integer('application_fee_amount').notNull(),
    baseAmount: integer('base_amount').notNull(),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    currency: currencyEnum('currency').notNull(),
    eventId: varchar('event_id', { length: 20 }).notNull(),
    expectedGrossAmount: integer('expected_gross_amount').notNull(),
    expiredAt: timestamp('expired_at'),
    expiresAt: timestamp('expires_at'),
    id: varchar('id', { length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    operationKey: varchar('operation_key', { length: 100 }).notNull(),
    purchaseId: varchar('purchase_id', { length: 20 }).notNull(),
    purchaseLotId: varchar('purchase_lot_id', { length: 20 }).notNull(),
    quantity: integer('quantity').notNull(),
    registrationId: varchar('registration_id', { length: 20 }).notNull(),
    registrationOptionId: varchar('registration_option_id', {
      length: 20,
    }).notNull(),
    requestedByUserId: varchar('requested_by_user_id', { length: 20 })
      .notNull()
      .references(() => users.id),
    status: eventRegistrationAddonPurchaseOrderStatus('status').notNull(),
    stripeTaxRateId: varchar('stripe_tax_rate_id', { length: 255 }),
    taxRateDisplayName: text('tax_rate_display_name'),
    taxRateInclusive: boolean('tax_rate_inclusive'),
    taxRatePercentage: text('tax_rate_percentage'),
    tenantId: varchar('tenant_id', { length: 20 }).notNull(),
    transactionId: varchar('transaction_id', { length: 20 }),
    unitPrice: integer('unit_price').notNull(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    window: eventRegistrationAddonPurchaseOrderWindow('window').notNull(),
  },
  (table) => [
    check(
      'event_registration_addon_purchase_orders_operation_key_nonblank',
      sql`length(trim(${table.operationKey})) BETWEEN 1 AND 100`,
    ),
    check(
      'event_registration_addon_purchase_orders_amount_shape',
      sql`${table.quantity} > 0 AND ${table.unitPrice} >= 0 AND ${table.baseAmount} = ${table.unitPrice} * ${table.quantity} AND ${table.expectedGrossAmount} >= ${table.baseAmount} AND ${table.applicationFeeAmount} >= 0 AND ${table.applicationFeeAmount} <= ${table.expectedGrossAmount}`,
    ),
    check(
      'event_registration_addon_purchase_orders_tax_snapshot_shape',
      sql`(
        (${table.stripeTaxRateId} IS NULL AND ${table.taxRateDisplayName} IS NULL AND ${table.taxRateInclusive} IS NULL AND ${table.taxRatePercentage} IS NULL)
        OR
        (${table.stripeTaxRateId} IS NOT NULL AND ${table.taxRateInclusive} IS NOT NULL AND ${table.taxRatePercentage} IS NOT NULL)
      )`,
    ),
    check(
      'event_registration_addon_purchase_orders_lifecycle_shape',
      sql`(
        (${table.unitPrice} = 0 AND ${table.status} = 'completed' AND ${table.transactionId} IS NULL AND ${table.expiresAt} IS NULL AND ${table.completedAt} IS NOT NULL AND ${table.expiredAt} IS NULL AND ${table.expectedGrossAmount} = 0 AND ${table.applicationFeeAmount} = 0)
        OR
        (${table.unitPrice} > 0 AND ${table.status} = 'pending_payment' AND ${table.transactionId} IS NOT NULL AND ${table.expiresAt} IS NOT NULL AND ${table.completedAt} IS NULL AND ${table.expiredAt} IS NULL)
        OR
        (${table.unitPrice} > 0 AND ${table.status} = 'completed' AND ${table.transactionId} IS NOT NULL AND ${table.expiresAt} IS NOT NULL AND ${table.completedAt} IS NOT NULL AND ${table.expiredAt} IS NULL)
        OR
        (${table.unitPrice} > 0 AND ${table.status} = 'expired' AND ${table.transactionId} IS NOT NULL AND ${table.expiresAt} IS NOT NULL AND ${table.completedAt} IS NULL AND ${table.expiredAt} IS NOT NULL)
      )`,
    ),
    foreignKey({
      columns: [table.addonId, table.registrationOptionId, table.eventId],
      foreignColumns: [
        addonToEventRegistrationOptions.addonId,
        addonToEventRegistrationOptions.registrationOptionId,
        addonToEventRegistrationOptions.eventId,
      ],
      name: 'event_registration_addon_purchase_orders_option_association_fk',
    }),
    foreignKey({
      columns: [
        table.registrationId,
        table.eventId,
        table.registrationOptionId,
        table.tenantId,
      ],
      foreignColumns: [
        eventRegistrations.id,
        eventRegistrations.eventId,
        eventRegistrations.registrationOptionId,
        eventRegistrations.tenantId,
      ],
      name: 'event_registration_addon_purchase_orders_registration_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.transactionId, table.registrationId, table.tenantId],
      foreignColumns: [
        transactions.id,
        transactions.eventRegistrationId,
        transactions.tenantId,
      ],
      name: 'event_registration_addon_purchase_orders_transaction_owner_fk',
    }),
    index('event_registration_addon_purchase_orders_expiry_idx').on(
      table.status,
      table.expiresAt,
    ),
    index('event_registration_addon_purchase_orders_registration_idx').on(
      table.tenantId,
      table.registrationId,
      table.createdAt,
    ),
    unique('event_registration_addon_purchase_orders_id_tenant_unique').on(
      table.id,
      table.tenantId,
    ),
    uniqueIndex(eventRegistrationAddonPurchaseOrderOperationUniqueIndexName).on(
      table.tenantId,
      table.registrationId,
      table.operationKey,
    ),
    uniqueIndex(pendingEventRegistrationAddonPurchaseOrderUniqueIndexName)
      .on(table.tenantId, table.registrationId)
      .where(sql`${table.status} = 'pending_payment'`),
    uniqueIndex('event_registration_addon_purchase_orders_transaction_unique')
      .on(table.transactionId)
      .where(sql`${table.transactionId} IS NOT NULL`),
    unique('event_registration_addon_purchase_orders_lot_unique').on(
      table.purchaseLotId,
    ),
  ],
);
