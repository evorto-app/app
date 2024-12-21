import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenantTables';
import { roles } from './roles';

export const users = pgTable('users', {
  id: uuid().defaultRandom().primaryKey(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  auth0Id: text().notNull().unique(),
});

export const usersToTenants = pgTable(
  'users_to_tenants',
  {
    id: uuid().defaultRandom().primaryKey(),
    createdAt: timestamp().notNull().defaultNow(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
  },
  (table) => ({
    unique: unique().on(table.userId, table.tenantId),
  }),
);

export const rolesToTenantUsers = pgTable(
  'roles_to_tenant_users',
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id),
    userTenantId: uuid()
      .notNull()
      .references(() => usersToTenants.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roleId, table.userTenantId] }),
  }),
);
