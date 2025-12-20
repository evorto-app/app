import { integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventRegistrationOptions } from './event-registration-options';
import { discountTypes } from './global-enums';

export const eventRegistrationOptionDiscounts = pgTable('event_registration_option_discounts', {
  createdAt: timestamp().notNull().defaultNow(),
  discountedPrice: integer().notNull(),
  discountType: discountTypes().notNull(),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  registrationOptionId: varchar({ length: 20 })
    .notNull()
    .references(() => eventRegistrationOptions.id),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
