import type { AdminTenantBrandAssetKind } from '@shared/rpc-contracts/app-rpcs/admin.rpcs';

import { RpcInternalServerError } from '@shared/errors/rpc-errors';
import { Effect } from 'effect';

import { getObjectFromR2 } from '../integrations/cloudflare-r2';
import {
  tenantBrandAssetContentTypeFromFileName,
  tenantBrandAssetStorageKey,
} from '../tenant-brand-assets';

const response = (body: BodyInit, status: number) =>
  new Response(body, { status });

const isObjectNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return /not found|no such key|404/i.test(error.message);
};

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
      return response('Asset not found', 404);
    }

    const fileName = input.fileName.trim();
    const contentType = tenantBrandAssetContentTypeFromFileName(fileName);
    if (!fileName || !contentType) {
      return response('Asset not found', 404);
    }

    const storageKey = tenantBrandAssetStorageKey({
      fileName,
      kind: input.kind,
      tenantId: input.tenantId,
    });
    const body = yield* getObjectFromR2({ key: storageKey }).pipe(
      Effect.catchIf(isObjectNotFoundError, () => Effect.succeed(null)),
      Effect.mapError(
        (cause) =>
          new RpcInternalServerError({
            cause,
            message: 'Failed to load tenant brand asset',
          }),
      ),
    );
    if (!body) {
      return response('Asset not found', 404);
    }

    return new Response(body, {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': contentType,
      },
    });
  });
