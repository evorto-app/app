import { sql } from 'drizzle-orm';
import {
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { eventRegistrations } from './event-registrations';
import { modelOfTenant } from './model';
import { users } from './users';

export const registrationTransferIntentStatus = pgEnum(
  'registration_transfer_intent_status',
  ['pending', 'completed', 'cancelled', 'expired'],
);

export const registrationTransferIntents = pgTable(
  'registration_transfer_intents',
  {
    ...modelOfTenant,
    code: varchar({ length: 64 }).notNull().unique(),
    createdByUserId: varchar('created_by_user_id', { length: 20 })
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at').notNull(),
    replacementRegistrationId: varchar('replacement_registration_id', {
      length: 20,
    }).references(() => eventRegistrations.id),
    sourceRegistrationId: varchar('source_registration_id', { length: 20 })
      .notNull()
      .references(() => eventRegistrations.id),
    status: registrationTransferIntentStatus().notNull().default('pending'),
  },
  (table) => ({
    uniquePendingSourceRegistration: uniqueIndex(
      'registration_transfer_intents_pending_source_registration_unique',
    )
      .on(table.sourceRegistrationId)
      .where(sql`${table.status} = 'pending'`),
  }),
);
