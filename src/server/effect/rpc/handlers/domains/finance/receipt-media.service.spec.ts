import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ReceiptMediaService } from './receipt-media.service';

describe('ReceiptMediaService', () => {
  it('fails with bad request for unsupported mime type', async () => {
    const program = ReceiptMediaService.uploadOriginal({
      fileBase64: Buffer.from('hello').toString('base64'),
      fileName: 'receipt.txt',
      fileSizeBytes: 5,
      mimeType: 'text/plain',
      tenantId: 'tenant-1',
      userId: 'user-1',
    }).pipe(Effect.flip, Effect.provide(ReceiptMediaService.Default));

    const error = await Effect.runPromise(program);
    expect(error['_tag']).toBe('ReceiptMediaBadRequestError');
  });
});
