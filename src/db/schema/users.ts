import { and, count, eq, SQL, sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  pgView,
  primaryKey,
  QueryBuilder,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventRegistrationOptions } from './event-registration-options';
import { eventRegistrations } from './event-registrations';
import { roles } from './roles';
import { tenants } from './tenants';

/**
 * To add unaccent to our database as immutable extension
 * CREATE EXTENSION IF NOT EXISTS unaccent;
 * CREATE EXTENSION IF NOT EXISTS pg_trgm;
 * CREATE OR REPLACE FUNCTION immutable_unaccent(varchar)
 *   RETURNS text AS $$
 *     SELECT unaccent($1)
 *   $$ LANGUAGE sql IMMUTABLE;
 */

export const users = pgTable(
  'users',
  {
    auth0Id: text().notNull().unique(),
    communicationEmail: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    email: text().notNull(),
    firstName: text().notNull(),
    iban: text(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    lastName: text().notNull(),
    paypalEmail: text(),
    searchableInfo: text().generatedAlwaysAs(
      (): SQL =>
        sql`lower(immutable_unaccent(
        ${users.firstName}
        ||
        ' '
        ||
        ${users.lastName}
        ||
        ' '
        ||
        ${users.communicationEmail}
        ||
        ' '
        ||
        ${users.email}
        )
        )`,
    ),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    searchGinIndex: index('searchable_info_idx').using(
      'gin',
      sql`${table.searchableInfo}
      gin_trgm_ops`,
    ),
  }),
);

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

const queryBuilder = new QueryBuilder();

const organizingRegistration = queryBuilder
  .select({
    optionCount: count(eventRegistrationOptions.id)
      .mapWith(Boolean)
      .as('optionCount'),
    tenantId: eventRegistrations.tenantId,
    userId: eventRegistrations.userId,
  })
  .from(eventRegistrationOptions)
  .where(eq(eventRegistrationOptions.organizingRegistration, true))
  .innerJoin(
    eventRegistrations,
    eq(eventRegistrationOptions.id, eventRegistrations.registrationOptionId),
  )
  .groupBy(eventRegistrations.tenantId, eventRegistrations.userId)
  .as('organizing_registration');

export const userAttributes = pgView('user_attributes').as((database) =>
  database
    .select({
      id: usersToTenants.id,
      organizesSome: organizingRegistration.optionCount,
      tenantId: usersToTenants.tenantId,
      userId: usersToTenants.userId,
    })
    .from(usersToTenants)
    .leftJoin(
      organizingRegistration,
      and(
        eq(organizingRegistration.tenantId, usersToTenants.tenantId),
        eq(organizingRegistration.userId, usersToTenants.userId),
      ),
    ),
);
