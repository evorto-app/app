import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenantTables';

export const roles = pgTable('roles', {
  id: uuid().defaultRandom().primaryKey(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  name: text().notNull(),
  description: text(),
  defaultUserRole: boolean().notNull().default(false),
  canCreateEventTemplates: boolean().notNull().default(false),
  tenantId: uuid()
    .notNull()
    .references(() => tenants.id),
});
