import { describe, expect, it } from 'vitest';

import {
  allowedReceiptMimeTypes,
  maximumReceiptOriginalSizeBytes,
  receiptFileAccept,
  validateReceiptFileMetadata,
} from './receipt-media';

describe('receipt file metadata', () => {
  it('keeps browser and server MIME acceptance on one exact allowlist', () => {
    expect(receiptFileAccept).toBe(
      'application/pdf,image/jpeg,image/png,image/webp',
    );
    for (const mimeType of allowedReceiptMimeTypes) {
      expect(
        validateReceiptFileMetadata({ mimeType, sizeBytes: 1 }),
      ).toBeNull();
    }
    expect(
      validateReceiptFileMetadata({
        mimeType: 'image/gif',
        sizeBytes: 1,
      }),
    ).toBe('Receipts must be JPEG, PNG, WebP, or PDF files');
  });

  it('accepts only positive files up to and including 20 MiB', () => {
    expect(
      validateReceiptFileMetadata({
        mimeType: 'application/pdf',
        sizeBytes: maximumReceiptOriginalSizeBytes,
      }),
    ).toBeNull();
    for (const sizeBytes of [0, maximumReceiptOriginalSizeBytes + 1, NaN]) {
      expect(
        validateReceiptFileMetadata({
          mimeType: 'application/pdf',
          sizeBytes,
        }),
      ).toBe('Receipt file must be between 1 byte and 20 MB');
    }
  });
});
