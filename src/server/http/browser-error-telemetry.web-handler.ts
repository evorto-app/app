import { Effect, Schema } from 'effect';

import { MAX_BROWSER_ERROR_TELEMETRY_BODY_SIZE_BYTES } from '../../shared/browser-error-telemetry';
import { readRequestBody } from './request-body';

const maxEventsPerWindow = 10;
const rateLimitWindowMs = 60_000;
const deduplicationWindowMs = 60_000;
const noStoreHeaders = { 'Cache-Control': 'no-store' };

interface BrowserErrorTelemetryHandlerOptions {
  log: (payload: BrowserErrorPayload) => Effect.Effect<void>;
  now?: () => number;
}

interface BrowserErrorTelemetryHostState {
  eventCount: number;
  readonly fingerprints: Map<string, number>;
  lastSeenAt: number;
  windowStartedAt: number;
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
      /\b(?:[0-9a-f]{4}-){7}[0-9a-f]{4}\b/giu,
      '[REDACTED_CLAIM_CODE]',
    )
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
  const value = `${payload.name}\u{0}${payload.message}\u{0}${payload.stack ?? ''}\u{0}${payload.url ?? ''}`;
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16);
};

const resolveTrustedHost = (request: Request): string | undefined => {
  const originValue = request.headers.get('origin');
  if (!originValue) {
    return;
  }

  try {
    const origin = new URL(originValue);
    const requestUrl = new URL(request.url);
    if (origin.origin !== requestUrl.origin) {
      return;
    }
    return requestUrl.host.toLowerCase();
  } catch {
    return;
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
  const hostStates = new Map<string, BrowserErrorTelemetryHostState>();

  return Effect.fn('handleBrowserErrorTelemetry')(function* (request: Request) {
    const trustedHost = resolveTrustedHost(request);
    if (!trustedHost) {
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
    for (const [candidateHost, state] of hostStates) {
      if (currentTime - state.lastSeenAt >= rateLimitWindowMs) {
        hostStates.delete(candidateHost);
      }
    }
    const hostState = hostStates.get(trustedHost) ?? {
      eventCount: 0,
      fingerprints: new Map<string, number>(),
      lastSeenAt: currentTime,
      windowStartedAt: currentTime,
    };
    hostStates.set(trustedHost, hostState);
    hostState.lastSeenAt = currentTime;
    if (currentTime - hostState.windowStartedAt >= rateLimitWindowMs) {
      hostState.eventCount = 0;
      hostState.windowStartedAt = currentTime;
    }
    hostState.eventCount += 1;
    if (hostState.eventCount > maxEventsPerWindow) {
      return new Response(null, { headers: noStoreHeaders, status: 429 });
    }

    const sanitizedPayload = sanitizeBrowserErrorPayload(payloadOption.value);
    const fingerprint = stableFingerprint(sanitizedPayload);
    const lastSeenAt = hostState.fingerprints.get(fingerprint);
    for (const [candidate, seenAt] of hostState.fingerprints) {
      if (currentTime - seenAt >= deduplicationWindowMs) {
        hostState.fingerprints.delete(candidate);
      }
    }
    hostState.fingerprints.set(fingerprint, currentTime);
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

export { MAX_BROWSER_ERROR_TELEMETRY_BODY_SIZE_BYTES } from '../../shared/browser-error-telemetry';
