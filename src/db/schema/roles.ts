import {
  boolean,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { tenants } from './tenants';

export const roles = pgTable('roles', {
  canCreateEventTemplates: boolean().notNull().default(false),
  createdAt: timestamp().notNull().defaultNow(),
  defaultUserRole: boolean().notNull().default(false),
  description: text(),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  name: text().notNull(),
  tenantId: varchar({ length: 20 })
    .notNull()
    .references(() => tenants.id),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
