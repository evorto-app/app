import * as HttpServerRequest from '@effect/platform/HttpServerRequest';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveWebhookRateLimitKey,
  WebhookRateLimit,
  webhookRateLimitLayer,
} from './webhook-rate-limit';

describe('webhook-rate-limit', () => {
  it('prefers first x-forwarded-for address when available', () => {
    const request = HttpServerRequest.fromWeb(
      new Request('http://localhost/webhooks/stripe', {
        headers: {
          'x-forwarded-for': '203.0.113.10, 198.51.100.7',
        },
      }),
    );

    expect(resolveWebhookRateLimitKey(request)).toBe('203.0.113.10');
  });

  it('limits after 60 requests in a one-minute window', async () => {
    const program = Effect.gen(function* () {
      const rateLimit = yield* WebhookRateLimit;

      for (let index = 0; index < 60; index++) {
        const result = yield* rateLimit.consume('test-client');
        expect(result.allowed).toBe(true);
      }

      const blockedResult = yield* rateLimit.consume('test-client');
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.retryAfterSeconds).toBeGreaterThan(0);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(webhookRateLimitLayer)),
    );
  });

  it('tracks clients independently', async () => {
    const program = Effect.gen(function* () {
      const rateLimit = yield* WebhookRateLimit;

      for (let index = 0; index < 60; index++) {
        const resultA = yield* rateLimit.consume('client-a');
        expect(resultA.allowed).toBe(true);
      }

      const blockedA = yield* rateLimit.consume('client-a');
      expect(blockedA.allowed).toBe(false);

      const resultB = yield* rateLimit.consume('client-b');
      expect(resultB.allowed).toBe(true);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(webhookRateLimitLayer)),
    );
  });

  it('resets quota after one minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-13T00:00:00.000Z'));

    const program = Effect.gen(function* () {
      const rateLimit = yield* WebhookRateLimit;

      for (let index = 0; index < 60; index++) {
        const result = yield* rateLimit.consume('test-client');
        expect(result.allowed).toBe(true);
      }

      const blocked = yield* rateLimit.consume('test-client');
      expect(blocked.allowed).toBe(false);

      vi.advanceTimersByTime(60_000);

      const resultAfterWindow = yield* rateLimit.consume('test-client');
      expect(resultAfterWindow.allowed).toBe(true);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(webhookRateLimitLayer)),
    );
    vi.useRealTimers();
  });
});
