import type { IconValue } from '@shared/types/icon';

import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { tenants } from './tenants';

export const eventTemplateCategories = pgTable('event_template_categories', {
  createdAt: timestamp().notNull().defaultNow(),
  description: text(),
  icon: jsonb('icon').$type<IconValue>().notNull(),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  tenantId: varchar({ length: 20 })
    .notNull()
    .references(() => tenants.id),
  title: text().notNull(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
