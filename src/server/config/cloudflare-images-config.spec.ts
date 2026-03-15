import { describe, expect, it } from '@effect/vitest';
import { ConfigError, ConfigProvider, Effect } from 'effect';

import { cloudflareImagesConfig } from './cloudflare-images-config';
import { formatConfigError } from './config-error';

const readCloudflareImagesConfig = (provider: ConfigProvider.ConfigProvider) =>
  cloudflareImagesConfig.pipe(
    Effect.withConfigProvider(provider),
    Effect.mapError(
      (error: ConfigError.ConfigError) =>
        new Error(
          `Invalid Cloudflare Images configuration:\n${formatConfigError(error)}`,
        ),
    ),
  );

describe('cloudflare-images-config', () => {
  it.effect('rejects the deprecated CLOUDFLARE_TOKEN alias', () =>
    Effect.gen(function* () {
    const provider = ConfigProvider.fromMap(
      new Map([
        ['CLOUDFLARE_ACCOUNT_ID', 'account-id'],
        ['CLOUDFLARE_IMAGES_DELIVERY_HASH', 'delivery-hash'],
        ['CLOUDFLARE_TOKEN', 'legacy-token'],
      ]),
    );

    const error = yield* Effect.flip(readCloudflareImagesConfig(provider));
    expect(error.message).toMatch(/CLOUDFLARE_IMAGES_API_TOKEN/);
    })
  );

  it.effect('accepts CLOUDFLARE_IMAGES_API_TOKEN', () =>
    Effect.gen(function* () {
    const provider = ConfigProvider.fromMap(
      new Map([
        ['CLOUDFLARE_ACCOUNT_ID', 'account-id'],
        ['CLOUDFLARE_IMAGES_API_TOKEN', 'api-token'],
        ['CLOUDFLARE_IMAGES_DELIVERY_HASH', 'delivery-hash'],
      ]),
    );

    expect(yield* readCloudflareImagesConfig(provider)).toMatchObject({
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_IMAGES_API_TOKEN: 'api-token',
      CLOUDFLARE_IMAGES_DELIVERY_HASH: 'delivery-hash',
    });
    })
  );
});
