export interface SeedReceiptEvidence {
  body: Uint8Array;
  write(storageKey: string): Promise<void>;
}

// Only the local walkthrough writes sample evidence. Test/documentation tenants
// keep their existing isolated upload fixtures; staging never receives demo files.
export const createLocalSeedReceiptEvidence = async (config: {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  secretAccessKey: string;
}): Promise<SeedReceiptEvidence> => {
  const endpoint = new URL(config.endpoint);
  if (
    !['localhost', '127.0.0.1', '[::1]', 'minio'].includes(endpoint.hostname)
  ) {
    throw new Error(
      'Walkthrough receipt evidence requires local object storage',
    );
  }
  const body = new Uint8Array(
    await Bun.file(
      new URL('./fixtures/sample-receipt.pdf', import.meta.url),
    ).arrayBuffer(),
  );
  const storage = new Bun.S3Client({
    ...config,
    region: 'us-east-1',
    virtualHostedStyle: false,
  });
  return {
    body,
    async write(storageKey) {
      const file = storage.file(storageKey);
      const count = await file.write(body, { type: 'application/pdf' });
      if (count !== body.byteLength || !(await file.exists()))
        throw new Error(
          'Walkthrough receipt evidence was not stored completely',
        );
    },
  };
};
