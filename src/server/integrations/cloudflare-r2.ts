import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const resolveCloudflareR2Config = (): {
  bucket: string;
  endpoint: string;
  keyId: string;
  keySecret: string;
} => {
  const endpoint = process.env['CLOUDFLARE_R2_S3_ENDPOINT'];
  const keyId = process.env['CLOUDFLARE_R2_S3_KEY_ID'];
  const keySecret = process.env['CLOUDFLARE_R2_S3_KEY'];
  const bucket = process.env['CLOUDFLARE_R2_BUCKET'] ?? 'testing';

  if (!endpoint || !keyId || !keySecret) {
    throw new Error('Cloudflare R2 is not configured');
  }

  return { bucket, endpoint, keyId, keySecret };
};

const buildS3Client = (
  config: ReturnType<typeof resolveCloudflareR2Config>,
): S3Client =>
  new S3Client({
    credentials: {
      accessKeyId: config.keyId,
      secretAccessKey: config.keySecret,
    },
    endpoint: config.endpoint,
    forcePathStyle: true,
    region: 'auto',
  });

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

  await client.send(
    new PutObjectCommand({
      Body: input.body,
      Bucket: config.bucket,
      ContentType: input.contentType,
      Key: input.key,
    }),
  );

  return {
    storageKey: input.key,
    storageUrl: `${config.endpoint.replace(/\/$/, '')}/${config.bucket}/${input.key}`,
  };
};
