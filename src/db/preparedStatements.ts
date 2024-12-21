import { eq, sql } from 'drizzle-orm';
import { db } from './db-client';
import { tenants } from './schema/tenantTables';
import { users } from './schema/userTables';

export const getTenant = db.query.tenants
  .findFirst({ where: eq(tenants.slug, sql.placeholder('slug')) })
  .prepare('getTenant');

export const getUser = db.query.users
  .findFirst({ where: eq(users.auth0Id, sql.placeholder('auth0Id')) })
  .prepare('getUser');
