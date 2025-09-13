import { eq } from 'drizzle-orm';
import { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { relations } from '../../src/db/relations';
import * as schema from '../../src/db/schema';
import { test as base } from './base-test';
import { applyPermissionDiff, PermissionDiff } from '../utils/permissions-override';

interface Fixtures {
  permissionOverride: (diff: PermissionDiff) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  permissionOverride: async ({ database }, use) => {
    await use(async (diff: PermissionDiff) => {
      const rows = await (database as NeonDatabase<Record<string, never>, typeof relations>)
        .select()
        .from(schema.tenants)
        .where(eq(schema.tenants.domain, 'localhost'))
        .limit(1);
      const tenant = rows[0];
      if (!tenant) throw new Error('Tenant not found');
      await applyPermissionDiff(database as any, tenant, diff);
    });
  },
});
export { expect } from '@playwright/test';
