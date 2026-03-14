import type { PgClientConfig } from '@effect/sql-pg/PgClient';
import type { ConnectionOptions } from 'node:tls';
import type { PoolConfig } from 'pg';

import { Redacted } from 'effect';

const neonLocalSslConfig = {
  rejectUnauthorized: false,
} satisfies ConnectionOptions;
const neonLocalHosts = new Set(['127.0.0.1', '::1', 'db', 'localhost']);

const assertNeonLocalHost = (host: string) => {
  if (neonLocalHosts.has(host)) {
    return;
  }

  throw new Error(
    `NEON_LOCAL_PROXY only supports localhost or docker db hosts. Received "${host}".`,
  );
};

const parseDatabaseUrl = (databaseUrl: string) => {
  const databaseUrlObject = new URL(databaseUrl);
  const database = databaseUrlObject.pathname.replace(/^\/+/, '');

  if (!database) {
    throw new Error('DATABASE_URL must include a database name');
  }

  return {
    database,
    host: databaseUrlObject.hostname,
    password: decodeURIComponent(databaseUrlObject.password),
    port: Number.parseInt(databaseUrlObject.port || '5432', 10),
    user: decodeURIComponent(databaseUrlObject.username),
  };
};

export const createPgClientConfig = ({
  databaseUrl,
  neonLocalProxy,
}: {
  databaseUrl: string;
  neonLocalProxy: boolean;
}): Pick<
  PgClientConfig,
  'database' | 'host' | 'password' | 'port' | 'ssl' | 'url' | 'username'
> => {
  if (!neonLocalProxy) {
    return {
      url: Redacted.make(databaseUrl),
    };
  }

  const { database, host, password, port, user } = parseDatabaseUrl(databaseUrl);
  assertNeonLocalHost(host);

  return {
    database,
    host,
    password: Redacted.make(password),
    port,
    ssl: neonLocalSslConfig,
    username: user,
  };
};

export const createNodePgPoolConfig = ({
  databaseUrl,
  neonLocalProxy,
}: {
  databaseUrl: string;
  neonLocalProxy: boolean;
}): PoolConfig => {
  if (!neonLocalProxy) {
    return {
      connectionString: databaseUrl,
    };
  }

  const { database, host, password, port, user } = parseDatabaseUrl(databaseUrl);
  assertNeonLocalHost(host);

  return {
    database,
    host,
    password,
    port,
    ssl: neonLocalSslConfig,
    user,
  };
};
