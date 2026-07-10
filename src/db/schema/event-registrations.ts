import { sql } from 'drizzle-orm';
import {
  boolean,
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

import { eventInstances } from './event-instances';
import { eventRegistrationOptions } from './event-registration-options';
import { discountTypes, registrationStatus } from './global-enums';
import { modelOfTenant } from './model';
import { users } from './users';

export const activeEventRegistrationUniqueIndexName =
  'event_registrations_active_user_event_unique';
export const eventRegistrationEventIdentityUniqueConstraintName =
  'event_registrations_id_event_unique';
export const eventRegistrationEventTenantForeignKeyName =
  'event_registrations_event_tenant_fk';
export const eventRegistrationOptionEventForeignKeyName =
  'event_registrations_option_event_fk';
export const eventRegistrationTenantIdentityUniqueConstraintName =
  'event_registrations_id_tenant_unique';
export const eventRegistrationPurchaseOwnerUniqueConstraintName =
  'event_registrations_purchase_owner_unique';

export const eventRegistrations = pgTable(
  'event_registrations',
  {
    appliedDiscountedPrice: integer('applied_discounted_price'),
    appliedDiscountType: discountTypes('applied_discount_type'),
    basePriceAtRegistration: integer('base_price_at_registration'),
    ...modelOfTenant,
    checkedInGuestCount: integer('checked_in_guest_count').notNull().default(0),
    checkInTime: timestamp(),
    discountAmount: integer('discount_amount'),
    eventId: varchar({ length: 20 })
      .notNull()
      .references(() => eventInstances.id),
    guestCount: integer('guest_count').notNull().default(0),
    paymentId: varchar({ length: 255 }),
    registrationOptionId: varchar({ length: 20 })
      .notNull()
      .references(() => eventRegistrationOptions.id),
    status: registrationStatus().notNull(),
    stripeTaxRateId: varchar('tax_rate_id'),
    taxRateDisplayName: text('tax_rate_name'),
    taxRateInclusive: boolean('tax_rate_inclusive'),
    taxRatePercentage: text('tax_rate_percentage'),
    userId: varchar({ length: 20 })
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId, table.tenantId],
      foreignColumns: [eventInstances.id, eventInstances.tenantId],
      name: eventRegistrationEventTenantForeignKeyName,
    }),
    unique(eventRegistrationEventIdentityUniqueConstraintName).on(
      table.id,
      table.eventId,
    ),
    unique(eventRegistrationTenantIdentityUniqueConstraintName).on(
      table.id,
      table.tenantId,
    ),
    unique('event_registrations_id_option_unique').on(
      table.id,
      table.registrationOptionId,
    ),
    index('event_registrations_active_tenant_user_idx')
      .on(table.tenantId, table.userId)
      .where(sql`${table.status} <> 'CANCELLED'`),
    unique(eventRegistrationPurchaseOwnerUniqueConstraintName).on(
      table.id,
      table.eventId,
      table.registrationOptionId,
      table.tenantId,
    ),
    uniqueIndex(activeEventRegistrationUniqueIndexName)
      .on(table.eventId, table.userId)
      .where(sql`${table.status} <> 'CANCELLED'`),
    foreignKey({
      columns: [table.registrationOptionId, table.eventId],
      foreignColumns: [
        eventRegistrationOptions.id,
        eventRegistrationOptions.eventId,
      ],
      name: eventRegistrationOptionEventForeignKeyName,
    }),
  ],
);
