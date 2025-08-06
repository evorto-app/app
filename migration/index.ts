import consola from 'consola';
import { eq } from 'drizzle-orm';
import { reset } from 'drizzle-seed';
import { DateTime } from 'luxon';

import * as oldSchema from '../old/drizzle';
import { database } from '../src/db';
import * as schema from '../src/db/schema';
import { oldDatabase } from './migrator-database';
import { migrateEvents } from './steps/events';
import { setupDefaultRoles } from './steps/roles';
import { migrateTemplateCategories } from './steps/template-categories';
import { migrateTemplates } from './steps/templates';
import { migrateTenant } from './steps/tenant';
import { migrateUserTenantAssignments } from './steps/user-assignments';
import { migrateUsers } from './steps/users';

async function main() {
  const migrationStart = DateTime.local();

  consola.info('Migrations for evorto');
  consola.start('Clear DB');
  await reset(database, schema);
  consola.success('DB cleared');
  consola.start('Begin migration');

  await migrateUsers();

  await runForTenant('tumi', 'localhost');
  // await runForTenant('tumi', 'evorto.fly.dev');
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

async function runForTenant(oldShortName: string, newDomain: string) {
  consola.start(`Migrating tenant ${oldShortName} to ${newDomain}`);

  // Get the tenant
  const oldTenant = await oldDatabase.query.tenant.findFirst({
    where: { shortName: oldShortName },
  });

  consola.debug('Retrieved old tenant');

  if (
    await database.query.tenants.findFirst({
      where: { domain: newDomain },
    })
  ) {
    consola.error(`Tenant ${newDomain} already exists`);
    return;
  }

  if (!oldTenant) {
    consola.error(`Tenant ${oldShortName} not found`);
    return;
  }

  const newTenant = await migrateTenant(newDomain, oldTenant);
  const roleMap = await setupDefaultRoles(newTenant);
  await migrateUserTenantAssignments(oldTenant, newTenant, roleMap);
  const categoryIdMap = await migrateTemplateCategories(oldTenant, newTenant);
  const templateIdMap = await migrateTemplates(
    oldTenant,
    newTenant,
    categoryIdMap,
    roleMap,
  );
  await migrateEvents(oldTenant, newTenant, templateIdMap, roleMap);

  consola.success(`Migration ${oldShortName} to ${newDomain} complete`);
}
