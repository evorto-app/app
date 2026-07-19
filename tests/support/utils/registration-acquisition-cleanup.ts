import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { and, eq, inArray } from 'drizzle-orm';

import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';

type TestDatabase = NodePgDatabase<typeof relations>;

export const deleteRegistrationAcquisitionLedger = async ({
  database,
  registrationIds,
  tenantId,
}: {
  database: TestDatabase;
  registrationIds: readonly string[];
  tenantId: string;
}): Promise<void> => {
  if (registrationIds.length === 0) {
    return;
  }

  const ids = [...registrationIds];
  const acquisitions = await database
    .select({ id: schema.registrationAcquisitions.id })
    .from(schema.registrationAcquisitions)
    .where(
      and(
        inArray(schema.registrationAcquisitions.registrationId, ids),
        eq(schema.registrationAcquisitions.tenantId, tenantId),
      ),
    );
  const acquisitionIds = acquisitions.map((acquisition) => acquisition.id);

  await database
    .delete(schema.registrationAcquisitionRefundAllocations)
    .where(
      and(
        inArray(
          schema.registrationAcquisitionRefundAllocations.registrationId,
          ids,
        ),
        eq(schema.registrationAcquisitionRefundAllocations.tenantId, tenantId),
      ),
    );
  if (acquisitionIds.length > 0) {
    await database
      .delete(schema.registrationTransferRefundPlanAcquisitionLinks)
      .where(
        and(
          inArray(
            schema.registrationTransferRefundPlanAcquisitionLinks
              .sourceAcquisitionId,
            acquisitionIds,
          ),
          eq(
            schema.registrationTransferRefundPlanAcquisitionLinks.tenantId,
            tenantId,
          ),
        ),
      );
  }
  await database
    .delete(schema.registrationAcquisitionComponents)
    .where(
      and(
        inArray(schema.registrationAcquisitionComponents.registrationId, ids),
        eq(schema.registrationAcquisitionComponents.tenantId, tenantId),
      ),
    );
  await database
    .delete(schema.registrationAcquisitionPayments)
    .where(
      and(
        inArray(schema.registrationAcquisitionPayments.registrationId, ids),
        eq(schema.registrationAcquisitionPayments.tenantId, tenantId),
      ),
    );
  await database
    .delete(schema.registrationAcquisitions)
    .where(
      and(
        inArray(schema.registrationAcquisitions.registrationId, ids),
        eq(schema.registrationAcquisitions.tenantId, tenantId),
      ),
    );
};
