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
    throw new RpcBadRequestError({
      message: 'Tenant id is required for brand asset storage',
    });
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
          message:
            input.kind === 'favicon'
              ? 'Favicons must be PNG, JPEG, WebP, GIF, or ICO files'
              : 'Logos must be PNG, JPEG, WebP, or GIF files',
        }),
      );
    }
    if (
      input.fileSizeBytes <= 0 ||
      input.fileSizeBytes > MAX_TENANT_BRAND_ASSET_SIZE_BYTES
    ) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'Brand asset file must be between 1 byte and 5 MB',
        }),
      );
    }

    const body = Buffer.from(input.fileBase64, 'base64');
    if (body.byteLength !== input.fileSizeBytes) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'Uploaded file size does not match payload metadata',
        }),
      );
    }

    const extension = extensionByMimeType.get(input.mimeType);
    if (!extension) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'Unsupported brand asset MIME type',
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
        (cause) =>
          new RpcInternalServerError({
            cause,
            message: 'Failed to upload tenant brand asset',
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
