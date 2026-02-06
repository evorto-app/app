import {
  boolean,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { eventInstances } from './event-instances';
import { eventRegistrationOptions } from './event-registration-options';
import { paymentStatus, registrationStatus } from './global-enums';
import { modelOfTenant } from './model';
import { users } from './users';

export const eventRegistrations = pgTable('event_registrations', {
  ...modelOfTenant,
  checkInTime: timestamp(),
  eventId: varchar({ length: 20 })
    .notNull()
    .references(() => eventInstances.id),
  paymentId: varchar({ length: 255 }),
  paymentStatus: paymentStatus(),
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
});
