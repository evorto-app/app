import type { IncomingMessage } from 'node:http';

import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/unstable/http';

import {
  discardNodeRequestBody,
  readNodeRequestBody,
  requestBodyStreamFromBuffer,
} from './request-body';
import {
  INVALID_REQUEST_ADDRESS_MESSAGE,
  resolveNodeRequestBoundary,
} from './request-boundary';
import { applySecurityHeaders } from './security-headers';

const nodeRequestHeaders = (request: IncomingMessage) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') {
      headers.append(name, value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    }
  }
  return headers;
};

export const toNodeWebRequest = Effect.fn('NodeRequestAdapter.toWebRequest')(
  function* (
    request: IncomingMessage,
    options: {
      readonly requestBodyLimit: (
        method: string,
        pathname: string,
      ) => number | undefined;
      readonly trustPlatformProxy: boolean;
    },
  ) {
    const method = request.method ?? 'GET';
    const headers = nodeRequestHeaders(request);
    const requestBoundary = resolveNodeRequestBoundary({
      encryptedTransport:
        'encrypted' in request.socket && request.socket.encrypted === true,
      headers,
      requestTarget: request.url,
      trustPlatformProxy: options.trustPlatformProxy,
    });
    if (!requestBoundary) {
      discardNodeRequestBody(request);
      return HttpServerResponse.toWeb(
        applySecurityHeaders(
          HttpServerResponse.text(INVALID_REQUEST_ADDRESS_MESSAGE, {
            status: 400,
          }),
        ),
      );
    }

    if (method === 'GET' || method === 'HEAD') {
      discardNodeRequestBody(request);
      return new Request(requestBoundary.url, {
        headers: requestBoundary.headers,
        method,
      });
    }

    const maxBytes = options.requestBodyLimit(
      method,
      new URL(requestBoundary.url).pathname,
    );
    if (maxBytes === undefined) {
      // The Effect router has no other body-bearing routes. Fail closed before
      // adapting the raw Node stream, and never wait for an untrusted body to
      // reach EOF merely to return the route's not-found response.
      discardNodeRequestBody(request);
      return HttpServerResponse.toWeb(
        applySecurityHeaders(HttpServerResponse.empty({ status: 404 })),
      );
    }

    const body = yield* readNodeRequestBody(request, maxBytes);

    const webRequestInit = {
      body: requestBodyStreamFromBuffer(body),
      duplex: 'half',
      headers: requestBoundary.headers,
      method,
    } satisfies RequestInit & { duplex: 'half' };

    return new Request(requestBoundary.url, webRequestInit);
  },
);
