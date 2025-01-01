import { eq, sql } from 'drizzle-orm';

import { database as database } from './database-client';
import { tenants } from './schema/tenants';
import { users } from './schema/users';

export const getTenant = database.query.tenants
  .findFirst({ where: eq(tenants.domain, sql.placeholder('domain')) })
  .prepare('getTenant');

export const getUser = database.query.users
  .findFirst({ where: eq(users.auth0Id, sql.placeholder('auth0Id')) })
  .prepare('getUser');
