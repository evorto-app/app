import { and, eq, sql } from 'drizzle-orm';

import { database as database } from './database-client';
import * as schema from './schema';

export const getTenant = database.query.tenants
  .findFirst({ where: eq(schema.tenants.domain, sql.placeholder('domain')) })
  .prepare('getTenant');

export const getUser = database.query.users
  .findFirst({
    where: eq(schema.users.auth0Id, sql.placeholder('auth0Id')),
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

export const userAttributes = database
  .select()
  .from(schema.userAttributes)
  .where(
    and(
      eq(schema.userAttributes.tenantId, sql.placeholder('tenantId')),
      eq(schema.userAttributes.userId, sql.placeholder('userId')),
    ),
  )
  .prepare('userAttributes');
