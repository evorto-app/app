import { TRPCError } from '@trpc/server';
import { Schema } from 'effect';

import { uploadReceiptOriginalToR2 } from '../../integrations/cloudflare-r2';
import { authenticatedProcedure, router } from '../trpc-server';

const MAX_RECEIPT_ORIGINAL_SIZE_BYTES = 20 * 1024 * 1024;

const isAllowedReceiptMimeType = (mimeType: string): boolean =>
  mimeType.startsWith('image/') || mimeType === 'application/pdf';

const sanitizeFileName = (fileName: string): string =>
  fileName.trim().replaceAll(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120) || 'receipt';

export const receiptMediaRouter = router({
  uploadOriginal: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          fileBase64: Schema.NonEmptyString,
          fileName: Schema.NonEmptyString,
          fileSizeBytes: Schema.Number.pipe(Schema.positive()),
          mimeType: Schema.NonEmptyString,
        }),
      ),
    )
    .output(
      Schema.standardSchemaV1(
        Schema.Struct({
          sizeBytes: Schema.Number.pipe(Schema.positive()),
          storageKey: Schema.NonEmptyString,
          storageUrl: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isAllowedReceiptMimeType(input.mimeType)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unsupported receipt type: ${input.mimeType}`,
        });
      }

      if (input.fileSizeBytes > MAX_RECEIPT_ORIGINAL_SIZE_BYTES) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Receipt exceeds ${MAX_RECEIPT_ORIGINAL_SIZE_BYTES} bytes`,
        });
      }

      const body = Buffer.from(input.fileBase64, 'base64');
      if (body.byteLength !== input.fileSizeBytes) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Receipt payload size mismatch',
        });
      }

      const datePrefix = new Date().toISOString().slice(0, 10);
      const safeFileName = sanitizeFileName(input.fileName);
      const storageKey = [
        'receipts',
        ctx.tenant.id,
        ctx.user.id,
        datePrefix,
        `${Date.now()}-${safeFileName}`,
      ].join('/');

      let uploaded: { storageKey: string; storageUrl: string };
      try {
        uploaded = await uploadReceiptOriginalToR2({
          body,
          contentType: input.mimeType,
          key: storageKey,
        });
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            error instanceof Error ? error.message : 'Failed to store receipt file',
        });
      }

      return {
        sizeBytes: body.byteLength,
        storageKey: uploaded.storageKey,
        storageUrl: uploaded.storageUrl,
      };
    }),
});
