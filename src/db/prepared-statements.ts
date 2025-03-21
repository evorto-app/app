import { and, eq, sql } from 'drizzle-orm';

import { database as database } from './database-client';
import * as schema from './schema';

export const getTenant = database.query.tenants
  .findFirst({ where: { domain: sql.placeholder('domain') } })
  .prepare('getTenant');

export const getUser = database.query.users
  .findFirst({
    where: { auth0Id: sql.placeholder('auth0Id') },
    with: {
      tenantAssignments: {
        where: {
          tenantId: sql.placeholder('tenantId'),
        },
        with: {
          roles: {
            columns: {
              id: true,
              permissions: true,
            },
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
