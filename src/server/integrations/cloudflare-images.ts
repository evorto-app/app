import consola from 'consola';
import { Schema } from 'effect';

const DEFAULT_IMAGE_VARIANT = 'public';
const TESTING_CLEANUP_CONFIRMATION = 'delete-testing-images-only';

const cloudflareDeleteImageResponseSchema = Schema.Struct({
  errors: Schema.Array(
    Schema.Struct({
      message: Schema.NonEmptyString,
    }),
  ),
  success: Schema.Boolean,
});

const cloudflareDirectUploadResponseSchema = Schema.Struct({
  errors: Schema.Array(
    Schema.Struct({
      message: Schema.NonEmptyString,
    }),
  ),
  result: Schema.optional(
    Schema.Struct({
      id: Schema.NonEmptyString,
      uploadURL: Schema.NonEmptyString,
    }),
  ),
  success: Schema.Boolean,
});

const cloudflareListImagesResponseSchema = Schema.Struct({
  errors: Schema.Array(
    Schema.Struct({
      message: Schema.NonEmptyString,
    }),
  ),
  result: Schema.optional(
    Schema.Struct({
      continuation_token: Schema.optional(Schema.NullOr(Schema.String)),
      images: Schema.Array(
        Schema.Struct({
          id: Schema.NonEmptyString,
          meta: Schema.optional(
            Schema.Record({
              key: Schema.String,
              value: Schema.Unknown,
            }),
          ),
        }),
      ),
    }),
  ),
  success: Schema.Boolean,
});

export const isCloudflareImagesConfigured = (): boolean =>
  Boolean(
    (process.env['CLOUDFLARE_IMAGES_API_TOKEN'] ??
      process.env['CLOUDFLARE_TOKEN']) &&
      process.env['CLOUDFLARE_ACCOUNT_ID'] &&
      process.env['CLOUDFLARE_IMAGES_DELIVERY_HASH'],
  );

const resolveCloudflareImagesConfig = (): {
  accountId: string;
  apiToken: string;
  appEnvironment: string;
  deliveryHash: string;
  variant: string;
} => {
  const apiToken =
    process.env['CLOUDFLARE_IMAGES_API_TOKEN'] ??
    process.env['CLOUDFLARE_TOKEN'];
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const deliveryHash = process.env['CLOUDFLARE_IMAGES_DELIVERY_HASH'];
  const variant =
    process.env['CLOUDFLARE_IMAGES_VARIANT'] ?? DEFAULT_IMAGE_VARIANT;
  const appEnvironment =
    process.env['CLOUDFLARE_IMAGES_ENVIRONMENT'] ??
    (process.env['NODE_ENV'] === 'production' ? 'production' : 'testing');

  if (!apiToken || !accountId || !deliveryHash) {
    const missing: string[] = [];
    if (!apiToken) {
      missing.push('CLOUDFLARE_IMAGES_API_TOKEN|CLOUDFLARE_TOKEN');
    }
    if (!accountId) {
      missing.push('CLOUDFLARE_ACCOUNT_ID');
    }
    if (!deliveryHash) {
      missing.push('CLOUDFLARE_IMAGES_DELIVERY_HASH');
    }

    consola.error('cloudflare-images.config.missing', {
      hasCloudflareAccountId: Boolean(accountId),
      hasCloudflareImagesApiToken: Boolean(process.env['CLOUDFLARE_IMAGES_API_TOKEN']),
      hasCloudflareImagesDeliveryHash: Boolean(deliveryHash),
      hasCloudflareToken: Boolean(process.env['CLOUDFLARE_TOKEN']),
      missing,
      nodeEnv: process.env['NODE_ENV'] ?? 'undefined',
    });

    throw new Error(
      `Cloudflare Images is not configured. Missing: ${missing.join(', ')}`,
    );
  }

  return {
    accountId,
    apiToken,
    appEnvironment,
    deliveryHash,
    variant,
  };
};

const decodeCloudflareResponse = <T,>(
  schema: Schema.Schema<T>,
  responseBody: unknown,
): T =>
  Schema.decodeUnknownSync(schema, {
    errors: 'all',
    onExcessProperty: 'ignore',
  })(responseBody);

export const createCloudflareImageDirectUpload = async (input: {
  fileName: string;
  metadata?: Record<string, string>;
  mimeType: string;
  source: 'editor' | 'finance-receipt';
  tenantId: string;
  uploadedByUserId: string;
}): Promise<{
  deliveryUrl: string;
  imageId: string;
  uploadUrl: string;
}> => {
  const config = resolveCloudflareImagesConfig();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/images/v2/direct_upload`,
    {
      body: JSON.stringify({
        metadata: {
          appEnvironment: config.appEnvironment,
          fileName: input.fileName,
          mimeType: input.mimeType,
          source: input.source,
          tenantId: input.tenantId,
          uploadedByUserId: input.uploadedByUserId,
          ...input.metadata,
        },
        requireSignedURLs: false,
      }),
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );

  const responseBody = (await response.json()) as unknown;
  const payload = decodeCloudflareResponse(
    cloudflareDirectUploadResponseSchema,
    responseBody,
  );

  if (!response.ok || !payload.success || !payload.result) {
    throw new Error(
      payload.errors.map((error) => error.message).join(', ') ||
        'Image upload initialization failed',
    );
  }

  return {
    deliveryUrl: `https://imagedelivery.net/${config.deliveryHash}/${payload.result.id}/${config.variant}`,
    imageId: payload.result.id,
    uploadUrl: payload.result.uploadURL,
  };
};

export const cleanupTestingCloudflareImages = async (input: {
  confirmPhrase: null | string;
  dryRun: boolean;
  maxDeletes?: number;
  source: 'editor' | 'finance-receipt';
}): Promise<{
  deletedImageIds: string[];
  inspectedCount: number;
  matchedCount: number;
}> => {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Cleanup is blocked in production');
  }

  if (!input.dryRun && input.confirmPhrase !== TESTING_CLEANUP_CONFIRMATION) {
    throw new Error(
      `Confirmation phrase mismatch. Use "${TESTING_CLEANUP_CONFIRMATION}"`,
    );
  }

  const config = resolveCloudflareImagesConfig();
  const matchedImageIds: string[] = [];
  let continuationToken: null | string = null;
  let inspectedCount = 0;
  let pageCount = 0;

  do {
    const query = new URLSearchParams({ per_page: '100' });
    if (continuationToken) {
      query.set('continuation_token', continuationToken);
    }

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/images/v1?${query.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
        },
        method: 'GET',
      },
    );

    const responseBody = (await response.json()) as unknown;
    const payload = decodeCloudflareResponse(
      cloudflareListImagesResponseSchema,
      responseBody,
    );

    if (!response.ok || !payload.success) {
      throw new Error(
        payload.errors.map((error) => error.message).join(', ') ||
          'Failed to list Cloudflare images',
      );
    }

    const images = payload.result?.images ?? [];
    inspectedCount += images.length;
    for (const image of images) {
      const source = image.meta?.['source'];
      const appEnvironment = image.meta?.['appEnvironment'];
      if (
        source === input.source &&
        appEnvironment === 'testing' &&
        typeof source === 'string' &&
        typeof appEnvironment === 'string'
      ) {
        matchedImageIds.push(image.id);
      }
    }

    continuationToken = payload.result?.continuation_token ?? null;
    pageCount += 1;
  } while (continuationToken && pageCount < 20);

  const limit = input.maxDeletes ?? matchedImageIds.length;
  const toDelete = matchedImageIds.slice(0, limit);

  if (!input.dryRun) {
    for (const imageId of toDelete) {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/images/v1/${imageId}`,
        {
          headers: {
            Authorization: `Bearer ${config.apiToken}`,
          },
          method: 'DELETE',
        },
      );
      const responseBody = (await response.json()) as unknown;
      const payload = decodeCloudflareResponse(
        cloudflareDeleteImageResponseSchema,
        responseBody,
      );
      if (!response.ok || !payload.success) {
        throw new Error(
          payload.errors.map((error) => error.message).join(', ') ||
            `Failed to delete image ${imageId}`,
        );
      }
    }
  }

  return {
    deletedImageIds: input.dryRun ? [] : toDelete,
    inspectedCount,
    matchedCount: matchedImageIds.length,
  };
};
