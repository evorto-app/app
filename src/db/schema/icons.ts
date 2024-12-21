import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenantTables';

export const icons = pgTable('icons', {
  id: uuid().defaultRandom().primaryKey(),
  createdAt: timestamp().notNull().defaultNow(),
  commonName: text().notNull(),
  tenantId: uuid()
    .notNull()
    .references(() => tenants.id),
});
