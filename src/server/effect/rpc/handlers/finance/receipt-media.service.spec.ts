import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { ReceiptMediaService } from './receipt-media.service';

describe('ReceiptMediaService', () => {
  it.effect('fails with bad request for unsupported mime type', () =>
    Effect.gen(function* () {
    const program = ReceiptMediaService.uploadOriginal({
      fileBase64: Buffer.from('hello').toString('base64'),
      fileName: 'receipt.txt',
      fileSizeBytes: 5,
      mimeType: 'text/plain',
      tenantId: 'tenant-1',
      userId: 'user-1',
    }).pipe(Effect.flip, Effect.provide(ReceiptMediaService.Default));

    const error = yield* program;
    expect(error['_tag']).toBe('ReceiptMediaBadRequestError');
    })
  );
});
