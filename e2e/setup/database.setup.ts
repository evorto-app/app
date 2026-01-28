import { init } from '@paralleldrive/cuid2';
import { reset } from 'drizzle-seed';
import fs from 'node:fs';
import path from 'node:path';

import { test as setup } from './../fixtures/base-test';
import { seedTenant } from '../../helpers/seed-tenant';
import * as schema from '../../src/db/schema';

setup('Setup database', async ({ database }) => {
  setup.setTimeout(120_000);
  // Reset DB and seed a single baseline tenant for this run
  // @ts-expect-error drizzle-seed missing proper types
  await reset(database, schema);
  const runId = init({ length: 10 })();
  const result = await seedTenant(database, {
    domain: 'localhost',
    ensureUsers: true,
    logSeedMap: true,
    runId,
  });

  // Persist runtime info for other tests (tenant cookie injection, etc.)
  const runtimePath = path.resolve('.e2e-runtime.json');
  const payload = {
    runId,
    tenantDomain: result.tenant.domain,
    tenantId: result.tenant.id,
  } as const;
  fs.writeFileSync(runtimePath, JSON.stringify(payload, null, 2));
});
