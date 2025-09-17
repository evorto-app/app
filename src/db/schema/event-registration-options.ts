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
import { CancellationPolicy } from '../../types/cancellation';

export const eventRegistrationOptions = pgTable('event_registration_options', {
  checkedInSpots: integer().notNull().default(0),
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
  roleIds: varchar({ length: 20 }).array().notNull().default([]),
  spots: integer().notNull(),
  stripeTaxRateId: varchar(),
  title: text().notNull(),
  // Cancellation policy configuration (copied from template)
  useTenantCancellationPolicy: boolean().notNull().default(true),
  cancellationPolicy: jsonb('cancellation_policy').$type<CancellationPolicy>(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  waitlistSpots: integer().notNull().default(0),
});
