import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
      'event_registration_options_cancellation_deadline_hours_nonnegative',
      sql`${table.cancellationDeadlineHoursBeforeStart} IS NULL OR ${table.cancellationDeadlineHoursBeforeStart} >= 0`,
    ),
    check(
      'event_registration_options_transfer_deadline_hours_nonnegative',
      sql`${table.transferDeadlineHoursBeforeStart} IS NULL OR ${table.transferDeadlineHoursBeforeStart} >= 0`,
    ),
    unique(registrationOptionEventIdentityUniqueConstraintName).on(
      table.id,
      table.eventId,
    ),
  ],
);
