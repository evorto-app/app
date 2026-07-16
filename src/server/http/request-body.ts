import type { IncomingMessage } from 'node:http';

import * as BunStream from '@effect/platform-bun/BunStream';
import { Effect, Schema, Stream } from 'effect';
import { finished } from 'node:stream/promises';

export class RequestBodyInvalidContentLengthError extends Schema.TaggedErrorClass<RequestBodyInvalidContentLengthError>()(
  'RequestBodyInvalidContentLengthError',
  {
    contentLength: Schema.String,
  },
) {}

export class RequestBodyReadError extends Schema.TaggedErrorClass<RequestBodyReadError>()(
  'RequestBodyReadError',
  {
    cause: Schema.Defect(),
  },
) {}

export class RequestBodyTooLargeError extends Schema.TaggedErrorClass<RequestBodyTooLargeError>()(
  'RequestBodyTooLargeError',
  {
    maxBytes: Schema.Number,
  },
) {}

const contentLengthPattern = /^[0-9]+$/;
const prebufferedRequestBodies = new WeakMap<Request, ArrayBuffer>();

/** Creates a body stream that views the bounded buffer without copying it. */
export const requestBodyStreamFromBuffer = (
  body: ArrayBuffer,
): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      if (body.byteLength > 0) {
        controller.enqueue(new Uint8Array(body));
      }
      controller.close();
    },
  });

/**
 * Records that the raw Node adapter already enforced this request's body limit.
 * Request identity is used deliberately so no client-supplied header can claim
 * that an unbounded body is trusted.
 */
export const registerPrebufferedRequestBody = (
  request: Request,
  body: ArrayBuffer,
): Request => {
  prebufferedRequestBodies.set(request, body);
  return request;
};

const concatenateChunks = (chunks: readonly Uint8Array[]) => {
  const totalBytes = chunks.reduce(
    (total, chunk) => total + chunk.byteLength,
    0,
  );
  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body.buffer;
};

const cancelBody = Effect.fn('cancelRequestBody')(function* (
  body: null | ReadableStream<Uint8Array>,
) {
  if (!body) {
    return;
  }

  yield* Effect.tryPromise({
    catch: (cause) => new RequestBodyReadError({ cause }),
    try: () => body.cancel(),
  }).pipe(
    Effect.catchTag('RequestBodyReadError', (error) =>
      Effect.logDebug('Failed to cancel rejected request body').pipe(
        Effect.annotateLogs({
          error:
            error.cause instanceof Error
              ? error.cause.message
              : String(error.cause),
        }),
      ),
    ),
  );
});

const collectBoundedBody = Effect.fn('collectBoundedRequestBody')(function* <
  E,
  R,
>(body: Stream.Stream<Uint8Array, E, R>, maxBytes: number) {
  const chunks = yield* body.pipe(
    Stream.mapAccumEffect(
      () => 0,
      (totalBytes, chunk) => {
        const nextTotalBytes = totalBytes + chunk.byteLength;
        if (nextTotalBytes > maxBytes) {
          return Effect.fail(new RequestBodyTooLargeError({ maxBytes }));
        }

        return Effect.succeed<readonly [number, readonly Uint8Array[]]>([
          nextTotalBytes,
          chunk.byteLength === 0 ? [] : [chunk],
        ]);
      },
    ),
    Stream.runCollect,
  );

  return concatenateChunks(chunks);
});

const webBodyStream = (body: ReadableStream<Uint8Array>) =>
  Stream.fromReadableStream({
    evaluate: () => body,
    onError: (cause) => new RequestBodyReadError({ cause }),
  });

const nodeBodyStream = (request: IncomingMessage) =>
  BunStream.fromReadable<Uint8Array, RequestBodyReadError>({
    closeOnDone: false,
    evaluate: () => request,
    onError: (cause) => new RequestBodyReadError({ cause }),
  });

const failOnPrematureNodeBodyClose = (request: IncomingMessage) =>
  Effect.tryPromise({
    catch: (cause) => new RequestBodyReadError({ cause }),
    try: (signal) =>
      finished(request, {
        cleanup: true,
        readable: true,
        signal,
        writable: false,
      }),
  }).pipe(Effect.andThen(Effect.never));

const rejectNodeBodySynchronously = (request: IncomingMessage): void => {
  const absorbDrainError = () => null;
  request.on('error', absorbDrainError);
  request.once('close', () => {
    request.off('error', absorbDrainError);
  });
  request.resume();
};

const rejectNodeBody = (request: IncomingMessage) =>
  Effect.sync(() => rejectNodeBodySynchronously(request));

/**
 * Reads a Web request body without allowing either a declared or streamed body
 * to exceed the route limit. The stream is cancelled as soon as the limit is
 * crossed, so callers never have to buffer an untrusted oversized payload.
 */
export const readRequestBody = Effect.fn('readRequestBody')(function* (
  request: Request,
  maxBytes: number,
) {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && !contentLengthPattern.test(contentLength)) {
    yield* cancelBody(request.body);
    return yield* new RequestBodyInvalidContentLengthError({
      contentLength,
    });
  }

  if (contentLength !== null && BigInt(contentLength) > BigInt(maxBytes)) {
    yield* cancelBody(request.body);
    return yield* new RequestBodyTooLargeError({ maxBytes });
  }

  const prebufferedBody = prebufferedRequestBodies.get(request);
  if (prebufferedBody !== undefined) {
    if (prebufferedBody.byteLength > maxBytes) {
      yield* cancelBody(request.body);
      return yield* new RequestBodyTooLargeError({ maxBytes });
    }

    return prebufferedBody;
  }

  const requestBody = request.body;
  if (!requestBody) {
    return new ArrayBuffer(0);
  }

  return yield* collectBoundedBody(webBodyStream(requestBody), maxBytes);
});

/**
 * Reads a raw Node request before Angular adapts it to a Web Request. Bun's
 * Node-to-Web bridge can surface a second unhandled rejection when a client
 * disconnects, so local Node SSR must enforce route limits at this boundary.
 */
export const readNodeRequestBody = Effect.fn('readNodeRequestBody')(function* (
  request: IncomingMessage,
  maxBytes: number,
) {
  const contentLength = request.headers['content-length'] ?? null;
  if (contentLength !== null && !contentLengthPattern.test(contentLength)) {
    yield* rejectNodeBody(request);
    return yield* new RequestBodyInvalidContentLengthError({
      contentLength,
    });
  }

  if (contentLength !== null && BigInt(contentLength) > BigInt(maxBytes)) {
    yield* rejectNodeBody(request);
    return yield* new RequestBodyTooLargeError({ maxBytes });
  }

  return yield* Effect.raceFirst(
    collectBoundedBody(nodeBodyStream(request), maxBytes),
    failOnPrematureNodeBodyClose(request),
  ).pipe(
    Effect.tapErrorTag('RequestBodyTooLargeError', () =>
      rejectNodeBody(request),
    ),
  );
});

/**
 * Discards an unsupported Node request body without retaining attacker bytes
 * or delaying the route response until an untrusted sender reaches EOF.
 */
export const discardNodeRequestBody = (request: IncomingMessage): void => {
  rejectNodeBodySynchronously(request);
};
