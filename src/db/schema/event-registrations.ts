import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { eventInstances } from './event-instances';
import { eventRegistrationOptions } from './event-registration-options';
import { cancellationReasons, paymentStatus, registrationStatus } from './global-enums';
import { modelOfTenant } from './model';
import { users } from './users';
import { EffectiveCancellationPolicy } from '../../types/cancellation';

export const eventRegistrations = pgTable('event_registrations', {
  ...modelOfTenant,
  checkInTime: timestamp(),
  eventId: varchar({ length: 20 })
    .notNull()
    .references(() => eventInstances.id),
  paymentId: varchar({ length: 255 }),
  paymentStatus: paymentStatus(),
  registrationOptionId: varchar({ length: 20 })
    .notNull()
    .references(() => eventRegistrationOptions.id),
  status: registrationStatus().notNull(),
  userId: varchar({ length: 20 })
    .notNull()
    .references(() => users.id),
  // Cancellation policy snapshot taken at registration time
  effectiveCancellationPolicy: jsonb('effective_cancellation_policy').$type<EffectiveCancellationPolicy>(),
  effectivePolicySource: varchar({ length: 50 }),
  // Cancellation tracking
  cancelledAt: timestamp(),
  refundTransactionId: varchar({ length: 20 }),
  cancellationReason: cancellationReasons(),
  cancellationReasonNote: text(),
});
