import type { DatabaseClient } from '@db/index';

import { Database } from '@db/index';
import { emailOutbox as emailOutboxTable } from '@db/schema';
import { serverEmailConfig } from '@server/config/server-config';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { Duration, Effect, Schema } from 'effect';
import { encode as encodeHtml } from 'he';
import { htmlToText } from 'html-to-text';

import type { Tenant } from '../../types/custom/tenant';

export interface EnqueueManualApprovalEmailInput {
  eventTitle: string;
  eventUrl: string;
  paymentDeadline: Date | null;
  registrationId: string;
  tenant: Pick<Tenant, 'emailSenderEmail' | 'emailSenderName' | 'id' | 'name'>;
  to: string;
}

export interface EnqueueReceiptReviewedEmailInput {
  eventTitle: string;
  receiptId: string;
  rejectionReason: null | string;
  status: 'approved' | 'rejected';
  tenant: Pick<Tenant, 'emailSenderEmail' | 'emailSenderName' | 'id' | 'name'>;
  to: string;
}

type EmailDeliveryFailure =
  EmailDeliveryExternalError | EmailDeliveryRequestError;

type EmailOutboxRow = typeof emailOutboxTable.$inferSelect;

interface TenantEmailMessage {
  html: string;
  idempotencyKey: string;
  kind: typeof emailOutboxTable.$inferInsert.kind;
  subject: string;
  tenant: Pick<Tenant, 'emailSenderEmail' | 'emailSenderName' | 'id' | 'name'>;
  to: string;
}

interface TenantEmailSender {
  email: string;
  name: string;
}

class EmailDeliveryExternalError extends Schema.TaggedErrorClass<EmailDeliveryExternalError>()(
  'EmailDeliveryExternalError',
  {
    cause: Schema.Defect(),
    message: Schema.String,
    retryable: Schema.Boolean,
  },
) {}

class EmailDeliveryRequestError extends Schema.TaggedErrorClass<EmailDeliveryRequestError>()(
  'EmailDeliveryRequestError',
  {
    message: Schema.String,
    retryable: Schema.Boolean,
  },
) {}

const defaultEmailSender = {
  email: 'no-reply@notifications.esn.world',
  name: 'ESN.WORLD',
} satisfies TenantEmailSender;

const escapeHtml = (value: string): string => encodeHtml(value);

const formatSender = ({ email, name }: TenantEmailSender): string =>
  `${name.replaceAll('"', '').trim()} <${email}>`;

const tenantReplyTo = (
  tenant: Pick<Tenant, 'emailSenderEmail' | 'emailSenderName' | 'name'>,
): null | TenantEmailSender => {
  const email = tenant.emailSenderEmail?.trim();
  if (!email) {
    return null;
  }

  return {
    email,
    name: tenant.emailSenderName?.trim() || tenant.name,
  };
};

const buildOutboxInsert = ({
  html,
  idempotencyKey,
  kind,
  subject,
  tenant,
  to,
}: TenantEmailMessage): typeof emailOutboxTable.$inferInsert => {
  const replyTo = tenantReplyTo(tenant);

  return {
    fromEmail: defaultEmailSender.email,
    fromName: defaultEmailSender.name,
    html,
    idempotencyKey,
    kind,
    replyToEmail: replyTo?.email ?? null,
    replyToName: replyTo?.name ?? null,
    subject,
    tenantId: tenant.id,
    text: htmlToText(html, { wordwrap: 100 }),
    toEmail: to,
  };
};

export const enqueueTenantEmail = (
  database: Pick<DatabaseClient, 'insert'>,
  message: TenantEmailMessage,
) =>
  database
    .insert(emailOutboxTable)
    .values(buildOutboxInsert(message))
    .onConflictDoNothing({
      target: emailOutboxTable.idempotencyKey,
    });

const renderReceiptReviewedEmail = ({
  eventTitle,
  rejectionReason,
  status,
}: Pick<
  EnqueueReceiptReviewedEmailInput,
  'eventTitle' | 'rejectionReason' | 'status'
>): string => {
  const statusLabel = status === 'approved' ? 'approved' : 'rejected';
  const safeEventTitle = escapeHtml(eventTitle);
  const safeReason = rejectionReason?.trim()
    ? `<p><strong>Reason:</strong> ${escapeHtml(rejectionReason.trim())}</p>`
    : '';

  return `<!doctype html>
<html>
  <body>
    <p>Your receipt for <strong>${safeEventTitle}</strong> was ${statusLabel}.</p>
    ${safeReason}
    <p>You can review the receipt status in Evorto.</p>
  </body>
</html>`;
};

export const enqueueReceiptReviewedEmail = (
  database: Pick<DatabaseClient, 'insert'>,
  input: EnqueueReceiptReviewedEmailInput,
) =>
  enqueueTenantEmail(database, {
    html: renderReceiptReviewedEmail(input),
    idempotencyKey: `receipt-reviewed/${input.tenant.id}/${input.receiptId}/${input.status}`,
    kind: 'receiptReviewed',
    subject:
      input.status === 'approved' ? 'Receipt approved' : 'Receipt rejected',
    tenant: input.tenant,
    to: input.to,
  });

const renderManualApprovalEmail = ({
  eventTitle,
  eventUrl,
  paymentDeadline,
}: Pick<
  EnqueueManualApprovalEmailInput,
  'eventTitle' | 'eventUrl' | 'paymentDeadline'
>): string => {
  const safeEventTitle = escapeHtml(eventTitle);
  const safeEventUrl = escapeHtml(eventUrl);
  const paymentCopy = paymentDeadline
    ? `<p>Your spot is reserved until ${escapeHtml(paymentDeadline.toISOString())}. Complete payment before that deadline to confirm your registration.</p>`
    : '<p>Your registration is confirmed.</p>';

  return `<!doctype html>
<html>
  <body>
    <p>Your registration application for <strong>${safeEventTitle}</strong> was approved.</p>
    ${paymentCopy}
    <p><a href="${safeEventUrl}">Open the event in Evorto</a></p>
  </body>
</html>`;
};

export const enqueueManualApprovalEmail = (
  database: Pick<DatabaseClient, 'insert'>,
  input: EnqueueManualApprovalEmailInput,
) =>
  enqueueTenantEmail(database, {
    html: renderManualApprovalEmail(input),
    idempotencyKey: `manual-approval/${input.tenant.id}/${input.registrationId}/${input.paymentDeadline?.toISOString() ?? 'confirmed'}`,
    kind: 'manualApproval',
    subject: input.paymentDeadline
      ? 'Registration approved: payment required'
      : 'Registration approved',
    tenant: input.tenant,
    to: input.to,
  });

const retryDelayMs = (attempts: number): number =>
  Math.min(30 * 60 * 1000, 1000 * 2 ** Math.max(0, attempts - 1));

const isRetryableResendStatus = (status: number): boolean =>
  status === 429 || status >= 500;

const errorMessageFromUnknown = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const sendOutboxRow = (row: EmailOutboxRow) =>
  Effect.gen(function* () {
    const emailConfig = yield* serverEmailConfig.pipe(
      Effect.mapError(
        (cause) =>
          new EmailDeliveryExternalError({
            cause,
            message: errorMessageFromUnknown(cause),
            retryable: true,
          }),
      ),
    );
    const body = {
      from: formatSender({ email: row.fromEmail, name: row.fromName }),
      html: row.html,
      ...(row.replyToEmail && {
        reply_to: formatSender({
          email: row.replyToEmail,
          name: row.replyToName ?? row.replyToEmail,
        }),
      }),
      subject: row.subject,
      text: row.text,
      to: row.toEmail,
    };

    const response = yield* Effect.tryPromise({
      catch: (cause) =>
        new EmailDeliveryExternalError({
          cause,
          message: errorMessageFromUnknown(cause),
          retryable: true,
        }),
      try: () =>
        fetch('https://api.resend.com/emails', {
          body: JSON.stringify(body),
          headers: {
            Authorization: `Bearer ${emailConfig.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': row.idempotencyKey,
          },
          method: 'POST',
        }),
    });

    if (!response.ok) {
      return yield* Effect.fail(
        new EmailDeliveryRequestError({
          message: `Resend email request failed: ${response.status}`,
          retryable: isRetryableResendStatus(response.status),
        }),
      );
    }

    const responseBody = yield* Effect.tryPromise(
      () => response.json() as Promise<null | { id?: unknown }>,
    ).pipe(Effect.catch(() => Effect.succeed(null)));

    return typeof responseBody?.id === 'string' ? responseBody.id : null;
  });

const markOutboxRowSent = (rowId: string, resendEmailId: null | string) =>
  Database.use((database) =>
    database
      .update(emailOutboxTable)
      .set({
        lastError: null,
        resendEmailId,
        sentAt: new Date(),
        status: 'sent',
      })
      .where(eq(emailOutboxTable.id, rowId)),
  );

const markOutboxRowFailed = (
  row: EmailOutboxRow,
  failure: EmailDeliveryFailure,
) =>
  Database.use((database) => {
    const exhausted = !failure.retryable || row.attempts >= row.maxAttempts;
    const nextAttemptAt = exhausted
      ? new Date()
      : new Date(Date.now() + retryDelayMs(row.attempts));
    return database
      .update(emailOutboxTable)
      .set({
        exhaustedAt: exhausted ? new Date() : null,
        lastError: failure.message,
        nextAttemptAt,
        status: exhausted ? 'failed' : 'queued',
      })
      .where(eq(emailOutboxTable.id, row.id));
  });

const claimOutboxRow = (rowId: string) =>
  Database.use((database) =>
    database
      .update(emailOutboxTable)
      .set({
        attempts: sql`${emailOutboxTable.attempts} + 1`,
        lastAttemptAt: new Date(),
        status: 'sending',
      })
      .where(
        and(
          eq(emailOutboxTable.id, rowId),
          inArray(emailOutboxTable.status, ['queued', 'failed']),
          isNull(emailOutboxTable.exhaustedAt),
          lte(emailOutboxTable.nextAttemptAt, new Date()),
          sql`${emailOutboxTable.attempts} < ${emailOutboxTable.maxAttempts}`,
        ),
      )
      .returning(),
  ).pipe(Effect.map((rows) => rows[0] ?? null));

export const processDueEmailOutbox = (limit = 10) =>
  Effect.gen(function* () {
    const dueRows = yield* Database.use((database) =>
      database
        .select()
        .from(emailOutboxTable)
        .where(
          and(
            inArray(emailOutboxTable.status, ['queued', 'failed']),
            isNull(emailOutboxTable.exhaustedAt),
            lte(emailOutboxTable.nextAttemptAt, new Date()),
            sql`${emailOutboxTable.attempts} < ${emailOutboxTable.maxAttempts}`,
          ),
        )
        .orderBy(asc(emailOutboxTable.nextAttemptAt))
        .limit(limit),
    );

    for (const dueRow of dueRows) {
      const claimedRow = yield* claimOutboxRow(dueRow.id);
      if (!claimedRow) {
        continue;
      }

      const delivery = yield* sendOutboxRow(claimedRow).pipe(
        Effect.map((resendEmailId) => ({
          _tag: 'Sent' as const,
          resendEmailId,
        })),
        Effect.catch((error) =>
          Effect.succeed({
            _tag: 'Failed' as const,
            failure: error,
          }),
        ),
      );

      if (delivery._tag === 'Sent') {
        yield* markOutboxRowSent(claimedRow.id, delivery.resendEmailId);
      } else {
        yield* markOutboxRowFailed(claimedRow, delivery.failure);
      }
    }

    return dueRows.length;
  });

export const runEmailOutboxProcessor = processDueEmailOutbox().pipe(
  Effect.catchCause((cause) =>
    Effect.logError('Email outbox processor failed').pipe(
      Effect.annotateLogs({ cause: String(cause) }),
    ),
  ),
  Effect.andThen(Effect.sleep(Duration.seconds(15))),
  Effect.forever,
);
