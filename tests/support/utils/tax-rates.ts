import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';

type TestDatabase = NodePgDatabase<typeof relations>;

type TaxRateCompatibilitySnapshot = {
  active: boolean;
  id: string;
  inclusive: boolean;
};

export const withNoCompatibleTaxRates = async <T>(
  database: TestDatabase,
  tenantId: string,
  run: () => Promise<T>,
): Promise<T> => {
  const snapshots: TaxRateCompatibilitySnapshot[] =
    await database.query.tenantStripeTaxRates.findMany({
      columns: {
        active: true,
        id: true,
        inclusive: true,
      },
      where: {
        tenantId,
      },
    });

  await database
    .update(schema.tenantStripeTaxRates)
    .set({ active: false })
    .where(eq(schema.tenantStripeTaxRates.tenantId, tenantId));

  try {
    return await run();
  } finally {
    for (const snapshot of snapshots) {
      await database
        .update(schema.tenantStripeTaxRates)
        .set({
          active: snapshot.active,
          inclusive: snapshot.inclusive,
        })
        .where(eq(schema.tenantStripeTaxRates.id, snapshot.id));
    }
  }
};
