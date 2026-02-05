import type { IconValue } from '@shared/types/icon';

import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { EventLocationType } from '../../types/location';
import { eventTemplates } from './event-templates';
import { modelOfTenant } from './model';
import { users } from './users';

export const eventReviewStatus = pgEnum('event_review_status', [
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
]);

export const eventInstances = pgTable('event_instances', {
  ...modelOfTenant,
  creatorId: varchar({ length: 20 })
    .notNull()
    .references(() => users.id),
  description: text().notNull(),
  end: timestamp().notNull(),
  icon: jsonb('icon').$type<IconValue>().notNull(),
  location: jsonb('location').$type<EventLocationType>(),
  reviewedAt: timestamp(),
  reviewedBy: varchar({ length: 20 }).references(() => users.id),
  start: timestamp().notNull(),
  status: eventReviewStatus().notNull().default('DRAFT'),
  statusComment: text(),
  templateId: varchar({ length: 20 })
    .notNull()
    .references(() => eventTemplates.id),
  title: text().notNull(),
  // Unlisted events do not show up in public lists unless user has permission
  unlisted: boolean().notNull().default(false),
});
