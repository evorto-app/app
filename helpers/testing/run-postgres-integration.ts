import { Pool } from 'pg';

import { createNodePgPoolConfig } from '../../src/db/pg-connection-config';
import {
  postgresIntegrationChildEnvironment,
  requiredPostgresMajorVersion,
  resolvePostgresIntegrationEnvironment,
} from './postgres-integration-environment';
import {
  ensureLocalPostgresIntegrationDatabase,
  postgresMaintenanceDatabaseUrl,
} from './postgres-integration-database';
import { resetPublicSchema } from './reset-public-schema';

const runCommand = async (
  command: readonly string[],
  environment: Readonly<Record<string, string>>,
): Promise<void> => {
  const subprocess = Bun.spawn(command, {
    cwd: process.cwd(),
    env: environment,
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  });
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(`${command[0]} failed with exit code ${exitCode}`);
  }
};

const arguments_ = process.argv.slice(2);
if (
  arguments_.length > 1 ||
  arguments_.some((argument) => argument !== '--local')
) {
  throw new Error('Usage: run-postgres-integration.ts [--local]');
}
const integrationEnvironment = await resolvePostgresIntegrationEnvironment({
  local: arguments_[0] === '--local',
});
const pool = new Pool({
  ...createNodePgPoolConfig({
    databaseUrl: postgresMaintenanceDatabaseUrl(
      integrationEnvironment.databaseUrl,
    ),
  }),
  sslnegotiation: 'postgres',
});

try {
  const versionResult = await pool.query<{ server_version_num: string }>(
    'SHOW server_version_num',
  );
  const versionNumber = Number.parseInt(
    versionResult.rows[0]?.server_version_num ?? '',
    10,
  );
  const majorVersion = Math.floor(versionNumber / 10_000);
  if (majorVersion !== requiredPostgresMajorVersion) {
    throw new Error(
      `PostgreSQL ${requiredPostgresMajorVersion} is required for integration tests`,
    );
  }
} finally {
  await pool.end();
}

const integrationConnection = {
  ...integrationEnvironment,
  sslNegotiation: 'postgres' as const,
};
await ensureLocalPostgresIntegrationDatabase(integrationConnection);
await resetPublicSchema(integrationConnection);

const childEnvironment = {
  ...postgresIntegrationChildEnvironment(integrationEnvironment),
  LOCAL_DATABASE: 'true',
};
await runCommand(
  ['bunx', '--bun', 'drizzle-kit', 'push', '--force'],
  childEnvironment,
);
await runCommand(
  ['bunx', 'vitest', 'run', '--config', 'vitest.postgres.config.ts'],
  childEnvironment,
);
