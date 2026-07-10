import { init } from '@paralleldrive/cuid2';
import consola from 'consola';
import { InferInsertModel } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { tenants } from '../src/db/schema';
import { normalizeTenantDomain } from '../src/shared/tenant-origin';
import { getId } from './get-id';
import { usersToAuthenticate } from './user-data';

const length = 4;

export const createId = init({ length });

export const createTenant = async (
  database: NodePgDatabase<typeof relations>,
  tenantData?: Partial<InferInsertModel<typeof schema.tenants>>,
) => {
  const t0 = Date.now();
  const domain = normalizeTenantDomain(tenantData?.domain ?? createId());
  const tenant = await database
    .insert(tenants)
    .values({
      ...tenantData,
      domain,
      id: getId(),
      name: tenantData?.name ?? 'ESN Murnau',
    })
    .returning();
  consola.success(
    `Created tenant ${tenant[0].domain} (${tenant[0].id}) in ${Date.now() - t0}ms`,
  );
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
  consola.info('Assigned default users to new tenant');
  return tenant[0];
};
