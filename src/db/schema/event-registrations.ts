import { pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventInstances } from './event-instances';
import { eventRegistrationOptions } from './event-registration-options';
import { paymentStatus, registrationStatus } from './global-enums';
import { users } from './users';

export const eventRegistrations = pgTable('event_registrations', {
  checkInTime: timestamp(),
  createdAt: timestamp().notNull().defaultNow(),
  eventId: varchar({ length: 20 })
    .notNull()
    .references(() => eventInstances.id),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  paymentId: varchar({ length: 255 }),
  paymentStatus: paymentStatus(),
  registrationOptionId: varchar({ length: 20 })
    .notNull()
    .references(() => eventRegistrationOptions.id),
  status: registrationStatus().notNull(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  userId: varchar({ length: 20 })
    .notNull()
    .references(() => users.id),
});
