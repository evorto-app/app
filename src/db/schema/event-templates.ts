import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { EventLocationType } from '../../types/location';
import { createId } from '../create-id';
import { eventTemplateCategories } from './event-template-categories';
import { tenants } from './tenants';

export const eventTemplates = pgTable('event_templates', {
  categoryId: varchar({ length: 20 })
    .notNull()
    .references(() => eventTemplateCategories.id),
  createdAt: timestamp().notNull().defaultNow(),
  description: text().notNull(),
  icon: text().notNull(),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  location: jsonb('location').$type<EventLocationType>(),
  planningTips: text(),
  simpleModeEnabled: boolean().notNull().default(true),
  tenantId: varchar({ length: 20 })
    .notNull()
    .references(() => tenants.id),
  title: text().notNull(),
  untouchedSinceMigration: boolean().notNull().default(false),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
