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
  closeRegistrationOffset: integer().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
  description: text(),
  eventId: varchar({ length: 20 })
    .notNull()
    .references(() => eventInstances.id),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  isPaid: boolean().notNull(),
  openRegistrationOffset: integer().notNull(),
  organizingRegistration: boolean().notNull(),
  price: integer().notNull(),
  registeredDescription: text(),
  registrationMode: registrationModes().notNull(),
  spots: integer().notNull(),
  title: text().notNull(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
