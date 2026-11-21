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
import { eventRegistrations } from './event-registrations';
import { users } from './users';

/**
 * One row per committed check-in operation. The client sends a unique
 * operation key with every confirmation; a retry with the same key replays the
 * stored outcome instead of counting the attendee or guests again.
 */
export const eventRegistrationCheckIns = pgTable(
  'event_registration_check_ins',
  {
    actorUserId: varchar('actor_user_id', { length: 20 })
      .notNull()
      .references(() => users.id),
    attendeeCheckedIn: boolean('attendee_checked_in').notNull(),
    checkInTime: timestamp('check_in_time').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expectedCheckedInGuestCount: integer(
      'expected_checked_in_guest_count',
    ).notNull(),
    guestCheckInCount: integer('guest_check_in_count').notNull(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    operationKey: varchar('operation_key', { length: 100 }).notNull(),
    registrationId: varchar('registration_id', { length: 20 }).notNull(),
    tenantId: varchar('tenant_id', { length: 20 }).notNull(),
  },
  (table) => [
    check(
      'event_registration_check_ins_operation_key_nonblank',
      sql`length(trim(${table.operationKey})) BETWEEN 1 AND 100`,
    ),
    check(
      'event_registration_check_ins_counts_valid',
      sql`${table.expectedCheckedInGuestCount} >= 0 AND ${table.guestCheckInCount} >= 0`,
    ),
    check(
      'event_registration_check_ins_admits_someone',
      sql`${table.attendeeCheckedIn} OR ${table.guestCheckInCount} > 0`,
    ),
    foreignKey({
      columns: [table.registrationId, table.tenantId],
      foreignColumns: [eventRegistrations.id, eventRegistrations.tenantId],
      name: 'event_registration_check_ins_registration_fk',
    }).onDelete('cascade'),
    unique('event_registration_check_ins_operation_unique').on(
      table.registrationId,
      table.operationKey,
    ),
  ],
);
