import { eq, sql } from 'drizzle-orm';

import { database as database } from './database-client';
import { tenants, users } from './schema';

export const getTenant = database.query.tenants
  .findFirst({ where: eq(tenants.domain, sql.placeholder('domain')) })
  .prepare('getTenant');

export const getUser = database.query.users
  .findFirst({
    where: eq(users.auth0Id, sql.placeholder('auth0Id')),
    with: {
      usersToTenants: {
        with: {
          rolesToTenantUsers: {
            with: { role: { columns: { id: true, permissions: true } } },
          },
        },
      },
    },
  })
  .prepare('getUser');
