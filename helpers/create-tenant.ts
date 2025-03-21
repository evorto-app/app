import { init } from '@paralleldrive/cuid2';
import consola from 'consola';
import { InferInsertModel } from 'drizzle-orm';
import { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { tenants } from '../src/db/schema';
import { getId } from './get-id';
import { usersToAuthenticate } from './user-data';

const length = 4;

export const createId = init({ length });

export const createTenant = async (
  database: NeonDatabase<Record<string, never>, typeof relations>,
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
  // consola.debug(tenant);
  // for (const record of usersToAuthenticate
  //   .filter((data) => data.addToDb && data.addToTenant)
  //   .map((data) => ({
  //     id: getId(),
  //     tenantId: tenant[0].id,
  //     userId: data.id,
  //   }))) {
  //   consola.debug(record);
  //   await database.insert(schema.usersToTenants).values(record);
  // }
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
