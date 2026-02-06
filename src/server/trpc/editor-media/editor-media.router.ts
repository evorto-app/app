import { TRPCError } from '@trpc/server';
import { Either, Schema } from 'effect';

import { authenticatedProcedure, router } from '../trpc-server';

const ALLOWED_IMAGE_MIME_TYPES = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
const ALLOWED_IMAGE_MIME_TYPE_SET = new Set<string>(ALLOWED_IMAGE_MIME_TYPES);

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_IMAGE_VARIANT = 'public';

const cloudflareUploadResponseSchema = Schema.Struct({
  errors: Schema.Array(
    Schema.Struct({
      message: Schema.NonEmptyString,
    }),
  ),
  result: Schema.optional(
    Schema.Struct({
      id: Schema.NonEmptyString,
      uploadURL: Schema.NonEmptyString,
    }),
  ),
  success: Schema.Boolean,
});

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

      if (input.fileSizeBytes <= 0 || input.fileSizeBytes > MAX_IMAGE_SIZE_BYTES) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `File size must be between 1 byte and ${MAX_IMAGE_SIZE_BYTES} bytes`,
        });
      }

      const apiToken =
        process.env['CLOUDFLARE_IMAGES_API_TOKEN'] ??
        process.env['CLOUDFLARE_TOKEN'];
      const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
      const deliveryHash = process.env['CLOUDFLARE_IMAGES_DELIVERY_HASH'];
      const variant =
        process.env['CLOUDFLARE_IMAGES_VARIANT'] ?? DEFAULT_IMAGE_VARIANT;

      if (!apiToken || !accountId || !deliveryHash) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Cloudflare Images is not configured',
        });
      }

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v2/direct_upload`,
        {
          body: JSON.stringify({
            metadata: {
              fileName: input.fileName,
              mimeType: input.mimeType,
              tenantId: ctx.tenant.id,
              uploadedByUserId: ctx.user.id,
            },
            requireSignedURLs: false,
          }),
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      );

      const responseBody = (await response.json()) as unknown;
      const decoded = Schema.decodeUnknownEither(cloudflareUploadResponseSchema)(
        responseBody,
      );

      if (Either.isLeft(decoded)) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to parse Cloudflare upload response',
        });
      }

      const payload = decoded.right;
      if (!response.ok || !payload.success || !payload.result) {
        const cloudflareMessage = payload.errors.map((error) => error.message).join(', ');
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: cloudflareMessage || 'Cloudflare direct upload URL request failed',
        });
      }

      return {
        deliveryUrl: `https://imagedelivery.net/${deliveryHash}/${payload.result.id}/${variant}`,
        imageId: payload.result.id,
        uploadUrl: payload.result.uploadURL,
      };
    }),
});
