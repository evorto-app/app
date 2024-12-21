import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenantTables';

export const eventTemplateCategories = pgTable('event_template_categories', {
  id: uuid().defaultRandom().primaryKey(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  title: text().notNull(),
  icon: text().notNull(),
  description: text(),
  tenantId: uuid()
    .notNull()
    .references(() => tenants.id),
});
