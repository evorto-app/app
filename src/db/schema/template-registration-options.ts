import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { CancellationPolicy } from '../../types/cancellation';
import { createId } from '../create-id';
import { eventTemplates } from './event-templates';
import { registrationModes } from './global-enums';
import { templateEventAddons } from './template-event-addons';

export const templateRegistrationOptions = pgTable(
  'template_registration_options',
  {
    cancellationPolicy: jsonb('cancellation_policy').$type<CancellationPolicy>(),
    closeRegistrationOffset: integer().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    description: text(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    isPaid: boolean().notNull(),
    openRegistrationOffset: integer().notNull(),
    organizingRegistration: boolean().notNull(),
    price: integer().notNull(),
    registeredDescription: text(),
    registrationMode: registrationModes().notNull().default('fcfs'),
    roleIds: varchar({ length: 20 }).array().notNull().default([]),
    spots: integer().notNull(),
    stripeTaxRateId: varchar(),
    templateId: varchar({ length: 20 })
      .notNull()
      .references(() => eventTemplates.id),
    title: text().notNull(),
    untouchedSinceMigration: boolean().notNull().default(false),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    useTenantCancellationPolicy: boolean().notNull().default(true),
  },
);

export const addonToTemplateRegistrationOptions = pgTable(
  'addon_to_template_registration_options',
  {
    addonId: varchar({ length: 20 })
      .notNull()
      .references(() => templateEventAddons.id),
    quantity: integer().notNull(),
    registrationOptionId: varchar({ length: 20 })
      .notNull()
      .references(() => templateRegistrationOptions.id),
  },
  (table) => ({
    unique: unique().on(table.addonId, table.registrationOptionId),
  }),
);
