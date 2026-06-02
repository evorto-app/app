import { asc, eq, inArray } from 'drizzle-orm';
import { type EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Context, Effect, Layer, Option } from 'effect';

import { Database, type DatabaseClient } from '../../db';
import {
  emailNotificationOutbox,
  type EmailNotificationPayload,
} from '../../db/schema';
import { type EmailNotificationsConfig } from '../config/email-notifications-config';
import { RuntimeConfig } from '../config/runtime-config';

export interface EmailNotificationDispatchSummary {
  attempted: number;
  failed: number;
  sent: number;
  skipped: boolean;
}

export interface EmailNotificationOutboxDatabase {
  loadDispatchableNotifications: (
    batchSize: number,
  ) => Effect.Effect<readonly EmailNotificationRow[], EffectDrizzleQueryError>;
  markNotificationFailed: (input: {
    failureMessage: string;
    id: string;
  }) => Effect.Effect<unknown, EffectDrizzleQueryError>;
  markNotificationSent: (
    id: string,
  ) => Effect.Effect<unknown, EffectDrizzleQueryError>;
}

type EmailFetch = (
  input: string,
  init: RequestInit,
) => Promise<EmailHttpResponse>;

interface EmailHttpResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

interface EmailNotificationDispatcherOptions {
  config: EmailNotificationsConfig;
  database: EmailNotificationOutboxDatabase;
  emailFetch?: EmailFetch;
}

interface EmailNotificationRow {
  id: string;
  payload: EmailNotificationPayload;
  recipientEmail: string;
  subject: string;
  textBody: string;
}

interface ResendEmailSettings {
  apiKey: string;
  fromAddress: string;
}

const resendEmailsEndpoint = 'https://api.resend.com/emails';

const dispatchFailureMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const sendWithResend = ({
  emailFetch = fetch,
  notification,
  settings,
}: {
  emailFetch?: EmailFetch | undefined;
  notification: EmailNotificationRow;
  settings: ResendEmailSettings;
}) =>
  Effect.tryPromise({
    catch: dispatchFailureMessage,
    try: async () => {
      const response = await emailFetch(resendEmailsEndpoint, {
        body: JSON.stringify({
          from: settings.fromAddress,
          subject: notification.subject,
          text: notification.textBody,
          to: [notification.recipientEmail],
        }),
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'evorto-email-outbox/1.0',
        },
        method: 'POST',
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(
          `Resend email send failed with status ${response.status}: ${responseText}`,
        );
      }
    },
  });

export const makeDrizzleEmailNotificationOutboxDatabase = (
  database: DatabaseClient,
): EmailNotificationOutboxDatabase => ({
  loadDispatchableNotifications: (batchSize) =>
    database
      .select({
        id: emailNotificationOutbox.id,
        payload: emailNotificationOutbox.payload,
        recipientEmail: emailNotificationOutbox.recipientEmail,
        subject: emailNotificationOutbox.subject,
        textBody: emailNotificationOutbox.textBody,
      })
      .from(emailNotificationOutbox)
      .where(inArray(emailNotificationOutbox.status, ['pending', 'failed']))
      .orderBy(asc(emailNotificationOutbox.createdAt))
      .limit(batchSize),
  markNotificationFailed: ({ failureMessage, id }) =>
    database
      .update(emailNotificationOutbox)
      .set({
        failedAt: new Date(),
        failureMessage,
        status: 'failed',
      })
      .where(eq(emailNotificationOutbox.id, id)),
  markNotificationSent: (id) =>
    database
      .update(emailNotificationOutbox)
      .set({
        failedAt: null,
        failureMessage: null,
        sentAt: new Date(),
        status: 'sent',
      })
      .where(eq(emailNotificationOutbox.id, id)),
});

const resolveResendSettings = (
  config: EmailNotificationsConfig,
): ResendEmailSettings | undefined => {
  if (!config.EMAIL_OUTBOX_DISPATCH_ENABLED) {
    return;
  }

  const apiKey = Option.getOrUndefined(config.RESEND_API_KEY);
  const fromAddress = Option.getOrUndefined(config.EMAIL_FROM_ADDRESS);
  if (!apiKey || !fromAddress) {
    throw new Error(
      'Email outbox dispatch is enabled without complete provider settings',
    );
  }

  return { apiKey, fromAddress };
};

export const makeEmailNotificationDispatcher = ({
  config,
  database,
  emailFetch,
}: EmailNotificationDispatcherOptions) => {
  const runOnce = Effect.gen(function* () {
    const settings = resolveResendSettings(config);
    if (!settings) {
      return {
        attempted: 0,
        failed: 0,
        sent: 0,
        skipped: true,
      } satisfies EmailNotificationDispatchSummary;
    }

    const notifications = yield* database.loadDispatchableNotifications(
      config.EMAIL_OUTBOX_BATCH_SIZE,
    );
    let sent = 0;
    let failed = 0;

    for (const notification of notifications) {
      const result = yield* sendWithResend({
        emailFetch,
        notification,
        settings,
      }).pipe(
        Effect.map(() => ({ _tag: 'Sent' as const })),
        Effect.catch((error) =>
          Effect.succeed({
            _tag: 'Failed' as const,
            failureMessage: error,
          }),
        ),
      );

      if (result._tag === 'Sent') {
        yield* database.markNotificationSent(notification.id);
        sent += 1;
        continue;
      }

      yield* database.markNotificationFailed({
        failureMessage: result.failureMessage,
        id: notification.id,
      });
      failed += 1;
    }

    return {
      attempted: notifications.length,
      failed,
      sent,
      skipped: false,
    } satisfies EmailNotificationDispatchSummary;
  });

  const runScheduled = Effect.gen(function* () {
    while (true) {
      const summary = yield* runOnce.pipe(
        Effect.catch((error: unknown) =>
          Effect.logError('Email notification outbox dispatch failed', {
            error,
          }).pipe(
            Effect.as({
              attempted: 0,
              failed: 0,
              sent: 0,
              skipped: false,
            } satisfies EmailNotificationDispatchSummary),
          ),
        ),
      );
      if (!summary.skipped && summary.attempted > 0) {
        yield* Effect.logInfo('Email notification outbox dispatch completed', {
          attempted: summary.attempted,
          failed: summary.failed,
          sent: summary.sent,
        });
      }
      yield* Effect.sleep(config.EMAIL_OUTBOX_DISPATCH_INTERVAL_MS);
    }
  });

  return {
    runOnce,
    runScheduled,
  };
};

export class EmailNotificationDispatcher extends Context.Service<EmailNotificationDispatcher>()(
  '@server/email/EmailNotificationDispatcher',
  {
    make: Effect.gen(function* () {
      const database = yield* Database;
      const runtimeConfig = yield* RuntimeConfig;
      return makeEmailNotificationDispatcher({
        config: runtimeConfig.emailNotifications,
        database: makeDrizzleEmailNotificationOutboxDatabase(database),
      });
    }),
  },
) {
  static readonly Default = Layer.effect(
    EmailNotificationDispatcher,
    EmailNotificationDispatcher.make,
  );
}
