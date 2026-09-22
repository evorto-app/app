import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@effect/vitest';
import { Cause, ConfigProvider, Effect, Exit, Layer } from 'effect';

import { ObjectStorage } from './integrations/object-storage';
import {
  detectTenantBrandAssetFileType,
  sanitizeTenantBrandAssetFileName,
  tenantBrandAssetContentTypeFromFileName,
  tenantBrandAssetStorageKey,
  tenantBrandAssetUrl,
  uploadTenantBrandAsset,
} from './tenant-brand-assets';
import { createDatabaseTestLayer } from './testing/database-test-layer';
import { createRegistrationDatabaseTestLayer } from './testing/registration-database';

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
    Object.defineProperty(originalBunRuntime, 'S3Client', {
      configurable: true,
      value: originalS3Client,
      writable: true,
    });
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
      const operations: string[] = [];
      const write = vi.fn<
        (body: Uint8Array, options: { type: string }) => Promise<number>
      >(async () => {
        operations.push('put');
        return pngBytes.byteLength;
      });
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
      }).pipe(
        Effect.provide(objectStorageLayer),
        Effect.provide(
          createRegistrationDatabaseTestLayer({
            executeValues: (statement) => {
              if (statement.startsWith('insert into')) {
                operations.push('insert');
                return Effect.succeed([]);
              }
              if (statement.startsWith('update')) {
                operations.push('settle');
                return Effect.succeed([['ready']]);
              }
              return Effect.die(new Error('Unexpected upload query'));
            },
          }),
        ),
      );
      expect(operations).toEqual(['insert', 'put', 'settle']);

      expect(captured.key).toMatch(
        /^tenant-assets\/tenant-1\/logo\/[0-9a-f-]{36}-Section-Logo\.png$/,
      );
      expect([...(write.mock.calls[0]?.[0] ?? [])]).toEqual([...pngBytes]);
      expect(write.mock.calls[0]?.[1]).toEqual({ type: 'image/png' });
      expect(result).toEqual({
        assetUrl: `/${captured.key}`,
        sizeBytes: pngBytes.byteLength,
        storageKey: captured.key,
      });
    }),
  );

  it.effect(
    'retains inserted ownership when successful storage has an uncertain database settlement',
    () =>
      Effect.gen(function* () {
        let inserted = false;
        const write = vi.fn(async () => pngBytes.byteLength);
        class FakeS3Client {
          file() {
            return { write };
          }
        }
        bunRuntime.S3Client = FakeS3Client;
        const failure = new Error('settlement connection lost');
        const result = yield* uploadTenantBrandAsset({
          fileBase64: pngBytes.toString('base64'),
          fileName: 'logo.png',
          fileSizeBytes: pngBytes.length,
          kind: 'logo',
          mimeType: 'image/png',
          tenantId: 'tenant-1',
        }).pipe(
          Effect.provide(objectStorageLayer),
          Effect.provide(
            createRegistrationDatabaseTestLayer({
              executeValues: (statement) => {
                if (statement.startsWith('insert into')) {
                  inserted = true;
                  return Effect.succeed([]);
                }
                if (statement.startsWith('update')) return Effect.die(failure);
                return Effect.die(new Error('Unexpected ownership removal'));
              },
            }),
          ),
          Effect.exit,
        );
        expect(inserted).toBe(true);
        expect(write).toHaveBeenCalledOnce();
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result))
          expect(Cause.squash(result.cause)).toBe(failure);
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
        }).pipe(
          Effect.provide(createDatabaseTestLayer()),
          Effect.provide(objectStorageLayer),
          Effect.flip,
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe(
          'This file could not be used as an image. Choose another image.',
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
      }).pipe(
        Effect.provide(createDatabaseTestLayer()),
        Effect.provide(objectStorageLayer),
        Effect.flip,
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe(
        'This image type cannot be used. Choose another image.',
      );
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
      }).pipe(
        Effect.provide(createDatabaseTestLayer()),
        Effect.provide(objectStorageLayer),
        Effect.flip,
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe(
        'This image could not be verified. Choose the file again.',
      );
    }),
  );
});
