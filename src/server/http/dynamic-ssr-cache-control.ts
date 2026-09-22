import { HttpServerResponse } from 'effect/unstable/http';

export const DYNAMIC_SSR_CACHE_CONTROL = 'private, no-store';

export const applyDynamicSsrCacheControl = (
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.setHeader(
    response,
    'Cache-Control',
    DYNAMIC_SSR_CACHE_CONTROL,
  );
