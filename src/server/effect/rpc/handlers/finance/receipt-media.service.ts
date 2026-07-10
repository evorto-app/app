import { formatConfigError } from '@server/config/config-error';
import { objectStorageConfig } from '@server/config/object-storage-config';
import { Context, Effect, Layer } from 'effect';

import {
  getSignedReceiptObjectUrlFromR2,
  uploadReceiptOriginalToR2,
} from '../../../../integrations/cloudflare-r2';
import {
  ReceiptMediaBadRequestError,
  ReceiptMediaInternalError,
} from './finance.errors';

const MAX_RECEIPT_ORIGINAL_SIZE_BYTES = 20 * 1024 * 1024;
const RECEIPT_PREVIEW_SIGNED_URL_TTL_SECONDS = 60 * 15;
const LOCAL_RECEIPT_STORAGE_URL_PREFIX = 'local-unavailable://';

export interface ReceiptWithStoragePreview {
  attachmentStorageKey: null | string;
  attachmentStorageUrl: null | string;
  attachmentUploadConsumedAt: Date | null;
  attachmentUploadedAt: Date | null;
  attachmentUploadedByUserId: string;
  attachmentUploadEventId: string;
  attachmentUploadId: string;
  attachmentUploadTenantId: string;
  eventId: string;
  previewImageUrl: null | string;
  submittedByUserId: string;
  tenantId: string;
}

interface ReceiptWithValidStoragePreview extends ReceiptWithStoragePreview {
  attachmentStorageKey: string;
  attachmentStorageUrl: string;
  attachmentUploadConsumedAt: Date;
  attachmentUploadedAt: Date;
}

const isAllowedReceiptMimeType = (mimeType: string): boolean =>
  mimeType.startsWith('image/') || mimeType === 'application/pdf';

const sanitizeFileName = (fileName: string): string =>
  fileName
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 120) || 'receipt';

const isObjectStorageConfigured = objectStorageConfig.pipe(
  Effect.as(true),
  // False positive: this is Effect error-channel handling, not a Promise chain.
  // eslint-disable-next-line unicorn/prefer-top-level-await
  Effect.catch((error) =>
    Effect.logWarning('Object storage configuration unavailable').pipe(
      Effect.annotateLogs({
        error: formatConfigError(error),
      }),
      Effect.as(false),
    ),
  ),
);

export const hasValidReceiptUploadBinding = (
  receipt: ReceiptWithStoragePreview,
): receipt is ReceiptWithValidStoragePreview => {
  if (!receipt.attachmentStorageKey) {
    return false;
  }

  const expectedStoragePrefix = [
    'receipts',
    receipt.tenantId,
    receipt.eventId,
    receipt.submittedByUserId,
    '',
  ].join('/');
  return (
    receipt.attachmentUploadTenantId === receipt.tenantId &&
    receipt.attachmentUploadEventId === receipt.eventId &&
    receipt.attachmentUploadedByUserId === receipt.submittedByUserId &&
    receipt.attachmentUploadedAt !== null &&
    receipt.attachmentUploadConsumedAt !== null &&
    receipt.attachmentStorageUrl !== null &&
    receipt.attachmentStorageKey.startsWith(expectedStoragePrefix) &&
    receipt.attachmentStorageKey.length > expectedStoragePrefix.length
  );
};

export const withSignedReceiptPreviewUrl = <
  T extends ReceiptWithStoragePreview,
>(
  receipt: T,
) =>
  Effect.gen(function* () {
    if (!hasValidReceiptUploadBinding(receipt)) {
      yield* Effect.logWarning(
        'Refusing to sign receipt preview with an invalid upload binding',
      ).pipe(
        Effect.annotateLogs({
          attachmentUploadId: receipt.attachmentUploadId,
          eventId: receipt.eventId,
          submittedByUserId: receipt.submittedByUserId,
          tenantId: receipt.tenantId,
        }),
      );

      return {
        ...receipt,
        attachmentStorageKey: null,
        previewImageUrl: null,
      };
    }

    const receiptStorageKey = receipt.attachmentStorageKey;
    if (
      receipt.attachmentStorageUrl.startsWith(LOCAL_RECEIPT_STORAGE_URL_PREFIX)
    ) {
      return {
        ...receipt,
        previewImageUrl: null,
      };
    }

    const signedPreviewUrl = yield* getSignedReceiptObjectUrlFromR2({
      expiresInSeconds: RECEIPT_PREVIEW_SIGNED_URL_TTL_SECONDS,
      key: receiptStorageKey,
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning('Failed to sign receipt preview URL').pipe(
          Effect.annotateLogs({
            error: error instanceof Error ? error.message : String(error),
            receiptStorageKey,
          }),
        ),
      ),
      Effect.orElseSucceed(() => null),
    );

    return {
      ...receipt,
      previewImageUrl: signedPreviewUrl,
    };
  });

export const withSignedReceiptPreviewUrls = <
  T extends ReceiptWithStoragePreview,
>(
  receipts: readonly T[],
) =>
  Effect.forEach(receipts, (receipt) => withSignedReceiptPreviewUrl(receipt), {
    concurrency: 'unbounded',
  });

interface UploadOriginalInput {
  eventId: string;
  fileBase64: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  tenantId: string;
  uploadId: string;
  userId: string;
}

export const buildReceiptStorageKey = ({
  eventId,
  fileName,
  tenantId,
  uploadId,
  userId,
}: Pick<
  UploadOriginalInput,
  'eventId' | 'fileName' | 'tenantId' | 'uploadId' | 'userId'
>): string =>
  [
    'receipts',
    tenantId,
    eventId,
    userId,
    `${uploadId}-${sanitizeFileName(fileName)}`,
  ].join('/');

export class ReceiptMediaService extends Context.Service<ReceiptMediaService>()(
  '@server/effect/rpc/handlers/finance/ReceiptMediaService',
  {
    make: Effect.sync(() => {
      const uploadOriginal = Effect.fn('ReceiptMediaService.uploadOriginal')(
        function* ({
          eventId,
          fileBase64,
          fileName,
          fileSizeBytes,
          mimeType,
          tenantId,
          uploadId,
          userId,
        }: UploadOriginalInput) {
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

          const storageKey = buildReceiptStorageKey({
            eventId,
            fileName,
            tenantId,
            uploadId,
            userId,
          });

          const uploaded = yield* uploadReceiptOriginalToR2({
            body,
            contentType: mimeType,
            key: storageKey,
          }).pipe(
            Effect.mapError(
              () =>
                new ReceiptMediaInternalError({
                  message: 'Failed to upload file',
                }),
            ),
            Effect.catch((error) =>
              isObjectStorageConfigured.pipe(
                Effect.flatMap((configured) =>
                  configured
                    ? Effect.fail(error)
                    : Effect.succeed({
                        storageKey,
                        storageUrl: 'local-unavailable://receipt',
                      }),
                ),
              ),
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
) {
  static readonly Default = Layer.effect(
    ReceiptMediaService,
    ReceiptMediaService.make,
  );

  static readonly uploadOriginal = (input: UploadOriginalInput) =>
    ReceiptMediaService.use((service) => service.uploadOriginal(input));
}
