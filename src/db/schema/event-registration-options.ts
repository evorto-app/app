import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventInstances } from './event-instances';
import { registrationModes } from './global-enums';

// Type for discount configurations - must match template definition
export interface DiscountConfig {
  discountType: 'esnCard';
  discountedPrice: number;
}

export const eventRegistrationOptions = pgTable('event_registration_options', {
  checkedInSpots: integer().notNull().default(0),
  closeRegistrationTime: timestamp().notNull(),
  confirmedSpots: integer().notNull().default(0),
  createdAt: timestamp().notNull().defaultNow(),
  description: text(),
  // Discounts configuration stored as JSONB array
  discounts: jsonb('discounts').$type<DiscountConfig[]>(),
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
  registeredDescription: text(),
  registrationMode: registrationModes().notNull(),
  reservedSpots: integer().notNull().default(0),
  roleIds: varchar({ length: 20 }).array().notNull().default([]),
  spots: integer().notNull(),
  stripeTaxRateId: varchar(),
  title: text().notNull(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  waitlistSpots: integer().notNull().default(0),
});
