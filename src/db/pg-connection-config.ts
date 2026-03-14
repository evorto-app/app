import type { PgClientConfig } from '@effect/sql-pg/PgClient';
import type { ConnectionOptions } from 'node:tls';
import type { PoolConfig } from 'pg';

import { Redacted } from 'effect';

const neonLocalSslConfig = {
  rejectUnauthorized: false,
} satisfies ConnectionOptions;

const resolvePgSslConfig = (
  neonLocalProxy: boolean,
): ConnectionOptions | undefined =>
  neonLocalProxy ? neonLocalSslConfig : undefined;

export const createPgClientConfig = ({
  databaseUrl,
  neonLocalProxy,
}: {
  databaseUrl: string;
  neonLocalProxy: boolean;
}): Pick<PgClientConfig, 'ssl' | 'url'> => ({
  ssl: resolvePgSslConfig(neonLocalProxy),
  url: Redacted.make(databaseUrl),
});

export const createNodePgPoolConfig = ({
  databaseUrl,
  neonLocalProxy,
}: {
  databaseUrl: string;
  neonLocalProxy: boolean;
}): PoolConfig => ({
  connectionString: databaseUrl,
  ssl: resolvePgSslConfig(neonLocalProxy),
});
