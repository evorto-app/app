import {
  boolean,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

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
  planningTips: text(),
  simpleModeEnabled: boolean().notNull().default(true),
  tenantId: varchar({ length: 20 })
    .notNull()
    .references(() => tenants.id),
  title: text().notNull(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
