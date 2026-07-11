import { Pool } from 'pg';

import { createNodePgPoolConfig } from '../../src/db/pg-connection-config';
import {
  requiredPostgresMajorVersion,
  resolvePostgresIntegrationEnvironment,
} from './postgres-integration-environment';
import { resetPublicSchema } from './reset-public-schema';

const runCommand = async (
  command: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> => {
  const subprocess = Bun.spawn(command, {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  });
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(`${command[0]} failed with exit code ${exitCode}`);
  }
};

const integrationEnvironment = await resolvePostgresIntegrationEnvironment();
const pool = new Pool(
  createNodePgPoolConfig({
    databaseUrl: integrationEnvironment.databaseUrl,
    neonLocalProxy: integrationEnvironment.neonLocalProxy,
  }),
);

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

await resetPublicSchema(integrationEnvironment);

const childEnvironment = {
  DATABASE_URL: integrationEnvironment.databaseUrl,
  NEON_LOCAL_PROXY: 'false',
};
await runCommand(
  ['bunx', '--bun', 'drizzle-kit', 'push', '--force'],
  childEnvironment,
);
await runCommand(
  ['bunx', 'vitest', 'run', '--config', 'vitest.postgres.config.ts'],
  childEnvironment,
);
