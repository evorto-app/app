import { integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { discountTypes } from './globalEnums';

export const templateRegistrationOptionDiscounts = pgTable(
  'template_registration_option_discounts',
  {
    id: uuid().defaultRandom().primaryKey(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    discountType: discountTypes().notNull(),
    discountedPrice: integer().notNull(),
    registrationOptionId: uuid().notNull(),
  },
);
