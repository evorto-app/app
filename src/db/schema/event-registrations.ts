import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { eventInstances } from './event-instances';
import { eventRegistrationOptions } from './event-registration-options';
import {
  discountTypes,
  paymentStatus,
  registrationStatus,
} from './global-enums';
import { modelOfTenant } from './model';
import { users } from './users';

export const eventRegistrations = pgTable('event_registrations', {
  appliedDiscountedPrice: integer('applied_discounted_price'),
  appliedDiscountType: discountTypes('applied_discount_type'),
  basePriceAtRegistration: integer('base_price_at_registration'),
  ...modelOfTenant,
  checkInTime: timestamp(),
  discountAmount: integer('discount_amount'),
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
