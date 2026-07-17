export interface ApplicationVersion {
  environment: 'local' | 'production' | 'staging';
  imageDigest: string;
  revision: string;
}

const noStoreHeaders = {
  'Cache-Control': 'no-store',
};

export const createVersionWebResponse = (
  version: ApplicationVersion,
): Response => Response.json(version, { headers: noStoreHeaders });
