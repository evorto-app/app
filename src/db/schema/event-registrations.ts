import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { CancellationPolicy } from '../../types/cancellation';
import { eventInstances } from './event-instances';
import { eventRegistrationOptions } from './event-registration-options';
import { cancellationReasons, paymentStatus, registrationStatus } from './global-enums';
import { modelOfTenant } from './model';
import { users } from './users';

export const eventRegistrations = pgTable('event_registrations', {
  ...modelOfTenant,
  cancelledAt: timestamp(),
  cancellationReason: cancellationReasons(),
  cancellationReasonNote: text(),
  checkInTime: timestamp(),
  effectiveCancellationPolicy: jsonb('effective_cancellation_policy').$type<CancellationPolicy>(),
  effectivePolicySource: varchar({ length: 20 }),
  eventId: varchar({ length: 20 })
    .notNull()
    .references(() => eventInstances.id),
  paymentId: varchar({ length: 255 }),
  paymentStatus: paymentStatus(),
  refundTransactionId: varchar({ length: 20 }),
  registrationOptionId: varchar({ length: 20 })
    .notNull()
    .references(() => eventRegistrationOptions.id),
  status: registrationStatus().notNull(),
  userId: varchar({ length: 20 })
    .notNull()
    .references(() => users.id),
});
