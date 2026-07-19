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
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { addonToEventRegistrationOptions, eventAddons } from './event-addons';
import { eventRegistrations } from './event-registrations';

export const eventRegistrationAddonPurchaseTenantIdentityUniqueConstraintName =
  'event_registration_addon_purchases_id_tenant_unique';

export const eventRegistrationAddonPurchases = pgTable(
  'event_registration_addon_purchases',
  {
    addonId: varchar({ length: 20 }).notNull(),
    cancelledQuantity: integer('cancelled_quantity').notNull().default(0),
    createdAt: timestamp().notNull().defaultNow(),
    eventId: varchar({ length: 20 }).notNull(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    includedQuantity: integer('included_quantity').notNull().default(0),
    purchasedQuantity: integer('purchased_quantity').notNull().default(0),
    quantity: integer().notNull(),
    redeemedQuantity: integer('redeemed_quantity').notNull().default(0),
    refundAllocatedPurchasedQuantity: integer(
      'refund_allocated_purchased_quantity',
    )
      .notNull()
      .default(0),
    registrationId: varchar({ length: 20 }).notNull(),
    registrationOptionId: varchar('registration_option_id', {
      length: 20,
    }).notNull(),
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
      'event_registration_addon_purchases_quantities_nonnegative',
      sql`${table.quantity} > 0 AND ${table.includedQuantity} >= 0 AND ${table.purchasedQuantity} >= 0 AND ${table.redeemedQuantity} >= 0 AND ${table.cancelledQuantity} >= 0 AND ${table.refundAllocatedPurchasedQuantity} >= 0`,
    ),
    check(
      'event_registration_addon_purchases_grant_breakdown',
      sql`${table.quantity} = ${table.includedQuantity} + ${table.purchasedQuantity}`,
    ),
    check(
      'event_registration_addon_purchases_fulfillment_bounds',
      sql`${table.redeemedQuantity} + ${table.cancelledQuantity} <= ${table.quantity}`,
    ),
    check(
      'event_registration_addon_purchases_refund_bounds',
      sql`${table.refundAllocatedPurchasedQuantity} <= ${table.purchasedQuantity} AND ${table.refundAllocatedPurchasedQuantity} <= ${table.cancelledQuantity}`,
    ),
    check(
      'event_registration_addon_purchases_price_nonnegative',
      sql`${table.unitPrice} >= 0`,
    ),
    foreignKey({
      columns: [table.addonId, table.eventId],
      foreignColumns: [eventAddons.id, eventAddons.eventId],
      name: 'event_registration_addon_purchase_addon_event_fk',
    }),
    foreignKey({
      columns: [table.addonId, table.registrationOptionId, table.eventId],
      foreignColumns: [
        addonToEventRegistrationOptions.addonId,
        addonToEventRegistrationOptions.registrationOptionId,
        addonToEventRegistrationOptions.eventId,
      ],
      name: 'event_registration_addon_purchase_option_association_fk',
    }),
    foreignKey({
      columns: [table.registrationId, table.eventId],
      foreignColumns: [eventRegistrations.id, eventRegistrations.eventId],
      name: 'event_registration_addon_purchase_registration_event_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.registrationId, table.registrationOptionId],
      foreignColumns: [
        eventRegistrations.id,
        eventRegistrations.registrationOptionId,
      ],
      name: 'event_registration_addon_purchase_registration_option_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.registrationId, table.tenantId],
      foreignColumns: [eventRegistrations.id, eventRegistrations.tenantId],
      name: 'event_registration_addon_purchase_registration_tenant_fk',
    }).onDelete('cascade'),
    index().on(table.registrationId),
    unique(eventRegistrationAddonPurchaseTenantIdentityUniqueConstraintName).on(
      table.id,
      table.tenantId,
    ),
    unique('event_registration_addon_purchases_owner_unique').on(
      table.id,
      table.eventId,
      table.registrationId,
      table.registrationOptionId,
      table.tenantId,
    ),
    unique('event_registration_addon_purchases_fulfillment_owner_unique').on(
      table.id,
      table.eventId,
      table.registrationId,
      table.tenantId,
    ),
    unique().on(table.registrationId, table.addonId),
  ],
);
