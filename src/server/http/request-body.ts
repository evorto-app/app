import { Effect, Schema, Stream } from 'effect';

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

  const requestBody = request.body;
  if (!requestBody) {
    return new ArrayBuffer(0);
  }

  const chunks = yield* Stream.fromReadableStream({
    evaluate: () => requestBody,
    onError: (cause) => new RequestBodyReadError({ cause }),
  }).pipe(
    Stream.mapAccumEffect(
      () => 0,
      (totalBytes, chunk) => {
        const nextTotalBytes = totalBytes + chunk.byteLength;
        if (nextTotalBytes > maxBytes) {
          return Effect.fail(new RequestBodyTooLargeError({ maxBytes }));
        }

        return Effect.succeed<readonly [number, readonly Uint8Array[]]>([
          nextTotalBytes,
          [chunk],
        ]);
      },
    ),
    Stream.runCollect,
  );

  return concatenateChunks(chunks);
});
