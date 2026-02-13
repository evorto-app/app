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
        const allowed = yield* rateLimit.consume('test-client');
        expect(allowed).toBe(true);
      }

      const blocked = yield* rateLimit.consume('test-client');
      expect(blocked).toBe(false);
    });

    await Effect.runPromise(program.pipe(Effect.provide(webhookRateLimitLayer)));
  });

  it('tracks clients independently', async () => {
    const program = Effect.gen(function* () {
      const rateLimit = yield* WebhookRateLimit;

      for (let index = 0; index < 60; index++) {
        const allowedA = yield* rateLimit.consume('client-a');
        expect(allowedA).toBe(true);
      }

      const blockedA = yield* rateLimit.consume('client-a');
      expect(blockedA).toBe(false);

      const allowedB = yield* rateLimit.consume('client-b');
      expect(allowedB).toBe(true);
    });

    await Effect.runPromise(program.pipe(Effect.provide(webhookRateLimitLayer)));
  });

  it('resets quota after one minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-13T00:00:00.000Z'));

    const program = Effect.gen(function* () {
      const rateLimit = yield* WebhookRateLimit;

      for (let index = 0; index < 60; index++) {
        const allowed = yield* rateLimit.consume('test-client');
        expect(allowed).toBe(true);
      }

      const blocked = yield* rateLimit.consume('test-client');
      expect(blocked).toBe(false);

      vi.advanceTimersByTime(60_000);

      const allowedAfterWindow = yield* rateLimit.consume('test-client');
      expect(allowedAfterWindow).toBe(true);
    });

    await Effect.runPromise(program.pipe(Effect.provide(webhookRateLimitLayer)));
    vi.useRealTimers();
  });
});
