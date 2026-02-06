import { TRPCError } from '@trpc/server';
import { Schema } from 'effect';

import {
  cleanupTestingCloudflareImages,
  createCloudflareImageDirectUpload,
} from '../../integrations/cloudflare-images';
import { uploadReceiptOriginalToR2 } from '../../integrations/cloudflare-r2';
import { authenticatedProcedure, router } from '../trpc-server';

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_RECEIPT_ORIGINAL_SIZE_BYTES = 20 * 1024 * 1024;

const isAllowedReceiptMimeType = (mimeType: string): boolean =>
  mimeType.startsWith('image/') || mimeType === 'application/pdf';

const sanitizeFileName = (fileName: string): string =>
  fileName.trim().replaceAll(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120) || 'receipt';

export const receiptMediaRouter = router({
  cleanupTestingImages: authenticatedProcedure
    .meta({ requiredPermissions: ['admin:changeSettings'] })
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          confirmPhrase: Schema.optional(Schema.NullOr(Schema.String)),
          dryRun: Schema.Boolean,
          maxDeletes: Schema.optional(Schema.Number.pipe(Schema.nonNegative())),
        }),
      ),
    )
    .output(
      Schema.standardSchemaV1(
        Schema.Struct({
          deletedImageIds: Schema.Array(Schema.String),
          inspectedCount: Schema.Number.pipe(Schema.nonNegative()),
          matchedCount: Schema.Number.pipe(Schema.nonNegative()),
        }),
      ),
    )
    .mutation(async ({ input }) => {
      try {
        return await cleanupTestingCloudflareImages({
          confirmPhrase: input.confirmPhrase ?? null,
          dryRun: input.dryRun,
          ...(input.maxDeletes === undefined
            ? {}
            : { maxDeletes: input.maxDeletes }),
          source: 'finance-receipt',
        });
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to clean testing images',
        });
      }
    }),

  createPreviewDirectUpload: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          fileName: Schema.NonEmptyString,
          fileSizeBytes: Schema.Number.pipe(Schema.positive()),
          mimeType: Schema.NonEmptyString,
        }),
      ),
    )
    .output(
      Schema.standardSchemaV1(
        Schema.Struct({
          deliveryUrl: Schema.NonEmptyString,
          imageId: Schema.NonEmptyString,
          uploadUrl: Schema.NonEmptyString,
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.mimeType.startsWith('image/')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unsupported preview type: ${input.mimeType}`,
        });
      }

      if (input.fileSizeBytes > MAX_IMAGE_SIZE_BYTES) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Preview image exceeds ${MAX_IMAGE_SIZE_BYTES} bytes`,
        });
      }

      try {
        return await createCloudflareImageDirectUpload({
          fileName: input.fileName,
          metadata: {
            kind: 'receipt-preview',
          },
          mimeType: input.mimeType,
          source: 'finance-receipt',
          tenantId: ctx.tenant.id,
          uploadedByUserId: ctx.user.id,
        });
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to initialize preview upload',
        });
      }
    }),

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
