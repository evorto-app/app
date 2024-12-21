import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { eventTemplateCategories } from './eventTemplateCategories';
import { tenants } from './tenantTables';

export const eventTemplates = pgTable('event_templates', {
  id: uuid().defaultRandom().primaryKey(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  title: text().notNull(),
  icon: text().notNull(),
  description: text().notNull(),
  planningTips: text(),
  simpleModeEnabled: boolean().notNull().default(true),
  categoryId: uuid()
    .notNull()
    .references(() => eventTemplateCategories.id),
  tenantId: uuid()
    .notNull()
    .references(() => tenants.id),
});
