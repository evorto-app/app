import { integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { discountTypes } from './global-enums';

export const templateRegistrationOptionDiscounts = pgTable(
  'template_registration_option_discounts',
  {
    createdAt: timestamp().notNull().defaultNow(),
    discountedPrice: integer().notNull(),
    discountType: discountTypes().notNull(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .unique()
      .notNull(),
    registrationOptionId: varchar({ length: 20 }).notNull(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);
