import type { EventLocationType } from '@types/location';

import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { eventInstances } from './event-instances';
import { modelOfTenant } from './model';

export interface EventArchiveOptionSummary {
  checkedInSpots: number;
  confirmedSpots: number;
  organizingRegistration: boolean;
  title: string;
  waitlistSpots: number;
}

export interface EventArchiveRegistrationSummary {
  cancelledRegistrations: number;
  checkedInSpots: number;
  confirmedRegistrations: number;
  guestSpots: number;
  waitlistedRegistrations: number;
}

export const eventArchiveSnapshots = pgTable('event_archive_snapshots', {
  ...modelOfTenant,
  archivedAt: timestamp('archived_at').notNull(),
  checkedInSpots: integer('checked_in_spots').notNull().default(0),
  eventEnd: timestamp('event_end').notNull(),
  eventId: varchar({ length: 20 })
    .notNull()
    .unique()
    .references(() => eventInstances.id),
  eventStart: timestamp('event_start').notNull(),
  location: jsonb('location').$type<EventLocationType>(),
  optionSummaries: jsonb('option_summaries')
    .$type<EventArchiveOptionSummary[]>()
    .notNull()
    .default([]),
  registrationSummary: jsonb('registration_summary')
    .$type<EventArchiveRegistrationSummary>()
    .notNull()
    .default({
      cancelledRegistrations: 0,
      checkedInSpots: 0,
      confirmedRegistrations: 0,
      guestSpots: 0,
      waitlistedRegistrations: 0,
    }),
  title: text().notNull(),
});
