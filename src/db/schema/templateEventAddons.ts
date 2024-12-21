import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { eventTemplates } from './eventTemplates';

export const templateEventAddons = pgTable('template_event_addons', {
  id: uuid().defaultRandom().primaryKey(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  title: text().notNull(),
  description: text(),
  totalAvailableQuantity: integer().notNull(),
  isPaid: boolean().notNull(),
  price: integer().notNull(),
  allowMultiple: boolean().notNull(),
  maxQuantityPerUser: integer().notNull(),
  allowPurchaseDuringRegistration: boolean().notNull(),
  allowPurchaseBeforeEvent: boolean().notNull(),
  allowPurchaseDuringEvent: boolean().notNull(),
  templateId: uuid()
    .notNull()
    .references(() => eventTemplates.id),
});
