import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { Context, Effect, Layer } from 'effect';
import { createHash } from 'node:crypto';

import { ObjectStorage } from '../../../../integrations/object-storage';
import {
  ReceiptMediaBadRequestError,
  ReceiptMediaServiceUnavailableError,
} from './finance.errors';

export const MAX_RECEIPT_ORIGINAL_SIZE_BYTES = 20 * 1024 * 1024;
const RECEIPT_PREVIEW_SIGNED_URL_TTL_SECONDS = 60 * 15;
const receiptMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface ReceiptWithStoragePreview {
  attachmentStorageKey: null | string;
  attachmentStorageUrl: null | string;
  attachmentUploadConsumedAt: Date | null;
  attachmentUploadedAt: Date | null;
  attachmentUploadedByUserId: string;
  attachmentUploadEventId: string;
  attachmentUploadId: string;
  attachmentUploadStatus: 'consumed' | 'pending' | 'ready' | 'rejected';
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

export const isAllowedReceiptMimeType = (mimeType: string): boolean =>
  receiptMimeTypes.has(mimeType);

export const validateReceiptUploadMetadata = (input: {
  mimeType: string;
  sizeBytes: number;
}) =>
  Effect.gen(function* () {
    if (!isAllowedReceiptMimeType(input.mimeType)) {
      return yield* Effect.fail(
        new ReceiptMediaBadRequestError({
          message: 'Receipts must be JPEG, PNG, WebP, or PDF files',
        }),
      );
    }
    if (
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes <= 0 ||
      input.sizeBytes > MAX_RECEIPT_ORIGINAL_SIZE_BYTES
    ) {
      return yield* Effect.fail(
        new ReceiptMediaBadRequestError({
          message: 'Receipt file must be between 1 byte and 20 MB',
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
        return yield* objectStorage
          .presignGet(storageKey, expiresInSeconds)
          .pipe(
            Effect.mapError(
              (cause) =>
                new ReceiptMediaServiceUnavailableError({
                  cause,
                  message: 'Receipt storage is unavailable',
                }),
            ),
          );
      });

      const createUploadPolicy = Effect.fn(
        'ReceiptMediaService.createUploadPolicy',
      )(function* (input: CreateUploadPolicyInput) {
        yield* validateReceiptUploadMetadata(input);
        if (input.expiresAt.getTime() <= input.now.getTime()) {
          return yield* Effect.fail(
            new ReceiptMediaBadRequestError({
              message: 'Receipt upload expiry must be in the future',
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
            Effect.mapError(
              (cause) =>
                new ReceiptMediaServiceUnavailableError({
                  cause,
                  message: 'Receipt storage is unavailable',
                }),
            ),
          );

        return { ...signed, storageKey };
      });

      const discardPromotedUpload = Effect.fn(
        'ReceiptMediaService.discardPromotedUpload',
      )(function* (storageKey: string) {
        yield* objectStorage.deleteObject(storageKey).pipe(
          Effect.retry({ times: 3 }),
          Effect.mapError(
            (cause) =>
              new ReceiptMediaServiceUnavailableError({
                cause,
                message: 'Receipt storage is unavailable',
              }),
          ),
        );
      });

      const inspectUpload = Effect.fn('ReceiptMediaService.inspectUpload')(
        function* (input: InspectUploadInput) {
          if (!isAllowedReceiptMimeType(input.mimeType)) {
            return yield* Effect.fail(
              new ReceiptMediaBadRequestError({
                message: 'Unsupported receipt MIME type',
              }),
            );
          }

          const expectedStorageKey = buildReceiptUploadStorageKey(input);
          if (input.storageKey !== expectedStorageKey) {
            return yield* Effect.fail(
              new ReceiptMediaBadRequestError({
                message:
                  'Receipt upload key does not match its authorization scope',
              }),
            );
          }

          const body = yield* objectStorage.get(input.storageKey).pipe(
            Effect.mapError(
              (cause) =>
                new ReceiptMediaServiceUnavailableError({
                  cause,
                  message: 'Receipt storage is unavailable',
                }),
            ),
          );
          const detectedMimeType = detectReceiptMimeType(body.slice(0, 16));
          if (
            body.byteLength !== input.sizeBytes ||
            body.byteLength <= 0 ||
            body.byteLength > MAX_RECEIPT_ORIGINAL_SIZE_BYTES
          ) {
            return yield* Effect.fail(
              new ReceiptMediaBadRequestError({
                message:
                  'Uploaded receipt size does not match its signed policy',
              }),
            );
          }
          if (detectedMimeType !== input.mimeType) {
            return yield* Effect.fail(
              new ReceiptMediaBadRequestError({
                message:
                  'Uploaded receipt content does not match its declared type',
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
              Effect.mapError(
                (cause) =>
                  new ReceiptMediaServiceUnavailableError({
                    cause,
                    message: 'Receipt storage is unavailable',
                  }),
              ),
            );

          return {
            mimeType: detectedMimeType,
            sizeBytes: body.byteLength,
            storageKey: stored.storageKey,
            storageUrl: stored.storageUrl,
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
