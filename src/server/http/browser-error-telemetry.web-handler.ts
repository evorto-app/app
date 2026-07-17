import { Effect, Schema } from 'effect';

import { readRequestBody } from './request-body';

export const MAX_BROWSER_ERROR_TELEMETRY_BODY_SIZE_BYTES = 8 * 1024;

const maxEventsPerWindow = 10;
const rateLimitWindowMs = 60_000;
const deduplicationWindowMs = 60_000;
const noStoreHeaders = { 'Cache-Control': 'no-store' };

interface BrowserErrorTelemetryHandlerOptions {
  log: (payload: BrowserErrorPayload) => Effect.Effect<void>;
  now?: () => number;
}

class BrowserErrorPayload extends Schema.Class<BrowserErrorPayload>(
  'BrowserErrorPayload',
)({
  message: Schema.String,
  name: Schema.String,
  stack: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
}) {}

const redactPatterns = (value: string): string =>
  value
    .replaceAll(/(bearer\s+)[a-z0-9._~+/=-]+/giu, '$1[REDACTED]')
    .replaceAll(
      /\b[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/giu,
      '[REDACTED_TOKEN]',
    )
    .replaceAll(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
      '[REDACTED_ID]',
    )
    .replaceAll(/\bauth0\|[a-z0-9_-]+\b/giu, '[REDACTED_ID]')
    .replaceAll(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
      '[REDACTED_EMAIL]',
    );

const sanitizeUrl = (value: null | string): null | string => {
  if (value === null) {
    return null;
  }

  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return redactPatterns(url.href).slice(0, 1000);
  } catch {
    return null;
  }
};

export const sanitizeBrowserErrorPayload = (
  payload: BrowserErrorPayload,
): BrowserErrorPayload =>
  BrowserErrorPayload.make({
    message: redactPatterns(payload.message).slice(0, 2000),
    name: redactPatterns(payload.name).slice(0, 200),
    stack:
      payload.stack === null
        ? null
        : redactPatterns(payload.stack).slice(0, 4000),
    url: sanitizeUrl(payload.url),
  });

const stableFingerprint = (payload: BrowserErrorPayload): string => {
  const value = `${payload.name}\u{0}${payload.message}\u{0}${payload.stack ?? ''}`;
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16);
};

const hasTrustedOrigin = (request: Request): boolean => {
  const originValue = request.headers.get('origin');
  if (!originValue) {
    return false;
  }

  try {
    const origin = new URL(originValue);
    const requestUrl = new URL(request.url);
    const requestHost = request.headers.get('host') ?? requestUrl.host;
    const requestProtocol = requestUrl.protocol.replace(/:$/u, '');
    return (
      origin.host === requestHost && origin.protocol === `${requestProtocol}:`
    );
  } catch {
    return false;
  }
};

const decodePayload = (body: ArrayBuffer) =>
  Effect.try(() => JSON.parse(new TextDecoder().decode(body))).pipe(
    Effect.flatMap((value) =>
      Schema.decodeUnknownEffect(BrowserErrorPayload)(value),
    ),
    Effect.option,
  );

export const makeBrowserErrorTelemetryHandler = ({
  log,
  now = Date.now,
}: BrowserErrorTelemetryHandlerOptions) => {
  let eventCount = 0;
  let windowStartedAt = 0;
  const fingerprints = new Map<string, number>();

  return Effect.fn('handleBrowserErrorTelemetry')(function* (request: Request) {
    if (!hasTrustedOrigin(request)) {
      return new Response(null, { headers: noStoreHeaders, status: 403 });
    }
    if (
      request.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase() !== 'application/json'
    ) {
      return new Response(null, { headers: noStoreHeaders, status: 415 });
    }

    const body = yield* readRequestBody(
      request,
      MAX_BROWSER_ERROR_TELEMETRY_BODY_SIZE_BYTES,
    ).pipe(
      Effect.catchTags({
        RequestBodyInvalidContentLengthError: () => Effect.succeed(null),
        RequestBodyReadError: () => Effect.succeed(null),
        RequestBodyTooLargeError: () => Effect.succeed(null),
      }),
    );
    if (body === null) {
      return new Response(null, { headers: noStoreHeaders, status: 413 });
    }

    const payloadOption = yield* decodePayload(body);
    if (payloadOption._tag === 'None') {
      return new Response(null, { headers: noStoreHeaders, status: 400 });
    }

    const currentTime = now();
    if (currentTime - windowStartedAt >= rateLimitWindowMs) {
      eventCount = 0;
      windowStartedAt = currentTime;
    }
    eventCount += 1;
    if (eventCount > maxEventsPerWindow) {
      return new Response(null, { headers: noStoreHeaders, status: 429 });
    }

    const sanitizedPayload = sanitizeBrowserErrorPayload(payloadOption.value);
    const fingerprint = stableFingerprint(sanitizedPayload);
    const lastSeenAt = fingerprints.get(fingerprint);
    for (const [candidate, seenAt] of fingerprints) {
      if (currentTime - seenAt >= deduplicationWindowMs) {
        fingerprints.delete(candidate);
      }
    }
    fingerprints.set(fingerprint, currentTime);
    if (
      lastSeenAt === undefined ||
      currentTime - lastSeenAt >= deduplicationWindowMs
    ) {
      yield* log(sanitizedPayload);
    }

    return new Response(null, { headers: noStoreHeaders, status: 204 });
  });
};

export const handleBrowserErrorTelemetryWebRequest =
  makeBrowserErrorTelemetryHandler({
    log: (payload) =>
      Effect.logError('Browser error').pipe(
        Effect.annotateLogs({ browserError: payload }),
      ),
  });
