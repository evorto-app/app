import { init } from '@paralleldrive/cuid2';
import { reset } from 'drizzle-seed';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import fs from 'node:fs';
import path from 'node:path';

import { test as setup } from './../fixtures/base-test';
import { seedBaseline } from '../utils/seed';
import { relations } from '../../src/db/relations';
import * as schema from '../../src/db/schema';

setup('Setup database', async ({ database }) => {
  setup.setTimeout(120_000);
  // Reset DB and seed a single baseline tenant for this run
  // @ts-expect-error drizzle-seed missing proper types
  await reset(database, schema);
  const runId = init({ length: 10 })();
  const result = await seedBaseline(
    database as NeonDatabase<Record<string, never>, typeof relations>,
    { runId, domain: 'localhost' },
  );

  // Persist runtime info for other tests (tenant cookie injection, etc.)
  const runtimePath = path.resolve('.e2e-runtime.json');
  const payload = {
    runId,
    tenantDomain: result.tenant.domain,
    tenantId: result.tenant.id,
  } as const;
  fs.writeFileSync(runtimePath, JSON.stringify(payload, null, 2));
});
