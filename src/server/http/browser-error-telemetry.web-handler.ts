import { Effect, Schema } from 'effect';

import {
  MAX_BROWSER_ERROR_TELEMETRY_BODY_SIZE_BYTES,
  sanitizeBrowserErrorTelemetryPayload,
} from '../../shared/browser-error-telemetry';
import { readRequestBody } from './request-body';

const maxEventsPerWindow = 10;
const maxTotalEventsPerWindow = 100;
const rateLimitWindowMs = 60_000;
const noStoreHeaders = { 'Cache-Control': 'no-store' };

interface BrowserErrorTelemetryHandlerOptions {
  log: (payload: BrowserErrorPayload) => Effect.Effect<void>;
  now?: () => number;
}

interface BrowserErrorTelemetryHostState {
  eventCount: number;
  readonly fingerprints: Set<string>;
}

class BrowserErrorPayload extends Schema.Class<BrowserErrorPayload>(
  'BrowserErrorPayload',
)({
  message: Schema.String,
  name: Schema.String,
  stack: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
}) {}

export const sanitizeBrowserErrorPayload = (
  payload: BrowserErrorPayload,
): BrowserErrorPayload =>
  BrowserErrorPayload.make(sanitizeBrowserErrorTelemetryPayload(payload));

const stableFingerprint = (payload: BrowserErrorPayload): string => {
  const value = `${payload.name}\u{0}${payload.message}\u{0}${payload.stack ?? ''}\u{0}${payload.url ?? ''}`;
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16);
};

const resolveSameOriginHost = (request: Request): string | undefined => {
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

/**
 * One handler owns one web process's fixed 60-second quota window: 100 admitted
 * reports total, at most 10 per host, with deduplication inside that window.
 * Other web processes and restarts have independent budgets. Same-origin hosts
 * remain caller-controlled; this bounds telemetry resources, not tenant access.
 * Clearing host state with the total quota prevents old host keys from denying
 * new hosts a renewed budget. At most 100 hosts and fingerprints can be retained.
 */
export const makeBrowserErrorTelemetryHandler = ({
  log,
  now = Date.now,
}: BrowserErrorTelemetryHandlerOptions) => {
  const hostStates = new Map<string, BrowserErrorTelemetryHostState>();
  let totalEventCount = 0;
  let totalWindowStartedAt = now();

  return Effect.fn('handleBrowserErrorTelemetry')(function* (request: Request) {
    const sameOriginHost = resolveSameOriginHost(request);
    if (!sameOriginHost) {
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
    if (currentTime - totalWindowStartedAt >= rateLimitWindowMs) {
      totalEventCount = 0;
      totalWindowStartedAt = currentTime;
      hostStates.clear();
    }
    if (totalEventCount >= maxTotalEventsPerWindow) {
      return new Response(null, { headers: noStoreHeaders, status: 429 });
    }

    let hostState = hostStates.get(sameOriginHost);
    if (!hostState) {
      hostState = {
        eventCount: 0,
        fingerprints: new Set<string>(),
      };
      hostStates.set(sameOriginHost, hostState);
    }
    if (hostState.eventCount >= maxEventsPerWindow) {
      return new Response(null, { headers: noStoreHeaders, status: 429 });
    }
    hostState.eventCount += 1;
    totalEventCount += 1;

    const sanitizedPayload = sanitizeBrowserErrorPayload(payloadOption.value);
    const fingerprint = stableFingerprint(sanitizedPayload);
    if (!hostState.fingerprints.has(fingerprint)) {
      hostState.fingerprints.add(fingerprint);
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
