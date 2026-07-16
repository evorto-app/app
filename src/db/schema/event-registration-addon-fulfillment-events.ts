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
import { eventRegistrationAddonPurchases } from './event-registration-addon-purchases';
import { users } from './users';

export const eventRegistrationAddonFulfillmentEventType = pgEnum(
  'event_registration_addon_fulfillment_event_type',
  ['redeemed', 'redemption_undone', 'cancelled'],
);

export const eventRegistrationAddonFulfillmentActorKind = pgEnum(
  'event_registration_addon_fulfillment_actor_kind',
  ['platform', 'system', 'user'],
);

export const eventRegistrationAddonRefundDisposition = pgEnum(
  'event_registration_addon_refund_disposition',
  ['claims_created', 'no_monetary_refund_required', 'not_requested'],
);

export const eventRegistrationAddonFulfillmentEvents = pgTable(
  'event_registration_addon_fulfillment_events',
  {
    actorKind: eventRegistrationAddonFulfillmentActorKind().notNull(),
    actorSubject: text('actor_subject'),
    actorUserId: varchar({ length: 20 }).references(() => users.id),
    createdAt: timestamp().notNull().defaultNow(),
    eventId: varchar({ length: 20 }).notNull(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    operationKey: varchar('operation_key', { length: 100 }).notNull(),
    purchaseId: varchar({ length: 20 }).notNull(),
    quantity: integer().notNull(),
    reason: text(),
    refundDisposition: eventRegistrationAddonRefundDisposition(
      'refund_disposition',
    )
      .notNull()
      .default('not_requested'),
    refundRequested: boolean('refund_requested').notNull().default(false),
    registrationId: varchar({ length: 20 }).notNull(),
    reversesEventId: varchar('reverses_event_id', { length: 20 }),
    tenantId: varchar({ length: 20 }).notNull(),
    type: eventRegistrationAddonFulfillmentEventType().notNull(),
  },
  (table) => [
    check(
      'event_registration_addon_fulfillment_event_quantity_positive',
      sql`${table.quantity} > 0`,
    ),
    check(
      'event_registration_addon_fulfillment_event_operation_key_nonbla',
      sql`length(trim(${table.operationKey})) BETWEEN 1 AND 100`,
    ),
    check(
      'event_registration_addon_fulfillment_event_actor_shape',
      sql`(${table.actorKind} = 'user' AND ${table.actorUserId} IS NOT NULL AND ${table.actorSubject} IS NULL) OR (${table.actorKind} <> 'user' AND ${table.actorUserId} IS NULL AND ${table.actorSubject} IS NOT NULL AND length(trim(${table.actorSubject})) BETWEEN 1 AND 100)`,
    ),
    check(
      'event_registration_addon_fulfillment_event_shape',
      sql`(
        (${table.type} = 'redeemed' AND ${table.reversesEventId} IS NULL AND ${table.reason} IS NULL AND NOT ${table.refundRequested} AND ${table.refundDisposition} = 'not_requested')
        OR
        (${table.type} = 'redemption_undone' AND ${table.reversesEventId} IS NOT NULL AND ${table.reason} IS NULL AND NOT ${table.refundRequested} AND ${table.refundDisposition} = 'not_requested')
        OR
        (${table.type} = 'cancelled' AND ${table.reversesEventId} IS NULL AND ${table.reason} IS NOT NULL AND length(trim(${table.reason})) BETWEEN 1 AND 500 AND ((${table.refundRequested} AND ${table.refundDisposition} IN ('claims_created', 'no_monetary_refund_required')) OR (NOT ${table.refundRequested} AND ${table.refundDisposition} = 'not_requested')))
      )`,
    ),
    foreignKey({
      columns: [
        table.purchaseId,
        table.eventId,
        table.registrationId,
        table.tenantId,
      ],
      foreignColumns: [
        eventRegistrationAddonPurchases.id,
        eventRegistrationAddonPurchases.eventId,
        eventRegistrationAddonPurchases.registrationId,
        eventRegistrationAddonPurchases.tenantId,
      ],
      name: 'event_registration_addon_fulfillment_purchase_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [
        table.reversesEventId,
        table.purchaseId,
        table.eventId,
        table.registrationId,
        table.tenantId,
      ],
      foreignColumns: [
        table.id,
        table.purchaseId,
        table.eventId,
        table.registrationId,
        table.tenantId,
      ],
      name: 'event_registration_addon_fulfillment_reversal_owner_fk',
    }),
    index().on(table.purchaseId, table.createdAt),
    unique().on(table.purchaseId, table.operationKey),
    unique('event_registration_addon_fulfillment_event_owner_unique').on(
      table.id,
      table.purchaseId,
      table.eventId,
      table.registrationId,
      table.tenantId,
    ),
    unique(
      'event_registration_addon_fulfillment_event_purchase_tenant_uniq',
    ).on(table.id, table.purchaseId, table.tenantId),
    uniqueIndex('event_registration_addon_redemption_undo_unique')
      .on(table.reversesEventId)
      .where(sql`${table.reversesEventId} IS NOT NULL`),
  ],
);
