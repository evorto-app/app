import { afterEach, describe, expect, layer, vi } from '@effect/vitest';
import { Cause, ConfigProvider, Effect, Exit } from 'effect';

import { objectStorageConfig } from '../config/object-storage-config';
import {
  getObjectFromR2,
  getSignedReceiptObjectUrlFromR2,
  uploadReceiptOriginalToR2,
} from './cloudflare-r2';

const runtimeGlobal = globalThis as typeof globalThis & {
  Bun?: {
    S3Client?: unknown;
  };
};

const originalBunRuntime = runtimeGlobal.Bun;
const bunRuntime = (originalBunRuntime ?? {}) as {
  S3Client?: unknown;
};
const originalS3Client = bunRuntime.S3Client;

if (!originalBunRuntime) {
  Object.defineProperty(runtimeGlobal, 'Bun', {
    configurable: true,
    value: bunRuntime,
  });
}

afterEach(() => {
  if (originalBunRuntime) {
    originalBunRuntime.S3Client = originalS3Client;
    return;
  }

  bunRuntime.S3Client = originalS3Client;
});

describe('cloudflare-r2', () => {
  const objectStorageProvider = ConfigProvider.fromEnv({
    env: Object.fromEntries([
      ['S3_ACCESS_KEY_ID', 'test-key'],
      ['S3_BUCKET', 'test-bucket'],
      ['S3_ENDPOINT', 'https://s3.example.test'],
      ['S3_REGION', 'auto'],
      ['S3_SECRET_ACCESS_KEY', 'test-secret'],
    ]),
  });
  const objectStorageProviderLayer = ConfigProvider.layer(
    objectStorageProvider,
  );

  layer(objectStorageProviderLayer)((it) => {
    it.effect('fails when Bun.S3Client is unavailable', () =>
      Effect.gen(function* () {
        bunRuntime.S3Client = undefined;

        const exit = yield* Effect.exit(
          uploadReceiptOriginalToR2({
            body: new Uint8Array([1, 2, 3]),
            contentType: 'image/png',
            key: 'receipts/missing.png',
          }),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) {
          throw new Error('Expected the object storage upload to fail');
        }

        const defect = Cause.squash(exit.cause);
        expect(defect).toBeInstanceOf(Error);
        if (!(defect instanceof Error)) {
          throw new Error('Expected the object storage failure to be an Error');
        }
        expect(defect.message).toBe(
          'Bun runtime is required for object storage operations.',
        );
      }),
    );

    it.effect(
      'uploads with Bun.S3Client and returns deterministic storage metadata',
      () =>
        Effect.gen(function* () {
          const environment = yield* objectStorageConfig;
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
                arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
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
        }),
    );

    it.effect('presigns receipt objects with default and custom expiry', () =>
      Effect.gen(function* () {
        const presign = vi.fn(() => 'https://signed.example.com/object');

        class FakeS3Client {
          file() {
            return {
              arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
              presign,
              write: vi.fn(async () => 0),
            };
          }
        }

        bunRuntime.S3Client = FakeS3Client;

        const defaultUrl = yield* getSignedReceiptObjectUrlFromR2({
          key: 'receipts/default.pdf',
        });
        const customUrl = yield* getSignedReceiptObjectUrlFromR2({
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
      }),
    );

    it.effect('reads objects with Bun.S3Client', () =>
      Effect.gen(function* () {
        const arrayBuffer = vi.fn(async () => new Uint8Array([4, 5, 6]).buffer);
        const captured = {
          key: '',
        };

        class FakeS3Client {
          file(key: string) {
            captured.key = key;
            return {
              arrayBuffer,
              presign: vi.fn(() => 'https://signed.example.com/object'),
              write: vi.fn(async () => 0),
            };
          }
        }

        bunRuntime.S3Client = FakeS3Client;

        const result = yield* getObjectFromR2({
          key: 'tenant-assets/tenant-1/logo/logo.png',
        });

        expect(captured.key).toBe('tenant-assets/tenant-1/logo/logo.png');
        expect(result).toEqual(new Uint8Array([4, 5, 6]));
      }),
    );
  });
});
