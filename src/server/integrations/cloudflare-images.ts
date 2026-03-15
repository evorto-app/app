import {
  RpcBadRequestError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import Cloudflare from 'cloudflare';
import { Effect, Option } from 'effect';

import {
  cloudflareImagesConfig,
  cloudflareImagesStateConfig,
} from '../config/cloudflare-images-config';

export { isCloudflareImagesConfigured } from '../config/cloudflare-images-config';

const DEFAULT_IMAGE_VARIANT = 'public';
const TESTING_CLEANUP_CONFIRMATION = 'delete-testing-images-only';

const resolveCloudflareImagesConfig = () =>
  cloudflareImagesConfig.pipe(
    Effect.map((environment) => {
      const apiToken = environment.CLOUDFLARE_IMAGES_API_TOKEN;
      const accountId = environment.CLOUDFLARE_ACCOUNT_ID;
      const deliveryHash = environment.CLOUDFLARE_IMAGES_DELIVERY_HASH;
      const variant = Option.match(environment.CLOUDFLARE_IMAGES_VARIANT, {
        onNone: () => DEFAULT_IMAGE_VARIANT,
        onSome: (configuredVariant) => configuredVariant,
      });
      const appEnvironment = Option.match(
        environment.CLOUDFLARE_IMAGES_ENVIRONMENT,
        {
          onNone: () =>
            Option.match(environment.NODE_ENV, {
              onNone: () => 'testing',
              onSome: (nodeEnvironment) =>
                nodeEnvironment === 'production' ? 'production' : 'testing',
            }),
          onSome: (configuredEnvironment) => configuredEnvironment,
        },
      );

      return {
        accountId,
        apiToken,
        appEnvironment,
        client: new Cloudflare({
          apiToken,
        }),
        deliveryHash,
        variant,
      };
    }),
    Effect.mapError(
      (error) =>
        new RpcInternalServerError({
          cause: error,
          message: 'Cloudflare Images configuration is invalid',
        }),
    ),
  );

export const createCloudflareImageDirectUpload = (input: {
  fileName: string;
  metadata?: Record<string, string>;
  mimeType: string;
  source: 'editor' | 'finance-receipt';
  tenantId: string;
  uploadedByUserId: string;
}) =>
  Effect.gen(function* () {
    const config = yield* resolveCloudflareImagesConfig();
    const metadata = {
      appEnvironment: config.appEnvironment,
      fileName: input.fileName,
      mimeType: input.mimeType,
      source: input.source,
      tenantId: input.tenantId,
      uploadedByUserId: input.uploadedByUserId,
      ...input.metadata,
    };
    const directUpload = yield* Effect.tryPromise({
      catch: (error) =>
        new RpcInternalServerError({
          cause: error,
          message: 'Image upload initialization failed',
        }),
      try: () =>
        config.client.images.v2.directUploads.create({
          account_id: config.accountId,
          metadata: JSON.stringify(metadata),
          requireSignedURLs: false,
        }),
    });

    if (!directUpload.id || !directUpload.uploadURL) {
      return yield* Effect.fail(
        new RpcInternalServerError({
          message: 'Image upload initialization failed',
        }),
      );
    }
    const imageId = directUpload.id;
    const uploadUrl = directUpload.uploadURL;

    return {
      deliveryUrl: `https://imagedelivery.net/${config.deliveryHash}/${imageId}/${config.variant}`,
      imageId,
      uploadUrl,
    };
  });

export const cleanupTestingCloudflareImages = (input: {
  confirmPhrase: string | undefined;
  dryRun: boolean;
  maxDeletes?: number;
  source: 'editor' | 'finance-receipt';
}) =>
  Effect.gen(function* () {
    const state = yield* cloudflareImagesStateConfig;
    if (
      Option.match(state.NODE_ENV, {
        onNone: () => false,
        onSome: (nodeEnvironment) => nodeEnvironment === 'production',
      })
    ) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'Cleanup is blocked in production',
        }),
      );
    }

    if (!input.dryRun && input.confirmPhrase !== TESTING_CLEANUP_CONFIRMATION) {
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: `Confirmation phrase mismatch. Use "${TESTING_CLEANUP_CONFIRMATION}"`,
        }),
      );
    }

    const config = yield* resolveCloudflareImagesConfig();
    const matchedImageIds: string[] = [];
    let continuationToken: string | undefined;
    let inspectedCount = 0;
    let pageCount = 0;

    do {
      const page = yield* Effect.tryPromise({
        catch: (error) =>
          new RpcInternalServerError({
            cause: error,
            message: 'Failed to list Cloudflare Images',
          }),
        try: () =>
          config.client.images.v2.list({
            account_id: config.accountId,
            ...(continuationToken === undefined
              ? {}
              : { continuation_token: continuationToken }),
            per_page: 100,
          }),
      });

      const images = page.images ?? [];
      inspectedCount += images.length;
      for (const image of images) {
        if (!image.id) {
          continue;
        }
        const metadata = image.meta;
        if (
          !metadata ||
          typeof metadata !== 'object' ||
          Array.isArray(metadata)
        ) {
          continue;
        }

        const source = (metadata as Record<string, unknown>)['source'];
        const appEnvironment = (metadata as Record<string, unknown>)[
          'appEnvironment'
        ];
        if (
          source === input.source &&
          appEnvironment === 'testing' &&
          typeof source === 'string' &&
          typeof appEnvironment === 'string'
        ) {
          matchedImageIds.push(image.id);
        }
      }

      continuationToken = page.continuation_token ?? undefined;
      pageCount += 1;
    } while (continuationToken && pageCount < 20);

    const limit = input.maxDeletes ?? matchedImageIds.length;
    const toDelete = matchedImageIds.slice(0, limit);

    if (!input.dryRun) {
      for (const imageId of toDelete) {
        yield* Effect.tryPromise({
          catch: (error) =>
            new RpcInternalServerError({
              cause: error,
              message: 'Failed to delete Cloudflare Image',
            }),
          try: () =>
            config.client.images.v1.delete(imageId, {
              account_id: config.accountId,
            }),
        });
      }
    }

    return {
      deletedImageIds: input.dryRun ? [] : toDelete,
      inspectedCount,
      matchedCount: matchedImageIds.length,
    };
  });
