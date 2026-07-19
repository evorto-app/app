import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { ConfigProvider, Effect } from 'effect';

import {
  EmailDelivery,
  EmailDeliveryRetryableError,
  EmailDeliveryUnknownError,
} from './email-delivery';

const request = {
  html: '<p>Hello</p>',
  idempotencyKey: 'registration-confirmed/tenant-1/registration-1',
  replyTo: {
    email: 'board@example.org',
    name: 'Example Section',
  },
  subject: 'Registration confirmed',
  text: 'Hello',
  to: 'member@example.org',
} as const;

const configLayer = (env: Readonly<Record<string, string>>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env }));

const temLayer = (environment: 'local' | 'production' | 'staging' = 'local') =>
  configLayer({
    APP_ENVIRONMENT: environment,
    EMAIL_DELIVERY_PROVIDER: 'tem',
    STAGING_EMAIL_ALLOWLIST: 'allowed@example.org',
    TEM_API_TOKEN: 'tem-secret-token',
    TEM_PROJECT_ID: 'project-1',
  });

describe('EmailDelivery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.effect('sends through TEM with the fixed sender and tenant reply-to', () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn(async () =>
        Response.json({ emails: [{ id: 'tem-message-1' }] }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const result = yield* EmailDelivery.deliver(request).pipe(
        Effect.provide(EmailDelivery.Default),
        Effect.provide(temLayer()),
      );

      expect(result).toEqual({
        _tag: 'Delivered',
        provider: 'tem',
        providerMessageId: 'tem-message-1',
      });
      const [url, init] = fetchMock.mock.calls[0] ?? [];
      expect(url).toBe(
        'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails',
      );
      expect(init?.headers).toEqual({
        'Content-Type': 'application/json',
        'X-Auth-Token': 'tem-secret-token',
      });
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual(
        expect.objectContaining({
          from: {
            email: 'no-reply@notifications.evorto.app',
            name: 'Evorto',
          },
          project_id: 'project-1',
          to: [{ email: 'member@example.org' }],
        }),
      );
      expect(body.additional_headers).toEqual(
        expect.arrayContaining([
          {
            key: 'Reply-To',
            value: 'Example Section <board@example.org>',
          },
          {
            key: 'X-Evorto-Idempotency-Key',
            value: request.idempotencyKey,
          },
        ]),
      );
    }),
  );

  it.effect(
    'suppresses staging recipients outside the protected allowlist',
    () =>
      Effect.gen(function* () {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const result = yield* EmailDelivery.deliver(request).pipe(
          Effect.provide(EmailDelivery.Default),
          Effect.provide(temLayer('staging')),
        );

        expect(result).toEqual({
          _tag: 'Suppressed',
          provider: 'tem',
          reason: 'Recipient is outside the protected staging allowlist',
        });
        expect(fetchMock).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'classifies explicit provider overload responses as retryable',
    () =>
      Effect.gen(function* () {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => new Response('{}', { status: 503 })),
        );

        const error = yield* EmailDelivery.deliver(request).pipe(
          Effect.provide(EmailDelivery.Default),
          Effect.provide(temLayer()),
          Effect.flip,
        );

        expect(error).toBeInstanceOf(EmailDeliveryRetryableError);
        expect(error.message).toBe('tem email request failed with HTTP 503');
      }),
  );

  it.effect('marks network failures as an ambiguous delivery outcome', () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('connection reset');
        }),
      );

      const error = yield* EmailDelivery.deliver(request).pipe(
        Effect.provide(EmailDelivery.Default),
        Effect.provide(temLayer()),
        Effect.flip,
      );

      expect(error).toBeInstanceOf(EmailDeliveryUnknownError);
      expect(error.message).toContain('delivery outcome is unknown');
    }),
  );

  it.effect(
    'marks malformed successful responses as an ambiguous outcome',
    () =>
      Effect.gen(function* () {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => Response.json({ emails: [] })),
        );

        const error = yield* EmailDelivery.deliver(request).pipe(
          Effect.provide(EmailDelivery.Default),
          Effect.provide(temLayer()),
          Effect.flip,
        );

        expect(error).toBeInstanceOf(EmailDeliveryUnknownError);
        expect(error.message).toContain('returned no email record');
      }),
  );

  it.effect('uses the Mailpit HTTP API for local delivery', () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn(async () => Response.json({ ID: 'mailpit-1' }));
      vi.stubGlobal('fetch', fetchMock);

      const result = yield* EmailDelivery.deliver(request).pipe(
        Effect.provide(EmailDelivery.Default),
        Effect.provide(
          configLayer({
            APP_ENVIRONMENT: 'local',
            EMAIL_DELIVERY_PROVIDER: 'mailpit',
            MAILPIT_API_URL: 'http://127.0.0.1:8025/api/v1/send',
          }),
        ),
      );

      expect(result).toEqual({
        _tag: 'Delivered',
        provider: 'mailpit',
        providerMessageId: 'mailpit-1',
      });
      const [url, init] = fetchMock.mock.calls[0] ?? [];
      expect(String(url)).toBe('http://127.0.0.1:8025/api/v1/send');
      expect(JSON.parse(String(init?.body))).toEqual(
        expect.objectContaining({
          From: {
            Email: 'no-reply@notifications.evorto.app',
            Name: 'Evorto',
          },
          ReplyTo: [{ Email: 'board@example.org', Name: 'Example Section' }],
          To: [{ Email: 'member@example.org' }],
        }),
      );
    }),
  );
});
