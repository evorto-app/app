import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { FinanceReceiptAttachmentInput } from './finance.rpcs';

describe('FinanceReceiptAttachmentInput', () => {
  it('accepts only a server-issued upload reference and display name', () => {
    expect(
      Schema.decodeUnknownSync(FinanceReceiptAttachmentInput)({
        fileName: 'Train ticket',
        uploadId: 'upload-1',
      }),
    ).toEqual({
      fileName: 'Train ticket',
      uploadId: 'upload-1',
    });
  });

  it('does not carry caller-supplied object storage metadata', () => {
    const decoded = Schema.decodeUnknownSync(FinanceReceiptAttachmentInput)({
      fileName: 'Train ticket',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      storageKey: 'receipts/another-tenant/secret.pdf',
      storageUrl: 'https://storage.example/secret.pdf',
      uploadId: 'upload-1',
    });

    expect(decoded).toEqual({
      fileName: 'Train ticket',
      uploadId: 'upload-1',
    });
  });
});
