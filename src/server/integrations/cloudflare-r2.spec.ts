import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';

import { objectStorageConfig } from '../config/object-storage-config';
import {
  getSignedReceiptObjectUrlFromR2,
  uploadReceiptOriginalToR2,
} from './cloudflare-r2';

const runtimeGlobal = globalThis as typeof globalThis & {
  Bun?: {
    S3Client?: unknown;
  };
};

const originalBunRuntime = runtimeGlobal.Bun;
const bunRuntime = (runtimeGlobal.Bun ??= {}) as {
  S3Client?: unknown;
};
const originalS3Client = bunRuntime.S3Client;

afterEach(() => {
  runtimeGlobal.Bun = bunRuntime;

  if (originalBunRuntime) {
    originalBunRuntime.S3Client = originalS3Client;
    runtimeGlobal.Bun = originalBunRuntime;
    return;
  }

  bunRuntime.S3Client = originalS3Client;
});

describe('cloudflare-r2', () => {
  const objectStorageProvider = ConfigProvider.fromMap(
    new Map([
      ['S3_ACCESS_KEY_ID', 'test-key'],
      ['S3_BUCKET', 'test-bucket'],
      ['S3_ENDPOINT', 'https://s3.example.test'],
      ['S3_REGION', 'auto'],
      ['S3_SECRET_ACCESS_KEY', 'test-secret'],
    ]),
  );

  it('fails when Bun.S3Client is unavailable', async () => {
    bunRuntime.S3Client = undefined;

    await expect(
      Effect.runPromise(
      uploadReceiptOriginalToR2({
        body: new Uint8Array([1, 2, 3]),
        contentType: 'image/png',
        key: 'receipts/missing.png',
      }).pipe(Effect.provide(Layer.setConfigProvider(objectStorageProvider))),
      ),
    ).rejects.toThrow(
      'Bun runtime is required for object storage operations.',
    );
  });

  it.effect('uploads with Bun.S3Client and returns deterministic storage metadata', () =>
    Effect.gen(function* () {
    const environment = yield* objectStorageConfig.pipe(
      Effect.withConfigProvider(objectStorageProvider),
    );
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

    const result = yield* uploadReceiptOriginalToR2({
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
      key: 'receipts/example.png',
    }).pipe(Effect.provide(Layer.setConfigProvider(objectStorageProvider)));

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
    })
  );

  it.effect('presigns receipt objects with default and custom expiry', () =>
    Effect.gen(function* () {
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

    const defaultUrl = yield* getSignedReceiptObjectUrlFromR2({
      key: 'receipts/default.pdf',
    }).pipe(Effect.provide(Layer.setConfigProvider(objectStorageProvider)));
    const customUrl = yield* getSignedReceiptObjectUrlFromR2({
      expiresInSeconds: 30,
      key: 'receipts/custom.pdf',
    }).pipe(Effect.provide(Layer.setConfigProvider(objectStorageProvider)));

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
    })
  );
});
