import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const source = (relativePath: string): string =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

describe('fail-loud local database and seed source', () => {
  it('routes every project-owned local Drizzle push through the guarded config', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      scripts: Record<string, string>;
    };
    const compose = source('docker-compose.yml');
    const drizzleConfig = source('drizzle.config.ts');
    const integrationRunner = source(
      'helpers/testing/run-postgres-integration.ts',
    );
    const integrationDatabase = source(
      'helpers/testing/postgres-integration-database.ts',
    );
    const reset = source('helpers/reset-database-schema.ts');

    expect(packageJson.scripts['db:push']).toContain('drizzle-kit push');
    expect(packageJson.scripts['db:push']).not.toContain('--config');
    expect(packageJson.scripts['db:reset']).toContain(
      'drizzle-kit/bin.cjs push',
    );
    expect(packageJson.scripts['db:reset']).not.toContain('--config');
    expect(compose).toContain('drizzle-kit/bin.cjs push --force');
    expect(compose).not.toContain('drizzle-kit/bin.cjs push --config');
    expect(compose).not.toContain('local-postgres-init.sql');
    expect(compose).not.toContain('/docker-entrypoint-initdb.d');

    expect(drizzleConfig).toContain(
      "import { resolveLocalDatabaseEnvironment } from './helpers/local-database-preflight';",
    );
    expect(drizzleConfig).toContain(
      'const { databaseUrl } = resolveLocalDatabaseEnvironment();',
    );
    expect(reset).toContain('resolveLocalDatabaseEnvironment()');
    const ensureIntegrationDatabaseCall =
      'await ensureLocalPostgresIntegrationDatabase({ databaseUrl });';
    const resetPublicSchemaCall = 'await resetPublicSchema({ databaseUrl });';
    expect(reset).toContain(ensureIntegrationDatabaseCall);
    expect(reset).toContain(resetPublicSchemaCall);
    expect(reset.indexOf(ensureIntegrationDatabaseCall)).toBeLessThan(
      reset.indexOf(resetPublicSchemaCall),
    );
    expect(integrationDatabase).toContain(
      'CREATE DATABASE "${postgresIntegrationDatabaseName}"',
    );
    expect(integrationRunner).toContain("LOCAL_DATABASE: 'true'");
    expect(integrationRunner).toContain(
      'POSTGRES_DB: postgresIntegrationDatabaseName',
    );
  });

  it('commits the staging completion marker only with the complete seed', () => {
    const setup = source('src/db/setup-database.ts');
    const initialization = source('src/db/staging-database-initialization.ts');

    expect(setup).toContain(
      'return database.transaction(async (transaction) => {',
    );
    expect(setup).toContain('await reset(transaction, schema);');
    expect(setup).toContain('await seedBaseUsers(transaction);');
    expect(setup).toContain('await seedTenant(transaction, seedOptions);');
    expect(initialization).toContain('hasCompletedSeedMarker');
    expect(initialization).toContain(
      'setupDatabase writes\n    // every seeded row, including this tenant, in one transaction',
    );
  });

  it('requires explicit tenant identity and roles and lets seed writes fail', () => {
    const addEvents = source('helpers/add-events.ts');
    const addFinanceReceipts = source('helpers/add-finance-receipts.ts');
    const createTenant = source('helpers/create-tenant.ts');
    const seedTenant = source('helpers/seed-tenant.ts');

    expect(seedTenant).toMatch(/currency:\s*SupportedTenantCurrency;/u);
    expect(seedTenant).toMatch(/domain:\s*string;/u);
    expect(seedTenant).toMatch(/name:\s*string;/u);
    expect(createTenant).toContain('tenantData: CreateSeedTenantInput');
    expect(addEvents).toContain(
      "requireSeedUserId(usersToAuthenticate, 'admin')",
    );
    expect(addEvents).toContain(
      "requireSeedUserId(usersToAuthenticate, 'organizer')",
    );
    expect(addEvents).toContain('requireSeedRoles(roles)');
    expect(addFinanceReceipts).toContain(
      "requireSeedUserId(usersToAuthenticate, 'admin')",
    );
    expect(seedTenant).toContain(
      'const { adminRole } = requireSeedRoles(roles)',
    );

    expect(addEvents).not.toContain('for (let attempt');
    expect(addEvents).not.toContain('Failed to seed event discounts');
    expect(addEvents).not.toContain('consola.warn');
  });
});
