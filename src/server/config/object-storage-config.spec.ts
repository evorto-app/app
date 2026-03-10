import { ConfigProvider } from 'effect';
import { describe, expect, it } from 'vitest';

import { loadObjectStorageConfigSync } from './object-storage-config';

describe('object-storage-config', () => {
  it('requires canonical S3_* variables', () => {
    const legacyProvider = ConfigProvider.fromMap(
      new Map([
        ['AWS_ACCESS_KEY_ID', 'legacy-key'],
        ['AWS_ENDPOINT', 'https://s3.example.test'],
        ['AWS_REGION', 'auto'],
        ['AWS_SECRET_ACCESS_KEY', 'legacy-secret'],
      ]),
    );

    expect(() => loadObjectStorageConfigSync(legacyProvider)).toThrow(
      /S3_ENDPOINT/,
    );
  });

  it('loads canonical S3_* variables', () => {
    const provider = ConfigProvider.fromMap(
      new Map([
        ['S3_ACCESS_KEY_ID', 'test-key'],
        ['S3_BUCKET', 'test-bucket'],
        ['S3_ENDPOINT', 'https://s3.example.test'],
        ['S3_REGION', 'auto'],
        ['S3_SECRET_ACCESS_KEY', 'test-secret'],
      ]),
    );

    expect(loadObjectStorageConfigSync(provider)).toEqual({
      accessKeyId: 'test-key',
      bucket: 'test-bucket',
      endpoint: 'https://s3.example.test',
      region: 'auto',
      secretAccessKey: 'test-secret',
    });
  });
});
