import type { DatabaseClient } from '@db/index';
import type { ReactElement } from 'react';

import { Database } from '@db/index';
import { emailOutbox as emailOutboxTable } from '@db/schema';
import { render } from '@react-email/render';
import {
  EmailDelivery,
  type EmailDeliveryError,
} from '@server/integrations/email-delivery';
import { asc, sql } from 'drizzle-orm';
import { Cause, Duration, Effect, Schema } from 'effect';

import type { RegistrationCancellationKind } from '../../shared/registration-cancellation';
import type { RegistrationCancellationActor } from './email-templates';

import {
  isIanaTimezone,
  type Tenant,
  TENANT_FORMATTING_LOCALE,
} from '../../types/custom/tenant';
import {
  emailOutboxAbandonedSendingPredicate,
  emailOutboxClaimLeaseExpiry,
  emailOutboxDispatchableByIdPredicate,
  emailOutboxDispatchablePredicate,
  emailOutboxOwnedClaimPredicate,
} from './email-outbox-lease';
import {
  ManualApprovalEmail,
  ReceiptReviewedEmail,
  registrationCancellationEmailTitle,
  RegistrationCancelledEmail,
  RegistrationConfirmedEmail,
  RegistrationTransferredEmail,
  WaitlistSpotAvailableEmail,
} from './email-templates';

export interface EnqueueManualApprovalEmailInput {
  approvalKey: string;
  eventTitle: string;
  eventUrl: string;
  paymentDeadline: Date | null;
  registrationId: string;
  tenant: ManualApprovalTenantEmailContext;
  to: string;
}

export interface EnqueueReceiptReviewedEmailInput {
  eventTitle: string;
  receiptId: string;
  receiptUrl: string;
  rejectionReason: null | string;
  status: 'approved' | 'rejected';
  tenant: TenantEmailContext;
  to: string;
}

export interface EnqueueRegistrationCancelledEmailInput {
  cancellationKind: RegistrationCancellationKind;
  cancelledBy: RegistrationCancellationActor;
  eventTitle: string;
  eventUrl: string;
  refundOutcome: 'notStarted' | 'pending';
  registrationId: string;
  tenant: TenantEmailContext;
  to: string;
}

export interface EnqueueRegistrationConfirmedEmailInput {
  eventTitle: string;
  registrationId: string;
  tenant: TenantEmailContext;
  ticketUrl: string;
  to: string;
}

export interface EnqueueRegistrationTransferredEmailInput {
  eventTitle: string;
  eventUrl: string;
  recipientRole: 'newOwner' | 'previousOwner';
  recipientUserId: string;
  refundOutcome: 'notStarted' | 'pending';
  registrationId: string;
  tenant: TenantEmailContext;
  to: string;
  transferOperationId: string;
}

export interface EnqueueWaitlistSpotAvailableEmailInput {
  availabilityKey: string;
  eventTitle: string;
  eventUrl: string;
  tenant: TenantEmailContext;
  to: string;
  waitlistRegistrationId: string;
}

interface EmailOutboxClaim {
  claimLeaseId: string;
  row: EmailOutboxRow;
}

type EmailOutboxRow = typeof emailOutboxTable.$inferSelect;

type ManualApprovalTenantEmailContext = Pick<Tenant, 'timezone'> &
  TenantEmailContext;

type TenantEmailContext = Pick<
  Tenant,
  'emailSenderEmail' | 'emailSenderName' | 'id' | 'name'
>;

interface TenantEmailMessage {
  idempotencyKey: string;
  kind: typeof emailOutboxTable.$inferInsert.kind;
  subject: string;
  template: ReactElement;
  tenant: TenantEmailContext;
  to: string;
}

interface TenantEmailSender {
  email: string;
  name: string;
}

const failedDeliveryMessage =
  'This email could not be sent. Check the recipient address and email settings.';
const suppressedDeliveryMessage =
  'This email was not sent because this address cannot receive organization emails.';
const unknownDeliveryMessage =
  'Evorto could not confirm whether this email was sent. It will not try again automatically, to avoid sending it twice.';

class EmailTemplateRenderError extends Schema.TaggedErrorClass<EmailTemplateRenderError>()(
  'EmailTemplateRenderError',
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

export class InvalidTenantEmailTimezoneError extends Schema.TaggedErrorClass<InvalidTenantEmailTimezoneError>()(
  'InvalidTenantEmailTimezoneError',
  {
    message: Schema.String,
    tenantId: Schema.NonEmptyString,
    timezone: Schema.String,
  },
) {}

const formatManualApprovalPaymentDeadline = Effect.fn(
  'formatManualApprovalPaymentDeadline',
)(function* (paymentDeadline: Date, tenant: ManualApprovalTenantEmailContext) {
  if (!isIanaTimezone(tenant.timezone)) {
    return yield* new InvalidTenantEmailTimezoneError({
      message: 'Tenant timezone is invalid for manual approval email',
      tenantId: tenant.id,
      timezone: tenant.timezone,
    });
  }

  const formattedDeadline = new Intl.DateTimeFormat(TENANT_FORMATTING_LOCALE, {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: tenant.timezone,
    year: 'numeric',
  }).format(paymentDeadline);
  return `${formattedDeadline} (local time for ${tenant.name})`;
});

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

const renderEmailTemplate = Effect.fn('renderEmailTemplate')(function* (
  template: ReactElement,
) {
  return yield* Effect.tryPromise({
    catch: (cause) =>
      new EmailTemplateRenderError({
        cause,
        message: 'Failed to render transactional email template',
      }),
    try: async () => {
      const [html, text] = await Promise.all([
        render(template),
        render(template, { plainText: true }),
      ]);
      return { html, text };
    },
  });
});

const buildOutboxInsert = ({
  html,
  idempotencyKey,
  kind,
  subject,
  tenant,
  text,
  to,
}: Omit<TenantEmailMessage, 'template'> & {
  html: string;
  text: string;
}): typeof emailOutboxTable.$inferInsert => {
  const replyTo = tenantReplyTo(tenant);

  return {
    html,
    idempotencyKey,
    kind,
    replyToEmail: replyTo?.email ?? null,
    replyToName: replyTo?.name ?? null,
    subject,
    tenantId: tenant.id,
    text,
    toEmail: to,
  };
};

export const enqueueTenantEmail = Effect.fn('enqueueTenantEmail')(function* (
  database: Pick<DatabaseClient, 'insert'>,
  { template, ...message }: TenantEmailMessage,
) {
  yield* Effect.annotateCurrentSpan({
    emailKind: message.kind,
    idempotencyKey: message.idempotencyKey,
    tenantId: message.tenant.id,
  });
  const rendered = yield* renderEmailTemplate(template);
  return yield* database
    .insert(emailOutboxTable)
    .values(buildOutboxInsert({ ...message, ...rendered }))
    .onConflictDoNothing({
      target: emailOutboxTable.idempotencyKey,
    });
});

export const enqueueReceiptReviewedEmail = (
  database: Pick<DatabaseClient, 'insert'>,
  input: EnqueueReceiptReviewedEmailInput,
) =>
  enqueueTenantEmail(database, {
    idempotencyKey: `receipt-reviewed/${input.tenant.id}/${input.receiptId}/${input.status}`,
    kind: 'receiptReviewed',
    subject:
      input.status === 'approved' ? 'Receipt approved' : 'Receipt rejected',
    template: ReceiptReviewedEmail({
      eventTitle: input.eventTitle,
      receiptUrl: input.receiptUrl,
      rejectionReason: input.rejectionReason,
      status: input.status,
      tenantName: input.tenant.name,
    }),
    tenant: input.tenant,
    to: input.to,
  });

export const enqueueManualApprovalEmail = (
  database: Pick<DatabaseClient, 'insert'>,
  input: EnqueueManualApprovalEmailInput,
) =>
  Effect.gen(function* () {
    const paymentDeadlineText = input.paymentDeadline
      ? yield* formatManualApprovalPaymentDeadline(
          input.paymentDeadline,
          input.tenant,
        )
      : null;

    return yield* enqueueTenantEmail(database, {
      idempotencyKey: `manual-approval/${input.tenant.id}/${input.registrationId}/${input.approvalKey}`,
      kind: 'manualApproval',
      subject: input.paymentDeadline
        ? 'Sign-up approved: payment required'
        : 'Sign-up approved',
      template: ManualApprovalEmail({
        eventTitle: input.eventTitle,
        eventUrl: input.eventUrl,
        paymentDeadlineText,
        tenantName: input.tenant.name,
      }),
      tenant: input.tenant,
      to: input.to,
    });
  });

export const enqueueRegistrationConfirmedEmail = (
  database: Pick<DatabaseClient, 'insert'>,
  input: EnqueueRegistrationConfirmedEmailInput,
) =>
  enqueueTenantEmail(database, {
    idempotencyKey: `registration-confirmed/${input.tenant.id}/${input.registrationId}`,
    kind: 'registrationConfirmed',
    subject: `Ticket confirmed: ${input.eventTitle}`,
    template: RegistrationConfirmedEmail({
      eventTitle: input.eventTitle,
      tenantName: input.tenant.name,
      ticketUrl: input.ticketUrl,
    }),
    tenant: input.tenant,
    to: input.to,
  });

export const enqueueWaitlistSpotAvailableEmail = (
  database: Pick<DatabaseClient, 'insert'>,
  input: EnqueueWaitlistSpotAvailableEmailInput,
) =>
  enqueueTenantEmail(database, {
    idempotencyKey: `waitlist-spot-available/${input.tenant.id}/${input.waitlistRegistrationId}/${input.availabilityKey}`,
    kind: 'waitlistSpotAvailable',
    subject: `A place may be available: ${input.eventTitle}`,
    template: WaitlistSpotAvailableEmail({
      eventTitle: input.eventTitle,
      eventUrl: input.eventUrl,
      tenantName: input.tenant.name,
    }),
    tenant: input.tenant,
    to: input.to,
  });

export const enqueueRegistrationCancelledEmail = (
  database: Pick<DatabaseClient, 'insert'>,
  input: EnqueueRegistrationCancelledEmailInput,
) =>
  enqueueTenantEmail(database, {
    idempotencyKey: `registration-cancelled/${input.tenant.id}/${input.registrationId}`,
    kind: 'registrationCancelled',
    subject: `${registrationCancellationEmailTitle(input.cancellationKind)}: ${input.eventTitle}`,
    template: RegistrationCancelledEmail({
      cancellationKind: input.cancellationKind,
      cancelledBy: input.cancelledBy,
      eventTitle: input.eventTitle,
      eventUrl: input.eventUrl,
      refundOutcome: input.refundOutcome,
      tenantName: input.tenant.name,
    }),
    tenant: input.tenant,
    to: input.to,
  });

export const enqueueRegistrationTransferredEmail = (
  database: Pick<DatabaseClient, 'insert'>,
  input: EnqueueRegistrationTransferredEmailInput,
) =>
  enqueueTenantEmail(database, {
    idempotencyKey: `registration-transferred/${input.tenant.id}/${input.registrationId}/${input.transferOperationId}/${input.recipientRole}/${input.recipientUserId}`,
    kind: 'registrationTransferred',
    subject:
      input.recipientRole === 'newOwner'
        ? `Ticket transferred to you: ${input.eventTitle}`
        : `Ticket transferred: ${input.eventTitle}`,
    template: RegistrationTransferredEmail({
      eventTitle: input.eventTitle,
      eventUrl: input.eventUrl,
      recipientRole: input.recipientRole,
      refundOutcome: input.refundOutcome,
      tenantName: input.tenant.name,
    }),
    tenant: input.tenant,
    to: input.to,
  });

const sendOutboxRow = Effect.fn('sendOutboxRow')(function* (
  row: EmailOutboxRow,
) {
  return yield* EmailDelivery.deliver({
    html: row.html,
    replyTo: row.replyToEmail
      ? {
          email: row.replyToEmail,
          name: row.replyToName ?? row.replyToEmail,
        }
      : null,
    subject: row.subject,
    text: row.text,
    to: row.toEmail,
  });
});

const markOutboxRowSent = Effect.fn('markOutboxRowSent')(function* (
  claim: EmailOutboxClaim,
  provider: 'fake' | 'mailpit' | 'tem',
  providerMessageId: string,
) {
  const updatedRows = yield* Database.use((database) =>
    database
      .update(emailOutboxTable)
      .set({
        claimLeaseExpiresAt: null,
        claimLeaseId: null,
        lastError: null,
        provider,
        providerMessageId,
        sentAt: new Date(),
        status: 'sent',
      })
      .where(emailOutboxOwnedClaimPredicate(claim.row.id, claim.claimLeaseId))
      .returning({ id: emailOutboxTable.id }),
  );
  return updatedRows.length > 0;
});

const markOutboxRowFailed = Effect.fn('markOutboxRowFailed')(function* (
  claim: EmailOutboxClaim,
  failure: Exclude<
    EmailDeliveryError,
    { readonly _tag: 'EmailDeliveryUnknownError' }
  >,
) {
  const updatedRows = yield* Database.use((database) =>
    database
      .update(emailOutboxTable)
      .set({
        claimLeaseExpiresAt: null,
        claimLeaseId: null,
        lastError: failedDeliveryMessage,
        provider: failure.provider,
        status: 'failed',
      })
      .where(emailOutboxOwnedClaimPredicate(claim.row.id, claim.claimLeaseId))
      .returning({ id: emailOutboxTable.id }),
  );
  return updatedRows.length > 0;
});

const markOutboxRowDeliveryUnknown = Effect.fn('markOutboxRowDeliveryUnknown')(
  function* (
    claim: EmailOutboxClaim,
    failure: Extract<
      EmailDeliveryError,
      { readonly _tag: 'EmailDeliveryUnknownError' }
    >,
  ) {
    const updatedRows = yield* Database.use((database) =>
      database
        .update(emailOutboxTable)
        .set({
          claimLeaseExpiresAt: null,
          claimLeaseId: null,
          deliveryUnknownAt: new Date(),
          lastError: unknownDeliveryMessage,
          provider: failure.provider,
          status: 'deliveryUnknown',
        })
        .where(emailOutboxOwnedClaimPredicate(claim.row.id, claim.claimLeaseId))
        .returning({ id: emailOutboxTable.id }),
    );
    return updatedRows.length > 0;
  },
);

const markAbandonedOutboxRowsDeliveryUnknown = Effect.fn(
  'markAbandonedOutboxRowsDeliveryUnknown',
)(function* () {
  return yield* Database.use((database) =>
    database
      .update(emailOutboxTable)
      .set({
        claimLeaseExpiresAt: null,
        claimLeaseId: null,
        deliveryUnknownAt: new Date(),
        lastError: unknownDeliveryMessage,
        status: 'deliveryUnknown',
      })
      .where(emailOutboxAbandonedSendingPredicate())
      .returning({ id: emailOutboxTable.id }),
  );
});

const markOutboxRowSuppressed = Effect.fn('markOutboxRowSuppressed')(function* (
  claim: EmailOutboxClaim,
  provider: 'fake' | 'mailpit' | 'tem',
) {
  const updatedRows = yield* Database.use((database) =>
    database
      .update(emailOutboxTable)
      .set({
        claimLeaseExpiresAt: null,
        claimLeaseId: null,
        lastError: suppressedDeliveryMessage,
        provider,
        status: 'suppressed',
        suppressedAt: new Date(),
      })
      .where(emailOutboxOwnedClaimPredicate(claim.row.id, claim.claimLeaseId))
      .returning({ id: emailOutboxTable.id }),
  );
  return updatedRows.length > 0;
});

const claimOutboxRow = Effect.fn('claimOutboxRow')(function* (rowId: string) {
  const claimLeaseId = crypto.randomUUID();
  const rows = yield* Database.use((database) =>
    database
      .update(emailOutboxTable)
      .set({
        attempts: 1,
        claimLeaseExpiresAt: emailOutboxClaimLeaseExpiry(),
        claimLeaseId,
        lastAttemptAt: sql<Date>`now()`,
        status: 'sending',
      })
      .where(emailOutboxDispatchableByIdPredicate(rowId))
      .returning(),
  );
  const row = rows[0];
  return row ? { claimLeaseId, row } : null;
});

export const processDueEmailOutbox = Effect.fn('processDueEmailOutbox')(
  function* (limit = 10) {
    const abandonedRows = yield* markAbandonedOutboxRowsDeliveryUnknown();
    if (abandonedRows.length > 0) {
      yield* Effect.logWarning(
        'Email outbox deliveries became unknown after their claim leases were missing or expired',
      ).pipe(
        Effect.annotateLogs({
          outboxRowCount: abandonedRows.length,
        }),
      );
    }

    const dueRows = yield* Database.use((database) =>
      database
        .select()
        .from(emailOutboxTable)
        .where(emailOutboxDispatchablePredicate())
        .orderBy(asc(emailOutboxTable.createdAt))
        .limit(limit),
    );
    let processedRows = 0;

    for (const dueRow of dueRows) {
      const claimedRow = yield* claimOutboxRow(dueRow.id);
      if (!claimedRow) {
        continue;
      }
      processedRows += 1;

      const attempt = yield* sendOutboxRow(claimedRow.row).pipe(
        Effect.map((delivery) => ({
          _tag: 'Delivery' as const,
          delivery,
        })),
        Effect.catch((error) =>
          Effect.succeed({
            _tag: 'Failure' as const,
            error,
          }),
        ),
      );

      const settled = yield* Effect.gen(function* () {
        if (attempt._tag === 'Failure') {
          yield* Effect.logWarning(
            attempt.error._tag === 'EmailDeliveryUnknownError'
              ? 'Email delivery outcome could not be confirmed'
              : 'Email delivery was rejected',
          ).pipe(
            Effect.annotateLogs({
              diagnostic: attempt.error.message,
              outboxRowId: claimedRow.row.id,
              provider: attempt.error.provider,
            }),
          );
          return attempt.error._tag === 'EmailDeliveryUnknownError'
            ? yield* markOutboxRowDeliveryUnknown(claimedRow, attempt.error)
            : yield* markOutboxRowFailed(claimedRow, attempt.error);
        }
        if (attempt.delivery._tag === 'Suppressed') {
          yield* Effect.logInfo('Email delivery was withheld').pipe(
            Effect.annotateLogs({
              diagnostic: attempt.delivery.reason,
              outboxRowId: claimedRow.row.id,
              provider: attempt.delivery.provider,
            }),
          );
          return yield* markOutboxRowSuppressed(
            claimedRow,
            attempt.delivery.provider,
          );
        }
        return yield* markOutboxRowSent(
          claimedRow,
          attempt.delivery.provider,
          attempt.delivery.providerMessageId,
        );
      });
      if (!settled) {
        yield* Effect.logWarning(
          'Email outbox claim was no longer active when delivery settled',
        ).pipe(
          Effect.annotateLogs({
            claimLeaseId: claimedRow.claimLeaseId,
            outboxRowId: claimedRow.row.id,
          }),
        );
      }
    }

    return processedRows;
  },
);

export const handleEmailOutboxProcessorCause = (cause: Cause.Cause<unknown>) =>
  Cause.hasInterrupts(cause)
    ? Effect.failCause(cause)
    : Effect.logError('Email outbox processor failed').pipe(
        Effect.annotateLogs({ cause: String(cause) }),
      );

export const runEmailOutboxProcessor = processDueEmailOutbox().pipe(
  Effect.catchCause(handleEmailOutboxProcessorCause),
  Effect.andThen(Effect.sleep(Duration.seconds(15))),
  Effect.forever,
);
