import { describe, expect, it, vi } from '@effect/vitest';
import { Effect } from 'effect';

import {
  makeBrowserErrorTelemetryHandler,
  sanitizeBrowserErrorPayload,
} from './browser-error-telemetry.web-handler';

const telemetryRequest = (
  payload: unknown,
  headers: HeadersInit = {},
  host = 'staging.evorto.app',
) =>
  new Request(`https://${host}/telemetry/browser-errors`, {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      Host: host,
      Origin: `https://${host}`,
      ...headers,
    },
    method: 'POST',
  });

describe('browser error telemetry', () => {
  it('redacts claim codes, tokens, identities, emails, and URL queries', () => {
    const claimCode = 'ABCD-1234-EF56-7890-ABCD-1234-EF56-7890';
    const sanitized = sanitizeBrowserErrorPayload({
      message: `Bearer secret.token.value for auth0|person, person@example.test, and ${claimCode}`,
      name: 'Error',
      stack: `request 01890f84-4a73-7e10-9c1b-0242ac120002 ${claimCode}`,
      url: 'https://staging.evorto.app/registration-transfers?token=secret#private',
    });

    expect(sanitized.message).not.toContain('secret.token.value');
    expect(sanitized.message).not.toContain('auth0|person');
    expect(sanitized.message).not.toContain('person@example.test');
    expect(sanitized.message).not.toContain(claimCode);
    expect(sanitized.stack).not.toContain(
      '01890f84-4a73-7e10-9c1b-0242ac120002',
    );
    expect(sanitized.stack).not.toContain(claimCode);
    expect(sanitized.url).toBe(
      'https://staging.evorto.app/registration-transfers',
    );
  });

  it.effect('accepts same-origin JSON and deduplicates repeated reports', () =>
    Effect.gen(function* () {
      const log = vi.fn(() => Effect.void);
      const handler = makeBrowserErrorTelemetryHandler({ log, now: () => 100 });
      const payload = {
        message: 'render failed',
        name: 'Error',
        stack: 'Error: render failed',
        url: 'https://staging.evorto.app/events',
      };

      const first = yield* handler(telemetryRequest(payload));
      const second = yield* handler(telemetryRequest(payload));

      expect(first.status).toBe(204);
      expect(second.status).toBe(204);
      expect(log).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect('includes the sanitized URL in the deduplication fingerprint', () =>
    Effect.gen(function* () {
      const log = vi.fn(() => Effect.void);
      const handler = makeBrowserErrorTelemetryHandler({ log, now: () => 100 });
      const payload = {
        message: 'render failed',
        name: 'Error',
        stack: 'Error: render failed',
      };

      yield* handler(
        telemetryRequest({
          ...payload,
          url: 'https://staging.evorto.app/events/one?secret=first',
        }),
      );
      yield* handler(
        telemetryRequest({
          ...payload,
          url: 'https://staging.evorto.app/events/two?secret=second',
        }),
      );

      expect(log).toHaveBeenCalledTimes(2);
    }),
  );

  it.effect('isolates deduplication state by trusted host', () =>
    Effect.gen(function* () {
      const log = vi.fn(() => Effect.void);
      const handler = makeBrowserErrorTelemetryHandler({ log, now: () => 100 });
      const payload = {
        message: 'render failed',
        name: 'Error',
        stack: null,
        url: null,
      };

      yield* handler(telemetryRequest(payload));
      yield* handler(telemetryRequest(payload, {}, 'tenant-two.evorto.app'));

      expect(log).toHaveBeenCalledTimes(2);
    }),
  );

  it.effect('fails closed for cross-origin and malformed reports', () =>
    Effect.gen(function* () {
      const handler = makeBrowserErrorTelemetryHandler({
        log: () => Effect.void,
      });

      const crossOrigin = yield* handler(
        telemetryRequest(
          { message: 'x', name: 'Error', stack: null, url: null },
          { Origin: 'https://attacker.example' },
        ),
      );
      const malformed = yield* handler(
        telemetryRequest({ message: 'missing required fields' }),
      );

      expect(crossOrigin.status).toBe(403);
      expect(malformed.status).toBe(400);
    }),
  );

  it.effect('rate limits a noisy source without logging beyond the limit', () =>
    Effect.gen(function* () {
      const log = vi.fn(() => Effect.void);
      let now = 100;
      const handler = makeBrowserErrorTelemetryHandler({
        log,
        now: () => now,
      });

      for (let index = 0; index < 10; index += 1) {
        now += 1;
        const response = yield* handler(
          telemetryRequest({
            message: `failure-${index}`,
            name: 'Error',
            stack: null,
            url: null,
          }),
        );
        expect(response.status).toBe(204);
      }
      const limited = yield* handler(
        telemetryRequest({
          message: 'failure-11',
          name: 'Error',
          stack: null,
          url: null,
        }),
      );

      expect(limited.status).toBe(429);
      expect(log).toHaveBeenCalledTimes(10);

      const otherHost = yield* handler(
        telemetryRequest(
          {
            message: 'failure-11',
            name: 'Error',
            stack: null,
            url: null,
          },
          {},
          'tenant-two.evorto.app',
        ),
      );

      expect(otherHost.status).toBe(204);
      expect(log).toHaveBeenCalledTimes(11);
    }),
  );
});
