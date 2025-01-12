import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventInstances } from './event-instances';
import { registrationModes } from './global-enums';

export const eventRegistrationOptions = pgTable('event_registration_options', {
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
  registeredDescription: text(),
  registrationMode: registrationModes().notNull(),
  reservedSpots: integer().notNull().default(0),
  spots: integer().notNull(),
  title: text().notNull(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  waitlistSpots: integer().notNull().default(0),
});
