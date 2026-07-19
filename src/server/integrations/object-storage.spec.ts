import { describe, expect, it } from '@effect/vitest';

import type { ObjectStorageConfig } from '../config/object-storage-config';

import { createS3PresignedPost } from './object-storage';

const config: ObjectStorageConfig = {
  accessKeyId: 'AKIATEST',
  bucket: 'evorto-app-data',
  endpoint: 'https://s3.fr-par.scw.cloud',
  publicEndpoint: 'https://s3.fr-par.scw.cloud',
  region: 'fr-par',
  secretAccessKey: 'secret-value',
};

describe('ObjectStorage', () => {
  it('creates an exact-key private signed POST policy', () => {
    const result = createS3PresignedPost({
      config,
      contentType: 'application/pdf',
      expiresAt: new Date('2026-07-16T12:05:00.000Z'),
      key: 'receipts/tenant/event/user/upload-receipt.pdf',
      now: new Date('2026-07-16T12:00:00.000Z'),
      sizeBytes: 4096,
    });
    const policy = JSON.parse(
      Buffer.from(result.fields['policy'] ?? '', 'base64').toString('utf8'),
    ) as { conditions: unknown[]; expiration: string };

    expect(result.url).toBe('https://s3.fr-par.scw.cloud/evorto-app-data/');
    expect(result.fields['key']).toBe(
      'receipts/tenant/event/user/upload-receipt.pdf',
    );
    expect(result.fields['acl']).toBe('private');
    expect(result.fields['x-amz-server-side-encryption']).toBeUndefined();
    expect(policy.expiration).toBe('2026-07-16T12:05:00.000Z');
    expect(policy.conditions).toContainEqual({ acl: 'private' });
    expect(policy.conditions).toContainEqual({
      key: 'receipts/tenant/event/user/upload-receipt.pdf',
    });
    expect(policy.conditions).toContainEqual([
      'content-length-range',
      4096,
      4096,
    ]);
  });

  it('does not expose the storage secret in returned form fields', () => {
    const result = createS3PresignedPost({
      config,
      contentType: 'image/png',
      expiresAt: new Date('2026-07-16T12:05:00.000Z'),
      key: 'receipts/exact.png',
      now: new Date('2026-07-16T12:00:00.000Z'),
      sizeBytes: 8,
    });

    expect(JSON.stringify(result)).not.toContain(config.secretAccessKey);
    expect(result.fields['x-amz-signature']).toMatch(/^[0-9a-f]{64}$/u);
  });
});
