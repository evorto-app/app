import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getObjectStorageEnvironment } from '../config/environment';
import {
  getSignedReceiptObjectUrlFromR2,
  uploadReceiptOriginalToR2,
} from './cloudflare-r2';

const runtimeGlobal = globalThis as typeof globalThis & {
  Bun?: {
    S3Client?: unknown;
  };
};

runtimeGlobal.Bun ??= {};
const bunRuntime = runtimeGlobal.Bun as {
  S3Client?: unknown;
};
const originalS3Client = bunRuntime.S3Client;
const originalObjectStorageEnvironment = {
  S3_ACCESS_KEY_ID: process.env['S3_ACCESS_KEY_ID'],
  S3_BUCKET: process.env['S3_BUCKET'],
  S3_ENDPOINT: process.env['S3_ENDPOINT'],
  S3_REGION: process.env['S3_REGION'],
  S3_SECRET_ACCESS_KEY: process.env['S3_SECRET_ACCESS_KEY'],
} as const;

beforeEach(() => {
  process.env['S3_ENDPOINT'] = 'https://s3.example.test';
  process.env['S3_REGION'] = 'auto';
  process.env['S3_BUCKET'] = 'test-bucket';
  process.env['S3_ACCESS_KEY_ID'] = 'test-key';
  process.env['S3_SECRET_ACCESS_KEY'] = 'test-secret';
});

afterEach(() => {
  bunRuntime.S3Client = originalS3Client;

  if (originalObjectStorageEnvironment.S3_ACCESS_KEY_ID) {
    process.env['S3_ACCESS_KEY_ID'] =
      originalObjectStorageEnvironment.S3_ACCESS_KEY_ID;
  } else {
    delete process.env['S3_ACCESS_KEY_ID'];
  }

  if (originalObjectStorageEnvironment.S3_BUCKET) {
    process.env['S3_BUCKET'] = originalObjectStorageEnvironment.S3_BUCKET;
  } else {
    delete process.env['S3_BUCKET'];
  }

  if (originalObjectStorageEnvironment.S3_ENDPOINT) {
    process.env['S3_ENDPOINT'] = originalObjectStorageEnvironment.S3_ENDPOINT;
  } else {
    delete process.env['S3_ENDPOINT'];
  }

  if (originalObjectStorageEnvironment.S3_REGION) {
    process.env['S3_REGION'] = originalObjectStorageEnvironment.S3_REGION;
  } else {
    delete process.env['S3_REGION'];
  }

  if (originalObjectStorageEnvironment.S3_SECRET_ACCESS_KEY) {
    process.env['S3_SECRET_ACCESS_KEY'] =
      originalObjectStorageEnvironment.S3_SECRET_ACCESS_KEY;
  } else {
    delete process.env['S3_SECRET_ACCESS_KEY'];
  }
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
      'Bun runtime is required for object storage operations.',
    );
  });

  it('uploads with Bun.S3Client and returns deterministic storage metadata', async () => {
    const environment = getObjectStorageEnvironment();
    const write = vi.fn(async () => 3);
    const presign = vi.fn(() => 'https://signed.example.com/object');
    const captured = {
      config: undefined as
        | undefined
        | {
            accessKeyId: string;
            bucket: string;
            endpoint: string;
            region: string;
            secretAccessKey: string;
            virtualHostedStyle: boolean;
          },
      key: '',
    };

    class FakeS3Client {
      constructor(config: {
        accessKeyId: string;
        bucket: string;
        endpoint: string;
        region: string;
        secretAccessKey: string;
        virtualHostedStyle: boolean;
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
      accessKeyId: environment.accessKeyId,
      bucket: environment.bucket,
      endpoint: environment.endpoint,
      region: environment.region,
      secretAccessKey: environment.secretAccessKey,
      virtualHostedStyle: false,
    });
    expect(captured.key).toBe('receipts/example.png');
    expect(write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), {
      type: 'image/png',
    });
    expect(result).toEqual({
      storageKey: 'receipts/example.png',
      storageUrl: `${environment.endpoint.replace(/\/$/, '')}/${environment.bucket}/receipts/example.png`,
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
