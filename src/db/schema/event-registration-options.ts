import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { CancellationPolicy } from '../../types/cancellation';
import { createId } from '../create-id';
import { eventInstances } from './event-instances';
import { registrationModes } from './global-enums';

export const eventRegistrationOptions = pgTable('event_registration_options', {
  cancellationPolicy: jsonb('cancellation_policy').$type<CancellationPolicy>(),
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
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  useTenantCancellationPolicy: boolean().notNull().default(true),
  waitlistSpots: integer().notNull().default(0),
});
