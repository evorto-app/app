import { loadObjectStorageConfigSync } from '../config/object-storage-config';

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

const getBunS3ClientConstructor = (): BunS3ClientConstructor => {
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

const resolveObjectStorageConfig = (): {
  bucket: string;
  endpoint: string;
  keyId: string;
  keySecret: string;
  region: string;
} => {
  const environment = loadObjectStorageConfigSync();
  const endpoint = environment.endpoint;
  const keyId = environment.accessKeyId;
  const keySecret = environment.secretAccessKey;
  const bucket = environment.bucket;
  const region = environment.region;

  return { bucket, endpoint, keyId, keySecret, region };
};

const buildS3Client = (
  config: ReturnType<typeof resolveObjectStorageConfig>,
): BunS3Client => {
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

export const uploadReceiptOriginalToR2 = async (input: {
  body: Uint8Array;
  contentType: string;
  key: string;
}): Promise<{
  storageKey: string;
  storageUrl: string;
}> => {
  const config = resolveObjectStorageConfig();
  const client = buildS3Client(config);

  await client.file(input.key).write(input.body, {
    type: input.contentType,
  });

  return {
    storageKey: input.key,
    storageUrl: `${config.endpoint.replace(/\/$/, '')}/${config.bucket}/${input.key}`,
  };
};

export const getSignedReceiptObjectUrlFromR2 = async (input: {
  expiresInSeconds?: number;
  key: string;
}): Promise<string> => {
  const config = resolveObjectStorageConfig();
  const client = buildS3Client(config);

  return client.file(input.key).presign({
    contentDisposition: 'inline',
    expiresIn: input.expiresInSeconds ?? 60 * 15,
    method: 'GET',
  });
};
