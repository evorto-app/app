import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import {
  isAllowedReceiptMimeType,
  maximumReceiptOriginalSizeBytes,
  validateReceiptFileMetadata,
} from '@shared/finance/receipt-media';
import { Context, Effect, Layer } from 'effect';
import { createHash } from 'node:crypto';

import { ObjectStorage } from '../../../../integrations/object-storage';
import { safeServerErrorSummary } from '../../../../utils/safe-server-error-summary';
import {
  ReceiptMediaBadRequestError,
  ReceiptMediaServiceUnavailableError,
} from './finance.errors';

const RECEIPT_PREVIEW_SIGNED_URL_TTL_SECONDS = 60 * 15;

export interface ReceiptWithStoragePreview {
  attachmentStorageKey: null | string;
  attachmentUploadConsumedAt: Date | null;
  attachmentUploadedAt: Date | null;
  attachmentUploadedByUserId: string;
  attachmentUploadEventId: string;
  attachmentUploadId: string;
  attachmentUploadStatus:
    'cleaning' | 'consumed' | 'finalizing' | 'pending' | 'ready' | 'rejected';
  attachmentUploadTenantId: string;
  eventId: string;
  submittedByUserId: string;
  tenantId: string;
}

interface AvailableReceiptEvidence extends ValidReceiptEvidenceBinding {
  signedPreviewUrl: string;
}

interface ReceiptWithValidStoragePreview extends ReceiptWithStoragePreview {
  attachmentStorageKey: string;
  attachmentUploadConsumedAt: Date;
  attachmentUploadedAt: Date;
}

interface ValidReceiptEvidenceBinding {
  attachmentUploadId: string;
  storageKey: string;
}

export const validateReceiptUploadMetadata = (input: {
  mimeType: string;
  sizeBytes: number;
}) =>
  Effect.gen(function* () {
    const validationError = validateReceiptFileMetadata(input);
    if (validationError) {
      return yield* Effect.fail(
        new ReceiptMediaBadRequestError({
          message: validationError,
        }),
      );
    }
  });

const startsWithBytes = (input: Uint8Array, expected: readonly number[]) =>
  expected.every((value, index) => input[index] === value);

export const detectReceiptMimeType = (
  prefix: Uint8Array,
):
  'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | undefined => {
  if (startsWithBytes(prefix, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (
    startsWithBytes(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return 'image/png';
  }
  if (
    startsWithBytes(prefix, [0x52, 0x49, 0x46, 0x46]) &&
    startsWithBytes(prefix.slice(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return 'image/webp';
  }
  if (startsWithBytes(prefix, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return 'application/pdf';
  }
  return;
};

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
    receipt.attachmentUploadStatus === 'consumed' &&
    receipt.attachmentUploadedAt !== null &&
    receipt.attachmentUploadConsumedAt !== null &&
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
) =>
  Effect.logWarning(message).pipe(
    Effect.annotateLogs({
      attachmentUploadId: receipt.attachmentUploadId,
      eventId: receipt.eventId,
      submittedByUserId: receipt.submittedByUserId,
      tenantId: receipt.tenantId,
    }),
  );

const logReceiptStorageFailure = (operation: string, error: unknown) =>
  Effect.logError('Receipt storage operation failed').pipe(
    Effect.annotateLogs(safeServerErrorSummary(operation, error)),
  );

const receiptMediaServiceUnavailable = () =>
  new ReceiptMediaServiceUnavailableError({
    message:
      'Receipt files could not be opened or saved. No receipt was added or changed. Try opening or saving the receipt once more; if it fails again, contact Evorto support.',
  });

const verifyBoundReceiptEvidence = Effect.fn(
  'ReceiptMedia.verifyBoundReceiptEvidence',
)(function* (binding: ValidReceiptEvidenceBinding) {
  const receiptMedia = yield* ReceiptMediaService;
  const exists = yield* receiptMedia.objectExists({
    storageKey: binding.storageKey,
  });
  if (!exists) {
    return null;
  }

  return binding;
});

const signBoundReceiptPreview = Effect.fn(
  'ReceiptMedia.signBoundReceiptPreview',
)(function* (binding: ValidReceiptEvidenceBinding) {
  const verifiedBinding = yield* verifyBoundReceiptEvidence(binding);
  if (!verifiedBinding) {
    return null;
  }

  const receiptMedia = yield* ReceiptMediaService;
  const signedPreviewUrl = yield* receiptMedia.signedPreviewUrl({
    expiresInSeconds: RECEIPT_PREVIEW_SIGNED_URL_TTL_SECONDS,
    storageKey: verifiedBinding.storageKey,
  });

  return {
    ...verifiedBinding,
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
        'The receipt file is no longer available. Ask the person who submitted it to add it again.',
      reason: 'receiptEvidenceUnavailable',
    });
  }

  const evidence = yield* verifyBoundReceiptEvidence(binding);
  if (!evidence) {
    return yield* new RpcBadRequestError({
      message:
        'The receipt file is no longer available. Ask the person who submitted it to add it again.',
      reason: 'receiptEvidenceUnavailable',
    });
  }

  return binding;
});

export const withoutSignedReceiptPreviewUrl = <
  T extends ReceiptWithStoragePreview,
>(
  receipt: T,
) =>
  hasValidReceiptUploadBinding(receipt)
    ? {
        ...receipt,
        previewImageUrl: null,
      }
    : {
        ...receipt,
        attachmentStorageKey: null,
        previewImageUrl: null,
      };

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

    const evidence = yield* signBoundReceiptPreview(binding);
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

interface CreateUploadPolicyInput extends ReceiptUploadScope {
  expiresAt: Date;
  now: Date;
  sizeBytes: number;
}

interface FinalReceiptStorageScope extends ReceiptUploadScope {
  contentDigest: string;
}

interface InspectUploadInput extends ReceiptUploadScope {
  sizeBytes: number;
  storageKey: string;
}

interface ReceiptUploadScope {
  eventId: string;
  fileName: string;
  mimeType: string;
  tenantId: string;
  uploadId: string;
  userId: string;
}

export const buildReceiptUploadStorageKey = ({
  eventId,
  fileName,
  tenantId,
  uploadId,
  userId,
}: Pick<
  ReceiptUploadScope,
  'eventId' | 'fileName' | 'tenantId' | 'uploadId' | 'userId'
>): string =>
  [
    'receipt-uploads',
    tenantId,
    eventId,
    userId,
    `${uploadId}-${sanitizeFileName(fileName)}`,
  ].join('/');

export const buildReceiptStorageKey = ({
  contentDigest,
  eventId,
  fileName,
  tenantId,
  uploadId,
  userId,
}: Pick<
  FinalReceiptStorageScope,
  'contentDigest' | 'eventId' | 'fileName' | 'tenantId' | 'uploadId' | 'userId'
>): string => {
  if (!/^[0-9a-f]{64}$/u.test(contentDigest)) {
    throw new Error('Receipt content digest must be a lowercase SHA-256 hash');
  }

  return [
    'receipts',
    tenantId,
    eventId,
    userId,
    `${uploadId}-${contentDigest}-${sanitizeFileName(fileName)}`,
  ].join('/');
};

export class ReceiptMediaService extends Context.Service<ReceiptMediaService>()(
  '@server/effect/rpc/handlers/finance/ReceiptMediaService',
  {
    make: Effect.gen(function* () {
      const objectStorage = yield* ObjectStorage;
      const objectExists = Effect.fn('ReceiptMediaService.objectExists')(
        function* ({ storageKey }: { storageKey: string }) {
          return yield* objectStorage.exists(storageKey).pipe(
            Effect.tapError((error) =>
              logReceiptStorageFailure('receiptMedia.objectExists', error),
            ),
            Effect.mapError(receiptMediaServiceUnavailable),
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
        return yield* objectStorage
          .presignGet(storageKey, expiresInSeconds)
          .pipe(
            Effect.tapError((error) =>
              logReceiptStorageFailure('receiptMedia.signedPreviewUrl', error),
            ),
            Effect.mapError(receiptMediaServiceUnavailable),
          );
      });

      const createUploadPolicy = Effect.fn(
        'ReceiptMediaService.createUploadPolicy',
      )(function* (input: CreateUploadPolicyInput) {
        yield* validateReceiptUploadMetadata(input);
        if (input.expiresAt.getTime() <= input.now.getTime()) {
          return yield* Effect.fail(
            new ReceiptMediaBadRequestError({
              message:
                'This receipt file was not saved in time. Add the file again.',
            }),
          );
        }

        const storageKey = buildReceiptUploadStorageKey(input);
        const signed = yield* objectStorage
          .presignPost({
            contentType: input.mimeType,
            expiresAt: input.expiresAt,
            key: storageKey,
            now: input.now,
            sizeBytes: input.sizeBytes,
          })
          .pipe(
            Effect.tapError((error) =>
              logReceiptStorageFailure(
                'receiptMedia.createUploadPolicy',
                error,
              ),
            ),
            Effect.mapError(receiptMediaServiceUnavailable),
          );

        return { ...signed, storageKey };
      });

      const discardPromotedUpload = Effect.fn(
        'ReceiptMediaService.discardPromotedUpload',
      )(function* (storageKey: string) {
        yield* objectStorage.deleteObject(storageKey).pipe(
          Effect.tapError((error) =>
            logReceiptStorageFailure(
              'receiptMedia.discardPromotedUpload',
              error,
            ),
          ),
          Effect.mapError(receiptMediaServiceUnavailable),
        );
      });

      const inspectUpload = Effect.fn('ReceiptMediaService.inspectUpload')(
        function* (input: InspectUploadInput) {
          if (!isAllowedReceiptMimeType(input.mimeType)) {
            return yield* Effect.fail(
              new ReceiptMediaBadRequestError({
                message:
                  'This file cannot be used as a receipt. Choose another file.',
              }),
            );
          }

          const expectedStorageKey = buildReceiptUploadStorageKey(input);
          if (input.storageKey !== expectedStorageKey) {
            return yield* Effect.fail(
              new ReceiptMediaBadRequestError({
                message:
                  'This receipt file no longer belongs to this receipt. Add the file again.',
              }),
            );
          }

          const body = yield* objectStorage.get(input.storageKey).pipe(
            Effect.tapError((error) =>
              logReceiptStorageFailure('receiptMedia.inspectUpload.get', error),
            ),
            Effect.mapError(receiptMediaServiceUnavailable),
          );
          const detectedMimeType = detectReceiptMimeType(body.slice(0, 16));
          if (
            body.byteLength !== input.sizeBytes ||
            body.byteLength <= 0 ||
            body.byteLength > maximumReceiptOriginalSizeBytes
          ) {
            return yield* Effect.fail(
              new ReceiptMediaBadRequestError({
                message:
                  'This receipt file no longer matches the selected file. Add the file again.',
              }),
            );
          }
          if (detectedMimeType !== input.mimeType) {
            return yield* Effect.fail(
              new ReceiptMediaBadRequestError({
                message:
                  'This file cannot be used as a receipt. Choose another file.',
              }),
            );
          }

          const storageKey = buildReceiptStorageKey({
            ...input,
            contentDigest: createHash('sha256').update(body).digest('hex'),
          });
          const stored = yield* objectStorage
            .put({
              body,
              contentType: detectedMimeType,
              key: storageKey,
            })
            .pipe(
              Effect.tapError((error) =>
                logReceiptStorageFailure(
                  'receiptMedia.inspectUpload.put',
                  error,
                ),
              ),
              Effect.mapError(receiptMediaServiceUnavailable),
            );

          return {
            mimeType: detectedMimeType,
            sizeBytes: body.byteLength,
            storageKey: stored.storageKey,
          };
        },
      );

      return {
        createUploadPolicy,
        discardPromotedUpload,
        inspectUpload,
        objectExists,
        signedPreviewUrl,
      };
    }),
  },
) {
  static readonly Default = Layer.effect(
    ReceiptMediaService,
    ReceiptMediaService.make,
  );

  static readonly createUploadPolicy = (input: CreateUploadPolicyInput) =>
    ReceiptMediaService.use((service) => service.createUploadPolicy(input));

  static readonly discardPromotedUpload = (storageKey: string) =>
    ReceiptMediaService.use((service) =>
      service.discardPromotedUpload(storageKey),
    );

  static readonly inspectUpload = (input: InspectUploadInput) =>
    ReceiptMediaService.use((service) => service.inspectUpload(input));
}
