import Cloudflare from 'cloudflare';
import consola from 'consola';

const DEFAULT_IMAGE_VARIANT = 'public';
const TESTING_CLEANUP_CONFIRMATION = 'delete-testing-images-only';

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
  client: Cloudflare;
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
      hasCloudflareImagesApiToken: Boolean(
        process.env['CLOUDFLARE_IMAGES_API_TOKEN'],
      ),
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
    client: new Cloudflare({
      apiToken,
    }),
    deliveryHash,
    variant,
  };
};

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
  const metadata = {
    appEnvironment: config.appEnvironment,
    fileName: input.fileName,
    mimeType: input.mimeType,
    source: input.source,
    tenantId: input.tenantId,
    uploadedByUserId: input.uploadedByUserId,
    ...input.metadata,
  };
  const directUpload = await config.client.images.v2.directUploads.create({
    account_id: config.accountId,
    metadata: JSON.stringify(metadata),
    requireSignedURLs: false,
  });

  if (!directUpload.id || !directUpload.uploadURL) {
    throw new Error('Image upload initialization failed');
  }

  return {
    deliveryUrl: `https://imagedelivery.net/${config.deliveryHash}/${directUpload.id}/${config.variant}`,
    imageId: directUpload.id,
    uploadUrl: directUpload.uploadURL,
  };
};

export const cleanupTestingCloudflareImages = async (input: {
  confirmPhrase: string | undefined;
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
  let continuationToken: string | undefined;
  let inspectedCount = 0;
  let pageCount = 0;

  do {
    const page = await config.client.images.v2.list({
      account_id: config.accountId,
      ...(continuationToken === undefined
        ? {}
        : { continuation_token: continuationToken }),
      per_page: 100,
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
      await config.client.images.v1.delete(imageId, {
        account_id: config.accountId,
      });
    }
  }

  return {
    deletedImageIds: input.dryRun ? [] : toDelete,
    inspectedCount,
    matchedCount: matchedImageIds.length,
  };
};
