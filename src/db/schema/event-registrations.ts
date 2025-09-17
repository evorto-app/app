import { integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

import { eventInstances } from './event-instances';
import { eventRegistrationOptions } from './event-registration-options';
import { discountTypes, paymentStatus, registrationStatus } from './global-enums';
import { modelOfTenant } from './model';
import { users } from './users';

export const eventRegistrations = pgTable('event_registrations', {
  ...modelOfTenant,
  // Snapshot fields for pricing at registration time
  appliedDiscountType: discountTypes(),
  appliedDiscountedPrice: integer(),
  basePriceAtRegistration: integer().notNull(),
  checkInTime: timestamp(),
  discountAmount: integer(),
  eventId: varchar({ length: 20 })
    .notNull()
    .references(() => eventInstances.id),
  paymentId: varchar({ length: 255 }),
  paymentStatus: paymentStatus(),
  registrationOptionId: varchar({ length: 20 })
    .notNull()
    .references(() => eventRegistrationOptions.id),
  status: registrationStatus().notNull(),
  userId: varchar({ length: 20 })
    .notNull()
    .references(() => users.id),
});
