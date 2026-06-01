import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { modelOfTenant } from './model';
import { users } from './users';

export const emailNotificationKind = pgEnum('email_notification_kind', [
  'receiptReviewed',
  'registrationCancelled',
  'registrationConfirmed',
  'registrationTransferred',
  'waitlistSpotAvailable',
]);

export const emailNotificationStatus = pgEnum('email_notification_status', [
  'pending',
  'sent',
  'failed',
]);

export interface EmailNotificationPayload {
  eventId?: string;
  eventTitle?: string;
  receiptId?: string;
  registrationId?: string;
  reviewStatus?: 'approved' | 'rejected';
}

export const emailNotificationOutbox = pgTable('email_notification_outbox', {
  ...modelOfTenant,
  failedAt: timestamp('failed_at'),
  failureMessage: text('failure_message'),
  kind: emailNotificationKind().notNull(),
  payload: jsonb().$type<EmailNotificationPayload>().notNull().default({}),
  recipientEmail: text('recipient_email').notNull(),
  recipientUserId: varchar('recipient_user_id', { length: 20 })
    .notNull()
    .references(() => users.id),
  sentAt: timestamp('sent_at'),
  status: emailNotificationStatus().notNull().default('pending'),
  subject: text().notNull(),
  textBody: text('text_body').notNull(),
});
