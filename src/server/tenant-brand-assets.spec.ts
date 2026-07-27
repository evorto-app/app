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
  detectTenantBrandAssetFileType,
  sanitizeTenantBrandAssetFileName,
  tenantBrandAssetContentTypeFromFileName,
  tenantBrandAssetStorageKey,
  tenantBrandAssetUrl,
  uploadTenantBrandAsset,
} from './tenant-brand-assets';

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
      const write = vi.fn(async () => pngBytes.byteLength);
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
        fileBase64: pngBytes.toString('base64'),
        fileName: 'Section Logo.png',
        fileSizeBytes: pngBytes.byteLength,
        kind: 'logo',
        mimeType: 'image/png',
        tenantId: 'tenant-1',
      }).pipe(Effect.provide(objectStorageLayer));

      expect(captured.key).toMatch(
        /^tenant-assets\/tenant-1\/logo\/[0-9a-f-]{36}-Section-Logo\.png$/,
      );
      expect(new Uint8Array(write.mock.calls[0]?.[0] as Uint8Array)).toEqual(
        new Uint8Array(pngBytes),
      );
      expect(write.mock.calls[0]?.[1]).toEqual({ type: 'image/png' });
      expect(result).toEqual({
        assetUrl: `/${captured.key}`,
        sizeBytes: pngBytes.byteLength,
        storageKey: captured.key,
      });
    }),
  );

  it('detects only the supported brand-asset signatures', () => {
    expect(detectTenantBrandAssetFileType(pngBytes)).toBe('png');
    expect(
      detectTenantBrandAssetFileType(
        Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
      ),
    ).toBe('gif');
    expect(
      detectTenantBrandAssetFileType(
        Buffer.from([
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ]),
      ),
    ).toBe('webp');
    expect(detectTenantBrandAssetFileType(Buffer.from('<html>'))).toBe(
      undefined,
    );
  });

  it.effect(
    'rejects a payload whose bytes do not match its image MIME type',
    () =>
      Effect.gen(function* () {
        const body = Buffer.from('<html>not an image</html>');
        const error = yield* uploadTenantBrandAsset({
          fileBase64: body.toString('base64'),
          fileName: 'logo.png',
          fileSizeBytes: body.byteLength,
          kind: 'logo',
          mimeType: 'image/png',
          tenantId: 'tenant-1',
        }).pipe(Effect.flip);

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe(
          'Brand asset contents do not match the declared MIME type',
        );
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
        fileBase64: pngBytes.toString('base64'),
        fileName: 'logo.png',
        fileSizeBytes: pngBytes.byteLength + 1,
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
