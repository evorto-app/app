import * as HttpServerRequest from '@effect/platform/HttpServerRequest';
import { Context, Effect, Layer, Option, Ref } from 'effect';

export interface WebhookRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const WEBHOOK_RATE_LIMIT_MAX_REQUESTS_PER_WINDOW = 60;
const WEBHOOK_RATE_LIMIT_WINDOW_MS = 60_000;
const WEBHOOK_RATE_LIMIT_WINDOW_SECONDS = WEBHOOK_RATE_LIMIT_WINDOW_MS / 1000;

interface RateLimitWindow {
  count: number;
  startedAt: number;
}

class WebhookRateLimit extends Context.Tag('WebhookRateLimit')<
  WebhookRateLimit,
  {
    readonly consume: (key: string) => Effect.Effect<WebhookRateLimitResult>;
  }
>() {}

const getRemoteAddress = (
  request: HttpServerRequest.HttpServerRequest,
): string | undefined => Option.getOrUndefined(request.remoteAddress);

export const resolveWebhookRateLimitKey = (
  request: HttpServerRequest.HttpServerRequest,
): string => {
  const forwardedForHeader = request.headers['x-forwarded-for'];
  if (typeof forwardedForHeader === 'string') {
    const firstForwardedAddress = forwardedForHeader
      .split(',')
      .map((part) => part.trim())
      .find((part) => part.length > 0);
    if (firstForwardedAddress) {
      return firstForwardedAddress;
    }
  }

  return getRemoteAddress(request) ?? 'global';
};

const shouldResetWindow = (window: RateLimitWindow, now: number): boolean =>
  now - window.startedAt >= WEBHOOK_RATE_LIMIT_WINDOW_MS;

export const webhookRateLimitLayer = Layer.effect(
  WebhookRateLimit,
  Effect.gen(function* () {
    const windowsReference = yield* Ref.make(new Map<string, RateLimitWindow>());

    return {
      consume: (key: string) =>
        Ref.modify(windowsReference, (windows) => {
          const now = Date.now();
          const currentWindow = windows.get(key);
          const activeWindow =
            !currentWindow || shouldResetWindow(currentWindow, now)
              ? {
                  count: 0,
                  startedAt: now,
                }
              : currentWindow;

          if (
            activeWindow.count >= WEBHOOK_RATE_LIMIT_MAX_REQUESTS_PER_WINDOW
          ) {
            const elapsedMs = now - activeWindow.startedAt;
            const remainingWindowMs = Math.max(
              0,
              WEBHOOK_RATE_LIMIT_WINDOW_MS - elapsedMs,
            );
            const retryAfterSeconds = Math.max(
              1,
              Math.ceil(remainingWindowMs / 1000),
            );
            const blockedResult: WebhookRateLimitResult = {
              allowed: false,
              remaining: 0,
              retryAfterSeconds,
            };

            return [
              blockedResult,
              windows,
            ] as const;
          }

          const nextWindows = new Map(windows);
          const nextCount = activeWindow.count + 1;
          nextWindows.set(key, {
            ...activeWindow,
            count: nextCount,
          });

          const allowedResult: WebhookRateLimitResult = {
            allowed: true,
            remaining: WEBHOOK_RATE_LIMIT_MAX_REQUESTS_PER_WINDOW - nextCount,
            retryAfterSeconds: WEBHOOK_RATE_LIMIT_WINDOW_SECONDS,
          };

          return [allowedResult, nextWindows] as const;
        }),
    };
  }),
);

export { WebhookRateLimit };
