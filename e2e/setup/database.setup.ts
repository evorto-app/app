import { init } from '@paralleldrive/cuid2';
import fs from 'node:fs';
import path from 'node:path';

import { setupDatabase } from '../../src/db/setup-database';
import { test as setup } from './../fixtures/base-test';
import { relations } from '../../src/db/relations';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from '../../src/db/schema';

setup('Setup database', async ({ database }) => {
  setup.setTimeout(120_000);
  await setupDatabase(database, true);
  // Persist runtime info for other tests (tenant cookie injection, etc.)
  const runtimePath = path.resolve('.e2e-runtime.json');
  const runId = init({ length: 10 })();
  const tenant = await (database as NeonDatabase<Record<string, never>, typeof relations>).query.tenants.findFirst({
    where: { domain: 'localhost' },
  });
  if (tenant) {
    const payload = {
      runId,
      tenantDomain: tenant.domain,
      tenantId: tenant.id,
    } as const;
    fs.writeFileSync(runtimePath, JSON.stringify(payload, null, 2));
  }
});
