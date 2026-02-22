import { getCloudflareR2Environment } from '../config/environment';

interface BunS3Client {
  file(key: string): BunS3File;
}

type BunS3ClientConstructor = new (config: {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  secretAccessKey: string;
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
    throw new Error(
      'Bun runtime is required for Cloudflare R2 storage operations.',
    );
  }

  return constructor;
};

const resolveCloudflareR2Config = (): {
  bucket: string;
  endpoint: string;
  keyId: string;
  keySecret: string;
} => {
  const environment = getCloudflareR2Environment();
  const endpoint = environment.CLOUDFLARE_R2_S3_ENDPOINT;
  const keyId = environment.CLOUDFLARE_R2_S3_KEY_ID;
  const keySecret = environment.CLOUDFLARE_R2_S3_KEY;
  const bucket = environment.CLOUDFLARE_R2_BUCKET;

  return { bucket, endpoint, keyId, keySecret };
};

const buildS3Client = (
  config: ReturnType<typeof resolveCloudflareR2Config>,
): BunS3Client => {
  const S3Client = getBunS3ClientConstructor();
  return new S3Client({
    accessKeyId: config.keyId,
    bucket: config.bucket,
    endpoint: config.endpoint,
    secretAccessKey: config.keySecret,
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
  const config = resolveCloudflareR2Config();
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
  const config = resolveCloudflareR2Config();
  const client = buildS3Client(config);

  return client.file(input.key).presign({
    contentDisposition: 'inline',
    expiresIn: input.expiresInSeconds ?? 60 * 15,
    method: 'GET',
  });
};
