import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventTemplates } from './event-templates';
import { tenants } from './tenants';

export const eventInstances = pgTable('event_instances', {
  createdAt: timestamp().notNull().defaultNow(),
  description: text().notNull(),
  icon: text().notNull(),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  startTime: timestamp().notNull(),
  templateId: varchar({ length: 20 })
    .notNull()
    .references(() => eventTemplates.id),
  tenantId: varchar({ length: 20 })
    .notNull()
    .references(() => tenants.id),
  title: text().notNull(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
