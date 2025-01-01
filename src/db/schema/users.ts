import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { roles } from './roles';
import { tenants } from './tenants';

export const users = pgTable('users', {
  auth0Id: text().notNull().unique(),
  createdAt: timestamp().notNull().defaultNow(),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const usersToTenants = pgTable(
  'users_to_tenants',
  {
    createdAt: timestamp().notNull().defaultNow(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    tenantId: varchar({ length: 20 })
      .notNull()
      .references(() => tenants.id),
    userId: varchar({ length: 20 })
      .notNull()
      .references(() => users.id),
  },
  (table) => ({
    unique: unique().on(table.userId, table.tenantId),
  }),
);

export const rolesToTenantUsers = pgTable(
  'roles_to_tenant_users',
  {
    roleId: varchar({ length: 20 })
      .notNull()
      .references(() => roles.id),
    userTenantId: varchar({ length: 20 })
      .notNull()
      .references(() => usersToTenants.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roleId, table.userTenantId] }),
  }),
);
