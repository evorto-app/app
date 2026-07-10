import {
  argbFromRgb,
  QuantizerCelebi,
  Score,
} from '@material/material-color-utilities';
import { PNG } from 'pngjs';

const ICON_SOURCE_ORIGIN = 'https://img.icons8.com';
const ICON_SIZE = 128;
const MAX_RESPONSE_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 5000;
const MAX_CONCURRENT_RESOLUTIONS = 2;
const MAX_CACHE_ENTRIES = 256;
const SUCCESS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 30 * 1000;

const pngSignature = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const ihdrChunkType = Uint8Array.from([0x49, 0x48, 0x44, 0x52]);

export type IconSourceColorResult =
  | { readonly _tag: 'busy' }
  | {
      readonly _tag: 'success';
      readonly sourceColor: number | undefined;
    }
  | {
      readonly _tag: 'unavailable';
      readonly reason: IconSourceFailureReason;
    };

interface CacheEntry {
  expiresAt: number | undefined;
  promise: Promise<IconSourceColorResult>;
}

interface IconColorResolverOptions {
  readonly failureCacheTtlMs?: number;
  readonly fetchImplementation?: typeof globalThis.fetch;
  readonly maxCacheEntries?: number;
  readonly maxConcurrentResolutions?: number;
  readonly now?: () => number;
  readonly successCacheTtlMs?: number;
}

type IconSourceFailureReason =
  'invalidPng' | 'responseTooLarge' | 'timeout' | 'upstream';

class IconSourceError extends Error {
  constructor(readonly reason: IconSourceFailureReason) {
    super(reason);
  }
}

const parsePng = async (bytes: Uint8Array): Promise<PNG> =>
  new Promise<PNG>((resolve, reject) => {
    const parser = new PNG();
    parser.parse(Buffer.from(bytes), (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    });
  });

const bytesEqualAt = (
  bytes: Uint8Array,
  expected: Uint8Array,
  offset: number,
): boolean => expected.every((value, index) => bytes[offset + index] === value);

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
  );

const validatePngHeader = (bytes: Uint8Array): void => {
  if (
    bytes.length < 24 ||
    !bytesEqualAt(bytes, pngSignature, 0) ||
    readUint32(bytes, 8) !== 13 ||
    !bytesEqualAt(bytes, ihdrChunkType, 12) ||
    readUint32(bytes, 16) !== ICON_SIZE ||
    readUint32(bytes, 20) !== ICON_SIZE
  ) {
    throw new IconSourceError('invalidPng');
  }
};

const readBoundedResponse = async (response: Response): Promise<Uint8Array> => {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_RESPONSE_BYTES
  ) {
    await response.body?.cancel();
    throw new IconSourceError('responseTooLarge');
  }

  if (!response.body) {
    throw new IconSourceError('upstream');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;

      totalBytes += next.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new IconSourceError('responseTooLarge');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const sourceColorFromPng = async (
  responseBytes: Uint8Array,
): Promise<number | undefined> => {
  validatePngHeader(responseBytes);

  let png: PNG;
  try {
    png = await parsePng(responseBytes);
  } catch {
    throw new IconSourceError('invalidPng');
  }
  if (png.width !== ICON_SIZE || png.height !== ICON_SIZE) {
    throw new IconSourceError('invalidPng');
  }

  const pixels: number[] = [];
  for (let index = 0; index < png.data.length; index += 4) {
    const red = png.data[index];
    const green = png.data[index + 1];
    const blue = png.data[index + 2];
    const alpha = png.data[index + 3];
    if (alpha === 0) continue;
    pixels.push(argbFromRgb(red, green, blue));
  }

  if (pixels.length === 0) return;

  const quantizedColors = QuantizerCelebi.quantize(pixels, 128);
  return Score.score(quantizedColors)[0];
};

const fetchIconSourceColor = async (
  iconCommonName: string,
  fetchImplementation: typeof globalThis.fetch,
): Promise<number | undefined> => {
  const [name, set = 'fluent'] = iconCommonName.split(':');
  if (!name) {
    throw new IconSourceError('invalidPng');
  }

  let response: Response;
  try {
    response = await fetchImplementation(
      `${ICON_SOURCE_ORIGIN}/${set}/${ICON_SIZE}/${name}.png`,
      {
        redirect: 'error',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new IconSourceError('timeout');
    }
    throw new IconSourceError('upstream');
  }

  if (
    !response.ok ||
    response.redirected ||
    !response.headers.get('content-type')?.startsWith('image/png')
  ) {
    await response.body?.cancel();
    throw new IconSourceError('upstream');
  }

  if (response.url) {
    try {
      if (new URL(response.url).origin !== ICON_SOURCE_ORIGIN) {
        await response.body?.cancel();
        throw new IconSourceError('upstream');
      }
    } catch (error) {
      if (error instanceof IconSourceError) throw error;
      await response.body?.cancel();
      throw new IconSourceError('upstream');
    }
  }

  return sourceColorFromPng(await readBoundedResponse(response));
};

export const createIconColorResolver = (
  options: IconColorResolverOptions = {},
) => {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const maxConcurrentResolutions =
    options.maxConcurrentResolutions ?? MAX_CONCURRENT_RESOLUTIONS;
  const maxCacheEntries = options.maxCacheEntries ?? MAX_CACHE_ENTRIES;
  const successCacheTtlMs = options.successCacheTtlMs ?? SUCCESS_CACHE_TTL_MS;
  const failureCacheTtlMs = options.failureCacheTtlMs ?? FAILURE_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  let activeResolutions = 0;

  const touch = (iconCommonName: string, entry: CacheEntry): void => {
    cache.delete(iconCommonName);
    cache.set(iconCommonName, entry);
  };

  const enforceCacheLimit = (): void => {
    while (cache.size > maxCacheEntries) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) return;
      cache.delete(oldestKey);
    }
  };

  const resolve = async (
    iconCommonName: string,
  ): Promise<IconSourceColorResult> => {
    const existing = cache.get(iconCommonName);
    if (existing) {
      if (existing.expiresAt === undefined || existing.expiresAt > now()) {
        touch(iconCommonName, existing);
        return existing.promise;
      }
      cache.delete(iconCommonName);
    }

    if (activeResolutions >= maxConcurrentResolutions) {
      return { _tag: 'busy' };
    }

    activeResolutions += 1;
    const cacheEntry: CacheEntry = {
      expiresAt: undefined,
      promise: Promise.resolve({ _tag: 'busy' }),
    };
    cacheEntry.promise = fetchIconSourceColor(
      iconCommonName,
      fetchImplementation,
    )
      .then((sourceColor): IconSourceColorResult => ({
        _tag: 'success',
        sourceColor,
      }))
      .catch((error): IconSourceColorResult => ({
        _tag: 'unavailable',
        reason: error instanceof IconSourceError ? error.reason : 'upstream',
      }))
      .then((result) => {
        cacheEntry.expiresAt =
          now() +
          (result._tag === 'success' ? successCacheTtlMs : failureCacheTtlMs);
        return result;
      })
      .finally(() => {
        activeResolutions -= 1;
      });

    cache.set(iconCommonName, cacheEntry);
    enforceCacheLimit();
    return cacheEntry.promise;
  };

  return { resolve } as const;
};

const iconColorResolver = createIconColorResolver();

export const computeIconSourceColor = (
  iconCommonName: string,
): Promise<IconSourceColorResult> => iconColorResolver.resolve(iconCommonName);
