import { ConfigProvider } from 'effect';
import { describe, expect, it } from 'vitest';

import { loadCloudflareImagesConfigSync } from './cloudflare-images-config';

describe('cloudflare-images-config', () => {
  it('rejects the deprecated CLOUDFLARE_TOKEN alias', () => {
    const provider = ConfigProvider.fromMap(
      new Map([
        ['CLOUDFLARE_ACCOUNT_ID', 'account-id'],
        ['CLOUDFLARE_IMAGES_DELIVERY_HASH', 'delivery-hash'],
        ['CLOUDFLARE_TOKEN', 'legacy-token'],
      ]),
    );

    expect(() => loadCloudflareImagesConfigSync(provider)).toThrow(
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

    expect(loadCloudflareImagesConfigSync(provider)).toMatchObject({
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_IMAGES_API_TOKEN: 'api-token',
      CLOUDFLARE_IMAGES_DELIVERY_HASH: 'delivery-hash',
    });
  });
});
