import { and, eq, sql } from 'drizzle-orm';

import type { DatabaseClient } from './database.layer';
import * as schema from './schema';

const buildPreparedStatements = (database: DatabaseClient) => ({
  getTenantByDomain: database.query.tenants
    .findFirst({
      where: { domain: sql.placeholder('domain') },
    })
    .prepare('getTenantByDomain'),
  getUserByAuth0IdAndTenant: database.query.users
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
    .prepare('getUserByAuth0IdAndTenant'),
  getUserAttributesByTenantAndUser: database
    .select()
    .from(schema.userAttributes)
    .where(
      and(
        eq(schema.userAttributes.tenantId, sql.placeholder('tenantId')),
        eq(schema.userAttributes.userId, sql.placeholder('userId')),
      ),
    )
    .limit(1)
    .prepare('getUserAttributesByTenantAndUser'),
});

type PreparedStatements = ReturnType<typeof buildPreparedStatements>;

const preparedStatementsCache = new WeakMap<DatabaseClient, PreparedStatements>();

export const getPreparedStatements = (
  database: DatabaseClient,
): PreparedStatements => {
  const cachedStatements = preparedStatementsCache.get(database);
  if (cachedStatements) {
    return cachedStatements;
  }

  const preparedStatements = buildPreparedStatements(database);
  preparedStatementsCache.set(database, preparedStatements);
  return preparedStatements;
};
