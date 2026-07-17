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
  'deliveryUnknown',
  'suppressed',
]);

export const emailDeliveryProvider = pgEnum('email_delivery_provider', [
  'fake',
  'mailpit',
  'tem',
]);

export const emailOutboxKind = pgEnum('email_outbox_kind', [
  'manualApproval',
  'receiptReviewed',
  'registrationCancelled',
  'registrationConfirmed',
  'registrationTransferred',
  'waitlistSpotAvailable',
]);

export const emailOutbox = pgTable(
  'email_outbox',
  {
    ...modelOfTenant,
    attempts: integer().notNull().default(0),
    claimLeaseExpiresAt: timestamp('claim_lease_expires_at'),
    claimLeaseId: text('claim_lease_id'),
    deliveryUnknownAt: timestamp('delivery_unknown_at'),
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
    provider: emailDeliveryProvider(),
    providerMessageId: text('provider_message_id'),
    replyToEmail: text('reply_to_email'),
    replyToName: text('reply_to_name'),
    sentAt: timestamp('sent_at'),
    status: emailOutboxStatus().notNull().default('queued'),
    subject: text().notNull(),
    suppressedAt: timestamp('suppressed_at'),
    text: text().notNull(),
    toEmail: text('to_email').notNull(),
  },
  (table) => ({
    claimLeaseIndex: index('email_outbox_claim_lease_idx').on(
      table.status,
      table.claimLeaseExpiresAt,
    ),
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
