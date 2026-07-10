import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { buildReceiptStorageKey } from '@server/effect/rpc/handlers/finance/receipt-media.service';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { getId } from './get-id';

export const addConsumedFinanceReceiptUpload = async (
  database: NodePgDatabase<typeof relations>,
  input: {
    eventId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    tenantId: string;
    uploadedByUserId: string;
  },
): Promise<string> => {
  const uploadId = getId();
  const now = new Date();
  await database.insert(schema.financeReceiptUploads).values({
    consumedAt: now,
    eventId: input.eventId,
    fileName: input.fileName,
    id: uploadId,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    storageKey: buildReceiptStorageKey({
      eventId: input.eventId,
      fileName: input.fileName,
      tenantId: input.tenantId,
      uploadId,
      userId: input.uploadedByUserId,
    }),
    storageUrl: 'local-unavailable://receipt',
    tenantId: input.tenantId,
    uploadedAt: now,
    uploadedByUserId: input.uploadedByUserId,
  });

  return uploadId;
};
