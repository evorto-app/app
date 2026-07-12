import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { buildReceiptStorageKey } from '@server/effect/rpc/handlers/finance/receipt-media.service';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { getId } from './get-id';

const execFileAsync = promisify(execFile);
const localReceiptUploadScript = path.resolve(
  'helpers/testing/upload-local-receipt-object.ts',
);

export const addAvailableConsumedFinanceReceiptUpload = async (
  database: NodePgDatabase<typeof relations>,
  input: {
    eventId: string;
    fileName: string;
    mimeType: string;
    sourceFilePath: string;
    tenantId: string;
    uploadedByUserId: string;
  },
): Promise<{ id: string; sizeBytes: number; storageKey: string }> => {
  const uploadId = getId();
  const storageKey = buildReceiptStorageKey({
    eventId: input.eventId,
    fileName: input.fileName,
    tenantId: input.tenantId,
    uploadId,
    userId: input.uploadedByUserId,
  });
  const source = await stat(input.sourceFilePath);
  if (!source.isFile() || source.size <= 0) {
    throw new Error('Receipt fixture source must be a non-empty file');
  }

  await execFileAsync(
    'bun',
    [
      localReceiptUploadScript,
      input.sourceFilePath,
      storageKey,
      input.mimeType,
    ],
    {
      env: process.env,
      timeout: 30_000,
    },
  );

  const now = new Date();
  const bucket = process.env['S3_BUCKET'] || 'evorto-testing';
  await database.insert(schema.financeReceiptUploads).values({
    consumedAt: now,
    eventId: input.eventId,
    fileName: input.fileName,
    id: uploadId,
    mimeType: input.mimeType,
    sizeBytes: source.size,
    storageKey,
    storageUrl: `http://minio:9000/${bucket}/${storageKey}`,
    tenantId: input.tenantId,
    uploadedAt: now,
    uploadedByUserId: input.uploadedByUserId,
  });

  return { id: uploadId, sizeBytes: source.size, storageKey };
};

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
