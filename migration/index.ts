import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { databaseConfig } from '@db/database-config';
import consola from 'consola';
import type { InferSelectModel } from 'drizzle-orm';
import { reset } from 'drizzle-seed';
import { ConfigProvider, Effect, Option, Redacted } from 'effect';
import { DateTime } from 'luxon';
import type Stripe from 'stripe';

import * as oldSchema from '../old/drizzle';
import {
  createDatabaseClient,
  type ScriptDatabaseClient,
} from '../src/db/database-client';
import * as schema from '../src/db/schema';
import { formatConfigError } from '../src/server/config/config-error';
import { makeRuntimeConfigProvider } from '../src/server/config/provider';
import { StripeClient, stripeClientLayer } from '../src/server/stripe-client';
import { normalizeTenantDomain } from '../src/shared/tenant-origin';
import { assertDirectSchemaMigrationEnvironment } from './cutover-guard';
import {
  type MigrationFeature,
  parseMigrationFeatures,
} from './feature-selection';
import { oldDatabase, oldPool } from './migrator-database';
import { preflightLegacyTenant } from './preflight';
import { migrateEvents } from './steps/events';
import { setupDefaultRoles } from './steps/roles';
import { migrateTemplateCategories } from './steps/template-categories';
import { migrateTemplates } from './steps/templates';
import {
  ensureMigratedTenantPrivacyPolicy,
  migrateTenant,
} from './steps/tenant';
import { migrateUserTenantAssignments } from './steps/user-assignments';
import { migrateUsers } from './steps/users';
import { importLegacyPaidOptionTaxRates } from './steps/002_import_legacy_paid_option_tax_rates';
import { addAdminTaxPermission } from './steps/003_add_admin_manage_taxes_permission';

type LegacyTenant = InferSelectModel<typeof oldSchema.tenant>;

async function runMigration(database: ScriptDatabaseClient, stripe: Stripe) {
  const migrationStart = DateTime.local();

  consola.info('Migrations for evorto');
  const clearDb = process.env['MIGRATION_CLEAR_DB'] === 'true';
  const allowReuseTenant =
    process.env['MIGRATION_ALLOW_REUSE_TENANT'] !== 'false';
  const features = parseMigrationFeatures(process.env['MIGRATE_FEATURES']);
  const tenantsEnv = process.env['MIGRATE_TENANTS']; // e.g. "tumi:localhost,tumi:staging.evorto.app"
  const tenantPairs = tenantsEnv
    ? tenantsEnv
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const [oldShort, domain] = p.split(':');
          return { oldShortName: oldShort, newDomain: domain };
        })
    : [
        { oldShortName: 'tumi', newDomain: 'localhost' },
        { oldShortName: 'tumi', newDomain: 'staging.evorto.app' },
      ];

  const migrationTenants: Array<{
    newDomain: string;
    oldShortName: string;
    oldTenant: LegacyTenant;
  }> = [];
  for (const pair of tenantPairs) {
    const oldTenant = await oldDatabase.query.tenant.findFirst({
      where: { shortName: pair.oldShortName },
    });
    if (!oldTenant) {
      throw new Error(`Legacy tenant ${pair.oldShortName} was not found.`);
    }
    if (features.includes('events')) {
      await preflightLegacyTenant(oldTenant);
    }
    migrationTenants.push({ ...pair, oldTenant });
  }

  if (clearDb) {
    consola.start('Clear DB');
    await reset(database, schema);
    consola.success('DB cleared');
  }

  consola.start('Begin migration');

  if (features.includes('users')) {
    await migrateUsers(database);
  }

  for (const { newDomain, oldShortName, oldTenant } of migrationTenants) {
    await runForTenant(database, stripe, oldShortName, newDomain, oldTenant, {
      allowReuseTenant,
      features,
    });
  }
  // await runForTenant('tumi', 'tumi.esn.world');
  consola.success('Migration complete');
  const migrationEnd = DateTime.local();
  consola.info(
    `Migration took ${migrationEnd.diff(migrationStart, ['minutes', 'seconds']).toHuman()}`,
  );
}

async function runForTenant(
  database: ScriptDatabaseClient,
  stripe: Stripe,
  oldShortName: string,
  newDomain: string,
  oldTenant: LegacyTenant,
  options: {
    allowReuseTenant: boolean;
    features: readonly MigrationFeature[];
  },
) {
  const normalizedDomain = normalizeTenantDomain(newDomain);
  consola.start(`Migrating tenant ${oldShortName} to ${normalizedDomain}`);

  const existingTenant = await database.query.tenants.findFirst({
    where: { domain: normalizedDomain },
  });
  if (existingTenant && !options.allowReuseTenant) {
    throw new Error(`Target tenant ${normalizedDomain} already exists.`);
  }

  const newTenant = await migrateTenant(database, normalizedDomain, oldTenant);
  await ensureMigratedTenantPrivacyPolicy(database, newTenant.id, oldTenant);

  const roleMap = options.features.includes('roles')
    ? await setupDefaultRoles(database, newTenant)
    : new Map<string, string>();

  if (options.features.includes('assignments')) {
    await migrateUserTenantAssignments(database, oldTenant, newTenant, roleMap);
  }

  let categoryIdMap = new Map<string, string>();
  if (options.features.includes('templates')) {
    categoryIdMap = await migrateTemplateCategories(
      database,
      oldTenant,
      newTenant,
    );
  }

  let templateIdMap = new Map<string, string>();
  if (options.features.includes('templates')) {
    templateIdMap = await migrateTemplates(
      database,
      oldTenant,
      newTenant,
      categoryIdMap,
      roleMap,
    );
  }

  if (options.features.includes('events')) {
    await migrateEvents(database, oldTenant, newTenant, templateIdMap, roleMap);
  }

  // Run tenant-specific migration steps
  await addAdminTaxPermission(database, newTenant.id);
  await importLegacyPaidOptionTaxRates(
    database,
    stripe,
    {
      stripeConnectAccountId: oldTenant.stripeConnectAccountId,
      stripeReducedTaxRate: oldTenant.stripeReducedTaxRate,
      stripeRegularTaxRate: oldTenant.stripeRegularTaxRate,
    },
    { id: newTenant.id, stripeAccountId: newTenant.stripeAccountId },
  );

  consola.success(`Migration ${oldShortName} to ${normalizedDomain} complete`);
}

const main = Effect.gen(function* () {
  const runtimeConfigProvider = yield* makeRuntimeConfigProvider();
  const databaseConfiguration = yield* databaseConfig
    .parse(runtimeConfigProvider)
    .pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Invalid database configuration:\n${formatConfigError(error)}`,
          ),
      ),
    );
  assertDirectSchemaMigrationEnvironment({
    allowReuseTenant: process.env['MIGRATION_ALLOW_REUSE_TENANT'] !== 'false',
    clearTarget: process.env['MIGRATION_CLEAR_DB'] === 'true',
    confirmation: process.env['MIGRATION_CUTOVER_CONFIRMED'],
    featureSelection: process.env['MIGRATE_FEATURES'],
    sourceDatabaseUrl: process.env['LEGACY_DATABASE_URL'],
    targetDatabaseUrl: databaseConfiguration.DATABASE_URL,
    tenantSelection: process.env['MIGRATE_TENANTS'],
  });
  const caCertificate = databaseConfiguration.DATABASE_TLS_CA_CERTIFICATE.pipe(
    Option.map((certificate) => Redacted.value(certificate)),
    Option.getOrUndefined,
  );
  const tlsServerName = Option.getOrUndefined(
    databaseConfiguration.DATABASE_TLS_SERVER_NAME,
  );
  const { database, pool } = createDatabaseClient(
    databaseConfiguration.DATABASE_URL,
    caCertificate,
    tlsServerName,
  );

  const migration = Effect.gen(function* () {
    const stripe = yield* StripeClient;
    yield* Effect.tryPromise({
      catch: (cause) => new Error('Migration failed', { cause }),
      try: () => runMigration(database, stripe),
    });
  }).pipe(
    Effect.provide(stripeClientLayer),
    Effect.provide(ConfigProvider.layer(runtimeConfigProvider)),
  );

  yield* migration.pipe(
    Effect.ensuring(
      Effect.all([
        Effect.tryPromise(() => oldPool.end()),
        Effect.tryPromise(() => pool.end()),
      ]).pipe(Effect.orDie),
    ),
  );
});

if (import.meta.main) {
  BunRuntime.runMain(main);
}
