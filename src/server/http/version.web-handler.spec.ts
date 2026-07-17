import { describe, expect, it } from 'vitest';

import { createVersionWebResponse } from './version.web-handler';

describe('version endpoint', () => {
  it('returns immutable deployment identity without caching', async () => {
    const response = createVersionWebResponse({
      environment: 'staging',
      imageDigest: 'sha256:abc123',
      revision: '0123456789abcdef',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      environment: 'staging',
      imageDigest: 'sha256:abc123',
      revision: '0123456789abcdef',
    });
  });
});
