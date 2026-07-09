import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

import { modelOfTenant } from './model';

export const emailOutboxStatus = pgEnum('email_outbox_status', [
  'queued',
  'sending',
  'sent',
  'failed',
]);

export const emailOutboxKind = pgEnum('email_outbox_kind', [
  'manualApproval',
  'receiptReviewed',
]);

export const emailOutbox = pgTable(
  'email_outbox',
  {
    ...modelOfTenant,
    attempts: integer().notNull().default(0),
    exhaustedAt: timestamp('exhausted_at'),
    fromEmail: text('from_email').notNull(),
    fromName: text('from_name').notNull(),
    html: text().notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    kind: emailOutboxKind().notNull(),
    lastAttemptAt: timestamp('last_attempt_at'),
    lastError: text('last_error'),
    maxAttempts: integer('max_attempts').notNull().default(8),
    nextAttemptAt: timestamp('next_attempt_at').notNull().defaultNow(),
    replyToEmail: text('reply_to_email'),
    replyToName: text('reply_to_name'),
    resendEmailId: text('resend_email_id'),
    sentAt: timestamp('sent_at'),
    status: emailOutboxStatus().notNull().default('queued'),
    subject: text().notNull(),
    text: text().notNull(),
    toEmail: text('to_email').notNull(),
  },
  (table) => ({
    idempotencyKeyUnique: unique().on(table.idempotencyKey),
    nextAttemptIndex: index('email_outbox_next_attempt_idx').on(
      table.status,
      table.nextAttemptAt,
    ),
    tenantStatusIndex: index('email_outbox_tenant_status_idx').on(
      table.tenantId,
      table.status,
    ),
  }),
);
