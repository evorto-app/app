import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCloudflareR2Environment } from '../config/environment';
import {
  getSignedReceiptObjectUrlFromR2,
  uploadReceiptOriginalToR2,
} from './cloudflare-r2';

const bunRuntime = (
  globalThis as typeof globalThis & {
    Bun: {
      S3Client?: unknown;
    };
  }
).Bun;
const originalS3Client = bunRuntime.S3Client;

afterEach(() => {
  bunRuntime.S3Client = originalS3Client;
});

describe('cloudflare-r2', () => {
  it('fails when Bun.S3Client is unavailable', async () => {
    bunRuntime.S3Client = undefined;

    await expect(
      uploadReceiptOriginalToR2({
        body: new Uint8Array([1, 2, 3]),
        contentType: 'image/png',
        key: 'receipts/missing.png',
      }),
    ).rejects.toThrow(
      'Bun runtime is required for Cloudflare R2 storage operations.',
    );
  });

  it('uploads with Bun.S3Client and returns deterministic storage metadata', async () => {
    const environment = getCloudflareR2Environment();
    const write = vi.fn(async () => 3);
    const presign = vi.fn(() => 'https://signed.example.com/object');
    const captured = {
      config: undefined as
        | undefined
        | {
            accessKeyId: string;
            bucket: string;
            endpoint: string;
            secretAccessKey: string;
          },
      key: '',
    };

    class FakeS3Client {
      constructor(config: {
        accessKeyId: string;
        bucket: string;
        endpoint: string;
        secretAccessKey: string;
      }) {
        captured.config = config;
      }

      file(key: string) {
        captured.key = key;
        return {
          presign,
          write,
        };
      }
    }

    bunRuntime.S3Client = FakeS3Client;

    const result = await uploadReceiptOriginalToR2({
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
      key: 'receipts/example.png',
    });

    expect(captured.config).toEqual({
      accessKeyId: environment.CLOUDFLARE_R2_S3_KEY_ID,
      bucket: environment.CLOUDFLARE_R2_BUCKET,
      endpoint: environment.CLOUDFLARE_R2_S3_ENDPOINT,
      secretAccessKey: environment.CLOUDFLARE_R2_S3_KEY,
    });
    expect(captured.key).toBe('receipts/example.png');
    expect(write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), {
      type: 'image/png',
    });
    expect(result).toEqual({
      storageKey: 'receipts/example.png',
      storageUrl: `${environment.CLOUDFLARE_R2_S3_ENDPOINT.replace(/\/$/, '')}/${environment.CLOUDFLARE_R2_BUCKET}/receipts/example.png`,
    });
  });

  it('presigns receipt objects with default and custom expiry', async () => {
    const presign = vi.fn(() => 'https://signed.example.com/object');

    class FakeS3Client {
      file() {
        return {
          presign,
          write: vi.fn(async () => 0),
        };
      }
    }

    bunRuntime.S3Client = FakeS3Client;

    const defaultUrl = await getSignedReceiptObjectUrlFromR2({
      key: 'receipts/default.pdf',
    });
    const customUrl = await getSignedReceiptObjectUrlFromR2({
      expiresInSeconds: 30,
      key: 'receipts/custom.pdf',
    });

    expect(defaultUrl).toBe('https://signed.example.com/object');
    expect(customUrl).toBe('https://signed.example.com/object');
    expect(presign).toHaveBeenNthCalledWith(1, {
      contentDisposition: 'inline',
      expiresIn: 900,
      method: 'GET',
    });
    expect(presign).toHaveBeenNthCalledWith(2, {
      contentDisposition: 'inline',
      expiresIn: 30,
      method: 'GET',
    });
  });
});
