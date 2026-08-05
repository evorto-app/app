import type { AdminTenantBrandAssetKind } from '@shared/rpc-contracts/app-rpcs/admin.rpcs';

import { RpcInternalServerError } from '@shared/errors/rpc-errors';
import { Effect } from 'effect';

import {
  ObjectStorage,
  ObjectStorageNotFoundError,
} from '../integrations/object-storage';
import {
  tenantBrandAssetContentTypeFromFileName,
  tenantBrandAssetStorageKey,
} from '../tenant-brand-assets';

const response = (body: BodyInit, status: number) =>
  new Response(body, { status });

const isTenantBrandAssetKind = (
  value: string,
): value is AdminTenantBrandAssetKind =>
  value === 'favicon' || value === 'logo';

export const handleTenantBrandAssetWebRequest = (input: {
  fileName: string;
  kind: string;
  tenantId: string;
}) =>
  Effect.gen(function* () {
    if (!input.tenantId.trim() || !isTenantBrandAssetKind(input.kind)) {
      return response('Image not found', 404);
    }

    const fileName = input.fileName.trim();
    const contentType = tenantBrandAssetContentTypeFromFileName(fileName);
    if (!fileName || !contentType) {
      return response('Image not found', 404);
    }

    const storageKey = tenantBrandAssetStorageKey({
      fileName,
      kind: input.kind,
      tenantId: input.tenantId,
    });
    const body = yield* ObjectStorage.get(storageKey).pipe(
      Effect.catchIf(
        (error) => error instanceof ObjectStorageNotFoundError,
        () => Effect.succeed(null),
      ),
      Effect.mapError(
        () =>
          new RpcInternalServerError({
            message: 'The organization image could not be loaded. Try again.',
          }),
      ),
    );
    if (!body) {
      return response('Image not found', 404);
    }

    return new Response(body, {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': contentType,
      },
    });
  });
