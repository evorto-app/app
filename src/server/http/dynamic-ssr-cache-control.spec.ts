import { HttpServerResponse } from 'effect/unstable/http';
import { describe, expect, it } from 'vitest';

import {
  applyDynamicSsrCacheControl,
  DYNAMIC_SSR_CACHE_CONTROL,
} from './dynamic-ssr-cache-control';

describe('dynamic SSR cache control', () => {
  it('overrides a rendered response with a private no-store policy', () => {
    const response = applyDynamicSsrCacheControl(
      HttpServerResponse.text('<main>private account data</main>', {
        headers: { 'Cache-Control': 'public, max-age=60' },
      }),
    );

    expect(response.headers['cache-control']).toBe(DYNAMIC_SSR_CACHE_CONTROL);
  });
});
