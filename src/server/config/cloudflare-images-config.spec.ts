import { ConfigError, ConfigProvider, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { cloudflareImagesConfig } from './cloudflare-images-config';
import { formatConfigError } from './config-error';

const readCloudflareImagesConfig = (provider: ConfigProvider.ConfigProvider) =>
  Effect.runSync(
    cloudflareImagesConfig.pipe(
      Effect.withConfigProvider(provider),
      Effect.mapError(
        (error: ConfigError.ConfigError) =>
          new Error(
            `Invalid Cloudflare Images configuration:\n${formatConfigError(error)}`,
          ),
      ),
    ),
  );

describe('cloudflare-images-config', () => {
  it('rejects the deprecated CLOUDFLARE_TOKEN alias', () => {
    const provider = ConfigProvider.fromMap(
      new Map([
        ['CLOUDFLARE_ACCOUNT_ID', 'account-id'],
        ['CLOUDFLARE_IMAGES_DELIVERY_HASH', 'delivery-hash'],
        ['CLOUDFLARE_TOKEN', 'legacy-token'],
      ]),
    );

    expect(() => readCloudflareImagesConfig(provider)).toThrow(
      /CLOUDFLARE_IMAGES_API_TOKEN/,
    );
  });

  it('accepts CLOUDFLARE_IMAGES_API_TOKEN', () => {
    const provider = ConfigProvider.fromMap(
      new Map([
        ['CLOUDFLARE_ACCOUNT_ID', 'account-id'],
        ['CLOUDFLARE_IMAGES_API_TOKEN', 'api-token'],
        ['CLOUDFLARE_IMAGES_DELIVERY_HASH', 'delivery-hash'],
      ]),
    );

    expect(readCloudflareImagesConfig(provider)).toMatchObject({
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_IMAGES_API_TOKEN: 'api-token',
      CLOUDFLARE_IMAGES_DELIVERY_HASH: 'delivery-hash',
    });
  });
});
