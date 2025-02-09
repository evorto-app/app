import { init } from '@paralleldrive/cuid2';
import { InferInsertModel } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';

import * as schema from '../src/db/schema';
import { tenants } from '../src/db/schema';
import { getId } from './get-id';
import { usersToAuthenticate } from './user-data';

const length = 4;

export const createId = init({ length });

export const createTenant = async (
  database: NeonHttpDatabase<typeof schema>,
  tenantData?: Partial<InferInsertModel<typeof schema.tenants>>,
) => {
  const tenant = await database
    .insert(tenants)
    .values({
      ...tenantData,
      domain: tenantData?.domain ?? createId(),
      id: getId(),
      name: tenantData?.name ?? 'ESN Murnau',
    })
    .returning();
  await database.insert(schema.usersToTenants).values(
    usersToAuthenticate
      .filter((data) => data.addToDb && data.addToTenant)
      .map((data) => ({
        id: getId(),
        tenantId: tenant[0].id,
        userId: data.id,
      })),
  );
  return tenant[0];
};
