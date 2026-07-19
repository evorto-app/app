import { describe, expect, it, vi } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';

import { ObjectStorage } from '../../../../integrations/object-storage';
import { ReceiptMediaServiceUnavailableError } from './finance.errors';
import {
  buildReceiptStorageKey,
  buildReceiptUploadStorageKey,
  detectReceiptMimeType,
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
  attachmentUploadStatus: 'consumed',
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
    createUploadPolicy: () => Effect.dieMessage('Unexpected upload policy'),
    discardPromotedUpload: () =>
      Effect.dieMessage('Unexpected promoted upload discard'),
    inspectUpload: () => Effect.dieMessage('Unexpected upload inspection'),
    objectExists,
    signedPreviewUrl,
  });

describe('ReceiptMediaService', () => {
  it.effect('fails with bad request for unsupported mime type', () =>
    Effect.gen(function* () {
      const now = new Date('2026-07-16T12:00:00.000Z');
      const program = ReceiptMediaService.createUploadPolicy({
        eventId: 'event-1',
        expiresAt: new Date('2026-07-16T12:05:00.000Z'),
        fileName: 'receipt.txt',
        mimeType: 'text/plain',
        now,
        sizeBytes: 5,
        tenantId: 'tenant-1',
        uploadId: 'upload-1',
        userId: 'user-1',
      }).pipe(
        Effect.flip,
        Effect.provide(ReceiptMediaService.Default),
        Effect.provide(ObjectStorage.Default),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('ReceiptMediaBadRequestError');
    }),
  );

  it.effect('fails closed when receipt storage configuration is missing', () =>
    Effect.gen(function* () {
      const now = new Date('2026-07-16T12:00:00.000Z');
      const input = {
        eventId: 'event-1',
        expiresAt: new Date('2026-07-16T12:05:00.000Z'),
        fileName: 'receipt.pdf',
        mimeType: 'application/pdf',
        now,
        sizeBytes: 7,
        tenantId: 'tenant-1',
        uploadId: 'upload-1',
        userId: 'user-1',
      };
      const error = yield* ReceiptMediaService.createUploadPolicy(input).pipe(
        Effect.flip,
        Effect.provide(ReceiptMediaService.Default),
        Effect.provide(ObjectStorage.Default),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({ env: {} }),
        ),
      );

      expect(error['_tag']).toBe('ReceiptMediaServiceUnavailableError');
      expect(buildReceiptUploadStorageKey(input)).toBe(
        'receipt-uploads/tenant-1/event-1/user-1/upload-1-receipt.pdf',
      );
      expect(
        buildReceiptStorageKey({ ...input, contentDigest: 'a'.repeat(64) }),
      ).toBe(
        `receipts/tenant-1/event-1/user-1/upload-1-${'a'.repeat(64)}-receipt.pdf`,
      );
    }),
  );

  it.effect('promotes validated bytes to a browser-immutable receipt key', () =>
    Effect.gen(function* () {
      const originalBody = new TextEncoder().encode('%PDF-1.7');
      const replacementBody = new TextEncoder().encode('%PDF-9.9');
      const uploadStorageKey =
        'receipt-uploads/tenant-1/event-1/user-1/upload-1-receipt.pdf';
      const objects = new Map<
        string,
        { body: Uint8Array; contentType: string }
      >([
        [
          uploadStorageKey,
          { body: originalBody, contentType: 'application/pdf' },
        ],
      ]);
      const objectStorageLayer = Layer.succeed(ObjectStorage)({
        deleteObject: (key) =>
          Effect.sync(() => {
            objects.delete(key);
          }),
        exists: (key) => Effect.sync(() => objects.has(key)),
        get: (key) =>
          Effect.sync(() => new Uint8Array(objects.get(key)?.body ?? [])),
        metadata: (key, prefixBytes = 16) =>
          Effect.sync(() => {
            const stored = objects.get(key);
            const body = stored?.body ?? new Uint8Array();
            return {
              contentType: stored?.contentType ?? '',
              prefix: body.slice(0, prefixBytes),
              sizeBytes: body.byteLength,
              storageUrl: `s3://bucket/${key}`,
            };
          }),
        presignGet: (key) => Effect.succeed(`https://signed.test/${key}`),
        presignPost: () => Effect.dieMessage('Unexpected POST signing'),
        put: (input) =>
          Effect.sync(() => {
            objects.set(input.key, {
              body: new Uint8Array(input.body),
              contentType: input.contentType,
            });
            return {
              storageKey: input.key,
              storageUrl: `s3://bucket/${input.key}`,
            };
          }),
      });

      const inspected = yield* ReceiptMediaService.inspectUpload({
        eventId: 'event-1',
        fileName: 'receipt.pdf',
        mimeType: 'application/pdf',
        sizeBytes: originalBody.byteLength,
        storageKey: uploadStorageKey,
        tenantId: 'tenant-1',
        uploadId: 'upload-1',
        userId: 'user-1',
      }).pipe(
        Effect.provide(ReceiptMediaService.Default),
        Effect.provide(objectStorageLayer),
      );

      expect(inspected.storageKey).toMatch(
        /^receipts\/tenant-1\/event-1\/user-1\/upload-1-[0-9a-f]{64}-receipt\.pdf$/u,
      );
      expect(inspected.storageKey).not.toBe(uploadStorageKey);

      objects.set(uploadStorageKey, {
        body: replacementBody,
        contentType: 'application/pdf',
      });
      expect(objects.get(inspected.storageKey)?.body).toEqual(originalBody);

      yield* ReceiptMediaService.discardPromotedUpload(
        inspected.storageKey,
      ).pipe(
        Effect.provide(ReceiptMediaService.Default),
        Effect.provide(objectStorageLayer),
      );
      expect(objects.has(inspected.storageKey)).toBe(false);
    }),
  );

  it('accepts only the four receipt magic-byte signatures', () => {
    expect(
      detectReceiptMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0x00])),
    ).toBe('image/jpeg');
    expect(
      detectReceiptMimeType(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe('image/png');
    expect(
      detectReceiptMimeType(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ]),
      ),
    ).toBe('image/webp');
    expect(detectReceiptMimeType(new TextEncoder().encode('%PDF-1.7'))).toBe(
      'application/pdf',
    );
    expect(detectReceiptMimeType(new TextEncoder().encode('<script>'))).toBe(
      undefined,
    );
  });

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
