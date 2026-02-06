import { TRPCError } from '@trpc/server';
import consola from 'consola';
import { Schema } from 'effect';

import { createCloudflareImageDirectUpload } from '../../integrations/cloudflare-images';
import { authenticatedProcedure, router } from '../trpc-server';

const ALLOWED_IMAGE_MIME_TYPES = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
const ALLOWED_IMAGE_MIME_TYPE_SET = new Set<string>(ALLOWED_IMAGE_MIME_TYPES);

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export const editorMediaRouter = router({
  createImageDirectUpload: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          fileName: Schema.NonEmptyString,
          fileSizeBytes: Schema.Number.pipe(Schema.nonNegative()),
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
      if (!ALLOWED_IMAGE_MIME_TYPE_SET.has(input.mimeType)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unsupported file type: ${input.mimeType}`,
        });
      }

      if (
        input.fileSizeBytes <= 0 ||
        input.fileSizeBytes > MAX_IMAGE_SIZE_BYTES
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `File size must be between 1 byte and ${MAX_IMAGE_SIZE_BYTES} bytes`,
        });
      }

      try {
        return await createCloudflareImageDirectUpload({
          fileName: input.fileName,
          mimeType: input.mimeType,
          source: 'editor',
          tenantId: ctx.tenant.id,
          uploadedByUserId: ctx.user.id,
        });
      } catch (error) {
        consola.error('editor-media.cloudflare.direct-upload-failed', {
          error,
          tenantId: ctx.tenant.id,
          userId: ctx.user.id,
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Image upload initialization failed. Please try again.',
        });
      }
    }),
});
