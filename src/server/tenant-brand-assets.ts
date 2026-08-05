import type { AdminTenantBrandAssetKind } from '@shared/rpc-contracts/app-rpcs/admin.rpcs';

import {
  RpcBadRequestError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import { Effect } from 'effect';
import { randomUUID } from 'node:crypto';

import { ObjectStorage } from './integrations/object-storage';

const MAX_TENANT_BRAND_ASSET_SIZE_BYTES = 5 * 1024 * 1024;

const brandAssetMimeTypes = {
  favicon: new Set([
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/vnd.microsoft.icon',
    'image/webp',
    'image/x-icon',
  ]),
  logo: new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']),
} satisfies Record<AdminTenantBrandAssetKind, ReadonlySet<string>>;

const extensionByMimeType = new Map<string, string>([
  ['image/gif', 'gif'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/vnd.microsoft.icon', 'ico'],
  ['image/webp', 'webp'],
  ['image/x-icon', 'ico'],
]);

const mimeTypeByExtension = new Map(
  Array.from(extensionByMimeType, ([mimeType, extension]) => [
    extension,
    mimeType,
  ]),
);

type BrandAssetFileType = 'gif' | 'ico' | 'jpeg' | 'png' | 'webp';

const fileTypeByMimeType = new Map<string, BrandAssetFileType>([
  ['image/gif', 'gif'],
  ['image/jpeg', 'jpeg'],
  ['image/png', 'png'],
  ['image/vnd.microsoft.icon', 'ico'],
  ['image/webp', 'webp'],
  ['image/x-icon', 'ico'],
]);

const startsWithBytes = (
  body: Uint8Array,
  expected: readonly number[],
): boolean => expected.every((byte, index) => body[index] === byte);

export const detectTenantBrandAssetFileType = (
  body: Uint8Array,
): BrandAssetFileType | undefined => {
  if (startsWithBytes(body, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWithBytes(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png';
  }
  if (
    startsWithBytes(body, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWithBytes(body, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return 'gif';
  }
  if (
    startsWithBytes(body, [0x52, 0x49, 0x46, 0x46]) &&
    body[8] === 0x57 &&
    body[9] === 0x45 &&
    body[10] === 0x42 &&
    body[11] === 0x50
  ) {
    return 'webp';
  }
  if (startsWithBytes(body, [0x00, 0x00, 0x01, 0x00])) return 'ico';
  return;
};

export const sanitizeTenantBrandAssetFileName = (fileName: string): string =>
  fileName
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 100) || 'brand-asset';

export const tenantBrandAssetContentTypeFromFileName = (
  fileName: string,
): null | string => {
  const extension = fileName.split('.').pop()?.toLocaleLowerCase();
  return extension ? (mimeTypeByExtension.get(extension) ?? null) : null;
};

export const tenantBrandAssetStorageKey = (input: {
  fileName: string;
  kind: AdminTenantBrandAssetKind;
  tenantId: string;
}) => {
  const tenantId = input.tenantId.trim();
  if (!tenantId) {
    throw new Error('Tenant id is required for brand asset storage');
  }
  return `tenant-assets/${tenantId}/${input.kind}/${input.fileName}`;
};

export const tenantBrandAssetUrl = (input: {
  fileName: string;
  kind: AdminTenantBrandAssetKind;
  tenantId: string;
}) =>
  `/tenant-assets/${encodeURIComponent(input.tenantId)}/${input.kind}/${encodeURIComponent(input.fileName)}`;

export const uploadTenantBrandAsset = (input: {
  fileBase64: string;
  fileName: string;
  fileSizeBytes: number;
  kind: AdminTenantBrandAssetKind;
  mimeType: string;
  tenantId: string;
}) =>
  Effect.gen(function* () {
    if (!brandAssetMimeTypes[input.kind].has(input.mimeType)) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'This image type cannot be used. Choose another image.',
        }),
      );
    }
    if (
      input.fileSizeBytes <= 0 ||
      input.fileSizeBytes > MAX_TENANT_BRAND_ASSET_SIZE_BYTES
    ) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message:
            'This image is empty or larger than 5 MB. Choose another image.',
        }),
      );
    }

    const body = Buffer.from(input.fileBase64, 'base64');
    if (body.byteLength !== input.fileSizeBytes) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'This image could not be verified. Choose the file again.',
        }),
      );
    }

    const expectedFileType = fileTypeByMimeType.get(input.mimeType);
    if (
      !expectedFileType ||
      detectTenantBrandAssetFileType(body) !== expectedFileType
    ) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message:
            'This file could not be used as an image. Choose another image.',
        }),
      );
    }

    const extension = extensionByMimeType.get(input.mimeType);
    if (!extension) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'This image type cannot be used. Choose another image.',
        }),
      );
    }

    const safeBaseName = sanitizeTenantBrandAssetFileName(input.fileName)
      .replace(/\.[^.]+$/, '')
      .slice(0, 80);
    const fileName = `${randomUUID()}-${safeBaseName}.${extension}`;
    const storageKey = tenantBrandAssetStorageKey({
      fileName,
      kind: input.kind,
      tenantId: input.tenantId,
    });

    yield* ObjectStorage.put({
      body,
      contentType: input.mimeType,
      key: storageKey,
    }).pipe(
      Effect.mapError(
        () =>
          new RpcInternalServerError({
            message: 'The organization image could not be saved. Try again.',
          }),
      ),
    );

    return {
      assetUrl: tenantBrandAssetUrl({
        fileName,
        kind: input.kind,
        tenantId: input.tenantId,
      }),
      sizeBytes: body.byteLength,
      storageKey,
    };
  });
