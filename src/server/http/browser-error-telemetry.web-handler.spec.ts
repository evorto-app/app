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
  it.effect(
    'redacts direct transfer-link reports before logging and deduplication',
    () =>
      Effect.gen(function* () {
        const log = vi.fn(() => Effect.void);
        const handler = makeBrowserErrorTelemetryHandler({
          log,
          now: () => 100,
        });
        for (const credential of [
          'private-first-token',
          'private-second-token',
        ]) {
          const url = `https://staging.evorto.app/(primary:registration-transfers/${credential})`;
          const response = yield* handler(
            telemetryRequest({
              message: `Failed to open ${url}`,
              name: 'Error',
              stack: `at claim (${url})`,
              url,
            }),
          );
          expect(response.status).toBe(204);
        }

        expect(log).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            message:
              'Failed to open https://staging.evorto.app/(primary:registration-transfers/[REDACTED_TOKEN])',
            name: 'Error',
            stack:
              'at claim (https://staging.evorto.app/(primary:registration-transfers/[REDACTED_TOKEN]))',
            url: 'https://staging.evorto.app/(primary:registration-transfers/[REDACTED_TOKEN])',
          }),
        );
      }),
  );

  it.each([
    'https://private-user:private-password@staging.evorto.app/events?token=private-query#private-fragment',
    'https://private%40user:p%40ss%3Aword@staging.evorto.app/events?token=private-query#private-fragment',
    'https://private-user@staging.evorto.app/events?token=private-query#private-fragment',
    'https://:private-password@staging.evorto.app/events?token=private-query#private-fragment',
  ])('removes all URL credentials along with query and fragment: %s', (url) => {
    const sanitized = sanitizeBrowserErrorPayload({
      message: 'Request failed',
      name: 'Error',
      stack: null,
      url,
    });
    expect(sanitized.url).toBe('https://staging.evorto.app/events');
  });

  it.each([
    [
      'https://private-user:private-password@localhost:4200/events',
      'https://localhost:4200/events',
    ],
    [
      'https://private%40user:p%40ss%3Aword@staging.evorto.app/events',
      'https://staging.evorto.app/events',
    ],
    [
      'https://first:secret@second@staging.evorto.app/events',
      'https://staging.evorto.app/events',
    ],
    [
      'http://private-user:private-password@[::1]:4200/events',
      'http://[::1]:4200/events',
    ],
  ])(
    'removes URL credentials in every text field without losing diagnostic location: %s',
    (url, expectedUrl) => {
      const sanitized = sanitizeBrowserErrorPayload({
        message: `Request failed for "${url}"`,
        name: `FetchError: ${url}`,
        stack: `at load (${url}:12:4)`,
        url: null,
      });
      expect(sanitized.message).toBe(`Request failed for "${expectedUrl}"`);
      expect(sanitized.name).toBe(`FetchError: ${expectedUrl}`);
      expect(sanitized.stack).toBe(`at load (${expectedUrl}:12:4)`);
    },
  );

  it.each([
    'https://localhost/events@marker',
    'https://localhost?route=user@marker',
    'https://localhost#frame@marker',
    'https://localhost user@marker',
    String.raw`https://localhost\folder@marker`,
  ])(
    'does not consume non-authority text as URL credentials: %s',
    (message) => {
      expect(
        sanitizeBrowserErrorPayload({
          message,
          name: 'Error',
          stack: message,
          url: null,
        }),
      ).toMatchObject({ message, stack: message });
    },
  );

  it('preserves ordinary URL origin and path in diagnostic text', () => {
    const url = 'https://staging.evorto.app:8443/assets/main.js';
    const sanitized = sanitizeBrowserErrorPayload({
      message: `Request failed for ${url}`,
      name: 'Error',
      stack: `at load (${url}:12:4)`,
      url: `${url}?token=secret#private`,
    });
    expect(sanitized.message).toBe(`Request failed for ${url}`);
    expect(sanitized.stack).toBe(`at load (${url}:12:4)`);
    expect(sanitized.url).toBe(url);
  });

  it.effect(
    'logs only sanitized credentials and deduplicates credential-only differences',
    () =>
      Effect.gen(function* () {
        const log = vi.fn(() => Effect.void);
        const handler = makeBrowserErrorTelemetryHandler({
          log,
          now: () => 100,
        });
        for (const credentials of [
          'private-user:private-password',
          'other%40user:p%40ss%3Aword',
        ]) {
          const url = `https://${credentials}@staging.evorto.app/assets/main.js`;
          const result = yield* handler(
            telemetryRequest({
              message: `Request failed for ${url}`,
              name: 'Error',
              stack: `at load (${url}:12:4)`,
              url: `${url}?secret=private#fragment`,
            }),
          );
          expect(result.status).toBe(204);
        }
        expect(log).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            message:
              'Request failed for https://staging.evorto.app/assets/main.js',
            name: 'Error',
            stack: 'at load (https://staging.evorto.app/assets/main.js:12:4)',
            url: 'https://staging.evorto.app/assets/main.js',
          }),
        );
      }),
  );

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

  it.effect('isolates deduplication state by same-origin host', () =>
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

      now = 60_099;
      const beforeReset = yield* handler(
        telemetryRequest({
          message: 'after window',
          name: 'Error',
          stack: null,
          url: null,
        }),
      );
      expect(beforeReset.status).toBe(429);
      now = 60_100;
      const afterReset = yield* handler(
        telemetryRequest({
          message: 'after window',
          name: 'Error',
          stack: null,
          url: null,
        }),
      );
      expect(afterReset.status).toBe(204);
      expect(log).toHaveBeenCalledTimes(12);
    }),
  );

  it.effect('bounds reports across rotating hosts in one process window', () =>
    Effect.gen(function* () {
      const log = vi.fn(() => Effect.void);
      let now = 0;
      const handler = makeBrowserErrorTelemetryHandler({
        log,
        now: () => now,
      });
      const payload = {
        message: 'render failed',
        name: 'Error',
        stack: null,
        url: null,
      };

      for (let index = 0; index < 100; index += 1) {
        const response = yield* handler(
          telemetryRequest(payload, {}, `host-${index}.example.test`),
        );
        expect(response.status).toBe(204);
      }
      expect(log).toHaveBeenCalledTimes(100);

      for (let index = 100; index < 120; index += 1) {
        const response = yield* handler(
          telemetryRequest(payload, {}, `host-${index}.example.test`),
        );
        expect(response.status).toBe(429);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(yield* Effect.promise(() => response.text())).toBe('');
      }
      const malformed = yield* handler(
        telemetryRequest({ message: 'invalid' }),
      );
      const crossOrigin = yield* handler(
        telemetryRequest(payload, { Origin: 'https://attacker.example' }),
      );
      expect(malformed.status).toBe(400);
      expect(crossOrigin.status).toBe(403);

      now = 59_999;
      const beforeReset = yield* handler(telemetryRequest(payload));
      expect(beforeReset.status).toBe(429);
      expect(log).toHaveBeenCalledTimes(100);
      now = 60_000;
      const afterReset = yield* handler(telemetryRequest(payload));
      expect(afterReset.status).toBe(204);
      expect(log).toHaveBeenCalledTimes(101);
    }),
  );

  it.effect(
    'admits fresh hosts after rollover without allowing churn to reset an active host quota',
    () =>
      Effect.gen(function* () {
        const log = vi.fn(() => Effect.void);
        let now = 0;
        const handler = makeBrowserErrorTelemetryHandler({
          log,
          now: () => now,
        });
        const payload = {
          message: 'render failed',
          name: 'Error',
          stack: null,
          url: null,
        };

        now = 50_000;
        for (let index = 0; index < 100; index += 1) {
          const response = yield* handler(
            telemetryRequest(payload, {}, `host-${index}.example.test`),
          );
          expect(response.status).toBe(204);
        }
        now = 59_999;
        expect(
          (yield* handler(telemetryRequest(payload, {}, 'host-0.example.test')))
            .status,
        ).toBe(429);

        now = 60_000;
        for (let index = 0; index < 10; index += 1) {
          const response = yield* handler(
            telemetryRequest({ ...payload, message: `fresh-${index}` }),
          );
          expect(response.status).toBe(204);
        }
        for (let index = 0; index < 89; index += 1) {
          const response = yield* handler(
            telemetryRequest(payload, {}, `replacement-${index}.example.test`),
          );
          expect(response.status).toBe(204);
        }
        expect(
          (yield* handler(
            telemetryRequest({ ...payload, message: 'over host quota' }),
          )).status,
        ).toBe(429);
        expect(
          (yield* handler(telemetryRequest(payload, {}, 'final.example.test')))
            .status,
        ).toBe(204);
        expect(
          (yield* handler(
            telemetryRequest(payload, {}, 'overflow.example.test'),
          )).status,
        ).toBe(429);
        expect(log).toHaveBeenCalledTimes(200);
      }),
  );

  it.effect('renews deduplication with the process window', () =>
    Effect.gen(function* () {
      const log = vi.fn(() => Effect.void);
      let now = 0;
      const handler = makeBrowserErrorTelemetryHandler({ log, now: () => now });
      const payload = {
        message: 'same error',
        name: 'Error',
        stack: null,
        url: null,
      };
      now = 59_999;
      expect((yield* handler(telemetryRequest(payload))).status).toBe(204);
      expect((yield* handler(telemetryRequest(payload))).status).toBe(204);
      expect(log).toHaveBeenCalledTimes(1);
      now = 60_000;
      expect((yield* handler(telemetryRequest(payload))).status).toBe(204);
      expect(log).toHaveBeenCalledTimes(2);
    }),
  );

  it.effect(
    'keeps quotas and deduplication independent between web processes',
    () =>
      Effect.gen(function* () {
        const firstLog = vi.fn(() => Effect.void);
        const secondLog = vi.fn(() => Effect.void);
        const first = makeBrowserErrorTelemetryHandler({
          log: firstLog,
          now: () => 0,
        });
        const second = makeBrowserErrorTelemetryHandler({
          log: secondLog,
          now: () => 0,
        });
        const payload = {
          message: 'same error',
          name: 'Error',
          stack: null,
          url: null,
        };
        for (let index = 0; index < 100; index += 1) {
          const host = `host-${index}.example.test`;
          expect(
            (yield* first(telemetryRequest(payload, {}, host))).status,
          ).toBe(204);
          expect(
            (yield* second(telemetryRequest(payload, {}, host))).status,
          ).toBe(204);
        }
        expect((yield* first(telemetryRequest(payload))).status).toBe(429);
        expect((yield* second(telemetryRequest(payload))).status).toBe(429);
        expect(firstLog).toHaveBeenCalledTimes(100);
        expect(secondLog).toHaveBeenCalledTimes(100);
      }),
  );
});
