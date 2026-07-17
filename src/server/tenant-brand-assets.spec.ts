import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';

import { ObjectStorage } from './integrations/object-storage';
import {
  sanitizeTenantBrandAssetFileName,
  tenantBrandAssetContentTypeFromFileName,
  tenantBrandAssetStorageKey,
  tenantBrandAssetUrl,
  uploadTenantBrandAsset,
} from './tenant-brand-assets';

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

beforeEach(() => {
  if (!originalBunRuntime) {
    Object.defineProperty(runtimeGlobal, 'Bun', {
      configurable: true,
      value: bunRuntime,
    });
  }
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-20T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  if (originalBunRuntime) {
    originalBunRuntime.S3Client = originalS3Client;
    return;
  }

  delete runtimeGlobal.Bun;
});

describe('tenant brand assets', () => {
  it('normalizes public brand asset paths', () => {
    expect(sanitizeTenantBrandAssetFileName(' Section Logo (final).png ')).toBe(
      'Section-Logo-final-.png',
    );
    expect(
      tenantBrandAssetStorageKey({
        fileName: 'logo.png',
        kind: 'logo',
        tenantId: 'tenant-1',
      }),
    ).toBe('tenant-assets/tenant-1/logo/logo.png');
    expect(
      tenantBrandAssetUrl({
        fileName: 'logo.png',
        kind: 'logo',
        tenantId: 'tenant-1',
      }),
    ).toBe('/tenant-assets/tenant-1/logo/logo.png');
    expect(tenantBrandAssetContentTypeFromFileName('favicon.ico')).toBe(
      'image/x-icon',
    );
  });

  it.effect('uploads a logo and returns an app-origin tenant asset URL', () =>
    Effect.gen(function* () {
      const write = vi.fn(async () => 3);
      const captured = {
        key: '',
      };

      class FakeS3Client {
        file(key: string) {
          captured.key = key;
          return {
            arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
            presign: vi.fn(() => 'https://signed.example.com/object'),
            write,
          };
        }
      }

      bunRuntime.S3Client = FakeS3Client;

      const result = yield* uploadTenantBrandAsset({
        fileBase64: Buffer.from([1, 2, 3]).toString('base64'),
        fileName: 'Section Logo.png',
        fileSizeBytes: 3,
        kind: 'logo',
        mimeType: 'image/png',
        tenantId: 'tenant-1',
      }).pipe(Effect.provide(objectStorageLayer));

      expect(captured.key).toMatch(
        /^tenant-assets\/tenant-1\/logo\/[0-9a-f-]{36}-Section-Logo\.png$/,
      );
      expect(new Uint8Array(write.mock.calls[0]?.[0] as Uint8Array)).toEqual(
        new Uint8Array([1, 2, 3]),
      );
      expect(write.mock.calls[0]?.[1]).toEqual({ type: 'image/png' });
      expect(result).toEqual({
        assetUrl: `/${captured.key}`,
        sizeBytes: 3,
        storageKey: captured.key,
      });
    }),
  );

  it.effect('rejects SVG uploads for tenant brand assets', () =>
    Effect.gen(function* () {
      const error = yield* uploadTenantBrandAsset({
        fileBase64: Buffer.from('<svg />').toString('base64'),
        fileName: 'logo.svg',
        fileSizeBytes: 7,
        kind: 'logo',
        mimeType: 'image/svg+xml',
        tenantId: 'tenant-1',
      }).pipe(Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
    }),
  );

  it.effect('rejects payloads that do not match the declared file size', () =>
    Effect.gen(function* () {
      const error = yield* uploadTenantBrandAsset({
        fileBase64: Buffer.from([1, 2, 3]).toString('base64'),
        fileName: 'logo.png',
        fileSizeBytes: 4,
        kind: 'logo',
        mimeType: 'image/png',
        tenantId: 'tenant-1',
      }).pipe(Effect.flip);

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe(
        'Uploaded file size does not match payload metadata',
      );
    }),
  );
});
