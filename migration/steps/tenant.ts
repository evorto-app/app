import consola from 'consola';
import { InferSelectModel } from 'drizzle-orm';

import * as oldSchema from '../../old/drizzle';
import { database } from '../../src/db';
import * as schema from '../../src/db/schema';

export const migrateTenant = async (
  newDomain: string,
  oldTenantData: InferSelectModel<typeof oldSchema.tenant>,
) => {
  consola.info(`Migrating tenant`);
  const tenantReturn = await database
    .insert(schema.tenants)
    .values({
      currency: oldTenantData.currency,
      domain: newDomain,
      name: oldTenantData.name,
      theme: 'esn',
    })
    .returning();
  return tenantReturn[0];
};
