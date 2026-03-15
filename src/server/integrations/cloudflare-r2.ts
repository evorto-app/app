import { Effect } from 'effect';

import { objectStorageConfig } from '../config/object-storage-config';

interface BunS3Client {
  file(key: string): BunS3File;
}

type BunS3ClientConstructor = new (config: {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  region?: string;
  secretAccessKey: string;
  virtualHostedStyle?: boolean;
}) => BunS3Client;

interface BunS3File {
  presign(input?: {
    contentDisposition?: string;
    expiresIn?: number;
    method?: 'DELETE' | 'GET' | 'HEAD' | 'POST' | 'PUT';
  }): string;
  write(
    body: Uint8Array,
    options?: {
      type?: string;
    },
  ): Promise<number>;
}

interface ObjectStorageRuntimeConfig {
  bucket: string;
  endpoint: string;
  keyId: string;
  keySecret: string;
  region: string;
}

const getBunS3ClientConstructor = () => {
  const bunRuntime = (
    globalThis as typeof globalThis & {
      Bun?: {
        S3Client?: BunS3ClientConstructor;
      };
    }
  ).Bun;

  const constructor = bunRuntime?.S3Client;
  if (!constructor) {
    throw new Error('Bun runtime is required for object storage operations.');
  }

  return constructor;
};

const resolveObjectStorageConfig = () =>
  objectStorageConfig.pipe(
    Effect.map((environment) => ({
      bucket: environment.bucket,
      endpoint: environment.endpoint,
      keyId: environment.accessKeyId,
      keySecret: environment.secretAccessKey,
      region: environment.region,
    })),
  );

const buildS3Client = (
  config: ObjectStorageRuntimeConfig,
) => {
  const S3Client = getBunS3ClientConstructor();
  return new S3Client({
    accessKeyId: config.keyId,
    bucket: config.bucket,
    endpoint: config.endpoint,
    region: config.region,
    secretAccessKey: config.keySecret,
    virtualHostedStyle: false,
  });
};

export const uploadReceiptOriginalToR2 = (input: {
  body: Uint8Array;
  contentType: string;
  key: string;
}) =>
  Effect.gen(function* () {
    const config = yield* resolveObjectStorageConfig();
    const client = buildS3Client(config);

    yield* Effect.tryPromise({
      catch: (cause) =>
        new Error(`R2 upload failed for key ${input.key}`, {
          cause: cause instanceof Error ? cause : new Error(String(cause)),
        }),
      try: () =>
        client.file(input.key).write(input.body, {
          type: input.contentType,
        }),
    });

    return {
      storageKey: input.key,
      storageUrl: `${config.endpoint.replace(/\/$/, '')}/${config.bucket}/${input.key}`,
    };
  });

export const getSignedReceiptObjectUrlFromR2 = (input: {
  expiresInSeconds?: number;
  key: string;
}) =>
  Effect.gen(function* () {
    const config = yield* resolveObjectStorageConfig();
    const client = buildS3Client(config);

    return client.file(input.key).presign({
      contentDisposition: 'inline',
      expiresIn: input.expiresInSeconds ?? 60 * 15,
      method: 'GET',
    });
  });
