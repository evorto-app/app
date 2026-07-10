import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import {
  readRequestBody,
  RequestBodyInvalidContentLengthError,
  RequestBodyReadError,
  RequestBodyTooLargeError,
} from './request-body';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const createStreamRequest = (
  chunks: readonly string[],
  headers?: HeadersInit,
) => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  const init = {
    body,
    duplex: 'half',
    headers,
    method: 'POST',
  } satisfies RequestInit & { duplex: 'half' };

  return new Request('https://tenant.example.com/request-body', init);
};

describe('readRequestBody', () => {
  it.effect('accepts a streamed body at the exact route limit', () =>
    Effect.gen(function* () {
      const request = createStreamRequest(['ab', 'cd']);

      const body = yield* readRequestBody(request, 4);

      expect(decoder.decode(body)).toBe('abcd');
    }),
  );

  it.effect('accepts a valid Content-Length with leading zeroes', () =>
    Effect.gen(function* () {
      const request = createStreamRequest(['abcd'], {
        'content-length': '0004',
      });

      const body = yield* readRequestBody(request, 4);

      expect(decoder.decode(body)).toBe('abcd');
    }),
  );

  it.effect(
    'rejects an oversized declared Content-Length before buffering',
    () =>
      Effect.gen(function* () {
        const request = new Request('https://tenant.example.com/request-body', {
          body: 'x',
          headers: { 'content-length': '5' },
          method: 'POST',
        });

        const error = yield* readRequestBody(request, 4).pipe(Effect.flip);

        expect(error).toBeInstanceOf(RequestBodyTooLargeError);
        expect(error.maxBytes).toBe(4);
      }),
  );

  it.effect('rejects an oversized stream when Content-Length is missing', () =>
    Effect.gen(function* () {
      const request = createStreamRequest(['abc', 'de']);
      expect(request.headers.get('content-length')).toBeNull();

      const error = yield* readRequestBody(request, 4).pipe(Effect.flip);

      expect(error).toBeInstanceOf(RequestBodyTooLargeError);
    }),
  );

  it.effect('does not trust a smaller declared Content-Length', () =>
    Effect.gen(function* () {
      const request = createStreamRequest(['abc', 'de'], {
        'content-length': '1',
      });

      const error = yield* readRequestBody(request, 4).pipe(Effect.flip);

      expect(error).toBeInstanceOf(RequestBodyTooLargeError);
    }),
  );

  it.effect('rejects an invalid Content-Length', () =>
    Effect.gen(function* () {
      const request = createStreamRequest(['abc'], {
        'content-length': 'three',
      });

      const error = yield* readRequestBody(request, 4).pipe(Effect.flip);

      expect(error).toBeInstanceOf(RequestBodyInvalidContentLengthError);
      expect(error.contentLength).toBe('three');
    }),
  );

  it.effect('wraps body stream failures in a typed read error', () =>
    Effect.gen(function* () {
      const body = new ReadableStream<Uint8Array>({
        pull() {
          throw new Error('stream failed');
        },
      });
      const init = {
        body,
        duplex: 'half',
        method: 'POST',
      } satisfies RequestInit & { duplex: 'half' };
      const request = new Request(
        'https://tenant.example.com/request-body',
        init,
      );

      const error = yield* readRequestBody(request, 4).pipe(Effect.flip);

      expect(error).toBeInstanceOf(RequestBodyReadError);
      expect(error.cause).toBeInstanceOf(Error);
    }),
  );
});
