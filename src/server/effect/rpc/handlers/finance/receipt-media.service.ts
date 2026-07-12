import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { Context, Effect, Layer } from 'effect';

import {
  getSignedReceiptObjectUrlFromR2,
  receiptObjectExistsInR2,
  uploadReceiptOriginalToR2,
} from '../../../../integrations/cloudflare-r2';
import {
  ReceiptMediaBadRequestError,
  ReceiptMediaServiceUnavailableError,
} from './finance.errors';

const MAX_RECEIPT_ORIGINAL_SIZE_BYTES = 20 * 1024 * 1024;
const RECEIPT_PREVIEW_SIGNED_URL_TTL_SECONDS = 60 * 15;

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

interface AvailableReceiptEvidence extends ValidReceiptEvidenceBinding {
  signedPreviewUrl: string;
}

interface ReceiptWithValidStoragePreview extends ReceiptWithStoragePreview {
  attachmentStorageKey: string;
  attachmentStorageUrl: string;
  attachmentUploadConsumedAt: Date;
  attachmentUploadedAt: Date;
}

interface ValidReceiptEvidenceBinding {
  attachmentUploadId: string;
  storageKey: string;
}

const isAllowedReceiptMimeType = (mimeType: string): boolean =>
  mimeType.startsWith('image/') || mimeType === 'application/pdf';

const sanitizeFileName = (fileName: string): string =>
  fileName
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 120) || 'receipt';

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
    `${receipt.attachmentUploadId}-`,
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

const validReceiptEvidenceBinding = (
  receipt: ReceiptWithStoragePreview,
): null | ValidReceiptEvidenceBinding =>
  hasValidReceiptUploadBinding(receipt)
    ? {
        attachmentUploadId: receipt.attachmentUploadId,
        storageKey: receipt.attachmentStorageKey,
      }
    : null;

const logReceiptEvidenceFailure = (
  message: string,
  receipt: ReceiptWithStoragePreview,
  error?: unknown,
) =>
  Effect.logWarning(message).pipe(
    Effect.annotateLogs({
      attachmentUploadId: receipt.attachmentUploadId,
      ...(error !== undefined && {
        error: error instanceof Error ? error.message : String(error),
      }),
      eventId: receipt.eventId,
      submittedByUserId: receipt.submittedByUserId,
      tenantId: receipt.tenantId,
    }),
  );

const verifyBoundReceiptEvidence = Effect.fn(
  'ReceiptMedia.verifyBoundReceiptEvidence',
)(function* (
  receipt: ReceiptWithStoragePreview,
  binding: ValidReceiptEvidenceBinding,
) {
  const receiptMedia = yield* ReceiptMediaService;
  const exists = yield* receiptMedia
    .objectExists({ storageKey: binding.storageKey })
    .pipe(
      Effect.tapError((error) =>
        logReceiptEvidenceFailure(
          'Receipt evidence availability check failed',
          receipt,
          error,
        ),
      ),
      Effect.orElseSucceed(() => false),
    );
  if (!exists) {
    return null;
  }

  const signedPreviewUrl = yield* receiptMedia
    .signedPreviewUrl({
      expiresInSeconds: RECEIPT_PREVIEW_SIGNED_URL_TTL_SECONDS,
      storageKey: binding.storageKey,
    })
    .pipe(
      Effect.tapError((error) =>
        logReceiptEvidenceFailure(
          'Failed to sign receipt preview URL',
          receipt,
          error,
        ),
      ),
      Effect.orElseSucceed(() => null),
    );
  if (signedPreviewUrl === null) {
    return null;
  }

  return {
    ...binding,
    signedPreviewUrl,
  } satisfies AvailableReceiptEvidence;
});

export const ensureReceiptEvidenceAvailableForApproval = Effect.fn(
  'ReceiptMedia.ensureReceiptEvidenceAvailableForApproval',
)(function* (receipt: ReceiptWithStoragePreview) {
  const binding = validReceiptEvidenceBinding(receipt);
  if (!binding) {
    yield* logReceiptEvidenceFailure(
      'Refusing receipt approval with an invalid upload binding',
      receipt,
    );
    return yield* new RpcBadRequestError({
      message:
        'Receipt evidence is unavailable or does not match this submission',
      reason: 'receiptEvidenceUnavailable',
    });
  }

  const evidence = yield* verifyBoundReceiptEvidence(receipt, binding);
  if (!evidence) {
    return yield* new RpcBadRequestError({
      message: 'Receipt evidence is unavailable and cannot be approved',
      reason: 'receiptEvidenceUnavailable',
    });
  }

  return binding;
});

export const withSignedReceiptPreviewUrl = <
  T extends ReceiptWithStoragePreview,
>(
  receipt: T,
) =>
  Effect.gen(function* () {
    const binding = validReceiptEvidenceBinding(receipt);
    if (!binding) {
      yield* logReceiptEvidenceFailure(
        'Refusing to sign receipt preview with an invalid upload binding',
        receipt,
      );

      return {
        ...receipt,
        attachmentStorageKey: null,
        previewImageUrl: null,
        receiptEvidenceAvailable: false,
      };
    }

    const evidence = yield* verifyBoundReceiptEvidence(receipt, binding);
    if (!evidence) {
      return {
        ...receipt,
        previewImageUrl: null,
        receiptEvidenceAvailable: false,
      };
    }

    return {
      ...receipt,
      previewImageUrl: evidence.signedPreviewUrl,
      receiptEvidenceAvailable: true,
    };
  });

export const withSignedReceiptPreviewUrls = <
  T extends ReceiptWithStoragePreview,
>(
  receipts: readonly T[],
) =>
  Effect.forEach(receipts, (receipt) => withSignedReceiptPreviewUrl(receipt), {
    concurrency: 8,
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
      const objectExists = Effect.fn('ReceiptMediaService.objectExists')(
        function* ({ storageKey }: { storageKey: string }) {
          return yield* receiptObjectExistsInR2({ key: storageKey }).pipe(
            Effect.mapError(
              (cause) =>
                new ReceiptMediaServiceUnavailableError({
                  cause,
                  message: 'Receipt storage is unavailable',
                }),
            ),
          );
        },
      );

      const signedPreviewUrl = Effect.fn(
        'ReceiptMediaService.signedPreviewUrl',
      )(function* ({
        expiresInSeconds,
        storageKey,
      }: {
        expiresInSeconds: number;
        storageKey: string;
      }) {
        return yield* getSignedReceiptObjectUrlFromR2({
          expiresInSeconds,
          key: storageKey,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ReceiptMediaServiceUnavailableError({
                cause,
                message: 'Receipt storage is unavailable',
              }),
          ),
        );
      });

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
              (cause) =>
                new ReceiptMediaServiceUnavailableError({
                  cause,
                  message: 'Receipt storage is unavailable',
                }),
            ),
          );
          const exists = yield* objectExists({ storageKey });
          if (!exists) {
            return yield* new ReceiptMediaServiceUnavailableError({
              message: 'Receipt upload could not be verified',
            });
          }

          return {
            sizeBytes: body.byteLength,
            storageKey: uploaded.storageKey,
            storageUrl: uploaded.storageUrl,
          };
        },
      );

      return {
        objectExists,
        signedPreviewUrl,
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
