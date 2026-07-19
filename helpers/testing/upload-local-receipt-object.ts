const [sourceFilePath, storageKey, mimeType] = Bun.argv.slice(2);

if (!sourceFilePath || !storageKey || !mimeType) {
  throw new Error(
    'Usage: bun upload-local-receipt-object.ts <source-file> <storage-key> <mime-type>',
  );
}

const minioHostPort = process.env['MINIO_HOST_PORT'];
if (!minioHostPort || !/^\d+$/u.test(minioHostPort)) {
  throw new Error('MINIO_HOST_PORT must identify the local MinIO host port');
}

const source = Bun.file(sourceFilePath);
if (!(await source.exists())) {
  throw new Error(`Receipt fixture file does not exist: ${sourceFilePath}`);
}

const body = new Uint8Array(await source.arrayBuffer());
const bucket = process.env['S3_BUCKET'] || 'evorto-testing';
const client = new Bun.S3Client({
  accessKeyId: process.env['MINIO_ROOT_USER'] || 'minioadmin',
  bucket,
  endpoint: `http://127.0.0.1:${minioHostPort}`,
  region: process.env['S3_REGION'] || 'us-east-1',
  secretAccessKey: process.env['MINIO_ROOT_PASSWORD'] || 'minioadmin',
  virtualHostedStyle: false,
});
const object = client.file(storageKey);
const writtenBytes = await object.write(body, { type: mimeType });
if (writtenBytes !== body.byteLength) {
  throw new Error(
    `Receipt fixture upload wrote ${writtenBytes} of ${body.byteLength} bytes`,
  );
}
if (!(await object.exists())) {
  throw new Error(`Receipt fixture object is unavailable after upload`);
}
