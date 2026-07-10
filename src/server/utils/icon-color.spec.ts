import { describe, expect, it } from '@effect/vitest';
import { PNG } from 'pngjs';

import { createIconColorResolver } from './icon-color';

const createPng = (width = 128, height = 128): Uint8Array => {
  const png = new PNG({ height, width });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 200;
    png.data[index + 1] = 50;
    png.data[index + 2] = 25;
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png);
};

const createPngResponse = (bytes = createPng()): Response =>
  new Response(bytes, {
    headers: {
      'content-length': String(bytes.byteLength),
      'content-type': 'image/png',
    },
    status: 200,
  });

const createDeferredResponse = () => {
  const { promise, resolve } = Promise.withResolvers<Response>();
  return { promise, resolve } as const;
};

describe('icon color resolver', () => {
  it('fetches only the fixed Icons8 host with bounded redirect and timeout options', async () => {
    let requestedUrl = '';
    let requestOptions: RequestInit | undefined;
    const fetchImplementation: typeof globalThis.fetch = (input, options) => {
      requestedUrl = String(input);
      requestOptions = options;
      return Promise.resolve(createPngResponse());
    };
    const resolver = createIconColorResolver({ fetchImplementation });

    const result = await resolver.resolve('calendar:color');

    expect(result._tag).toBe('success');
    expect(requestedUrl).toBe('https://img.icons8.com/color/128/calendar.png');
    expect(requestOptions?.redirect).toBe('error');
    expect(requestOptions?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects oversized responses before decoding', async () => {
    const fetchImplementation: typeof globalThis.fetch = () =>
      Promise.resolve(
        new Response(new Uint8Array(), {
          headers: {
            'content-length': String(256 * 1024 + 1),
            'content-type': 'image/png',
          },
          status: 200,
        }),
      );
    const resolver = createIconColorResolver({ fetchImplementation });

    await expect(resolver.resolve('calendar')).resolves.toEqual({
      _tag: 'unavailable',
      reason: 'responseTooLarge',
    });
  });

  it('requires a decodable 128 by 128 PNG', async () => {
    const fetchImplementation: typeof globalThis.fetch = () =>
      Promise.resolve(createPngResponse(createPng(64, 64)));
    const resolver = createIconColorResolver({ fetchImplementation });

    await expect(resolver.resolve('calendar')).resolves.toEqual({
      _tag: 'unavailable',
      reason: 'invalidPng',
    });
  });

  it('allows at most two concurrent cache-miss resolutions', async () => {
    const first = createDeferredResponse();
    const second = createDeferredResponse();
    const pendingResponses = [first, second];
    let fetchCount = 0;
    const fetchImplementation: typeof globalThis.fetch = () => {
      const pendingResponse = pendingResponses[fetchCount];
      fetchCount += 1;
      return pendingResponse
        ? pendingResponse.promise
        : Promise.reject(new Error('Unexpected fetch'));
    };
    const resolver = createIconColorResolver({ fetchImplementation });

    const firstResolution = resolver.resolve('calendar');
    const secondResolution = resolver.resolve('city');
    await expect(resolver.resolve('map')).resolves.toEqual({ _tag: 'busy' });
    expect(fetchCount).toBe(2);

    first.resolve(createPngResponse());
    second.resolve(createPngResponse());
    await Promise.all([firstResolution, secondResolution]);
  });

  it('keeps the LRU cache bounded and refreshes evicted entries', async () => {
    let fetchCount = 0;
    const fetchImplementation: typeof globalThis.fetch = () => {
      fetchCount += 1;
      return Promise.resolve(createPngResponse());
    };
    const resolver = createIconColorResolver({
      fetchImplementation,
      maxCacheEntries: 2,
    });

    await resolver.resolve('calendar');
    await resolver.resolve('city');
    await resolver.resolve('calendar');
    await resolver.resolve('map');
    await resolver.resolve('city');

    expect(fetchCount).toBe(4);
  });

  it('caches failures only until the failure TTL expires', async () => {
    let fetchCount = 0;
    let now = 1000;
    const fetchImplementation: typeof globalThis.fetch = () => {
      fetchCount += 1;
      return Promise.resolve(new Response('missing', { status: 404 }));
    };
    const resolver = createIconColorResolver({
      failureCacheTtlMs: 30,
      fetchImplementation,
      now: () => now,
    });

    await resolver.resolve('missing');
    await resolver.resolve('missing');
    expect(fetchCount).toBe(1);

    now += 31;
    await resolver.resolve('missing');
    expect(fetchCount).toBe(2);
  });
});
