import { Effect } from 'effect';
import {
  Headers as EffectHeaders,
  HttpMiddleware,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';

import { applySecurityHeaders } from './security-headers';

const validHost =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])(?::[0-9]{1,5})?$/u;

export interface RequestBoundary {
  readonly headers: Headers;
  readonly protocol: RequestProtocol;
  readonly requestTarget: string;
  readonly url: string;
}

export interface RequestBoundaryInput {
  readonly headers: Headers;
  readonly requestTarget: string | undefined;
  readonly transportProtocol: RequestProtocol;
  readonly trustPlatformProxy: boolean;
}

type RequestProtocol = 'http' | 'https';

const resolveForwardedProtocol = (
  headers: Headers,
  trustPlatformProxy: boolean,
): RequestProtocol | undefined => {
  const forwardedProtocol = headers.get('x-forwarded-proto');
  if (!trustPlatformProxy || forwardedProtocol === null) {
    return;
  }

  const normalized = forwardedProtocol.trim().toLowerCase();
  return normalized === 'http' || normalized === 'https'
    ? normalized
    : undefined;
};

export const resolveRequestBoundary = ({
  headers: sourceHeaders,
  requestTarget,
  transportProtocol,
  trustPlatformProxy,
}: RequestBoundaryInput): RequestBoundary | undefined => {
  const headers = new Headers(sourceHeaders);
  const host = headers.get('host')?.trim();
  const target = requestTarget ?? '/';
  const suppliedForwardedProtocol = headers.has('x-forwarded-proto');

  // Tenant selection always uses the real Host header. Remove forwarded host
  // variants so later code cannot accidentally trust one.
  headers.delete('x-forwarded-host');
  headers.delete('forwarded');
  headers.delete('x-forwarded-protocol');

  const forwardedProtocol = resolveForwardedProtocol(
    headers,
    trustPlatformProxy,
  );
  if (
    trustPlatformProxy &&
    suppliedForwardedProtocol &&
    forwardedProtocol === undefined
  ) {
    return;
  }
  const protocol = forwardedProtocol ?? transportProtocol;
  headers.set('x-forwarded-proto', protocol);

  if (
    !host ||
    !validHost.test(host) ||
    host.includes('..') ||
    !target.startsWith('/') ||
    target.startsWith('//')
  ) {
    return;
  }

  try {
    const origin = new URL(`${protocol}://${host}`);
    if (
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.hostname.endsWith('.')
    ) {
      return;
    }
    const url = new URL(target, origin);
    if (url.origin !== origin.origin || url.hash !== '') {
      return;
    }
    headers.set('host', origin.host);

    return {
      headers,
      protocol,
      requestTarget: `${url.pathname}${url.search}`,
      url: url.toString(),
    };
  } catch {
    return;
  }
};

export interface RequestBoundaryMiddlewareOptions {
  readonly transportProtocol: RequestProtocol;
  readonly trustPlatformProxy: boolean;
}

const invalidRequestResponse = applySecurityHeaders(
  HttpServerResponse.text('Invalid Host or request target', { status: 400 }),
);

const toWebHeaders = (headers: EffectHeaders.Headers): Headers =>
  new Headers(Object.entries(headers));

export const makeRequestBoundaryMiddleware = (
  options: RequestBoundaryMiddlewareOptions,
) =>
  HttpMiddleware.make(
    <E, R>(
      effect: Effect.Effect<
        HttpServerResponse.HttpServerResponse,
        E,
        HttpServerRequest.HttpServerRequest | R
      >,
    ): Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      E,
      HttpServerRequest.HttpServerRequest | R
    > =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const boundary = resolveRequestBoundary({
          ...options,
          headers: toWebHeaders(request.headers),
          requestTarget: request.url,
        });
        if (!boundary) {
          return invalidRequestResponse;
        }

        const normalizedRequest = request.modify({
          headers: EffectHeaders.fromInput(boundary.headers),
          url: boundary.requestTarget,
        });

        return yield* Effect.provideService(
          effect,
          HttpServerRequest.HttpServerRequest,
          normalizedRequest,
        );
      }),
  );
