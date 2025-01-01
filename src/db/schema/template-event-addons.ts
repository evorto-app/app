import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventTemplates } from './event-templates';

export const templateEventAddons = pgTable('template_event_addons', {
  allowMultiple: boolean().notNull(),
  allowPurchaseBeforeEvent: boolean().notNull(),
  allowPurchaseDuringEvent: boolean().notNull(),
  allowPurchaseDuringRegistration: boolean().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
  description: text(),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  isPaid: boolean().notNull(),
  maxQuantityPerUser: integer().notNull(),
  price: integer().notNull(),
  templateId: varchar({ length: 20 })
    .notNull()
    .references(() => eventTemplates.id),
  title: text().notNull(),
  totalAvailableQuantity: integer().notNull(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
