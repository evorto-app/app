import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { EventLocation } from '../../shared/types/location';
import { eventTemplates } from './event-templates';
import { modelOfTenant } from './model';
import { users } from './users';

export const eventReviewStatus = pgEnum('event_review_status', [
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
]);
export const eventVisibility = pgEnum('event_publication_status', [
  'PRIVATE',
  'HIDDEN',
  'PUBLIC',
]);

export const eventInstances = pgTable('event_instances', {
  ...modelOfTenant,
  creatorId: varchar({ length: 20 })
    .notNull()
    .references(() => users.id),
  description: text().notNull(),
  end: timestamp().notNull(),
  icon: text().notNull(),
  location: jsonb('location').$type<EventLocation>(),
  reviewedAt: timestamp(),
  reviewedBy: varchar({ length: 20 }).references(() => users.id),
  start: timestamp().notNull(),
  status: eventReviewStatus().notNull().default('DRAFT'),
  statusComment: text(),
  templateId: varchar({ length: 20 })
    .notNull()
    .references(() => eventTemplates.id),
  title: text().notNull(),
  visibility: eventVisibility().notNull().default('PRIVATE'),
});
