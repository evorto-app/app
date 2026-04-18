import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const stripeWebhookEvents = pgTable('stripe_webhook_events', {
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at').notNull().defaultNow(),
  status: text('status').notNull().default('processing'),
  stripeEventId: varchar('stripe_event_id').primaryKey(),
  tenantId: varchar('tenant_id', { length: 20 }),
});
