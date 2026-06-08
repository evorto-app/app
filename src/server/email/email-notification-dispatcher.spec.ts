import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';

import {
  type EmailNotificationDispatchSummary,
  type EmailNotificationOutboxDatabase,
  makeEmailNotificationDispatcher,
} from './email-notification-dispatcher';

const enabledConfig = {
  EMAIL_FROM_ADDRESS: Option.some('Evorto <no-reply@example.com>'),
  EMAIL_OUTBOX_BATCH_SIZE: 10,
  EMAIL_OUTBOX_DISPATCH_ENABLED: true,
  EMAIL_OUTBOX_DISPATCH_INTERVAL_MS: 60_000,
  RESEND_API_KEY: Option.some('re_test'),
};

const disabledConfig = {
  ...enabledConfig,
  EMAIL_FROM_ADDRESS: Option.none<string>(),
  EMAIL_OUTBOX_DISPATCH_ENABLED: false,
  RESEND_API_KEY: Option.none<string>(),
};

const notification = {
  id: 'notification-1',
  payload: {
    eventId: 'event-1',
    eventTitle: 'City Walk',
    receiptId: 'receipt-1',
  },
  recipientEmail: 'notify@example.com',
  subject: 'Receipt approved for City Walk',
  textBody: 'Your receipt was approved.',
};

const createOutboxDatabase = ({
  notifications = [notification],
}: {
  notifications?: readonly (typeof notification)[];
}) => {
  const updates: unknown[] = [];
  const database: EmailNotificationOutboxDatabase = {
    loadDispatchableNotifications: () => Effect.succeed(notifications),
    markNotificationFailed: ({ failureMessage }) => {
      updates.push({
        failedAt: new Date(),
        failureMessage,
        status: 'failed',
      });
      return Effect.succeed();
    },
    markNotificationSent: () => {
      updates.push({
        failedAt: null,
        failureMessage: null,
        sentAt: new Date(),
        status: 'sent',
      });
      return Effect.succeed();
    },
  };

  return {
    database,
    updates,
  };
};

describe('EmailNotificationDispatcher', () => {
  it.effect('skips dispatch while disabled', () =>
    Effect.gen(function* () {
      const { database, updates } = createOutboxDatabase({});
      let fetchCalls = 0;

      const dispatcher = makeEmailNotificationDispatcher({
        config: disabledConfig,
        database,
        emailFetch: () => {
          fetchCalls += 1;
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(''),
          });
        },
      });

      const summary = yield* dispatcher.runOnce;

      expect(summary).toEqual({
        attempted: 0,
        failed: 0,
        sent: 0,
        skipped: true,
      } satisfies EmailNotificationDispatchSummary);
      expect(fetchCalls).toBe(0);
      expect(updates).toEqual([]);
    }),
  );

  it.effect(
    'sends pending notifications through Resend and marks them sent',
    () =>
      Effect.gen(function* () {
        const { database, updates } = createOutboxDatabase({});
        const requests: RequestInit[] = [];

        const dispatcher = makeEmailNotificationDispatcher({
          config: enabledConfig,
          database,
          emailFetch: (_input, init) => {
            requests.push(init);
            return Promise.resolve({
              ok: true,
              status: 200,
              text: () => Promise.resolve(''),
            });
          },
        });

        const summary = yield* dispatcher.runOnce;

        expect(summary).toEqual({
          attempted: 1,
          failed: 0,
          sent: 1,
          skipped: false,
        } satisfies EmailNotificationDispatchSummary);
        expect(requests).toHaveLength(1);
        expect(requests[0]).toEqual(
          expect.objectContaining({
            body: JSON.stringify({
              from: 'Evorto <no-reply@example.com>',
              subject: 'Receipt approved for City Walk',
              text: 'Your receipt was approved.',
              to: ['notify@example.com'],
            }),
            method: 'POST',
          }),
        );
        expect(requests[0]?.headers).toEqual(
          expect.objectContaining({
            Authorization: 'Bearer re_test',
            'Content-Type': 'application/json',
            'User-Agent': 'evorto-email-outbox/1.0',
          }),
        );
        expect(updates).toEqual([
          expect.objectContaining({
            failedAt: null,
            failureMessage: null,
            sentAt: expect.any(Date),
            status: 'sent',
          }),
        ]);
      }),
  );

  it.effect('marks provider failures as retryable failed notifications', () =>
    Effect.gen(function* () {
      const { database, updates } = createOutboxDatabase({});

      const dispatcher = makeEmailNotificationDispatcher({
        config: enabledConfig,
        database,
        emailFetch: () =>
          Promise.resolve({
            ok: false,
            status: 422,
            text: () => Promise.resolve('invalid recipient'),
          }),
      });

      const summary = yield* dispatcher.runOnce;

      expect(summary).toEqual({
        attempted: 1,
        failed: 1,
        sent: 0,
        skipped: false,
      } satisfies EmailNotificationDispatchSummary);
      expect(updates).toEqual([
        expect.objectContaining({
          failedAt: expect.any(Date),
          failureMessage:
            'Resend email send failed with status 422: invalid recipient',
          status: 'failed',
        }),
      ]);
    }),
  );

  it.effect('times out hung provider requests as retryable failures', () =>
    Effect.gen(function* () {
      const { database, updates } = createOutboxDatabase({});
      let requestSignal: AbortSignal | undefined;

      const dispatcher = makeEmailNotificationDispatcher({
        config: enabledConfig,
        database,
        emailFetch: (_input, init) => {
          requestSignal = init.signal ?? undefined;
          return new Promise<never>(() => {
            requestSignal?.addEventListener(
              'abort',
              () => {
                requestSignal = init.signal ?? undefined;
              },
              { once: true },
            );
          });
        },
        resendRequestTimeoutMs: 1,
      });

      const summary = yield* dispatcher.runOnce;

      expect(summary).toEqual({
        attempted: 1,
        failed: 1,
        sent: 0,
        skipped: false,
      } satisfies EmailNotificationDispatchSummary);
      expect(requestSignal?.aborted).toBe(true);
      expect(updates).toEqual([
        expect.objectContaining({
          failedAt: expect.any(Date),
          failureMessage: 'Resend email send timed out after 1ms',
          status: 'failed',
        }),
      ]);
    }),
  );
});
