import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { eventRegistrationAddonFulfillmentEvents } from './event-registration-addon-fulfillment-events';
import { eventRegistrationAddonPurchaseLots } from './event-registration-addon-purchase-lots';
import { eventRegistrationAddonPurchases } from './event-registration-addon-purchases';

export const eventRegistrationAddonFulfillmentAllocationSource = pgEnum(
  'event_registration_addon_fulfillment_allocation_source',
  ['included', 'purchased'],
);

/** Exact included/lot quantities consumed by one fulfillment event. */
export const eventRegistrationAddonFulfillmentAllocations = pgTable(
  'event_registration_addon_fulfillment_allocations',
  {
    fulfillmentEventId: varchar('fulfillment_event_id', {
      length: 20,
    }).notNull(),
    purchaseId: varchar({ length: 20 }).notNull(),
    purchaseLotId: varchar('purchase_lot_id', { length: 20 }),
    quantity: integer().notNull(),
    source: eventRegistrationAddonFulfillmentAllocationSource().notNull(),
    tenantId: varchar({ length: 20 }).notNull(),
  },
  (table) => [
    check(
      'event_registration_addon_fulfillment_allocations_quantity_posit',
      sql`${table.quantity} > 0`,
    ),
    check(
      'event_registration_addon_fulfillment_allocations_source_shape',
      sql`(${table.source} = 'included' AND ${table.purchaseLotId} IS NULL) OR (${table.source} = 'purchased' AND ${table.purchaseLotId} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [table.fulfillmentEventId, table.purchaseId, table.tenantId],
      foreignColumns: [
        eventRegistrationAddonFulfillmentEvents.id,
        eventRegistrationAddonFulfillmentEvents.purchaseId,
        eventRegistrationAddonFulfillmentEvents.tenantId,
      ],
      name: 'event_registration_addon_fulfillment_allocations_event_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.purchaseId, table.tenantId],
      foreignColumns: [
        eventRegistrationAddonPurchases.id,
        eventRegistrationAddonPurchases.tenantId,
      ],
      name: 'event_registration_addon_fulfillment_allocations_purchase_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.purchaseLotId, table.purchaseId, table.tenantId],
      foreignColumns: [
        eventRegistrationAddonPurchaseLots.id,
        eventRegistrationAddonPurchaseLots.purchaseId,
        eventRegistrationAddonPurchaseLots.tenantId,
      ],
      name: 'event_registration_addon_fulfillment_allocations_lot_fk',
    }),
    uniqueIndex(
      'event_registration_addon_fulfillment_allocations_included_uniqu',
    )
      .on(table.fulfillmentEventId)
      .where(sql`${table.source} = 'included'`),
    uniqueIndex('event_registration_addon_fulfillment_allocations_lot_unique')
      .on(table.fulfillmentEventId, table.purchaseLotId)
      .where(sql`${table.purchaseLotId} IS NOT NULL`),
  ],
);
