import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import {
  buildReceiptStorageKey,
  ReceiptMediaService,
  withSignedReceiptPreviewUrl,
} from './receipt-media.service';

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

  it.effect('keeps the preflight storage key stable for local fallback', () =>
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
      const expectedStorageKey = buildReceiptStorageKey(input);

      const result = yield* ReceiptMediaService.uploadOriginal(input).pipe(
        Effect.provide(ReceiptMediaService.Default),
      );

      expect(result).toEqual({
        sizeBytes: 7,
        storageKey: expectedStorageKey,
        storageUrl: 'local-unavailable://receipt',
      });
    }),
  );

  it.effect('fails closed when a bound upload key has foreign scope', () =>
    Effect.gen(function* () {
      const result = yield* withSignedReceiptPreviewUrl({
        attachmentStorageKey:
          'receipts/tenant-2/event-1/user-1/upload-1-receipt.pdf',
        attachmentStorageUrl: 'https://storage.example/foreign.pdf',
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
      });

      expect(result.attachmentStorageKey).toBeNull();
      expect(result.previewImageUrl).toBeNull();
    }),
  );

  it.effect('keeps a valid local upload bound without signing it', () =>
    Effect.gen(function* () {
      const storageKey =
        'receipts/tenant-1/event-1/user-1/upload-1-receipt.pdf';
      const result = yield* withSignedReceiptPreviewUrl({
        attachmentStorageKey: storageKey,
        attachmentStorageUrl: 'local-unavailable://receipt',
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
      });

      expect(result.attachmentStorageKey).toBe(storageKey);
      expect(result.previewImageUrl).toBeNull();
    }),
  );
});
