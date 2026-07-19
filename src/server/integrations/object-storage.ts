import { RpcInternalServerError } from '@shared/errors/rpc-errors';
import { ConfigProvider, Context, Effect, Layer } from 'effect';
import { createHmac } from 'node:crypto';

import {
  objectStorageConfig,
  type ObjectStorageConfig,
} from '../config/object-storage-config';

export interface PresignedPostUpload {
  readonly fields: Readonly<Record<string, string>>;
  readonly url: string;
}

export interface PresignPostInput {
  readonly contentType: string;
  readonly expiresAt: Date;
  readonly key: string;
  readonly now: Date;
  readonly sizeBytes: number;
}

export interface PutObjectInput {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly key: string;
}

export interface StoredObjectMetadata {
  readonly contentType: string;
  readonly prefix: Uint8Array;
  readonly sizeBytes: number;
  readonly storageUrl: string;
}

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
  arrayBuffer(): Promise<ArrayBuffer>;
  delete(): Promise<void>;
  exists(): Promise<boolean>;
  presign(input?: {
    contentDisposition?: string;
    expiresIn?: number;
    method?: 'DELETE' | 'GET' | 'HEAD' | 'POST' | 'PUT';
  }): string;
  slice(begin?: number, end?: number): BunS3File;
  stat(): Promise<{ size: number; type: string }>;
  write(
    body: Uint8Array,
    options?: {
      type?: string;
    },
  ): Promise<number>;
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

const buildS3Client = (
  config: ObjectStorageConfig,
  endpoint = config.endpoint,
) => {
  const S3Client = getBunS3ClientConstructor();
  return new S3Client({
    accessKeyId: config.accessKeyId,
    bucket: config.bucket,
    endpoint,
    region: config.region,
    secretAccessKey: config.secretAccessKey,
    virtualHostedStyle: false,
  });
};

const storageFailure = (operation: string, key: string, cause: unknown) =>
  new RpcInternalServerError({
    cause,
    message: `Object storage ${operation} failed for key ${key}`,
  });

const hmac = (key: Buffer | string, value: string) =>
  createHmac('sha256', key).update(value).digest();

const amzTimestamp = (date: Date) =>
  date.toISOString().replaceAll(/[:-]|\.\d{3}/gu, '');

const bucketPostUrl = (config: ObjectStorageConfig) => {
  const endpoint = new URL(config.publicEndpoint);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/u, '')}/${encodeURIComponent(config.bucket)}/`;
  return endpoint.toString();
};

export const createS3PresignedPost = (input: {
  readonly config: ObjectStorageConfig;
  readonly contentType: string;
  readonly expiresAt: Date;
  readonly key: string;
  readonly now: Date;
  readonly sizeBytes: number;
}): PresignedPostUpload => {
  const timestamp = amzTimestamp(input.now);
  const dateStamp = timestamp.slice(0, 8);
  const credentialScope = `${dateStamp}/${input.config.region}/s3/aws4_request`;
  const credential = `${input.config.accessKeyId}/${credentialScope}`;
  const fields = {
    acl: 'private',
    'Content-Type': input.contentType,
    key: input.key,
    policy: '',
    success_action_status: '201',
    'x-amz-algorithm': 'AWS4-HMAC-SHA256',
    'x-amz-credential': credential,
    'x-amz-date': timestamp,
  };
  const policy = Buffer.from(
    JSON.stringify({
      conditions: [
        { bucket: input.config.bucket },
        { key: input.key },
        { 'Content-Type': input.contentType },
        { acl: fields.acl },
        { success_action_status: fields.success_action_status },
        { 'x-amz-algorithm': fields['x-amz-algorithm'] },
        { 'x-amz-credential': fields['x-amz-credential'] },
        { 'x-amz-date': fields['x-amz-date'] },
        ['content-length-range', input.sizeBytes, input.sizeBytes],
      ],
      expiration: input.expiresAt.toISOString(),
    }),
  ).toString('base64');
  const dateKey = hmac(`AWS4${input.config.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, input.config.region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');

  return {
    fields: {
      ...fields,
      policy,
      'x-amz-signature': createHmac('sha256', signingKey)
        .update(policy)
        .digest('hex'),
    },
    url: bucketPostUrl(input.config),
  };
};

export class ObjectStorage extends Context.Service<ObjectStorage>()(
  '@server/integrations/ObjectStorage',
  {
    make: Effect.gen(function* () {
      const configProvider = yield* ConfigProvider.ConfigProvider;
      const loadConfig = objectStorageConfig.pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, configProvider),
      );
      const deleteObject = Effect.fn('ObjectStorage.deleteObject')(function* (
        key: string,
      ) {
        const config = yield* loadConfig;
        const file = yield* Effect.try({
          catch: (cause) => storageFailure('client initialization', key, cause),
          try: () => buildS3Client(config).file(key),
        });
        yield* Effect.tryPromise({
          catch: (cause) => storageFailure('delete', key, cause),
          try: () => file.delete(),
        });
      });

      const exists = Effect.fn('ObjectStorage.exists')(function* (key: string) {
        const config = yield* loadConfig;
        const file = yield* Effect.try({
          catch: (cause) => storageFailure('client initialization', key, cause),
          try: () => buildS3Client(config).file(key),
        });
        return yield* Effect.tryPromise({
          catch: (cause) => storageFailure('existence check', key, cause),
          try: () => file.exists(),
        });
      });

      const get = Effect.fn('ObjectStorage.get')(function* (key: string) {
        const config = yield* loadConfig;
        const file = yield* Effect.try({
          catch: (cause) => storageFailure('client initialization', key, cause),
          try: () => buildS3Client(config).file(key),
        });
        const body = yield* Effect.tryPromise({
          catch: (cause) => storageFailure('read', key, cause),
          try: () => file.arrayBuffer(),
        });
        return new Uint8Array(body);
      });

      const metadata = Effect.fn('ObjectStorage.metadata')(function* (
        key: string,
        prefixBytes = 16,
      ) {
        const config = yield* loadConfig;
        const file = yield* Effect.try({
          catch: (cause) => storageFailure('client initialization', key, cause),
          try: () => buildS3Client(config).file(key),
        });
        const [stat, prefix] = yield* Effect.all([
          Effect.tryPromise({
            catch: (cause) => storageFailure('metadata read', key, cause),
            try: () => file.stat(),
          }),
          Effect.tryPromise({
            catch: (cause) => storageFailure('prefix read', key, cause),
            try: () => file.slice(0, prefixBytes).arrayBuffer(),
          }),
        ]);
        return {
          contentType: stat.type,
          prefix: new Uint8Array(prefix),
          sizeBytes: stat.size,
          storageUrl: `s3://${config.bucket}/${key}`,
        } satisfies StoredObjectMetadata;
      });

      const presignGet = Effect.fn('ObjectStorage.presignGet')(function* (
        key: string,
        expiresInSeconds = 60 * 15,
      ) {
        const config = yield* loadConfig;
        return yield* Effect.try({
          catch: (cause) => storageFailure('GET signing', key, cause),
          try: () =>
            buildS3Client(config, config.publicEndpoint).file(key).presign({
              contentDisposition: 'inline',
              expiresIn: expiresInSeconds,
              method: 'GET',
            }),
        });
      });

      const presignPost = Effect.fn('ObjectStorage.presignPost')(function* (
        input: PresignPostInput,
      ) {
        const config = yield* loadConfig;
        return yield* Effect.try({
          catch: (cause) => storageFailure('POST signing', input.key, cause),
          try: () => createS3PresignedPost({ ...input, config }),
        });
      });

      const put = Effect.fn('ObjectStorage.put')(function* (
        input: PutObjectInput,
      ) {
        const config = yield* loadConfig;
        const file = yield* Effect.try({
          catch: (cause) =>
            storageFailure('client initialization', input.key, cause),
          try: () => buildS3Client(config).file(input.key),
        });
        yield* Effect.tryPromise({
          catch: (cause) => storageFailure('upload', input.key, cause),
          try: () => file.write(input.body, { type: input.contentType }),
        });
        return {
          storageKey: input.key,
          storageUrl: `s3://${config.bucket}/${input.key}`,
        };
      });

      return {
        deleteObject,
        exists,
        get,
        metadata,
        presignGet,
        presignPost,
        put,
      };
    }),
  },
) {
  static readonly Default = Layer.effect(ObjectStorage, ObjectStorage.make);

  static readonly deleteObject = (key: string) =>
    ObjectStorage.use((storage) => storage.deleteObject(key));
  static readonly exists = (key: string) =>
    ObjectStorage.use((storage) => storage.exists(key));
  static readonly get = (key: string) =>
    ObjectStorage.use((storage) => storage.get(key));
  static readonly metadata = (key: string, prefixBytes?: number) =>
    ObjectStorage.use((storage) => storage.metadata(key, prefixBytes));
  static readonly presignGet = (key: string, expiresInSeconds?: number) =>
    ObjectStorage.use((storage) => storage.presignGet(key, expiresInSeconds));
  static readonly presignPost = (input: PresignPostInput) =>
    ObjectStorage.use((storage) => storage.presignPost(input));
  static readonly put = (input: PutObjectInput) =>
    ObjectStorage.use((storage) => storage.put(input));
}
