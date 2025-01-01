import { init } from '@paralleldrive/cuid2';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';

import * as schema from '../src/db/schema';
import { tenants } from '../src/db/schema';

const length = 4;

export const createId = init({ length });

export const createTenant = async (
  database: NeonHttpDatabase<typeof schema>,
  domain?: string,
) => {
  domain ??= createId();
  const tenant = await database
    .insert(tenants)
    .values({
      domain,
      name: 'Test Tenant',
    })
    .returning();
  return tenant[0];
};
