import { ConfigError, ConfigProvider, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { formatConfigError } from './config-error';
import { objectStorageConfig } from './object-storage-config';

const readObjectStorageConfig = (provider: ConfigProvider.ConfigProvider) =>
  Effect.runSync(
    objectStorageConfig.pipe(
      Effect.withConfigProvider(provider),
      Effect.mapError(
        (error: ConfigError.ConfigError) =>
          new Error(
            `Invalid object storage configuration:\n${formatConfigError(error)}`,
          ),
      ),
    ),
  );

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

    expect(() => readObjectStorageConfig(legacyProvider)).toThrow(
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

    expect(readObjectStorageConfig(provider)).toEqual({
      accessKeyId: 'test-key',
      bucket: 'test-bucket',
      endpoint: 'https://s3.example.test',
      region: 'auto',
      secretAccessKey: 'test-secret',
    });
  });
});
