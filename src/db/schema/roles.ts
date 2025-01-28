import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { Permission } from '../../shared/permissions/permissions';
import { createId } from '../create-id';
import { tenants } from './tenants';

export const roles = pgTable('roles', {
  createdAt: timestamp().notNull().defaultNow(),
  defaultOrganizerRole: boolean().notNull().default(false),
  defaultUserRole: boolean().notNull().default(false),
  description: text(),
  displayInHub: boolean().notNull().default(false),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  name: text().notNull(),
  permissions: jsonb().$type<Permission[]>().notNull().default([]),
  sortOrder: integer().notNull().default(0),
  tenantId: varchar({ length: 20 })
    .notNull()
    .references(() => tenants.id),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
