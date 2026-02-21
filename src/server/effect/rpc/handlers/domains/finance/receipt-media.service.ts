import { Effect } from 'effect';

import { serverEnvironment } from '../../../../../config/environment';
import {
  getSignedReceiptObjectUrlFromR2,
  uploadReceiptOriginalToR2,
} from '../../../../../integrations/cloudflare-r2';
import {
  ReceiptMediaBadRequestError,
  ReceiptMediaInternalError,
} from './finance.errors';

const MAX_RECEIPT_ORIGINAL_SIZE_BYTES = 20 * 1024 * 1024;
const RECEIPT_PREVIEW_SIGNED_URL_TTL_SECONDS = 60 * 15;
const LOCAL_RECEIPT_STORAGE_KEY_PREFIX = 'local-unavailable/';

export interface ReceiptWithStoragePreview {
  attachmentStorageKey: null | string;
  previewImageUrl: null | string;
}

const isAllowedReceiptMimeType = (mimeType: string): boolean =>
  mimeType.startsWith('image/') || mimeType === 'application/pdf';

const sanitizeFileName = (fileName: string): string =>
  fileName
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 120) || 'receipt';

const isCloudflareR2Configured = () =>
  Boolean(
    serverEnvironment.CLOUDFLARE_R2_BUCKET &&
      serverEnvironment.CLOUDFLARE_R2_S3_ENDPOINT &&
      serverEnvironment.CLOUDFLARE_R2_S3_KEY &&
      serverEnvironment.CLOUDFLARE_R2_S3_KEY_ID,
  );

export const withSignedReceiptPreviewUrl = <T extends ReceiptWithStoragePreview>(
  receipt: T,
): Effect.Effect<T> =>
  Effect.gen(function* () {
    if (
      !receipt.attachmentStorageKey ||
      receipt.attachmentStorageKey.startsWith(LOCAL_RECEIPT_STORAGE_KEY_PREFIX)
    ) {
      return {
        ...receipt,
        previewImageUrl: null,
      } as T;
    }

    const receiptStorageKey = receipt.attachmentStorageKey as string;
    const signedPreviewUrl = yield* Effect.tryPromise({
      catch: () =>
        new ReceiptMediaInternalError({
          message: 'Failed to sign receipt preview URL',
        }),
      try: () =>
        getSignedReceiptObjectUrlFromR2({
          expiresInSeconds: RECEIPT_PREVIEW_SIGNED_URL_TTL_SECONDS,
          key: receiptStorageKey,
        }),
    }).pipe(Effect.orElseSucceed(() => null));

    return {
      ...receipt,
      previewImageUrl: signedPreviewUrl,
    } as T;
  });

export const withSignedReceiptPreviewUrls = <T extends ReceiptWithStoragePreview>(
  receipts: readonly T[],
): Effect.Effect<readonly T[]> =>
  Effect.forEach(receipts, (receipt) => withSignedReceiptPreviewUrl(receipt), {
    concurrency: 'unbounded',
  });

export class ReceiptMediaService extends Effect.Service<ReceiptMediaService>()(
  '@server/effect/rpc/handlers/domains/finance/ReceiptMediaService',
  {
    accessors: true,
    effect: Effect.sync(() => {
      const uploadOriginal = Effect.fn('ReceiptMediaService.uploadOriginal')(
        function* ({
          fileBase64,
          fileName,
          fileSizeBytes,
          mimeType,
          tenantId,
          userId,
        }: {
          fileBase64: string;
          fileName: string;
          fileSizeBytes: number;
          mimeType: string;
          tenantId: string;
          userId: string;
        }) {
          if (!isAllowedReceiptMimeType(mimeType)) {
            return yield* Effect.fail(
              new ReceiptMediaBadRequestError({
                message: 'Unsupported MIME type',
              }),
            );
          }

          const body = Buffer.from(fileBase64, 'base64');
          if (body.byteLength !== fileSizeBytes) {
            return yield* Effect.fail(
              new ReceiptMediaBadRequestError({
                message: 'Uploaded file size does not match payload metadata',
              }),
            );
          }
          if (body.byteLength > MAX_RECEIPT_ORIGINAL_SIZE_BYTES) {
            return yield* Effect.fail(
              new ReceiptMediaBadRequestError({
                message: 'File exceeds size limit',
              }),
            );
          }

          const datePrefix = new Date().toISOString().slice(0, 10);
          const safeFileName = sanitizeFileName(fileName);
          const storageKey = [
            'receipts',
            tenantId,
            userId,
            datePrefix,
            `${Date.now()}-${safeFileName}`,
          ].join('/');

          const uploaded = yield* Effect.tryPromise({
            catch: () =>
              new ReceiptMediaInternalError({ message: 'Failed to upload file' }),
            try: () =>
              uploadReceiptOriginalToR2({
                body,
                contentType: mimeType,
                key: storageKey,
              }),
          }).pipe(
            Effect.catchAll((error) =>
              isCloudflareR2Configured()
                ? Effect.fail(error)
                : Effect.succeed({
                    storageKey: `${LOCAL_RECEIPT_STORAGE_KEY_PREFIX}${storageKey}`,
                    storageUrl: 'local-unavailable://receipt',
                  }),
            ),
          );

          return {
            sizeBytes: body.byteLength,
            storageKey: uploaded.storageKey,
            storageUrl: uploaded.storageUrl,
          };
        },
      );

      return {
        uploadOriginal,
      };
    }),
  },
) {}
