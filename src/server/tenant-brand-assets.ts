import type { AdminTenantBrandAssetKind } from '@shared/rpc-contracts/app-rpcs/admin.rpcs';

import { Database, type DatabaseClient } from '@db/index';
import { tenantBrandAssetUploads, tenants } from '@db/schema';
import {
  RpcBadRequestError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { Clock, Duration, Effect, Schedule } from 'effect';
import { randomUUID } from 'node:crypto';

import {
  ObjectStorage,
  ObjectStorageNotFoundError,
} from './integrations/object-storage';
import { reportPollingWorkerFailure } from './runtime/polling-worker-supervision';

export const MAX_TENANT_BRAND_ASSET_SIZE_BYTES = 5 * 1024 * 1024;

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

    const assetUrl = tenantBrandAssetUrl({
      fileName,
      kind: input.kind,
      tenantId: input.tenantId,
    });
    const database = yield* Database;
    const now = new Date(yield* Clock.currentTimeMillis);
    const expiresAt = new Date(now.getTime() + brandAssetRetentionMilliseconds);
    // Commit ownership before issuing this key's only PUT. Interruption or an
    // uncertain storage/settlement result must never make the key unreachable.
    yield* database
      .insert(tenantBrandAssetUploads)
      .values({
        assetUrl,
        expiresAt,
        kind: input.kind,
        nextCleanupAt: expiresAt,
        storageKey,
        tenantId: input.tenantId,
      })
      .pipe(Effect.orDie);

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

    const settledAt = new Date(yield* Clock.currentTimeMillis);
    const [settled] = yield* database
      .update(tenantBrandAssetUploads)
      .set({
        putSucceededAt: settledAt,
        status: sql`case when ${tenantBrandAssetUploads.status} = 'uploading' and ${tenantBrandAssetUploads.expiresAt} > ${settledAt.toISOString()}::timestamp then 'ready'::tenant_brand_asset_status else ${tenantBrandAssetUploads.status} end`,
      })
      .where(eq(tenantBrandAssetUploads.storageKey, storageKey))
      .returning({ status: tenantBrandAssetUploads.status })
      .pipe(Effect.orDie);
    if (settled?.status !== 'ready')
      return yield* Effect.fail(unavailableBrandAsset());

    return {
      assetUrl,
      sizeBytes: body.byteLength,
      storageKey,
    };
  });

const brandAssetRetentionMilliseconds = 24 * 60 * 60 * 1000;
const cleanupLeaseMilliseconds = 15 * 60 * 1000;
const cleanupIntervalMilliseconds = 5 * 60 * 1000;
const unavailableBrandAsset = () =>
  new RpcBadRequestError({
    message:
      'This organization image is no longer available. Upload or select the image again before saving.',
  });

type BrandAssetSelection = Pick<
  typeof tenants.$inferSelect,
  'faviconUrl' | 'logoUrl'
>;

/** Caller holds the organization row lock; assets are always locked after it. */
export const associateTenantBrandAssets = Effect.fn(
  'associateTenantBrandAssets',
)(function* (
  transaction: Pick<DatabaseClient, 'select' | 'update'>,
  input: {
    next: BrandAssetSelection;
    previous: BrandAssetSelection;
    tenantId: string;
  },
) {
  const changed = (['favicon', 'logo'] as const).filter(
    (kind) => input.previous[`${kind}Url`] !== input.next[`${kind}Url`],
  );
  const urls = changed
    .flatMap((kind) => [input.previous[`${kind}Url`], input.next[`${kind}Url`]])
    .filter((url): url is string => !!url && url.startsWith('/tenant-assets/'));
  if (urls.length === 0) return;
  const assets = yield* transaction
    .select()
    .from(tenantBrandAssetUploads)
    .where(
      and(
        eq(tenantBrandAssetUploads.tenantId, input.tenantId),
        inArray(tenantBrandAssetUploads.assetUrl, urls),
      ),
    )
    .orderBy(asc(tenantBrandAssetUploads.storageKey))
    .for('update');
  const now = new Date(yield* Clock.currentTimeMillis);
  for (const kind of changed) {
    const nextUrl = input.next[`${kind}Url`];
    const selected = assets.find((asset) => asset.assetUrl === nextUrl);
    if (nextUrl?.startsWith('/tenant-assets/')) {
      if (
        !selected ||
        selected.kind !== kind ||
        selected.status !== 'ready' ||
        selected.expiresAt <= now ||
        !selected.putSucceededAt
      ) {
        return yield* Effect.fail(unavailableBrandAsset());
      }
      yield* transaction
        .update(tenantBrandAssetUploads)
        .set({ nextCleanupAt: null, status: 'attached' })
        .where(eq(tenantBrandAssetUploads.id, selected.id));
    }
    const previous = assets.find(
      (asset) => asset.assetUrl === input.previous[`${kind}Url`],
    );
    if (
      previous?.status === 'attached' &&
      !Object.values(input.next).includes(previous.assetUrl)
    ) {
      const expiresAt = new Date(
        now.getTime() + brandAssetRetentionMilliseconds,
      );
      yield* transaction
        .update(tenantBrandAssetUploads)
        .set({ expiresAt, nextCleanupAt: expiresAt, status: 'ready' })
        .where(eq(tenantBrandAssetUploads.id, previous.id));
    }
  }
});

export const processTenantBrandAssetOrphans = Effect.fn(
  'processTenantBrandAssetOrphans',
)(
  function* (options: { batchSize?: number; now?: Date } = {}) {
    const now = options.now ?? new Date(yield* Clock.currentTimeMillis);
    const batchSize = Number.isFinite(options.batchSize ?? 25)
      ? Math.min(100, Math.max(1, Math.trunc(options.batchSize ?? 25)))
      : 25;
    const database = yield* Database;
    const storage = yield* ObjectStorage;
    const candidates = yield* database
      .select({
        id: tenantBrandAssetUploads.id,
        tenantId: tenantBrandAssetUploads.tenantId,
      })
      .from(tenantBrandAssetUploads)
      .where(lte(tenantBrandAssetUploads.nextCleanupAt, now))
      .orderBy(
        asc(tenantBrandAssetUploads.nextCleanupAt),
        asc(tenantBrandAssetUploads.id),
      )
      .limit(batchSize);
    let deleted = 0;
    let retained = 0;
    for (const candidate of candidates) {
      const claim = yield* database.transaction((transaction) =>
        Effect.gen(function* () {
          const [tenant] = yield* transaction
            .select({
              faviconUrl: tenants.faviconUrl,
              logoUrl: tenants.logoUrl,
            })
            .from(tenants)
            .where(eq(tenants.id, candidate.tenantId))
            .for('update', { skipLocked: true });
          if (!tenant) return;
          const [asset] = yield* transaction
            .select()
            .from(tenantBrandAssetUploads)
            .where(eq(tenantBrandAssetUploads.id, candidate.id))
            .for('update', { skipLocked: true });
          if (
            !asset ||
            asset.status === 'attached' ||
            !asset.nextCleanupAt ||
            asset.nextCleanupAt > now ||
            asset.expiresAt > now ||
            tenant?.logoUrl === asset.assetUrl ||
            tenant?.faviconUrl === asset.assetUrl
          )
            return;
          const token = randomUUID();
          yield* transaction
            .update(tenantBrandAssetUploads)
            .set({
              cleanupClaimToken: token,
              nextCleanupAt: new Date(now.getTime() + cleanupLeaseMilliseconds),
              status: 'cleaning',
            })
            .where(eq(tenantBrandAssetUploads.id, asset.id));
          return { ...asset, token };
        }),
      );
      if (!claim) continue;
      yield* storage
        .deleteObject(claim.storageKey)
        .pipe(
          Effect.catch((error) =>
            error instanceof ObjectStorageNotFoundError
              ? Effect.void
              : Effect.fail(error),
          ),
        );
      const ownedClaim = and(
        eq(tenantBrandAssetUploads.id, claim.id),
        eq(tenantBrandAssetUploads.status, 'cleaning'),
        eq(tenantBrandAssetUploads.cleanupClaimToken, claim.token),
      );
      // Settlement must precede this DELETE. A PUT settling during an earlier
      // unknown-outcome deletion can recreate the object after that deletion.
      if (claim.putSucceededAt) {
        const removed = yield* database
          .delete(tenantBrandAssetUploads)
          .where(ownedClaim)
          .returning({ id: tenantBrandAssetUploads.id });
        deleted += removed.length;
      } else {
        const retainedRows = yield* database
          .update(tenantBrandAssetUploads)
          .set({
            cleanupClaimToken: null,
            nextCleanupAt: new Date(
              now.getTime() + cleanupIntervalMilliseconds,
            ),
          })
          .where(ownedClaim)
          .returning({ id: tenantBrandAssetUploads.id });
        retained += retainedRows.length;
      }
    }
    return { deleted, retained, scanned: candidates.length };
  },
  (effect, _options: { batchSize?: number; now?: Date } = {}) =>
    effect.pipe(Effect.timeout('30 seconds')),
);

export const runTenantBrandAssetCleanupWorker =
  processTenantBrandAssetOrphans().pipe(
    Effect.tap((summary) =>
      summary.scanned > 0
        ? Effect.logInfo('Processed organization image upload orphans').pipe(
            Effect.annotateLogs(summary),
          )
        : Effect.void,
    ),
    Effect.catchCause(
      reportPollingWorkerFailure('Organization image cleanup iteration failed'),
    ),
    Effect.repeat(
      Schedule.spaced(Duration.millis(cleanupIntervalMilliseconds)),
    ),
  );
