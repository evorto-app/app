import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventRegistrationAddonFulfillmentEvents } from './event-registration-addon-fulfillment-events';
import { eventRegistrationAddonPurchaseLots } from './event-registration-addon-purchase-lots';
import { currencyEnum } from './tenants';
import { transactions } from './transactions';

/**
 * Durable monetary claim allocated from a cancelled purchase lot. The linked
 * transaction status is the source of truth for pending/succeeded/failed.
 */
export const eventRegistrationAddonRefundAllocations = pgTable(
  'event_registration_addon_refund_allocations',
  {
    applicationFeeAmount: integer('application_fee_amount').notNull(),
    applicationFeeRefunded: boolean('application_fee_refunded').notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    currency: currencyEnum().notNull(),
    eventId: varchar({ length: 20 }).notNull(),
    fulfillmentEventId: varchar('fulfillment_event_id', {
      length: 20,
    }).notNull(),
    grossEntitlementAmount: integer('gross_entitlement_amount').notNull(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    netEntitlementAmount: integer('net_entitlement_amount').notNull(),
    purchaseId: varchar({ length: 20 }).notNull(),
    purchaseLotId: varchar('purchase_lot_id', { length: 20 }).notNull(),
    quantity: integer().notNull(),
    refundAmount: integer('refund_amount').notNull(),
    refundTransactionId: varchar('refund_transaction_id', {
      length: 20,
    }).notNull(),
    registrationId: varchar({ length: 20 }).notNull(),
    tenantId: varchar({ length: 20 }).notNull(),
  },
  (table) => [
    check(
      'event_registration_addon_refund_allocations_amounts_positive',
      sql`${table.quantity} > 0 AND ${table.refundAmount} > 0 AND ${table.grossEntitlementAmount} > 0 AND ${table.netEntitlementAmount} >= 0 AND ${table.netEntitlementAmount} <= ${table.grossEntitlementAmount} AND ${table.applicationFeeAmount} >= 0 AND ${table.applicationFeeAmount} <= ${table.grossEntitlementAmount}`,
    ),
    check(
      'event_registration_addon_refund_allocations_policy_amount',
      sql`(${table.applicationFeeRefunded} AND ${table.refundAmount} = ${table.grossEntitlementAmount}) OR (NOT ${table.applicationFeeRefunded} AND ${table.refundAmount} = ${table.netEntitlementAmount})`,
    ),
    foreignKey({
      columns: [
        table.fulfillmentEventId,
        table.purchaseId,
        table.eventId,
        table.registrationId,
        table.tenantId,
      ],
      foreignColumns: [
        eventRegistrationAddonFulfillmentEvents.id,
        eventRegistrationAddonFulfillmentEvents.purchaseId,
        eventRegistrationAddonFulfillmentEvents.eventId,
        eventRegistrationAddonFulfillmentEvents.registrationId,
        eventRegistrationAddonFulfillmentEvents.tenantId,
      ],
      name: 'event_registration_addon_refund_allocations_event_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.purchaseLotId, table.purchaseId, table.tenantId],
      foreignColumns: [
        eventRegistrationAddonPurchaseLots.id,
        eventRegistrationAddonPurchaseLots.purchaseId,
        eventRegistrationAddonPurchaseLots.tenantId,
      ],
      name: 'event_registration_addon_refund_allocations_lot_owner_fk',
    }),
    foreignKey({
      columns: [
        table.refundTransactionId,
        table.registrationId,
        table.tenantId,
      ],
      foreignColumns: [
        transactions.id,
        transactions.eventRegistrationId,
        transactions.tenantId,
      ],
      name: 'event_registration_addon_refund_allocations_claim_owner_fk',
    }),
    unique('event_registration_addon_refund_allocations_event_lot_unique').on(
      table.fulfillmentEventId,
      table.purchaseLotId,
    ),
  ],
);
