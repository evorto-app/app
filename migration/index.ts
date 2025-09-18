import consola from 'consola';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';

import * as oldSchema from '../old/drizzle';
import { database } from '../src/db';
import { resetDatabaseSchema } from '../src/db/reset';
import * as schema from '../src/db/schema';
import { oldDatabase } from './migrator-database';
import { migrateEvents } from './steps/events';
import { setupDefaultRoles } from './steps/roles';
import { migrateTemplateCategories } from './steps/template-categories';
import { migrateTemplates } from './steps/templates';
import { migrateTenant } from './steps/tenant';
import { migrateUserTenantAssignments } from './steps/user-assignments';
import { migrateUsers } from './steps/users';
import { addUniqueIndexTenantStripeTaxRates } from './steps/001_add_unique_index_tenant_stripe_tax_rates';
import { backfillAndSeedTaxRates } from './steps/002_backfill_and_seed_tax_rates';
import { addAdminManageTaxesPermission } from './steps/003_add_admin_manage_taxes_permission';

type Features = 'users' | 'tenants' | 'roles' | 'assignments' | 'templates' | 'events';

function parseFeatures(env: string | undefined): Features[] {
  const all: Features[] = [
    'users',
    'tenants',
    'roles',
    'assignments',
    'templates',
    'events',
  ];
  if (!env) return all;
  const parts = env
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as Features[];
  const set = new Set(parts);
  return all.filter((f) => set.has(f));
}

async function main() {
  const migrationStart = DateTime.local();

  consola.info('Migrations for evorto');
  const clearDb = process.env.MIGRATION_CLEAR_DB === 'true';
  const allowReuseTenant = process.env.MIGRATION_ALLOW_REUSE_TENANT !== 'false';
  const features = parseFeatures(process.env.MIGRATE_FEATURES);
  const tenantsEnv = process.env.MIGRATE_TENANTS; // e.g. "tumi:localhost,tumi:evorto.fly.dev"
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
        { oldShortName: 'tumi', newDomain: 'evorto.fly.dev' },
      ];

  if (clearDb) {
    consola.start('Clear DB');
    await resetDatabaseSchema(database, schema);
    consola.success('DB cleared');
  }

  // Run global migration steps first
  consola.start('Running global migration steps');
  await addUniqueIndexTenantStripeTaxRates();
  consola.success('Global migration steps complete');

  consola.start('Begin migration');

  if (features.includes('users')) {
    await migrateUsers();
  }

  for (const pair of tenantPairs) {
    await runForTenant(pair.oldShortName, pair.newDomain, {
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

main().catch((error) => {
  consola.error('Migration failed', error);
});

async function runForTenant(
  oldShortName: string,
  newDomain: string,
  options: { allowReuseTenant: boolean; features: Features[] },
) {
  consola.start(`Migrating tenant ${oldShortName} to ${newDomain}`);

  // Get the tenant
  const oldTenant = await oldDatabase.query.tenant.findFirst({
    where: { shortName: oldShortName },
  });

  consola.debug('Retrieved old tenant');

  const existingTenant = await database.query.tenants.findFirst({
    where: { domain: newDomain },
  });
  if (existingTenant && !options.allowReuseTenant) {
    consola.error(`Tenant ${newDomain} already exists`);
    return;
  }

  if (!oldTenant) {
    consola.error(`Tenant ${oldShortName} not found`);
    return;
  }

  const newTenant =
    existingTenant ?? (await migrateTenant(newDomain, oldTenant));

  const roleMap = options.features.includes('roles')
    ? await setupDefaultRoles(newTenant)
    : new Map<string, string>();

  if (options.features.includes('assignments')) {
    await migrateUserTenantAssignments(oldTenant, newTenant, roleMap);
  }

  let categoryIdMap = new Map<string, string>();
  if (options.features.includes('templates')) {
    categoryIdMap = await migrateTemplateCategories(oldTenant, newTenant);
  }

  let templateIdMap = new Map<string, string>();
  if (options.features.includes('templates')) {
    templateIdMap = await migrateTemplates(
      oldTenant,
      newTenant,
      categoryIdMap,
      roleMap,
    );
  }

  if (options.features.includes('events')) {
    await migrateEvents(oldTenant, newTenant, templateIdMap, roleMap);
  }

  // Run tenant-specific migration steps
  await addAdminManageTaxesPermission(newTenant.id);
  await backfillAndSeedTaxRates(newTenant.id, newTenant.stripeAccountId);

  consola.success(`Migration ${oldShortName} to ${newDomain} complete`);
}
