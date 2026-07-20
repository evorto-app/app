import type { PgPoolConfig } from '@effect/sql-pg/PgClient';
import type { ConnectionOptions } from 'node:tls';
import type { PoolConfig } from 'pg';

import { Redacted } from 'effect';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { types } from 'pg';

export interface DatabasePoolSettings {
  readonly connectTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly max: number;
  readonly min: number;
}

export const defaultDatabasePoolSettings = {
  connectTimeoutMs: 10_000,
  idleTimeoutMs: 30_000,
  max: 5,
  min: 0,
} satisfies DatabasePoolSettings;

const dateTimeTypeIds = new Set([
  1082, 1114, 1115, 1182, 1184, 1185, 1186, 1187, 1231,
]);

const pgTypes = {
  getTypeParser: (typeId: number, format?: 'binary' | 'text') => {
    if (dateTimeTypeIds.has(typeId)) {
      return (value: string) => value;
    }

    return types.getTypeParser(typeId, format);
  },
};

const validatePoolSettings = (
  pool: DatabasePoolSettings,
): DatabasePoolSettings => {
  if (pool.min > pool.max) {
    throw new Error('DATABASE_POOL_MIN cannot exceed DATABASE_POOL_MAX');
  }
  return pool;
};

const databaseServerIdentity = (
  databaseUrl: string,
  tlsServerName?: string,
): string => {
  const parsedUrl = new URL(databaseUrl);
  if (
    (parsedUrl.protocol !== 'postgresql:' &&
      parsedUrl.protocol !== 'postgres:') ||
    !parsedUrl.hostname
  ) {
    throw new Error('DATABASE_URL must identify a PostgreSQL host');
  }
  return tlsServerName || parsedUrl.hostname;
};

const createDatabaseTlsOptions = (
  caCertificate: string,
  databaseUrl: string,
  tlsServerName?: string,
): ConnectionOptions => {
  const identity = databaseServerIdentity(databaseUrl, tlsServerName);
  return {
    ca: caCertificate,
    checkServerIdentity: (_hostname, certificate) =>
      checkServerIdentity(identity, certificate),
    rejectUnauthorized: true,
    ...(tlsServerName &&
      isIP(tlsServerName) === 0 && { servername: tlsServerName }),
  };
};

export const createPgClientConfig = ({
  caCertificate,
  databaseUrl,
  pool = defaultDatabasePoolSettings,
  tlsServerName,
}: {
  caCertificate?: string | undefined;
  databaseUrl: string;
  pool?: DatabasePoolSettings;
  tlsServerName?: string | undefined;
}): PgPoolConfig => {
  const boundedPool = validatePoolSettings(pool);
  return {
    connectTimeout: boundedPool.connectTimeoutMs,
    idleTimeout: boundedPool.idleTimeoutMs,
    maxConnections: boundedPool.max,
    minConnections: boundedPool.min,
    ...(caCertificate && {
      ssl: createDatabaseTlsOptions(caCertificate, databaseUrl, tlsServerName),
    }),
    types: pgTypes,
    url: Redacted.make(databaseUrl),
  };
};

export const createNodePgPoolConfig = ({
  caCertificate,
  databaseUrl,
  pool = defaultDatabasePoolSettings,
  tlsServerName,
}: {
  caCertificate?: string | undefined;
  databaseUrl: string;
  pool?: DatabasePoolSettings;
  tlsServerName?: string | undefined;
}): PoolConfig => {
  const boundedPool = validatePoolSettings(pool);
  return {
    connectionString: databaseUrl,
    connectionTimeoutMillis: boundedPool.connectTimeoutMs,
    idleTimeoutMillis: boundedPool.idleTimeoutMs,
    max: boundedPool.max,
    min: boundedPool.min,
    ...(caCertificate && {
      ssl: createDatabaseTlsOptions(caCertificate, databaseUrl, tlsServerName),
    }),
    types: pgTypes,
  };
};
