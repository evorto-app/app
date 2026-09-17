import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventInstances } from './event-instances';
import { registrationModes } from './global-enums';

export const registrationOptionEventIdentityUniqueConstraintName =
  'event_registration_options_id_event_unique';
export const eventRegistrationOptionCapacityCheckName =
  'event_registration_options_capacity';
export const eventRegistrationOptionPriceCheckName =
  'event_registration_options_price';
export const eventRegistrationOptionTimeOrderCheckName =
  'event_registration_options_time_order';
export const eventRegistrationOptionsEventIndexName =
  'event_registration_options_event_idx';

export const eventRegistrationOptions = pgTable(
  'event_registration_options',
  {
    cancellationDeadlineHoursBeforeStart: integer(
      'cancellation_deadline_hours_before_start',
    ),
    checkedInSpots: integer().notNull().default(0),
    closeRegistrationTime: timestamp().notNull(),
    confirmedSpots: integer().notNull().default(0),
    createdAt: timestamp().notNull().defaultNow(),
    description: text(),
    eventId: varchar({ length: 20 })
      .notNull()
      .references(() => eventInstances.id),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    isPaid: boolean().notNull(),
    openRegistrationTime: timestamp().notNull(),
    organizingRegistration: boolean().notNull(),
    price: integer().notNull(),
    refundFeesOnCancellation: boolean('refund_fees_on_cancellation'),
    registeredDescription: text(),
    registrationMode: registrationModes().notNull(),
    reservedSpots: integer().notNull().default(0),
    roleIds: varchar({ length: 20 }).array().notNull().default([]),
    spots: integer().notNull(),
    stripeTaxRateId: varchar(),
    title: text().notNull(),
    transferDeadlineHoursBeforeStart: integer(
      'transfer_deadline_hours_before_start',
    ),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    waitlistSpots: integer().notNull().default(0),
  },
  (table) => [
    check(
      eventRegistrationOptionCapacityCheckName,
      sql`${table.spots} >= 0
        AND ${table.confirmedSpots} >= 0
        AND ${table.reservedSpots} >= 0
        AND ${table.waitlistSpots} >= 0
        AND ${table.checkedInSpots} >= 0
        AND ${table.confirmedSpots} + ${table.reservedSpots} <= ${table.spots}
        AND ${table.checkedInSpots} <= ${table.confirmedSpots}`,
    ),
    check(
      eventRegistrationOptionPriceCheckName,
      sql`(${table.isPaid} AND ${table.price} > 0) OR (NOT ${table.isPaid} AND ${table.price} = 0)`,
    ),
    check(
      eventRegistrationOptionTimeOrderCheckName,
      sql`${table.openRegistrationTime} <= ${table.closeRegistrationTime}`,
    ),
    check(
      'event_registration_options_cancellation_deadline_hours_nonnegat',
      sql`${table.cancellationDeadlineHoursBeforeStart} IS NULL OR ${table.cancellationDeadlineHoursBeforeStart} >= 0`,
    ),
    check(
      'event_registration_options_transfer_deadline_hours_nonnegative',
      sql`${table.transferDeadlineHoursBeforeStart} IS NULL OR ${table.transferDeadlineHoursBeforeStart} >= 0`,
    ),
    index(eventRegistrationOptionsEventIndexName).on(table.eventId),
    unique(registrationOptionEventIdentityUniqueConstraintName).on(
      table.id,
      table.eventId,
    ),
  ],
);
