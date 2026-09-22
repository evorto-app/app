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

const normalizeDatabaseHostname = (hostname: string): string => {
  if (!hostname.includes('[') && !hostname.includes(']')) return hostname;
  const unbracketed = hostname.slice(1, -1);
  if (
    hostname.startsWith('[') &&
    hostname.endsWith(']') &&
    isIP(unbracketed) === 6
  ) {
    return unbracketed;
  }
  throw new Error(
    'Database TLS identity brackets must contain one valid IPv6 address',
  );
};

const rawSocketConnectionOptions = (databaseUrl: string) => {
  const separator = databaseUrl.indexOf(' ');
  const host = separator === -1 ? databaseUrl : databaseUrl.slice(0, separator);
  const database =
    separator === -1 ? undefined : databaseUrl.slice(separator + 1);
  return { host, ...(database && { database }) };
};

const databaseConnectionUrl = (databaseUrl: string): string => {
  const parsedUrl = new URL(databaseUrl);
  const host =
    parsedUrl.searchParams.getAll('host').at(-1) || parsedUrl.hostname;
  if (
    !host.startsWith('[') ||
    !host.endsWith(']') ||
    isIP(host.slice(1, -1)) !== 6
  ) {
    return databaseUrl;
  }

  // pg preserves URL brackets but honors an explicit host query parameter.
  parsedUrl.searchParams.set('host', host.slice(1, -1));
  return parsedUrl.toString();
};

const nativeDatabaseConnectionUrl = (databaseUrl: string): string => {
  if (databaseUrl.startsWith('/')) {
    const { database, host } = rawSocketConnectionOptions(databaseUrl);
    const url = new URL('postgresql:///');
    url.searchParams.set('host', host);
    if (database) url.pathname = `/${encodeURIComponent(database)}`;
    return url.toString();
  }

  const normalizedUrl = databaseConnectionUrl(databaseUrl);
  const url = new URL(normalizedUrl);
  if (
    [...url.searchParams.keys()].some(
      (name) =>
        (name.startsWith('ssl') && name !== 'sslmode') ||
        name === 'uselibpqcompat',
    )
  ) {
    throw new Error(
      'The native PostgreSQL driver supports only sslmode URL options; use DATABASE_TLS_CA_CERTIFICATE for a custom CA',
    );
  }

  // node-pg falls back to the authority when the last override is empty.
  // The native parser otherwise treats an empty host/user as an actual value.
  let changed = false;
  for (const name of ['host', 'port', 'user', 'password']) {
    const overrides = url.searchParams.getAll(name);
    const last = overrides.at(-1);
    if (last === '') {
      url.searchParams.delete(name);
      changed = true;
    } else if (last !== undefined && overrides.length > 1) {
      // Validate only the effective value, including the effective port.
      url.searchParams.set(name, last);
      changed = true;
    }
  }
  return changed ? url.toString() : normalizedUrl;
};

const databaseServerIdentity = (
  databaseUrl: string,
  tlsServerName?: string,
): string => {
  const parsedUrl = new URL(databaseUrl);
  if (
    parsedUrl.protocol !== 'postgresql:' &&
    parsedUrl.protocol !== 'postgres:'
  ) {
    throw new Error('DATABASE_URL must identify a PostgreSQL host');
  }
  if (
    [...parsedUrl.searchParams.keys()].some(
      (name) => name.startsWith('ssl') || name === 'uselibpqcompat',
    )
  ) {
    throw new Error(
      'DATABASE_URL must not include SSL options when DATABASE_TLS_CA_CERTIFICATE is configured',
    );
  }

  const host =
    parsedUrl.searchParams.getAll('host').at(-1) ||
    decodeURIComponent(parsedUrl.hostname);
  if (!host || host.startsWith('/')) {
    throw new Error(
      'DATABASE_URL must identify a TCP PostgreSQL host when a CA is configured',
    );
  }
  return normalizeDatabaseHostname(tlsServerName || host);
};

const createDatabaseTlsOptions = (
  caCertificate: string | undefined,
  databaseUrl: string,
  tlsServerName?: string,
): ConnectionOptions | undefined => {
  if (caCertificate === undefined) return;
  if (caCertificate.trim().length === 0) {
    throw new Error('DATABASE_TLS_CA_CERTIFICATE must not be blank');
  }
  const normalizedServerName = tlsServerName?.trim() || undefined;
  const identity = databaseServerIdentity(databaseUrl, normalizedServerName);
  return {
    ca: caCertificate,
    checkServerIdentity: (_hostname, certificate) =>
      checkServerIdentity(identity, certificate),
    rejectUnauthorized: true,
    ...(normalizedServerName &&
      isIP(identity) === 0 && { servername: identity }),
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
  const ssl = createDatabaseTlsOptions(
    caCertificate,
    databaseUrl,
    tlsServerName,
  );
  return {
    connectTimeout: boundedPool.connectTimeoutMs,
    idleTimeout: boundedPool.idleTimeoutMs,
    maxConnections: boundedPool.max,
    minConnections: boundedPool.min,
    ...(ssl && { ssl }),
    url: Redacted.make(nativeDatabaseConnectionUrl(databaseUrl)),
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
  const ssl = createDatabaseTlsOptions(
    caCertificate,
    databaseUrl,
    tlsServerName,
  );
  return {
    ...(databaseUrl.startsWith('/')
      ? rawSocketConnectionOptions(databaseUrl)
      : { connectionString: databaseConnectionUrl(databaseUrl) }),
    connectionTimeoutMillis: boundedPool.connectTimeoutMs,
    idleTimeoutMillis: boundedPool.idleTimeoutMs,
    max: boundedPool.max,
    min: boundedPool.min,
    ...(ssl && { ssl }),
    types: pgTypes,
  };
};
