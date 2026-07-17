import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';

import { ObjectStorage } from '../integrations/object-storage';
import { handleTenantBrandAssetWebRequest } from './tenant-brand-asset.web-handler';

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

beforeEach(() => {
  if (!originalBunRuntime) {
    Object.defineProperty(runtimeGlobal, 'Bun', {
      configurable: true,
      value: bunRuntime,
    });
  }
});

const objectStorageProviderLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: Object.fromEntries([
      ['S3_ACCESS_KEY_ID', 'test-key'],
      ['S3_BUCKET', 'test-bucket'],
      ['S3_ENDPOINT', 'https://s3.example.test'],
      ['S3_REGION', 'auto'],
      ['S3_SECRET_ACCESS_KEY', 'test-secret'],
    ]),
  }),
);
const objectStorageLayer = ObjectStorage.Default.pipe(
  Layer.provide(objectStorageProviderLayer),
);

afterEach(() => {
  if (originalBunRuntime) {
    originalBunRuntime.S3Client = originalS3Client;
    return;
  }

  delete runtimeGlobal.Bun;
});

describe('handleTenantBrandAssetWebRequest', () => {
  it.effect('serves stored tenant brand assets from object storage', () =>
    Effect.gen(function* () {
      class FakeS3Client {
        file() {
          return {
            arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
            presign: vi.fn(() => 'https://signed.example.com/object'),
            write: vi.fn(async () => 0),
          };
        }
      }

      bunRuntime.S3Client = FakeS3Client;

      const response = yield* handleTenantBrandAssetWebRequest({
        fileName: 'logo.png',
        kind: 'logo',
        tenantId: 'tenant-1',
      }).pipe(Effect.provide(objectStorageLayer));

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/png');
      expect(response.headers.get('Cache-Control')).toContain('immutable');
      const body = yield* Effect.promise(() => response.arrayBuffer());
      expect(new Uint8Array(body)).toEqual(new Uint8Array([1, 2, 3]));
    }),
  );

  it.effect('returns 404 for unsupported asset paths', () =>
    Effect.gen(function* () {
      const response = yield* handleTenantBrandAssetWebRequest({
        fileName: 'logo.svg',
        kind: 'logo',
        tenantId: 'tenant-1',
      }).pipe(Effect.provide(objectStorageLayer));

      expect(response.status).toBe(404);
    }),
  );

  it.effect('returns 404 for missing object storage assets', () =>
    Effect.gen(function* () {
      class FakeS3Client {
        file() {
          return {
            arrayBuffer: vi.fn(async () => {
              throw new Error('No such key');
            }),
            presign: vi.fn(() => 'https://signed.example.com/object'),
            write: vi.fn(async () => 0),
          };
        }
      }

      bunRuntime.S3Client = FakeS3Client;

      const response = yield* handleTenantBrandAssetWebRequest({
        fileName: 'logo.png',
        kind: 'logo',
        tenantId: 'tenant-1',
      }).pipe(Effect.provide(objectStorageLayer));

      expect(response.status).toBe(404);
    }),
  );
});
