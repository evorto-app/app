import { describe, expect, it, vi } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';

import { ReceiptMediaServiceUnavailableError } from './finance.errors';
import {
  buildReceiptStorageKey,
  ensureReceiptEvidenceAvailableForApproval,
  ReceiptMediaService,
  type ReceiptWithStoragePreview,
  withSignedReceiptPreviewUrl,
} from './receipt-media.service';

const receipt = (
  overrides: Partial<ReceiptWithStoragePreview> = {},
): ReceiptWithStoragePreview => ({
  attachmentStorageKey: 'receipts/tenant-1/event-1/user-1/upload-1-receipt.pdf',
  attachmentStorageUrl: 'https://storage.example/receipt.pdf',
  attachmentUploadConsumedAt: new Date('2026-07-10T08:00:00.000Z'),
  attachmentUploadedAt: new Date('2026-07-10T07:59:00.000Z'),
  attachmentUploadedByUserId: 'user-1',
  attachmentUploadEventId: 'event-1',
  attachmentUploadId: 'upload-1',
  attachmentUploadTenantId: 'tenant-1',
  eventId: 'event-1',
  previewImageUrl: null,
  submittedByUserId: 'user-1',
  tenantId: 'tenant-1',
  ...overrides,
});

const receiptMediaLayer = ({
  exists,
  objectExists = vi.fn(() => Effect.succeed(exists)),
  signedPreviewUrl = vi.fn(() =>
    Effect.succeed('https://signed.example.test/receipt.pdf'),
  ),
}: {
  exists: boolean;
  objectExists?: (input: { storageKey: string }) => Effect.Effect<boolean>;
  signedPreviewUrl?: (input: {
    expiresInSeconds: number;
    storageKey: string;
  }) => Effect.Effect<string, ReceiptMediaServiceUnavailableError>;
}) =>
  Layer.succeed(ReceiptMediaService)({
    objectExists,
    signedPreviewUrl,
    uploadOriginal: () => Effect.dieMessage('Unexpected receipt upload'),
  });

describe('ReceiptMediaService', () => {
  it.effect('fails with bad request for unsupported mime type', () =>
    Effect.gen(function* () {
      const program = ReceiptMediaService.uploadOriginal({
        eventId: 'event-1',
        fileBase64: Buffer.from('hello').toString('base64'),
        fileName: 'receipt.txt',
        fileSizeBytes: 5,
        mimeType: 'text/plain',
        tenantId: 'tenant-1',
        uploadId: 'upload-1',
        userId: 'user-1',
      }).pipe(Effect.flip, Effect.provide(ReceiptMediaService.Default));

      const error = yield* program;
      expect(error['_tag']).toBe('ReceiptMediaBadRequestError');
    }),
  );

  it.effect('fails closed when receipt storage configuration is missing', () =>
    Effect.gen(function* () {
      const input = {
        eventId: 'event-1',
        fileBase64: Buffer.from('receipt').toString('base64'),
        fileName: 'receipt.pdf',
        fileSizeBytes: 7,
        mimeType: 'application/pdf',
        tenantId: 'tenant-1',
        uploadId: 'upload-1',
        userId: 'user-1',
      };
      const error = yield* ReceiptMediaService.uploadOriginal(input).pipe(
        Effect.flip,
        Effect.provide(ReceiptMediaService.Default),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({ env: {} }),
        ),
      );

      expect(error['_tag']).toBe('ReceiptMediaServiceUnavailableError');
      expect(buildReceiptStorageKey(input)).toBe(
        'receipts/tenant-1/event-1/user-1/upload-1-receipt.pdf',
      );
    }),
  );

  it.effect('rejects a foreign-scope binding before checking storage', () =>
    Effect.gen(function* () {
      const objectExists = vi.fn(() => Effect.succeed(true));
      const result = yield* withSignedReceiptPreviewUrl(
        receipt({
          attachmentStorageKey:
            'receipts/tenant-2/event-1/user-1/upload-1-receipt.pdf',
        }),
      ).pipe(Effect.provide(receiptMediaLayer({ exists: true, objectExists })));

      expect(result.attachmentStorageKey).toBeNull();
      expect(result.previewImageUrl).toBeNull();
      expect(result.receiptEvidenceAvailable).toBe(false);
      expect(objectExists).not.toHaveBeenCalled();
    }),
  );

  it.effect('rejects a same-scope key belonging to a different upload', () =>
    Effect.gen(function* () {
      const objectExists = vi.fn(() => Effect.succeed(true));
      const result = yield* withSignedReceiptPreviewUrl(
        receipt({
          attachmentStorageKey:
            'receipts/tenant-1/event-1/user-1/upload-2-receipt.pdf',
        }),
      ).pipe(Effect.provide(receiptMediaLayer({ exists: true, objectExists })));

      expect(result.attachmentStorageKey).toBeNull();
      expect(result.previewImageUrl).toBeNull();
      expect(result.receiptEvidenceAvailable).toBe(false);
      expect(objectExists).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    'marks a valid binding unavailable when its object is missing',
    () =>
      Effect.gen(function* () {
        const result = yield* withSignedReceiptPreviewUrl(receipt()).pipe(
          Effect.provide(receiptMediaLayer({ exists: false })),
        );

        expect(result.attachmentStorageKey).toBe(
          'receipts/tenant-1/event-1/user-1/upload-1-receipt.pdf',
        );
        expect(result.previewImageUrl).toBeNull();
        expect(result.receiptEvidenceAvailable).toBe(false);
      }),
  );

  it.effect('signs a preview only after the exact object is confirmed', () =>
    Effect.gen(function* () {
      const result = yield* withSignedReceiptPreviewUrl(receipt()).pipe(
        Effect.provide(receiptMediaLayer({ exists: true })),
      );

      expect(result.previewImageUrl).toBe(
        'https://signed.example.test/receipt.pdf',
      );
      expect(result.receiptEvidenceAvailable).toBe(true);
    }),
  );

  it.effect(
    'blocks approval for missing evidence and accepts real evidence',
    () =>
      Effect.gen(function* () {
        const unavailable = yield* ensureReceiptEvidenceAvailableForApproval(
          receipt(),
        ).pipe(
          Effect.flip,
          Effect.provide(receiptMediaLayer({ exists: false })),
        );
        expect(unavailable['_tag']).toBe('RpcBadRequestError');
        expect(unavailable.reason).toBe('receiptEvidenceUnavailable');

        const available = yield* ensureReceiptEvidenceAvailableForApproval(
          receipt(),
        ).pipe(Effect.provide(receiptMediaLayer({ exists: true })));
        expect(available).toEqual({
          attachmentUploadId: 'upload-1',
          storageKey: 'receipts/tenant-1/event-1/user-1/upload-1-receipt.pdf',
        });
      }),
  );

  it.effect('blocks approval when retrievable evidence cannot be signed', () =>
    Effect.gen(function* () {
      const error = yield* ensureReceiptEvidenceAvailableForApproval(
        receipt(),
      ).pipe(
        Effect.flip,
        Effect.provide(
          receiptMediaLayer({
            exists: true,
            signedPreviewUrl: () =>
              Effect.fail(
                new ReceiptMediaServiceUnavailableError({
                  message: 'Receipt storage is unavailable',
                }),
              ),
          }),
        ),
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toBe('receiptEvidenceUnavailable');
    }),
  );
});
