import { sql } from 'drizzle-orm';

import type { DatabaseClient } from './database.layer';

const buildPreparedStatements = (database: DatabaseClient) => ({
  getTenantByDomain: database.query.tenants
    .findFirst({
      where: { domain: sql.placeholder('domain') },
      with: {
        privacyPolicyVersions: {
          columns: {
            privacyPolicyText: true,
            privacyPolicyUrl: true,
          },
          limit: 1,
          orderBy: {
            version: 'desc',
          },
        },
      },
    })
    .prepare('getTenantByDomain'),
  getUserByAuth0IdAndTenant: database.query.users
    .findFirst({
      where: { auth0Id: sql.placeholder('auth0Id') },
      with: {
        homeTenant: {
          columns: {
            name: true,
          },
        },
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
});

type PreparedStatements = ReturnType<typeof buildPreparedStatements>;

const preparedStatementsCache = new WeakMap<
  DatabaseClient,
  PreparedStatements
>();

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
